import { useState, useEffect } from 'react';
import { getGuideBookings } from '../utils/guideBookingService.js';

/**
 * Guide Availability Calendar Modal
 * A visual calendar showing which dates a guide is available/unavailable
 * 
 * Features:
 * - Month navigation
 * - Visual indication of booked dates (crossed out)
 * - Clean calendar layout
 * - Responsive design
 */
export default function GuideAvailabilityCalendarModal({
  guide,
  isOpen,
  onClose,
  dateRange = null // Optional: { startDate, endDate } to highlight initial dates
}) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const monthNames = [
    'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
    'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'
  ];

  const dayNames = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

  // Accept guides from any source: map listings use `guide_id`, while raw DB
  // rows use `id`. Without this normalization the modal silently bailed out
  // and reservations never showed up.
  const guideId = guide?.id || guide?.guide_id || null;

  /**
   * Load bookings for the current month (and the surrounding months so users
   * can scroll back/forward without re-fetching constantly). We widen the
   * query window by one month on each side and use overlap semantics so a
   * booking that spans a month boundary is still rendered.
   */
  useEffect(() => {
    if (!isOpen || !guideId) return;

    const loadBookings = async () => {
      setLoading(true);
      setError(null);
      try {
        const year = currentMonth.getFullYear();
        const month = currentMonth.getMonth();

        // Window: previous month → 2 months ahead (inclusive end of day).
        const startDate = new Date(year, month - 1, 1).toISOString();
        const endDate = new Date(year, month + 3, 0, 23, 59, 59, 999).toISOString();

        const data = await getGuideBookings(guideId, {
          startDate,
          endDate,
          includeDeleted: false,
          includeCancelled: false,
          // Always include historical bookings when an explicit window is set
          // (the date-range branch already short-circuits the "future only"
          // filter inside getGuideBookings).
          includeHistorical: true,
        });

        setBookings(data || []);
      } catch (err) {
        console.error('❌ Error loading bookings:', err);
        setError('Impossible de charger les disponibilités');
      } finally {
        setLoading(false);
      }
    };

    loadBookings();
  }, [isOpen, guideId, currentMonth]);

  /**
   * Check if a specific date is booked
   */
  const isDateBooked = (date) => {
    return bookings.some(booking => {
      const start = new Date(booking.start_time);
      const end = new Date(booking.end_time);
      const checkDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

      const bookingStart = new Date(start.getFullYear(), start.getMonth(), start.getDate());
      const bookingEnd = new Date(end.getFullYear(), end.getMonth(), end.getDate());

      // Check if checkDate falls within the booking range
      return checkDate >= bookingStart && checkDate <= bookingEnd;
    });
  };

  /**
   * Check if a date is today
   */
  const isToday = (date) => {
    const today = new Date();
    return (
      date.getFullYear() === today.getFullYear() &&
      date.getMonth() === today.getMonth() &&
      date.getDate() === today.getDate()
    );
  };

  /**
   * Check if a date is in the past
   */
  const isPast = (date) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const checkDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    return checkDate < today;
  };

  /**
   * Generate array of dates for the calendar view
   */
  const generateCalendarDates = () => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();

    // First day of the month
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    // Padding for days from previous month
    const startDate = new Date(firstDay);
    startDate.setDate(startDate.getDate() - firstDay.getDay());

    // Generate 42 days (6 weeks)
    const dates = [];
    for (let i = 0; i < 42; i++) {
      dates.push(new Date(startDate));
      startDate.setDate(startDate.getDate() + 1);
    }

    return dates;
  };

  /**
   * Navigate to previous month
   */
  const handlePrevMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
  };

  /**
   * Navigate to next month
   */
  const handleNextMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
  };

  /**
   * Navigate to today
   */
  const handleToday = () => {
    setCurrentMonth(new Date());
  };

  if (!isOpen) return null;

  const dates = generateCalendarDates();
  const currentYear = currentMonth.getFullYear();
  const currentMonthIndex = currentMonth.getMonth();

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.4)',
          zIndex: 1000,
        }}
      />

      {/* Modal */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          backgroundColor: 'white',
          borderRadius: '12px',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)',
          zIndex: 1001,
          maxWidth: '500px',
          width: '90%',
          maxHeight: '90vh',
          overflowY: 'auto',
          padding: '24px',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '20px',
            paddingBottom: '16px',
            borderBottom: '1px solid #E5E7EB',
          }}
        >
          <div>
            <h2 style={{ margin: '0 0 4px', fontSize: '18px', color: '#1F3A2E', fontWeight: '700' }}>
              Disponibilités de {guide?.name || 'Guide'}
            </h2>
            <p style={{ margin: 0, fontSize: '12px', color: '#5A7766' }}>
              Calendrier des réservations
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '28px',
              color: '#5A7766',
              cursor: 'pointer',
              padding: 0,
              width: '32px',
              height: '32px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            ×
          </button>
        </div>

        {/* Error message */}
        {error && (
          <div
            style={{
              padding: '12px',
              backgroundColor: '#FEE2E2',
              color: '#991B1B',
              borderRadius: '8px',
              fontSize: '13px',
              marginBottom: '16px',
            }}
          >
            {error}
          </div>
        )}

        {/* Loading state */}
        {loading && !error && (
          <div
            style={{
              textAlign: 'center',
              padding: '40px 20px',
              color: '#5A7766',
            }}
          >
            Chargement du calendrier...
          </div>
        )}

        {/* Calendar */}
        {!loading && (
          <>
            {/* Month navigation */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '20px',
              }}
            >
              <button
                onClick={handlePrevMonth}
                style={{
                  backgroundColor: '#F0FDF4',
                  border: '1px solid #D1FAE5',
                  borderRadius: '6px',
                  padding: '8px 12px',
                  fontSize: '14px',
                  color: '#059669',
                  fontWeight: '600',
                  cursor: 'pointer',
                  transition: 'background-color 0.2s',
                }}
                onMouseEnter={(e) => (e.target.style.backgroundColor = '#D1FAE5')}
                onMouseLeave={(e) => (e.target.style.backgroundColor = '#F0FDF4')}
              >
                ← Précédent
              </button>

              <div style={{ textAlign: 'center', flex: 1, margin: '0 12px' }}>
                <h3
                  style={{
                    margin: 0,
                    fontSize: '16px',
                    color: '#1F3A2E',
                    fontWeight: '700',
                  }}
                >
                  {monthNames[currentMonthIndex]} {currentYear}
                </h3>
                <button
                  onClick={handleToday}
                  style={{
                    marginTop: '6px',
                    background: 'none',
                    border: '1px solid #C5D2CB',
                    borderRadius: '4px',
                    padding: '4px 8px',
                    fontSize: '11px',
                    color: '#2D5F4C',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={(e) => {
                    e.target.backgroundColor = '#F0FDF4';
                  }}
                  onMouseLeave={(e) => {
                    e.target.backgroundColor = 'transparent';
                  }}
                >
                  Aujourd'hui
                </button>
              </div>

              <button
                onClick={handleNextMonth}
                style={{
                  backgroundColor: '#F0FDF4',
                  border: '1px solid #D1FAE5',
                  borderRadius: '6px',
                  padding: '8px 12px',
                  fontSize: '14px',
                  color: '#059669',
                  fontWeight: '600',
                  cursor: 'pointer',
                  transition: 'background-color 0.2s',
                }}
                onMouseEnter={(e) => (e.target.style.backgroundColor = '#D1FAE5')}
                onMouseLeave={(e) => (e.target.style.backgroundColor = '#F0FDF4')}
              >
                Suivant →
              </button>
            </div>

            {/* Day headers */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(7, 1fr)',
                gap: '8px',
                marginBottom: '12px',
              }}
            >
              {dayNames.map((day) => (
                <div
                  key={day}
                  style={{
                    textAlign: 'center',
                    fontSize: '12px',
                    fontWeight: '700',
                    color: '#2D5F4C',
                  }}
                >
                  {day}
                </div>
              ))}
            </div>

            {/* Calendar grid */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(7, 1fr)',
                gap: '8px',
                marginBottom: '20px',
              }}
            >
              {dates.map((date, idx) => {
                const isCurrentMonth = date.getMonth() === currentMonthIndex;
                const booked = isDateBooked(date);
                const today = isToday(date);
                const past = isPast(date);

                return (
                  <div
                    key={idx}
                    title={
                      booked
                        ? `Réservé: ${date.toLocaleDateString('fr-FR')}`
                        : `Disponible: ${date.toLocaleDateString('fr-FR')}`
                    }
                    style={{
                      aspectRatio: '1',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: '8px',
                      fontSize: '13px',
                      fontWeight: '600',
                      cursor: 'default',
                      backgroundColor: !isCurrentMonth
                        ? '#F9FAFB'
                        : booked
                        ? '#FEE2E2'
                        : today
                        ? '#D1FAE5'
                        : '#FFFCF7',
                      color: !isCurrentMonth
                        ? '#9CA3AF'
                        : booked
                        ? '#7F1D1D'
                        : today
                        ? '#015F41'
                        : past
                        ? '#9CA3AF'
                        : '#1F3A2E',
                      border:
                        today
                          ? '2px solid #059669'
                          : booked
                          ? '1px solid #FECACA'
                          : '1px solid #E5E7EB',
                      textDecoration: booked ? 'line-through' : 'none',
                      opacity: past && !today ? 0.6 : 1,
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {date.getDate()}
                  </div>
                );
              })}
            </div>

            {/* Legend */}
            <div
              style={{
                backgroundColor: '#F9FAFB',
                borderRadius: '8px',
                padding: '12px',
                fontSize: '12px',
              }}
            >
              <div style={{ marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div
                  style={{
                    width: '16px',
                    height: '16px',
                    borderRadius: '4px',
                    backgroundColor: '#FFFCF7',
                    border: '1px solid #E5E7EB',
                  }}
                />
                <span style={{ color: '#1F3A2E' }}>Disponible</span>
              </div>
              <div style={{ marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div
                  style={{
                    width: '16px',
                    height: '16px',
                    borderRadius: '4px',
                    backgroundColor: '#FEE2E2',
                    border: '1px solid #FECACA',
                    textDecoration: 'line-through',
                  }}
                />
                <span style={{ color: '#7F1D1D' }}>Réservé</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div
                  style={{
                    width: '16px',
                    height: '16px',
                    borderRadius: '4px',
                    backgroundColor: '#D1FAE5',
                    border: '2px solid #059669',
                  }}
                />
                <span style={{ color: '#015F41' }}>Aujourd'hui</span>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
