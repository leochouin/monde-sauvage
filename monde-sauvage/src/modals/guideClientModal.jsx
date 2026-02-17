/**
 * Guide Client Management Modal
 *
 * Full-screen panel (matching guide profile style) that lets guides:
 * - View / search their recurring client list
 * - Add / edit / delete clients
 * - Select a client to auto-fill the booking form
 * - Create a booking directly for a selected client
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  getGuideClients,
  createGuideClient,
  updateGuideClient,
  deleteGuideClient,
  getAllGuides,
  getAllGuideClients,
} from '../utils/guideClientService.js';
import {
  checkGuideAvailability,
  createGuideBooking,
  getGuideBookings,
} from '../utils/guideBookingService.js';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import './guideClientModal.css';

// ─── Sub-views ──────────────────────────────────────────────────────────────
const VIEW_LIST = 'list';
const VIEW_ADD = 'add';
const VIEW_EDIT = 'edit';
const VIEW_BOOK = 'book';

const EMPTY_CLIENT_FORM = {
  fullName: '',
  email: '',
  phone: '',
  notes: '',
};

const EMPTY_BOOKING_FORM = {
  startTime: null,
  endTime: null,
  tripType: '',
  numberOfPeople: 1,
  notes: '',
};

export default function GuideClientModal({ isOpen, onClose, guide, profile }) {
  const isAdmin = profile?.type === 'admin';

  // ── State ──────────────────────────────────────────────────────────────
  const [view, setView] = useState(VIEW_LIST);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  // Admin-specific: guide list & selected guide filter
  const [guides, setGuides] = useState([]);
  const [selectedGuideFilter, setSelectedGuideFilter] = useState('');
  const [loadingGuides, setLoadingGuides] = useState(false);

  // Client form (add / edit)
  const [clientForm, setClientForm] = useState(EMPTY_CLIENT_FORM);
  const [editingClient, setEditingClient] = useState(null);
  const [saveAndBook, setSaveAndBook] = useState(false);

  // Booking form (book view)
  const [selectedClient, setSelectedClient] = useState(null);
  const [bookingForm, setBookingForm] = useState(EMPTY_BOOKING_FORM);
  const [checking, setChecking] = useState(false);
  const [availability, setAvailability] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Delete confirmation
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  // Busy dates for filtering date picker
  const [busyDates, setBusyDates] = useState([]); // Array of { start: Date, end: Date }
  const [loadingBusyDates, setLoadingBusyDates] = useState(false);

  const searchRef = useRef(null);

  // ── Load guides list for admin ──────────────────────────────────
  useEffect(() => {
    if (isOpen && isAdmin) {
      const fetchGuides = async () => {
        setLoadingGuides(true);
        try {
          const data = await getAllGuides();
          setGuides(data);
        } catch (err) {
          console.error('Failed to load guides for admin:', err);
        } finally {
          setLoadingGuides(false);
        }
      };
      fetchGuides();
    }
  }, [isOpen, isAdmin]);

  // ── Load clients whenever modal opens or search / filter changes ────
  const loadClients = useCallback(async () => {
    // Admin mode: use getAllGuideClients (optionally filtered by guide)
    if (isAdmin) {
      setLoading(true);
      setError(null);
      try {
        const data = await getAllGuideClients({
          search,
          guideId: selectedGuideFilter || undefined,
        });
        setClients(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
      return;
    }

    // Guide mode: use getGuideClients scoped to own guide
    if (!guide?.id) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getGuideClients(guide.id, { search });
      setClients(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [isAdmin, guide?.id, search, selectedGuideFilter]);

  useEffect(() => {
    if (isOpen && (guide?.id || isAdmin)) {
      loadClients();
    }
  }, [isOpen, loadClients]);

  // Reset state when closing
  useEffect(() => {
    if (!isOpen) {
      setView(VIEW_LIST);
      setSearch('');
      setClientForm(EMPTY_CLIENT_FORM);
      setEditingClient(null);
      setSelectedClient(null);
      setBookingForm(EMPTY_BOOKING_FORM);
      setError(null);
      setSuccess(null);
      setAvailability(null);
      setDeleteConfirm(null);
      setSelectedGuideFilter('');
      setGuides([]);
    }
  }, [isOpen]);

  // ── Check availability when booking dates change ──────────────────
  // Effective guide for booking: client's own guide_id (works for both admin & guide modes)
  const effectiveGuideId = view === VIEW_BOOK
    ? (selectedClient?.guide_id || guide?.id)
    : guide?.id;

  // ── Fetch busy dates when entering book view ──────────────────────
  useEffect(() => {
    if (view !== VIEW_BOOK || !effectiveGuideId) {
      setBusyDates([]);
      return;
    }

    const fetchBusyDates = async () => {
      setLoadingBusyDates(true);
      try {
        const now = new Date();

        const bookings = await getGuideBookings(effectiveGuideId, {
          includeDeleted: false,
          includeHistorical: false,
        });

        if (bookings && bookings.length > 0) {
          const busy = bookings
            .filter(b => b.status !== 'cancelled')
            .map(b => ({
              start: new Date(b.start_time),
              end: new Date(b.end_time),
            }));
          setBusyDates(busy);
        } else {
          setBusyDates([]);
        }
      } catch (err) {
        console.warn('Could not load busy dates:', err);
        setBusyDates([]);
      } finally {
        setLoadingBusyDates(false);
      }
    };

    fetchBusyDates();
  }, [view, effectiveGuideId]);

  // Helper: check if a specific datetime is within any busy period
  const isTimeBusy = (date) => {
    return busyDates.some(busy => date >= busy.start && date < busy.end);
  };

  // Helper: filter available times for the DatePicker based on busy dates
  const filterAvailableTime = (time) => {
    const timeDate = new Date(time);
    return !isTimeBusy(timeDate);
  };

  useEffect(() => {
    if (view === VIEW_BOOK && bookingForm.startTime && bookingForm.endTime && effectiveGuideId) {
      const timer = setTimeout(() => checkAvail(), 300);
      return () => clearTimeout(timer);
    } else {
      setAvailability(null);
    }
  }, [bookingForm.startTime, bookingForm.endTime, view, effectiveGuideId]);

  const checkAvail = async () => {
    if (!bookingForm.startTime || !bookingForm.endTime || !effectiveGuideId) return;
    setChecking(true);
    setAvailability(null);
    try {
      const result = await checkGuideAvailability(
        effectiveGuideId,
        bookingForm.startTime.toISOString(),
        bookingForm.endTime.toISOString(),
      );
      setAvailability(result);
    } catch {
      setAvailability(null);
    } finally {
      setChecking(false);
    }
  };

  // ── Handlers ───────────────────────────────────────────────────────

  const clearMessages = () => {
    setError(null);
    setSuccess(null);
  };

  // -- Add / Edit client --

  const openAddView = () => {
    clearMessages();
    setClientForm(EMPTY_CLIENT_FORM);
    setSaveAndBook(false);
    setView(VIEW_ADD);
  };

  const openEditView = (client) => {
    clearMessages();
    setEditingClient(client);
    setClientForm({
      fullName: client.full_name || '',
      email: client.email || '',
      phone: client.phone || '',
      notes: client.notes || '',
    });
    setView(VIEW_EDIT);
  };

  const handleSaveClient = async (andBook = false) => {
    clearMessages();
    if (!clientForm.fullName.trim()) {
      setError('Le nom du client est requis.');
      return;
    }

    // Determine which guide to attach the client to
    const targetGuideId = isAdmin
      ? (selectedGuideFilter || guide?.id)
      : guide?.id;

    if (!targetGuideId && view === VIEW_ADD) {
      setError('Veuillez sélectionner un guide pour ce client.');
      return;
    }

    setSubmitting(true);
    try {
      let saved;
      if (view === VIEW_EDIT && editingClient) {
        saved = await updateGuideClient(editingClient.id, clientForm);
      } else {
        saved = await createGuideClient({ guideId: targetGuideId, ...clientForm });
      }

      await loadClients();

      if (andBook) {
        openBookView(saved);
      } else {
        setSuccess(view === VIEW_EDIT ? 'Client mis à jour.' : 'Client ajouté.');
        setView(VIEW_LIST);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  // -- Delete client --

  const handleDeleteClient = async (clientId) => {
    clearMessages();
    try {
      await deleteGuideClient(clientId);
      setDeleteConfirm(null);
      await loadClients();
      setSuccess('Client supprimé.');
    } catch (err) {
      setError(err.message);
    }
  };

  // -- Book for client --

  const openBookView = (client) => {
    clearMessages();
    setSelectedClient(client);
    setBookingForm(EMPTY_BOOKING_FORM);
    setAvailability(null);
    setView(VIEW_BOOK);
  };

  const handleCreateBooking = async () => {
    clearMessages();
    if (!bookingForm.startTime || !bookingForm.endTime) {
      setError('Veuillez sélectionner les dates et heures.');
      return;
    }
    if (bookingForm.startTime >= bookingForm.endTime) {
      setError("L'heure de fin doit être après l'heure de début.");
      return;
    }
    if (!availability?.available) {
      setError("Le créneau sélectionné n'est pas disponible.");
      return;
    }

    setSubmitting(true);
    try {
      await createGuideBooking({
        guideId: effectiveGuideId,
        startTime: bookingForm.startTime.toISOString(),
        endTime: bookingForm.endTime.toISOString(),
        customerName: selectedClient.full_name,
        customerEmail: selectedClient.email || '',
        customerPhone: selectedClient.phone || null,
        tripType: bookingForm.tripType || null,
        numberOfPeople: parseInt(bookingForm.numberOfPeople) || 1,
        notes: bookingForm.notes?.trim() || null,
        status: 'confirmed',
      });

      setSuccess('Réservation créée avec succès !');
      setTimeout(() => {
        setView(VIEW_LIST);
        setSuccess(null);
      }, 2000);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render helpers ────────────────────────────────────────────────

  if (!isOpen) return null;

  const renderHeader = () => {
    const titles = {
      [VIEW_LIST]: isAdmin ? 'Gestion des Clients' : 'Mes Clients',
      [VIEW_ADD]: 'Nouveau Client',
      [VIEW_EDIT]: 'Modifier Client',
      [VIEW_BOOK]: `Réserver pour ${selectedClient?.full_name || ''}`,
    };

    return (
      <div className="gc-header">
        <div className="gc-header-left">
          {view !== VIEW_LIST && (
            <button
              className="gc-back-btn"
              onClick={() => { clearMessages(); setView(VIEW_LIST); }}
            >
              ←
            </button>
          )}
          <h2>{titles[view]}</h2>
        </div>
        <button className="gc-close-btn" onClick={onClose}>×</button>
      </div>
    );
  };

  const renderMessages = () => (
    <>
      {error && (
        <div className="gc-message gc-error">
          <span>⚠</span> {error}
          <button onClick={() => setError(null)}>×</button>
        </div>
      )}
      {success && (
        <div className="gc-message gc-success">
          <span>✓</span> {success}
          <button onClick={() => setSuccess(null)}>×</button>
        </div>
      )}
    </>
  );

  // ── LIST VIEW ─────────────────────────────────────────────────────

  const renderListView = () => (
    <div className="gc-list-view">
      {/* Admin: Guide filter dropdown */}
      {isAdmin && (
        <div className="gc-admin-filter">
          <label className="gc-admin-filter-label">Filtrer par guide :</label>
          <select
            className="gc-input gc-guide-select"
            value={selectedGuideFilter}
            onChange={(e) => setSelectedGuideFilter(e.target.value)}
            disabled={loadingGuides}
          >
            <option value="">Tous les guides</option>
            {guides.map((g) => (
              <option key={g.id} value={g.id}>
                {g.full_name}{g.email ? ` (${g.email})` : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Search + Add bar */}
      <div className="gc-toolbar">
        <div className="gc-search-wrapper">
          <span className="gc-search-icon">🔍</span>
          <input
            ref={searchRef}
            type="text"
            className="gc-search"
            placeholder="Rechercher par nom, courriel ou téléphone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button className="gc-search-clear" onClick={() => setSearch('')}>×</button>
          )}
        </div>
        {/* Admin can only add if a guide is selected */}
        {(!isAdmin || selectedGuideFilter) && (
          <button className="gc-btn gc-btn-primary" onClick={openAddView}>
            + Nouveau client
          </button>
        )}
      </div>

      {/* Client list */}
      {loading ? (
        <div className="gc-loading">
          <div className="gc-spinner" />
          <span>Chargement...</span>
        </div>
      ) : clients.length === 0 ? (
        <div className="gc-empty">
          {search ? (
            <>
              <p>Aucun client trouvé pour « {search} »</p>
              <button className="gc-btn gc-btn-secondary" onClick={() => setSearch('')}>
                Effacer la recherche
              </button>
            </>
          ) : (
            <>
              <div className="gc-empty-icon">👥</div>
              <p>Aucun client enregistré.</p>
              <p className="gc-empty-sub">Ajoutez vos clients réguliers pour créer des réservations plus rapidement.</p>
              <button className="gc-btn gc-btn-primary" onClick={openAddView}>
                + Ajouter un premier client
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="gc-client-list">
          {clients.map((client) => (
            <div key={client.id} className="gc-client-card">
              <div className="gc-client-info">
                <div className="gc-client-avatar">
                  {(client.full_name || '?').split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase()}
                </div>
                <div className="gc-client-details">
                  <div className="gc-client-name">{client.full_name}</div>
                  {isAdmin && client.guide && (
                    <div className="gc-client-guide-tag">
                      🎣 {client.guide.name}
                    </div>
                  )}
                  {client.email && <div className="gc-client-meta">✉ {client.email}</div>}
                  {client.phone && <div className="gc-client-meta">📞 {client.phone}</div>}
                  {client.notes && <div className="gc-client-notes">{client.notes}</div>}
                </div>
              </div>
              <div className="gc-client-actions">
                <button
                  className="gc-btn gc-btn-book"
                  onClick={() => openBookView(client)}
                  title="Créer une réservation"
                >
                  📅 Réserver
                </button>
                <button
                  className="gc-btn gc-btn-icon"
                  onClick={() => openEditView(client)}
                  title="Modifier"
                >
                  ✏️
                </button>
                {deleteConfirm === client.id ? (
                  <div className="gc-delete-confirm">
                    <span>Supprimer ?</span>
                    <button
                      className="gc-btn gc-btn-danger-sm"
                      onClick={() => handleDeleteClient(client.id)}
                    >
                      Oui
                    </button>
                    <button
                      className="gc-btn gc-btn-secondary-sm"
                      onClick={() => setDeleteConfirm(null)}
                    >
                      Non
                    </button>
                  </div>
                ) : (
                  <button
                    className="gc-btn gc-btn-icon gc-btn-danger-icon"
                    onClick={() => setDeleteConfirm(client.id)}
                    title="Supprimer"
                  >
                    🗑️
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  // ── ADD / EDIT VIEW ────────────────────────────────────────────────

  const renderClientForm = () => (
    <div className="gc-form-view">
      <div className="gc-form-group">
        <label>Nom complet *</label>
        <input
          type="text"
          className="gc-input"
          placeholder="Jean Tremblay"
          value={clientForm.fullName}
          onChange={(e) => setClientForm(f => ({ ...f, fullName: e.target.value }))}
          autoFocus
        />
      </div>

      <div className="gc-form-group">
        <label>Courriel</label>
        <input
          type="email"
          className="gc-input"
          placeholder="jean@example.com"
          value={clientForm.email}
          onChange={(e) => setClientForm(f => ({ ...f, email: e.target.value }))}
        />
      </div>

      <div className="gc-form-group">
        <label>Téléphone</label>
        <input
          type="tel"
          className="gc-input"
          placeholder="(418) 555-1234"
          value={clientForm.phone}
          onChange={(e) => setClientForm(f => ({ ...f, phone: e.target.value }))}
        />
      </div>

      <div className="gc-form-group">
        <label>Notes</label>
        <textarea
          className="gc-input gc-textarea"
          placeholder="Préférences, allergies, notes importantes..."
          rows={3}
          value={clientForm.notes}
          onChange={(e) => setClientForm(f => ({ ...f, notes: e.target.value }))}
        />
      </div>

      <div className="gc-form-actions">
        <button
          className="gc-btn gc-btn-secondary"
          onClick={() => { clearMessages(); setView(VIEW_LIST); }}
          disabled={submitting}
        >
          Annuler
        </button>
        <button
          className="gc-btn gc-btn-primary"
          onClick={() => handleSaveClient(false)}
          disabled={submitting}
        >
          {submitting ? 'Enregistrement...' : view === VIEW_EDIT ? 'Mettre à jour' : 'Enregistrer'}
        </button>
        {view === VIEW_ADD && (
          <button
            className="gc-btn gc-btn-book"
            onClick={() => handleSaveClient(true)}
            disabled={submitting}
          >
            {submitting ? '...' : 'Enregistrer & Réserver'}
          </button>
        )}
      </div>
    </div>
  );

  // ── BOOKING VIEW ──────────────────────────────────────────────────

  const renderBookView = () => (
    <div className="gc-book-view">
      {/* Client summary */}
      <div className="gc-book-client-summary">
        <div className="gc-client-avatar gc-client-avatar-lg">
          {(selectedClient?.full_name || '?').split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase()}
        </div>
        <div>
          <div className="gc-client-name">{selectedClient?.full_name}</div>
          {selectedClient?.email && <div className="gc-client-meta">✉ {selectedClient.email}</div>}
          {selectedClient?.phone && <div className="gc-client-meta">📞 {selectedClient.phone}</div>}
        </div>
      </div>

      {/* Date / Time pickers */}
      <div className="gc-form-section">
        <h3>Date & Heure</h3>
        {loadingBusyDates && (
          <div className="gc-availability gc-checking" style={{ marginBottom: '0.75rem' }}>
            <div className="gc-spinner-sm" />
            <span>Chargement des disponibilités...</span>
          </div>
        )}
        <div className="gc-form-row">
          <div className="gc-form-group">
            <label>Début *</label>
            <DatePicker
              selected={bookingForm.startTime}
              onChange={(date) => setBookingForm(f => ({ ...f, startTime: date }))}
              showTimeSelect
              timeIntervals={30}
              filterTime={filterAvailableTime}
              dateFormat="d MMMM yyyy HH:mm"
              minDate={new Date()}
              placeholderText="Sélectionner..."
              className="gc-input"
              disabled={submitting}
            />
          </div>
          <div className="gc-form-group">
            <label>Fin *</label>
            <DatePicker
              selected={bookingForm.endTime}
              onChange={(date) => setBookingForm(f => ({ ...f, endTime: date }))}
              showTimeSelect
              timeIntervals={30}
              filterTime={filterAvailableTime}
              dateFormat="d MMMM yyyy HH:mm"
              minDate={bookingForm.startTime || new Date()}
              placeholderText="Sélectionner..."
              className="gc-input"
              disabled={submitting}
            />
          </div>
        </div>

        {/* Availability feedback */}
        {checking && (
          <div className="gc-availability gc-checking">
            <div className="gc-spinner-sm" />
            <span>Vérification de la disponibilité...</span>
          </div>
        )}
        {availability && !checking && (
          <div className={`gc-availability ${availability.available ? 'gc-available' : 'gc-unavailable'}`}>
            {availability.available
              ? '✓ Disponible pour ce créneau'
              : `✗ ${availability.reason || 'Créneau non disponible'}`}
          </div>
        )}
      </div>

      {/* Trip details */}
      <div className="gc-form-section">
        <h3>Détails de la sortie</h3>
        <div className="gc-form-group">
          <label>Type d'activité</label>
          <select
            className="gc-input"
            value={bookingForm.tripType}
            onChange={(e) => setBookingForm(f => ({ ...f, tripType: e.target.value }))}
            disabled={submitting}
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

        <div className="gc-form-row">
          <div className="gc-form-group">
            <label>Nombre de personnes</label>
            <input
              type="number"
              className="gc-input"
              min={1}
              max={20}
              value={bookingForm.numberOfPeople}
              onChange={(e) => setBookingForm(f => ({ ...f, numberOfPeople: e.target.value }))}
              disabled={submitting}
            />
          </div>
        </div>

        <div className="gc-form-group">
          <label>Notes supplémentaires</label>
          <textarea
            className="gc-input gc-textarea"
            rows={3}
            placeholder="Demandes spéciales..."
            value={bookingForm.notes}
            onChange={(e) => setBookingForm(f => ({ ...f, notes: e.target.value }))}
            disabled={submitting}
          />
        </div>
      </div>

      {/* Actions */}
      <div className="gc-form-actions">
        <button
          className="gc-btn gc-btn-secondary"
          onClick={() => { clearMessages(); setView(VIEW_LIST); }}
          disabled={submitting}
        >
          Annuler
        </button>
        <button
          className="gc-btn gc-btn-primary"
          onClick={handleCreateBooking}
          disabled={submitting || !availability?.available || checking}
        >
          {submitting ? 'Création...' : 'Créer la réservation'}
        </button>
      </div>
    </div>
  );

  // ── Main render ───────────────────────────────────────────────────

  return (
    <div className="gc-overlay">
      <div className="gc-modal">
        {renderHeader()}
        {renderMessages()}
        <div className="gc-body">
          {view === VIEW_LIST && renderListView()}
          {(view === VIEW_ADD || view === VIEW_EDIT) && renderClientForm()}
          {view === VIEW_BOOK && renderBookView()}
        </div>
      </div>
    </div>
  );
}
