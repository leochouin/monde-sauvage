import { useCallback, useEffect, useMemo, useState } from 'react';
import { parseCsvRows } from '../utils/csvParse.js';
import {
  getEstablishmentClients,
  createEstablishmentClient,
  updateEstablishmentClient,
  deleteEstablishmentClient,
  importEstablishmentClientsBatch,
} from '../utils/establishmentClientService.js';
import { toast } from '../utils/toast.js';

const EMPTY_FORM = {
  fullName: '',
  email: '',
  phone: '',
  notes: '',
};

/** Normalise entête CSV pour deviner la colonne */
function guessColumnField(header) {
  const h = String(header || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
  if (/^(nom|name|full|client)/.test(h) || h.includes('complet')) return 'full_name';
  if (/(email|courriel|mail)/.test(h)) return 'email';
  if (/(tel|phone|mobile)/.test(h)) return 'phone';
  if (/(note|remarque|comment)/.test(h)) return 'notes';
  return null;
}

export default function EstablishmentClientsPanel({ establishmentId }) {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [error, setError] = useState(null);

  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState(null);

  const [importOpen, setImportOpen] = useState(false);
  const [csvRows, setCsvRows] = useState([]);
  const [headerRowIsLabels, setHeaderRowIsLabels] = useState(true);
  const [mapFullName, setMapFullName] = useState('');
  const [mapEmail, setMapEmail] = useState('');
  const [mapPhone, setMapPhone] = useState('');
  const [mapNotes, setMapNotes] = useState('');
  const [importing, setImporting] = useState(false);
  const [importErrors, setImportErrors] = useState([]);
  const [pasteBulk, setPasteBulk] = useState('');

  const load = useCallback(async () => {
    if (!establishmentId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getEstablishmentClients(establishmentId, { search });
      setClients(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [establishmentId, search]);

  useEffect(() => {
    load();
  }, [load]);

  const headers = useMemo(() => {
    if (csvRows.length === 0) return [];
    return csvRows[0].map((c, i) => String(c || '').trim() || `Colonne ${i + 1}`);
  }, [csvRows]);

  const dataRows = useMemo(() => {
    if (csvRows.length <= 1) return [];
    return headerRowIsLabels ? csvRows.slice(1) : csvRows;
  }, [csvRows, headerRowIsLabels]);

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      const rows = parseCsvRows(text);
      setCsvRows(rows);
      setHeaderRowIsLabels(true);
      setImportErrors([]);

      if (rows.length > 0) {
        const next = { fn: '', em: '', ph: '', no: '' };
        rows[0].forEach((cell, idx) => {
          const g = guessColumnField(cell);
          if (g === 'full_name' && !next.fn) next.fn = String(idx);
          if (g === 'email' && !next.em) next.em = String(idx);
          if (g === 'phone' && !next.ph) next.ph = String(idx);
          if (g === 'notes' && !next.no) next.no = String(idx);
        });
        setMapFullName(next.fn);
        setMapEmail(next.em);
        setMapPhone(next.ph);
        setMapNotes(next.no);
      }
    };
    reader.readAsText(file, 'UTF-8');
    e.target.value = '';
  };

  const downloadTemplate = () => {
    const bom = '\uFEFF';
    const line = 'nom_complet,courriel,telephone,notes\n';
    const blob = new Blob([bom + line], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = globalThis.document.createElement('a');
    a.href = url;
    a.download = 'modele-clients-etablissement.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const previewRows = useMemo(() => dataRows.slice(0, 10), [dataRows]);

  const buildImportPayload = () => {
    const iName = mapFullName === '' ? -1 : Number.parseInt(mapFullName, 10);
    const iEmail = mapEmail === '' ? -1 : Number.parseInt(mapEmail, 10);
    const iPhone = mapPhone === '' ? -1 : Number.parseInt(mapPhone, 10);
    const iNotes = mapNotes === '' ? -1 : Number.parseInt(mapNotes, 10);

    if (Number.isNaN(iName) || iName < 0) {
      throw new Error('Choisissez la colonne « nom complet ».');
    }

    const out = [];
    for (let r = 0; r < dataRows.length; r += 1) {
      const row = dataRows[r];
      const fullName = row[iName] != null ? String(row[iName]).trim() : '';
      const email = iEmail >= 0 && row[iEmail] != null ? String(row[iEmail]).trim() : '';
      const phone = iPhone >= 0 && row[iPhone] != null ? String(row[iPhone]).trim() : '';
      const notes = iNotes >= 0 && row[iNotes] != null ? String(row[iNotes]).trim() : '';
      out.push({ fullName, email, phone, notes });
    }
    return out;
  };

  const handleImportCsv = async () => {
    if (!establishmentId) return;
    let payload;
    try {
      payload = buildImportPayload();
    } catch (err) {
      toast.error(err.message);
      return;
    }
    setImporting(true);
    setImportErrors([]);
    try {
      const { inserted, errors } = await importEstablishmentClientsBatch(establishmentId, payload);
      setImportErrors(errors);
      toast.success(`${inserted} client(s) importé(s).`);
      await load();
      if (errors.length === 0) {
        setCsvRows([]);
        setImportOpen(false);
      }
    } catch (err) {
      toast.error(err.message || 'Import impossible');
    } finally {
      setImporting(false);
    }
  };

  const handlePasteImport = async () => {
    if (!establishmentId || !pasteBulk.trim()) return;
    const lines = pasteBulk.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const rows = lines.map((line) => {
      const parts = line.split(/[,;\t]/).map((p) => p.trim());
      return {
        fullName: parts[0] || '',
        email: parts[1] || '',
        phone: parts[2] || '',
        notes: parts.slice(3).join(' ') || '',
      };
    });
    setImporting(true);
    try {
      const { inserted, errors } = await importEstablishmentClientsBatch(establishmentId, rows);
      setImportErrors(errors);
      toast.success(`${inserted} client(s) ajouté(s).`);
      setPasteBulk('');
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setImporting(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!establishmentId) return;
    if (!form.fullName.trim()) {
      toast.error('Le nom est requis.');
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        await updateEstablishmentClient(editingId, {
          fullName: form.fullName,
          email: form.email,
          phone: form.phone,
          notes: form.notes,
        });
        toast.success('Client mis à jour.');
      } else {
        await createEstablishmentClient({
          establishmentId,
          fullName: form.fullName,
          email: form.email,
          phone: form.phone,
          notes: form.notes,
        });
        toast.success('Client ajouté.');
      }
      setForm(EMPTY_FORM);
      setEditingId(null);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (c) => {
    setEditingId(c.id);
    setForm({
      fullName: c.full_name || '',
      email: c.email || '',
      phone: c.phone || '',
      notes: c.notes || '',
    });
  };

  const handleDelete = async (id) => {
    setDeleteId(null);
    try {
      await deleteEstablishmentClient(id);
      toast.success('Client retiré.');
      if (editingId === id) {
        setEditingId(null);
        setForm(EMPTY_FORM);
      }
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const colOptions = useMemo(() => {
    if (csvRows.length === 0) return [];
    const maxCols = Math.max(...csvRows.map((r) => r.length));
    return Array.from({ length: maxCols }, (_, i) => {
      const label = headers[i] || `Colonne ${i + 1}`;
      return { value: String(i), label: `${label}` };
    });
  }, [csvRows, headers]);

  return (
    <div className="guide-section guide-card" style={{ border: '1px solid #e2e8f0', borderRadius: 12, background: 'white', padding: 20 }}>
      <h2 className="guide-section-title" style={{ padding: 0, marginBottom: 8 }}>
        Carnet clients
      </h2>
      <p style={{ color: '#64748b', fontSize: '0.92rem', margin: '0 0 16px' }}>
        Reprenez votre liste depuis un fichier ou ajoutez à la main. Les clients ici sont privés à votre établissement.
      </p>

      {error && (
        <div style={{ padding: 12, background: '#fee2e2', color: '#991b1b', borderRadius: 8, marginBottom: 12, fontSize: '0.9rem' }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 16, alignItems: 'center' }}>
        <input
          type="search"
          placeholder="Rechercher par nom, courriel ou téléphone..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: '1 1 220px', padding: '8px 12px', borderRadius: 8, border: '1px solid #cbd5e1' }}
        />
        <button
          type="button"
          onClick={() => setImportOpen((v) => !v)}
          style={{
            padding: '8px 14px',
            borderRadius: 8,
            border: '1px solid #93c5fd',
            background: importOpen ? '#dbeafe' : 'white',
            color: '#1e40af',
            fontWeight: 600,
            cursor: 'pointer',
            fontSize: '0.88rem',
          }}
        >
          {importOpen ? 'Fermer l’import' : 'Importer (fichier ou collage)'}
        </button>
      </div>

      {importOpen && (
        <div
          style={{
            marginBottom: 20,
            padding: 16,
            borderRadius: 10,
            border: '1px dashed #cbd5e1',
            background: '#f8fafc',
          }}
        >
          <h3 style={{ margin: '0 0 10px', fontSize: '1rem', color: '#1e293b' }}>Importer depuis un fichier CSV</h3>
          <p style={{ fontSize: '0.82rem', color: '#64748b', margin: '0 0 10px' }}>
            Téléchargez le modèle, ouvrez-le dans Excel / LibreOffice, puis enregistrez en CSV. Colonnes possibles : nom,
            courriel, téléphone, notes.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12, alignItems: 'center' }}>
            <button
              type="button"
              onClick={downloadTemplate}
              style={{
                padding: '6px 12px',
                borderRadius: 6,
                border: '1px solid #0d9488',
                background: 'white',
                color: '#0f766e',
                fontWeight: 600,
                cursor: 'pointer',
                fontSize: '0.85rem',
              }}
            >
              Télécharger le modèle CSV
            </button>
            <label
              style={{
                padding: '6px 12px',
                borderRadius: 6,
                background: '#0d9488',
                color: 'white',
                fontWeight: 600,
                cursor: 'pointer',
                fontSize: '0.85rem',
              }}
            >
              Choisir un fichier…
              <input type="file" accept=".csv,.txt,text/csv" style={{ display: 'none' }} onChange={handleFile} />
            </label>
          </div>

          {csvRows.length > 0 && (
            <>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', marginBottom: 10 }}>
                <input
                  type="checkbox"
                  checked={headerRowIsLabels}
                  onChange={(e) => setHeaderRowIsLabels(e.target.checked)}
                />
                La première ligne contient les titres des colonnes
              </label>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, marginBottom: 12 }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem', color: '#475569' }}>
                  Nom complet *
                  <select
                    value={mapFullName}
                    onChange={(e) => setMapFullName(e.target.value)}
                    style={{ padding: 8, borderRadius: 6, border: '1px solid #cbd5e1' }}
                  >
                    <option value="">— Choisir —</option>
                    {colOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem', color: '#475569' }}>
                  Courriel
                  <select
                    value={mapEmail}
                    onChange={(e) => setMapEmail(e.target.value)}
                    style={{ padding: 8, borderRadius: 6, border: '1px solid #cbd5e1' }}
                  >
                    <option value="">— Ignorer —</option>
                    {colOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem', color: '#475569' }}>
                  Téléphone
                  <select
                    value={mapPhone}
                    onChange={(e) => setMapPhone(e.target.value)}
                    style={{ padding: 8, borderRadius: 6, border: '1px solid #cbd5e1' }}
                  >
                    <option value="">— Ignorer —</option>
                    {colOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem', color: '#475569' }}>
                  Notes
                  <select
                    value={mapNotes}
                    onChange={(e) => setMapNotes(e.target.value)}
                    style={{ padding: 8, borderRadius: 6, border: '1px solid #cbd5e1' }}
                  >
                    <option value="">— Ignorer —</option>
                    {colOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <p style={{ fontSize: '0.8rem', color: '#64748b', margin: '0 0 8px' }}>
                Aperçu ({dataRows.length} ligne(s) à importer, montre les 10 premières)
              </p>
              <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: 8, marginBottom: 10 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                  <tbody>
                    {previewRows.map((row, ri) => (
                      <tr key={ri}>
                        {row.map((cell, ci) => (
                          <td
                            key={ci}
                            style={{ borderBottom: '1px solid #f1f5f9', padding: '6px 8px', color: '#334155' }}
                          >
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <button
                type="button"
                disabled={importing || dataRows.length === 0}
                onClick={handleImportCsv}
                style={{
                  padding: '8px 16px',
                  borderRadius: 8,
                  border: 'none',
                  background: '#2563eb',
                  color: 'white',
                  fontWeight: 600,
                  cursor: importing ? 'not-allowed' : 'pointer',
                  opacity: importing ? 0.7 : 1,
                }}
              >
                {importing ? 'Import…' : 'Importer dans le carnet'}
              </button>
            </>
          )}

          <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid #e2e8f0' }}>
            <h3 style={{ margin: '0 0 8px', fontSize: '0.95rem', color: '#1e293b' }}>Ou coller plusieurs lignes</h3>
            <p style={{ fontSize: '0.78rem', color: '#64748b', margin: '0 0 6px' }}>
              Une ligne par client, champs séparés par une virgule ou une tabulation : nom, courriel, téléphone, notes…
            </p>
            <textarea
              value={pasteBulk}
              onChange={(e) => setPasteBulk(e.target.value)}
              rows={5}
              placeholder={'Jean Tremblay, jean@exemple.com, 418-555-0101\nMarie Dupont\tmarie@…'}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: 10,
                borderRadius: 8,
                border: '1px solid #cbd5e1',
                fontSize: '0.85rem',
                marginBottom: 8,
              }}
            />
            <button
              type="button"
              disabled={importing || !pasteBulk.trim()}
              onClick={handlePasteImport}
              style={{
                padding: '6px 14px',
                borderRadius: 8,
                border: '1px solid #059669',
                background: 'white',
                color: '#059669',
                fontWeight: 600,
                cursor: importing || !pasteBulk.trim() ? 'not-allowed' : 'pointer',
              }}
            >
              Ajouter ces lignes
            </button>
          </div>

          {importErrors.length > 0 && (
            <div style={{ marginTop: 12, padding: 10, background: '#fff7ed', borderRadius: 8, fontSize: '0.8rem' }}>
              <strong style={{ color: '#9a3412' }}>Lignes non importées :</strong>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {importErrors.slice(0, 15).map((err) => (
                  <li key={`${err.row}-${err.message}`}>
                    Ligne {err.row} : {err.message}
                  </li>
                ))}
              </ul>
              {importErrors.length > 15 && <p>… et {importErrors.length - 15} autre(s)</p>}
            </div>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ marginBottom: 20, padding: 14, background: '#f8fafc', borderRadius: 10 }}>
        <h3 style={{ margin: '0 0 10px', fontSize: '0.95rem' }}>{editingId ? 'Modifier le client' : 'Nouveau client'}</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
          <input
            required
            placeholder="Nom complet *"
            value={form.fullName}
            onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
            style={{ padding: 8, borderRadius: 6, border: '1px solid #cbd5e1' }}
          />
          <input
            type="email"
            placeholder="Courriel"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            style={{ padding: 8, borderRadius: 6, border: '1px solid #cbd5e1' }}
          />
          <input
            placeholder="Téléphone"
            value={form.phone}
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            style={{ padding: 8, borderRadius: 6, border: '1px solid #cbd5e1' }}
          />
          <input
            placeholder="Notes"
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            style={{ padding: 8, borderRadius: 6, border: '1px solid #cbd5e1', gridColumn: '1 / -1' }}
          />
        </div>
        <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
          <button
            type="submit"
            disabled={saving}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              border: 'none',
              background: '#059669',
              color: 'white',
              fontWeight: 600,
              cursor: saving ? 'not-allowed' : 'pointer',
            }}
          >
            {saving ? '…' : editingId ? 'Enregistrer' : 'Ajouter'}
          </button>
          {editingId && (
            <button
              type="button"
              onClick={() => {
                setEditingId(null);
                setForm(EMPTY_FORM);
              }}
              style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #cbd5e1', background: 'white' }}
            >
              Annuler
            </button>
          )}
        </div>
      </form>

      {loading ? (
        <p style={{ color: '#64748b' }}>Chargement…</p>
      ) : clients.length === 0 ? (
        <p style={{ color: '#64748b', fontSize: '0.9rem' }}>Aucun client pour l’instant.</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {clients.map((c) => (
            <li
              key={c.id}
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
                padding: '10px 12px',
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                background: '#fff',
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, color: '#1f2937' }}>{c.full_name}</div>
                <div style={{ fontSize: '0.82rem', color: '#64748b' }}>
                  {[c.email, c.phone].filter(Boolean).join(' · ')}
                  {c.notes ? ` — ${c.notes}` : ''}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  onClick={() => startEdit(c)}
                  style={{
                    fontSize: '0.8rem',
                    padding: '4px 10px',
                    borderRadius: 6,
                    border: '1px solid #93c5fd',
                    background: '#eff6ff',
                    color: '#1d4ed8',
                    cursor: 'pointer',
                  }}
                >
                  Modifier
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteId(c.id)}
                  style={{
                    fontSize: '0.8rem',
                    padding: '4px 10px',
                    borderRadius: 6,
                    border: '1px solid #fecaca',
                    background: '#fef2f2',
                    color: '#b91c1c',
                    cursor: 'pointer',
                  }}
                >
                  Retirer
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {deleteId && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15,23,42,0.35)',
            zIndex: 10000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={() => setDeleteId(null)}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            style={{ background: 'white', borderRadius: 12, padding: 20, maxWidth: 360 }}
            onClick={(e) => e.stopPropagation()}
          >
            <p style={{ margin: '0 0 12px', fontWeight: 600 }}>Retirer ce client du carnet ?</p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setDeleteId(null)} style={{ padding: '6px 12px' }}>
                Annuler
              </button>
              <button
                type="button"
                onClick={() => handleDelete(deleteId)}
                style={{ padding: '6px 12px', background: '#dc2626', color: 'white', border: 'none', borderRadius: 6 }}
              >
                Confirmer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
