import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useEstablishment } from '../../components/layout/EstablishmentLayout.jsx';
import supabase from '../../utils/supabase.js';
import { toast } from '../../utils/toast.js';
import './establishment-dashboard.css';

const edgeFunctionHeaders = (accessToken) => ({
  'Content-Type': 'application/json',
  ...(import.meta.env.VITE_SUPABASE_ANON_KEY ? { apikey: import.meta.env.VITE_SUPABASE_ANON_KEY } : {}),
  ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
});

const isGoogleCalendarConnectionError = (statusCode, errorData) => {
  if (statusCode === 401 || errorData?.requiresAuth) return true;
  const txt = `${errorData?.error || ''} ${errorData?.message || ''}`.toLowerCase();
  return txt.includes('google') && (
    txt.includes('auth') || txt.includes('connect') || txt.includes('token') || txt.includes('expired')
  );
};

const fmtPrice = (val) => {
  if (val == null || val === '') return null;
  const n = Number(val);
  if (isNaN(n) || n === 0) return null;
  return `${n.toFixed(2)} $`;
};

export default function Equipments() {
  const navigate = useNavigate();
  const { selectedEstablishment, chalets, loading: ctxLoading } = useEstablishment();
  const estabKey = String(selectedEstablishment?.key ?? selectedEstablishment?.id ?? '');

  // ── Data ──────────────────────────────────────────────────────────────────
  const [equipmentKinds, setEquipmentKinds] = useState([]);
  const [inventoryUnits, setInventoryUnits] = useState([]);
  const [loadingInventory, setLoadingInventory] = useState(false);
  const [inventoryError, setInventoryError] = useState(null);

  // ── Async operation flags ─────────────────────────────────────────────────
  const [savingInventory, setSavingInventory] = useState(false);
  const [creatingUnitCalendarId, setCreatingUnitCalendarId] = useState(null);
  const [deactivatingUnitId, setDeactivatingUnitId] = useState(null);
  const [deactivatingKindId, setDeactivatingKindId] = useState(null);
  const [savingKindId, setSavingKindId] = useState(null);
  const [savingUnitId, setSavingUnitId] = useState(null);

  // ── Confirmation guards ────────────────────────────────────────────────────
  const [unitPendingDeactivate, setUnitPendingDeactivate] = useState(null);
  const [kindPendingDeactivate, setKindPendingDeactivate] = useState(null);

  // ── Inline-edit states ─────────────────────────────────────────────────────
  const [editingKindId, setEditingKindId] = useState(null);
  const [editKindForm, setEditKindForm] = useState({ label: '', addonPricePerStay: '', addonPricePerNight: '' });
  const [editingUnitId, setEditingUnitId] = useState(null);
  const [editUnitChaletId, setEditUnitChaletId] = useState('');

  // ── Create forms ───────────────────────────────────────────────────────────
  const [newKindForm, setNewKindForm] = useState({ slug: '', label: '', addonPricePerStay: '', addonPricePerNight: '' });
  const [newUnitForm, setNewUnitForm] = useState({ equipmentKindId: '', displayName: '', unitCode: '', chaletId: '' });

  // ── Helpers ────────────────────────────────────────────────────────────────
  const chaletLabelForId = (id) => {
    if (!id) return null;
    const row = chalets.find((c) => c.key === id || c.id === id);
    return row?.Name || null;
  };

  const unitsForKind = (kindId) =>
    [...inventoryUnits]
      .filter((u) => u.equipment_kind_id === kindId)
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.unit_code).localeCompare(String(b.unit_code)));

  // ── Fetch ──────────────────────────────────────────────────────────────────
  const fetchInventory = useCallback(async (silent = false) => {
    if (!estabKey) { setEquipmentKinds([]); setInventoryUnits([]); return; }
    try {
      if (!silent) setLoadingInventory(true);
      setInventoryError(null);

      const [kindsRes, unitsRes] = await Promise.all([
        supabase.from('equipment_kind').select('*').eq('establishment_id', estabKey).eq('is_active', true).order('label'),
        supabase
          .from('inventory_unit')
          .select('*, equipment_kind:equipment_kind_id(id, label, slug)')
          .eq('establishment_id', estabKey)
          .eq('is_active', true)
          .is('deleted_at', null)
          .order('sort_order')
          .order('unit_code'),
      ]);

      if (kindsRes.error) throw kindsRes.error;
      if (unitsRes.error) throw unitsRes.error;

      setEquipmentKinds(kindsRes.data ?? []);
      setInventoryUnits(unitsRes.data ?? []);

      if (!newUnitForm.equipmentKindId && kindsRes.data?.length > 0) {
        setNewUnitForm((prev) => ({ ...prev, equipmentKindId: kindsRes.data[0].id }));
      }
    } catch (err) {
      setInventoryError(err.message ?? "Erreur lors du chargement de l'inventaire.");
    } finally {
      if (!silent) setLoadingInventory(false);
    }
  }, [estabKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchInventory(); }, [fetchInventory]);

  // ── CRUD : Types d'équipements ─────────────────────────────────────────────
  const handleCreateKind = async (e) => {
    e?.preventDefault?.();
    const slug = newKindForm.slug.trim().toLowerCase();
    const label = newKindForm.label.trim();
    if (!slug || !label) { toast.error('Le code interne et le nom du type sont requis.'); return; }

    const metadata = {};
    if (newKindForm.addonPricePerStay !== '') metadata.addon_price_per_stay = Number(newKindForm.addonPricePerStay);
    if (newKindForm.addonPricePerNight !== '') metadata.addon_price_per_night = Number(newKindForm.addonPricePerNight);

    try {
      setSavingInventory(true);
      const { error } = await supabase.from('equipment_kind').insert({ establishment_id: estabKey, slug, label, metadata });
      if (error) throw error;
      toast.success('Type d\'équipement créé.');
      setNewKindForm({ slug: '', label: '', addonPricePerStay: '', addonPricePerNight: '' });
      await fetchInventory(true);
    } catch (err) {
      toast.error(err.message ?? "Impossible de créer le type d'équipement.");
    } finally {
      setSavingInventory(false);
    }
  };

  const startEditKind = (kind) => {
    setEditingKindId(kind.id);
    setEditKindForm({
      label: kind.label ?? '',
      addonPricePerStay: kind.metadata?.addon_price_per_stay ?? '',
      addonPricePerNight: kind.metadata?.addon_price_per_night ?? '',
    });
  };

  const handleUpdateKind = async (kindId) => {
    const label = editKindForm.label.trim();
    if (!label) { toast.error('Le nom du type est requis.'); return; }

    const metadata = {};
    if (editKindForm.addonPricePerStay !== '') metadata.addon_price_per_stay = Number(editKindForm.addonPricePerStay);
    if (editKindForm.addonPricePerNight !== '') metadata.addon_price_per_night = Number(editKindForm.addonPricePerNight);

    try {
      setSavingKindId(kindId);
      const { error } = await supabase
        .from('equipment_kind')
        .update({ label, metadata, updated_at: new Date().toISOString() })
        .eq('id', kindId);
      if (error) throw error;
      toast.success('Type mis à jour.');
      setEditingKindId(null);
      await fetchInventory(true);
    } catch (err) {
      toast.error(err.message ?? 'Impossible de mettre à jour le type.');
    } finally {
      setSavingKindId(null);
    }
  };

  const handleDeactivateKind = async () => {
    const kind = kindPendingDeactivate;
    if (!kind?.id) { setKindPendingDeactivate(null); return; }

    const unitCount = unitsForKind(kind.id).length;
    if (unitCount > 0) {
      toast.error(`Retirez d'abord les ${unitCount} unité(s) liée(s) à ce type.`);
      setKindPendingDeactivate(null);
      return;
    }

    try {
      setDeactivatingKindId(kind.id);
      const { error } = await supabase
        .from('equipment_kind')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('id', kind.id);
      if (error) throw error;
      toast.success('Type d\'équipement retiré.');
      setKindPendingDeactivate(null);
      await fetchInventory(true);
    } catch (err) {
      toast.error(err.message ?? 'Impossible de retirer ce type.');
    } finally {
      setDeactivatingKindId(null);
    }
  };

  // ── CRUD : Unités physiques ────────────────────────────────────────────────
  const handleCreateUnit = async (e) => {
    e?.preventDefault?.();
    const displayName = newUnitForm.displayName.trim();
    const unitCode = newUnitForm.unitCode.trim().toUpperCase();
    if (!newUnitForm.equipmentKindId || !displayName || !unitCode) {
      toast.error('Type, nom et code unité sont requis.'); return;
    }
    if (!selectedEstablishment?.google_calendar_id) {
      toast.error('Connectez Google Calendar (onglet Calendrier) avant d\'ajouter une unité avec agenda.');
      navigate('/dashboard/establishment/calendrier');
      return;
    }

    try {
      setSavingInventory(true);
      const session = (await supabase.auth.getSession()).data.session;
      const accessToken = session?.access_token;

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-inventory-calendar`,
        {
          method: 'POST',
          headers: edgeFunctionHeaders(accessToken),
          body: JSON.stringify({
            establishment_id: estabKey,
            equipment_kind_id: newUnitForm.equipmentKindId,
            display_name: displayName,
            unit_code: unitCode,
            chalet_id: newUnitForm.chaletId || null,
            calendar_name: displayName,
          }),
        }
      );

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (isGoogleCalendarConnectionError(res.status, payload)) {
          toast.error('Connectez Google Calendar dans l\'onglet Calendrier avant d\'ajouter une unité.');
          navigate('/dashboard/establishment/calendrier');
          return;
        }
        throw new Error(payload.error ?? payload.message ?? "Impossible d'ajouter l'unité.");
      }

      toast.success('Unité créée avec son agenda Google.');
      setNewUnitForm((prev) => ({ ...prev, displayName: '', unitCode: '' }));
      await fetchInventory(true);
    } catch (err) {
      toast.error(err.message ?? "Impossible d'ajouter l'unité.");
    } finally {
      setSavingInventory(false);
    }
  };

  const startEditUnitAssignment = (unit) => {
    setEditingUnitId(unit.id);
    setEditUnitChaletId(unit.chalet_id ?? '');
  };

  const handleUpdateUnitAssignment = async (unitId) => {
    try {
      setSavingUnitId(unitId);
      const { error } = await supabase
        .from('inventory_unit')
        .update({ chalet_id: editUnitChaletId || null, updated_at: new Date().toISOString() })
        .eq('id', unitId);
      if (error) throw error;
      toast.success('Assignation mise à jour.');
      setEditingUnitId(null);
      await fetchInventory(true);
    } catch (err) {
      toast.error(err.message ?? 'Impossible de mettre à jour l\'assignation.');
    } finally {
      setSavingUnitId(null);
    }
  };

  const handleCreateCalendarForUnit = async (unit) => {
    if (!unit?.id) return;
    try {
      setCreatingUnitCalendarId(unit.id);
      const session = (await supabase.auth.getSession()).data.session;
      const accessToken = session?.access_token;

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-inventory-calendar`,
        {
          method: 'POST',
          headers: edgeFunctionHeaders(accessToken),
          body: JSON.stringify({ inventory_unit_id: unit.id, calendar_name: unit.display_name }),
        }
      );
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (isGoogleCalendarConnectionError(res.status, payload)) {
          toast.error('Connectez Google Calendar avant de créer un agenda unité.');
          navigate('/dashboard/establishment/calendrier');
          return;
        }
        throw new Error(payload.error ?? payload.message ?? "Erreur de création d'agenda.");
      }
      toast.success(`Agenda créé pour ${unit.display_name}.`);
      await fetchInventory(true);
    } catch (err) {
      toast.error(err.message ?? "Impossible de créer l'agenda de cette unité.");
    } finally {
      setCreatingUnitCalendarId(null);
    }
  };

  const handleConfirmDeactivateUnit = async () => {
    const unit = unitPendingDeactivate;
    if (!unit?.id) { setUnitPendingDeactivate(null); return; }
    try {
      setDeactivatingUnitId(unit.id);
      const { error } = await supabase
        .from('inventory_unit')
        .update({ is_active: false, deleted_at: new Date().toISOString() })
        .eq('id', unit.id);
      if (error) throw error;
      toast.success('Unité retirée.');
      setUnitPendingDeactivate(null);
      await fetchInventory(true);
    } catch (err) {
      toast.error(err.message ?? 'Impossible de retirer cette unité.');
    } finally {
      setDeactivatingUnitId(null);
    }
  };

  // ── Guards ─────────────────────────────────────────────────────────────────
  if (ctxLoading) {
    return (
      <div className="esbl-loading-state">
        <span style={{ fontSize: '2rem' }}>🛶</span>
        <p style={{ margin: 0 }}>Chargement…</p>
      </div>
    );
  }

  if (!selectedEstablishment) {
    return (
      <div className="esbl-empty-state">
        <div style={{ fontSize: '3rem' }}>🛶</div>
        <p>Aucun établissement sélectionné.</p>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="esbl-page">
      <header className="esbl-page-header">
        <div>
          <p className="esbl-eyebrow">Inventaire</p>
          <h1 className="esbl-page-title">🛶 Inventaire & Add-ons</h1>
          <p className="esbl-page-subtitle">
            Gérez vos types d'équipements et chaque unité physique. Assignez chaque unité à un chalet ou à la réserve globale.
          </p>
        </div>
        <div className="esbl-header-actions">
          <span className="esbl-chip">{equipmentKinds.length} type(s)</span>
          <span className="esbl-chip">{inventoryUnits.length} unité(s)</span>
        </div>
      </header>

      {inventoryError && (
        <div className="esbl-alert esbl-alert--error">
          {inventoryError}
        </div>
      )}

      {/* ── Formulaires de création ── */}
      <div className="esbl-form-grid">
        {/* Nouveau type */}
        <form onSubmit={handleCreateKind} className="esbl-form-card">
          <h3 className="esbl-form-title">Nouveau type d'équipement</h3>
          <div className="esbl-form-stack">
            <input className="esbl-input" type="text" placeholder="Code interne (ex: chaloupe)" value={newKindForm.slug} onChange={(e) => setNewKindForm((p) => ({ ...p, slug: e.target.value }))} />
            <input className="esbl-input" type="text" placeholder="Nom affiché (ex: Chaloupe aluminium)" value={newKindForm.label} onChange={(e) => setNewKindForm((p) => ({ ...p, label: e.target.value }))} />
            <input className="esbl-input" type="number" step="0.01" min="0" placeholder="Prix add-on / séjour $ (optionnel)" value={newKindForm.addonPricePerStay} onChange={(e) => setNewKindForm((p) => ({ ...p, addonPricePerStay: e.target.value }))} />
            <input className="esbl-input" type="number" step="0.01" min="0" placeholder="Prix add-on / nuit $ (optionnel)" value={newKindForm.addonPricePerNight} onChange={(e) => setNewKindForm((p) => ({ ...p, addonPricePerNight: e.target.value }))} />
            <button type="submit" disabled={savingInventory} className="esbl-btn esbl-btn--primary">+ Ajouter type</button>
          </div>
        </form>

        {/* Nouvelle unité */}
        <form onSubmit={handleCreateUnit} className="esbl-form-card">
          <h3 className="esbl-form-title">Nouvelle unité physique</h3>
          <div className="esbl-form-stack">
            <select className="esbl-input" value={newUnitForm.equipmentKindId} onChange={(e) => setNewUnitForm((p) => ({ ...p, equipmentKindId: e.target.value }))}>
              <option value="">Sélectionner un type</option>
              {equipmentKinds.map((k) => <option key={k.id} value={k.id}>{k.label} ({k.slug})</option>)}
            </select>
            <input className="esbl-input" type="text" placeholder="Nom affiché (ex: Chaloupe #2)" value={newUnitForm.displayName} onChange={(e) => setNewUnitForm((p) => ({ ...p, displayName: e.target.value }))} />
            <input className="esbl-input" type="text" placeholder="Code unité (ex: BOAT-02)" value={newUnitForm.unitCode} onChange={(e) => setNewUnitForm((p) => ({ ...p, unitCode: e.target.value }))} />
            <select className="esbl-input" value={newUnitForm.chaletId} onChange={(e) => setNewUnitForm((p) => ({ ...p, chaletId: e.target.value }))}>
              <option value="">Réserve globale (tous les chalets)</option>
              {chalets.map((ch) => <option key={ch.key ?? ch.id} value={ch.key ?? ch.id}>Inclus avec : {ch.Name || `Chalet ${ch.key ?? ch.id}`}</option>)}
            </select>
            <button type="submit" disabled={savingInventory || equipmentKinds.length === 0} className="esbl-btn esbl-btn--emerald">
              + Ajouter unité (agenda Google)
            </button>
          </div>
        </form>
      </div>

      {/* ── Confirmation : retirer un type ── */}
      {kindPendingDeactivate && (
        <div className="esbl-confirm-banner">
          <p style={{ margin: 0, fontSize: '0.9rem', color: '#92400e' }}>
            Retirer le type <strong>{kindPendingDeactivate.label}</strong> ({kindPendingDeactivate.slug}) ? Cette action est irréversible.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => setKindPendingDeactivate(null)} className="esbl-btn esbl-btn--ghost">Annuler</button>
            <button type="button" onClick={handleDeactivateKind} disabled={!!deactivatingKindId} className="esbl-btn esbl-btn--danger">
              {deactivatingKindId === kindPendingDeactivate.id ? '…' : 'Confirmer la suppression'}
            </button>
          </div>
        </div>
      )}

      {/* ── Confirmation : retirer une unité ── */}
      {unitPendingDeactivate && (
        <div className="esbl-confirm-banner">
          <p style={{ margin: 0, fontSize: '0.9rem', color: '#92400e' }}>
            Retirer l'unité <strong>{unitPendingDeactivate.display_name}</strong> ({unitPendingDeactivate.unit_code}) ? Action irréversible.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => setUnitPendingDeactivate(null)} className="esbl-btn esbl-btn--ghost">Annuler</button>
            <button type="button" onClick={handleConfirmDeactivateUnit} disabled={!!deactivatingUnitId} className="esbl-btn esbl-btn--danger">
              {deactivatingUnitId ? '…' : 'Confirmer'}
            </button>
          </div>
        </div>
      )}

      {/* ── Types d'équipements — vue cartes ── */}
      <div className="esbl-section-card">
        <h3 className="esbl-section-title">
          Types d'équipements ({equipmentKinds.length})
        </h3>

        {equipmentKinds.length === 0 ? (
          <p style={{ color: '#64748b', margin: 0, fontSize: '0.9rem' }}>Aucun type d'équipement. Commencez par en créer un ci-dessus.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {equipmentKinds.map((kind) => {
              const units = unitsForKind(kind.id);
              const isEditing = editingKindId === kind.id;
              const isSaving = savingKindId === kind.id;
              const perStay = fmtPrice(kind.metadata?.addon_price_per_stay);
              const perNight = fmtPrice(kind.metadata?.addon_price_per_night);

              return (
                <div key={kind.id} className="esbl-kind-card">
                  {isEditing ? (
                    /* Mode édition inline */
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end' }}>
                      <div style={{ flex: '1 1 160px' }}>
                        <label style={{ fontSize: '0.75rem', color: '#64748b', display: 'block', marginBottom: 3 }}>Nom affiché</label>
                        <input className="esbl-input esbl-input--sm" type="text" value={editKindForm.label} onChange={(e) => setEditKindForm((p) => ({ ...p, label: e.target.value }))} />
                      </div>
                      <div style={{ flex: '1 1 120px' }}>
                        <label style={{ fontSize: '0.75rem', color: '#64748b', display: 'block', marginBottom: 3 }}>Prix / séjour $</label>
                        <input className="esbl-input esbl-input--sm" type="number" step="0.01" min="0" value={editKindForm.addonPricePerStay} onChange={(e) => setEditKindForm((p) => ({ ...p, addonPricePerStay: e.target.value }))} />
                      </div>
                      <div style={{ flex: '1 1 120px' }}>
                        <label style={{ fontSize: '0.75rem', color: '#64748b', display: 'block', marginBottom: 3 }}>Prix / nuit $</label>
                        <input className="esbl-input esbl-input--sm" type="number" step="0.01" min="0" value={editKindForm.addonPricePerNight} onChange={(e) => setEditKindForm((p) => ({ ...p, addonPricePerNight: e.target.value }))} />
                      </div>
                      <div style={{ display: 'flex', gap: 6, alignSelf: 'flex-end' }}>
                        <button type="button" onClick={() => handleUpdateKind(kind.id)} disabled={isSaving} className="esbl-btn esbl-btn--primary">{isSaving ? '…' : 'Sauvegarder'}</button>
                        <button type="button" onClick={() => setEditingKindId(null)} className="esbl-btn esbl-btn--ghost">Annuler</button>
                      </div>
                    </div>
                  ) : (
                    /* Mode affichage */
                    <div className="esbl-kind-header">
                      <div>
                        <span style={{ fontWeight: 700, color: '#1f2937', fontSize: '0.95rem' }}>{kind.label}</span>
                        <span style={{ marginLeft: 8, color: '#64748b', fontSize: '0.82rem' }}>({kind.slug})</span>
                        <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                          <span className="esbl-pill esbl-pill--accent">
                            {units.length} unité{units.length !== 1 ? 's' : ''}
                          </span>
                          {perStay && <span className="esbl-pill">{perStay} / séjour</span>}
                          {perNight && <span className="esbl-pill">{perNight} / nuit</span>}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button type="button" onClick={() => startEditKind(kind)} className="esbl-btn esbl-btn--ghost">Modifier</button>
                        <button type="button" onClick={() => setKindPendingDeactivate(kind)} className="esbl-btn esbl-btn--danger">Retirer</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Unités physiques — groupées par type ── */}
      <div className="esbl-section-card">
        <h3 className="esbl-section-title">
          Unités physiques ({inventoryUnits.length})
        </h3>

        {loadingInventory ? (
          <p style={{ color: '#64748b', margin: 0, fontSize: '0.9rem' }}>Chargement inventaire…</p>
        ) : inventoryUnits.length === 0 ? (
          <p style={{ color: '#64748b', margin: 0, fontSize: '0.9rem' }}>Aucune unité physique créée.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {equipmentKinds.map((kind) => {
              const units = unitsForKind(kind.id);
              if (units.length === 0) return null;
              return (
                <div key={kind.id}>
                  {/* En-tête du groupe */}
                  <div className="esbl-group-title">
                    {kind.label} · {units.length} unité{units.length !== 1 ? 's' : ''}
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {units.map((unit) => {
                      const assignedLabel = chaletLabelForId(unit.chalet_id);
                      const isEditingAssign = editingUnitId === unit.id;
                      const isSavingUnit = savingUnitId === unit.id;

                      return (
                        <div key={unit.id} className="esbl-unit-card">
                          {/* Infos unité */}
                          <div style={{ flex: 1, minWidth: 200 }}>
                            <div style={{ fontWeight: 600, color: '#1f2937', fontSize: '0.92rem' }}>
                              {unit.display_name}{' '}
                              <span style={{ color: '#64748b', fontWeight: 500, fontSize: '0.82rem' }}>({unit.unit_code})</span>
                            </div>

                            {/* Assignation — mode affichage ou édition inline */}
                            {isEditingAssign ? (
                              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
                                <select
                                  className="esbl-input esbl-input--sm"
                                  style={{ width: 'auto', flex: '1 1 180px' }}
                                  value={editUnitChaletId}
                                  onChange={(e) => setEditUnitChaletId(e.target.value)}
                                >
                                  <option value="">Réserve globale (tous les chalets)</option>
                                  {chalets.map((ch) => (
                                    <option key={ch.key ?? ch.id} value={ch.key ?? ch.id}>
                                      Inclus avec : {ch.Name || `Chalet ${ch.key ?? ch.id}`}
                                    </option>
                                  ))}
                                </select>
                                <button type="button" onClick={() => handleUpdateUnitAssignment(unit.id)} disabled={isSavingUnit} className="esbl-btn esbl-btn--primary">{isSavingUnit ? '…' : 'OK'}</button>
                                <button type="button" onClick={() => setEditingUnitId(null)} className="esbl-btn esbl-btn--ghost">✕</button>
                              </div>
                            ) : (
                              <div className="esbl-unit-meta">
                                {assignedLabel
                                  ? <span style={{ color: '#1d4ed8' }}>🏠 Inclus avec {assignedLabel}</span>
                                  : <span>🌐 Réserve globale</span>}
                                <button type="button" onClick={() => startEditUnitAssignment(unit)} className="esbl-btn esbl-btn--ghost esbl-btn--tiny">Changer</button>
                              </div>
                            )}

                            {/* Statut agenda Google */}
                            <div className="esbl-unit-status" style={{ color: unit.google_calendar_id ? '#065f46' : '#92400e' }}>
                              {unit.google_calendar_id
                                ? <span>📅 Agenda Google actif</span>
                                : <span>⚠ Sans agenda Google</span>}
                            </div>
                          </div>

                          {/* Actions */}
                          <div className="esbl-unit-actions">
                            <button
                              type="button"
                              disabled={!!unit.google_calendar_id || creatingUnitCalendarId === unit.id || !selectedEstablishment?.google_calendar_id}
                              onClick={() => handleCreateCalendarForUnit(unit)}
                              className="esbl-btn esbl-btn--primary"
                              style={{
                                background: unit.google_calendar_id ? '#d1fae5' : '#1f2937',
                                color: unit.google_calendar_id ? '#065f46' : 'white',
                              }}
                            >
                              {unit.google_calendar_id ? 'Agenda ✓' : creatingUnitCalendarId === unit.id ? 'Création…' : 'Créer agenda'}
                            </button>
                            <button
                              type="button"
                              disabled={deactivatingUnitId === unit.id}
                              onClick={() => setUnitPendingDeactivate(unit)}
                              className="esbl-btn esbl-btn--danger"
                            >
                              {deactivatingUnitId === unit.id ? '…' : 'Retirer'}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {/* Unités orphelines (type désactivé entre-temps) */}
            {(() => {
              const kindIds = new Set(equipmentKinds.map((k) => k.id));
              const orphans = inventoryUnits.filter((u) => !kindIds.has(u.equipment_kind_id));
              if (orphans.length === 0) return null;
              return (
                <div>
                  <div className="esbl-group-title" style={{ color: '#92400e', borderBottom: '1px solid #fed7aa' }}>
                    ⚠ Type inconnu · {orphans.length} unité{orphans.length !== 1 ? 's' : ''}
                  </div>
                  {orphans.map((unit) => (
                    <div key={unit.id} className="esbl-unit-card esbl-orphan">
                      <div>
                        <div style={{ fontWeight: 600, color: '#1f2937', fontSize: '0.92rem' }}>{unit.display_name} ({unit.unit_code})</div>
                        <div style={{ color: '#92400e', fontSize: '0.8rem' }}>Type d'équipement désactivé</div>
                      </div>
                      <button type="button" disabled={deactivatingUnitId === unit.id} onClick={() => setUnitPendingDeactivate(unit)} className="esbl-btn esbl-btn--danger">
                        {deactivatingUnitId === unit.id ? '…' : 'Retirer'}
                      </button>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}
