import React, { useEffect, useState, useCallback } from "react";
import { Calendar, dateFnsLocalizer } from "react-big-calendar";
import format from "date-fns/format";
import parse from "date-fns/parse";
import startOfWeek from "date-fns/startOfWeek";
import getDay from "date-fns/getDay";
import "react-big-calendar/lib/css/react-big-calendar.css";
import { enUS, frCA } from "date-fns/locale";
import { getGuideBookings, getFailedSyncBookings, retryCalendarSync, syncGuideBookingsWithCalendar } from "../utils/guideBookingService.js";

const locales = {
  "en-US": enUS,
  "fr-CA": frCA,
};

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek,
  getDay,
  locales,
});

// Colors to visually distinguish event types
const EVENT_COLORS = {
  booking: { bg: '#4A9B8E', border: '#3a8475' },       // Teal – reservations from DB
  google:  { bg: '#1a73e8', border: '#1557b0' },        // Blue – personal Google events
  syncFailed: { bg: '#e53e3e', border: '#c53030' },     // Red – calendar sync failed
};

export default function GuideCalendar({ guideId }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [view, setView] = useState("month");
  const [failedSyncs, setFailedSyncs] = useState([]);
  const [syncing, setSyncing] = useState(false);

  const now = new Date();
  const [range, setRange] = useState({
    start: new Date(now.getFullYear(), now.getMonth(), 1),
    end: new Date(now.getFullYear(), now.getMonth() + 1, 0),
  });

  const handleNavigate = (newDate) => {
    const start = new Date(newDate.getFullYear(), newDate.getMonth(), 1);
    const end = new Date(newDate.getFullYear(), newDate.getMonth() + 1, 0, 23, 59, 59);
    setRange({ start, end });
  };

  // Fetch bookings from guide_booking DB table (source of truth for reservations)
  const fetchBookingsFromDB = useCallback(async () => {
    try {
      const bookings = await getGuideBookings(guideId, {
        includeHistorical: true,
        startDate: range.start.toISOString(),
        endDate: range.end.toISOString(),
      });

      return bookings.map((b) => ({
        id: b.id,
        title: `🎣 ${b.customer_name || 'Réservation'}${b.trip_type ? ' – ' + b.trip_type : ''}`,
        start: new Date(b.start_time),
        end: new Date(b.end_time),
        allDay: false,
        source: 'booking',
        googleEventId: b.google_event_id || null,
        syncFailed: b.calendar_sync_failed || false,
        status: b.status,
        resource: b, // keep full booking data for tooltips / clicks
      }));
    } catch (err) {
      console.error('Error fetching bookings from DB:', err);
      return [];
    }
  }, [guideId, range]);

  // Fetch personal events from Google Calendar
  const fetchGoogleEvents = useCallback(async () => {
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      const res = await fetch(
        `${supabaseUrl}/functions/v1/google-calendar-availability?guideId=${guideId}&start=${range.start.toISOString()}&end=${range.end.toISOString()}`,
        {
          headers: {
            'Authorization': `Bearer ${supabaseKey}`,
          }
        }
      );

      const data = await res.json();
      console.log('🔍 Google Calendar API Response:', { ok: res.ok, status: res.status, data });

      if (!res.ok) {
        // If Google Calendar fails (token expired, etc.), surface the error but don't block
        console.warn('Google Calendar API error:', data);
        return { events: [], error: data };
      }

      if (data.items) {
        console.log('📅 Raw Google Calendar items count:', data.items.length);
        const formatted = data.items.map((event) => {
          const isAllDay = !event.start.dateTime;
          let start, end;
          
          if (isAllDay) {
            // For all-day events, Google returns dates in YYYY-MM-DD format
            // The end date is exclusive (day after), so we need to adjust
            start = new Date(event.start.date + 'T00:00:00');
            // Subtract 1 day from the end to get the actual last day of the event
            const endDate = new Date(event.end.date + 'T00:00:00');
            endDate.setDate(endDate.getDate() - 1);
            // Set to end of day
            end = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate(), 23, 59, 59);
          } else {
            start = new Date(event.start.dateTime);
            end = new Date(event.end.dateTime);
          }
          
          return {
            id: event.id,
            googleEventId: event.id,
            title: event.summary || 'Indisponible',
            description: event.description || '',
            start,
            end,
            allDay: isAllDay,
            source: 'google',
          };
        });
        return { events: formatted, error: null };
      }

      return { events: [], error: null };
    } catch (err) {
      console.error('Error fetching Google Calendar:', err);
      return { events: [], error: { error: 'Network error', description: err.message } };
    }
  }, [guideId, range]);

  useEffect(() => {
    if (!guideId) return;

    const fetchAll = async () => {
      setLoading(true);
      setError(null);

      // Fetch all three sources in parallel
      const [dbBookings, googleResult, failedSyncBookings] = await Promise.all([
        fetchBookingsFromDB(),
        fetchGoogleEvents(),
        getFailedSyncBookings(guideId),
      ]);

      setFailedSyncs(failedSyncBookings);

      // Collect google_event_ids from DB bookings so we can filter them out of Google events
      const bookingGoogleIds = new Set(
        dbBookings
          .filter((b) => b.googleEventId)
          .map((b) => b.googleEventId)
      );
      console.log('🗄️ DB Bookings count:', dbBookings.length);
      console.log('🔗 Booking Google IDs:', Array.from(bookingGoogleIds));
      console.log('📊 Google result events count:', googleResult.events?.length || 0);

      // Keep only Google events that are NOT already represented by a DB booking
      // Primary check: match by google_event_id
      // Fallback check: if a Google event description contains "Booking ID:" or
      //   "Monde Sauvage booking system", it was created by our system and should
      //   be hidden (the edge function normally filters these, but this is a safety net
      //   in case a stale response slips through).
      const personalGoogleEvents = (googleResult.events || []).filter((ge) => {
        // Primary: filter by matching google_event_id
        if (bookingGoogleIds.has(ge.googleEventId)) return false;
        // Fallback: filter by booking description markers (covers null google_event_id cases)
        const desc = ge.description || ge.resource?.description || '';
        if (desc.includes('Booking ID:') || desc.includes('Monde Sauvage booking system')) return false;
        return true;
      });
      console.log('✅ Personal Google events after filtering:', personalGoogleEvents.length);
      console.log('📋 Personal Google event details:', personalGoogleEvents);

      // Merge both sets
      const merged = [...dbBookings, ...personalGoogleEvents];
      console.log('🔀 Final merged events count:', merged.length);
      setEvents(merged);

      // Only surface Google error if there are zero Google events and error exists
      if (googleResult.error && personalGoogleEvents.length === 0 && dbBookings.length === 0) {
        setError(googleResult.error);
      }

      setLoading(false);
    };

    fetchAll();
  }, [guideId, range, fetchBookingsFromDB, fetchGoogleEvents]);

  // Custom event styling based on source
  const eventStyleGetter = (event) => {
    let colors;
    if (event.syncFailed) {
      colors = EVENT_COLORS.syncFailed;
    } else if (event.source === 'booking') {
      colors = EVENT_COLORS.booking;
    } else {
      colors = EVENT_COLORS.google;
    }
    const baseOpacity = event.status === 'cancelled' ? 0.5 : 0.85;
    
    return {
      style: {
        backgroundColor: colors.bg,
        borderLeft: `4px solid ${colors.border}`,
        color: 'white',
        borderRadius: '4px',
        fontSize: '12px',
        padding: '2px 6px',
        opacity: baseOpacity,
        border: `1px solid ${colors.border}`,
        fontWeight: event.source === 'google' ? '600' : '500',
      },
    };
  };

  // Handle manual sync
  const handleSync = async () => {
    setSyncing(true);
    try {
      await syncGuideBookingsWithCalendar(guideId);
      // Re-fetch everything after sync
      const [dbBookings, googleResult, failedSyncBookings] = await Promise.all([
        fetchBookingsFromDB(),
        fetchGoogleEvents(),
        getFailedSyncBookings(guideId),
      ]);
      setFailedSyncs(failedSyncBookings);
      const bookingGoogleIds = new Set(
        dbBookings.filter((b) => b.googleEventId).map((b) => b.googleEventId)
      );
      const personalGoogleEvents = (googleResult.events || []).filter((ge) => {
        if (bookingGoogleIds.has(ge.googleEventId)) return false;
        const desc = ge.description || '';
        if (desc.includes('Booking ID:') || desc.includes('Monde Sauvage booking system')) return false;
        return true;
      });
      setEvents([...dbBookings, ...personalGoogleEvents]);
    } catch (err) {
      console.error('Sync failed:', err);
    } finally {
      setSyncing(false);
    }
  };

  // Handle retry for a single booking
  const handleRetrySync = async (bookingId) => {
    try {
      const result = await retryCalendarSync(bookingId);
      if (result.success) {
        setFailedSyncs((prev) => prev.filter((b) => b.id !== bookingId));
        // Refresh bookings
        const dbBookings = await fetchBookingsFromDB();
        setEvents((prev) => {
          const nonDbEvents = prev.filter((e) => e.source !== 'booking');
          return [...dbBookings, ...nonDbEvents];
        });
      } else {
        // Check if authentication is needed
        if (result.needsAuth || result.requiresReauth) {
          const reconnect = confirm(
            `❌ ${result.error}\n\n` +
            `Votre connexion Google Calendar a expiré ou n'est pas valide.\n\n` +
            `Voulez-vous reconnecter votre compte Google maintenant?`
          );
          
          if (reconnect) {
            const redirectTo = encodeURIComponent(window.location.href);
            window.location.href = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-calendar-oauth?guideId=${guideId}&redirect_to=${redirectTo}`;
          }
        } else {
          // Show error to user
          alert(`Échec de la synchronisation: ${result.error}\n\nVérifiez la console pour plus de détails.`);
        }
      }
      return result;
    } catch (err) {
      console.error('Error in handleRetrySync:', err);
      alert(`Erreur de synchronisation: ${err.message}`);
      return { success: false, error: err.message };
    }
  };

  if (loading) return <p>Chargement du calendrier...</p>;

  if (error) {
    return (
      <div className="guide-calendar-error" style={{ 
        padding: "20px", 
        backgroundColor: "#fff3cd", 
        border: "1px solid #ffc107",
        borderRadius: "8px",
        color: "#856404"
      }}>
        <h3>❌ Erreur de calendrier</h3>
        <p><strong>{error.error}</strong></p>
        {error.description && <p>{error.description}</p>}
        {(error.googleError === "invalid_grant" || error.requiresReauth) && (
          <div style={{ marginTop: "15px" }}>
            <p style={{ fontWeight: "bold", marginBottom: "10px" }}>
              Votre connexion Google Calendar a expiré.
            </p>
            <button
              type="button"
              onClick={() => {
                const redirectTo = encodeURIComponent(globalThis.location.href);
                globalThis.location.href = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-calendar-oauth?guideId=${guideId}&redirect_to=${redirectTo}`;
              }}
              style={{
                padding: "10px 20px",
                backgroundColor: "#1a73e8",
                color: "white",
                border: "none",
                borderRadius: "6px",
                cursor: "pointer",
                fontSize: "14px",
                fontWeight: "500"
              }}
            >
              Reconnecter Google Calendar
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="guide-calendar-full" style={{ height: '100%', minHeight: '500px' }}>
      {/* Sync controls */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <div style={{ display: 'flex', gap: '16px', fontSize: '13px', flexWrap: 'wrap' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: 14, height: 14, borderRadius: 3, backgroundColor: EVENT_COLORS.booking.bg, display: 'inline-block' }} />
            Réservations (base de données)
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: 14, height: 14, borderRadius: 3, backgroundColor: EVENT_COLORS.google.bg, display: 'inline-block' }} />
            Événements Google Calendar
          </span>
          {failedSyncs.length > 0 && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ width: 14, height: 14, borderRadius: 3, backgroundColor: EVENT_COLORS.syncFailed.bg, display: 'inline-block' }} />
              Sync échouée ({failedSyncs.length})
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={handleSync}
          disabled={syncing}
          style={{
            padding: '6px 14px',
            backgroundColor: syncing ? '#ccc' : '#4A9B8E',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: syncing ? 'not-allowed' : 'pointer',
            fontSize: '12px',
            fontWeight: '500',
          }}
        >
          {syncing ? '🔄 Synchronisation...' : '🔄 Sync Google Calendar'}
        </button>
      </div>

      {/* Failed sync banner */}
      {failedSyncs.length > 0 && (
        <div style={{
          padding: '10px 14px',
          backgroundColor: '#fff5f5',
          border: '1px solid #fc8181',
          borderRadius: '6px',
          marginBottom: '10px',
          fontSize: '13px',
          color: '#c53030',
        }}>
          <strong>⚠️ {failedSyncs.length} réservation(s) non synchronisée(s) avec Google Calendar</strong>
          <div style={{ marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {failedSyncs.slice(0, 3).map((b) => (
              <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>{b.customer_name} — {new Date(b.start_time).toLocaleDateString('fr-CA')}</span>
                <button
                  type="button"
                  onClick={() => handleRetrySync(b.id)}
                  style={{
                    padding: '3px 10px',
                    backgroundColor: '#e53e3e',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '11px',
                  }}
                >
                  Réessayer
                </button>
              </div>
            ))}
            {failedSyncs.length > 3 && (
              <span style={{ fontStyle: 'italic', marginTop: '4px' }}>
                ...et {failedSyncs.length - 3} autre(s)
              </span>
            )}
          </div>
        </div>
      )}
      <Calendar
        key={range.start.toISOString()} 
        date={range.start}
        localizer={localizer}
        events={events}
        startAccessor="start"
        endAccessor="end"
        style={{ height: "100%" }}
        popup={true}
        onNavigate={handleNavigate}
        view={view}
        onView={(newView) => setView(newView)}
        eventPropGetter={eventStyleGetter}
        showMultiDayTimes={true}
        step={30}
        timeslots={2}
        dayLayoutAlgorithm="no-overlap"
        tooltipAccessor={(event) => event.title}
      />
    </div>
  );
}

