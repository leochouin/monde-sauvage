/**
 * StripeOnboarding — Vendor onboarding component
 * 
 * Displayed inside the Etablissement (establishment) management modal.
 * Handles:
 *   - Starting Stripe Connect onboarding (redirects to Stripe)
 *   - Checking onboarding status on return
 *   - Displaying current Stripe account status
 * 
 * Props:
 *   establishment — the Etablissement record (needs key, stripe_account_id, etc.)
 *   onStatusUpdate — callback when onboarding status changes
 */
import { useState, useEffect } from 'react';
import { startVendorOnboarding, checkOnboardingStatus } from '../utils/stripeService.js';
import './stripeOnboarding.css';

const StripeOnboarding = ({ establishment, onStatusUpdate }) => {
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState({
    chargesEnabled: establishment?.stripe_charges_enabled || false,
    payoutsEnabled: establishment?.stripe_payouts_enabled || false,
    onboardingComplete: establishment?.stripe_onboarding_complete || false,
    hasAccount: !!establishment?.stripe_account_id,
  });

  // Check status on component mount if they have a Stripe account
  useEffect(() => {
    if (establishment?.stripe_account_id && !establishment?.stripe_charges_enabled) {
      handleCheckStatus();
    }
  }, [establishment?.stripe_account_id]);

  // Check if returning from Stripe onboarding
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('stripe_onboard') === 'complete') {
      handleCheckStatus();
      // Clean up URL
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (params.get('stripe_onboard') === 'refresh') {
      // User didn't complete onboarding — offer to restart
      setError('L\'inscription Stripe n\'a pas été complétée. Vous pouvez réessayer.');
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  /**
   * Start the Stripe Connect onboarding flow.
   * Redirects the user to Stripe's hosted onboarding page.
   */
  const handleStartOnboarding = async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await startVendorOnboarding(establishment.key);
      
      // Redirect to Stripe onboarding
      window.location.href = result.url;
    } catch (err) {
      console.error('Onboarding error:', err);
      setError(err.message);
      setLoading(false);
    }
  };

  /**
   * Check the current onboarding status with Stripe.
   */
  const handleCheckStatus = async () => {
    setChecking(true);
    setError(null);

    try {
      const result = await checkOnboardingStatus(establishment.key);
      
      const newStatus = {
        chargesEnabled: result.chargesEnabled,
        payoutsEnabled: result.payoutsEnabled,
        onboardingComplete: result.onboardingComplete,
        hasAccount: true,
      };

      setStatus(newStatus);

      if (onStatusUpdate) {
        onStatusUpdate(newStatus);
      }
    } catch (err) {
      console.error('Status check error:', err);
      setError(err.message);
    } finally {
      setChecking(false);
    }
  };

  // ─── Determine what to show ────────────────────────────────────────────
  const isFullySetUp = status.chargesEnabled && status.payoutsEnabled;
  const isPartiallySetUp = status.hasAccount && !isFullySetUp;

  return (
    <div className="stripe-onboarding">
      <h3>💳 Paiements en ligne</h3>
      <p className="stripe-onboarding-subtitle">
        Acceptez les paiements de vos clients directement sur votre compte bancaire
      </p>

      {/* Status badges */}
      <div className="stripe-status">
        {isFullySetUp ? (
          <>
            <span className="stripe-status-badge active">✅ Paiements activés</span>
            <span className="stripe-status-badge active">✅ Virements activés</span>
          </>
        ) : isPartiallySetUp ? (
          <>
            <span className={`stripe-status-badge ${status.chargesEnabled ? 'active' : 'pending'}`}>
              {status.chargesEnabled ? '✅' : '⏳'} Paiements
            </span>
            <span className={`stripe-status-badge ${status.payoutsEnabled ? 'active' : 'pending'}`}>
              {status.payoutsEnabled ? '✅' : '⏳'} Virements
            </span>
          </>
        ) : (
          <span className="stripe-status-badge inactive">⚪ Non configuré</span>
        )}
      </div>

      {/* Actions */}
      {isFullySetUp ? (
        <>
          <p style={{ color: '#059669', fontWeight: 500, fontSize: '0.9rem' }}>
            Votre compte Stripe est entièrement configuré. Vos clients peuvent payer en ligne
            et les fonds seront versés sur votre compte bancaire.
          </p>
          <button
            className="stripe-onboard-button secondary"
            onClick={() => window.open('https://dashboard.stripe.com', '_blank')}
          >
            📊 Tableau de bord Stripe
          </button>
        </>
      ) : (
        <>
          <button
            className="stripe-onboard-button primary"
            onClick={handleStartOnboarding}
            disabled={loading}
          >
            {loading ? (
              <>
                <span className="stripe-spinner" />
                Redirection...
              </>
            ) : isPartiallySetUp ? (
              '🔄 Compléter l\'inscription Stripe'
            ) : (
              '🚀 Configurer les paiements'
            )}
          </button>

          {isPartiallySetUp && (
            <button
              className="stripe-onboard-button secondary"
              onClick={handleCheckStatus}
              disabled={checking}
              style={{ marginLeft: 8 }}
            >
              {checking ? 'Vérification...' : '🔍 Vérifier le statut'}
            </button>
          )}

          <div className="stripe-onboard-info">
            <span>ℹ️</span>
            <span>
              Vous serez redirigé vers Stripe pour vérifier votre identité et configurer 
              votre compte bancaire. Ce processus prend environ 5 minutes. Une commission 
              de 10% est prélevée sur chaque réservation.
            </span>
          </div>
        </>
      )}

      {/* Error */}
      {error && (
        <div className="stripe-onboard-error">
          {error}
        </div>
      )}
    </div>
  );
};

export default StripeOnboarding;
