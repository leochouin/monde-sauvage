import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import format from 'date-fns/format';
import addDays from 'date-fns/addDays';
import differenceInDays from 'date-fns/differenceInDays';
import { frCA } from 'date-fns/locale';
import supabase from '../../utils/supabase.js';
import './PublicPage.css';

const STRIPE_PK = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

function waitForStripe() {
  return new Promise((resolve, reject) => {
    if (globalThis.Stripe) return resolve(globalThis.Stripe);
    let waited = 0;
    const interval = setInterval(() => {
      if (globalThis.Stripe) {
        clearInterval(interval);
        resolve(globalThis.Stripe);
      } else if (waited >= 10000) {
        clearInterval(interval);
        reject(new Error("Stripe.js n'a pas pu être chargé. Veuillez rafraîchir la page."));
      }
      waited += 200;
    }, 200);
  });
}

function fmtDate(d) {
  return format(new Date(d + 'T12:00:00'), 'd MMMM yyyy', { locale: frCA });
}

function fmtCAD(amount) {
  return new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' }).format(amount);
}

function todayStr() {
  return format(new Date(), 'yyyy-MM-dd');
}

function addDaysStr(dateStr, n) {
  return format(addDays(new Date(dateStr + 'T12:00:00'), n), 'yyyy-MM-dd');
}

// ─────────────────────────────────────────────────────────────────────────────
// GuestBookingPage
//
// Props:
//   slugProp     — override useParams().slug (used by EmbedWidget)
//   chaletIdProp — override useParams().chaletId (used by EmbedWidget)
//   isWidget     — removes page header/shell styling
// ─────────────────────────────────────────────────────────────────────────────
export default function GuestBookingPage({ slugProp, chaletIdProp, isWidget = false }) {
  const params = useParams();
  const slug = slugProp ?? params.slug;
  const chaletId = chaletIdProp ?? params.chaletId;

  const [chalet, setChalet] = useState(null);
  const [establishment, setEstablishment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState(null);

  // Step: 'dates' | 'info' | 'payment' | 'confirmed'
  const [step, setStep] = useState('dates');

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');

  const [paymentLoading, setPaymentLoading] = useState(false);
  const [paymentError, setPaymentError] = useState(null);
  const [bookingResult, setBookingResult] = useState(null);

  // Stripe refs — never stored in state to avoid re-renders
  const stripeRef = useRef(null);
  const elementsRef = useRef(null);
  const cardRef = useRef(null);
  const cardMountedRef = useRef(false);
  const cardContainerRef = useRef(null);
  const bookingPromiseRef = useRef(null);

  const [confirmedBookingId, setConfirmedBookingId] = useState(null);

  // ── Load chalet + establishment ──────────────────────────────────────────
  useEffect(() => {
    if (!slug || !chaletId) return;
    let cancelled = false;

    (async () => {
      try {
        const { data: estab, error: estabErr } = await supabase
          .from('Etablissement')
          .select('key, "Name", stripe_charges_enabled, public_slug')
          .eq('public_slug', slug)
          .single();

        if (cancelled) return;
        if (estabErr || !estab) throw new Error('Établissement introuvable.');
        setEstablishment(estab);

        const { data: ch, error: chErr } = await supabase
          .from('chalets')
          .select('key, "Name", "Description", price_per_night, nb_personnes, "Image"')
          .eq('key', chaletId)
          .single();

        if (cancelled) return;
        if (chErr || !ch) throw new Error('Chalet introuvable.');
        setChalet(ch);
      } catch (err) {
        if (!cancelled) setPageError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [slug, chaletId]);

  const nights = startDate && endDate
    ? Math.max(0, differenceInDays(
        new Date(endDate + 'T12:00:00'),
        new Date(startDate + 'T12:00:00'),
      ))
    : 0;

  const totalPrice = chalet ? nights * (chalet.price_per_night ?? 0) : 0;

  // ── Mount Stripe element once the payment step + container are ready ──────
  useEffect(() => {
    if (step !== 'payment') return;
    if (!cardRef.current || cardMountedRef.current) return;
    if (!cardContainerRef.current) return;

    cardRef.current.mount(cardContainerRef.current);
    cardMountedRef.current = true;
    cardRef.current.on('ready', () => setPaymentLoading(false));
  });

  // ── Cleanup Stripe element when leaving payment step ─────────────────────
  useEffect(() => {
    if (step !== 'payment' && cardRef.current && cardMountedRef.current) {
      try { cardRef.current.unmount(); } catch (_) { /* ignore */ }
      cardMountedRef.current = false;
    }
  }, [step]);

  // ── Step: dates ──────────────────────────────────────────────────────────
  const handleDatesSubmit = (e) => {
    e.preventDefault();
    if (nights < 1) return;
    setStep('info');
  };

  // ── Step: info → init payment ────────────────────────────────────────────
  const handleInfoSubmit = useCallback(async (e) => {
    e.preventDefault();
    setPaymentError(null);
    setPaymentLoading(true);

    try {
      const StripeClass = await waitForStripe();

      // Deduplicate PI creation across React StrictMode double-fires
      if (!bookingPromiseRef.current) {
        bookingPromiseRef.current = (async () => {
          const res = await fetch(`${SUPABASE_URL}/functions/v1/stripe-create-booking`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'apikey': SUPABASE_ANON_KEY,
            },
            body: JSON.stringify({
              bookingType: 'chalet',
              chaletId,
              startDate,
              endDate,
              customerName: `${firstName} ${lastName}`.trim(),
              customerEmail: email,
              ...(phone ? { customerPhone: phone } : {}),
            }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Erreur lors de la création de la réservation.');
          return data;
        })();
      }

      const result = await bookingPromiseRef.current;
      setBookingResult(result);

      // Init Stripe Elements (mount happens in useEffect once the DOM renders)
      stripeRef.current = StripeClass(STRIPE_PK);
      elementsRef.current = stripeRef.current.elements({
        clientSecret: result.clientSecret,
        appearance: {
          theme: 'stripe',
          variables: {
            colorPrimary: '#1f4d2f',
            colorBackground: '#ffffff',
            colorText: '#1c2b20',
            fontFamily: 'Cabin, system-ui, sans-serif',
            borderRadius: '8px',
          },
        },
      });
      cardRef.current = elementsRef.current.create('payment', {
        layout: 'tabs',
        paymentMethodOrder: ['card'],
      });
      cardMountedRef.current = false;

      // Transition to payment step — mount effect runs after this render
      setStep('payment');
    } catch (err) {
      setPaymentError(err.message);
      setPaymentLoading(false);
    }
  }, [chaletId, startDate, endDate, firstName, lastName, email, phone]);

  // ── Step: payment submit ─────────────────────────────────────────────────
  const handlePaymentSubmit = async (e) => {
    e.preventDefault();
    if (!stripeRef.current || !elementsRef.current) return;

    setPaymentLoading(true);
    setPaymentError(null);

    try {
      const returnBase = isWidget
        ? `${window.location.origin}/widget/${slug}?chaletId=${chaletId}&confirmed=1`
        : `${window.location.origin}/p/${slug}/book/${chaletId}?confirmed=1`;

      const { error: stripeErr } = await stripeRef.current.confirmPayment({
        elements: elementsRef.current,
        redirect: 'if_required',
        confirmParams: {
          return_url: returnBase,
          receipt_email: email,
        },
      });

      if (stripeErr) throw new Error(stripeErr.message);

      setConfirmedBookingId(bookingResult?.bookingId);
      setStep('confirmed');

      if (isWidget && window.parent !== window) {
        window.parent.postMessage(
          { type: 'MS_BOOKING_CONFIRMED', bookingId: bookingResult?.bookingId },
          '*'
        );
      }
    } catch (err) {
      setPaymentError(err.message);
    } finally {
      setPaymentLoading(false);
    }
  };

  const handleBackToInfo = () => {
    setStep('info');
    setPaymentError(null);
    bookingPromiseRef.current = null;
    cardRef.current = null;
    cardMountedRef.current = false;
    stripeRef.current = null;
    elementsRef.current = null;
  };

  // ── Render ───────────────────────────────────────────────────────────────

  if (loading) return <div className="pub-loading">Chargement…</div>;
  if (pageError) return <div className="pub-error-page">{pageError}</div>;

  const Shell = ({ children }) => isWidget
    ? <div className="pub-widget-shell">{children}</div>
    : <div className="pub-book-shell">{children}</div>;

  if (step === 'confirmed') {
    return (
      <Shell>
        {!isWidget && (
          <header className="pub-header">
            <div className="pub-header-inner">
              <a href={`/p/${slug}`} className="pub-brand">← {establishment?.Name ?? 'Monde Sauvage'}</a>
            </div>
          </header>
        )}
        <div className="pub-confirm">
          <div className="pub-confirm-icon">✅</div>
          <h2 className="pub-confirm-title">Réservation confirmée !</h2>
          <p className="pub-confirm-text">
            Merci {firstName}&nbsp;! Votre réservation pour {chalet.Name} du {fmtDate(startDate)} au {fmtDate(endDate)} a bien été enregistrée. Un reçu vous sera envoyé par courriel.
          </p>
          {confirmedBookingId && (
            <p className="pub-confirm-id">Référence : {confirmedBookingId}</p>
          )}
          {!isWidget && (
            <a
              href={`/p/${slug}`}
              className="pub-btn-reserve"
              style={{ marginTop: 24, display: 'inline-block', width: 'auto', padding: '12px 24px' }}
            >
              ← Retour aux chalets
            </a>
          )}
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      {!isWidget && (
        <header className="pub-header">
          <div className="pub-header-inner">
            <a href={`/p/${slug}`} className="pub-brand">
              ← {establishment?.Name ?? 'Monde Sauvage'}
            </a>
          </div>
        </header>
      )}

      <div className="pub-book-inner">
        {/* ── Summary sidebar ── */}
        <div>
          {chalet.Image && (
            <img src={chalet.Image} alt={chalet.Name} className="pub-book-img" />
          )}
          <h2 className="pub-book-chalet-name">{chalet.Name}</h2>
          {chalet.Description && (
            <p className="pub-book-chalet-desc">{chalet.Description}</p>
          )}
          {nights > 0 && totalPrice > 0 && (
            <div className="pub-book-pricing">
              <div className="pub-book-pricing-row">
                <span>{fmtCAD(chalet.price_per_night)} × {nights} nuit{nights > 1 ? 's' : ''}</span>
                <span>{fmtCAD(totalPrice)}</span>
              </div>
              <div className="pub-book-pricing-total">
                <span>Total</span>
                <span>{fmtCAD(totalPrice)}</span>
              </div>
            </div>
          )}
        </div>

        {/* ── Steps ── */}
        <div>

          {/* Step 1: Dates */}
          {step === 'dates' && (
            <form onSubmit={handleDatesSubmit}>
              <h3 className="pub-step-title">Choisir vos dates</h3>
              <div className="pub-field">
                <label className="pub-label">Arrivée</label>
                <input
                  type="date"
                  className="pub-input"
                  value={startDate}
                  min={addDaysStr(todayStr(), 1)}
                  onChange={(e) => {
                    setStartDate(e.target.value);
                    if (endDate && endDate <= e.target.value) setEndDate('');
                  }}
                  required
                />
              </div>
              <div className="pub-field">
                <label className="pub-label">Départ</label>
                <input
                  type="date"
                  className="pub-input"
                  value={endDate}
                  min={startDate ? addDaysStr(startDate, 1) : addDaysStr(todayStr(), 2)}
                  onChange={(e) => setEndDate(e.target.value)}
                  required
                />
              </div>
              {nights > 0 && (
                <p className="pub-nights">
                  {nights} nuit{nights > 1 ? 's' : ''} — {fmtCAD(totalPrice)}
                </p>
              )}
              <button type="submit" className="pub-btn-reserve" disabled={nights < 1}>
                Continuer
              </button>
            </form>
          )}

          {/* Step 2: Guest info */}
          {step === 'info' && (
            <form onSubmit={handleInfoSubmit}>
              <h3 className="pub-step-title">Vos informations</h3>
              {paymentError && <div className="pub-error-inline">{paymentError}</div>}
              <div className="pub-field-row">
                <div className="pub-field">
                  <label className="pub-label">Prénom *</label>
                  <input
                    className="pub-input"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    required
                  />
                </div>
                <div className="pub-field">
                  <label className="pub-label">Nom *</label>
                  <input
                    className="pub-input"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    required
                  />
                </div>
              </div>
              <div className="pub-field">
                <label className="pub-label">Courriel *</label>
                <input
                  type="email"
                  className="pub-input"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="pub-field">
                <label className="pub-label">Téléphone</label>
                <input
                  type="tel"
                  className="pub-input"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="418 555-0123"
                />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="pub-btn-back" onClick={() => setStep('dates')}>
                  ← Retour
                </button>
                <button
                  type="submit"
                  className="pub-btn-reserve"
                  style={{ flex: 1 }}
                  disabled={paymentLoading}
                >
                  {paymentLoading ? 'Préparation…' : 'Procéder au paiement'}
                </button>
              </div>
            </form>
          )}

          {/* Step 3: Payment */}
          {step === 'payment' && (
            <form onSubmit={handlePaymentSubmit}>
              <h3 className="pub-step-title">Paiement</h3>
              {paymentError && <div className="pub-error-inline">{paymentError}</div>}
              <div ref={cardContainerRef} style={{ minHeight: 180, marginBottom: 16 }} />
              {paymentLoading && (
                <p style={{ color: '#6b7280', fontSize: '0.88rem', margin: '0 0 12px' }}>
                  Chargement du formulaire de paiement…
                </p>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="pub-btn-back"
                  onClick={handleBackToInfo}
                  disabled={paymentLoading}
                >
                  ← Retour
                </button>
                <button
                  type="submit"
                  className="pub-btn-reserve"
                  style={{ flex: 1 }}
                  disabled={paymentLoading}
                >
                  {paymentLoading ? 'Traitement…' : `Payer ${fmtCAD(totalPrice)}`}
                </button>
              </div>
              <p className="pub-stripe-notice">🔒 Paiement sécurisé par Stripe</p>
            </form>
          )}

        </div>
      </div>
    </Shell>
  );
}
