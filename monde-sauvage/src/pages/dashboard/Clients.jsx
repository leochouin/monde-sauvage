import { useEstablishment } from '../../components/layout/EstablishmentLayout.jsx';
import EstablishmentClientsPanel from '../../components/EstablishmentClientsPanel.jsx';

export default function Clients() {
  const { selectedEstablishment, loading } = useEstablishment();
  const estabKey = selectedEstablishment?.key ?? selectedEstablishment?.id ?? '';

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300, color: '#64748b', flexDirection: 'column', gap: 12 }}>
        <span style={{ fontSize: '2rem' }}>👤</span>
        <p style={{ margin: 0 }}>Chargement…</p>
      </div>
    );
  }

  if (!estabKey) {
    return (
      <div style={{ textAlign: 'center', padding: '64px 24px', color: '#64748b' }}>
        <div style={{ fontSize: '3rem', marginBottom: 16 }}>👤</div>
        <p>Aucun établissement sélectionné.</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: '1.35rem', fontWeight: 800, color: '#0f172a' }}>👤 Clients</h1>
        <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: '0.875rem' }}>
          Gestion et import de votre clientèle.
        </p>
      </div>
      <EstablishmentClientsPanel establishmentId={estabKey} />
    </div>
  );
}
