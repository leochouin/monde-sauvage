import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useEstablishment } from '../../components/layout/EstablishmentLayout.jsx';
import supabase from '../../utils/supabase.js';
import './establishment-dashboard.css';

const EMPTY_FORM = { name: '', adresse: '', telephone: '', email: '' };

// Maps an Etablissement row → the editable form shape (handles both the
// capitalised columns and the legacy lowercase fallbacks).
const toForm = (estab) => ({
  name: estab?.Name ?? estab?.name ?? '',
  adresse: estab?.Description ?? estab?.adresse ?? '',
  telephone: estab?.telephone ?? '',
  email: estab?.email ?? '',
});

const labelStyle = { display: 'block', fontWeight: 600, color: '#334155', marginBottom: 6 };
const fieldStyle = { marginBottom: 14 };

export default function Parametres() {
  const {
    establishments,
    selectedEstablishment,
    setSelectedEstablishment,
    loading,
    refresh,
  } = useEstablishment();

  const [editForm, setEditForm] = useState(EMPTY_FORM);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState(null);
  const [editNotice, setEditNotice] = useState(null);

  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState(EMPTY_FORM);
  const [savingCreate, setSavingCreate] = useState(false);
  const [createError, setCreateError] = useState(null);

  const [deleting, setDeleting] = useState(false);

  const location = useLocation();

  // Sync the edit form whenever the selected establishment changes.
  useEffect(() => {
    setEditForm(toForm(selectedEstablishment));
    setEditError(null);
    setEditNotice(null);
  }, [selectedEstablishment?.key ?? selectedEstablishment?.id]);

  // If there's no establishment at all, default to showing the create form.
  useEffect(() => {
    if (!loading && establishments.length === 0) setShowCreate(true);
  }, [loading, establishments.length]);

  // Opened from the header switcher's "+ Ajouter un établissement" action.
  useEffect(() => {
    if (location.state?.createNew) setShowCreate(true);
  }, [location.state]);

  const handleEditChange = (e) => {
    const { name, value } = e.target;
    setEditForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleCreateChange = (e) => {
    const { name, value } = e.target;
    setCreateForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSaveEdit = async (e) => {
    e.preventDefault();
    if (!selectedEstablishment) return;
    setSavingEdit(true);
    setEditError(null);
    setEditNotice(null);
    try {
      const key = selectedEstablishment.key ?? selectedEstablishment.id;
      const { error } = await supabase
        .from('Etablissement')
        .update({
          Name: editForm.name,
          Description: editForm.adresse || '',
          telephone: editForm.telephone || null,
          email: editForm.email || null,
        })
        .eq('key', key);
      if (error) throw error;
      setEditNotice('Modifications enregistrées.');
      await refresh();
    } catch (err) {
      console.error('Error updating establishment:', err);
      setEditError(`Erreur lors de la modification : ${err.message || 'Erreur inconnue'}`);
    } finally {
      setSavingEdit(false);
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setSavingCreate(true);
    setCreateError(null);
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) throw new Error('Vous devez être connecté.');

      const basePayload = {
        Name: createForm.name,
        Description: createForm.adresse || '',
        telephone: createForm.telephone || null,
        email: createForm.email || null,
      };

      // Environments differ on owner column / table casing, so try safe
      // variants and keep the first successful insert (same as legacy modal).
      const insertAttempts = [
        { table: 'Etablissement', payload: { ...basePayload, owner_id: user.id } },
        { table: 'Etablissement', payload: { ...basePayload, ownerId: user.id } },
        { table: 'Etablissement', payload: { ...basePayload } },
        { table: 'etablissement', payload: { ...basePayload, owner_id: user.id } },
        { table: 'etablissement', payload: { ...basePayload, ownerId: user.id } },
        { table: 'etablissement', payload: { ...basePayload } },
      ];

      let data = null;
      let insertError = null;
      let preferredInsertError = null;

      for (const attempt of insertAttempts) {
        const response = await supabase.from(attempt.table).insert([attempt.payload]).select();
        if (!response.error) {
          data = response.data;
          insertError = null;
          break;
        }
        insertError = response.error;
        const msg = String(response.error?.message || '').toLowerCase();
        const isMissingLowercaseTable =
          msg.includes("could not find the table 'public.etablissement'") || msg.includes('schema cache');
        if (!isMissingLowercaseTable && !preferredInsertError) {
          preferredInsertError = response.error;
        }
      }

      if (insertError) throw (preferredInsertError || insertError);

      setCreateForm(EMPTY_FORM);
      setShowCreate(false);
      await refresh();
      if (data && data.length > 0) setSelectedEstablishment(data[0]);
    } catch (err) {
      console.error('Error creating establishment:', err);
      setCreateError(`Erreur lors de la création : ${err.message || 'Erreur inconnue'}`);
    } finally {
      setSavingCreate(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedEstablishment) return;
    const name = selectedEstablishment.Name ?? selectedEstablishment.name ?? 'cet établissement';
    const confirmMessage =
      `Êtes-vous sûr de vouloir supprimer "${name}" ?\n\n`
      + 'Cette action supprimera également tous les chalets associés et ne peut pas être annulée.';
    if (!globalThis.confirm(confirmMessage)) return;

    setDeleting(true);
    setEditError(null);
    try {
      const key = selectedEstablishment.key ?? selectedEstablishment.id;
      const { error } = await supabase.from('Etablissement').delete().eq('key', key);
      if (error) throw error;
      setSelectedEstablishment(null);
      await refresh();
    } catch (err) {
      console.error('Error deleting establishment:', err);
      setEditError(`Erreur lors de la suppression : ${err.message || 'Erreur inconnue'}`);
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="esbl-loading-state">
        <span style={{ fontSize: '2rem' }}>⚙️</span>
        <p style={{ margin: 0 }}>Chargement…</p>
      </div>
    );
  }

  const renderFields = (form, onChange, idPrefix) => (
    <>
      <div style={fieldStyle}>
        <label htmlFor={`${idPrefix}-name`} style={labelStyle}>Nom de l'établissement *</label>
        <input
          id={`${idPrefix}-name`}
          name="name"
          className="esbl-input"
          value={form.name}
          onChange={onChange}
          placeholder="Pourvoirie du Lac…"
          required
        />
      </div>
      <div className="esbl-form-grid">
        <div style={fieldStyle}>
          <label htmlFor={`${idPrefix}-telephone`} style={labelStyle}>Téléphone</label>
          <input
            id={`${idPrefix}-telephone`}
            name="telephone"
            className="esbl-input"
            value={form.telephone}
            onChange={onChange}
            placeholder="418 555-0123"
          />
        </div>
        <div style={fieldStyle}>
          <label htmlFor={`${idPrefix}-email`} style={labelStyle}>Courriel</label>
          <input
            id={`${idPrefix}-email`}
            name="email"
            type="email"
            className="esbl-input"
            value={form.email}
            onChange={onChange}
            placeholder="contact@exemple.com"
          />
        </div>
      </div>
      <div style={fieldStyle}>
        <label htmlFor={`${idPrefix}-adresse`} style={labelStyle}>Description / Adresse</label>
        <textarea
          id={`${idPrefix}-adresse`}
          name="adresse"
          className="esbl-input esbl-textarea"
          value={form.adresse}
          onChange={onChange}
          placeholder="Adresse, description du lieu…"
        />
      </div>
    </>
  );

  return (
    <div className="esbl-page">
      <div className="esbl-page-intro">
        <h1 className="esbl-page-title">⚙️ Paramètres</h1>
        <p className="esbl-page-subtitle">Gérez les informations de votre établissement.</p>
      </div>

      {/* ── Édition de l'établissement sélectionné ── */}
      {selectedEstablishment && (
        <div className="esbl-form-card" style={{ marginBottom: 18 }}>
          <h2 className="esbl-form-title">Informations de l'établissement</h2>
          {editError && <div className="esbl-alert esbl-alert--error" style={{ marginBottom: 14 }}>{editError}</div>}
          {editNotice && <div className="esbl-alert esbl-alert--info" style={{ marginBottom: 14 }}>{editNotice}</div>}
          <form onSubmit={handleSaveEdit}>
            {renderFields(editForm, handleEditChange, 'edit')}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 4 }}>
              <button type="submit" className="esbl-btn esbl-btn--primary" disabled={savingEdit}>
                {savingEdit ? 'Enregistrement…' : 'Enregistrer'}
              </button>
              <button
                type="button"
                className="esbl-btn esbl-btn--danger"
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? 'Suppression…' : 'Supprimer cet établissement'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Création d'un nouvel établissement ── */}
      <div className="esbl-form-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h2 className="esbl-form-title" style={{ margin: 0 }}>
            {establishments.length === 0 ? 'Créer votre premier établissement' : 'Ajouter un établissement'}
          </h2>
          {establishments.length > 0 && (
            <button
              type="button"
              className="esbl-btn esbl-btn--ghost"
              onClick={() => { setShowCreate((v) => !v); setCreateError(null); }}
            >
              {showCreate ? 'Annuler' : '+ Nouvel établissement'}
            </button>
          )}
        </div>

        {showCreate && (
          <form onSubmit={handleCreate} style={{ marginTop: 16 }}>
            {createError && <div className="esbl-alert esbl-alert--error" style={{ marginBottom: 14 }}>{createError}</div>}
            {renderFields(createForm, handleCreateChange, 'create')}
            <div style={{ marginTop: 4 }}>
              <button type="submit" className="esbl-btn esbl-btn--primary" disabled={savingCreate}>
                {savingCreate ? 'Création…' : 'Créer l\'établissement'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
