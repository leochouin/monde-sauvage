import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useEstablishment } from '../../components/layout/EstablishmentLayout.jsx';
import EstablishmentOnboardingChecklist from '../../components/EstablishmentOnboardingChecklist.jsx';
import supabase from '../../utils/supabase.js';

const SECTION_TO_ROUTE = {
  overview:     '',
  demarrage:    'demarrage',
  chalets:      'chalets',
  equipment:    'equipements',
  calendar:     'calendrier',
  clients:      'clients',
  reservations: 'reservations',
  payments:     'paiements',
};

export default function Onboarding() {
  const navigate = useNavigate();
  const { selectedEstablishment, chalets, loading: ctxLoading } = useEstablishment();

  const [equipmentKinds, setEquipmentKinds] = useState([]);
  const [inventoryUnits, setInventoryUnits] = useState([]);
  const [loadingEq, setLoadingEq] = useState(false);

  const estabKey = selectedEstablishment?.key ?? selectedEstablishment?.id;

  useEffect(() => {
    if (!estabKey) return;
    setLoadingEq(true);
    Promise.all([
      supabase.from('equipment_kind').select('*').eq('establishment_id', estabKey).order('label'),
      supabase
        .from('inventory_unit')
        .select('*, equipment_kind:equipment_kind_id(id, label, slug)')
        .eq('establishment_id', estabKey)
        .eq('is_active', true)
        .is('deleted_at', null),
    ]).then(([kindsRes, unitsRes]) => {
      setEquipmentKinds(kindsRes.data ?? []);
      setInventoryUnits(unitsRes.data ?? []);
    }).finally(() => setLoadingEq(false));
  }, [estabKey]);

  const handleNavigate = (sectionKey) => {
    const slug = SECTION_TO_ROUTE[sectionKey];
    if (slug !== undefined) {
      navigate(`/dashboard/establishment/${slug}`);
    }
  };

  if (ctxLoading || loadingEq) {
    return (
      <div className="esbl-loading-state">
        <span style={{ fontSize: '2rem' }}>✅</span>
        <p style={{ margin: 0 }}>Chargement de la checklist…</p>
      </div>
    );
  }

  if (!selectedEstablishment) {
    return (
      <div className="esbl-empty-state">
        <div style={{ fontSize: '3rem' }}>🏕️</div>
        <p>Aucun établissement sélectionné.</p>
      </div>
    );
  }

  return (
    <div className="esbl-page">
      <div className="esbl-page-intro">
        <h1 className="esbl-page-title">✅ Démarrage</h1>
        <p className="esbl-page-subtitle">
          Complétez chaque étape pour activer votre établissement.
        </p>
      </div>
      <EstablishmentOnboardingChecklist
        establishment={selectedEstablishment}
        chalets={chalets}
        equipmentKinds={equipmentKinds}
        inventoryUnits={inventoryUnits}
        onNavigate={handleNavigate}
      />
    </div>
  );
}
