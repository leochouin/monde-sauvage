/**
 * ReservationCart — Floating cart for pending guide reservations
 *
 * Shows a small badge on the map UI. When clicked, expands to reveal
 * pending (unpaid) bookings with a countdown timer, resume-payment
 * and cancel actions.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { getUserPendingBookings, cancelPendingBooking } from '../utils/guideBookingService.js';
import { createGuideBookingWithPayment, formatPrice } from '../utils/stripeService.js';

// ─── Countdown helper ───────────────────────────────────────────────────
function useCountdown(targetDate) {
  const [remaining, setRemaining] = useState(() => calcRemaining(targetDate));

  useEffect(() => {
    if (!targetDate) return;
    const id = setInterval(() => setRemaining(calcRemaining(targetDate)), 1000);
    return () => clearInterval(id);
  }, [targetDate]);

  return remaining;
}

function calcRemaining(targetDate) {
  if (!targetDate) return null;
  const diff = new Date(targetDate).getTime() - Date.now();
  if (diff <= 0) return { expired: true, mm: 0, ss: 0, total: 0 };
  const mm = Math.floor(diff / 60000);
  const ss = Math.floor((diff % 60000) / 1000);
  return { expired: false, mm, ss, total: diff };
}

function CountdownBadge({ expiresAt }) {
  const r = useCountdown(expiresAt);
  if (!r || r.expired) return <span style={{ color: '#ef4444', fontWeight: 600, fontSize: '12px' }}>Expiré</span>;
  const color = r.mm < 5 ? '#ef4444' : r.mm < 15 ? '#f59e0b' : '#059669';
  return (
    <span style={{ color, fontWeight: 600, fontSize: '12px', fontVariantNumeric: 'tabular-nums' }}>
      {String(r.mm).padStart(2, '0')}:{String(r.ss).padStart(2, '0')}
    </span>
  );
}

// ─── Main component ─────────────────────────────────────────────────────
export default function ReservationCart({ userEmail, onResumePayment }) {
  const [open, setOpen] = useState(false);
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [cancelling, setCancelling] = useState(null);
  const pollRef = useRef(null);

  // Fetch pending bookings
  const refresh = useCallback(async () => {
    if (!userEmail) { console.log('🛒 Cart: no userEmail'); setBookings([]); return; }
    try {
      console.log('🛒 Cart: fetching pending bookings for', userEmail);
      const data = await getUserPendingBookings(userEmail);
      console.log('🛒 Cart: got', data.length, 'pending bookings', data);
      setBookings(data);
    } catch (err) { console.error('🛒 Cart: fetch error', err); }
  }, [userEmail]);

  // Initial load + poll every 30s
  useEffect(() => {
    refresh();
    pollRef.current = setInterval(refresh, 30000);
    return () => clearInterval(pollRef.current);
  }, [refresh]);

  // Cancel a booking
  const handleCancel = async (id) => {
    setCancelling(id);
    try {
      await cancelPendingBooking(id);
      setBookings(prev => prev.filter(b => b.id !== id));
    } catch { /* already logged */ }
    setCancelling(null);
  };

  // Resume payment — re-create a PaymentIntent for the existing booking
  const handleResume = (booking) => {
    if (!onResumePayment) return;
    onResumePayment(booking);
  };

  // Show cart always when user is logged in (badge shows count)
  if (!userEmail) return null;

  return (
    <>
      {/* Floating badge */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          zIndex: 10000,
          width: '56px',
          height: '56px',
          borderRadius: '50%',
          background: '#2D5F4C',
          color: '#FFFCF7',
          border: '2px solid #4A9B8E',
          cursor: 'pointer',
          fontSize: '22px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
          transition: 'transform 0.2s',
          transform: open ? 'rotate(45deg)' : 'rotate(0deg)',
        }}
        title="Réservations en attente"
      >
        🛒
        {/* Count badge */}
        {bookings.length > 0 && !open && (
          <span style={{
            position: 'absolute',
            top: '-4px',
            right: '-4px',
            width: '22px',
            height: '22px',
            borderRadius: '50%',
            background: '#ef4444',
            color: '#fff',
            fontSize: '12px',
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '2px solid #FFFCF7',
          }}>
            {bookings.length}
          </span>
        )}
      </button>

      {/* Panel */}
      {open && (
        <div style={{
          position: 'fixed',
          bottom: '90px',
          right: '24px',
          zIndex: 10000,
          width: '360px',
          maxHeight: '70vh',
          overflowY: 'auto',
          background: '#FFFCF7',
          borderRadius: '16px',
          border: '1px solid #d1d5db',
          boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
          fontFamily: "'Cabin', system-ui, sans-serif",
        }}>
          {/* Header */}
          <div style={{
            padding: '16px 20px 12px',
            borderBottom: '1px solid #e5e7eb',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#1F3A2E' }}>
              🛒 Réservations en attente ({bookings.length})
            </h3>
            <button
              onClick={() => setOpen(false)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px', color: '#6b7280' }}
            >✕</button>
          </div>

          {/* List */}
          <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {bookings.length === 0 && (
              <div style={{ textAlign: 'center', padding: '20px 0', color: '#9ca3af', fontSize: '13px' }}>
                Aucune réservation en attente.
              </div>
            )}
            {bookings.map(booking => (
              <CartItem
                key={booking.id}
                booking={booking}
                cancelling={cancelling === booking.id}
                onCancel={() => handleCancel(booking.id)}
                onResume={() => handleResume(booking)}
              />
            ))}
          </div>

          {/* Footer note */}
          <div style={{
            padding: '10px 16px 14px',
            borderTop: '1px solid #e5e7eb',
            fontSize: '11px',
            color: '#9ca3af',
            textAlign: 'center',
          }}>
            Les réservations non payées expirent automatiquement.
          </div>
        </div>
      )}
    </>
  );
}

// ─── Individual cart item ───────────────────────────────────────────────
function CartItem({ booking, cancelling, onCancel, onResume }) {
  const guideName = booking.guide?.name || 'Guide';
  const startDate = new Date(booking.start_time);
  const endDate = new Date(booking.end_time);
  const hours = ((endDate - startDate) / 3600000).toFixed(1);
  const amount = booking.payment_amount;

  // Check if payment window has expired
  const isExpired = booking.payment_link_expires_at
    && new Date(booking.payment_link_expires_at).getTime() < Date.now();

  return (
    <div style={{
      background: isExpired ? '#fef2f2' : '#fff',
      borderRadius: '12px',
      border: `1px solid ${isExpired ? '#fecaca' : '#e5e7eb'}`,
      padding: '14px',
      transition: 'box-shadow 0.2s',
      opacity: isExpired ? 0.75 : 1,
    }}>
      {/* Top row: guide name + countdown */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <span style={{ fontWeight: 600, fontSize: '14px', color: '#1F3A2E' }}>
          🎣 {guideName}
        </span>
        {isExpired
          ? <span style={{ color: '#ef4444', fontWeight: 600, fontSize: '12px' }}>⏰ Expiré</span>
          : <CountdownBadge expiresAt={booking.payment_link_expires_at} />
        }
      </div>

      {/* Details */}
      <div style={{ fontSize: '12px', color: '#6b7280', lineHeight: 1.6 }}>
        <div>📅 {startDate.toLocaleDateString('fr-CA')} — {startDate.toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' })} à {endDate.toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' })}</div>
        {booking.trip_type && <div>🐟 {booking.trip_type}</div>}
        <div>👤 {booking.number_of_people || 1} personne(s) · {hours}h</div>
      </div>

      {/* Price + actions */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '10px' }}>
        <span style={{ fontWeight: 700, fontSize: '15px', color: '#1F3A2E' }}>
          {amount ? `${Number(amount).toFixed(2)} $ CAD` : '—'}
        </span>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={onCancel}
            disabled={cancelling}
            style={{
              padding: '5px 12px',
              fontSize: '12px',
              fontWeight: 500,
              border: '1px solid #d1d5db',
              borderRadius: '8px',
              background: '#fff',
              color: '#6b7280',
              cursor: cancelling ? 'not-allowed' : 'pointer',
              opacity: cancelling ? 0.5 : 1,
            }}
          >
            {cancelling ? '...' : 'Retirer'}
          </button>
          {!isExpired && (
            <button
              onClick={onResume}
              style={{
                padding: '5px 14px',
                fontSize: '12px',
                fontWeight: 600,
                border: 'none',
                borderRadius: '8px',
                background: '#2D5F4C',
                color: '#FFFCF7',
                cursor: 'pointer',
              }}
            >
              💳 Payer
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
