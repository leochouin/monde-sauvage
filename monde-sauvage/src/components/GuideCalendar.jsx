import React, { useEffect, useState } from "react";
import { Calendar, dateFnsLocalizer } from "react-big-calendar";
import format from "date-fns/format";
import parse from "date-fns/parse";
import startOfWeek from "date-fns/startOfWeek";
import getDay from "date-fns/getDay";
import "react-big-calendar/lib/css/react-big-calendar.css";
import { enUS, frCA } from "date-fns/locale";

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

export default function GuideCalendar({ guideId }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [view, setView] = useState("month");


  const now = new Date();
  const [range, setRange] = useState({
    start: new Date(now.getFullYear(), now.getMonth(), 1),
    end: new Date(now.getFullYear(), now.getMonth() + 1, 0),
  });


  const handleNavigate = (newDate) => {
    const start = new Date(newDate.getFullYear(), newDate.getMonth(), 1);
    const end = new Date(newDate.getFullYear(), newDate.getMonth() + 1, 0, 23, 59, 59);
    console.log(start, end)
    setRange({ start, end });
};
  

  useEffect(() => {
    if (!guideId) return;

    const fetchEvents = async () => {
      try {
        setError(null);
        const res = await fetch(
          `https://fhpbftdkqnkncsagvsph.functions.supabase.co/google-calendar-availability?guideId=${guideId}&start=${range.start.toISOString()}&end=${range.end.toISOString()}`
        );
        
        const data = await res.json();

        if (!res.ok) {
          console.error("Error response from API:", data);
          setError(data);
          setEvents([]);
          setLoading(false);
          return;
        }

        if (data.items) {
          const formatted = data.items.map((event) => ({
            title: event.summary || "Indisponible",
            start: new Date(event.start.dateTime || event.start.date),
            end: new Date(event.end.dateTime || event.end.date),
            allDay: !event.start.dateTime,
          }));

          setEvents(formatted);
        }
      } catch (err) {
        console.error("Error fetching calendar:", err);
        setError({ error: "Network error", description: err.message });
      } finally {
        setLoading(false);
      }
    };

    fetchEvents();
  }, [guideId, range]);

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
                globalThis.location.href = `http://127.0.0.1:54321/functions/v1/google-calendar-oauth?guideId=${guideId}&redirect_to=${redirectTo}`;
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
    <div className="guide-calendar-full">
      <Calendar
        key={range.start.toISOString()} 
        date={range.start}  // ← forces a full reset when month changes
        localizer={localizer}
        events={events}
        startAccessor="start"
        endAccessor="end"
        style={{ height: "100%" }}
        popup
        onNavigate={handleNavigate}
        view={view}
        onView={(newView) => setView(newView)}
      />
    </div>
  );
}

