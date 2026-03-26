/**
 * Guide Booking Modal Component
 * Allows users to book a guide for a specific time range
 * 
 * Features:
 * - Date/time selection
 * - Customer information form
 * - Real-time availability checking
 * - Google Calendar integration
 * - Conflict detection
 */

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import {
  checkGuideConflictsServer,
  createGuideBooking,
  getGuideBookings,
  checkGoogleCalendarConnection,
} from '../utils/guideBookingService.js';
import { getGuideClients, createGuideClient } from '../utils/guideClientService.js';
import CheckoutModal from './checkoutModal.jsx';
import './guideBookingModal.css';

const GuideBookingModal = ({ guide, isOpen, onClose, onBookingCreated }) => {
  // Form state
  const [formData, setFormData] = useState({
    startTime: null,
    endTime: null,
    customerName: '',
    customerEmail: '',
    customerPhone: '',
    tripType: '',
    numberOfPeople: 1,
    notes: ''
  });

  // UI state
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [availability, setAvailability] = useState(null);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [upcomingBookings, setUpcomingBookings] = useState([]);
  
  // Calendar connection state — blocks bookings if disconnected
  const [calendarStatus, setCalendarStatus] = useState(null); // null = loading, 'connected' | 'disconnected' | 'never_connected'

  // Saved clients state
  const [savedClients, setSavedClients] = useState([]);
  const [clientSearch, setClientSearch] = useState('');
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const [saveClientChecked, setSaveClientChecked] = useState(false);

  // Busy dates for filtering date picker
  const [busyDates, setBusyDates] = useState([]);

  // Stripe checkout state
  const [showCheckout, setShowCheckout] = useState(false);
  const [checkoutBookingData, setCheckoutBookingData] = useState(null);

  // ── Timezone-Aware Date Helpers ─────────────────────────────────────────
  // DatePicker works with Date objects in the browser's local timezone.
  // DB stores TIMESTAMPTZ in UTC. We use proper timezone conversion:
  //   - Incoming ISO strings → Date objects (browser interprets in local tz)
  //   - Outgoing Date objects → ISO strings via .toISOString() (always UTC)
  // This ensures the absolute moment in time is always preserved.
  
  // Parse ISO string to a Date object (browser shows in local timezone)
  // Example: "2026-03-03T13:00:00.000Z" → Date showing Mar 3, 8:00 AM in Montreal
  const parseISOToDate = (isoString) => {
    if (!isoString) return null;
    const d = new Date(isoString);
    if (isNaN(d.getTime())) {
      console.error('[DATE BUG GUARD] Invalid date string:', isoString);
      return null;
    }
    return d;
  };

  // Convert local Date to UTC ISO string (preserves the absolute moment)
  // Example: Date for Mar 3, 8:00 AM Montreal → "2026-03-03T13:00:00.000Z"
  const dateToISO = (localDate) => {
    if (!localDate) return null;
    const iso = localDate.toISOString();
    console.log('[DATE TRACE] dateToISO:', {
      localDisplay: localDate.toLocaleString(),
      utcISO: iso,
      tzOffset: localDate.getTimezoneOffset(),
    });
    return iso;
  };

  // Pre-fill dates from guide's prefilledStartTime/prefilledEndTime if available
  useEffect(() => {
    if (isOpen && guide) {
      // Reset form with prefilled times if available (convert from UTC if ISO strings)
      const prefilledStart = guide.prefilledStartTime ? parseISOToDate(guide.prefilledStartTime) : null;
      const prefilledEnd = guide.prefilledEndTime ? parseISOToDate(guide.prefilledEndTime) : null;
      if (prefilledStart) {
        console.log('[DATE TRACE] Prefilled start:', guide.prefilledStartTime, '→ local:', prefilledStart.toLocaleString());
      }
      
      setFormData(prev => ({
        ...prev,
        startTime: prefilledStart,
        endTime: prefilledEnd
      }));
    }
  }, [isOpen, guide?.prefilledStartTime, guide?.prefilledEndTime]);

  // Load guide's upcoming bookings when modal opens
  useEffect(() => {
    if (isOpen && guide?.id) {
      loadUpcomingBookings();
      loadSavedClients();
      loadBusyDates();
      // Check calendar connection status — gate bookings on connectivity
      checkCalendarConnection();
    }
  }, [isOpen, guide?.id]);

  const checkCalendarConnection = async () => {
    if (!guide?.id) return;
    try {
      const result = await checkGoogleCalendarConnection(guide.id);
      setCalendarStatus(result.connection_status || (result.connected ? 'connected' : 'disconnected'));
    } catch (err) {
      console.error('Failed to check calendar connection:', err);
      setCalendarStatus('unknown');
    }
  };

  const loadBusyDates = async () => {
    if (!guide?.id) return;
    try {
      const bookings = await getGuideBookings(guide.id, {
        includeDeleted: false,
        includeHistorical: false,
      });
      if (bookings && bookings.length > 0) {
        setBusyDates(
          bookings
            .filter(b => b.status !== 'cancelled')
            .map(b => {
              const start = new Date(b.start_time);
              const end = new Date(b.end_time);
              return {
                start,
                end,
                // Use LOCAL day boundaries for calendar highlighting
                // (match how DatePicker interprets dates in the browser's timezone)
                startDayLocal: new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime(),
                endDayLocal: new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime(),
              };
            })
        );
      } else {
        setBusyDates([]);
      }
    } catch (err) {
      console.warn('Could not load busy dates:', err);
      setBusyDates([]);
    }
  };

  const filterAvailableTime = (time) => {
    const d = new Date(time);
    return !busyDates.some(b => d >= b.start && d < b.end);
  };

  // Helper: return CSS class for days that overlap with existing bookings
  // Uses LOCAL day comparison (matches DatePicker's local timezone interpretation)
  const getDayClassName = (date) => {
    const calDayLocal = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    const isBooked = busyDates.some(
      (b) => calDayLocal >= b.startDayLocal && calDayLocal <= b.endDayLocal
    );
    return isBooked ? 'grp-day--booked' : undefined;
  };

  const loadSavedClients = async () => {
    try {
      const clients = await getGuideClients(guide.id);
      setSavedClients(clients || []);
    } catch (err) {
      console.warn('Could not load saved clients:', err);
    }
  };

  const handleSelectClient = (client) => {
    setFormData(prev => ({
      ...prev,
      customerName: client.full_name || '',
      customerEmail: client.email || '',
      customerPhone: client.phone || '',
    }));
    setShowClientDropdown(false);
    setClientSearch('');
  };

  const filteredClients = savedClients.filter(c => {
    if (!clientSearch.trim()) return true;
    const term = clientSearch.toLowerCase();
    return (c.full_name || '').toLowerCase().includes(term)
      || (c.email || '').toLowerCase().includes(term)
      || (c.phone || '').toLowerCase().includes(term);
  });

  const loadUpcomingBookings = async () => {
    try {
      const bookings = await getGuideBookings(guide.id, {
        includeDeleted: false,
        includeHistorical: false
      });
      setUpcomingBookings(bookings || []);
    } catch (err) {
      console.warn('Could not load upcoming bookings:', err);
    }
  };

  // Check availability when dates change
  useEffect(() => {
    if (formData.startTime && formData.endTime) {
      checkAvailability();
    } else {
      setAvailability(null);
    }
  }, [formData.startTime, formData.endTime]);

  const checkAvailability = async () => {
    if (!formData.startTime || !formData.endTime || !guide?.id) return;

    setChecking(true);
    setAvailability(null);
    setError(null);

    try {
      // Use server-side conflict check (bypasses RLS, sees ALL bookings)
      const result = await checkGuideConflictsServer(
        guide.id,
        dateToISO(formData.startTime),
        dateToISO(formData.endTime)
      );

      setAvailability(result);
    } catch (err) {
      console.error('Error checking availability:', err);
      setError('Could not check availability. Please try again.');
    } finally {
      setChecking(false);
    }
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleDateChange = (field, date) => {
    setFormData(prev => ({
      ...prev,
      [field]: date
    }));
  };

  const validateForm = () => {
    if (!formData.startTime || !formData.endTime) {
      setError('Please select start and end times');
      return false;
    }

    if (formData.startTime >= formData.endTime) {
      setError('End time must be after start time');
      return false;
    }

    if (!formData.customerName.trim()) {
      setError('Please enter customer name');
      return false;
    }

    if (!formData.customerEmail.trim()) {
      setError('Please enter customer email');
      return false;
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.customerEmail)) {
      setError('Please enter a valid email address');
      return false;
    }

    return true;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!validateForm()) return;

    // Check availability one more time before submitting
    if (!availability?.available) {
      setError('Selected time slot is not available');
      return;
    }

    // Final server-side conflict check right before proceeding to payment/booking.
    // This catches race conditions where another user booked between the initial
    // check and the user pressing "Submit".
    try {
      setChecking(true);
      const finalCheck = await checkGuideConflictsServer(
        guide.id,
        dateToISO(formData.startTime),
        dateToISO(formData.endTime)
      );
      if (!finalCheck.available) {
        setAvailability(finalCheck);
        setError('Ce créneau vient d\'être réservé par un autre utilisateur. Veuillez choisir un autre horaire.');
        setChecking(false);
        return;
      }
      setChecking(false);
    } catch (err) {
      console.warn('Final conflict check failed — proceeding (server will validate):', err);
      setChecking(false);
    }

    // If guide has Stripe set up and has an hourly rate, go through payment flow
    if (guide?.stripe_charges_enabled && guide?.hourly_rate > 0) {
      setCheckoutBookingData({
        guideId: guide.id,
        startTime: dateToISO(formData.startTime),
        endTime: dateToISO(formData.endTime),
        customerName: formData.customerName.trim(),
        customerEmail: formData.customerEmail.trim(),
        customerPhone: formData.customerPhone.trim() || null,
        tripType: formData.tripType || null,
        numberOfPeople: parseInt(formData.numberOfPeople) || 1,
        notes: formData.notes.trim() || null,
      });
      setShowCheckout(true);
      return;
    }

    // Otherwise, create booking without payment (legacy flow)
    setLoading(true);
    setError(null);

    try {
      const bookingData = {
        guideId: guide.id,
        startTime: dateToISO(formData.startTime),
        endTime: dateToISO(formData.endTime),
        customerName: formData.customerName.trim(),
        customerEmail: formData.customerEmail.trim(),
        customerPhone: formData.customerPhone.trim() || null,
        tripType: formData.tripType || null,
        numberOfPeople: parseInt(formData.numberOfPeople) || 1,
        notes: formData.notes.trim() || null,
        status: 'pending'
      };

      const booking = await createGuideBooking(bookingData);
      
      // Save client if checkbox is checked
      if (saveClientChecked && formData.customerName.trim()) {
        try {
          await createGuideClient({
            guideId: guide.id,
            fullName: formData.customerName.trim(),
            email: formData.customerEmail.trim() || null,
            phone: formData.customerPhone.trim() || null,
          });
        } catch (saveErr) {
          console.warn('Could not save client:', saveErr);
        }
      }

      setSuccess(true);
      
      // Notify parent component
      if (onBookingCreated) {
        onBookingCreated(booking);
      }

      // Reset form after 2 seconds and close
      setTimeout(() => {
        resetForm();
        onClose();
      }, 2000);

    } catch (err) {
      console.error('Error creating booking:', err);
      setError(err.message || 'Failed to create booking. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Called when Stripe payment succeeds
  const handlePaymentSuccess = async (result) => {
    console.log('✅ Guide payment successful:', result);
    
    // Save client if checkbox is checked
    if (saveClientChecked && formData.customerName.trim()) {
      try {
        await createGuideClient({
          guideId: guide.id,
          fullName: formData.customerName.trim(),
          email: formData.customerEmail.trim() || null,
          phone: formData.customerPhone.trim() || null,
        });
      } catch (saveErr) {
        console.warn('Could not save client:', saveErr);
      }
    }

    // NOTE: Google Calendar event creation is handled exclusively by the
    // Stripe webhook (payment_intent.succeeded). We intentionally do NOT
    // call retryCalendarSync here to avoid creating duplicate events due to
    // the webhook, confirmBookingPayment fallback, and this handler all
    // racing simultaneously.

    setSuccess(true);
    setShowCheckout(false);

    if (onBookingCreated) {
      onBookingCreated(result);
    }

    setTimeout(() => {
      resetForm();
      onClose();
    }, 2000);
  };

  const resetForm = () => {
    setFormData({
      startTime: null,
      endTime: null,
      customerName: '',
      customerEmail: '',
      customerPhone: '',
      tripType: '',
      numberOfPeople: 1,
      notes: ''
    });
    setAvailability(null);
    setError(null);
    setSuccess(false);
  };

  const handleClose = () => {
    if (!loading) {
      resetForm();
      onClose();
    }
  };

  if (!isOpen) return null;

  const modalMarkup = (
    <div className="guide-booking-overlay" onClick={handleClose}>
      <div className="guide-booking-modal" onClick={(e) => e.stopPropagation()}>
        <div className="guide-booking-header">
          <h2>Book Guide: {guide?.name}</h2>
          <button type="button" className="guide-booking-close" onClick={handleClose} disabled={loading}>
            ×
          </button>
        </div>

        <div className="guide-booking-body">
          {/* Calendar disconnected — block all bookings */}
          {(calendarStatus === 'disconnected' || calendarStatus === 'never_connected') && (
            <div style={{
              padding: '20px',
              backgroundColor: '#fff5f5',
              border: '2px solid #fc8181',
              borderRadius: '10px',
              textAlign: 'center',
              marginBottom: '16px',
            }}>
              <div style={{ fontSize: '32px', marginBottom: '8px' }}>⚠️</div>
              <h3 style={{ color: '#c53030', margin: '0 0 8px 0' }}>
                Calendrier Google déconnecté
              </h3>
              <p style={{ color: '#742a2a', margin: '0 0 12px 0', fontSize: '14px' }}>
                {calendarStatus === 'never_connected'
                  ? 'Ce guide n\'a pas encore connecté son Google Calendar. Les réservations sont désactivées.'
                  : 'La connexion Google Calendar de ce guide a expiré. Les réservations sont temporairement désactivées jusqu\'à la reconnexion.'}
              </p>
              <p style={{ color: '#9b2c2c', fontSize: '12px', margin: 0 }}>
                Le guide doit reconnecter son compte dans ses paramètres.
              </p>
            </div>
          )}

          {success ? (
            <div className="success-message">
              <div className="success-icon">✓</div>
              <h3>Booking Created Successfully!</h3>
              <p>A confirmation email has been sent to {formData.customerEmail}</p>
              <p className="success-note">The guide will receive a Google Calendar notification.</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              {/* Date/Time Selection */}
              <div className="form-section">
                <h3>Select Date & Time</h3>
                
                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="startTime">Start Time *</label>
                    <DatePicker
                      selected={formData.startTime}
                      onChange={(date) => handleDateChange('startTime', date)}
                      showTimeSelect
                      timeIntervals={30}
                      filterTime={filterAvailableTime}
                      dayClassName={getDayClassName}
                      dateFormat="MMMM d, yyyy h:mm aa"
                      minDate={new Date()}
                      placeholderText="Select start time"
                      className="form-input"
                      disabled={loading}
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="endTime">End Time *</label>
                    <DatePicker
                      selected={formData.endTime}
                      onChange={(date) => handleDateChange('endTime', date)}
                      showTimeSelect
                      timeIntervals={30}
                      filterTime={filterAvailableTime}
                      dayClassName={getDayClassName}
                      dateFormat="MMMM d, yyyy h:mm aa"
                      minDate={formData.startTime || new Date()}
                      placeholderText="Select end time"
                      className="form-input"
                      disabled={loading}
                    />
                  </div>
                </div>

                {/* Availability Status */}
                {checking && (
                  <div className="availability-checking">
                    <div className="spinner"></div>
                    <span>Checking availability...</span>
                  </div>
                )}

                {availability && !checking && (
                  <div className={`availability-status ${availability.available ? 'available' : 'unavailable'}`}>
                    {availability.available ? (
                      <>
                        <span className="status-icon">✓</span>
                        <span>Guide is available for selected time</span>
                      </>
                    ) : (
                      <>
                        <span className="status-icon">✗</span>
                        <span>{availability.reason}</span>
                        {availability.conflicts && availability.conflicts.length > 0 && (
                          <div className="conflicts-list">
                            <strong>Conflicting bookings:</strong>
                            <ul>
                              {availability.conflicts.map((conflict, idx) => (
                                <li key={idx}>
                                  {conflict.customer_name || conflict.summary} 
                                  ({new Date(conflict.start_time || conflict.start).toLocaleString()} - 
                                  {new Date(conflict.end_time || conflict.end).toLocaleString()})
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Customer Information */}
              <div className="form-section">
                <h3>Customer Information</h3>

                {/* Saved Client Picker */}
                {savedClients.length > 0 && (
                  <div className="form-group" style={{ marginBottom: '1.25rem' }}>
                    <label>Choisir un client enregistré</label>
                    <div style={{ position: 'relative' }}>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="Rechercher un client..."
                        value={clientSearch}
                        onChange={(e) => {
                          setClientSearch(e.target.value);
                          setShowClientDropdown(true);
                        }}
                        onFocus={() => setShowClientDropdown(true)}
                        disabled={loading}
                      />
                      {showClientDropdown && filteredClients.length > 0 && (
                        <div style={{
                          position: 'absolute', top: '100%', left: 0, right: 0,
                          background: '#fff', border: '1px solid #d1d5db',
                          borderRadius: '0 0 4px 4px', maxHeight: 200, overflowY: 'auto',
                          zIndex: 10, boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
                        }}>
                          {filteredClients.map(client => (
                            <div
                              key={client.id}
                              onClick={() => handleSelectClient(client)}
                              style={{
                                padding: '0.6rem 0.75rem', cursor: 'pointer',
                                borderBottom: '1px solid #f3f4f6',
                                fontSize: '0.9rem',
                              }}
                              onMouseOver={(e) => e.currentTarget.style.background = '#f0fdf4'}
                              onMouseOut={(e) => e.currentTarget.style.background = '#fff'}
                            >
                              <strong>{client.full_name}</strong>
                              {client.email && <span style={{ color: '#6b7280', marginLeft: 8, fontSize: '0.82rem' }}>{client.email}</span>}
                            </div>
                          ))}
                        </div>
                      )}
                      {showClientDropdown && (
                        <div
                          style={{ position: 'fixed', inset: 0, zIndex: 5 }}
                          onClick={() => setShowClientDropdown(false)}
                        />
                      )}
                    </div>
                  </div>
                )}

                <div className="form-group">
                  <label htmlFor="customerName">Name *</label>
                  <input
                    type="text"
                    id="customerName"
                    name="customerName"
                    value={formData.customerName}
                    onChange={handleInputChange}
                    className="form-input"
                    placeholder="Enter customer name"
                    disabled={loading}
                    required
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="customerEmail">Email *</label>
                  <input
                    type="email"
                    id="customerEmail"
                    name="customerEmail"
                    value={formData.customerEmail}
                    onChange={handleInputChange}
                    className="form-input"
                    placeholder="customer@example.com"
                    disabled={loading}
                    required
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="customerPhone">Phone</label>
                  <input
                    type="tel"
                    id="customerPhone"
                    name="customerPhone"
                    value={formData.customerPhone}
                    onChange={handleInputChange}
                    className="form-input"
                    placeholder="(555) 123-4567"
                    disabled={loading}
                  />
                </div>

                {/* Save client checkbox */}
                <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input
                    type="checkbox"
                    id="saveClient"
                    checked={saveClientChecked}
                    onChange={(e) => setSaveClientChecked(e.target.checked)}
                    disabled={loading}
                  />
                  <label htmlFor="saveClient" style={{ marginBottom: 0, cursor: 'pointer' }}>
                    Enregistrer ce client pour les prochaines réservations
                  </label>
                </div>
              </div>

              {/* Trip Details */}
              <div className="form-section">
                <h3>Trip Details</h3>

                <div className="form-group">
                  <label htmlFor="tripType">Activity Type</label>
                  <select
                    id="tripType"
                    name="tripType"
                    value={formData.tripType}
                    onChange={handleInputChange}
                    className="form-input"
                    disabled={loading}
                  >
                    <option value="">Select activity type</option>
                    <option value="Hiking">Hiking</option>
                    <option value="Fishing">Fishing</option>
                    <option value="Canoeing">Canoeing</option>
                    <option value="Wildlife Watching">Wildlife Watching</option>
                    <option value="Photography Tour">Photography Tour</option>
                    <option value="Other">Other</option>
                  </select>
                </div>

                <div className="form-group">
                  <label htmlFor="numberOfPeople">Number of People</label>
                  <input
                    type="number"
                    id="numberOfPeople"
                    name="numberOfPeople"
                    value={formData.numberOfPeople}
                    onChange={handleInputChange}
                    className="form-input"
                    min="1"
                    max="20"
                    disabled={loading}
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="notes">Additional Notes</label>
                  <textarea
                    id="notes"
                    name="notes"
                    value={formData.notes}
                    onChange={handleInputChange}
                    className="form-input"
                    rows="3"
                    placeholder="Any special requests or requirements..."
                    disabled={loading}
                  />
                </div>
              </div>

              {/* Price Preview (if guide has hourly rate) */}
              {guide?.hourly_rate > 0 && formData.startTime && formData.endTime && formData.endTime > formData.startTime && (
                <div className="form-section" style={{ background: '#f0fdf4', padding: '1rem', borderRadius: '8px', marginBottom: '1rem' }}>
                  <h3 style={{ margin: '0 0 0.5rem' }}>💰 Estimation du prix</h3>
                  {(() => {
                    const durationMs = formData.endTime.getTime() - formData.startTime.getTime();
                    const durationHours = Math.round(durationMs / (1000 * 60 * 60) * 10) / 10;
                    const total = Math.round(guide.hourly_rate * durationHours * 100) / 100;
                    return (
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                          <span>{guide.hourly_rate}$/h × {durationHours}h</span>
                          <span>{total}$ CAD</span>
                        </div>
                        {guide?.stripe_charges_enabled && (
                          <p style={{ fontSize: '0.82rem', color: '#64748b', margin: '0.5rem 0 0' }}>
                            🔒 Paiement sécurisé par Stripe
                          </p>
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Error Message */}
              {error && (
                <div className="error-message">
                  <span className="error-icon">⚠</span>
                  {error}
                </div>
              )}

              {/* Action Buttons */}
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleClose}
                  disabled={loading}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={loading || !availability?.available || checking || calendarStatus === 'disconnected' || calendarStatus === 'never_connected'}
                >
                  {loading ? (
                    <>
                      <div className="spinner-small"></div>
                      Creating Booking...
                    </>
                  ) : guide?.stripe_charges_enabled && guide?.hourly_rate > 0 ? (
                    '💳 Réserver et payer'
                  ) : (
                    'Create Booking'
                  )}
                </button>
              </div>
            </form>
          )}

          {/* Upcoming Bookings Preview */}
          {!success && upcomingBookings.length > 0 && (
            <div className="upcoming-bookings">
              <h4>Upcoming Bookings ({upcomingBookings.length})</h4>
              <div className="bookings-timeline">
                {upcomingBookings.slice(0, 5).map(booking => (
                  <div key={booking.id} className="booking-item">
                    <div className="booking-time">
                      {new Date(booking.start_time).toLocaleDateString()} 
                      {' '}
                      {new Date(booking.start_time).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                      {' - '}
                      {new Date(booking.end_time).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                    </div>
                    <div className="booking-customer">{booking.customer_name}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Stripe Checkout Modal for Guide Bookings */}
      <CheckoutModal
        isOpen={showCheckout}
        onClose={() => setShowCheckout(false)}
        bookingData={checkoutBookingData}
        bookingType="guide"
        title={guide?.name}
        onSuccess={handlePaymentSuccess}
      />
    </div>
  );

  return createPortal(modalMarkup, document.body);
};

export default GuideBookingModal;
