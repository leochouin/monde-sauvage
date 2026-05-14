import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Calendar, dateFnsLocalizer, Views } from 'react-big-calendar';
import format from 'date-fns/format';
import parse from 'date-fns/parse';
import startOfWeek from 'date-fns/startOfWeek';
import startOfDay from 'date-fns/startOfDay';
import endOfDay from 'date-fns/endOfDay';
import endOfWeek from 'date-fns/endOfWeek';
import startOfMonth from 'date-fns/startOfMonth';
import endOfMonth from 'date-fns/endOfMonth';
import getDay from 'date-fns/getDay';
import { frCA } from 'date-fns/locale';
import 'react-big-calendar/lib/css/react-big-calendar.css';

import supabase from '../utils/supabase.js';

const locales = {
  fr: frCA,
};

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek,
  getDay,
  locales,
});

const calendarMessages = {
  allDay: 'Journée',
  previous: 'Précédent',
  next: 'Suivant',
  today: "Aujourd'hui",
  month: 'Mois',
  week: 'Semaine',
  day: 'Jour',
  agenda: 'Agenda',
};

const ACTIVE_ALLOC_STATUSES = ['pending', 'pending_payment', 'confirmed', 'blocked'];

const SOURCE_COLORS = {
  chalet: { bg: '#047857', border: '#065f46' },
  equip: { bg: '#c2410c', border: '#9a3412' },
};

/** Chevauchement [a0,a1] vs [b0,b1]. */
function rangesOverlap(rangeStart, rangeEnd, evtStart, evtEnd) {
  return evtStart < rangeEnd && evtEnd > rangeStart;
}

/** Calendrier établissement : semaine / mois, réservations chalets + équipements. */
export default function EstablishmentCalendar({ establishmentKey, chalets }) {
  const now = useMemo(() => new Date(), []);
  const [view, setView] = useState(Views.WEEK);
  const [currentDate, setCurrentDate] = useState(now);
  const [rangeStart, setRangeStart] = useState(() => startOfWeek(now, { weekStartsOn: 1 }));
  const [rangeEnd, setRangeEnd] = useState(() => endOfWeek(now, { weekStartsOn: 1 }));
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState(null);

  const chaletIds = useMemo(() => chalets.map((c) => c.key ?? c.id).filter(Boolean), [chalets]);
  const chaletNameByKey = useMemo(() => {
    const m = new Map();
    for (const c of chalets) {
      const k = c.key ?? c.id;
      if (k) m.set(k, c.Name ?? c.name ?? 'Chalet');
    }
    return m;
  }, [chalets]);

  /** Met à jour l’intervalle chargé depuis la grille (navigation / vue). */
  const deriveRangeBounds = useCallback(
    /** @type {(d: Date, v: string) => void} */
    (d, v) => {
      if (v === Views.MONTH) {
        const s = startOfMonth(d);
        const e = endOfMonth(d);
        setRangeStart(startOfDay(s));
        setRangeEnd(endOfDay(e));
      } else {
        const s = startOfWeek(d, { weekStartsOn: 1 });
        const e = endOfWeek(d, { weekStartsOn: 1 });
        setRangeStart(startOfDay(s));
        setRangeEnd(endOfDay(e));
      }
    },
    [],
  );

  useEffect(() => {
    deriveRangeBounds(currentDate, view);
  }, [currentDate, view, deriveRangeBounds]);

  const loadEvents = useCallback(async () => {
    if (!establishmentKey || chaletIds.length === 0) {
      setEvents([]);
      setFetchError(null);
      return;
    }

    setLoading(true);
    setFetchError(null);
    try {
      const rs = rangeStart.toISOString();
      const re = rangeEnd.toISOString();

      const [{ data: bookingRows, error: bookErr }, allocResult] = await Promise.all([
        supabase
          .from('bookings')
          .select(
            'id, chalet_id, start_date, end_date, status, customer_name, customer_email, payment_status',
          )
          .in('chalet_id', chaletIds)
          .lte('start_date', re)
          .gte('end_date', rs)
          .neq('status', 'cancelled'),
        supabase
          .from('booking_inventory_allocation')
          .select(
            `
              id,
              start_at,
              end_at,
              status,
              chalet_booking_id,
              inventory_unit:inventory_unit_id!inner (
                display_name,
                unit_code,
                establishment_id
              ),
              bookings:chalet_booking_id (
                id,
                chalet_id,
                customer_name,
                customer_email,
                status
              )
            `,
          )
          .eq('inventory_unit.establishment_id', establishmentKey)
          .lte('start_at', re)
          .gte('end_at', rs)
          .in('status', ACTIVE_ALLOC_STATUSES),
      ]);

      if (bookErr) throw bookErr;

      const { data: rowsAlloc, error: errAllocFinal } = allocResult;

      if (errAllocFinal) {
        console.warn('EstablishmentCalendar: allocations non chargées', errAllocFinal);
      }

      const list = [];

      for (const b of bookingRows || []) {
        if (!rangesOverlap(rs, re, new Date(b.start_date), new Date(b.end_date))) continue;
        const chName = chaletNameByKey.get(b.chalet_id) || 'Chalet';
        const label = (b.customer_name || b.customer_email || 'Réservation').trim();
        list.push({
          id: `b-${b.id}`,
          title: `🏠 ${chName} — ${label}`,
          start: new Date(b.start_date),
          end: new Date(b.end_date),
          allDay: true,
          source: 'chalet',
          resource: b,
        });
      }

      for (const row of rowsAlloc || []) {
        const st = row.start_at ? new Date(row.start_at) : null;
        const en = row.end_at ? new Date(row.end_at) : null;
        if (!st || !en || !rangesOverlap(rs, re, st, en)) continue;
        const unit = Array.isArray(row.inventory_unit)
          ? row.inventory_unit[0]
          : row.inventory_unit;
        let booking = row.bookings;
        if (Array.isArray(booking)) booking = booking[0];
        const ucode = unit?.display_name || unit?.unit_code || 'Équipement';
        const guest = booking?.customer_name || booking?.customer_email || 'Client';
        const chId = booking?.chalet_id;
        const chName = chId ? chaletNameByKey.get(chId) || '' : '';
        list.push({
          id: `a-${row.id}`,
          title: `${chName ? `${chName} · ` : ''}🛶 ${ucode} (${guest})`,
          start: st,
          end: en,
          allDay: false,
          source: 'equip',
          resource: row,
        });
      }

      setEvents(list);
    } catch (e) {
      console.error(e);
      setFetchError(e.message || String(e));
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [establishmentKey, chaletIds, rangeStart, rangeEnd, chaletNameByKey]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  const eventPropGetter = useCallback((ev) => {
    const palette = SOURCE_COLORS[ev.source === 'equip' ? 'equip' : 'chalet'];
    return {
      style: {
        backgroundColor: palette.bg,
        borderColor: palette.border,
        color: '#fff',
        borderWidth: '1px',
        borderStyle: 'solid',
        borderRadius: '6px',
        padding: '1px 4px',
      },
    };
  }, []);

  const handleNavigate = useCallback((date) => {
    setCurrentDate(date);
    deriveRangeBounds(date, view);
  }, [view, deriveRangeBounds]);

  const handleOnView = useCallback(
    /** @type {(next: string) => void} */
    (nextView) => {
      setView(nextView);
      deriveRangeBounds(currentDate, nextView);
    },
    [currentDate, deriveRangeBounds],
  );

  if (!establishmentKey) return null;

  return (
    <div className="establishment-calendar" style={{ marginTop: 14 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 10,
          marginBottom: 10,
        }}
      >
        <div style={{ display: 'flex', gap: 14, fontSize: 12.5, flexWrap: 'wrap', color: '#475569' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span
              aria-hidden
              style={{
                width: 14,
                height: 14,
                borderRadius: 3,
                background: SOURCE_COLORS.chalet.bg,
              }}
            />
            Chalets
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span
              aria-hidden
              style={{
                width: 14,
                height: 14,
                borderRadius: 3,
                background: SOURCE_COLORS.equip.bg,
              }}
            />
            Équipements
          </span>
        </div>
        <div style={{ fontSize: 12, color: '#64748b' }}>
          {loading ? 'Chargement…' : `${events.length} événement${events.length !== 1 ? 's' : ''}`}
        </div>
      </div>

      {fetchError && (
        <div
          style={{
            padding: '10px 12px',
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: 8,
            color: '#991b1b',
            fontSize: 13,
            marginBottom: 10,
          }}
        >
          {fetchError.includes('JWT') ? (
            <>
              Droits lecture réservations ou allocations insuffisants. Appliquez la migration&nbsp;
              <code style={{ fontSize: 12 }}>20260511123000_bookings_owner_select.sql</code> ou contactez&nbsp;
              un admin.
            </>
          ) : (
            fetchError
          )}
        </div>
      )}

      <div style={{ height: 'min(70vh, 640px)', minHeight: 480 }}>
        <Calendar
          culture="fr"
          messages={calendarMessages}
          localizer={localizer}
          date={currentDate}
          onNavigate={handleNavigate}
          view={view}
          onView={handleOnView}
          views={[Views.WEEK, Views.MONTH]}
          events={events}
          startAccessor="start"
          endAccessor="end"
          eventPropGetter={eventPropGetter}
          popup
          showMultiDayTimes
          tooltipAccessor={(e) => e.title}
          step={60}
          timeslots={2}
          dayLayoutAlgorithm="no-overlap"
          formats={{
            timeGutterFormat: (d) => format(d, 'HH:mm', { locale: frCA }),
            eventTimeRangeFormat: ({ start, end }) =>
              `${format(start, 'HH:mm', { locale: frCA })} – ${format(end, 'HH:mm', { locale: frCA })}`,
          }}
        />
      </div>

      {!loading && establishmentKey && chaletIds.length === 0 && (
        <p style={{ marginTop: 10, fontSize: 13, color: '#64748b' }}>
          Ajoutez un chalet pour afficher vos réservations ici.
        </p>
      )}
    </div>
  );
}
