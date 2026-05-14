import { useMemo } from 'react';
import { getRiversCatalog } from '../utils/riverGuideData.js';

const DIFFICULTY_LABELS = {
  beginner: { fr: 'Débutant', en: 'Beginner' },
  intermediate: { fr: 'Intermédiaire', en: 'Intermediate' },
  advanced: { fr: 'Avancé', en: 'Advanced' },
};

const DIFFICULTY_COLORS = {
  beginner: '#22C55E',
  intermediate: '#F59E0B',
  advanced: '#EF4444',
};

const FALLBACK_HERO = 'https://images.unsplash.com/photo-1455729552865-3658a5d39692?w=800&q=80';

export default function RiverBioCards({
  language = 'fr',
  selectedPathId = null,
  onSelect,
  compact = false,
}) {
  const t = (fr, en) => (language === 'en' ? en : fr);
  const catalog = useMemo(() => getRiversCatalog(language), [language]);

  if (!catalog.length) return null;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: compact ? 'repeat(auto-fit, minmax(155px, 1fr))' : 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: compact ? 8 : 12,
      }}
      data-testid="river-bio-cards"
    >
      {catalog.map((river) => {
        const isSelected = river.pathId === selectedPathId;
        const difficultyLabel = DIFFICULTY_LABELS[river.difficulty]?.[language === 'en' ? 'en' : 'fr']
          || river.difficulty;
        const difficultyColor = DIFFICULTY_COLORS[river.difficulty] || '#6B7280';

        return (
          <button
            key={river.slug}
            type="button"
            onClick={() => onSelect && onSelect(river.pathId, river)}
            style={{
              padding: 0,
              border: isSelected ? '2px solid #2D5F4C' : '1px solid #E5E7EB',
              borderRadius: compact ? 12 : 14,
              overflow: 'hidden',
              cursor: 'pointer',
              background: '#FFFCF7',
              textAlign: 'left',
              display: 'flex',
              flexDirection: 'column',
              transition: 'transform 140ms ease, box-shadow 140ms ease, border-color 140ms ease',
              boxShadow: isSelected
                ? '0 8px 22px rgba(45, 95, 76, 0.18)'
                : '0 2px 6px rgba(15, 23, 42, 0.05)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-3px)';
              e.currentTarget.style.boxShadow = '0 12px 26px rgba(15, 23, 42, 0.12)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = isSelected
                ? '0 8px 22px rgba(45, 95, 76, 0.18)'
                : '0 2px 6px rgba(15, 23, 42, 0.05)';
            }}
          >
            <div style={{ position: 'relative', width: '100%', aspectRatio: compact ? '3 / 2' : '16 / 9', background: '#E5E7EB' }}>
              <img
                src={river.image || FALLBACK_HERO}
                alt={river.shortName}
                loading="lazy"
                onError={(e) => { e.currentTarget.src = FALLBACK_HERO; }}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  display: 'block',
                }}
              />
              <span
                style={{
                  position: 'absolute',
                  top: 8,
                  left: 8,
                  background: 'rgba(255,255,255,0.95)',
                  color: difficultyColor,
                  fontSize: compact ? 10 : 11,
                  fontWeight: 700,
                  padding: compact ? '2px 7px' : '3px 8px',
                  borderRadius: 999,
                  textTransform: 'uppercase',
                  letterSpacing: 0.4,
                }}
              >
                ★ {difficultyLabel}
              </span>
            </div>

            <div style={{ padding: compact ? '8px 10px 10px' : '10px 12px 12px', display: 'flex', flexDirection: 'column', gap: compact ? 4 : 6, flex: 1 }}>
              <h3 style={{ margin: 0, fontSize: compact ? 13 : 15, fontWeight: 700, color: '#1F3A2E' }}>
                {river.shortName}
              </h3>
              <p style={{ margin: 0, fontSize: compact ? 10 : 11, color: '#5A7766', display: 'flex', alignItems: 'center', gap: 4 }}>
                <span>📍</span>
                {river.region || t('Gaspésie', 'Gaspesie')}
              </p>
              <p
                style={{
                  margin: '4px 0 0',
                  fontSize: compact ? 11 : 12,
                  color: '#374151',
                  lineHeight: 1.4,
                  display: '-webkit-box',
                  WebkitLineClamp: compact ? 1 : 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}
              >
                {river.shortDescription}
              </p>

              {river.highlights.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                  {river.highlights.slice(0, compact ? 2 : 3).map((h, i) => (
                    <span
                      key={i}
                      style={{
                        fontSize: compact ? 9 : 10,
                        background: 'rgba(45, 95, 76, 0.08)',
                        color: '#1F3A2E',
                        padding: compact ? '2px 6px' : '2px 7px',
                        borderRadius: 999,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {h.icon} {h.label}
                    </span>
                  ))}
                </div>
              )}

              <div style={{ marginTop: 'auto', paddingTop: 8 }}>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    fontSize: compact ? 11 : 12,
                    fontWeight: 600,
                    color: isSelected ? '#2D5F4C' : '#0f172a',
                  }}
                >
                  {isSelected ? t('Sélectionnée ✓', 'Selected ✓') : t('Choisir cette rivière →', 'Pick this river →')}
                </span>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
