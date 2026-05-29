import { useEstablishment } from '../../components/layout/EstablishmentLayout.jsx';
import EstablishmentBookingsPanel from '../../components/EstablishmentBookingsPanel.jsx';

export default function Bookings() {
  const { selectedEstablishment, chalets, loading } = useEstablishment();
  const estabKey = selectedEstablishment?.key ?? selectedEstablishment?.id ?? '';

  if (loading) {
    return (
      <div className="esbl-loading-state">
        <span style={{ fontSize: '2rem' }}>📋</span>
        <p style={{ margin: 0 }}>Chargement…</p>
      </div>
    );
  }

  if (!estabKey) {
    return (
      <div className="esbl-empty-state">
        <div style={{ fontSize: '3rem' }}>📋</div>
        <p>Aucun établissement sélectionné.</p>
      </div>
    );
  }

  return (
    <div className="esbl-page">
      <div className="esbl-page-intro">
        <h1 className="esbl-page-title">📋 Réservations</h1>
        <p className="esbl-page-subtitle">
          Création manuelle et gestion de vos réservations.
        </p>
      </div>
      <EstablishmentBookingsPanel
        establishmentId={estabKey}
        chalets={chalets}
      />
    </div>
  );
}
