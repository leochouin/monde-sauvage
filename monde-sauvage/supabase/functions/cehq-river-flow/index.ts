// =============================================================================
// Edge Function: cehq-river-flow
// =============================================================================
// Public proxy for the CEHQ (Centre d'expertise hydrique du Québec) real-time
// hydrometric feed used by the map's river-flow layer.
//
// Why a proxy at all: the CEHQ "suivi hydrologique" JSON
//   https://www.cehq.gouv.qc.ca/depot/suivihydro/bd/JSON/{noStation}.json
// is served with NO CORS headers, so a browser cannot fetch it directly. It is
// also ~365 kB per station (nearly a year of daily data + forecast). This
// function fetches it server-side, validates the station actually diffuses
// débit, slices the observed series down to the last ~14 days, computes a trend,
// and returns a tiny normalized payload — cheap for users on 3G in the woods.
//
// Request:  GET ?station=021407      (6-digit CEHQ noStation)
// Response: 200 { station, name, river, flow, unit, trend, series, observedAt }
//           404 { available:false, reason } when the station has no live débit.
//
// verify_jwt = false (public data). The station id is strictly validated to
// /^\d{6}$/ and only ever interpolated into the fixed CEHQ URL, so this cannot
// be used as an open proxy for arbitrary hosts.
// =============================================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      // Let the CDN/browser cache briefly; CEHQ refreshes hourly.
      "Cache-Control": "public, max-age=900",
    },
  });

// débit rows in `sommaire` are tagged with this definition code.
const DEBIT_SEQ = 10;
// how many trailing daily points to keep for the sparkline (macro trend story).
const WINDOW_DAYS = 14;

interface SommaireRow {
  dateDonneeHydrique?: string;
  noSeqDefinitionDonnee?: number;
  valeurDonneeHydrique?: number | null;
  valeurCorrigeeEstimee?: number | null;
}

// Trend over the recent window: compare the latest value to ~3 points back,
// with a 5% dead-band so small wobble reads as "steady".
function computeTrend(series: number[]): "rising" | "falling" | "steady" {
  if (series.length < 2) return "steady";
  const last = series[series.length - 1];
  const ref = series[Math.max(0, series.length - 4)];
  const band = Math.max(Math.abs(last), 1) * 0.05;
  if (last - ref > band) return "rising";
  if (ref - last > band) return "falling";
  return "steady";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const station = new URL(req.url).searchParams.get("station")?.trim() ?? "";
  if (!/^\d{6}$/.test(station)) {
    return json({ available: false, reason: "invalid_station" }, 400);
  }

  const upstream = `https://www.cehq.gouv.qc.ca/depot/suivihydro/bd/JSON/${station}.json`;

  let raw: Record<string, unknown>;
  try {
    const res = await fetch(upstream, { headers: { Accept: "application/json" } });
    if (res.status === 404) return json({ available: false, reason: "closed_or_unknown" }, 404);
    if (!res.ok) return json({ available: false, reason: `upstream_${res.status}` }, 502);
    raw = await res.json();
  } catch (_err) {
    return json({ available: false, reason: "upstream_unreachable" }, 502);
  }

  // Only trust stations that actually publish débit (vs. niveau-only gauges).
  if (raw.indDiffusionDebitStation !== "O") {
    return json({ available: false, reason: "no_debit_diffusion" }, 404);
  }

  const sommaire = Array.isArray(raw.sommaire) ? (raw.sommaire as SommaireRow[]) : [];
  const valid: { date: string | null; value: number }[] = [];
  for (const r of sommaire) {
    if (r.noSeqDefinitionDonnee !== DEBIT_SEQ) continue;
    const v = typeof r.valeurDonneeHydrique === "number"
      ? r.valeurDonneeHydrique
      : (typeof r.valeurCorrigeeEstimee === "number" ? r.valeurCorrigeeEstimee : null);
    if (v !== null) valid.push({ date: r.dateDonneeHydrique ?? null, value: v });
  }

  const window = valid.slice(-WINDOW_DAYS);
  if (window.length < 2) {
    return json({ available: false, reason: "no_recent_data" }, 404);
  }

  const series = window.map((p) => p.value);
  const latest = window[window.length - 1];

  return json({
    station,
    name: raw.nomStation ?? null,
    river: raw.nomPlanEau ?? null,
    flow: latest.value,
    unit: "m³/s",
    trend: computeTrend(series),
    series, // daily observed débit, oldest → newest (~14 pts)
    observedAt: latest.date ?? null,
  });
});
