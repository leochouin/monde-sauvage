/**
 * CheckoutModal — Stripe Elements Payment Form
 * 
 * Shows a payment form with Stripe Elements after the user selects dates
 * and fills in their info. Uses direct charges to the vendor's connected
 * Stripe account with a 10% application fee.
 * 
 * Supports both chalet and guide bookings.
 * 
 * Props:
 *   isOpen, onClose, bookingData (dates + guest info), onSuccess
 *   bookingType — "chalet" (default) or "guide"
 *   title — display title (e.g. chalet name or guide name)
 */
import { useState, useEffect, useRef } from 'react';
import { createBookingWithPayment, createGuideBookingWithPayment, confirmBookingPayment, formatPrice } from '../utils/stripeService.js';
import './checkoutModal.css';

const STRIPE_PK = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;

const CheckoutModal = ({ isOpen, onClose, chalet, bookingData, onSuccess, bookingType = 'chalet', title }) => {
  // Payment flow state
  const [step, setStep] = useState('loading'); // loading | ready | processing | success | error
  const [error, setError] = useState(null);
  const [bookingResult, setBookingResult] = useState(null);

  // Stripe references
  const stripeRef = useRef(null);
  const elementsRef = useRef(null);
  const cardRef = useRef(null);
  const cardMountedRef = useRef(false);
  const containerRef = useRef(null);

  // Deduplicate booking creation across React StrictMode double-fire
  const bookingPromiseRef = useRef(null);

  // Determine if we're in test mode
  const isTestMode = STRIPE_PK?.startsWith('pk_test_');

  // ─── Initialize Stripe & Create Booking on open ─────────────────────────
  useEffect(() => {
    if (!isOpen || !bookingData) return;

    let cancelled = false;

    const init = async () => {
      try {
        setStep('loading');
        setError(null);

        // 1. Wait for Stripe.js to load (it's loaded async in index.html)
        if (!globalThis.Stripe) {
          // Wait up to 10 seconds for Stripe.js to load
          await new Promise((resolve, reject) => {
            let waited = 0;
            const interval = setInterval(() => {
              if (globalThis.Stripe) {
                clearInterval(interval);
                resolve();
              } else if (waited >= 10000) {
                clearInterval(interval);
                reject(new Error('Stripe.js n\'a pas pu être chargé. Veuillez rafraîchir la page.'));
              }
              waited += 200;
            }, 200);
          });
        }

        // 2. Create booking + PaymentIntent via Edge Function
        //    Use a shared promise ref so React StrictMode double-fire
        //    doesn't create two bookings.
        //    If _resumeResult is provided (cart resume flow), skip creation.
        if (!bookingPromiseRef.current) {
          if (bookingData._resumeResult) {
            bookingPromiseRef.current = Promise.resolve(bookingData._resumeResult);
          } else if (bookingType === 'guide') {
            bookingPromiseRef.current = createGuideBookingWithPayment({
                guideId: bookingData.guideId,
                startTime: bookingData.startTime,
                endTime: bookingData.endTime,
                customerName: bookingData.customerName,
                customerEmail: bookingData.customerEmail,
                customerPhone: bookingData.customerPhone,
                tripType: bookingData.tripType,
                numberOfPeople: bookingData.numberOfPeople,
                notes: bookingData.notes,
                // Pass individual time slots so edge function creates
                // one booking per slot instead of one merged booking
                allSlots: bookingData.allSlots || null,
              });
          } else {
            bookingPromiseRef.current = createBookingWithPayment({
                chaletId: bookingData.chaletId,
                startDate: bookingData.startDate,
                endDate: bookingData.endDate,
                customerName: bookingData.customerName,
                customerEmail: bookingData.customerEmail,
                notes: bookingData.notes,
              });
          }
        }

        const result = await bookingPromiseRef.current;

        if (cancelled) return;

        setBookingResult(result);

        // 3. Initialize Stripe on the platform account.
        //    We use destination charges so the PaymentIntent lives on the
        //    platform — no stripeAccount option needed.
        stripeRef.current = globalThis.Stripe(STRIPE_PK);

        // 4. Create Elements instance
        elementsRef.current = stripeRef.current.elements({
          clientSecret: result.clientSecret,
          appearance: {
            theme: 'stripe',
            variables: {
              colorPrimary: '#059669',
              colorBackground: '#ffffff',
              colorText: '#1e293b',
              fontFamily: 'Cabin, system-ui, sans-serif',
              borderRadius: '8px',
            },
          },
        });

        // 5. Create the Payment Element (mount happens in separate useEffect)
        cardRef.current = elementsRef.current.create('payment', {
          layout: 'tabs',
          paymentMethodOrder: ['card'],
        });

        // Listen for the element to be fully ready
        cardRef.current.on('ready', () => {
          console.log('✅ Stripe Payment Element ready');
        });

        setStep('ready');

      } catch (err) {
        if (!cancelled) {
          console.error('Checkout init error:', err);
          setError(err.message);
          setStep('error');
        }
      }
    };

    init();

    return () => {
      cancelled = true;
      // Unmount card element
      if (cardRef.current && cardMountedRef.current) {
        try { cardRef.current.unmount(); } catch (_) { /* ignore */ }
        cardMountedRef.current = false;
      }
      cardRef.current = null;
      elementsRef.current = null;
      stripeRef.current = null;
      // NOTE: Do NOT clear bookingPromiseRef here — the re-fired effect
      //       needs to reuse the same promise to avoid a duplicate booking.
    };
  }, [isOpen, bookingData]);

  // Clear the booking promise when the modal fully closes so a fresh
  // booking is created the next time the modal opens.
  useEffect(() => {
    if (!isOpen) {
      bookingPromiseRef.current = null;
    }
  }, [isOpen]);

  // ─── Mount Payment Element when step becomes 'ready' ──────────────────
  useEffect(() => {
    if (step !== 'ready' || !cardRef.current || cardMountedRef.current) return;

    // Poll for the mount point (React may not have rendered it yet)
    let attempts = 0;
    const maxAttempts = 20;
    const tryMount = () => {
      const mountPoint = document.getElementById('checkout-payment-element');
      if (mountPoint && cardRef.current && !cardMountedRef.current) {
        cardRef.current.mount(mountPoint);
        cardMountedRef.current = true;
        console.log('✅ Stripe Payment Element mounted');
      } else if (attempts < maxAttempts) {
        attempts++;
        requestAnimationFrame(tryMount);
      } else {
        console.error('❌ Could not find #checkout-payment-element after', maxAttempts, 'attempts');
        setError('Impossible de charger le formulaire de paiement. Veuillez rafraîchir la page.');
        setStep('error');
      }
    };

    tryMount();
  }, [step]);

  // ─── Handle Payment ─────────────────────────────────────────────────────
  const handlePayment = async (e) => {
    e.preventDefault();

    if (!stripeRef.current || !elementsRef.current) {
      setError('Stripe n\'est pas prêt. Veuillez réessayer.');
      return;
    }

    setStep('processing');
    setError(null);

    try {
      // Confirm payment using the Payment Element
      const { error: confirmError } = await stripeRef.current.confirmPayment({
        elements: elementsRef.current,
        confirmParams: {
          return_url: `${globalThis.location.origin}/map?payment=success&booking=${bookingResult.bookingId}`,
        },
        redirect: 'if_required',
      });

      if (confirmError) {
        // Payment failed — show error to user
        console.error('Payment confirmation error:', confirmError);
        setError(confirmError.message);
        setStep('ready');
        return;
      }

      // Payment succeeded (no redirect needed)
      setStep('success');

      // Fallback: verify with Stripe API and update DB in case the webhook
      // is delayed.  This is fire-and-forget — non-blocking for the user.
      confirmBookingPayment(bookingResult.bookingId, bookingType).catch(() => {});
      
      if (onSuccess) {
        onSuccess(bookingResult);
      }

    } catch (err) {
      console.error('Payment error:', err);
      setError(err.message || 'Erreur lors du paiement');
      setStep('ready');
    }
  };

  // ─── Close handler ──────────────────────────────────────────────────────
  const handleClose = () => {
    if (step === 'processing') return; // Don't allow close during payment
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="checkout-overlay" onClick={handleClose}>
      <div className="checkout-modal" onClick={(e) => e.stopPropagation()} ref={containerRef}>
        <button className="checkout-close" onClick={handleClose} type="button" disabled={step === 'processing'}>
          ✕
        </button>

        {/* ────── Success State ────── */}
        {step === 'success' && (
          <div className="checkout-success">
            <div className="checkout-success-icon">✅</div>
            <h3>Paiement réussi!</h3>
            <p>Votre réservation {bookingType === 'guide' 
              ? `avec ${title || 'le guide'}` 
              : `pour ${title || chalet?.Name || 'le chalet'}`} est confirmée.</p>
            <p>Un reçu sera envoyé à <strong>{bookingData.customerEmail}</strong></p>
            {bookingResult && (
              <div className="checkout-success-id">
                Réservation #{bookingResult.bookingId?.slice(0, 8)}
              </div>
            )}
            <button
              type="button"
              onClick={handleClose}
              style={{
                marginTop: '20px',
                padding: '12px 32px',
                background: '#059669',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontSize: '1rem',
                fontWeight: '600',
                cursor: 'pointer',
              }}
            >
              Fermer
            </button>
          </div>
        )}

        {/* ────── Loading State ────── */}
        {step === 'loading' && (
          <div className="checkout-body" style={{ textAlign: 'center', padding: '48px 24px' }}>
            <div className="checkout-spinner" style={{ width: 32, height: 32, borderWidth: 3 }} />
            <p style={{ marginTop: 16, color: '#64748b' }}>Préparation du paiement...</p>
          </div>
        )}

        {/* ────── Error State (init failed) ────── */}
        {step === 'error' && (
          <div className="checkout-body">
            <div className="checkout-header">
              <h2>Erreur</h2>
            </div>
            <div className="checkout-error" style={{ marginTop: 16 }}>
              {error}
            </div>
            <button
              type="button"
              onClick={handleClose}
              style={{
                marginTop: '12px',
                padding: '10px 24px',
                background: '#f1f5f9',
                color: '#374151',
                border: '1px solid #d1d5db',
                borderRadius: '8px',
                fontSize: '0.95rem',
                cursor: 'pointer',
                width: '100%',
              }}
            >
              Fermer
            </button>
          </div>
        )}

        {/* ────── Payment Form ────── */}
        {(step === 'ready' || step === 'processing') && bookingResult && (
          <>
            <div className="checkout-header">
              <h2>Finaliser la réservation</h2>
              <p>{title || (bookingType === 'guide' ? 'Guide' : (chalet?.Name || 'Chalet'))}</p>
            </div>

            <div className="checkout-body">
              {/* Test mode warning */}
              {isTestMode && (
                <div className="checkout-test-mode">
                  <span>⚠️</span>
                  <div>
                    <strong>Mode test</strong> — Utilisez la carte <code>4242 4242 4242 4242</code>, 
                    une date future, et n'importe quel CVC.
                  </div>
                </div>
              )}

              {/* Booking Summary */}
              <div className="checkout-summary">
                {bookingType === 'guide' ? (
                  <>
                    <div className="checkout-summary-dates">
                      📅 {bookingData.startTime ? new Date(bookingData.startTime).toLocaleString('fr-CA') : ''} → {bookingData.endTime ? new Date(bookingData.endTime).toLocaleString('fr-CA') : ''}
                    </div>
                    <div className="checkout-summary-row">
                      <span className="label">
                        🎣 {formatPrice(bookingResult.pricing.hourlyRate)}/h × {bookingResult.pricing.hours}h
                      </span>
                      <span>{formatPrice(bookingResult.pricing.subtotal)}</span>
                    </div>
                    <div className="checkout-summary-row" style={{ fontSize: '0.85rem', color: '#64748b' }}>
                      <span>Frais de service</span>
                      <span>{formatPrice(bookingResult.pricing.applicationFee)}</span>
                    </div>
                    <div className="checkout-summary-row total">
                      <span>Total</span>
                      <span>{formatPrice(bookingResult.pricing.total)}</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="checkout-summary-dates">
                      📅 {bookingData.startDate} → {bookingData.endDate}
                    </div>
                    <div className="checkout-summary-row">
                      <span className="label">
                        🏠 {formatPrice(bookingResult.pricing.pricePerNight)} × {bookingResult.pricing.nights} nuit{bookingResult.pricing.nights > 1 ? 's' : ''}
                      </span>
                      <span>{formatPrice(bookingResult.pricing.subtotal)}</span>
                    </div>
                    <div className="checkout-summary-row" style={{ fontSize: '0.85rem', color: '#64748b' }}>
                      <span>Frais de service</span>
                      <span>{formatPrice(bookingResult.pricing.applicationFee)}</span>
                    </div>
                    <div className="checkout-summary-row total">
                      <span>Total</span>
                      <span>{formatPrice(bookingResult.pricing.total)}</span>
                    </div>
                  </>
                )}
              </div>

              {/* Stripe Payment Element */}
              <div className="checkout-card-section">
                <label>Informations de paiement</label>
                <div id="checkout-payment-element" className="checkout-card-element" />
              </div>

              {/* Payment Error */}
              {error && (
                <div className="checkout-error">
                  {error}
                </div>
              )}

              {/* Pay Button */}
              <form onSubmit={handlePayment}>
                <button
                  type="submit"
                  className="checkout-pay-button"
                  disabled={step === 'processing'}
                >
                  {step === 'processing' ? (
                    <>
                      <span className="checkout-spinner" />
                      Paiement en cours...
                    </>
                  ) : (
                    `Payer ${formatPrice(bookingResult.pricing.total)}`
                  )}
                </button>
              </form>

              <div className="checkout-secure-note">
                🔒 Paiement sécurisé par Stripe
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default CheckoutModal;
