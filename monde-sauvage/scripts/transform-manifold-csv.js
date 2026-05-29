#!/usr/bin/env node
/**
 * Transform a Manisoft/Manifold reservation export to the
 * Monde Sauvage import template format.
 *
 * Usage:
 *   node scripts/transform-manifold-csv.js <input.csv> [output.csv]
 *
 * Input columns (Manisoft export):
 *   Réservation #, Unité, Arrivée, Départ, Prénom, Nom,
 *   Courriel, Téléphone, Adultes, Enfants, Montant (CAD), Statut, Commentaires
 *
 * Output columns (Monde Sauvage import template):
 *   chalet_nom, date_arrivee, date_depart, nom_client, courriel, notes
 *
 * Only rows with Statut = "Confirmé" (or "Confirmed") are kept.
 * Dates in any of DD/MM/YYYY, MM/DD/YYYY, YYYY-MM-DD are normalised to YYYY-MM-DD.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ─── Minimal CSV parser (handles quoted fields + CRLF) ───────────────────────

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false, i = 0;
  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => {
    pushField();
    if (row.some((c) => c.trim() !== '')) rows.push(row);
    row = [];
  };
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i += 2; continue; }
      if (c === '"') { inQuotes = false; i++; continue; }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ',') { pushField(); i++; continue; }
    if (c === '\r') { if (text[i + 1] === '\n') i++; pushRow(); i++; continue; }
    if (c === '\n') { pushRow(); i++; continue; }
    field += c; i++;
  }
  pushField();
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

function toCsvLine(fields) {
  return fields
    .map((f) => {
      const s = String(f ?? '');
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? `"${s.replace(/"/g, '""')}"`
        : s;
    })
    .join(',');
}

// ─── Date normalisation ───────────────────────────────────────────────────────

function normaliseDate(raw) {
  const s = String(raw ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (m) {
    const a = +m[1], b = +m[2], y = m[3];
    // If first part > 12 it must be day; otherwise assume MM/DD (Manisoft default)
    if (a > 12) return `${y}-${String(b).padStart(2, '0')}-${String(a).padStart(2, '0')}`;
    return `${y}-${String(a).padStart(2, '0')}-${String(b).padStart(2, '0')}`;
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  throw new Error(`Date non reconnue : "${raw}"`);
}

// ─── Column index resolver ────────────────────────────────────────────────────

function colIdx(headers, ...candidates) {
  // Exact match first, then prefix, then substring — avoids "Prénom" matching "nom"
  for (const c of candidates) {
    const lc = c.toLowerCase();
    let idx = headers.findIndex((h) => h.toLowerCase() === lc);
    if (idx >= 0) return idx;
    idx = headers.findIndex((h) => h.toLowerCase().startsWith(lc));
    if (idx >= 0) return idx;
    idx = headers.findIndex((h) => h.toLowerCase().includes(lc) && !h.toLowerCase().startsWith('pré'));
    if (idx >= 0) return idx;
  }
  return -1;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const [,, inputArg, outputArg] = process.argv;
if (!inputArg) {
  console.error('Usage: node scripts/transform-manifold-csv.js <input.csv> [output.csv]');
  process.exit(1);
}

const inputPath = resolve(inputArg);
const outputPath = outputArg ? resolve(outputArg) : null;

const raw = readFileSync(inputPath, 'utf-8').replace(/^﻿/, ''); // strip BOM
const rows = parseCsv(raw);

if (rows.length < 2) {
  console.error('Fichier vide ou sans données.');
  process.exit(1);
}

const headers = rows[0].map((h) => String(h).trim());

const iUnit    = colIdx(headers, 'unité', 'unite', 'chalet', 'logement', 'unit');
const iStart   = colIdx(headers, 'arriv', 'check-in', 'début', 'start');
const iEnd     = colIdx(headers, 'départ', 'depart', 'check-out', 'fin', 'end');
const iFirst   = colIdx(headers, 'prénom', 'prenom', 'first');
const iLast    = colIdx(headers, 'nom', 'last', 'famille');
const iEmail   = colIdx(headers, 'courriel', 'email', 'mail');
const iStatus  = colIdx(headers, 'statut', 'status', 'état');
const iNotes   = colIdx(headers, 'commentaire', 'note', 'comment', 'remarque');
const iRef     = colIdx(headers, 'réservation', 'reservation', 'booking', '#');
const iAmount  = colIdx(headers, 'montant', 'amount', 'prix', 'price', 'total');

if (iUnit < 0 || iStart < 0 || iEnd < 0) {
  console.error('Colonnes requises introuvables. Vérifiez les en-têtes : Unité, Arrivée, Départ.');
  process.exit(1);
}

const CONFIRMED = ['confirmé', 'confirme', 'confirmed', 'actif'];

const outputRows = [['chalet_nom', 'date_arrivee', 'date_depart', 'nom_client', 'courriel', 'notes']];
let skipped = 0;
let errors = 0;

for (let r = 1; r < rows.length; r++) {
  const row = rows[r];
  const cell = (i) => (i >= 0 ? String(row[i] ?? '').trim() : '');

  // Filter by status
  const status = cell(iStatus).toLowerCase();
  if (iStatus >= 0 && status && !CONFIRMED.some((s) => status.includes(s))) {
    skipped++;
    continue;
  }

  let dateArrivee, dateDepart;
  try {
    dateArrivee = normaliseDate(cell(iStart));
    dateDepart  = normaliseDate(cell(iEnd));
  } catch (err) {
    console.warn(`Ligne ${r + 1} ignorée — ${err.message}`);
    errors++;
    continue;
  }

  const firstName = cell(iFirst);
  const lastName  = cell(iLast);
  // If both first and last name columns exist, combine. If only one, use it.
  let nomClient;
  if (iFirst >= 0 && iLast >= 0 && firstName && lastName) {
    nomClient = `${firstName} ${lastName}`;
  } else {
    nomClient = firstName || lastName || cell(colIdx(headers, 'nom', 'client', 'name'));
  }

  // Build notes: include original ref + amount + free-text notes
  const noteParts = [];
  if (iRef >= 0 && cell(iRef)) noteParts.push(`Réf: ${cell(iRef)}`);
  if (iAmount >= 0 && cell(iAmount)) noteParts.push(`Montant: ${cell(iAmount)} $`);
  if (iNotes >= 0 && cell(iNotes)) noteParts.push(cell(iNotes));
  const notes = noteParts.join(' | ');

  outputRows.push([
    cell(iUnit),
    dateArrivee,
    dateDepart,
    nomClient,
    cell(iEmail),
    notes,
  ]);
}

const outputCsv = '﻿' + outputRows.map(toCsvLine).join('\n') + '\n';

if (outputPath) {
  writeFileSync(outputPath, outputCsv, 'utf-8');
  console.log(`✓ ${outputRows.length - 1} réservation(s) exportée(s) → ${outputPath}`);
} else {
  process.stdout.write(outputCsv);
}

if (skipped > 0) console.warn(`  ${skipped} ligne(s) ignorée(s) (statut non confirmé)`);
if (errors > 0)  console.warn(`  ${errors} ligne(s) ignorée(s) (erreur de date)`);
