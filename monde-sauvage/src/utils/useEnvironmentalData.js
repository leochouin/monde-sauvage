import { useCallback, useMemo } from 'react';
import {
  RIVER_STATIONS,
  TIDE_STATIONS,
  TIDE_API_BASE,
} from './environmentalStations.js';

// ---------------------------------------------------------------------------
// useEnvironmentalData
//
// Pure data hook for the two additive map layers (river flow + tides). It does
// NOT touch the map — it only (a) exposes the static node GeoJSON used to draw
// the circles, and (b) lazily fetches per-station detail (value + time series)
// when a node is clicked. Live fetches use CORS-clean public APIs; there is no
// caching / IndexedDB layer here by design.
//
// Detail shapes returned to the drawer:
//   River: { kind:'river', name, flow, unit:'m³/s', trend:'rising'|'falling'|'steady',
//            series:number[] (chronological, ~24h), estimated:boolean }
//   Tide:  { kind:'tide', name, unit:'m', nextEvent:{type,label,time,height},
//            curve:[{ t:Date, v:number }], now:{ t:Date, v:number } }
// ---------------------------------------------------------------------------

const toGeoJSON = (stations, kind) => ({
  type: 'FeatureCollection',
  features: stations.map((s) => ({
    type: 'Feature',
    id: s.id,
    properties: { id: s.id, name: s.name, kind },
    geometry: { type: 'Point', coordinates: s.coordinates },
  })),
});

const trendOf = (series) => {
  if (!series || series.length < 2) return 'steady';
  const delta = series[series.length - 1] - series[series.length - 2];
  const scale = Math.max(Math.abs(series[series.length - 1]), 1) * 0.01;
  if (delta > scale) return 'rising';
  if (delta < -scale) return 'falling';
  return 'steady';
};

// Deterministic 24h débit estimate for stations the federal API doesn't cover
// (Gaspésie rivers are CEHQ-monitored). Clearly badged `estimated:true` in the
// UI — never presented as real-time. Seeded by station number so each river is
// stable + distinct across renders.
const estimateRiverSeries = (stationNumber) => {
  let seed = 0;
  for (const ch of stationNumber) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const base = 8 + (seed % 40); // m³/s, plausible small-river baseline
  const points = 14; // daily, to match the live CEHQ window (~14 days)
  const series = [];
  for (let i = 0; i < points; i += 1) {
    const diurnal = Math.sin((i / points) * Math.PI * 2 + (seed % 7)) * base * 0.12;
    const drift = ((seed >> (i % 5)) & 1 ? 1 : -1) * (i / points) * base * 0.05;
    const wobble = Math.sin(i * 1.7 + seed) * base * 0.03;
    series.push(Math.max(0.5, +(base + diurnal + drift + wobble).toFixed(2)));
  }
  return series;
};

const fetchJSON = async (url, signal) => {
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

// ---------------------------------------------------------------------------
// Pure government-API fetchers (no React). Each returns a normalized payload,
// or `null` on any failure — EXCEPT AbortError, which is re-thrown so the
// caller can cancel cleanly (a cancelled request is not a failed one, and must
// never overwrite fresh state after the user picks a different node).
// ---------------------------------------------------------------------------

// River flow — live CEHQ débit via our `cehq-river-flow` Supabase edge function.
// That function proxies the CORS-less CEHQ suivi-hydrologique feed, validates
// the station diffuses débit, and returns a small normalized payload:
//   { flow:number, unit:'m³/s', trend, series:number[] (daily, ~14d), observedAt }
// Returns null when there's no configured base, no station id, or the station
// has no live gauge → the drawer falls back to a badged estimate.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const RIVER_DEBIT_API_BASE = SUPABASE_URL
  ? `${SUPABASE_URL}/functions/v1/cehq-river-flow`
  : null;

export async function fetchRiverFlow(stationNumber, signal) {
  if (!RIVER_DEBIT_API_BASE || !stationNumber) return null;
  try {
    const data = await fetchJSON(
      `${RIVER_DEBIT_API_BASE}?station=${encodeURIComponent(stationNumber)}`,
      signal,
    );
    if (!data || typeof data.flow !== 'number' || !Array.isArray(data.series)) return null;
    return {
      flow: data.flow,
      trend: data.trend ?? 'steady',
      series: data.series, // real daily curve, oldest → newest
      observedAt: data.observedAt ? new Date(data.observedAt) : null,
    };
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    return null; // edge fn 404/5xx or network → estimate fallback
  }
}

// Tides — DFO IWLS. Fetches the two time-series codes in parallel over a
// 12h-back / 12h-ahead window: `wlp` (15-min prediction curve) and `wlp-hilo`
// (exact high/low events). Returns the two raw arrays, or null on failure.
export async function fetchTides(stationId, signal) {
  const now = Date.now();
  const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const from = iso(now - 12 * 3600 * 1000);
  const to = iso(now + 12 * 3600 * 1000);
  const base = `${TIDE_API_BASE}/${stationId}/data`;
  const get = (code) => fetchJSON(`${base}?time-series-code=${code}&from=${from}&to=${to}`, signal);
  try {
    const [wlp, hilo] = await Promise.all([get('wlp'), get('wlp-hilo')]);
    return { wlp: Array.isArray(wlp) ? wlp : [], hilo: Array.isArray(hilo) ? hilo : [] };
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    return null;
  }
}

export default function useEnvironmentalData() {
  const riverNodes = useMemo(() => toGeoJSON(RIVER_STATIONS, 'river'), []);
  const tideNodes = useMemo(() => toGeoJSON(TIDE_STATIONS, 'tide'), []);

  // --- River flow (live CEHQ débit via edge fn, else estimate) --------------
  const fetchRiverDetail = useCallback(async (station, signal) => {
    // Live débit + real daily series for stations with an active CEHQ gauge.
    // AbortError propagates (from fetchRiverFlow) for clean cancellation.
    const live = await fetchRiverFlow(station.stationNumber, signal);
    if (live) {
      return {
        kind: 'river',
        name: station.name,
        unit: 'm³/s',
        flow: live.flow,
        trend: live.trend,
        series: live.series, // real daily curve (~14d)
        estimated: false,
      };
    }

    // No active gauge (stationNumber: null) or feed unavailable → badged estimate.
    // Seed by station id so the fake curve is stable + distinct per river.
    const series = estimateRiverSeries(station.stationNumber || station.id);
    return {
      kind: 'river',
      name: station.name,
      unit: 'm³/s',
      flow: series[series.length - 1],
      trend: trendOf(series),
      series,
      estimated: true,
    };
  }, []);

  // --- Tides (DFO IWLS, fully live) ----------------------------------------
  const fetchTideDetail = useCallback(async (station, signal) => {
    const raw = await fetchTides(station.iwlsId, signal);
    if (!raw) throw new Error('tide-fetch-failed'); // surface the drawer's error state
    const now = new Date();

    // Downsample the dense (per-minute) prediction curve to ~15-min steps.
    const curve = raw.wlp
      .map((p) => ({ t: new Date(p.eventDate), v: p.value }))
      .filter((p) => Number.isFinite(p.v) && !Number.isNaN(p.t.getTime()))
      .filter((_, i) => i % 15 === 0);

    // Current level = curve point closest to now.
    let nowPoint = curve[0] || null;
    let best = Infinity;
    for (const p of curve) {
      const d = Math.abs(p.t.getTime() - now.getTime());
      if (d < best) { best = d; nowPoint = p; }
    }

    // Next high/low event strictly after now.
    const events = raw.hilo
      .map((p) => ({ t: new Date(p.eventDate), v: p.value }))
      .filter((p) => Number.isFinite(p.v) && p.t.getTime() > now.getTime())
      .sort((a, b) => a.t - b.t);

    let nextEvent = null;
    if (events.length) {
      // High vs low: compare against the median of the curve.
      const vals = curve.map((p) => p.v).sort((a, b) => a - b);
      const median = vals.length ? vals[Math.floor(vals.length / 2)] : events[0].v;
      const e = events[0];
      const type = e.v >= median ? 'high' : 'low';
      nextEvent = {
        type,
        label: type === 'high' ? 'Marée haute' : 'Marée basse',
        time: e.t,
        height: e.v,
      };
    }

    return {
      kind: 'tide',
      name: station.name,
      unit: 'm',
      curve,
      now: nowPoint,
      nextEvent,
    };
  }, []);

  return { riverNodes, tideNodes, fetchRiverDetail, fetchTideDetail };
}
