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
    <div className="guide-section guide-card esbl-card">
      <h2 className="guide-section-title esbl-card-title">
        Carnet clients
      </h2>
      <p className="esbl-card-subtitle">
        Reprenez votre liste depuis un fichier ou ajoutez à la main. Les clients ici sont privés à votre établissement.
      </p>

      {error && (
        <div className="esbl-alert esbl-alert--error">
          {error}
        </div>
      )}

      <div className="esbl-toolbar">
        <div className="esbl-toolbar-left">
          <input
            type="search"
            placeholder="Rechercher par nom, courriel ou téléphone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="esbl-input"
          />
        </div>
        <div className="esbl-toolbar-actions">
          <button
            type="button"
            onClick={() => setImportOpen((v) => !v)}
            className={`esbl-btn ${importOpen ? 'esbl-btn--primary' : 'esbl-btn--ghost'}`}
          >
            {importOpen ? 'Fermer l’import' : 'Importer (fichier ou collage)'}
          </button>
        </div>
      </div>

      {importOpen && (
        <div className="esbl-import-panel">
          <h3 className="esbl-form-title">Importer depuis un fichier CSV</h3>
          <p className="esbl-card-subtitle">
            Téléchargez le modèle, ouvrez-le dans Excel / LibreOffice, puis enregistrez en CSV. Colonnes possibles : nom,
            courriel, téléphone, notes.
          </p>
          <div className="esbl-toolbar-actions" style={{ marginBottom: 12 }}>
            <button
              type="button"
              onClick={downloadTemplate}
              className="esbl-btn esbl-btn--ghost"
            >
              Télécharger le modèle CSV
            </button>
            <label className="esbl-btn esbl-btn--primary">
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

              <div className="esbl-import-grid">
                <label className="esbl-form-stack" style={{ fontSize: '0.8rem', color: '#475569' }}>
                  Nom complet *
                  <select
                    value={mapFullName}
                    onChange={(e) => setMapFullName(e.target.value)}
                    className="esbl-input esbl-input--sm"
                  >
                    <option value="">— Choisir —</option>
                    {colOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="esbl-form-stack" style={{ fontSize: '0.8rem', color: '#475569' }}>
                  Courriel
                  <select
                    value={mapEmail}
                    onChange={(e) => setMapEmail(e.target.value)}
                    className="esbl-input esbl-input--sm"
                  >
                    <option value="">— Ignorer —</option>
                    {colOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="esbl-form-stack" style={{ fontSize: '0.8rem', color: '#475569' }}>
                  Téléphone
                  <select
                    value={mapPhone}
                    onChange={(e) => setMapPhone(e.target.value)}
                    className="esbl-input esbl-input--sm"
                  >
                    <option value="">— Ignorer —</option>
                    {colOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="esbl-form-stack" style={{ fontSize: '0.8rem', color: '#475569' }}>
                  Notes
                  <select
                    value={mapNotes}
                    onChange={(e) => setMapNotes(e.target.value)}
                    className="esbl-input esbl-input--sm"
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
              <div style={{ overflowX: 'auto', border: '1px solid #efece4', borderRadius: 8, marginBottom: 10 }}>
                <table className="esbl-table">
                  <tbody>
                    {previewRows.map((row, ri) => (
                      <tr key={ri}>
                        {row.map((cell, ci) => (
                          <td
                            key={ci}
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
                className="esbl-btn esbl-btn--primary"
              >
                {importing ? 'Import…' : 'Importer dans le carnet'}
              </button>
            </>
          )}

          <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid #efece4' }}>
            <h3 className="esbl-form-title">Ou coller plusieurs lignes</h3>
            <p style={{ fontSize: '0.78rem', color: '#64748b', margin: '0 0 6px' }}>
              Une ligne par client, champs séparés par une virgule ou une tabulation : nom, courriel, téléphone, notes…
            </p>
            <textarea
              value={pasteBulk}
              onChange={(e) => setPasteBulk(e.target.value)}
              rows={5}
              placeholder={'Jean Tremblay, jean@exemple.com, 418-555-0101\nMarie Dupont\tmarie@…'}
              className="esbl-input esbl-textarea"
            />
            <button
              type="button"
              disabled={importing || !pasteBulk.trim()}
              onClick={handlePasteImport}
              className="esbl-btn esbl-btn--ghost"
            >
              Ajouter ces lignes
            </button>
          </div>

          {importErrors.length > 0 && (
            <div style={{ marginTop: 12, padding: 10, background: '#fff5e6', borderRadius: 8, fontSize: '0.8rem' }}>
              <strong style={{ color: '#9a5b13' }}>Lignes non importées :</strong>
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

      <form onSubmit={handleSubmit} className="esbl-form-panel">
        <h3 className="esbl-form-title">{editingId ? 'Modifier le client' : 'Nouveau client'}</h3>
        <div className="esbl-form-grid-3">
          <input
            required
            placeholder="Nom complet *"
            value={form.fullName}
            onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
            className="esbl-input"
          />
          <input
            type="email"
            placeholder="Courriel"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            className="esbl-input"
          />
          <input
            placeholder="Téléphone"
            value={form.phone}
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            className="esbl-input"
          />
          <input
            placeholder="Notes"
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            className="esbl-input esbl-field--span-3"
          />
        </div>
        <div className="esbl-form-actions">
          <button
            type="submit"
            disabled={saving}
            className="esbl-btn esbl-btn--primary"
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
              className="esbl-btn esbl-btn--ghost"
            >
              Annuler
            </button>
          )}
        </div>
      </form>

      {loading ? (
        <p className="esbl-card-subtitle">Chargement…</p>
      ) : clients.length === 0 ? (
        <p className="esbl-card-subtitle">Aucun client pour l’instant.</p>
      ) : (
        <ul className="esbl-list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {clients.map((c) => (
            <li
              key={c.id}
              className="esbl-list-item"
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, color: '#1f2937' }}>{c.full_name}</div>
                <div className="esbl-list-meta">
                  {[c.email, c.phone].filter(Boolean).join(' · ')}
                  {c.notes ? ` — ${c.notes}` : ''}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  onClick={() => startEdit(c)}
                  className="esbl-btn esbl-btn--ghost esbl-btn--tiny"
                >
                  Modifier
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteId(c.id)}
                  className="esbl-btn esbl-btn--danger esbl-btn--tiny"
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
          className="esbl-modal-backdrop"
          onClick={() => setDeleteId(null)}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            className="esbl-modal-card"
            onClick={(e) => e.stopPropagation()}
          >
            <p style={{ margin: '0 0 12px', fontWeight: 600 }}>Retirer ce client du carnet ?</p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setDeleteId(null)} className="esbl-btn esbl-btn--ghost">
                Annuler
              </button>
              <button
                type="button"
                onClick={() => handleDelete(deleteId)}
                className="esbl-btn esbl-btn--danger"
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
