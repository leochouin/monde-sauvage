import { useEffect, useMemo, useRef, useState } from 'react';

// Bottom-sheet drawer for the river-flow / tide map layers. Deliberately built
// with the same hand-rolled, inline-styled, CSS-transition approach as the
// existing mobile sheet in Map.jsx (no framer-motion / Tailwind — neither is in
// this project). It owns its own fetch lifecycle: when `selection` changes it
// calls the matching fetcher from useEnvironmentalData, with cancellation.

const PANEL_BG = '#FBFAF6';
const INK = '#1F3A2E';
const MUTED = '#6B7A70';
const RIVER_BLUE = '#2563EB';
const TIDE_TEAL = '#0E9C93';

const fmtTime = (d) =>
  d instanceof Date && !Number.isNaN(d.getTime())
    ? d.toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' })
    : '--:--';

// --- Inline SVG: 24h river sparkline ---------------------------------------
function Sparkline({ series, color }) {
  const W = 300;
  const H = 72;
  const P = 6;
  const path = useMemo(() => {
    if (!series || series.length < 2) return null;
    const min = Math.min(...series);
    const max = Math.max(...series);
    const span = max - min || 1;
    const stepX = (W - P * 2) / (series.length - 1);
    const pts = series.map((v, i) => {
      const x = P + i * stepX;
      const y = P + (H - P * 2) * (1 - (v - min) / span);
      return [x, y];
    });
    const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${H - P} L${pts[0][0].toFixed(1)},${H - P} Z`;
    return { line, area, last: pts[pts.length - 1] };
  }, [series]);

  if (!path) return null;
  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Tendance du débit sur ~14 jours">
      <path d={path.area} fill={color} opacity="0.12" />
      <path d={path.line} fill="none" stroke={color} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={path.last[0]} cy={path.last[1]} r="3.4" fill={color} />
    </svg>
  );
}

// --- Inline SVG: daily tide curve with current-time dot --------------------
function TideCurve({ curve, now, color }) {
  const W = 300;
  const H = 96;
  const P = 8;
  const geo = useMemo(() => {
    if (!curve || curve.length < 2) return null;
    const t0 = curve[0].t.getTime();
    const t1 = curve[curve.length - 1].t.getTime();
    const tSpan = t1 - t0 || 1;
    const min = Math.min(...curve.map((p) => p.v));
    const max = Math.max(...curve.map((p) => p.v));
    const vSpan = max - min || 1;
    const xOf = (t) => P + (W - P * 2) * ((t - t0) / tSpan);
    const yOf = (v) => P + (H - P * 2) * (1 - (v - min) / vSpan);
    const pts = curve.map((p) => [xOf(p.t.getTime()), yOf(p.v)]);
    const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${H - P} L${pts[0][0].toFixed(1)},${H - P} Z`;
    const dot = now ? [xOf(now.t.getTime()), yOf(now.v)] : null;
    return { line, area, dot };
  }, [curve, now]);

  if (!geo) return null;
  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Courbe des marées du jour">
      <path d={geo.area} fill={color} opacity="0.12" />
      <path d={geo.line} fill="none" stroke={color} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
      {geo.dot && (
        <>
          <line x1={geo.dot[0]} y1={P} x2={geo.dot[0]} y2={H - P} stroke={color} strokeWidth="1" strokeDasharray="3 3" opacity="0.5" />
          <circle cx={geo.dot[0]} cy={geo.dot[1]} r="5" fill="#fff" stroke={color} strokeWidth="2.5" />
        </>
      )}
    </svg>
  );
}

function TrendArrow({ trend }) {
  const map = {
    rising: { color: '#16A34A', d: 'M8 12 L8 3 M4 7 L8 3 L12 7' },
    falling: { color: '#DC2626', d: 'M8 3 L8 13 M4 9 L8 13 L12 9' },
    steady: { color: MUTED, d: 'M3 8 L13 8' },
  };
  const t = map[trend] || map.steady;
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d={t.d} fill="none" stroke={t.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const trendLabel = { rising: 'En hausse', falling: 'En baisse', steady: 'Stable' };

/**
 * @param {object}   props
 * @param {{ type:'river'|'tide', station:object }|null} props.selection
 * @param {(station:object, signal:AbortSignal)=>Promise<object>} props.fetchRiverDetail
 * @param {(station:object, signal:AbortSignal)=>Promise<object>} props.fetchTideDetail
 * @param {()=>void} props.onClose
 */
export default function EnvironmentalDrawer({ selection, fetchRiverDetail, fetchTideDetail, onClose }) {
  const [visible, setVisible] = useState(false);
  const [detail, setDetail] = useState(null);
  const [status, setStatus] = useState('idle'); // idle | loading | ready | error
  const rafRef = useRef(0);

  // Slide-up: mount hidden, flip `visible` on next frame so the CSS transition runs.
  useEffect(() => {
    if (selection) {
      rafRef.current = requestAnimationFrame(() => setVisible(true));
    } else {
      setVisible(false);
    }
    return () => cancelAnimationFrame(rafRef.current);
  }, [selection]);

  // Fetch detail for the current selection, cancel on change/unmount.
  useEffect(() => {
    if (!selection) return undefined;
    const controller = new AbortController();
    setStatus('loading');
    setDetail(null);
    const run = selection.type === 'river' ? fetchRiverDetail : fetchTideDetail;
    run(selection.station, controller.signal)
      .then((d) => { setDetail(d); setStatus('ready'); })
      .catch((err) => { if (err?.name !== 'AbortError') setStatus('error'); });
    return () => controller.abort();
  }, [selection, fetchRiverDetail, fetchTideDetail]);

  // Close after the slide-down transition finishes.
  const requestClose = () => {
    setVisible(false);
    setTimeout(onClose, 320);
  };

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') requestClose(); };
    if (selection) globalThis.addEventListener('keydown', onKey);
    return () => globalThis.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection]);

  if (!selection) return null;
  const accent = selection.type === 'river' ? RIVER_BLUE : TIDE_TEAL;

  return (
    <>
      {/* Scrim */}
      <div
        onClick={requestClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 1200,
          background: 'rgba(20, 32, 26, 0.32)',
          opacity: visible ? 1 : 0,
          transition: 'opacity 0.32s ease',
        }}
      />
      {/* Sheet */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${selection.type === 'river' ? 'Débit' : 'Marées'} — ${selection.station.name}`}
        style={{
          position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 1201,
          margin: '0 auto', maxWidth: 480,
          background: PANEL_BG,
          borderRadius: '20px 20px 0 0',
          boxShadow: '0 -12px 40px rgba(31, 58, 46, 0.24)',
          padding: '10px 20px 24px',
          boxSizing: 'border-box',
          fontFamily: '"Avenir Next", "Segoe UI", Roboto, sans-serif',
          color: INK,
          transform: visible ? 'translateY(0)' : 'translateY(105%)',
          transition: 'transform 0.34s cubic-bezier(0.32, 0.72, 0, 1)',
          willChange: 'transform',
        }}
      >
        {/* Grab handle */}
        <div style={{ width: 40, height: 4, borderRadius: 2, background: '#D8DED8', margin: '0 auto 14px' }} />

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: accent, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase', color: MUTED, fontWeight: 600 }}>
              {selection.type === 'river' ? 'Débit de rivière' : 'Marées'}
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {selection.station.name}
            </div>
          </div>
          <button
            onClick={requestClose}
            aria-label="Fermer"
            style={{ border: 'none', background: '#EFEDE6', borderRadius: '50%', width: 32, height: 32, flexShrink: 0, padding: 0, boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 18, lineHeight: 1, color: MUTED }}
          >×</button>
        </div>

        {status === 'loading' && <div style={{ padding: '28px 0', textAlign: 'center', color: MUTED }}>Chargement des données…</div>}
        {status === 'error' && <div style={{ padding: '28px 0', textAlign: 'center', color: '#DC2626' }}>Données indisponibles pour le moment.</div>}

        {status === 'ready' && detail?.kind === 'river' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontSize: 40, fontWeight: 800, letterSpacing: -1 }}>{detail.flow.toLocaleString('fr-CA')}</span>
              <span style={{ fontSize: 16, color: MUTED, fontWeight: 600 }}>{detail.unit}</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 'auto', fontSize: 13, fontWeight: 600 }}>
                <TrendArrow trend={detail.trend} /> {trendLabel[detail.trend]}
              </span>
            </div>
            <div style={{ marginTop: 14 }}>
              <Sparkline series={detail.series} color={accent} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: MUTED, marginTop: 2 }}>
              <span>−14 j</span><span>aujourd'hui</span>
            </div>
            {detail.estimated && (
              <div style={{ marginTop: 14, fontSize: 12, color: '#92653A', background: '#FBEFDD', border: '1px solid #F0D9B8', borderRadius: 10, padding: '8px 12px' }}>
                ⚠︎ Estimation — le réseau fédéral ne couvre pas cette rivière (station CEHQ). Branchez un proxy CEHQ pour des valeurs en temps réel.
              </div>
            )}
          </div>
        )}

        {status === 'ready' && detail?.kind === 'tide' && (
          <div>
            {detail.nextEvent ? (
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 24, fontWeight: 800 }}>{detail.nextEvent.label}</span>
                <span style={{ fontSize: 24, fontWeight: 800, color: accent }}>{fmtTime(detail.nextEvent.time)}</span>
                <span style={{ fontSize: 14, color: MUTED, marginLeft: 'auto' }}>{detail.nextEvent.height.toFixed(2)} {detail.unit}</span>
              </div>
            ) : (
              <div style={{ fontSize: 16, color: MUTED }}>Prochain événement de marée indisponible.</div>
            )}
            {detail.now && (
              <div style={{ fontSize: 13, color: MUTED, marginTop: 4 }}>
                Niveau actuel : <strong style={{ color: INK }}>{detail.now.v.toFixed(2)} {detail.unit}</strong> · {fmtTime(detail.now.t)}
              </div>
            )}
            <div style={{ marginTop: 14 }}>
              <TideCurve curve={detail.curve} now={detail.now} color={accent} />
            </div>
          </div>
        )}
      </div>
    </>
  );
}
