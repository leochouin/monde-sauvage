import { useMemo } from 'react';

/**
 * Checklist « première configuration » pour une pourvoirie (ordre : lieu → Google → chalets → inventaire → Stripe).
 */
export default function EstablishmentOnboardingChecklist({
  establishment,
  chalets,
  equipmentKinds,
  inventoryUnits,
  onNavigate,
}) {
  const steps = useMemo(() => {
    if (!establishment) return [];
    const nameOk = !!(establishment.Name || establishment.name)?.trim();
    const googleOk = !!establishment.google_calendar_id;
    const chaletsOk = (chalets?.length ?? 0) >= 1;
    const kindsOk = (equipmentKinds?.length ?? 0) >= 1;
    const unitCalOk =
      (inventoryUnits ?? []).some((u) => u?.google_calendar_id && u?.is_active !== false);
    const stripeOk = !!establishment.stripe_onboarding_complete;

    return [
      {
        id: 'info',
        done: nameOk,
        title: 'Renseigner votre lieu',
        detail:
          'Nom (et idéalement téléphone ou courriel) dans l’onglet Aperçu pour que les clients vous reconnaissent.',
        section: 'overview',
      },
      {
        id: 'google',
        done: googleOk,
        title: 'Connecter Google Agenda',
        detail:
          'Un compte Google lie vos calendriers : chaque chalet et chaque chaloupe peut avoir son sous-agenda.',
        section: 'calendar',
      },
      {
        id: 'chalets',
        done: chaletsOk,
        title: 'Ajouter au moins un hébergement (chalet, tente, etc.)',
        detail: 'Créez vos unités dans l’onglet Chalets ; les photos sont optionnelles pour commencer.',
        section: 'chalets',
      },
      {
        id: 'inventory',
        done: kindsOk && unitCalOk,
        title: 'Déclarer vos équipements (ex. chaloupes) et leurs agendas',
        detail:
          'Dans Équipements : un type (ex. Chaloupe), une unité physique, puis « Créer agenda » pour bloquer les dispo.',
        section: 'equipment',
      },
      {
        id: 'stripe',
        done: stripeOk,
        title: 'Configurer les paiements (Stripe)',
        detail: 'Quand vous êtes prêts à encaisser en ligne, complétez l’activation dans l’onglet Paiements.',
        section: 'payments',
      },
    ];
  }, [establishment, chalets, equipmentKinds, inventoryUnits]);

  const doneCount = steps.filter((s) => s.done).length;

  if (!establishment || steps.length === 0) return null;

  return (
    <div
      className="establishment-onboarding"
      style={{
        border: '1px solid #e2e8f0',
        borderRadius: 12,
        background: '#fafaf9',
        padding: 18,
      }}
    >
      <div style={{ marginBottom: 14 }}>
        <h2 className="guide-section-title" style={{ padding: 0, margin: 0, fontSize: '1.15rem' }}>
          Démarrage rapide
        </h2>
        <p style={{ color: '#64748b', fontSize: '0.9rem', margin: '6px 0 0' }}>
          Suivez ces étapes dans l’ordre — idéalement sur un seul compte Google partagé au besoin avec votre équipe
          (voir onglet Calendrier).
        </p>
        <p style={{ margin: '8px 0 0', fontSize: '0.88rem', color: '#0f766e', fontWeight: 600 }}>
          {doneCount}/{steps.length} étapes complétées
        </p>
      </div>
      <ol style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {steps.map((step, idx) => (
          <li
            key={step.id}
            style={{
              listStyle: 'decimal',
              paddingLeft: 4,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minWidth: 22,
                  height: 22,
                  borderRadius: '999px',
                  fontSize: 12,
                  fontWeight: 700,
                  background: step.done ? '#d1fae5' : '#f1f5f9',
                  color: step.done ? '#065f46' : '#64748b',
                }}
                aria-hidden
              >
                {step.done ? '✓' : idx + 1}
              </span>
              <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                <div style={{ fontWeight: 600, color: '#1e293b', fontSize: '0.95rem' }}>{step.title}</div>
                <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: '#64748b', lineHeight: 1.45 }}>
                  {step.detail}
                </p>
              </div>
              {onNavigate && (
                <button
                  type="button"
                  onClick={() => onNavigate(step.section)}
                  style={{
                    padding: '6px 12px',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    borderRadius: 8,
                    border: '1px solid #cbd5e1',
                    background: 'white',
                    color: '#334155',
                    cursor: 'pointer',
                    alignSelf: 'flex-start',
                  }}
                >
                  Ouvrir
                </button>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
