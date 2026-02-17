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

import React, { useState, useEffect } from 'react';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import {
  checkGuideAvailability,
  createGuideBooking,
  getGuideBookings
} from '../utils/guideBookingService';
import { getGuideClients, createGuideClient } from '../utils/guideClientService';
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

  // ── UTC ↔ Local Date Conversion Helpers ──────────────────────────────────
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

  // Pre-fill dates from guide's prefilledStartTime/prefilledEndTime if available
  useEffect(() => {
    if (isOpen && guide) {
      // Reset form with prefilled times if available (convert from UTC if ISO strings)
      const prefilledStart = guide.prefilledStartTime ? utcToLocalDate(guide.prefilledStartTime) : null;
      const prefilledEnd = guide.prefilledEndTime ? utcToLocalDate(guide.prefilledEndTime) : null;
      
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
    }
  }, [isOpen, guide?.id]);

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
                // UTC day boundaries for calendar highlighting
                startDayUTC: Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()),
                endDayUTC: Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()),
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
  // Uses UTC day comparison to avoid timezone-induced off-by-one errors
  const getDayClassName = (date) => {
    const calDayUTC = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
    const isBooked = busyDates.some(
      (b) => calDayUTC >= b.startDayUTC && calDayUTC <= b.endDayUTC
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
      const result = await checkGuideAvailability(
        guide.id,
        localDateToUTC(formData.startTime),
        localDateToUTC(formData.endTime)
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

    // If guide has Stripe set up and has an hourly rate, go through payment flow
    if (guide?.stripe_charges_enabled && guide?.hourly_rate > 0) {
      setCheckoutBookingData({
        guideId: guide.id,
        startTime: localDateToUTC(formData.startTime),
        endTime: localDateToUTC(formData.endTime),
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
        startTime: localDateToUTC(formData.startTime),
        endTime: localDateToUTC(formData.endTime),
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

    // Sync Google Calendar event for the paid booking
    try {
      const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
      const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
      await fetch(`${SUPABASE_URL}/functions/v1/create-guide-booking-event`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          booking_id: result.bookingId,
          guide_id: guide.id,
          start_time: checkoutBookingData.startTime,
          end_time: checkoutBookingData.endTime,
          customer_name: checkoutBookingData.customerName,
          customer_email: checkoutBookingData.customerEmail,
          trip_type: checkoutBookingData.tripType,
          notes: checkoutBookingData.notes,
        })
      });
    } catch (calendarErr) {
      console.warn('Could not sync Google Calendar event:', calendarErr);
    }

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

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal-content guide-booking-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Book Guide: {guide?.name}</h2>
          <button className="modal-close" onClick={handleClose} disabled={loading}>
            ×
          </button>
        </div>

        <div className="modal-body">
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
                  disabled={loading || !availability?.available || checking}
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
};

export default GuideBookingModal;
