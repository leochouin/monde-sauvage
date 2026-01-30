import React, { useState, useEffect } from "react";

// Inline illustration components for each step
const WelcomeIllustration = () => (
  <div style={{
    width: '120px',
    height: '120px',
    borderRadius: '50%',
    background: 'linear-gradient(135deg, rgba(45, 95, 76, 0.15) 0%, rgba(74, 155, 142, 0.1) 100%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    margin: '0 auto 24px',
    fontSize: '60px',
    position: 'relative',
    overflow: 'hidden'
  }}>
    <span style={{ zIndex: 1 }}>🎣</span>
    <div style={{
      position: 'absolute',
      bottom: '-10px',
      left: '50%',
      transform: 'translateX(-50%)',
      fontSize: '30px',
      opacity: 0.6
    }}>🌲🌲🌲</div>
  </div>
);

const GuideButtonIllustration = () => (
  <div style={{
    width: '200px',
    margin: '0 auto 24px',
    padding: '16px',
    backgroundColor: 'rgba(45, 95, 76, 0.08)',
    borderRadius: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  }}>
    <div style={{
      padding: '12px 16px',
      backgroundColor: '#FFFCF7',
      borderRadius: '10px',
      border: '2px solid #2D5F4C',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      fontWeight: '600',
      color: '#2D5F4C',
      fontSize: '14px',
      boxShadow: '0 0 0 4px rgba(74, 155, 142, 0.2)',
      animation: 'pulse-button 2s ease-in-out infinite'
    }}>
      <span>👤</span> Guide
    </div>
    <div style={{
      padding: '10px 14px',
      backgroundColor: 'transparent',
      borderRadius: '8px',
      border: '1px solid #D1D5DB',
      color: '#9CA3AF',
      fontSize: '12px'
    }}>
      Établissement
    </div>
  </div>
);

const ProfileIllustration = () => (
  <div style={{
    width: '220px',
    margin: '0 auto 24px',
    padding: '16px',
    backgroundColor: '#FFFCF7',
    borderRadius: '16px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
    border: '1px solid #E5E7EB'
  }}>
    <div style={{ display: 'flex', gap: '12px', marginBottom: '12px' }}>
      <div style={{
        width: '40px',
        height: '40px',
        borderRadius: '50%',
        backgroundColor: '#4A9B8E',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'white',
        fontWeight: '600',
        fontSize: '14px'
      }}>JD</div>
      <div>
        <div style={{ height: '14px', width: '80px', backgroundColor: '#2D5F4C', borderRadius: '4px', marginBottom: '6px' }}></div>
        <div style={{ height: '10px', width: '60px', backgroundColor: '#E5E7EB', borderRadius: '4px' }}></div>
      </div>
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontSize: '12px' }}>📍</span>
        <div style={{ height: '10px', flex: 1, backgroundColor: '#E5E7EB', borderRadius: '4px' }}></div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontSize: '12px' }}>💰</span>
        <div style={{ height: '10px', width: '50px', backgroundColor: '#E5E7EB', borderRadius: '4px' }}></div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontSize: '12px' }}>📱</span>
        <div style={{ height: '10px', width: '70px', backgroundColor: '#E5E7EB', borderRadius: '4px' }}></div>
      </div>
    </div>
  </div>
);

const FishTypesIllustration = () => (
  <div style={{
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
    justifyContent: 'center',
    margin: '0 auto 24px',
    maxWidth: '280px'
  }}>
    {['🐟 Saumon', '🐟 Truite', '🐟 Omble'].map((fish, i) => (
      <div key={i} style={{
        padding: '8px 14px',
        borderRadius: '20px',
        border: i === 0 ? '2px solid #2D5F4C' : '1px solid #D1D5DB',
        backgroundColor: i === 0 ? 'rgba(45, 95, 76, 0.15)' : '#FFFCF7',
        color: i === 0 ? '#2D5F4C' : '#5A7766',
        fontSize: '13px',
        fontWeight: i === 0 ? '600' : '400',
        display: 'flex',
        alignItems: 'center',
        gap: '4px'
      }}>
        {i === 0 && <span>✓</span>}
        {fish}
      </div>
    ))}
    {['🐟 Brochet', '🐟 Bar rayé'].map((fish, i) => (
      <div key={i + 3} style={{
        padding: '8px 14px',
        borderRadius: '20px',
        border: '1px solid #D1D5DB',
        backgroundColor: '#FFFCF7',
        color: '#5A7766',
        fontSize: '13px'
      }}>
        {fish}
      </div>
    ))}
  </div>
);

const CalendarConnectIllustration = () => (
  <div style={{
    width: '220px',
    margin: '0 auto 24px',
    padding: '20px',
    backgroundColor: '#FFFCF7',
    borderRadius: '16px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
    textAlign: 'center'
  }}>
    <div style={{
      width: '50px',
      height: '50px',
      margin: '0 auto 16px',
      backgroundColor: '#4285F4',
      borderRadius: '12px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'white',
      fontSize: '24px'
    }}>📅</div>
    <div style={{
      padding: '10px 16px',
      backgroundColor: '#4285F4',
      color: 'white',
      borderRadius: '8px',
      fontSize: '13px',
      fontWeight: '500',
      display: 'inline-flex',
      alignItems: 'center',
      gap: '8px',
      boxShadow: '0 2px 8px rgba(66, 133, 244, 0.3)'
    }}>
      <span>🔗</span> Connecter Google Calendar
    </div>
  </div>
);

const CalendarAgendaIllustration = () => (
  <div style={{
    width: '240px',
    margin: '0 auto 24px',
    padding: '16px',
    backgroundColor: '#FFFCF7',
    borderRadius: '16px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.08)'
  }}>
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      marginBottom: '12px',
      padding: '8px 12px',
      backgroundColor: 'rgba(45, 95, 76, 0.1)',
      borderRadius: '8px',
      borderLeft: '4px solid #2D5F4C'
    }}>
      <span>✓</span>
      <span style={{ fontSize: '13px', color: '#2D5F4C', fontWeight: '500' }}>
        Monde Sauvage - Disponibilités
      </span>
    </div>
    <div style={{ fontSize: '11px', color: '#5A7766', textAlign: 'center' }}>
      Calendrier créé automatiquement
    </div>
  </div>
);

const AvailabilityIllustration = () => (
  <div style={{
    width: '260px',
    margin: '0 auto 24px',
    backgroundColor: '#FFFCF7',
    borderRadius: '16px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
    overflow: 'hidden'
  }}>
    {/* Mini calendar header */}
    <div style={{
      backgroundColor: '#2D5F4C',
      padding: '10px 16px',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center'
    }}>
      <span style={{ color: 'white', fontWeight: '600', fontSize: '13px' }}>Janvier 2026</span>
      <div style={{ display: 'flex', gap: '8px' }}>
        <span style={{ color: 'white', opacity: 0.7 }}>←</span>
        <span style={{ color: 'white', opacity: 0.7 }}>→</span>
      </div>
    </div>
    {/* Calendar grid */}
    <div style={{ padding: '12px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', marginBottom: '8px' }}>
        {['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((d, i) => (
          <div key={i} style={{ textAlign: 'center', fontSize: '10px', color: '#9CA3AF', fontWeight: '500' }}>{d}</div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px' }}>
        {[...Array(7)].map((_, i) => (
          <div key={i} style={{
            textAlign: 'center',
            fontSize: '11px',
            padding: '6px 2px',
            borderRadius: '4px',
            backgroundColor: [1, 2, 5].includes(i) ? 'rgba(45, 95, 76, 0.2)' : 'transparent',
            color: [1, 2, 5].includes(i) ? '#2D5F4C' : '#5A7766',
            fontWeight: [1, 2, 5].includes(i) ? '600' : '400'
          }}>{i + 1}</div>
        ))}
      </div>
    </div>
    <div style={{ padding: '8px 12px', backgroundColor: 'rgba(45, 95, 76, 0.05)', fontSize: '10px', color: '#5A7766', textAlign: 'center' }}>
      ✓ Disponibilités = créneaux réservables
    </div>
  </div>
);

const ReadyIllustration = () => (
  <div style={{
    width: '120px',
    height: '120px',
    borderRadius: '50%',
    background: 'linear-gradient(135deg, rgba(34, 197, 94, 0.2) 0%, rgba(45, 95, 76, 0.15) 100%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    margin: '0 auto 24px',
    fontSize: '60px'
  }}>
    🎉
  </div>
);

const ONBOARDING_STEPS = [
  {
    id: 'welcome',
    title: 'Bienvenue sur Monde Sauvage! 🎣',
    description: 'Félicitations pour avoir rejoint notre communauté de guides de pêche! Ce guide rapide vous montrera comment utiliser la plateforme pour gérer votre profil et vos réservations.',
    highlight: null,
    Illustration: WelcomeIllustration
  },
  {
    id: 'guide-button',
    title: 'Votre espace Guide',
    description: 'Cliquez sur le bouton "Guide" dans le menu de gauche pour accéder à votre profil et gérer vos informations.',
    highlight: 'guide-button',
    Illustration: GuideButtonIllustration
  },
  {
    id: 'profile-info',
    title: 'Complétez votre profil',
    description: 'Dans votre espace guide, vous pourrez modifier vos informations personnelles: nom, expérience, biographie, tarif horaire, et localisation. Un profil complet attire plus de clients!',
    highlight: null,
    Illustration: ProfileIllustration
  },
  {
    id: 'fish-types',
    title: 'Vos spécialisations',
    description: 'Sélectionnez les types de poissons pour lesquels vous êtes spécialisé. Cela permet aux clients de vous trouver selon leurs préférences de pêche.',
    highlight: null,
    Illustration: FishTypesIllustration
  },
  {
    id: 'calendar-connect',
    title: 'Connectez Google Calendar',
    description: 'Pour gérer vos disponibilités, connectez votre compte Google Calendar en cliquant sur le bouton dans votre profil.',
    highlight: null,
    Illustration: CalendarConnectIllustration
  },
  {
    id: 'calendar-agenda',
    title: 'Votre agenda Monde Sauvage',
    description: 'Une fois connecté, un calendrier "Monde Sauvage - Disponibilités" sera automatiquement créé dans votre Google Calendar.',
    highlight: null,
    Illustration: CalendarAgendaIllustration
  },
  {
    id: 'availability',
    title: 'Gérer vos disponibilités',
    description: 'Pour indiquer vos disponibilités, créez des événements dans l\'agenda "Monde Sauvage". Les clients pourront réserver uniquement pendant ces créneaux.',
    highlight: null,
    Illustration: AvailabilityIllustration
  },
  {
    id: 'ready',
    title: 'Vous êtes prêt! 🎉',
    description: 'Vous connaissez maintenant les bases! Les clients pourront voir votre profil et réserver vos services directement. Bonne pêche!',
    highlight: null,
    Illustration: ReadyIllustration
  }
];

export default function GuideOnboardingModal({ 
  isOpen, 
  onClose, 
  onComplete,
  onHighlightElement,
  startStep = 0 
}) {
  const [currentStep, setCurrentStep] = useState(startStep);
  const [isAnimating, setIsAnimating] = useState(false);

  const step = ONBOARDING_STEPS[currentStep];
  const isFirstStep = currentStep === 0;
  const isLastStep = currentStep === ONBOARDING_STEPS.length - 1;

  // Reset to the appropriate start step whenever the modal opens
  useEffect(() => {
    if (isOpen) {
      setCurrentStep(startStep);
    }
  }, [isOpen, startStep]);

  useEffect(() => {
    if (isOpen && step?.highlight) {
      onHighlightElement?.(step.highlight);
    } else {
      onHighlightElement?.(null);
    }
  }, [currentStep, isOpen, step, onHighlightElement]);

  const handleNext = () => {
    if (isLastStep) {
      handleComplete();
    } else {
      setIsAnimating(true);
      setTimeout(() => {
        setCurrentStep(prev => prev + 1);
        setIsAnimating(false);
      }, 150);
    }
  };

  const handlePrev = () => {
    if (!isFirstStep) {
      setIsAnimating(true);
      setTimeout(() => {
        setCurrentStep(prev => prev - 1);
        setIsAnimating(false);
      }, 150);
    }
  };

  const handleComplete = () => {
    // Mark onboarding as complete in localStorage
    localStorage.setItem('guide_onboarding_complete', 'true');
    onComplete?.();
    onClose();
  };

  const handleSkip = () => {
    // Also mark as complete when skipping
    localStorage.setItem('guide_onboarding_complete', 'true');
    onHighlightElement?.(null);
    onClose();
  };

  if (!isOpen) return null;

  const hasHighlight = step?.highlight !== null;

  return (
    <>
      {/* Backdrop overlay - only show when no highlight is active (highlight overlay handles it otherwise) */}
      {!hasHighlight && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.6)',
            zIndex: 9998,
            backdropFilter: 'blur(2px)'
          }}
          onClick={handleSkip}
        />
      )}

      {/* Modal */}
      <div
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '90%',
          maxWidth: '520px',
          backgroundColor: '#FFFCF7',
          borderRadius: '20px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.35)',
          zIndex: 9999,
          overflow: 'hidden',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
        }}
      >
        {/* Progress bar */}
        <div style={{
          width: '100%',
          height: '4px',
          backgroundColor: '#E5E7EB'
        }}>
          <div
            style={{
              width: `${((currentStep + 1) / ONBOARDING_STEPS.length) * 100}%`,
              height: '100%',
              backgroundColor: '#2D5F4C',
              transition: 'width 0.3s ease'
            }}
          />
        </div>

        {/* Header with step indicator */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '16px 24px 0'
        }}>
          <span style={{
            fontSize: '13px',
            color: '#5A7766',
            fontWeight: '500'
          }}>
            Étape {currentStep + 1} sur {ONBOARDING_STEPS.length}
          </span>
          <button
            type="button"
            onClick={handleSkip}
            style={{
              background: 'none',
              border: 'none',
              color: '#9CA3AF',
              cursor: 'pointer',
              fontSize: '13px',
              padding: '4px 8px',
              borderRadius: '6px',
              transition: 'color 0.2s'
            }}
            onMouseOver={(e) => e.target.style.color = '#5A7766'}
            onMouseOut={(e) => e.target.style.color = '#9CA3AF'}
          >
            Passer le tutoriel
          </button>
        </div>

        {/* Content */}
        <div
          style={{
            padding: '24px 32px 32px',
            opacity: isAnimating ? 0 : 1,
            transform: isAnimating ? 'translateX(10px)' : 'translateX(0)',
            transition: 'opacity 0.15s ease, transform 0.15s ease'
          }}
        >
          {/* Illustration */}
          {step.Illustration && <step.Illustration />}

          {/* Title */}
          <h2 style={{
            margin: '0 0 16px',
            fontSize: '24px',
            fontWeight: '700',
            color: '#1F3A2E',
            textAlign: 'center',
            lineHeight: '1.3'
          }}>
            {step.title}
          </h2>

          {/* Description */}
          <p style={{
            margin: '0 0 32px',
            fontSize: '15px',
            color: '#5A7766',
            textAlign: 'center',
            lineHeight: '1.6'
          }}>
            {step.description}
          </p>

          {/* Step indicators (dots) */}
          <div style={{
            display: 'flex',
            justifyContent: 'center',
            gap: '8px',
            marginBottom: '28px'
          }}>
            {ONBOARDING_STEPS.map((_, index) => (
              <button
                key={index}
                type="button"
                onClick={() => setCurrentStep(index)}
                style={{
                  width: index === currentStep ? '24px' : '8px',
                  height: '8px',
                  borderRadius: '4px',
                  border: 'none',
                  backgroundColor: index === currentStep ? '#2D5F4C' : '#D1D5DB',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  padding: 0
                }}
                aria-label={`Aller à l'étape ${index + 1}`}
              />
            ))}
          </div>

          {/* Navigation buttons */}
          <div style={{
            display: 'flex',
            gap: '12px',
            justifyContent: 'center'
          }}>
            {!isFirstStep && (
              <button
                type="button"
                onClick={handlePrev}
                style={{
                  padding: '14px 28px',
                  backgroundColor: 'transparent',
                  color: '#5A7766',
                  border: '2px solid #5A7766',
                  borderRadius: '12px',
                  cursor: 'pointer',
                  fontWeight: '600',
                  fontSize: '15px',
                  transition: 'all 0.2s ease'
                }}
                onMouseOver={(e) => {
                  e.target.style.backgroundColor = 'rgba(90, 119, 102, 0.1)';
                }}
                onMouseOut={(e) => {
                  e.target.style.backgroundColor = 'transparent';
                }}
              >
                ← Précédent
              </button>
            )}
            <button
              type="button"
              onClick={handleNext}
              style={{
                padding: '14px 32px',
                backgroundColor: '#2D5F4C',
                color: '#FFFCF7',
                border: 'none',
                borderRadius: '12px',
                cursor: 'pointer',
                fontWeight: '600',
                fontSize: '15px',
                boxShadow: '0 4px 12px rgba(45, 95, 76, 0.3)',
                transition: 'all 0.2s ease',
                minWidth: '140px'
              }}
              onMouseOver={(e) => {
                e.target.style.backgroundColor = '#1F4A3A';
                e.target.style.transform = 'translateY(-1px)';
              }}
              onMouseOut={(e) => {
                e.target.style.backgroundColor = '#2D5F4C';
                e.target.style.transform = 'translateY(0)';
              }}
            >
              {isLastStep ? 'Commencer! 🚀' : 'Suivant →'}
            </button>
          </div>
        </div>

        {/* CSS Animation for pulse effect */}
        <style>{`
          @keyframes pulse-button {
            0%, 100% {
              box-shadow: 0 0 0 4px rgba(74, 155, 142, 0.2);
            }
            50% {
              box-shadow: 0 0 0 8px rgba(74, 155, 142, 0.15), 0 0 20px rgba(74, 155, 142, 0.3);
            }
          }
        `}</style>
      </div>
    </>
  );
}

// Utility function to check if onboarding should be shown
export function shouldShowGuideOnboarding(profile) {
  if (!profile) return false;
  if (profile.type !== 'guide' && profile.type !== 'admin') return false;
  
  const hasCompletedOnboarding = localStorage.getItem('guide_onboarding_complete') === 'true';
  return !hasCompletedOnboarding;
}

// Utility function to reset onboarding (for testing)
export function resetGuideOnboarding() {
  localStorage.removeItem('guide_onboarding_complete');
}
