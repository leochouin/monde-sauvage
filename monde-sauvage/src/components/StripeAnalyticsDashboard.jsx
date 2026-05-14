import { useState, useEffect, useCallback } from 'react';
import { fetchStripeAnalytics, formatPrice } from '../utils/stripeService.js';

const PERIODS = [
  { key: '7d', label: '7 jours' },
  { key: '30d', label: '30 jours' },
];

function StatCard({ label, value, sub, accent }) {
  return (
    <div style={{
      flex: '1 1 140px',
      padding: '16px',
      backgroundColor: accent ? '#1F3A2E' : '#F8FAF9',
      borderRadius: '12px',
      border: `1px solid ${accent ? '#1F3A2E' : '#E5E7EB'}`,
    }}>
      <div style={{ fontSize: '12px', color: accent ? '#A7C4B5' : '#5A7766', marginBottom: '6px', fontWeight: '500' }}>
        {label}
      </div>
      <div style={{ fontSize: '22px', fontWeight: '700', color: accent ? '#fff' : '#1F3A2E', lineHeight: 1.1 }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: '11px', color: accent ? '#A7C4B5' : '#9CA3AF', marginTop: '4px' }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function BarChart({ data }) {
  if (!data || data.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '32px', color: '#9CA3AF', fontSize: '13px' }}>
        Aucune transaction sur cette période
      </div>
    );
  }

  const maxAmount = Math.max(...data.map((d) => d.amount), 1);
  const chartHeight = 120;
  const barWidth = Math.max(8, Math.min(32, Math.floor(400 / data.length) - 4));
  const totalWidth = data.length * (barWidth + 4);

  return (
    <div style={{ overflowX: 'auto', paddingBottom: '4px' }}>
      <svg
        viewBox={`0 0 ${Math.max(totalWidth, 300)} ${chartHeight + 28}`}
        style={{ width: '100%', minWidth: `${Math.min(totalWidth, 300)}px`, display: 'block' }}
      >
        {data.map((d, i) => {
          const barH = Math.max(2, Math.round((d.amount / maxAmount) * chartHeight));
          const x = i * (barWidth + 4);
          const y = chartHeight - barH;
          return (
            <g key={d.date}>
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={barH}
                rx={3}
                fill="#1F3A2E"
                opacity={0.85}
              />
              {/* Show label every N bars to avoid crowding */}
              {(data.length <= 14 || i % Math.ceil(data.length / 10) === 0) && (
                <text
                  x={x + barWidth / 2}
                  y={chartHeight + 18}
                  textAnchor="middle"
                  fontSize="9"
                  fill="#9CA3AF"
                >
                  {d.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function LoadingSkeleton() {
  const pulse = {
    background: 'linear-gradient(90deg, #f0f0f0 25%, #e8e8e8 50%, #f0f0f0 75%)',
    backgroundSize: '200% 100%',
    animation: 'skeleton-pulse 1.4s ease infinite',
    borderRadius: '8px',
  };
  return (
    <>
      <style>{`@keyframes skeleton-pulse { 0%{background-position:200% 0} 100%{background-position:-200% 0} }`}</style>
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '20px' }}>
        {[1, 2, 3, 4].map((n) => (
          <div key={n} style={{ flex: '1 1 140px', height: '80px', ...pulse }} />
        ))}
      </div>
      <div style={{ height: '148px', ...pulse }} />
    </>
  );
}

export default function StripeAnalyticsDashboard({ establishment }) {
  const [period, setPeriod] = useState('30d');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!establishment?.key && !establishment?.id) return;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchStripeAnalytics(
        establishment.key || establishment.id,
        period
      );
      setData(result.connected ? result : null);
    } catch (err) {
      const msg = err.message || '';
      // "Edge function error: 404" is what callEdgeFunction throws when the function itself
      // doesn't exist at the Supabase URL level — distinct from app-level 404s the function sends.
      setError(
        msg === 'Edge function error: 404'
          ? 'Fonction stripe-analytics non déployée. Exécutez : supabase functions deploy stripe-analytics'
          : msg || 'Erreur lors du chargement des données'
      );
    } finally {
      setLoading(false);
    }
  }, [establishment?.key, establishment?.id, period]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <LoadingSkeleton />;

  if (error) {
    return (
      <div style={{
        padding: '16px',
        background: '#FEF2F2',
        border: '1px solid #FECACA',
        borderRadius: '10px',
        color: '#991B1B',
        fontSize: '13px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
      }}>
        <span>⚠️</span>
        <span>{error}</span>
        <button
          onClick={load}
          style={{ marginLeft: 'auto', background: 'none', border: '1px solid #991B1B', color: '#991B1B', borderRadius: '6px', padding: '4px 10px', cursor: 'pointer', fontSize: '12px' }}
        >
          Réessayer
        </button>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div>
      {/* Period selector */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '16px' }}>
        {PERIODS.map((p) => (
          <button
            key={p.key}
            onClick={() => setPeriod(p.key)}
            style={{
              padding: '5px 14px',
              borderRadius: '20px',
              border: `1px solid ${period === p.key ? '#1F3A2E' : '#E5E7EB'}`,
              background: period === p.key ? '#1F3A2E' : 'white',
              color: period === p.key ? 'white' : '#5A7766',
              fontSize: '12px',
              fontWeight: '500',
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            {p.label}
          </button>
        ))}
        <button
          onClick={load}
          style={{
            marginLeft: 'auto',
            padding: '5px 10px',
            borderRadius: '20px',
            border: '1px solid #E5E7EB',
            background: 'white',
            color: '#9CA3AF',
            fontSize: '12px',
            cursor: 'pointer',
          }}
          title="Actualiser"
        >
          ↺
        </button>
      </div>

      {/* Stat cards */}
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '20px' }}>
        <StatCard
          label="Revenus totaux"
          value={formatPrice(data.totalRevenue)}
          sub={`Net: ${formatPrice(data.totalNet)}`}
          accent
        />
        <StatCard
          label="Transactions"
          value={data.transactionCount}
          sub={`Moy. ${formatPrice(data.avgTransaction)}`}
        />
        <StatCard
          label="Virements envoyés"
          value={formatPrice(data.payoutsSent)}
          sub={data.payoutsPending > 0 ? `En attente: ${formatPrice(data.payoutsPending)}` : 'Aucun en attente'}
        />
        <StatCard
          label="Solde disponible"
          value={formatPrice(data.availableBalance)}
          sub={data.pendingBalance > 0 ? `En transit: ${formatPrice(data.pendingBalance)}` : undefined}
        />
      </div>

      {/* Revenue chart */}
      <div style={{
        padding: '16px',
        background: '#F8FAF9',
        borderRadius: '12px',
        border: '1px solid #E5E7EB',
      }}>
        <div style={{ fontSize: '12px', fontWeight: '600', color: '#1F3A2E', marginBottom: '12px' }}>
          Revenus par jour
        </div>
        <BarChart data={data.timeline} />
      </div>

      {data.transactionCount === 0 && (
        <div style={{
          marginTop: '12px',
          padding: '10px 14px',
          background: '#F8FAF9',
          border: '1px solid #E5E7EB',
          borderRadius: '10px',
          fontSize: '13px',
          color: '#9CA3AF',
          textAlign: 'center',
        }}>
          Aucune transaction sur les {period === '7d' ? '7 derniers jours' : '30 derniers jours'}
        </div>
      )}
    </div>
  );
}
