import { useCallback, useEffect, useRef, useState } from 'react';
import './MapBrowse.css';

const formatPrice = (price) => {
  if (!price && price !== 0) return null;
  const n = Number(price);
  return Number.isFinite(n) ? `${Math.round(n)}$` : null;
};

// ── ChaletMarker (DOM element for Mapbox) ────────────────────────
export function createChaletMarkerEl(chalet, { onClick, onHover, onLeave }) {
  const el = document.createElement('div');
  el.className = 'ms-chalet-marker';
  el.textContent = formatPrice(chalet.price_per_night) || formatPrice(chalet.price) || '—';
  el.dataset.chaletId = chalet.key || chalet.id || '';
  el.dataset.type = 'chalet';
  if (onClick) el.addEventListener('click', (e) => { e.stopPropagation(); onClick(chalet); });
  if (onHover) el.addEventListener('mouseenter', () => onHover(chalet));
  if (onLeave) el.addEventListener('mouseleave', () => onLeave(chalet));
  return el;
}

// ── GuideMarker (DOM element for Mapbox) ─────────────────────────
export function createGuideMarkerEl(guide, { onClick, onHover, onLeave }) {
  const el = document.createElement('div');
  el.className = 'ms-guide-marker';
  el.dataset.guideId = guide.guide_id || guide.id || '';
  el.dataset.type = 'guide';
  el.innerHTML = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.8-.1 2.6-.4C13 20.2 12 18.2 12 16c0-3.3 2.7-6 6-6 1.2 0 2.3.4 3.2 1-.2-4.9-4.2-9-9.2-9zm-1 9c-.6 0-1-.4-1-1s.4-1 1-1 1 .4 1 1-.4 1-1 1z"/>
  </svg>`;
  if (onClick) el.addEventListener('click', (e) => { e.stopPropagation(); onClick(guide); });
  if (onHover) el.addEventListener('mouseenter', () => onHover(guide));
  if (onLeave) el.addEventListener('mouseleave', () => onLeave(guide));
  return el;
}

// ── PreviewCard ──────────────────────────────────────────────────
export function PreviewCard({ item, type, onClose, onSelect, language = 'fr' }) {
  const t = (fr, en) => language === 'en' ? en : fr;

  if (type === 'chalet') {
    const price = formatPrice(item.price_per_night) || formatPrice(item.price);
    return (
      <div className="ms-preview-card">
        <button className="ms-preview-card-close" onClick={onClose} aria-label="Close">&times;</button>
        {item.Image && (
          <img className="ms-preview-card-image" src={item.Image} alt={item.Name || item.name} loading="lazy" />
        )}
        <div className="ms-preview-card-body">
          <span className="ms-preview-card-badge ms-badge-chalet">{t('Chalet', 'Chalet')}</span>
          <h3 className="ms-preview-card-title">{item.Name || item.name}</h3>
          <p className="ms-preview-card-subtitle">
            {item.nb_personnes && <>{item.nb_personnes} {t('personnes', 'guests')}</>}
            {item.etablishment_name && <> · {item.etablishment_name}</>}
          </p>
          {price && (
            <p className="ms-preview-card-price">{price} <span>/ {t('nuit', 'night')}</span></p>
          )}
          <button className="ms-preview-card-cta" onClick={() => onSelect && onSelect(item, 'chalet')}>
            {t('Sélectionner ce chalet', 'Select this chalet')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="ms-preview-card">
      <button className="ms-preview-card-close" onClick={onClose} aria-label="Close">&times;</button>
      <div className="ms-preview-guide-header">
        {item.avatarSrc ? (
          <img className="ms-preview-guide-avatar" src={item.avatarSrc} alt={item.name} />
        ) : (
          <div className="ms-preview-guide-avatar" style={{ background: 'linear-gradient(145deg, #E87B35, #D4692B)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="#FFFCF7">
              <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
            </svg>
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <span className="ms-preview-card-badge ms-badge-guide">{t('Guide', 'Guide')}</span>
          <h3 className="ms-preview-card-title">{item.name}</h3>
        </div>
      </div>
      <div className="ms-preview-card-body">
        {item.fish_types && item.fish_types.length > 0 && (
          <div className="ms-preview-card-meta">
            {item.fish_types.slice(0, 3).map((ft) => (
              <span key={ft} className="ms-preview-card-meta-tag">{ft}</span>
            ))}
          </div>
        )}
        {item.hourly_rate && (
          <p className="ms-preview-card-price">{Math.round(item.hourly_rate)}$ <span>/ {t('heure', 'hour')}</span></p>
        )}
        <button className="ms-preview-card-cta ms-cta-guide" onClick={() => onSelect && onSelect(item, 'guide')}>
          {t('Sélectionner ce guide', 'Select this guide')}
        </button>
      </div>
    </div>
  );
}

// ── MapLegend ────────────────────────────────────────────────────
export function MapLegend({ language = 'fr', hasChalets, hasGuides }) {
  const t = (fr, en) => language === 'en' ? en : fr;
  if (!hasChalets && !hasGuides) return null;
  return (
    <div className="ms-map-legend">
      {hasChalets && (
        <div className="ms-map-legend-item">
          <div className="ms-legend-chalet-dot" />
          <span>{t('Chalets', 'Chalets')}</span>
        </div>
      )}
      {hasGuides && (
        <div className="ms-map-legend-item">
          <div className="ms-legend-guide-dot" />
          <span>{t('Guides', 'Guides')}</span>
        </div>
      )}
    </div>
  );
}

// ── useStep3Markers hook ─────────────────────────────────────────
// Manages Mapbox marker lifecycle for step 3 chalets + guides.
// Also drives hover sync and preview card state.
export function useStep3Markers({
  mapRef,
  mapReady,
  active,
  chalets = [],
  guides = [],
  guideCoords = {},
  selectedChalet,
  selectedGuide,
  onSelectChalet,
  onSelectGuide,
  language = 'fr',
}) {
  const markersRef = useRef([]);
  const [hoveredId, setHoveredId] = useState(null);
  const [hoveredType, setHoveredType] = useState(null);
  const [previewItem, setPreviewItem] = useState(null);
  const [previewType, setPreviewType] = useState(null);
  const [previewPos, setPreviewPos] = useState(null);

  const clearMarkers = useCallback(() => {
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];
  }, []);

  const closePreview = useCallback(() => {
    setPreviewItem(null);
    setPreviewType(null);
    setPreviewPos(null);
  }, []);

  // Open preview card near a marker
  const openPreview = useCallback((item, type) => {
    const map = mapRef.current;
    if (!map) return;
    setPreviewItem(item);
    setPreviewType(type);
    const lng = item._lng;
    const lat = item._lat;
    if (lng != null && lat != null) {
      const pt = map.project([lng, lat]);
      setPreviewPos({ x: pt.x, y: pt.y });
    }
  }, [mapRef]);

  // Reposition preview on map move
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !previewItem) return;
    const update = () => {
      if (previewItem._lng != null && previewItem._lat != null) {
        const pt = map.project([previewItem._lng, previewItem._lat]);
        setPreviewPos({ x: pt.x, y: pt.y });
      }
    };
    map.on('move', update);
    return () => map.off('move', update);
  }, [mapRef, previewItem]);

  // Handle select from preview card
  const handlePreviewSelect = useCallback((item, type) => {
    closePreview();
    if (type === 'chalet' && onSelectChalet) {
      onSelectChalet({ id: item.key || item.id, name: item.Name, ...item });
    } else if (type === 'guide' && onSelectGuide) {
      onSelectGuide(item);
    }
  }, [closePreview, onSelectChalet, onSelectGuide]);

  // Render / update markers
  useEffect(() => {
    const map = mapRef.current;
    const mb = globalThis.mapboxgl;
    if (!map || !mb || !active) {
      clearMarkers();
      return;
    }

    clearMarkers();

    // Chalet markers — coordinates come from chalet_lng / chalet_lat returned by the RPC
    chalets.forEach((chalet) => {
      const lng = chalet.chalet_lng ?? chalet._lng;
      const lat = chalet.chalet_lat ?? chalet._lat;
      if (lng == null || lat == null) return;

      const enriched = { ...chalet, _lng: lng, _lat: lat };
      const el = createChaletMarkerEl(enriched, {
        onClick: (c) => openPreview(c, 'chalet'),
        onHover: (c) => { setHoveredId(c.key || c.id); setHoveredType('chalet'); },
        onLeave: () => { setHoveredId(null); setHoveredType(null); },
      });

      const isSelected = selectedChalet && (selectedChalet.id === (chalet.key || chalet.id));
      if (isSelected) el.classList.add('ms-marker-active');

      const marker = new mb.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([lng, lat])
        .addTo(map);
      marker._msId = chalet.key || chalet.id;
      marker._msType = 'chalet';
      markersRef.current.push(marker);
    });

    // Guide markers — use guideCoords map for locations
    guides.forEach((guide) => {
      const coords = guideCoords[guide.guide_id || guide.id];
      if (!coords) return;
      const { lng, lat } = coords;

      const enriched = { ...guide, _lng: lng, _lat: lat };
      const el = createGuideMarkerEl(enriched, {
        onClick: (g) => openPreview(g, 'guide'),
        onHover: (g) => { setHoveredId(g.guide_id || g.id); setHoveredType('guide'); },
        onLeave: () => { setHoveredId(null); setHoveredType(null); },
      });

      const isSelected = selectedGuide && (selectedGuide.guide_id === (guide.guide_id || guide.id));
      if (isSelected) el.classList.add('ms-marker-active');

      const marker = new mb.Marker({ element: el, anchor: 'center' })
        .setLngLat([lng, lat])
        .addTo(map);
      marker._msId = guide.guide_id || guide.id;
      marker._msType = 'guide';
      markersRef.current.push(marker);
    });
  }, [mapRef, mapReady, active, chalets, guides, guideCoords, selectedChalet, selectedGuide, clearMarkers, openPreview]);

  // Sync hover class on markers from list hover
  const highlightMarker = useCallback((id, type) => {
    setHoveredId(id);
    setHoveredType(type);
    markersRef.current.forEach((m) => {
      const el = m.getElement();
      if (!el) return;
      const match = m._msId === id && m._msType === type;
      el.classList.toggle('ms-marker-hover', match);
    });
  }, []);

  const clearHighlight = useCallback(() => {
    setHoveredId(null);
    setHoveredType(null);
    markersRef.current.forEach((m) => {
      const el = m.getElement();
      if (el) el.classList.remove('ms-marker-hover');
    });
  }, []);

  // Fly to a marker
  const flyToMarker = useCallback((id, type) => {
    const map = mapRef.current;
    if (!map) return;
    const marker = markersRef.current.find((m) => m._msId === id && m._msType === type);
    if (marker) {
      const lngLat = marker.getLngLat();
      map.flyTo({ center: lngLat, zoom: Math.max(map.getZoom(), 10), duration: 500 });
    }
  }, [mapRef]);

  // Clean up on unmount
  useEffect(() => () => clearMarkers(), [clearMarkers]);

  return {
    hoveredId,
    hoveredType,
    previewItem,
    previewType,
    previewPos,
    closePreview,
    handlePreviewSelect,
    highlightMarker,
    clearHighlight,
    flyToMarker,
  };
}
