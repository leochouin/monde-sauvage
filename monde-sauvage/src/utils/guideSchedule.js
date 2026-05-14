// Defaults for converting all-day Google Calendar entries into bookable
// fishing sessions. A guide day runs 08:00–16:00 local time (8 hours).

export const DEFAULT_DAY_HOURS = 8;
export const DEFAULT_DAY_START_HOUR = 8; // 08:00 local
export const DEFAULT_SESSIONS = [
  { label: 'Journée', startHour: DEFAULT_DAY_START_HOUR, durationHours: DEFAULT_DAY_HOURS },
];

const cloneDateAtHour = (date, hour) => {
  const d = new Date(date);
  d.setHours(hour, 0, 0, 0);
  return d;
};

const enumerateDays = (startDate, endDate) => {
  const out = [];
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(0, 0, 0, 0);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    out.push(new Date(d));
  }
  return out;
};

const getGuideSessions = (guideConfig) => {
  const sessions = guideConfig?.sessions;
  if (Array.isArray(sessions) && sessions.length > 0) return sessions;

  // Allow simpler config: { dayHours, dayStart } → single session
  const dayHours = guideConfig?.dayHours ?? DEFAULT_DAY_HOURS;
  const dayStart = guideConfig?.dayStart ?? DEFAULT_DAY_START_HOUR;
  return [{ label: 'Journée', startHour: dayStart, durationHours: dayHours }];
};

/**
 * Expands an all-day event into one or more concrete fishing sessions.
 * For multi-day all-day events (e.g. "blocked off June 10–12"), generates
 * sessions for each day in the range.
 *
 * @param {object} event - { id, title, start (Date), end (Date), ... }
 * @param {object} guideConfig - { dayHours?, dayStart?, sessions?: [{label, startHour, durationHours}] }
 * @returns {object[]} - Array of session events
 */
export function expandAllDayEvent(event, guideConfig = {}) {
  const sessions = getGuideSessions(guideConfig);
  const days = enumerateDays(event.start, event.end);

  return days.flatMap((day) =>
    sessions.map((s, sessionIdx) => ({
      ...event,
      id: `${event.id}__${day.toISOString().slice(0, 10)}__${sessionIdx}`,
      sourceEventId: event.id,
      start: cloneDateAtHour(day, s.startHour),
      end: cloneDateAtHour(day, s.startHour + s.durationHours),
      sessionLabel: s.label,
      durationHours: s.durationHours,
      derivedFromAllDay: true,
      allDay: false,
    }))
  );
}

/**
 * Hours covered by a session/event. Falls back to wall-clock delta for
 * non-derived events.
 */
export function sessionDurationHours(event) {
  if (typeof event?.durationHours === 'number') return event.durationHours;
  if (!event?.start || !event?.end) return 0;
  return (new Date(event.end) - new Date(event.start)) / 3_600_000;
}

/**
 * Compute a price for a session/event using either a flat session price
 * or an hourly rate × duration.
 */
export function computeSessionPrice(event, { hourlyRate, dayPrice } = {}) {
  const hours = sessionDurationHours(event);
  if (typeof dayPrice === 'number' && hours <= DEFAULT_DAY_HOURS) return dayPrice;
  if (typeof hourlyRate === 'number') return Math.round(hourlyRate * hours);
  return null;
}
