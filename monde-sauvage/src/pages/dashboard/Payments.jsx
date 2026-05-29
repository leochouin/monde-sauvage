import { useEstablishment } from '../../components/layout/EstablishmentLayout.jsx';
import StripeAnalyticsDashboard from '../../components/StripeAnalyticsDashboard.jsx';
import StripeOnboarding from '../../modals/stripeOnboarding.jsx';

export default function Payments() {
  const { selectedEstablishment, setSelectedEstablishment, loading } = useEstablishment();

  const handleStripeStatusUpdate = (status) => {
    setSelectedEstablishment((prev) => ({
      ...prev,
      stripe_charges_enabled: status.chargesEnabled,
      stripe_payouts_enabled: status.payoutsEnabled,
      stripe_onboarding_complete: status.onboardingComplete,
    }));
  };

  if (loading) {
    return (
      <div className="esbl-loading-state">
        <span style={{ fontSize: '2rem' }}>💳</span>
        <p style={{ margin: 0 }}>Chargement…</p>
      </div>
    );
  }

  if (!selectedEstablishment) {
    return (
      <div className="esbl-empty-state">
        <div style={{ fontSize: '3rem' }}>💳</div>
        <p>Aucun établissement sélectionné.</p>
      </div>
    );
  }

  return (
    <div className="esbl-page">
      <div className="esbl-page-intro">
        <h1 className="esbl-page-title">💳 Paiements & Revenus</h1>
        <p className="esbl-page-subtitle">
          Analytique Stripe et configuration des paiements.
        </p>
      </div>

      <div className="esbl-card" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {selectedEstablishment.stripe_onboarding_complete ? (
          <>
            <StripeAnalyticsDashboard establishment={selectedEstablishment} />
            <div style={{ borderTop: '1px solid #efece4', paddingTop: 16 }}>
              <StripeOnboarding
                establishment={selectedEstablishment}
                onStatusUpdate={handleStripeStatusUpdate}
              />
            </div>
          </>
        ) : (
          <StripeOnboarding
            establishment={selectedEstablishment}
            onStatusUpdate={handleStripeStatusUpdate}
          />
        )}
      </div>
    </div>
  );
}
