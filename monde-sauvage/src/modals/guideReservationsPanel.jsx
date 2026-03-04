/**
 * Guide Reservations Management Panel
 *
 * Allows guides to:
 * - View all their reservations (upcoming & past)
 * - Modify reservations (dates, client, details)
 * - Cancel reservations
 *
 * Designed to be embedded inside AccountSettingsModal as a tab.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  getGuideBookings,
  createGuideBooking,
  updateGuideBooking,
  cancelGuideBooking,
  checkGuideAvailability,
} from '../utils/guideBookingService.js';
import { createPaymentLink } from '../utils/stripeService.js';
import { getGuideClients } from '../utils/guideClientService.js';
import DatePicker from 'react-datepicker';
// CSS already loaded from guideClientModal/guideBookingModal

const STATUS_LABELS = {
  pending: { label: 'En attente', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  pending_payment: { label: 'En attente de paiement', color: '#f97316', bg: 'rgba(249,115,22,0.12)' },
  confirmed: { label: 'Confirmée', color: '#059669', bg: 'rgba(5,150,105,0.12)' },
  cancelled: { label: 'Annulée', color: '#dc2626', bg: 'rgba(220,38,38,0.12)' },
  completed: { label: 'Terminée', color: '#6b7280', bg: 'rgba(107,114,128,0.12)' },
  deleted: { label: 'Supprimée', color: '#9ca3af', bg: 'rgba(156,163,175,0.12)' },
};

export default function GuideReservationsPanel({ guide }) {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [showPast, setShowPast] = useState(false);

  // Edit state
  const [editingBooking, setEditingBooking] = useState(null);
  const [editForm, setEditForm] = useState({
    startTime: null,
    endTime: null,
    customerName: '',
    customerEmail: '',
    customerPhone: '',
    tripType: '',
    numberOfPeople: 1,
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [editAvailability, setEditAvailability] = useState(null);
  const [checkingAvail, setCheckingAvail] = useState(false);

  // Cancel state
  const [cancelConfirm, setCancelConfirm] = useState(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling, setCancelling] = useState(false);

  // Busy dates for edit date picker
  const [busyDates, setBusyDates] = useState([]);

  // New reservation state
  const [isCreating, setIsCreating] = useState(false);
  const [createForm, setCreateForm] = useState({
    startTime: null,
    endTime: null,
    customerName: '',
    customerEmail: '',
    customerPhone: '',
    tripType: '',
    numberOfPeople: 1,
    notes: '',
  });
  const [creating, setCreating] = useState(false);
  const [createAvailability, setCreateAvailability] = useState(null);
  const [checkingCreateAvail, setCheckingCreateAvail] = useState(false);

  // Client picker
  const [clients, setClients] = useState([]);
  const [showClientPicker, setShowClientPicker] = useState(false);
  const [clientSearch, setClientSearch] = useState('');

  // Payment link state
  const [paymentLinkResult, setPaymentLinkResult] = useState(null);

  // ── Load bookings ────────────────────────────────────────────────
  const loadBookings = useCallback(async () => {
    if (!guide?.id) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getGuideBookings(guide.id, {
        includeDeleted: false,
        includeHistorical: showPast,
      });
      setBookings(data || []);

      // Build busy dates from non-cancelled bookings
      // Store both raw Date objects (for time filtering) and UTC day values (for date comparison)
      const busy = (data || [])
        .filter(b => b.status !== 'cancelled')
        .map(b => {
          const start = new Date(b.start_time);
          const end = new Date(b.end_time);
          return {
            id: b.id,
            start,
            end,
            // UTC day boundaries for calendar highlighting
            startDayUTC: Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()),
            endDayUTC: Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()),
          };
        });
      setBusyDates(busy);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [guide?.id, showPast]);

  useEffect(() => {
    loadBookings();
  }, [loadBookings]);

  // Load clients for client picker
  useEffect(() => {
    if (guide?.id) {
      getGuideClients(guide.id).then(setClients).catch(() => setClients([]));
    }
  }, [guide?.id]);

  // ── Check availability when edit dates change ────────────────────
  useEffect(() => {
    if (!editingBooking || !editForm.startTime || !editForm.endTime) {
      setEditAvailability(null);
      return;
    }

    // Only check if dates actually changed
    const origStart = new Date(editingBooking.start_time).getTime();
    const origEnd = new Date(editingBooking.end_time).getTime();
    if (editForm.startTime.getTime() === origStart && editForm.endTime.getTime() === origEnd) {
      setEditAvailability({ available: true });
      return;
    }

    const timer = setTimeout(async () => {
      setCheckingAvail(true);
      try {
        const result = await checkGuideAvailability(
          guide.id,
          editForm.startTime.toISOString(),
          editForm.endTime.toISOString(),
          editingBooking.id // Exclude this booking from conflict check
        );
        setEditAvailability(result);
      } catch {
        setEditAvailability(null);
      } finally {
        setCheckingAvail(false);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [editForm.startTime, editForm.endTime, editingBooking, guide?.id]);

  // ── Check availability when create dates change ──────────────────
  useEffect(() => {
    if (!isCreating || !createForm.startTime || !createForm.endTime) {
      setCreateAvailability(null);
      return;
    }

    const timer = setTimeout(async () => {
      setCheckingCreateAvail(true);
      try {
        const result = await checkGuideAvailability(
          guide.id,
          createForm.startTime.toISOString(),
          createForm.endTime.toISOString()
        );
        setCreateAvailability(result);
      } catch {
        setCreateAvailability(null);
      } finally {
        setCheckingCreateAvail(false);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [createForm.startTime, createForm.endTime, isCreating, guide?.id]);

  // Helper: filter available times excluding current booking
  const filterAvailableTime = (time) => {
    if (!editingBooking && !isCreating) return true;
    const d = new Date(time);
    return !busyDates.some(b => b.id !== editingBooking?.id && d >= b.start && d < b.end);
  };

  // Helper: return CSS class for days that overlap with existing bookings
  // Uses UTC day comparison to avoid timezone-induced off-by-one errors
  const getDayClassName = (date) => {
    const calDayUTC = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
    const isBooked = busyDates.some(
      (b) => b.id !== editingBooking?.id && calDayUTC >= b.startDayUTC && calDayUTC <= b.endDayUTC
    );
    return isBooked ? 'grp-day--booked' : undefined;
  };

  // ── Handlers ─────────────────────────────────────────────────────

  const clearMessages = () => { setError(null); setSuccess(null); };

  // ── New reservation handlers ─────────────────────────────────────
  const openCreate = () => {
    clearMessages();
    setIsCreating(true);
    setCreateForm({
      startTime: null,
      endTime: null,
      customerName: '',
      customerEmail: '',
      customerPhone: '',
      tripType: '',
      numberOfPeople: 1,
      notes: '',
    });
    setCreateAvailability(null);
  };

  const closeCreate = () => {
    setIsCreating(false);
    setCreateAvailability(null);
  };

  const handleCreateReservation = async () => {
    clearMessages();
    if (!createForm.startTime || !createForm.endTime) {
      setError('Veuillez sélectionner les dates.');
      return;
    }
    if (createForm.startTime >= createForm.endTime) {
      setError("L'heure de fin doit être après l'heure de début.");
      return;
    }
    if (!createForm.customerName.trim()) {
      setError('Veuillez entrer le nom du client.');
      return;
    }

    const bookingPayload = {
      guideId: guide.id,
      startTime: localDateToUTC(createForm.startTime),
      endTime: localDateToUTC(createForm.endTime),
      customerName: createForm.customerName.trim(),
      customerEmail: createForm.customerEmail.trim() || null,
      customerPhone: createForm.customerPhone.trim() || null,
      tripType: createForm.tripType || null,
      numberOfPeople: parseInt(createForm.numberOfPeople) || 1,
      notes: createForm.notes.trim() || null,
    };

    // If guide has Stripe enabled and hourly rate, REQUIRE payment
    if (guide?.stripe_charges_enabled && guide?.hourly_rate > 0) {
      if (!createForm.customerEmail?.trim()) {
        setError('Le courriel du client est requis pour envoyer le lien de paiement.');
        return;
      }

      setCreating(true);
      try {
        const result = await createPaymentLink(bookingPayload);
        setPaymentLinkResult(result);
        setSuccess(
          `Lien de paiement créé! La réservation sera confirmée lorsque le client aura payé.`
        );
        closeCreate();
        await loadBookings();
      } catch (err) {
        setError(err.message);
      } finally {
        setCreating(false);
      }
      return;
    }

    // Guide without Stripe — create booking directly (free bookings only)
    setCreating(true);
    try {
      await createGuideBooking({
        ...bookingPayload,
        status: 'confirmed',
      });
      setSuccess('Réservation créée avec succès.');
      closeCreate();
      await loadBookings();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const handleSelectClientCreate = (client) => {
    setCreateForm(f => ({
      ...f,
      customerName: client.full_name || '',
      customerEmail: client.email || '',
      customerPhone: client.phone || '',
    }));
    setShowClientPicker(false);
    setClientSearch('');
  };

  const openEdit = (booking) => {
    clearMessages();
    setEditingBooking(booking);
    setEditForm({
      startTime: utcToLocalDate(booking.start_time),
      endTime: utcToLocalDate(booking.end_time),
      customerName: booking.customer_name || '',
      customerEmail: booking.customer_email || '',
      customerPhone: booking.customer_phone || '',
      tripType: booking.trip_type || '',
      numberOfPeople: booking.number_of_people || 1,
      notes: booking.notes || '',
    });
    setEditAvailability({ available: true });
  };

  const closeEdit = () => {
    setEditingBooking(null);
    setEditAvailability(null);
  };

  const handleSaveEdit = async () => {
    clearMessages();
    if (!editForm.startTime || !editForm.endTime) {
      setError('Veuillez sélectionner les dates.');
      return;
    }
    if (editForm.startTime >= editForm.endTime) {
      setError("L'heure de fin doit être après l'heure de début.");
      return;
    }

    setSaving(true);
    try {
      const updates = {
        start_time: localDateToUTC(editForm.startTime),
        end_time: localDateToUTC(editForm.endTime),
        customer_name: editForm.customerName,
        customer_email: editForm.customerEmail,
        customer_phone: editForm.customerPhone || null,
        trip_type: editForm.tripType || null,
        number_of_people: parseInt(editForm.numberOfPeople) || 1,
        notes: editForm.notes || null,
      };

      await updateGuideBooking(editingBooking.id, updates);
      setSuccess('Réservation mise à jour avec succès.');
      closeEdit();
      await loadBookings();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = async (bookingId) => {
    clearMessages();
    setCancelling(true);
    try {
      await cancelGuideBooking(bookingId, cancelReason);
      setSuccess('Réservation annulée.');
      setCancelConfirm(null);
      setCancelReason('');
      await loadBookings();
    } catch (err) {
      setError(err.message);
    } finally {
      setCancelling(false);
    }
  };

  const handleSelectClient = (client) => {
    setEditForm(f => ({
      ...f,
      customerName: client.full_name || '',
      customerEmail: client.email || '',
      customerPhone: client.phone || '',
    }));
    setShowClientPicker(false);
    setClientSearch('');
  };

  const filteredClients = clients.filter(c => {
    if (!clientSearch.trim()) return true;
    const term = clientSearch.toLowerCase();
    return (c.full_name || '').toLowerCase().includes(term)
      || (c.email || '').toLowerCase().includes(term);
  });

  // ── Format helpers ───────────────────────────────────────────────
  // Use timeZone: 'UTC' so displayed dates match the DB values (Supabase stores TIMESTAMPTZ in UTC)
  // This prevents off-by-one day errors caused by UTC → local timezone conversion
  const formatDate = (iso) => {
    const d = new Date(iso);
    return d.toLocaleDateString('fr-CA', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  };

  const formatTime = (iso) => {
    const d = new Date(iso);
    return d.toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
  };

  // Format date range - show full range if spans multiple days
  const formatDateRange = (startIso, endIso) => {
    const start = new Date(startIso);
    const end = new Date(endIso);
    
    // Check if same calendar day in UTC
    const sameDay = start.getUTCDate() === end.getUTCDate() &&
                    start.getUTCMonth() === end.getUTCMonth() &&
                    start.getUTCFullYear() === end.getUTCFullYear();
    
    if (sameDay) {
      return formatDate(startIso);
    } else {
      // Different days - show range
      const startStr = start.toLocaleDateString('fr-CA', { day: 'numeric', month: 'long', timeZone: 'UTC' });
      const endStr = formatDate(endIso);
      return `${startStr} → ${endStr}`;
    }
  };

  // ── UTC ↔ Local Date Conversion Helpers ──────────────────────────
  // DatePicker works with Date objects in the browser's local timezone.
  // DB stores TIMESTAMPTZ in UTC. We need to preserve the calendar date/time values.
  
  // Convert UTC ISO string to local Date with same year/month/day/hour/minute
  // Example: "2026-02-21T10:00:00Z" → Date object showing Feb 21, 10:00 in local picker
  const utcToLocalDate = (isoString) => {
    if (!isoString) return null;
    const d = new Date(isoString);
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 
                    d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds());
  };

  // Convert local Date to UTC ISO string with same year/month/day/hour/minute
  // Example: Date showing Feb 21, 10:00 in local picker → "2026-02-21T10:00:00.000Z"
  const localDateToUTC = (localDate) => {
    if (!localDate) return null;
    const utcDate = new Date(Date.UTC(
      localDate.getFullYear(),
      localDate.getMonth(),
      localDate.getDate(),
      localDate.getHours(),
      localDate.getMinutes(),
      localDate.getSeconds()
    ));
    return utcDate.toISOString();
  };

  // ── Render ───────────────────────────────────────────────────────

  // ── Create reservation view ──────────────────────────────────────
  if (isCreating) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            type="button"
            onClick={closeCreate}
            style={{
              background: 'none', border: '1px solid #d1d5db', borderRadius: '8px',
              width: '36px', height: '36px', cursor: 'pointer', fontSize: '1.1rem',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#374151',
            }}
          >
            ←
          </button>
          <h3 style={{ margin: 0, fontSize: '18px', color: '#1F3A2E' }}>
            Nouvelle réservation
          </h3>
        </div>

        {/* Messages */}
        {error && (
          <div style={{ padding: '10px 14px', backgroundColor: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca', borderRadius: '8px', fontSize: '14px' }}>
            ⚠ {error}
          </div>
        )}
        {success && (
          <div style={{ padding: '10px 14px', backgroundColor: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0', borderRadius: '8px', fontSize: '14px' }}>
            ✓ {success}
          </div>
        )}

        {/* Create form */}
        <div style={{ padding: '20px', backgroundColor: 'white', borderRadius: '12px', border: '1px solid #E5E7EB' }}>
          {/* Date pickers */}
          <h4 style={{ margin: '0 0 12px', fontSize: '15px', color: '#2D5F4C' }}>Date & Heure</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '8px' }}>
            <div>
              <label style={labelStyle}>Début *</label>
              <DatePicker
                selected={createForm.startTime}
                onChange={(date) => setCreateForm(f => ({ ...f, startTime: date }))}
                showTimeSelect
                timeIntervals={30}
                filterTime={filterAvailableTime}
                dayClassName={getDayClassName}
                dateFormat="d MMMM yyyy HH:mm"
                minDate={new Date()}
                className="grp-edit-input"
                disabled={creating}
                placeholderText="Sélectionner..."
              />
            </div>
            <div>
              <label style={labelStyle}>Fin *</label>
              <DatePicker
                selected={createForm.endTime}
                onChange={(date) => setCreateForm(f => ({ ...f, endTime: date }))}
                showTimeSelect
                timeIntervals={30}
                filterTime={filterAvailableTime}
                dayClassName={getDayClassName}
                dateFormat="d MMMM yyyy HH:mm"
                minDate={createForm.startTime || new Date()}
                className="grp-edit-input"
                disabled={creating}
                placeholderText="Sélectionner..."
              />
            </div>
          </div>
          {/* Legend */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '16px', fontSize: '12px', color: '#6b7280' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
              <span style={{ display: 'inline-block', width: '16px', height: '16px', borderRadius: '50%', backgroundColor: 'rgba(220,38,38,0.10)', border: '1.5px solid #dc2626', position: 'relative', fontSize: '10px', lineHeight: '16px', textAlign: 'center', color: '#dc2626', fontWeight: 700 }}>✕</span>
              Déjà réservé
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
              <span style={{ display: 'inline-block', width: '16px', height: '16px', borderRadius: '50%', backgroundColor: '#2D5F4C', fontSize: '10px', lineHeight: '16px', textAlign: 'center', color: '#fff' }}></span>
              Disponible
            </span>
          </div>

          {/* Availability feedback */}
          {checkingCreateAvail && (
            <div style={{ padding: '8px 12px', backgroundColor: '#f0f8ff', color: '#0066cc', borderRadius: '8px', fontSize: '13px', marginBottom: '12px' }}>
              Vérification de la disponibilité...
            </div>
          )}
          {createAvailability && !checkingCreateAvail && !createAvailability.available && (
            <div style={{ padding: '8px 12px', backgroundColor: '#fef2f2', color: '#991b1b', borderRadius: '8px', fontSize: '13px', marginBottom: '12px', border: '1px solid #fecaca' }}>
              ✗ {createAvailability.reason || 'Créneau non disponible'}
            </div>
          )}
          {createAvailability && !checkingCreateAvail && createAvailability.available && (
            <div style={{ padding: '8px 12px', backgroundColor: '#f0fdf4', color: '#166534', borderRadius: '8px', fontSize: '13px', marginBottom: '12px', border: '1px solid #bbf7d0' }}>
              ✓ Créneau disponible
            </div>
          )}

          {/* Client assignment */}
          <h4 style={{ margin: '16px 0 12px', fontSize: '15px', color: '#2D5F4C' }}>Client</h4>

          {clients.length > 0 && (
            <div style={{ marginBottom: '12px', position: 'relative' }}>
              <button
                type="button"
                onClick={() => setShowClientPicker(!showClientPicker)}
                style={{
                  padding: '8px 14px', backgroundColor: '#eff6ff', color: '#1d4ed8',
                  border: '1px solid #bfdbfe', borderRadius: '8px', cursor: 'pointer',
                  fontSize: '13px', fontWeight: '500',
                }}
              >
                Choisir un client enregistré
              </button>
              {showClientPicker && (
                <div style={{
                  position: 'absolute', top: '100%', left: 0, zIndex: 10,
                  background: '#fff', border: '1px solid #d1d5db', borderRadius: '8px',
                  maxHeight: 200, overflowY: 'auto', width: '300px', marginTop: '4px',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                }}>
                  <input
                    type="text"
                    placeholder="Rechercher..."
                    value={clientSearch}
                    onChange={(e) => setClientSearch(e.target.value)}
                    style={{
                      width: '100%', padding: '8px 10px', border: 'none',
                      borderBottom: '1px solid #e5e7eb', fontSize: '13px',
                      boxSizing: 'border-box', color: '#1f2937',
                    }}
                    autoFocus
                  />
                  {filteredClients.map(client => (
                    <div
                      key={client.id}
                      onClick={() => handleSelectClientCreate(client)}
                      style={{
                        padding: '8px 10px', cursor: 'pointer', fontSize: '13px',
                        borderBottom: '1px solid #f3f4f6',
                      }}
                      onMouseOver={(e) => e.currentTarget.style.background = '#f0fdf4'}
                      onMouseOut={(e) => e.currentTarget.style.background = '#fff'}
                    >
                      <strong>{client.full_name}</strong>
                      {client.email && <span style={{ color: '#6b7280', marginLeft: 8, fontSize: '12px' }}>{client.email}</span>}
                    </div>
                  ))}
                </div>
              )}
              {showClientPicker && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 5 }} onClick={() => setShowClientPicker(false)} />
              )}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
            <div>
              <label style={labelStyle}>Nom du client *</label>
              <input
                type="text"
                value={createForm.customerName}
                onChange={(e) => setCreateForm(f => ({ ...f, customerName: e.target.value }))}
                style={inputStyle}
                disabled={creating}
                placeholder="Nom complet"
              />
            </div>
            <div>
              <label style={labelStyle}>Courriel</label>
              <input
                type="email"
                value={createForm.customerEmail}
                onChange={(e) => setCreateForm(f => ({ ...f, customerEmail: e.target.value }))}
                style={inputStyle}
                disabled={creating}
                placeholder="email@example.com"
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
            <div>
              <label style={labelStyle}>Téléphone</label>
              <input
                type="tel"
                value={createForm.customerPhone}
                onChange={(e) => setCreateForm(f => ({ ...f, customerPhone: e.target.value }))}
                style={inputStyle}
                disabled={creating}
                placeholder="(555) 555-5555"
              />
            </div>
            <div>
              <label style={labelStyle}>Nombre de personnes</label>
              <input
                type="number"
                min={1}
                max={20}
                value={createForm.numberOfPeople}
                onChange={(e) => setCreateForm(f => ({ ...f, numberOfPeople: e.target.value }))}
                style={inputStyle}
                disabled={creating}
              />
            </div>
          </div>

          {/* Trip details */}
          <h4 style={{ margin: '16px 0 12px', fontSize: '15px', color: '#2D5F4C' }}>Détails</h4>
          <div style={{ marginBottom: '12px' }}>
            <label style={labelStyle}>Type d'activité</label>
            <select
              value={createForm.tripType}
              onChange={(e) => setCreateForm(f => ({ ...f, tripType: e.target.value }))}
              style={{ ...inputStyle, cursor: 'pointer' }}
              disabled={creating}
            >
              <option value="">Sélectionner...</option>
              <option value="Fishing">Pêche</option>
              <option value="Hiking">Randonnée</option>
              <option value="Canoeing">Canot</option>
              <option value="Wildlife Watching">Observation de la faune</option>
              <option value="Photography Tour">Tour photo</option>
              <option value="Other">Autre</option>
            </select>
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label style={labelStyle}>Notes</label>
            <textarea
              value={createForm.notes}
              onChange={(e) => setCreateForm(f => ({ ...f, notes: e.target.value }))}
              rows={3}
              style={{ ...inputStyle, resize: 'vertical' }}
              disabled={creating}
              placeholder="Notes additionnelles..."
            />
          </div>

          {/* Price Preview (for guides with Stripe + hourly rate) */}
          {guide?.stripe_charges_enabled && guide?.hourly_rate > 0 && createForm.startTime && createForm.endTime && createForm.endTime > createForm.startTime && (() => {
            const durationMs = createForm.endTime.getTime() - createForm.startTime.getTime();
            const durationHours = Math.round(durationMs / (1000 * 60 * 60) * 10) / 10;
            const total = Math.round(guide.hourly_rate * durationHours * 100) / 100;
            return (
              <div style={{ background: '#f0fdf4', padding: '12px 16px', borderRadius: '8px', marginBottom: '16px', border: '1px solid #bbf7d0' }}>
                <div style={{ fontWeight: '600', fontSize: '14px', color: '#166534', marginBottom: '4px' }}>
                  💰 Estimation du prix
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', color: '#374151' }}>
                  <span>{guide.hourly_rate}$/h × {durationHours}h</span>
                  <span style={{ fontWeight: '600' }}>{total}$ CAD</span>
                </div>
                <p style={{ fontSize: '12px', color: '#059669', margin: '6px 0 0' }}>
                  🔗 Un lien de paiement sera généré et envoyé au client
                </p>
              </div>
            );
          })()}

          {/* Actions */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', borderTop: '1px solid #e5e7eb', paddingTop: '16px' }}>
            <button
              type="button"
              onClick={closeCreate}
              disabled={creating}
              style={{
                padding: '10px 18px', backgroundColor: '#f3f4f6', color: '#374151',
                border: '1px solid #d1d5db', borderRadius: '10px', cursor: 'pointer',
                fontSize: '14px', fontWeight: '500',
              }}
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={handleCreateReservation}
              disabled={creating || (createAvailability && !createAvailability.available) || checkingCreateAvail}
              style={{
                padding: '10px 18px', backgroundColor: '#2D5F4C', color: '#FFFCF7',
                border: 'none', borderRadius: '10px', cursor: creating ? 'not-allowed' : 'pointer',
                fontSize: '14px', fontWeight: '600',
                opacity: (creating || (createAvailability && !createAvailability.available)) ? 0.6 : 1,
              }}
            >
              {creating ? 'Création...' : (guide?.stripe_charges_enabled && guide?.hourly_rate > 0) ? '🔗 Créer et envoyer le lien de paiement' : 'Créer la réservation'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (editingBooking) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {/* Edit header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            type="button"
            onClick={closeEdit}
            style={{
              background: 'none', border: '1px solid #d1d5db', borderRadius: '8px',
              width: '36px', height: '36px', cursor: 'pointer', fontSize: '1.1rem',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#374151',
            }}
          >
            ←
          </button>
          <h3 style={{ margin: 0, fontSize: '18px', color: '#1F3A2E' }}>
            Modifier la réservation
          </h3>
        </div>

        {/* Messages */}
        {error && (
          <div style={{ padding: '10px 14px', backgroundColor: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca', borderRadius: '8px', fontSize: '14px' }}>
            ⚠ {error}
          </div>
        )}
        {success && (
          <div style={{ padding: '10px 14px', backgroundColor: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0', borderRadius: '8px', fontSize: '14px' }}>
            ✓ {success}
          </div>
        )}

        {/* Edit form */}
        <div style={{ padding: '20px', backgroundColor: 'white', borderRadius: '12px', border: '1px solid #E5E7EB' }}>
          {/* Date pickers */}
          <h4 style={{ margin: '0 0 12px', fontSize: '15px', color: '#2D5F4C' }}>Date & Heure</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '8px' }}>
            <div>
              <label style={labelStyle}>Début *</label>
              <DatePicker
                selected={editForm.startTime}
                onChange={(date) => setEditForm(f => ({ ...f, startTime: date }))}
                showTimeSelect
                timeIntervals={30}
                filterTime={filterAvailableTime}
                dayClassName={getDayClassName}
                dateFormat="d MMMM yyyy HH:mm"
                minDate={new Date()}
                className="grp-edit-input"
                disabled={saving}
              />
            </div>
            <div>
              <label style={labelStyle}>Fin *</label>
              <DatePicker
                selected={editForm.endTime}
                onChange={(date) => setEditForm(f => ({ ...f, endTime: date }))}
                showTimeSelect
                timeIntervals={30}
                filterTime={filterAvailableTime}
                dayClassName={getDayClassName}
                dateFormat="d MMMM yyyy HH:mm"
                minDate={editForm.startTime || new Date()}
                className="grp-edit-input"
                disabled={saving}
              />
            </div>
          </div>
          {/* Legend */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '16px', fontSize: '12px', color: '#6b7280' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
              <span style={{ display: 'inline-block', width: '16px', height: '16px', borderRadius: '50%', backgroundColor: 'rgba(220,38,38,0.10)', border: '1.5px solid #dc2626', position: 'relative', fontSize: '10px', lineHeight: '16px', textAlign: 'center', color: '#dc2626', fontWeight: 700 }}>✕</span>
              Déjà réservé
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
              <span style={{ display: 'inline-block', width: '16px', height: '16px', borderRadius: '50%', backgroundColor: '#2D5F4C', fontSize: '10px', lineHeight: '16px', textAlign: 'center', color: '#fff' }}></span>
              Disponible
            </span>
          </div>

          {/* Availability feedback */}
          {checkingAvail && (
            <div style={{ padding: '8px 12px', backgroundColor: '#f0f8ff', color: '#0066cc', borderRadius: '8px', fontSize: '13px', marginBottom: '12px' }}>
              Vérification de la disponibilité...
            </div>
          )}
          {editAvailability && !checkingAvail && !editAvailability.available && (
            <div style={{ padding: '8px 12px', backgroundColor: '#fef2f2', color: '#991b1b', borderRadius: '8px', fontSize: '13px', marginBottom: '12px', border: '1px solid #fecaca' }}>
              ✗ {editAvailability.reason || 'Créneau non disponible'}
            </div>
          )}

          {/* Client assignment */}
          <h4 style={{ margin: '16px 0 12px', fontSize: '15px', color: '#2D5F4C' }}>Client</h4>
          
          {clients.length > 0 && (
            <div style={{ marginBottom: '12px', position: 'relative' }}>
              <button
                type="button"
                onClick={() => setShowClientPicker(!showClientPicker)}
                style={{
                  padding: '8px 14px', backgroundColor: '#eff6ff', color: '#1d4ed8',
                  border: '1px solid #bfdbfe', borderRadius: '8px', cursor: 'pointer',
                  fontSize: '13px', fontWeight: '500',
                }}
              >
                Choisir un client enregistré
              </button>
              {showClientPicker && (
                <div style={{
                  position: 'absolute', top: '100%', left: 0, zIndex: 10,
                  background: '#fff', border: '1px solid #d1d5db', borderRadius: '8px',
                  maxHeight: 200, overflowY: 'auto', width: '300px', marginTop: '4px',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                }}>
                  <input
                    type="text"
                    placeholder="Rechercher..."
                    value={clientSearch}
                    onChange={(e) => setClientSearch(e.target.value)}
                    style={{
                      width: '100%', padding: '8px 10px', border: 'none',
                      borderBottom: '1px solid #e5e7eb', fontSize: '13px',
                      boxSizing: 'border-box', color: '#1f2937',
                    }}
                    autoFocus
                  />
                  {filteredClients.map(client => (
                    <div
                      key={client.id}
                      onClick={() => handleSelectClient(client)}
                      style={{
                        padding: '8px 10px', cursor: 'pointer', fontSize: '13px',
                        borderBottom: '1px solid #f3f4f6',
                      }}
                      onMouseOver={(e) => e.currentTarget.style.background = '#f0fdf4'}
                      onMouseOut={(e) => e.currentTarget.style.background = '#fff'}
                    >
                      <strong>{client.full_name}</strong>
                      {client.email && <span style={{ color: '#6b7280', marginLeft: 8, fontSize: '12px' }}>{client.email}</span>}
                    </div>
                  ))}
                </div>
              )}
              {showClientPicker && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 5 }} onClick={() => setShowClientPicker(false)} />
              )}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
            <div>
              <label style={labelStyle}>Nom du client *</label>
              <input
                type="text"
                value={editForm.customerName}
                onChange={(e) => setEditForm(f => ({ ...f, customerName: e.target.value }))}
                style={inputStyle}
                disabled={saving}
              />
            </div>
            <div>
              <label style={labelStyle}>Courriel</label>
              <input
                type="email"
                value={editForm.customerEmail}
                onChange={(e) => setEditForm(f => ({ ...f, customerEmail: e.target.value }))}
                style={inputStyle}
                disabled={saving}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
            <div>
              <label style={labelStyle}>Téléphone</label>
              <input
                type="tel"
                value={editForm.customerPhone}
                onChange={(e) => setEditForm(f => ({ ...f, customerPhone: e.target.value }))}
                style={inputStyle}
                disabled={saving}
              />
            </div>
            <div>
              <label style={labelStyle}>Nombre de personnes</label>
              <input
                type="number"
                min={1}
                max={20}
                value={editForm.numberOfPeople}
                onChange={(e) => setEditForm(f => ({ ...f, numberOfPeople: e.target.value }))}
                style={inputStyle}
                disabled={saving}
              />
            </div>
          </div>

          {/* Trip details */}
          <h4 style={{ margin: '16px 0 12px', fontSize: '15px', color: '#2D5F4C' }}>Détails</h4>
          <div style={{ marginBottom: '12px' }}>
            <label style={labelStyle}>Type d'activité</label>
            <select
              value={editForm.tripType}
              onChange={(e) => setEditForm(f => ({ ...f, tripType: e.target.value }))}
              style={{ ...inputStyle, cursor: 'pointer' }}
              disabled={saving}
            >
              <option value="">Sélectionner...</option>
              <option value="Fishing">Pêche</option>
              <option value="Hiking">Randonnée</option>
              <option value="Canoeing">Canot</option>
              <option value="Wildlife Watching">Observation de la faune</option>
              <option value="Photography Tour">Tour photo</option>
              <option value="Other">Autre</option>
            </select>
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label style={labelStyle}>Notes</label>
            <textarea
              value={editForm.notes}
              onChange={(e) => setEditForm(f => ({ ...f, notes: e.target.value }))}
              rows={3}
              style={{ ...inputStyle, resize: 'vertical' }}
              disabled={saving}
            />
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', borderTop: '1px solid #e5e7eb', paddingTop: '16px' }}>
            <button
              type="button"
              onClick={closeEdit}
              disabled={saving}
              style={{
                padding: '10px 18px', backgroundColor: '#f3f4f6', color: '#374151',
                border: '1px solid #d1d5db', borderRadius: '10px', cursor: 'pointer',
                fontSize: '14px', fontWeight: '500',
              }}
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={handleSaveEdit}
              disabled={saving || (editAvailability && !editAvailability.available) || checkingAvail}
              style={{
                padding: '10px 18px', backgroundColor: '#2D5F4C', color: '#FFFCF7',
                border: 'none', borderRadius: '10px', cursor: saving ? 'not-allowed' : 'pointer',
                fontSize: '14px', fontWeight: '600',
                opacity: (saving || (editAvailability && !editAvailability.available)) ? 0.6 : 1,
              }}
            >
              {saving ? 'Enregistrement...' : 'Sauvegarder'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── List view ────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
        <h3 style={{ margin: 0, fontSize: '18px', color: '#1F3A2E', fontWeight: '600' }}>
          📅 Mes réservations
        </h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#5A7766', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={showPast}
              onChange={(e) => setShowPast(e.target.checked)}
            />
            Afficher les passées
          </label>
          <button
            type="button"
            onClick={loadBookings}
            disabled={loading}
            style={{
              padding: '8px 14px', backgroundColor: '#eff6ff', color: '#1d4ed8',
              border: '1px solid #bfdbfe', borderRadius: '8px', cursor: 'pointer',
              fontSize: '13px', fontWeight: '500',
            }}
          >
            ↻ Rafraîchir
          </button>
          <button
            type="button"
            onClick={openCreate}
            style={{
              padding: '8px 14px', backgroundColor: '#2D5F4C', color: '#FFFCF7',
              border: 'none', borderRadius: '8px', cursor: 'pointer',
              fontSize: '13px', fontWeight: '600',
            }}
          >
            + Nouvelle réservation
          </button>
        </div>
      </div>

      {/* Messages */}
      {error && (
        <div style={{ padding: '10px 14px', backgroundColor: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca', borderRadius: '8px', fontSize: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>⚠ {error}</span>
          <button onClick={() => setError(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', color: '#991b1b' }}>×</button>
        </div>
      )}
      {success && (
        <div style={{ padding: '10px 14px', backgroundColor: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0', borderRadius: '8px', fontSize: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>✓ {success}</span>
          <button onClick={() => setSuccess(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', color: '#166534' }}>×</button>
        </div>
      )}

      {/* Payment Link Result Banner */}
      {paymentLinkResult && (
        <div style={{
          padding: '14px 16px', backgroundColor: '#eff6ff', color: '#1e40af',
          border: '1px solid #bfdbfe', borderRadius: '10px', fontSize: '14px',
        }}>
          <div style={{ fontWeight: '600', marginBottom: '6px' }}>🔗 Lien de paiement créé</div>
          <div style={{ fontSize: '13px', color: '#374151', marginBottom: '8px' }}>
            Envoyez ce lien au client pour qu'il puisse payer. La réservation sera confirmée automatiquement après le paiement.
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="text"
              readOnly
              value={paymentLinkResult.paymentLinkUrl}
              style={{
                flex: 1, padding: '8px 10px', fontSize: '12px', border: '1px solid #d1d5db',
                borderRadius: '6px', backgroundColor: '#fff', color: '#374151',
                minWidth: '200px',
              }}
              onClick={(e) => e.target.select()}
            />
            <button
              onClick={() => {
                navigator.clipboard.writeText(paymentLinkResult.paymentLinkUrl);
                setSuccess('Lien copié dans le presse-papiers!');
              }}
              style={{
                padding: '8px 14px', backgroundColor: '#2D5F4C', color: '#fff',
                border: 'none', borderRadius: '6px', cursor: 'pointer',
                fontSize: '13px', fontWeight: '500', whiteSpace: 'nowrap',
              }}
            >
              📋 Copier le lien
            </button>
            <button
              onClick={() => setPaymentLinkResult(null)}
              style={{
                padding: '8px 10px', backgroundColor: 'transparent', color: '#6b7280',
                border: '1px solid #d1d5db', borderRadius: '6px', cursor: 'pointer',
                fontSize: '13px',
              }}
            >
              ✕
            </button>
          </div>
          <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '6px' }}>
            Expire le {new Date(paymentLinkResult.expiresAt).toLocaleString('fr-CA')} • 
            Total: {paymentLinkResult.pricing.total}$ CAD
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ textAlign: 'center', padding: '2rem', color: '#6b7280' }}>
          Chargement des réservations...
        </div>
      )}

      {/* Empty state */}
      {!loading && bookings.length === 0 && (
        <div style={{
          textAlign: 'center', padding: '3rem 1rem',
          backgroundColor: 'white', borderRadius: '12px',
          border: '1px solid #E5E7EB',
        }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📅</div>
          <p style={{ margin: '0 0 4px', color: '#6b7280', fontSize: '15px' }}>Aucune réservation {showPast ? '' : 'à venir'}.</p>
          <p style={{ margin: 0, color: '#9ca3af', fontSize: '13px' }}>
            Les réservations créées depuis la gestion des clients apparaîtront ici.
          </p>
        </div>
      )}

      {/* Booking list */}
      {!loading && bookings.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {bookings.map(booking => {
            const status = STATUS_LABELS[booking.status] || STATUS_LABELS.pending;
            const isPast = new Date(booking.end_time) < new Date();
            const isCancelled = booking.status === 'cancelled';

            return (
              <div
                key={booking.id}
                style={{
                  padding: '16px 20px',
                  backgroundColor: 'white',
                  borderRadius: '12px',
                  border: '1px solid #E5E7EB',
                  opacity: isCancelled ? 0.6 : 1,
                  transition: 'box-shadow 0.15s',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' }}>
                  {/* Left: booking info */}
                  <div style={{ flex: 1, minWidth: '200px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                      <span style={{
                        padding: '3px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: '600',
                        color: status.color, backgroundColor: status.bg,
                      }}>
                        {status.label}
                      </span>
                      {booking.is_paid && (
                        <span style={{ padding: '3px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: '600', color: '#059669', backgroundColor: 'rgba(5,150,105,0.12)' }}>
                          💰 Payée
                        </span>
                      )}
                      {booking.status === 'pending_payment' && booking.payment_link_url && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            navigator.clipboard.writeText(booking.payment_link_url);
                            setSuccess('Lien de paiement copié!');
                          }}
                          style={{
                            padding: '3px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: '600',
                            color: '#1d4ed8', backgroundColor: 'rgba(59,130,246,0.12)',
                            border: 'none', cursor: 'pointer',
                          }}
                          title="Cliquer pour copier le lien de paiement"
                        >
                          🔗 Copier lien
                        </button>
                      )}
                    </div>

                    <div style={{ fontSize: '15px', fontWeight: '600', color: '#1F3A2E', marginBottom: '4px' }}>
                      {booking.customer_name || 'Client inconnu'}
                    </div>

                    <div style={{ fontSize: '13px', color: '#5A7766', marginBottom: '2px' }}>
                      📅 {formatDateRange(booking.start_time, booking.end_time)}
                    </div>
                    <div style={{ fontSize: '13px', color: '#5A7766', marginBottom: '2px' }}>
                      🕐 {formatTime(booking.start_time)} — {formatTime(booking.end_time)}
                    </div>

                    {booking.customer_email && (
                      <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '4px' }}>
                        ✉ {booking.customer_email}
                      </div>
                    )}
                    {booking.trip_type && (
                      <div style={{ fontSize: '12px', color: '#9ca3af' }}>
                        🎣 {booking.trip_type}
                      </div>
                    )}
                    {booking.notes && (
                      <div style={{ fontSize: '12px', color: '#9ca3af', fontStyle: 'italic', marginTop: '4px' }}>
                        {booking.notes.length > 100 ? booking.notes.slice(0, 100) + '...' : booking.notes}
                      </div>
                    )}
                  </div>

                  {/* Right: actions */}
                  {!isCancelled && !isPast && (
                    <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                      <button
                        type="button"
                        onClick={() => openEdit(booking)}
                        style={{
                          padding: '8px 14px', backgroundColor: '#eff6ff', color: '#1d4ed8',
                          border: '1px solid #bfdbfe', borderRadius: '8px', cursor: 'pointer',
                          fontSize: '13px', fontWeight: '500',
                        }}
                      >
                        ✏️ Modifier
                      </button>

                      {cancelConfirm === booking.id ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <input
                            type="text"
                            placeholder="Raison (optionnel)"
                            value={cancelReason}
                            onChange={(e) => setCancelReason(e.target.value)}
                            style={{
                              padding: '6px 10px', border: '1px solid #fecaca', borderRadius: '6px',
                              fontSize: '12px', width: '140px', color: '#1f2937',
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => handleCancel(booking.id)}
                            disabled={cancelling}
                            style={{
                              padding: '6px 12px', backgroundColor: '#ef4444', color: '#fff',
                              border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px',
                            }}
                          >
                            {cancelling ? '...' : 'Confirmer'}
                          </button>
                          <button
                            type="button"
                            onClick={() => { setCancelConfirm(null); setCancelReason(''); }}
                            style={{
                              padding: '6px 12px', backgroundColor: '#f3f4f6', color: '#374151',
                              border: '1px solid #d1d5db', borderRadius: '6px', cursor: 'pointer', fontSize: '12px',
                            }}
                          >
                            Non
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setCancelConfirm(booking.id)}
                          style={{
                            padding: '8px 14px', backgroundColor: '#fef2f2', color: '#dc2626',
                            border: '1px solid #fecaca', borderRadius: '8px', cursor: 'pointer',
                            fontSize: '13px', fontWeight: '500',
                          }}
                        >
                          ✗ Annuler
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Shared styles
const labelStyle = {
  display: 'block',
  fontSize: '13px',
  color: '#5A7766',
  fontWeight: '500',
  marginBottom: '6px',
};

const inputStyle = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: '8px',
  border: '1.5px solid #D1D5DB',
  fontSize: '14px',
  color: '#1F3A2E',
  backgroundColor: '#FFFCF7',
  boxSizing: 'border-box',
};
