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

  // Pre-fill dates from guide's prefilledStartTime/prefilledEndTime if available
  useEffect(() => {
    if (isOpen && guide) {
      // Reset form with prefilled times if available
      const prefilledStart = guide.prefilledStartTime ? new Date(guide.prefilledStartTime) : null;
      const prefilledEnd = guide.prefilledEndTime ? new Date(guide.prefilledEndTime) : null;
      
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
    }
  }, [isOpen, guide?.id]);

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
        formData.startTime.toISOString(),
        formData.endTime.toISOString()
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

    setLoading(true);
    setError(null);

    try {
      const bookingData = {
        guideId: guide.id,
        startTime: formData.startTime.toISOString(),
        endTime: formData.endTime.toISOString(),
        customerName: formData.customerName.trim(),
        customerEmail: formData.customerEmail.trim(),
        customerPhone: formData.customerPhone.trim() || null,
        tripType: formData.tripType || null,
        numberOfPeople: parseInt(formData.numberOfPeople) || 1,
        notes: formData.notes.trim() || null,
        status: 'pending' // Can be upgraded to 'confirmed' after payment
      };

      const booking = await createGuideBooking(bookingData);
      
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
    </div>
  );
};

export default GuideBookingModal;
