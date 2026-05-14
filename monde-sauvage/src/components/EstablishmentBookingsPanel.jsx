import { useCallback, useEffect, useMemo, useState } from 'react';
import { parseCsvRows } from '../utils/csvParse.js';
import { createEstablishmentManualBooking, importEstablishmentBookingsBatch } from '../utils/bookingService.js';
import { toast } from '../utils/toast.js';
import supabase from '../utils/supabase.js';

function parseDateCell(raw) {
  const s = String(raw ?? '').trim();
  if (!s) throw new Error('Date vide');
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (m) {
    const a = +m[1];
    const b = +m[2];
    const y = m[3];
    if (a > 12) return `${y}-${String(b).padStart(2, '0')}-${String(a).padStart(2, '0')}`;
    if (b > 12) return `${y}-${String(a).padStart(2, '0')}-${String(b).padStart(2, '0')}`;
    return `${y}-${String(b).padStart(2, '0')}-${String(a).padStart(2, '0')}`;
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new Error(`Date non reconnue : ${raw}`);
  return d.toISOString().slice(0, 10);
}

export default function EstablishmentBookingsPanel({ establishmentId, chalets }) {
  const chaletIds = useMemo(() => chalets.map((c) => c.key ?? c.id).filter(Boolean), [chalets]);
  const chaletByKey = useMemo(() => {
    const m = new Map();
    for (const c of chalets) {
      const k = c.key ?? c.id;
      if (k) m.set(String(k), c);
    }
    return m;
  }, [chalets]);

  const resolveChaletFromLabel = useCallback(
    (label) => {
      const t = String(label ?? '').trim();
      if (!t) return null;
      for (const c of chalets) {
        const k = c.key ?? c.id;
        const name = (c.Name || c.name || '').trim();
        if (k && String(k).toLowerCase() === t.toLowerCase()) return String(k);
        if (name && name.toLowerCase() === t.toLowerCase()) return String(k);
      }
      return null;
    },
    [chalets],
  );

  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [chaletId, setChaletId] = useState('');
  const [startYmd, setStartYmd] = useState('');
  const [endYmd, setEndYmd] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [skipOverlap, setSkipOverlap] = useState(false);
  const [saving, setSaving] = useState(false);

  const [importOpen, setImportOpen] = useState(false);
  const [csvRows, setCsvRows] = useState([]);
  const [headerRowIsLabels, setHeaderRowIsLabels] = useState(true);
  const [mapChalet, setMapChalet] = useState('');
  const [mapStart, setMapStart] = useState('');
  const [mapEnd, setMapEnd] = useState('');
  const [mapName, setMapName] = useState('');
  const [mapEmail, setMapEmail] = useState('');
  const [mapNotes, setMapNotes] = useState('');
  const [importing, setImporting] = useState(false);
  const [importErrors, setImportErrors] = useState([]);
  const [syncGoogleOnImport, setSyncGoogleOnImport] = useState(false);

  const load = useCallback(async () => {
    if (!establishmentId || chaletIds.length === 0) {
      setBookings([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data, error: qErr } = await supabase
        .from('bookings')
        .select('*')
        .in('chalet_id', chaletIds)
        .eq('booking_origin', 'establishment_manual')
        .order('start_date', { ascending: false })
        .limit(250);
      if (qErr) throw qErr;
      setBookings(data || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [establishmentId, chaletIds]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (chalets.length && !chaletId) {
      setChaletId(String(chalets[0].key ?? chalets[0].id));
    }
  }, [chalets, chaletId]);

  const headers = useMemo(() => {
    if (csvRows.length === 0) return [];
    return csvRows[0].map((c, i) => String(c || '').trim() || `Colonne ${i + 1}`);
  }, [csvRows]);

  const dataRows = useMemo(() => {
    if (csvRows.length <= 1) return [];
    return headerRowIsLabels ? csvRows.slice(1) : csvRows;
  }, [csvRows, headerRowIsLabels]);

  const colOptions = useMemo(() => {
    if (csvRows.length === 0) return [];
    const maxCols = Math.max(...csvRows.map((r) => r.length));
    return Array.from({ length: maxCols }, (_, i) => ({
      value: String(i),
      label: headers[i] || `Colonne ${i + 1}`,
    }));
  }, [csvRows, headers]);

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const rows = parseCsvRows(String(reader.result || ''));
      setCsvRows(rows);
      setHeaderRowIsLabels(true);
      setImportErrors([]);
      if (rows.length > 0) {
        const r0 = rows[0].map((x) => String(x || '').toLowerCase());
        const idx = (subs) =>
          r0.findIndex((h) => subs.some((s) => h.includes(s)));
        const iCh = idx(['chalet', 'nom du chalet', 'unit']);
        const iSt = idx(['arriv', 'debut', 'start', 'check']);
        const iEn = idx(['depart', 'fin', 'end']);
        const iNm = idx(['nom', 'client', 'name']);
        const iEm = idx(['email', 'courriel', 'mail']);
        const iNo = idx(['note', 'comment']);
        setMapChalet(iCh >= 0 ? String(iCh) : '');
        setMapStart(iSt >= 0 ? String(iSt) : '');
        setMapEnd(iEn >= 0 ? String(iEn) : '');
        setMapName(iNm >= 0 ? String(iNm) : '');
        setMapEmail(iEm >= 0 ? String(iEm) : '');
        setMapNotes(iNo >= 0 ? String(iNo) : '');
      }
    };
    reader.readAsText(file, 'UTF-8');
    e.target.value = '';
  };

  const downloadTemplate = () => {
    const bom = '\uFEFF';
    const line =
      'chalet_nom,date_arrivee,date_depart,nom_client,courriel,notes\n' +
      'Mon chalet (nom affiché),2026-06-01,2026-06-08,Jean Tremblay,jean@exemple.com,Ancien logiciel\n';
    const blob = new Blob([bom + line], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = globalThis.document.createElement('a');
    a.href = url;
    a.download = 'modele-reservations-pourvoirie.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const buildImportRows = () => {
    const ic = mapChalet === '' ? -1 : Number.parseInt(mapChalet, 10);
    const is = mapStart === '' ? -1 : Number.parseInt(mapStart, 10);
    const ie = mapEnd === '' ? -1 : Number.parseInt(mapEnd, 10);
    const inm = mapName === '' ? -1 : Number.parseInt(mapName, 10);
    const iem = mapEmail === '' ? -1 : Number.parseInt(mapEmail, 10);
    const ino = mapNotes === '' ? -1 : Number.parseInt(mapNotes, 10);

    if (Number.isNaN(ic) || ic < 0) throw new Error('Choisissez la colonne du chalet.');
    if (Number.isNaN(is) || is < 0) throw new Error('Choisissez la colonne de la date d’arrivée.');
    if (Number.isNaN(ie) || ie < 0) throw new Error('Choisissez la colonne de la date de départ.');
    if (Number.isNaN(inm) || inm < 0) throw new Error('Choisissez la colonne du nom du client.');

    const out = [];
    for (let r = 0; r < dataRows.length; r += 1) {
      const row = dataRows[r];
      const chLabel = row[ic] != null ? String(row[ic]).trim() : '';
      let startY;
      let endY;
      try {
        startY = parseDateCell(row[is]);
        endY = parseDateCell(row[ie]);
      } catch (err) {
        throw new Error(`Ligne ${r + 1}: ${err.message}`);
      }
      const nm = row[inm] != null ? String(row[inm]).trim() : '';
      const em = iem >= 0 && row[iem] != null ? String(row[iem]).trim() : '';
      const no = ino >= 0 && row[ino] != null ? String(row[ino]).trim() : '';
      out.push({
        chaletLabel: chLabel,
        startDateYmd: startY,
        endDateYmd: endY,
        customerName: nm,
        customerEmail: em,
        notes: no,
      });
    }
    return out;
  };

  const handleImport = async () => {
    let parsed;
    try {
      parsed = buildImportRows();
    } catch (err) {
      toast.error(err.message);
      return;
    }
    setImporting(true);
    setImportErrors([]);
    try {
      const { inserted, errors } = await importEstablishmentBookingsBatch(
        parsed,
        (row) => resolveChaletFromLabel(row.chaletLabel),
        { syncToGoogle: syncGoogleOnImport },
      );
      setImportErrors(errors);
      toast.success(`${inserted} réservation(s) importée(s).`);
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

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!chaletId) {
      toast.error('Choisissez un chalet.');
      return;
    }
    setSaving(true);
    try {
      const { googleSync } = await createEstablishmentManualBooking({
        chaletId,
        startDateYmd: startYmd,
        endDateYmd: endYmd,
        customerName,
        customerEmail,
        notes,
        skipOverlapCheck: skipOverlap,
        syncToGoogle: true,
        source: skipOverlap ? 'migration' : 'manual',
      });
      if (googleSync?.ok) {
        toast.success('Réservation enregistrée et visible dans Google Agenda (sous-agenda du chalet).');
      } else {
        toast.success('Réservation enregistrée dans Monde Sauvage.');
        if (googleSync?.skipped === 'no_chalet_calendar') {
          toast.show(
            'Aucun agenda Google n’est lié à ce chalet : l’événement n’apparaît pas dans Google. Connectez Google (onglet Calendrier) puis créez l’agenda du chalet dans l’onglet Chalets.',
            { type: 'info', duration: 10000 },
          );
        } else if (googleSync && !googleSync.ok && googleSync.error) {
          toast.show(
            `Google Agenda : ${googleSync.error}${googleSync.requiresAuth ? ' — reconnectez Google dans l’onglet Calendrier.' : ''}`,
            { type: 'info', duration: 9000 },
          );
        }
      }
      setCustomerName('');
      setCustomerEmail('');
      setNotes('');
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleCancelBooking = async (id) => {
    if (!globalThis.confirm('Annuler cette réservation ?')) return;
    try {
      const { error } = await supabase.from('bookings').update({ status: 'cancelled' }).eq('id', id);
      if (error) throw error;
      toast.success('Réservation annulée.');
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const previewRows = dataRows.slice(0, 8);

  return (
    <div
      className="guide-section guide-card"
      style={{
        border: '1px solid #e2e8f0',
        borderRadius: 12,
        background: 'white',
        padding: 20,
      }}
    >
      <h2 className="guide-section-title" style={{ padding: 0, marginBottom: 8 }}>
        Réservations (migration)
      </h2>
      <p style={{ color: '#64748b', fontSize: '0.92rem', margin: '0 0 16px' }}>
        Créez des séjours venant de votre ancien système ou saisissez-les une par une. Aucune commission Monde Sauvage sur ces entrées. Les dates evitent les
        doublons avec les réservations déjà confirmées ; cochez « Ignorer les conflits » seulement pour un import de masse ou si vous assumez le chevauchement.
        Pour voir le séjour dans <strong>Google Agenda</strong>, le chalet doit avoir un sous-agenda créé (connexion Google dans l’onglet Calendrier / création de
        chalet).
      </p>

      {error && (
        <div
          style={{
            padding: 12,
            background: '#fee2e2',
            color: '#991b1b',
            borderRadius: 8,
            marginBottom: 12,
            fontSize: '0.9rem',
          }}
        >
          {error}
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        style={{
          marginBottom: 22,
          padding: 16,
          background: '#f8fafc',
          borderRadius: 10,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <h3 style={{ margin: 0, fontSize: '1rem' }}>Nouvelle réservation</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.82rem', color: '#475569' }}>
            Chalet
            <select
              value={chaletId}
              onChange={(e) => setChaletId(e.target.value)}
              style={{ padding: 8, borderRadius: 6, border: '1px solid #cbd5e1' }}
            >
              {chalets.map((c) => (
                <option key={c.key ?? c.id} value={String(c.key ?? c.id)}>
                  {c.Name || c.name || 'Chalet'}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.82rem', color: '#475569' }}>
            Arrivée (AAAA-MM-JJ)
            <input
              type="date"
              required
              value={startYmd}
              onChange={(e) => setStartYmd(e.target.value)}
              style={{ padding: 8, borderRadius: 6, border: '1px solid #cbd5e1' }}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.82rem', color: '#475569' }}>
            Départ (jour de libération)
            <input
              type="date"
              required
              value={endYmd}
              onChange={(e) => setEndYmd(e.target.value)}
              style={{ padding: 8, borderRadius: 6, border: '1px solid #cbd5e1' }}
            />
          </label>
          <input
            placeholder="Nom du client *"
            required
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            style={{ padding: 8, borderRadius: 6, border: '1px solid #cbd5e1' }}
          />
          <input
            type="email"
            placeholder="Courriel"
            value={customerEmail}
            onChange={(e) => setCustomerEmail(e.target.value)}
            style={{ padding: 8, borderRadius: 6, border: '1px solid #cbd5e1' }}
          />
          <input
            placeholder="Notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            style={{ padding: 8, borderRadius: 6, border: '1px solid #cbd5e1', gridColumn: '1 / -1' }}
          />
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', cursor: 'pointer' }}>
          <input type="checkbox" checked={skipOverlap} onChange={(e) => setSkipOverlap(e.target.checked)} />
          Ignorer la vérification de disponibilité (import / chevauchement assumé)
        </label>
        <button
          type="submit"
          disabled={saving || chalets.length === 0}
          style={{
            alignSelf: 'flex-start',
            padding: '10px 18px',
            borderRadius: 8,
            border: 'none',
            background: '#059669',
            color: 'white',
            fontWeight: 600,
            cursor: saving ? 'not-allowed' : 'pointer',
          }}
        >
          {saving ? '…' : 'Créer la réservation'}
        </button>
      </form>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 14, alignItems: 'center' }}>
        <button
          type="button"
          onClick={() => setImportOpen((v) => !v)}
          style={{
            padding: '8px 14px',
            borderRadius: 8,
            border: '1px solid #6366f1',
            background: importOpen ? '#e0e7ff' : 'white',
            color: '#4338ca',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {importOpen ? 'Fermer import CSV' : 'Importer un fichier CSV'}
        </button>
      </div>

      {importOpen && (
        <div
          style={{
            marginBottom: 20,
            padding: 16,
            borderRadius: 10,
            border: '1px dashed #a5b4fc',
            background: '#f5f3ff',
          }}
        >
          <p style={{ fontSize: '0.85rem', color: '#4338ca', margin: '0 0 12px' }}>
            Colonne chalet : utilisez le <strong>même nom</strong> que dans l’onglet Chalets (ou l’identifiant UUID du chalet).
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            <button
              type="button"
              onClick={downloadTemplate}
              style={{
                padding: '6px 12px',
                borderRadius: 6,
                border: '1px solid #6366f1',
                background: 'white',
                cursor: 'pointer',
              }}
            >
              Télécharger le modèle CSV
            </button>
            <label
              style={{
                padding: '6px 12px',
                borderRadius: 6,
                background: '#4f46e5',
                color: 'white',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Choisir un fichier…
              <input type="file" accept=".csv,.txt" style={{ display: 'none' }} onChange={handleFile} />
            </label>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.82rem', marginBottom: 10 }}>
            <input
              type="checkbox"
              checked={syncGoogleOnImport}
              onChange={(e) => setSyncGoogleOnImport(e.target.checked)}
            />
            Après import, créer aussi les événements Google Agenda (plus lent, centaines de lignes déconseillé)
          </label>

          {csvRows.length > 0 && (
            <>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', marginBottom: 10 }}>
                <input
                  type="checkbox"
                  checked={headerRowIsLabels}
                  onChange={(e) => setHeaderRowIsLabels(e.target.checked)}
                />
                Première ligne = titres des colonnes
              </label>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                  gap: 10,
                  marginBottom: 12,
                }}
              >
                {[
                  ['Chalet', mapChalet, setMapChalet],
                  ['Date arrivée', mapStart, setMapStart],
                  ['Date départ', mapEnd, setMapEnd],
                  ['Nom client', mapName, setMapName],
                  ['Courriel', mapEmail, setMapEmail],
                  ['Notes', mapNotes, setMapNotes],
                ].map(([label, val, setVal]) => (
                  <label
                    key={label}
                    style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.78rem', color: '#475569' }}
                  >
                    {label}
                    <select
                      value={val}
                      onChange={(e) => setVal(e.target.value)}
                      style={{ padding: 6, borderRadius: 6, border: '1px solid #cbd5e1' }}
                    >
                      <option value="">—</option>
                      {colOptions.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <p style={{ fontSize: '0.78rem', color: '#64748b' }}>Aperçu ({dataRows.length} lignes)</p>
              <div style={{ overflowX: 'auto', border: '1px solid #e9d5ff', borderRadius: 8, marginBottom: 10 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
                  <tbody>
                    {previewRows.map((row, ri) => (
                      <tr key={ri}>
                        {row.map((cell, ci) => (
                          <td key={ci} style={{ borderBottom: '1px solid #f3e8ff', padding: '4px 6px' }}>
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
                onClick={handleImport}
                style={{
                  padding: '8px 16px',
                  borderRadius: 8,
                  border: 'none',
                  background: '#4f46e5',
                  color: 'white',
                  fontWeight: 600,
                  cursor: importing ? 'not-allowed' : 'pointer',
                }}
              >
                {importing ? 'Import…' : 'Importer'}
              </button>
              {importErrors.length > 0 && (
                <div style={{ marginTop: 12, fontSize: '0.8rem', color: '#9a3412' }}>
                  <strong>Lignes en erreur :</strong>
                  <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                    {importErrors.slice(0, 20).map((er) => (
                      <li key={`${er.row}-${er.message}`}>
                        Ligne {er.row}: {er.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      )}

      <h3 style={{ fontSize: '1rem', margin: '16px 0 10px' }}>Réservations saisies pour ce lieu</h3>
      {loading ? (
        <p style={{ color: '#64748b' }}>Chargement…</p>
      ) : bookings.length === 0 ? (
        <p style={{ color: '#64748b', fontSize: '0.9rem' }}>Aucune réservation « pourvoyeur » pour l’instant.</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {bookings.map((b) => {
            const ch = chaletByKey.get(String(b.chalet_id));
            const chName = ch?.Name || ch?.name || 'Chalet';
            const start = b.start_date ? new Date(b.start_date).toLocaleDateString('fr-CA') : '';
            const end = b.end_date ? new Date(b.end_date).toLocaleDateString('fr-CA') : '';
            return (
              <li
                key={b.id}
                style={{
                  padding: '10px 12px',
                  border: '1px solid #e5e7eb',
                  borderRadius: 8,
                  display: 'flex',
                  flexWrap: 'wrap',
                  justifyContent: 'space-between',
                  gap: 8,
                  alignItems: 'center',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600 }}>
                    {chName} — {b.customer_name || 'Client'}
                  </div>
                  <div style={{ fontSize: '0.82rem', color: '#64748b' }}>
                    {start} → {end}
                    {b.customer_email ? ` · ${b.customer_email}` : ''}
                    {b.status === 'cancelled' ? ' · annulée' : ''}
                  </div>
                </div>
                {b.status !== 'cancelled' && (
                  <button
                    type="button"
                    onClick={() => handleCancelBooking(b.id)}
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
                    Annuler
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
