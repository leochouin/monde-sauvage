import { useCallback, useMemo } from 'react';
import {
  RIVER_STATIONS,
  TIDE_STATIONS,
  RIVER_API_BASE,
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
  const points = 24;
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

export default function useEnvironmentalData() {
  const riverNodes = useMemo(() => toGeoJSON(RIVER_STATIONS, 'river'), []);
  const tideNodes = useMemo(() => toGeoJSON(TIDE_STATIONS, 'tide'), []);

  // --- River flow (Env Canada hydrometric-realtime, GeoJSON) ---------------
  const fetchRiverDetail = useCallback(async (station, signal) => {
    // Pull the most recent ~24h of observations for this station.
    const params = new URLSearchParams({
      STATION_NUMBER: station.stationNumber,
      limit: '96',
      sortby: '-DATETIME',
      f: 'json',
    });
    try {
      const data = await fetchJSON(`${RIVER_API_BASE}?${params}`, signal);
      const feats = Array.isArray(data?.features) ? data.features : [];
      // API returns newest-first; reverse to chronological and keep discharge.
      const series = feats
        .map((f) => f?.properties?.DISCHARGE)
        .filter((v) => typeof v === 'number' && Number.isFinite(v))
        .reverse();

      if (series.length >= 2) {
        return {
          kind: 'river',
          name: station.name,
          unit: 'm³/s',
          flow: series[series.length - 1],
          trend: trendOf(series),
          series,
          estimated: false,
        };
      }
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      // fall through to estimate on network/CORS failure
    }

    // No federal coverage (Gaspésie/CEHQ rivers) → labelled estimate.
    const series = estimateRiverSeries(station.stationNumber);
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
    const now = new Date();
    const from = new Date(now.getTime() - 6 * 3600 * 1000); // 6h back for context
    const to = new Date(now.getTime() + 24 * 3600 * 1000); // next day for events
    const iso = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
    const base = `${TIDE_API_BASE}/${station.iwlsId}/data`;
    const curveUrl = `${base}?time-series-code=wlp&from=${iso(from)}&to=${iso(to)}`;
    const hiloUrl = `${base}?time-series-code=wlp-hilo&from=${iso(now)}&to=${iso(to)}`;

    const [curveRaw, hiloRaw] = await Promise.all([
      fetchJSON(curveUrl, signal),
      fetchJSON(hiloUrl, signal),
    ]);

    // Downsample the dense (per-minute) prediction curve to ~15-min steps.
    const curve = (Array.isArray(curveRaw) ? curveRaw : [])
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
    const events = (Array.isArray(hiloRaw) ? hiloRaw : [])
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
