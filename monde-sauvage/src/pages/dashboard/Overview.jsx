import { useEstablishment } from '../../components/layout/EstablishmentLayout.jsx';
import './establishment-dashboard.css';

// ─── Sous-composants ──────────────────────────────────────────────────────────
const StatCard = ({ label, value, accent = false }) => (
  <div className={`esbl-stat-card${accent ? ' esbl-stat-card--accent' : ''}`}>
    <p className="esbl-stat-label">{label}</p>
    <p className="esbl-stat-value">{value}</p>
  </div>
);

const InfoRow = ({ label, value, valueColor }) => (
  <div className="esbl-info-row">
    <span className="esbl-info-label">{label}</span>
    <span className="esbl-info-value" style={valueColor ? { color: valueColor } : undefined}>
      {value ?? <span className="esbl-info-empty">Non renseigné</span>}
    </span>
  </div>
);

const SectionCard = ({ title, children }) => (
  <div className="esbl-section-card">
    <h2 className="esbl-section-title">{title}</h2>
    {children}
  </div>
);

// ─── Page Aperçu ─────────────────────────────────────────────────────────────
export default function Overview() {
  // Consomme le contexte fourni par EstablishmentLayout — pas de double fetch.
  const { selectedEstablishment, chalets, loading, error, refresh } = useEstablishment();

  if (loading) {
    return (
      <div className="esbl-loading-state">
        <span style={{ fontSize: '2rem' }}>🌿</span>
        <p style={{ margin: 0 }}>Chargement…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="esbl-error-card">
        <strong>Erreur :</strong> {error}
        <button type="button" onClick={refresh} className="esbl-btn esbl-btn--ghost" style={{ marginLeft: '12px' }}>
          Réessayer
        </button>
      </div>
    );
  }

  if (!selectedEstablishment) {
    return (
      <div className="esbl-empty-state">
        <div style={{ fontSize: '3rem' }}>🏕️</div>
        <h2 style={{ margin: 0, color: 'var(--esbl-ink)', fontSize: '1.2rem' }}>Aucun établissement trouvé</h2>
        <p style={{ margin: 0, fontSize: '0.9rem' }}>
          Créez votre premier établissement depuis l'ancienne interface pour commencer.
        </p>
      </div>
    );
  }

  const estab = selectedEstablishment;
  const calendarConnected = !!estab.google_calendar_id;
  const stripeActive = !!estab.stripe_onboarding_complete;

  return (
    <div className="esbl-page">
      <header className="esbl-page-header">
        <div>
          <p className="esbl-eyebrow">Etablissement</p>
          <h1 className="esbl-page-title">Aperçu — {estab.Name ?? estab.name}</h1>
          <p className="esbl-page-subtitle">Vue d'ensemble de votre établissement</p>
        </div>
        <div className="esbl-header-actions">
          <span className={`esbl-chip ${calendarConnected ? 'esbl-chip--positive' : 'esbl-chip--warning'}`}>
            {calendarConnected ? 'Google Calendar connecté' : 'Google Calendar requis'}
          </span>
          <span className={`esbl-chip ${stripeActive ? 'esbl-chip--positive' : 'esbl-chip--warning'}`}>
            {stripeActive ? 'Paiements actifs' : 'Paiements a configurer'}
          </span>
        </div>
      </header>

      {/* ── Statistiques rapides ── */}
      <div className="esbl-stat-grid">
        <StatCard label="Chalets" value={chalets.length} accent />
        <StatCard
          label="Calendrier"
          value={calendarConnected ? 'Connecté' : 'Non connecté'}
        />
        <StatCard
          label="Paiements"
          value={stripeActive ? 'Actif' : 'Inactif'}
        />
      </div>

      {/* ── Informations du lieu ── */}
      <SectionCard title="Informations du lieu">
        <div className="esbl-info-grid">
          <InfoRow label="Nom du lieu" value={estab.Name ?? estab.name} />
          <InfoRow label="Téléphone" value={estab.telephone} />
          <InfoRow label="Courriel" value={estab.email} />
          <div style={{ gridColumn: '1 / -1' }}>
            <InfoRow label="Description / Adresse" value={estab.Description ?? estab.adresse} />
          </div>
          <InfoRow
            label="Statut calendrier"
            value={calendarConnected ? '✅ Google Calendar connecté' : '⚠️ Non connecté'}
            valueColor={calendarConnected ? '#059669' : '#b45309'}
          />
          <InfoRow
            label="Statut Stripe"
            value={stripeActive ? '✅ Paiements activés' : '⚠️ Configuration incomplète'}
            valueColor={stripeActive ? '#059669' : '#b45309'}
          />
        </div>
      </SectionCard>

      {/* ── Liste des chalets ── */}
      {chalets.length > 0 && (
        <SectionCard title={`Chalets (${chalets.length})`}>
          <div className="esbl-list">
            {chalets.map((chalet) => (
              <div
                key={chalet.key ?? chalet.id}
                className="esbl-list-row"
              >
                <div>
                  <p className="esbl-list-title">
                    {chalet.Name ?? chalet.name ?? `Chalet ${chalet.key ?? chalet.id}`}
                  </p>
                  {chalet.nb_personnes && (
                    <p className="esbl-list-meta">
                      {chalet.nb_personnes} personnes
                    </p>
                  )}
                </div>
                {chalet.price_per_night && (
                  <span className="esbl-price">
                    {Number(chalet.price_per_night).toFixed(0)} $/nuit
                  </span>
                )}
              </div>
            ))}
          </div>
        </SectionCard>
      )}
    </div>
  );
}
