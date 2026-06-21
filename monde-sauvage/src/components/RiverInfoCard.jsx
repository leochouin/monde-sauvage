import { useState, useEffect } from 'react';
import { getRiverByPathId, formatRiverDisplayName, getRegionLabel } from '../utils/riverGuideData.js';
import { RIVER_IMAGES } from '../utils/riverImages.js';

const FALLBACK_IMAGE = 'https://images.unsplash.com/photo-1455729552865-3658a5d39692?w=800&q=80';

const DIFFICULTY_CONFIG = {
  beginner:     { fr: 'Débutant',     en: 'Beginner',     color: '#2D9C57', bg: '#E8F7EE' },
  intermediate: { fr: 'Intermédiaire', en: 'Intermediate', color: '#D97706', bg: '#FEF3C7' },
  advanced:     { fr: 'Avancé',       en: 'Advanced',     color: '#DC2626', bg: '#FEE2E2' },
};

const FISH_LABELS = {
  'saumon-atlantique': { fr: 'Saumon Atlantique', en: 'Atlantic Salmon' },
  'truite-mouchetee':  { fr: 'Truite mouchetée',  en: 'Brook Trout' },
  'omble-de-fontaine': { fr: 'Omble de fontaine', en: 'Arctic Char' },
};

export default function RiverInfoCard({ pathId, language = 'fr', onClose, onBook }) {
  const [imgError, setImgError] = useState(false);

  useEffect(() => { setImgError(false); }, [pathId]);

  const river = getRiverByPathId(pathId);

  if (!river) return null;

  const t = (fr, en) => language === 'en' ? en : fr;
  const displayName = formatRiverDisplayName(pathId, language);
  const region = getRegionLabel(river.region, language);
  const diff = DIFFICULTY_CONFIG[river.difficulty];
  const imgSrc = !imgError ? (RIVER_IMAGES[river.slug] || river.image || FALLBACK_IMAGE) : FALLBACK_IMAGE;

  const shortDesc = language === 'en'
    ? river.shortDescription?.en
    : river.shortDescription?.fr;

  const highlights = (river.highlights || []).map((h) => ({
    icon: h.icon,
    label: language === 'en' ? h.label.en : h.label.fr,
  }));

  const fishLabels = (river.fishTypes || []).map((f) => {
    const entry = FISH_LABELS[f];
    return entry ? (language === 'en' ? entry.en : entry.fr) : f;
  });

  return (
    <div style={{
      position: 'absolute',
      top: 12,
      right: 12,
      zIndex: 30,
      width: 280,
      background: '#fff',
      borderRadius: 14,
      boxShadow: '0 8px 32px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.10)',
      overflow: 'hidden',
      fontFamily: 'inherit',
      animation: 'riverCardIn 0.18s ease-out',
    }}>
      <style>{`
        @keyframes riverCardIn {
          from { opacity: 0; transform: translateY(-6px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>

      {/* Hero image */}
      <div style={{ position: 'relative', height: 150, background: '#1a2e1a', overflow: 'hidden' }}>
        <img
          key={river.slug}
          src={imgSrc}
          alt={displayName}
          onError={() => setImgError(true)}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block',
          }}
        />
        {/* Gradient overlay for text legibility */}
        <div style={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.08) 0%, rgba(0,0,0,0.55) 100%)',
        }} />

        {/* Difficulty badge overlaid on image */}
        {diff && (
          <div style={{
            position: 'absolute',
            top: 10,
            left: 10,
            background: diff.bg,
            color: diff.color,
            fontSize: 11,
            fontWeight: 700,
            padding: '3px 8px',
            borderRadius: 20,
            letterSpacing: '0.02em',
          }}>
            ★ {language === 'en' ? diff.en : diff.fr}
          </div>
        )}

        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            width: 28,
            height: 28,
            borderRadius: '50%',
            background: 'rgba(0,0,0,0.45)',
            border: 'none',
            color: '#fff',
            fontSize: 16,
            lineHeight: '28px',
            textAlign: 'center',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
          }}
          aria-label="Fermer"
        >
          ✕
        </button>

        {/* River name on image */}
        <div style={{
          position: 'absolute',
          bottom: 10,
          left: 12,
          right: 12,
        }}>
          <div style={{
            color: '#fff',
            fontWeight: 700,
            fontSize: 17,
            textShadow: '0 1px 4px rgba(0,0,0,0.6)',
            lineHeight: 1.2,
          }}>
            {displayName}
          </div>
          {region && (
            <div style={{
              color: 'rgba(255,255,255,0.85)',
              fontSize: 12,
              marginTop: 2,
              textShadow: '0 1px 3px rgba(0,0,0,0.5)',
            }}>
              📍 {region}
            </div>
          )}
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: '12px 14px 14px' }}>

        {/* Short description */}
        {shortDesc && (
          <p style={{
            margin: '0 0 10px',
            fontSize: 13,
            color: '#3D5A46',
            lineHeight: 1.5,
          }}>
            {shortDesc}
          </p>
        )}

        {/* Highlights */}
        {highlights.length > 0 && (
          <div style={{ marginBottom: 10 }}>
            {highlights.map((h, i) => (
              <div key={i} style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 12,
                color: '#4B6256',
                marginBottom: 4,
              }}>
                <span style={{ fontSize: 14 }}>{h.icon}</span>
                <span>{h.label}</span>
              </div>
            ))}
          </div>
        )}

        {/* Fish types */}
        {fishLabels.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 12 }}>
            {fishLabels.map((f) => (
              <span key={f} style={{
                background: '#E8F4F0',
                color: '#2D5F4C',
                fontSize: 11,
                fontWeight: 600,
                padding: '3px 8px',
                borderRadius: 20,
              }}>
                🐟 {f}
              </span>
            ))}
          </div>
        )}

        {/* CTA */}
        <button
          type="button"
          onClick={onBook}
          style={{
            width: '100%',
            padding: '10px',
            background: 'linear-gradient(135deg, #2D9C57 0%, #1a6e3a 100%)',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 700,
            cursor: 'pointer',
            letterSpacing: '0.02em',
            boxShadow: '0 2px 8px rgba(45,156,87,0.3)',
          }}
        >
          🎣 {t('Réserver une expérience', 'Book an Experience')}
        </button>
      </div>
    </div>
  );
}
