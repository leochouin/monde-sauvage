import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AvatarImage from './AvatarImage.jsx';
import DateRangePicker from './DateRangePicker.jsx';
import GuideAvailabilityCalendarModal from '../modals/guideAvailabilityCalendarModal.jsx';
import supabase from '../utils/supabase.js';
import useAvatarSource from '../utils/useAvatarSource.js';
import { buildRiverGeoJSON } from '../utils/riverPaths.js';
import { useStep3Markers, PreviewCard, MapLegend } from './MapBrowse.jsx';
import RiverBioCards from './RiverBioCards.jsx';
import GuideSlotPickerModal from '../modals/guideSlotPickerModal.jsx';
import { getRiverByPathId } from '../utils/riverGuideData.js';
import RiverInfoCard from './RiverInfoCard.jsx';
import { RIVER_IMAGES } from '../utils/riverImages.js';
import EnvironmentalDrawer from './EnvironmentalDrawer.jsx';
import useEnvironmentalData from '../utils/useEnvironmentalData.js';
import { RIVER_STATIONS, TIDE_STATIONS } from '../utils/environmentalStations.js';

// Tuned values for the step-1 river "attract" pulse.
const ATTRACT = {
  color: '#2ca1a7',
  gapWidth: 0,
  edgeWidth: 0.5,
  edgeBlur: 0,
  glowWidth: 15,
  glowBlur: 11,
  lineOpMin: 0,
  lineOpMax: 1,
  glowOpMin: 0,
  glowOpMax: 1,
  speed: 2.1,
};

let mapboxAssetsPromise = null;

// Custom pin-drop cursor for step-1 map interactions (click to place radius circle).
const PIN_DROP_CURSOR = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='26' height='34' viewBox='0 0 26 34'%3E%3Cpath d='M13 0C5.82 0 0 5.82 0 13c0 9.75 13 21 13 21s13-11.25 13-21C26 5.82 20.18 0 13 0z' fill='%232D5F4C'/%3E%3Ccircle cx='13' cy='13' r='4.5' fill='white'/%3E%3C/svg%3E\") 13 34, crosshair";

const escapeHtml = (value = '') => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const normalizeWebsiteUrl = (website) => {
  if (!website) return '';

  const rawValue = String(website).trim();
  if (!rawValue) return '';

  try {
    return new URL(rawValue).toString();
  } catch {
    try {
      return new URL(`https://${rawValue}`).toString();
    } catch {
      return '';
    }
  }
};

const buildBusinessPopupHtml = (properties = {}) => {
  const safeName = escapeHtml(properties.name || 'Business');
  const websiteUrl = normalizeWebsiteUrl(properties.website);
  const safeWebsiteUrl = escapeHtml(websiteUrl);

  const rawDescription = String(properties.description || '').trim();
  const isLongDescription = rawDescription.length > 170;
  const trimmedDescription = isLongDescription
    ? `${rawDescription.slice(0, 167).trimEnd()}...`
    : rawDescription;
  const safeDescription = escapeHtml(trimmedDescription || 'Explore this partner business.');

  const websiteHost = websiteUrl
    ? escapeHtml(new URL(websiteUrl).hostname.replace(/^www\./i, ''))
    : '';
  const encodedWebsiteUrl = encodeURIComponent(websiteUrl);
  const previewImageUrl = websiteUrl
    ? `https://s.wordpress.com/mshots/v1/${encodedWebsiteUrl}?w=1200`
    : '';
  const backupPreviewImageUrl = websiteUrl
    ? `https://image.thum.io/get/width/1000/crop/700/noanimate/${websiteUrl}`
    : '';
  const safeBackupPreviewImageUrl = escapeHtml(backupPreviewImageUrl);

  return `
    <article class="business-popup">
      <header class="business-popup-header">
        <h3 class="business-popup-title">${safeName}</h3>
        ${websiteHost ? `<span class="business-popup-domain">${websiteHost}</span>` : ''}
      </header>
      <p class="business-popup-description">${safeDescription}</p>
      ${websiteUrl ? `
        <a class="business-popup-preview" href="${safeWebsiteUrl}" target="_blank" rel="noopener noreferrer" aria-label="Open ${safeName} website in a new tab">
          ${previewImageUrl ? `<img src="${previewImageUrl}" alt="Homepage for ${safeName}" loading="lazy" onerror="if (!this.dataset.retry) { this.dataset.retry = '1'; this.src = '${safeBackupPreviewImageUrl}'; return; } this.parentElement.classList.add('business-popup-preview-fallback'); this.remove();" />` : ''}
        </a>
        <a class="business-popup-cta" href="${safeWebsiteUrl}" target="_blank" rel="noopener noreferrer">Visit website</a>
      ` : '<div class="business-popup-no-site">Website coming soon</div>'}
    </article>
  `;
};

const loadMapboxAssets = () => {
  if (typeof globalThis === 'undefined') {
    return Promise.reject(new Error('Window is not available.'));
  }

  if (globalThis.mapboxgl) {
    return Promise.resolve(globalThis.mapboxgl);
  }

  if (mapboxAssetsPromise) {
    return mapboxAssetsPromise;
  }

  mapboxAssetsPromise = new Promise((resolve, reject) => {
    const head = document.head;
    if (!head) {
      reject(new Error('Document head is not available.'));
      return;
    }

    const styleId = 'mapbox-gl-style';
    const scriptId = 'mapbox-gl-script';

    if (!document.getElementById(styleId)) {
      const link = document.createElement('link');
      link.id = styleId;
      link.href = 'https://api.mapbox.com/mapbox-gl-js/v3.15.0/mapbox-gl.css';
      link.rel = 'stylesheet';
      head.appendChild(link);
    }

    const resolveWhenReady = () => {
      if (globalThis.mapboxgl) {
        resolve(globalThis.mapboxgl);
      }
    };

    const existingScript = document.getElementById(scriptId);
    if (existingScript) {
      if (globalThis.mapboxgl) {
        resolve(globalThis.mapboxgl);
      } else {
        existingScript.addEventListener('load', resolveWhenReady, { once: true });
        existingScript.addEventListener('error', () => {
          mapboxAssetsPromise = null;
          reject(new Error('Failed to load Mapbox script.'));
        }, { once: true });
      }
      return;
    }

    const script = document.createElement('script');
    script.id = scriptId;
    script.src = 'https://api.mapbox.com/mapbox-gl-js/v3.15.0/mapbox-gl.js';
    script.async = true;
    script.onload = resolveWhenReady;
    script.onerror = () => {
      mapboxAssetsPromise = null;
      reject(new Error('Failed to load Mapbox script.'));
    };
    head.appendChild(script);
  });

  return mapboxAssetsPromise;
};

/** Même tonalité que le panneau gauche (menu réservation). */
const SIDEBAR_PANEL_BG = 'linear-gradient(165deg, #f8f4ea 0%, #f4efe3 48%, #f2ede2 100%)';

const SIDEBAR_WIDTH_TOKENS = {
  compact: 'clamp(300px, 28vw, 420px)',
  medium: 'clamp(360px, 32vw, 500px)',
  /** Étape 3 — large panneau liste (inchangé quand on veut « garder » le menu). */
  step3Narrow: 'clamp(450px, 42vw, 720px)',
  wide: 'clamp(520px, 40vw, 760px)',
  xwide: 'clamp(340px, 35vw, 560px)',
};

const getSidebarWidthToken = ({ bookingStep }) => {
  switch (bookingStep) {
    case 1:
      return 'xwide';
    case 2:
      return 'medium';
    case 3:
    case 4:
      return 'step3Narrow';
    case 5:
      return 'medium';
    default:
      return 'compact';
  }
};

const GaspesieMap = ({ 
  onClick,
  login,
  user,
  profile,
  language = 'fr',
  setLanguage,
  isTripOpen,
  isGuideFlowOpen,
  isChaletFlowOpen,
  isAccountSettingsOpen,
  isSocialFeedOpen,
  radius, 
  isRejoindreOpen,
  isEtablissementOpen,
  onGoHome,
  // Booking flow props
  browseMode,
  bookingStep,
  setBookingStep,
  startDate,
  setStartDate,
  endDate,
  setEndDate,
  originalStartDate,
  originalEndDate,
  alternativeDateOptions,
  loadingAlternativeDates,
  applyAlternativeDateOption,
  goToResultsStep,
  numberOfPeople,
  setNumberOfPeople,
  setRadius,
  selectedChalet,
  availableGuides,
  loadingGuides,
  selectedGuide,
  handleSelectGuide,
  handleBookGuide,
  resetBookingFlow,
  canProceedStep2,
  canProceedStep3,
  // Chalet search props for Step 2
  chalets,
  loadingChalets,
  chaletError,
  handleVoirPlus,
  handleSelectedChalet,
  selectedPoint,
  // NEW FLOW: Step 1 destination — river + radius coexist
  selectedRiver: selectedRiverProp,
  onSelectRiver,
  formatRiverName,
  getRiverDetails,
  knownRivers = [],
  // Step 3 preferences / filters
  fishType,
  setFishType,
  needsChalet,
  setNeedsChalet,
  fishingZones,
  loadingZones,
  FISH_TYPES,
  // NEW: Booking creation state
  isCreatingBooking,
  bookingError,
  // Help/onboarding
  onOpenHelp,
  // NEW: Guide availability time slots
  guideAvailabilityEvents,
  loadingGuideAvailability,
  selectedTimeSlots,
  handleSelectTimeSlot,
  equipmentKinds = [],
  loadingEquipmentKinds = false,
  inventoryAddonQtyBySlug = {},
  setInventoryAddonQtyBySlug = () => {},
  availableCountByKindId = {},
  availableCountsLoaded = false,
}) => {
  // Start slightly shifted to the right/east so the initial view avoids
  // placing key content under fixed skin elements.
  const INITIAL_MAP_CENTER = [-65.35, 48.55];
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const mapStyleLoaded = useRef(false);
  const [mapReady, setMapReady] = useState(false);

  // --- Additive environmental layers (river flow + tides). Fully self-contained:
  // node GeoJSON + lazy per-station fetchers, plus the clicked selection that
  // drives the bottom-sheet drawer. None of this touches existing map logic.
  const { riverNodes, tideNodes, fetchRiverDetail, fetchTideDetail } = useEnvironmentalData();
  const [envSelection, setEnvSelection] = useState(null);

  const [circleCenter, setCircleCenter] = useState(null);
  // Rivers within the current circle radius — shown in sidebar + drives multi-glow.
  const [nearbyRiverIds, setNearbyRiverIds] = useState([]);
  const [mapInitError, setMapInitError] = useState('');
  const [mapInitAttempt, setMapInitAttempt] = useState(0);

  // River overlay (native Mapbox layers).
  // Local state mirrors the map highlight; when in the booking flow we also
  // sync to the parent via `onSelectRiver` so MapApp can use it for chalet search.
  const [selectedRiver, setSelectedRiver] = useState(null);

  // Info card shown when clicking a river in browse mode (step 0).
  const [infoCardRiver, setInfoCardRiver] = useState(null);
  const infoCardRiverRef = useRef(null);

  // Ref mirror of bookingStep — click handlers registered inside map.on('load')
  // close over the initial value, so we read through a ref instead of the prop.
  const bookingStepRef = useRef(bookingStep);
  useEffect(() => { bookingStepRef.current = bookingStep; }, [bookingStep]);

  // Ref for the river selection callback, same rationale as bookingStepRef.
  const onSelectRiverRef = useRef(onSelectRiver);
  useEffect(() => { onSelectRiverRef.current = onSelectRiver; }, [onSelectRiver]);

  // Dismiss info card when the user enters the booking flow.
  useEffect(() => {
    if (bookingStep !== 0) {
      setInfoCardRiver(null);
      infoCardRiverRef.current = null;
    }
  }, [bookingStep]);

  // Sync parent-provided selectedRiver → local state (e.g. when reset clears it,
  // or when the dropdown selects a river). Also re-applies the map highlight
  // visually so dropdown selection feels identical to clicking on the map.
  useEffect(() => {
    if (selectedRiverProp !== selectedRiver) {
      setSelectedRiver(selectedRiverProp || null);
      const map = mapRef.current;
      if (map) {
        map._riverSelected = selectedRiverProp || null;
        if (typeof map._setRiverGlow === 'function') {
          map._setRiverGlow(selectedRiverProp || null);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRiverProp]);

  // When the parent nulls selectedPoint (e.g. river is selected → handleSelectRiver
  // calls setSelectedPoint(null)), remove the circle layers from the map immediately
  // so the circle disappears in sync with the river highlight appearing.
  useEffect(() => {
    if (selectedPoint) return; // point still active — nothing to do
    setCircleCenter(null);
    setNearbyRiverIds([]);
    const map = mapRef.current;
    if (!map) return;
    map._circleMode = false;
    try {
      if (map.getLayer('circle-outline')) map.removeLayer('circle-outline');
      if (map.getLayer('circle')) map.removeLayer('circle');
      if (map.getSource('circle-source')) map.removeSource('circle-source');
    } catch { /* layers already gone */ }
    // Réinitialise le halo « cercle / rivières proches » (partage les mêmes calques que la sélection).
    // Sans ré-application, une rivière déjà choisie disparaît visuellement dès ce reset.
    if (typeof map._setRiversGlow === 'function') map._setRiversGlow([]);
    const rid = map._riverSelected || selectedRiver;
    if (rid && typeof map._setRiverGlow === 'function') {
      map._setRiverGlow(rid);
    }
  }, [selectedPoint, selectedRiver]);

  // En quittant l’étape 1 avec une rivière choisie, garantir ref + calques (clics carte sans rivière sous le curseur, etc.).
  useEffect(() => {
    if (bookingStep <= 1) return;
    const map = mapRef.current;
    if (!map || !selectedRiver) return;
    map._riverSelected = selectedRiver;
    if (typeof map._setRiverGlow === 'function') {
      map._setRiverGlow(selectedRiver);
    }
  }, [bookingStep, selectedRiver]);

  // Detect if mobile for responsive button sizing
  const [isMobile, setIsMobile] = useState(typeof globalThis !== 'undefined' && globalThis.innerWidth < 768);
  const [isCompactViewport, setIsCompactViewport] = useState(
    typeof globalThis !== 'undefined'
      && globalThis.innerWidth >= 768
      && (globalThis.innerWidth < 1180 || globalThis.innerHeight < 860)
  );
  const [mobileSheetExpanded, setMobileSheetExpanded] = useState(false);
  const [calendarModalOpen, setCalendarModalOpen] = useState(false);
  const [selectedGuideForCalendar, setSelectedGuideForCalendar] = useState(null);
  const [slotPickerOpen, setSlotPickerOpen] = useState(false);
  // 'all' | 'chalets' | 'guides' — used at step 3 to declutter the map
  const [mapLayerFilter, setMapLayerFilter] = useState('all');
  const [showStep3FlexibleDates, setShowStep3FlexibleDates] = useState(false);
  const [showStep3Filters, setShowStep3Filters] = useState(false);
  const [showOnlyAvailableChalets, setShowOnlyAvailableChalets] = useState(false);
  const [mapPickerActive, setMapPickerActive] = useState(false);
  const mapPickerActiveRef = useRef(false);
  const sheetTouchStartY = useRef(0);

  // Deactivate map picker mode as soon as a point is placed
  useEffect(() => {
    if (selectedPoint && mapPickerActiveRef.current) {
      setMapPickerActive(false);
      mapPickerActiveRef.current = false;
    }
  }, [selectedPoint]);

  const sidebarWidthToken = useMemo(
    () => getSidebarWidthToken({ bookingStep }),
    [bookingStep, browseMode, needsChalet],
  );

  const sidebarWidth = SIDEBAR_WIDTH_TOKENS[sidebarWidthToken];

  // Guide map coordinates: only use real lng/lat from the database.
  // Guides without real coordinates are shown in the side list only — we
  // intentionally avoid fake/random positioning on the map.
  const step3GuideCoords = useMemo(() => {
    const coords = {};
    (availableGuides || []).forEach((g) => {
      const gid = g.guide_id || g.id || '';
      const lng = Number(g.lng ?? g.longitude);
      const lat = Number(g.lat ?? g.latitude);
      if (Number.isFinite(lng) && Number.isFinite(lat)) {
        coords[gid] = { lng, lat };
      }
    });
    return coords;
  }, [availableGuides]);

  // Step 3 markers: dual chalet + guide pins on the map
  const step3MarkersActive = bookingStep === 3 && mapReady;
  // Apply layer filter to declutter the map when both chalets + guides
  // would otherwise overlap heavily.
  const visibleChalets = mapLayerFilter === 'guides' ? [] : chalets;
  const visibleGuides = mapLayerFilter === 'chalets' ? [] : availableGuides;
  const {
    hoveredId: s3HoveredId,
    hoveredType: s3HoveredType,
    previewItem: s3PreviewItem,
    previewType: s3PreviewType,
    previewPos: s3PreviewPos,
    closePreview: s3ClosePreview,
    handlePreviewSelect: s3PreviewSelect,
    highlightMarker: s3Highlight,
    clearHighlight: s3ClearHighlight,
    flyToMarker: _s3FlyTo,
  } = useStep3Markers({
    mapRef,
    mapReady,
    active: step3MarkersActive,
    chalets: visibleChalets,
    guides: visibleGuides,
    guideCoords: step3GuideCoords,
    selectedChalet,
    selectedGuide,
    onSelectChalet: handleSelectedChalet,
    onSelectGuide: handleSelectGuide,
    language,
  });

  // Enable map gestures only while pointer is over the map container so
  // trackpad zoom/pan feels immediate without hijacking page scroll elsewhere.
  const setMapHoverInteractions = useCallback((isEnabled) => {
    const map = mapRef.current;
    if (!map) return;

    if (isMobile) {
      if (map.dragPan) map.dragPan.enable();
      if (map.touchZoomRotate) map.touchZoomRotate.enable();
      return;
    }

    if (isEnabled) {
      if (map.scrollZoom) map.scrollZoom.enable();
      if (map.dragPan) map.dragPan.enable();
      return;
    }

    if (map.scrollZoom) map.scrollZoom.disable();
    if (map.dragPan) map.dragPan.disable();
  }, [isMobile]);

  // Auto-expand/collapse mobile sheet with booking flow
  useEffect(() => {
    if (!isMobile) return;
    if (bookingStep > 0) setMobileSheetExpanded(true);
    else setMobileSheetExpanded(false);
  }, [isMobile, bookingStep]);

  // Keep accordion/filter presentation state scoped to the step-3 results surface.
  useEffect(() => {
    if (bookingStep !== 3) {
      setShowStep3FlexibleDates(false);
      setShowStep3Filters(false);
    }
  }, [bookingStep]);

  // Touch handlers for mobile bottom sheet drag
  const handleSheetTouchStart = useCallback((e) => {
    sheetTouchStartY.current = e.touches[0].clientY;
  }, []);

  const handleSheetTouchEnd = useCallback((e) => {
    const deltaY = sheetTouchStartY.current - e.changedTouches[0].clientY;
    if (deltaY > 50) {
      setMobileSheetExpanded(true);
    } else if (deltaY < -50 && bookingStep === 0) {
      setMobileSheetExpanded(false);
    }
  }, [bookingStep]);

  // Landscape suggestion — show once per session on portrait mobile
  const [showLandscapeHint, setShowLandscapeHint] = useState(false);
  const isEnglish = language === 'en';
  const uiLocale = isEnglish ? 'en-CA' : 'fr-CA';

  const addonStayNights = useMemo(() => {
    if (!startDate || !endDate) return 1;
    const d0 = new Date(`${startDate}T12:00:00`).getTime();
    const d1 = new Date(`${endDate}T12:00:00`).getTime();
    const diff = Math.round((d1 - d0) / 86400000);
    return Math.max(1, diff);
  }, [startDate, endDate]);

  const bumpInventoryAddonQty = useCallback((slug, delta, maxAvailable) => {
    setInventoryAddonQtyBySlug((prev) => {
      const cur = Math.floor(Number(prev[slug] ?? 0));
      const hardMax = typeof maxAvailable === 'number' ? Math.min(50, maxAvailable) : 50;
      const n = Math.min(hardMax, Math.max(0, cur + delta));
      const next = { ...prev };
      if (n <= 0) delete next[slug];
      else next[slug] = n;
      return next;
    });
  }, [setInventoryAddonQtyBySlug]);

  const equipmentTotalUnits = useMemo(() => (
    Object.values(inventoryAddonQtyBySlug).reduce(
      (s, q) => s + Math.max(0, Math.floor(Number(q) || 0)),
      0,
    )
  ), [inventoryAddonQtyBySlug]);

  const t = useCallback((frText, enText) => (isEnglish ? enText : frText), [isEnglish]);

  /** 5 = parcours avec chalet (étape 4 équipements, 5 confirmation), 4 = sans chalet. */
  const bookingMaxStep = useMemo(
    () => (browseMode === 'chalet' || (browseMode === 'trip' && needsChalet) ? 5 : 4),
    [browseMode, needsChalet],
  );

  /** Normalised river slug derived from the currently selected river path ID. */
  const selectedRiverSlug = useMemo(() => {
    if (!selectedRiver) return null;
    const r = getRiverByPathId(selectedRiver);
    if (!r) return null;
    const raw = r.name?.fr || r.name?.en || r.slug || '';
    return raw.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  }, [selectedRiver]);

  /** Guides sorted: preferred-river first, then available first. */
  const sortedAvailableGuides = useMemo(() => {
    const prefersRiver = (guide) => {
      if (!selectedRiverSlug) return true;
      const zones = guide.preferredZoneNames || [];
      if (zones.length === 0) return false;
      return zones.some((z) => z.includes(selectedRiverSlug));
    };
    return [...(availableGuides || [])].sort((a, b) => {
      const aPref = prefersRiver(a) ? 1 : 0;
      const bPref = prefersRiver(b) ? 1 : 0;
      if (bPref !== aPref) return bPref - aPref;
      return (b.is_available === true) - (a.is_available === true);
    });
  }, [availableGuides, selectedRiverSlug]);

  const goFromStep3ToNext = useCallback(() => {
    if (!canProceedStep3 || isCreatingBooking) return;
    const withChaletLeg = (browseMode === 'chalet' || (browseMode === 'trip' && needsChalet)) && selectedChalet;
    if (withChaletLeg) setBookingStep(4);
    else handleBookGuide();
  }, [canProceedStep3, isCreatingBooking, browseMode, needsChalet, selectedChalet, handleBookGuide, setBookingStep]);

  const openGuideSlotPicker = useCallback((guide) => {
    if (!guide || guide.is_available === false) return;

    if (selectedGuide?.guide_id !== guide.guide_id) {
      handleSelectGuide(guide);
    }

    setSlotPickerOpen(true);
  }, [handleSelectGuide, selectedGuide?.guide_id]);

  const parseIsoDateLocal = useCallback((isoDate) => {
    if (!isoDate) return null;
    const parts = isoDate.split('-').map((value) => parseInt(value, 10));
    if (parts.length !== 3 || parts.some((value) => Number.isNaN(value))) return null;
    const [year, month, day] = parts;
    return new Date(year, month - 1, day);
  }, []);

  const toIsoDateLocal = useCallback((date) => {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }, []);

  const formatLongDate = useCallback((isoDate) => {
    const parsedDate = parseIsoDateLocal(isoDate);
    if (!parsedDate) return '';
    return parsedDate.toLocaleDateString(uiLocale, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
  }, [parseIsoDateLocal, uiLocale]);

  useEffect(() => {
    if (typeof globalThis === 'undefined' || !globalThis.matchMedia) return;

    // Skip if already dismissed this session
    const dismissed = globalThis.sessionStorage?.getItem('ms_landscape_dismissed');
    if (dismissed) return;

    // Only target phones (narrow screens), not tablets
    const isPhone = globalThis.innerWidth < 768 && globalThis.innerHeight < 1024;
    if (!isPhone) return;

    const isPortrait = globalThis.matchMedia('(orientation: portrait)');
    if (isPortrait.matches) {
      // Small delay so it doesn't flash on page load
      const timer = setTimeout(() => setShowLandscapeHint(true), 1200);
      return () => clearTimeout(timer);
    }
  }, []);

  const dismissLandscapeHint = useCallback(() => {
    setShowLandscapeHint(false);
    try { globalThis.sessionStorage?.setItem('ms_landscape_dismissed', '1'); } catch { /* storage unavailable */ }
  }, []);

  // Auto-dismiss if user rotates to landscape
  useEffect(() => {
    if (!showLandscapeHint || typeof globalThis === 'undefined' || !globalThis.matchMedia) return;
    const mql = globalThis.matchMedia('(orientation: landscape)');
    const handler = (e) => { if (e.matches) dismissLandscapeHint(); };
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [showLandscapeHint, dismissLandscapeHint]);

  // Sign out function
  const handleSignOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error('Error signing out:', error);
    } else {
      console.log('✅ Signed out successfully');
    }
  };

  const { avatarSrc, handleAvatarError } = useAvatarSource(user);

  const renderLanguageSwitch = () => (
    <div style={{ display: 'inline-flex', gap: '6px', alignItems: 'center' }}>
      <button
        type="button"
        onClick={() => setLanguage?.('fr')}
        style={{
          border: language === 'fr' ? '1px solid #214537' : '1px solid rgba(33, 69, 55, 0.35)',
          background: language === 'fr' ? '#214537' : 'transparent',
          color: language === 'fr' ? '#fff' : '#214537',
          borderRadius: '999px',
          padding: '3px 10px',
          fontWeight: 600,
          fontSize: '11px',
          cursor: 'pointer',
        }}
      >
        FR
      </button>
      <button
        type="button"
        onClick={() => setLanguage?.('en')}
        style={{
          border: language === 'en' ? '1px solid #214537' : '1px solid rgba(33, 69, 55, 0.35)',
          background: language === 'en' ? '#214537' : 'transparent',
          color: language === 'en' ? '#fff' : '#214537',
          borderRadius: '999px',
          padding: '3px 10px',
          fontWeight: 600,
          fontSize: '11px',
          cursor: 'pointer',
        }}
      >
        EN
      </button>
    </div>
  );
    
  // Handle window resize for mobile detection
  useEffect(() => {
    const handleResize = () => {
      if (typeof globalThis === 'undefined') return;
      setIsMobile(globalThis.innerWidth < 768);
      setIsCompactViewport(
        globalThis.innerWidth >= 768
        && (globalThis.innerWidth < 1180 || globalThis.innerHeight < 860)
      );
    };

    if (typeof globalThis !== 'undefined' && globalThis.addEventListener) {
      globalThis.addEventListener('resize', handleResize);
      return () => globalThis.removeEventListener('resize', handleResize);
    }
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (isMobile) {
      if (map.dragPan) map.dragPan.enable();
      if (map.touchZoomRotate) map.touchZoomRotate.enable();
      return;
    }

    if (map.scrollZoom) map.scrollZoom.disable();
    if (map.dragPan) map.dragPan.disable();
  }, [isMobile]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || isMobile) return;

    // Sidebar width is now instant (no CSS transition), so resize in the next
    // frame after the layout has settled.
    const raf = requestAnimationFrame(() => {
      if (typeof map.resize === 'function') map.resize();
    });

    return () => cancelAnimationFrame(raf);
  }, [sidebarWidthToken, isMobile]);

  // Keep map canvas in sync with container size (window resize, etc.)
  useEffect(() => {
    const el = mapContainerRef.current;
    const map = mapRef.current;
    if (!el || !map || !mapReady || isMobile) return;

    const ro = new ResizeObserver(() => {
      if (typeof map.resize === 'function') map.resize();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [mapReady, isMobile]);

  const initializeMapRuntime = useCallback(() => {
    let cancelled = false;

    if (mapContainerRef.current) {
      mapContainerRef.current.innerHTML = '';
    }

    loadMapboxAssets()
      .then((mapboxgl) => {
        if (cancelled || mapRef.current || !mapContainerRef.current) return;

        if (typeof mapboxgl.supported === 'function' && !mapboxgl.supported()) {
          setMapInitError('Votre appareil ne supporte pas WebGL. Veuillez essayer un autre navigateur ou appareil.');
          return;
        }

        try {
          initializeMap(mapboxgl);
          setMapInitError('');
        } catch (error) {
          console.error('Map initialization failed:', error);
          setMapInitError('Impossible de charger la carte pour le moment.');
        }
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('Failed to load map assets:', error);
        setMapInitError('Impossible de charger la carte pour le moment.');
      });

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // First useEffect - Initialize map
  useEffect(() => {
    if (mapRef.current) return;
    return initializeMapRuntime();
  }, [initializeMapRuntime, mapInitAttempt]);

  // Preload all river images so popup cards appear instantly
  useEffect(() => {
    Object.values(RIVER_IMAGES).forEach((url) => {
      const img = new Image();
      img.src = url;
    });
  }, []);

  const handleRetryMapInit = () => {
    setMapInitError('');
    setMapInitAttempt((currentAttempt) => currentAttempt + 1);
  };
  function drawCircle(map, lngLat, radius) {
        

        const radiusInKm = radius || 20; // Default to 20 km if radius not provided
        const circleData = createGeoJSONCircle([lngLat.lng, lngLat.lat], radiusInKm);
        
        if (map.getSource('circle-source')) {
          map.getSource('circle-source').setData(circleData);
        } else {
          map.addSource('circle-source', {
            type: 'geojson',
            data: circleData
          });

          map.addLayer({
            id: 'circle',
            source: 'circle-source',
            type: 'fill',
            paint: {
              'fill-color': '#000',
              'fill-opacity': 0.3
            }
          });

          map.addLayer({
            id: 'circle-outline',
            source: 'circle-source',
            type: 'line',
            paint: {
              'line-color': '#000',
              'line-width': 2,
              'line-opacity': 0.8
            }
          });
        }
      };
  function createGeoJSONCircle(center, radiusInKm, points = 64) {
        const coords = {
          latitude: center[1],
          longitude: center[0]
        };

        const km = radiusInKm;
        const ret = [];
        const distanceX = km / (111.320 * Math.cos(coords.latitude * Math.PI / 180));
        const distanceY = km / 110.574;

        for (let i = 0; i < points; i++) {
          const theta = (i / points) * (2 * Math.PI);
          const x = distanceX * Math.cos(theta);
          const y = distanceY * Math.sin(theta);

          ret.push([coords.longitude + x, coords.latitude + y]);
        }
        ret.push(ret[0]);

        return {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [ret]
          }
        };
      }

  // Haversine distance between two lat/lng pairs (in km).
  function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2
      + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // Queries the 'rivers' GeoJSON source for all features whose coordinates
  // contain at least one vertex within `radiusKm` of `lngLat`, applies the
  // multi-river glow, sets map._circleMode so hover handlers leave it alone,
  // and updates the nearbyRiverIds state for the sidebar display.
  function highlightNearbyRivers(map, lngLat, radiusKm) {
    if (!map || !lngLat) return;
    try {
      const features = map.querySourceFeatures('rivers');
      const nearbyIds = new Set();
      for (const f of features) {
        if (!f.geometry || !f.properties?.id) continue;
        const rings = f.geometry.type === 'LineString'
          ? [f.geometry.coordinates]
          : f.geometry.type === 'MultiLineString'
          ? f.geometry.coordinates
          : [];
        for (const ring of rings) {
          let found = false;
          for (const [lng, lat] of ring) {
            if (haversineKm(lngLat.lat, lngLat.lng, lat, lng) <= radiusKm) {
              found = true;
              break;
            }
          }
          if (found) { nearbyIds.add(f.properties.id); break; }
        }
      }
      const ids = [...nearbyIds];
      map._circleMode = true;
      if (typeof map._setRiversGlow === 'function') map._setRiversGlow(ids);
      setNearbyRiverIds(ids);
    } catch { /* map not yet ready */ }
  }

  // Map click handler for destination radius in NEW flow step 1.
  // Skips the click if the user actually clicked a river path — that
  // interaction is handled by the `rivers-hit` click listener instead.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const handleClick = (e) => {
      if (globalThis.__MS_PICKING_LOCATION__ === true) return;

      // ✅ only runs if in step 1 (destination selection)
      if (bookingStep !== 1) return;

      // If the click also hit a river feature, let the river handler take it
      // and don't place a radius circle (river selection clears the circle).
      const features = map.queryRenderedFeatures(e.point, { layers: ['rivers-hit'] });
      if (features && features.length > 0) return;

      onClick(e);
      setCircleCenter(e);
      drawCircle(map, e.lngLat, radius);
      highlightNearbyRivers(map, e.lngLat, radius);

      // Placing a manual point clears any single-river selection.
      if (mapRef.current?._riverSelected) {
        mapRef.current._riverSelected = null;
        setSelectedRiver(null);
      }
      if (onSelectRiverRef.current) {
        onSelectRiverRef.current(null);
      }
    };

    if (bookingStep === 1) {
      console.log('🟢 Attaching click listener for destination circle (step 1)');
      map.on('click', handleClick);
    } else {
      // Leaving step 1 — remove circle layers (they persist visually
      // through later steps otherwise).
      if (map.getLayer('circle-outline')) map.removeLayer('circle-outline');
      if (map.getLayer('circle')) map.removeLayer('circle');
      if (map.getSource('circle-source')) map.removeSource('circle-source');
      // NOTE: do NOT reset circleCenter here — we need to keep it around so
      // the chalet fetch at step 3 still has the anchor. It's cleared by
      // resetBookingFlow via the selectedPoint prop being nulled.
    }

    return () => {
      console.log('🔴 Detaching click listener');
      map.off('click', handleClick);
    };
  }, [bookingStep, onClick, radius]);

  // Redraw circle and re-highlight nearby rivers when radius changes (step 1 only).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !circleCenter || bookingStep !== 1) return;

    drawCircle(map, circleCenter.lngLat, radius);
    highlightNearbyRivers(map, circleCenter.lngLat, radius);
  }, [radius, circleCenter, bookingStep]);

  // Apply pin-drop cursor when entering step 1, reset when leaving
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    map.getCanvas().style.cursor = bookingStep === 1 ? PIN_DROP_CURSOR : '';
  }, [bookingStep, mapReady]);

  // Pulse all river paths at step 1 so users notice the rivers are clickable.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    if (bookingStep === 1) {
      if (typeof map._startRiverAttract === 'function') map._startRiverAttract();
    } else if (typeof map._stopRiverAttract === 'function') {
      map._stopRiverAttract();
    }
    return () => {
      if (map && typeof map._stopRiverAttract === 'function') map._stopRiverAttract();
    };
  }, [bookingStep, mapReady]);

  // --- Environmental layers injection (river flow + tides) -------------------
  // Added imperatively, exactly like the existing `businesses`/`rivers` sources,
  // once the map has loaded. Click handlers are LAYER-SCOPED so they cannot
  // interfere with the existing global click / river / business handlers.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return undefined;

    const ENV_LAYERS = ['env-river-nodes', 'env-river-glow', 'env-tide-nodes', 'env-tide-glow'];
    const ENV_SOURCES = ['env-rivers', 'env-tides'];
    const stationById = new Map([
      ...RIVER_STATIONS.map((s) => [s.id, { type: 'river', station: s }]),
      ...TIDE_STATIONS.map((s) => [s.id, { type: 'tide', station: s }]),
    ]);

    const addLayers = () => {
      if (map.getSource('env-rivers')) return; // already injected
      map.addSource('env-rivers', { type: 'geojson', data: riverNodes });
      map.addSource('env-tides', { type: 'geojson', data: tideNodes });

      // Stack these below the business pins: business markers are the primary
      // tap target and must never be visually covered by a decorative env dot
      // that happens to land nearby (e.g. Falls Gully / Auberge Lamontagne).
      const beforeId = map.getLayer('business-pin') ? 'business-pin' : undefined;

      // River flow — blue circular nodes (soft glow + solid core).
      map.addLayer({
        id: 'env-river-glow', type: 'circle', source: 'env-rivers',
        paint: { 'circle-radius': 13, 'circle-color': '#2563EB', 'circle-opacity': 0.18, 'circle-blur': 0.6 },
      }, beforeId);
      map.addLayer({
        id: 'env-river-nodes', type: 'circle', source: 'env-rivers',
        paint: {
          'circle-radius': 6, 'circle-color': '#2563EB',
          'circle-stroke-width': 2, 'circle-stroke-color': '#FFFFFF',
        },
      }, beforeId);

      // Tides — teal wave nodes along the coast (glow + core; label carries a wave glyph).
      map.addLayer({
        id: 'env-tide-glow', type: 'circle', source: 'env-tides',
        paint: { 'circle-radius': 13, 'circle-color': '#0E9C93', 'circle-opacity': 0.18, 'circle-blur': 0.6 },
      }, beforeId);
      map.addLayer({
        id: 'env-tide-nodes', type: 'circle', source: 'env-tides',
        paint: {
          'circle-radius': 6, 'circle-color': '#0E9C93',
          'circle-stroke-width': 2, 'circle-stroke-color': '#FFFFFF',
        },
      }, beforeId);
    };

    const openFromFeature = (e) => {
      const f = e.features?.[0];
      const hit = f && stationById.get(f.properties?.id);
      if (hit) setEnvSelection(hit);
    };
    const setPointer = () => { map.getCanvas().style.cursor = 'pointer'; };
    const clearPointer = () => { map.getCanvas().style.cursor = ''; };

    // NOTE: this effect runs AFTER the map's `load` event (it's gated on
    // `mapReady`, set inside the load handler). So `map.once('load', …)` would
    // never fire. When the style isn't fully loaded yet (tiles/overlay still
    // streaming), retry on `idle` until it is.
    let cancelled = false;
    const ensureLayers = () => {
      if (cancelled) return;
      if (map.isStyleLoaded()) addLayers();
      else map.once('idle', ensureLayers);
    };
    ensureLayers();

    map.on('click', 'env-river-nodes', openFromFeature);
    map.on('click', 'env-tide-nodes', openFromFeature);
    for (const id of ['env-river-nodes', 'env-tide-nodes']) {
      map.on('mouseenter', id, setPointer);
      map.on('mouseleave', id, clearPointer);
    }

    return () => {
      cancelled = true;
      map.off('idle', ensureLayers);
      map.off('click', 'env-river-nodes', openFromFeature);
      map.off('click', 'env-tide-nodes', openFromFeature);
      for (const id of ['env-river-nodes', 'env-tide-nodes']) {
        map.off('mouseenter', id, setPointer);
        map.off('mouseleave', id, clearPointer);
      }
      try {
        for (const id of ENV_LAYERS) if (map.getLayer(id)) map.removeLayer(id);
        for (const id of ENV_SOURCES) if (map.getSource(id)) map.removeSource(id);
      } catch { /* style torn down already */ }
    };
  }, [mapReady, riverNodes, tideNodes]);

  // Fourth useEffect - Display fishing zones on map when fishingZones changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Helper function to safely remove layers and sources
    function cleanupFishingZones() {
      try {
        if (map.getLayer('fishing-zones-glow')) map.removeLayer('fishing-zones-glow');
        if (map.getLayer('fishing-zones-fill')) map.removeLayer('fishing-zones-fill');
        if (map.getLayer('fishing-zones-outline')) map.removeLayer('fishing-zones-outline');
        if (map.getLayer('fishing-zones-label')) map.removeLayer('fishing-zones-label');
        if (map.getSource('fishing-zones')) map.removeSource('fishing-zones');
      } catch (e) {
        console.log('Cleanup error (expected if layers dont exist):', e.message);
      }
    }

    function updateFishingZones() {
      // Remove existing fishing zones layers and source
      cleanupFishingZones();

      // If no fishing zones, we're done
      if (!fishingZones || fishingZones.length === 0) {
        console.log('🎣 No fishing zones to display');
        return;
      }

      console.log('🎣 Displaying fishing zones on map:', fishingZones.length);

      // Convert fishing zones to GeoJSON FeatureCollection
      const geojsonData = {
        type: 'FeatureCollection',
        features: fishingZones.map(zone => ({
          type: 'Feature',
          properties: {
            id: zone.id,
            name: zone.name,
            fish_type: zone.fish_type,
            description: zone.description,
            season_start: zone.season_start,
            season_end: zone.season_end,
            difficulty_level: zone.difficulty_level
          },
          geometry: typeof zone.geometry === 'string' ? JSON.parse(zone.geometry) : zone.geometry
        }))
      };

      // Add the fishing zones source
      map.addSource('fishing-zones', {
        type: 'geojson',
        data: geojsonData
      });

      // Layer 1: Outer glow for soft fade effect at edges
      map.addLayer({
        id: 'fishing-zones-glow',
        type: 'fill',
        source: 'fishing-zones',
        paint: {
          'fill-color': '#4A9B8E',
          'fill-opacity': [
            'interpolate',
            ['linear'],
            ['zoom'],
            5, 0.12,
            8, 0.15,
            12, 0.12,
            15, 0.08
          ]
        }
      });

      // Layer 2: Main fill - more visible aquatic tones
      map.addLayer({
        id: 'fishing-zones-fill',
        type: 'fill',
        source: 'fishing-zones',
        paint: {
          'fill-color': [
            'interpolate',
            ['linear'],
            ['zoom'],
            5, 'rgba(60, 150, 140, 0.35)',
            8, 'rgba(55, 145, 135, 0.40)',
            12, 'rgba(50, 140, 130, 0.35)'
          ],
          'fill-opacity': 1
        }
      });

      // Layer 3: More prominent outline
      map.addLayer({
        id: 'fishing-zones-outline',
        type: 'line',
        source: 'fishing-zones',
        paint: {
          'line-color': 'rgba(40, 120, 110, 0.8)',
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            5, 1.5,
            8, 2,
            12, 2.5,
            15, 3
          ],
          'line-opacity': 0.7,
          'line-blur': 0.5
        }
      });

      // Layer 4: Labels with better visibility
      map.addLayer({
        id: 'fishing-zones-label',
        type: 'symbol',
        source: 'fishing-zones',
        layout: {
          'text-field': ['get', 'name'],
          'text-size': [
            'interpolate',
            ['linear'],
            ['zoom'],
            6, 11,
            10, 13,
            14, 15
          ],
          'text-anchor': 'center',
          'text-allow-overlap': false,
          'text-padding': 10,
          'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular']
        },
        paint: {
          'text-color': '#1A4A40',
          'text-halo-color': 'rgba(255, 255, 255, 0.95)',
          'text-halo-width': 2.5,
          'text-halo-blur': 0.5,
          'text-opacity': 1
        }
      });

      // Fit map to fishing zones bounds if we have zones
      if (fishingZones.length > 0) {
        try {
          const bounds = new globalThis.mapboxgl.LngLatBounds();
          fishingZones.forEach(zone => {
            const geom = typeof zone.geometry === 'string' ? JSON.parse(zone.geometry) : zone.geometry;
            if (geom && geom.coordinates && geom.coordinates[0]) {
              geom.coordinates[0].forEach(coord => {
                bounds.extend(coord);
              });
            }
          });
          map.fitBounds(bounds, { padding: 50, maxZoom: 10 });
        } catch (e) {
          console.error('Error fitting bounds:', e);
        }
      }
    }

    // Check if map style is loaded, if not wait for it
    if (!mapStyleLoaded.current) {
      const onStyleLoad = () => {
        mapStyleLoaded.current = true;
        updateFishingZones();
      };
      
      if (map.isStyleLoaded()) {
        mapStyleLoaded.current = true;
        updateFishingZones();
      } else {
        map.once('style.load', onStyleLoad);
        return () => {
          map.off('style.load', onStyleLoad);
        };
      }
    } else {
      updateFishingZones();
    }

    return () => {
      // Cleanup on unmount or when fishingZones changes
      cleanupFishingZones();
    };
  }, [fishingZones]);

  // Escape key handler - close booking flow
  useEffect(() => {
    // Only listen for Escape when booking flow is open (bookingStep > 0)
    if (bookingStep === 0) return;

    const handleEscapeKey = (event) => {
      if (event.key === 'Escape' || event.keyCode === 27) {
        event.preventDefault();
        resetBookingFlow();
      }
    };

    document.addEventListener('keydown', handleEscapeKey);

    return () => {
      document.removeEventListener('keydown', handleEscapeKey);
    };
  }, [bookingStep, resetBookingFlow]);

  const initializeMap = (mapboxgl) => {
    const businessLogos = [
      {
        id: 'Falls Gully',
        url: '/cropped-logo_fallsgully_blk.png'
      },
      {
        id: 'Lamontagne',
        url: '/test2.png'
      }
    ];
    
    mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

    const gaspBounds = [
      [-68.05770988533543, 47.61203514013091],
      [-63.94465050088402, 49.48686704416437]
    ];

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: 'mapbox://styles/mapbox/standard',
      projection: 'mercator',
      zoom: 6,
      center: INITIAL_MAP_CENTER,
      maxBounds: gaspBounds
    });

    mapRef.current = map;

    /** Haut-gauche : laisse le coin haut-droit à Mapbox (logo / marque). Les filtres étape 3 sont à côté (left). */
    map.addControl(new mapboxgl.NavigationControl(), 'top-left');
  map.scrollZoom.disable();
    if (!isMobile) map.dragPan.disable();

    map.on('load', () => {
      console.log('Map loaded successfully!');
      setMapReady(true);
      const mapImage = '/NewMap.png';

      // Start camera on the right-side portion of the interactive area instead
      // of centered, so top-right branding is visible immediately on load.
      const west = gaspBounds[0][0];
      const south = gaspBounds[0][1];
      const east = gaspBounds[1][0];
      const north = gaspBounds[1][1];
      const rightBiasedCenter = [
        west + (east - west) * 0.75, // right half start
        south + (north - south) * 0.52,
      ];
      map.jumpTo({
        center: rightBiasedCenter,
        zoom: 6,
      });

      // Add vector source for businesses
      map.addSource('businesses', {
        type: 'vector',
        url: 'mapbox://leochouinard.cmfiagsm01tfl1qo364rq7ye3-71qfa',
        promoteId: {
          Monde_sauvage: 'name'
        }
      });

      businessLogos.forEach((logo) => {
        map.loadImage(logo.url, (error, image) => {
          if (error || !image) {
            console.warn(`Unable to load business logo image: ${logo.id}`, error);
            return;
          }
          map.addImage(logo.id, image);
        });
      });
      
      map.loadImage('https://i.ibb.co/tpNkVbKw/location.png', (error, image) => {
        if (error || !image) {
          console.warn('Unable to load map pin image', error);
          return;
        }
        if (!map.hasImage('pin')) map.addImage('pin', image);
      });

      map.addLayer({
        id: 'business-pin',
        type: 'symbol',
        source: 'businesses',
        'source-layer': 'Monde_sauvage',
        layout: {
          'icon-image': 'pin',
          'icon-size': 0.15,
          'icon-allow-overlap': true,
          'icon-anchor': 'bottom'
        }
      });

      map.addLayer({
        id: 'business',
        type: 'circle',
        source: 'businesses',
        'source-layer': 'Monde_sauvage',
        paint: {
          'circle-radius': 23,
          'circle-color': '#FFFFFF',
          'circle-translate': [0, -50],
          'circle-opacity': 1,
          'circle-stroke-width': 0
        }
      });

      map.addLayer({
        id: 'business-icons',
        type: 'symbol',
        source: 'businesses',
        'source-layer': 'Monde_sauvage',
        layout: {
          'icon-image': ['get', 'name'],
          'icon-size': 0.08,
          'icon-allow-overlap': true,
          'icon-offset': [0, -37*10],
          'icon-anchor': 'bottom',
          'text-field': '',
          'text-size': 0,
          'text-offset': [0, 0] 
        }
      });

      const noBusinessFilter = ['==', ['get', 'name'], '__none__'];

      map.addLayer({
        id: 'business-pin-hover',
        type: 'symbol',
        source: 'businesses',
        'source-layer': 'Monde_sauvage',
        filter: noBusinessFilter,
        layout: {
          'icon-image': 'pin',
          'icon-size': 0.18,
          'icon-allow-overlap': true,
          'icon-anchor': 'bottom'
        }
      });

      map.addLayer({
        id: 'business-hover',
        type: 'circle',
        source: 'businesses',
        'source-layer': 'Monde_sauvage',
        filter: noBusinessFilter,
        paint: {
          'circle-radius': 28,
          'circle-color': '#FFFFFF',
          'circle-translate': [0, -60],
          'circle-opacity': 1,
          'circle-stroke-color': '#ef4444',
          'circle-stroke-width': 2,
          'circle-stroke-opacity': 0.95,
          'circle-blur': 0.05
        }
      });

      map.addLayer({
        id: 'business-icons-hover',
        type: 'symbol',
        source: 'businesses',
        'source-layer': 'Monde_sauvage',
        filter: noBusinessFilter,
        layout: {
          'icon-image': ['get', 'name'],
          'icon-size': 0.096,
          'icon-allow-overlap': true,
          'icon-offset': [0, -37*10],
          'icon-anchor': 'bottom',
          'text-field': '',
          'text-size': 0,
          'text-offset': [0, 0]
        }
      });

      map.addSource('gaspesieOverlay', {
        type: 'image',
        url: mapImage,
        'coordinates': [
          [-68.05770988533543, 49.48686704416437],
          [-63.94465050088402, 49.48686704416437],
          [-63.94465050088402, 47.61203514013091],
          [-68.05770988533543, 47.61203514013091]
        ]
      });
      
      map.addLayer({
        'id': 'gaspesie-overlay',
        'type': 'raster',
        'source': 'gaspesieOverlay',
        'paint': {
          'raster-opacity': 1
        }
      });

      // Helper function to create a circle
      

      // Map click handler for circle
      
        
      
      
      const openBusinessPopup = (e) => {
        if (!e.features?.length) return;

        const feature = e.features[0];
        const properties = feature.properties;

        new mapboxgl.Popup({
          offset: 25,
          className: 'business-mapbox-popup',
          maxWidth: '340px',
          closeOnMove: false
        })
          .setLngLat(e.lngLat)
          .setHTML(buildBusinessPopupHtml(properties))
          .addTo(map);
      };

      map.on('click', (e) => {
        if (globalThis.__MS_PICKING_LOCATION__ === true) {
          globalThis.dispatchEvent(new CustomEvent('ms:map-location-picked', {
            detail: {
              latitude: e.lngLat?.lat,
              longitude: e.lngLat?.lng
            }
          }));
          globalThis.__MS_PICKING_LOCATION__ = false;
          return;
        }

        const hits = map.queryRenderedFeatures(e.point, {
          layers: ['business-pin-hover', 'business-pin']
        });

        if (!hits.length) return;

        openBusinessPopup({
          lngLat: e.lngLat,
          features: [hits[0]]
        });
      });

      let hoveredBusinessName = null;

      const applyBusinessHoverFilter = (name) => {
        const hoverFilter = name ? ['==', ['get', 'name'], name] : noBusinessFilter;

        map.setFilter('business-pin-hover', hoverFilter);
        map.setFilter('business-hover', hoverFilter);
        map.setFilter('business-icons-hover', hoverFilter);

        if (name) {
          const baseFilter = ['!=', ['get', 'name'], name];
          map.setFilter('business-pin', baseFilter);
          map.setFilter('business', baseFilter);
          map.setFilter('business-icons', baseFilter);
          return;
        }

        map.setFilter('business-pin', null);
        map.setFilter('business', null);
        map.setFilter('business-icons', null);
      };

      const clearBusinessHoverState = () => {
        hoveredBusinessName = null;
        applyBusinessHoverFilter(null);
        map.getCanvas().style.cursor = bookingStepRef.current === 1 ? PIN_DROP_CURSOR : '';
      };

      map.on('mousemove', (e) => {
        const hits = map.queryRenderedFeatures(e.point, {
          layers: ['business-pin-hover', 'business-pin']
        });

        const hoveredFeature = hits[0];
        const nextName = hoveredFeature?.properties?.name || null;

        if (nextName) {
          map.getCanvas().style.cursor = 'pointer';
          if (nextName !== hoveredBusinessName) {
            hoveredBusinessName = nextName;
            applyBusinessHoverFilter(nextName);
          }
          return;
        }

        if (hoveredBusinessName !== null) {
          clearBusinessHoverState();
        }
      });

      map.on('mouseout', clearBusinessHoverState);

      // Add river paths as native Mapbox GeoJSON layers
      map.addSource('rivers', {
        type: 'geojson',
        data: buildRiverGeoJSON(),
      });

      // Invisible wide hit area for hover/click
      map.addLayer({
        id: 'rivers-hit',
        type: 'line',
        source: 'rivers',
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: {
          'line-color': 'transparent',
          'line-width': 14,
        },
      });

      // Glow stack: outer aura → inner glow → core stroke
      const HOVER_BLUE = '#2F7E75';   // muted teal for hover
      const SELECT_BLUE = '#1F5E56';  // deeper teal for selected
      const GLOW_OUTER  = '#78B8A9';  // soft seafoam outer aura

      const emptyFilter = ['==', ['get', 'id'], ''];

      // Idle attract pulse — at step 1, gently pulse ALL river paths so users
      // realise the rivers are clickable. Added before the glow stack so it
      // renders beneath hover/selection. Colour matches the cyan river core on
      // the base map, and the core stroke is HOLLOW (line-gap-width draws two
      // thin edges with the map showing through the middle) so it reads as a
      // soft outline rather than a strong solid line.
      map.addLayer({
        id: 'rivers-attract-glow',
        type: 'line',
        source: 'rivers',
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: {
          'line-color': ATTRACT.color,
          'line-width': ATTRACT.glowWidth,
          'line-blur': ATTRACT.glowBlur,
          'line-opacity': 0, // driven by the rAF pulse only at step 1
        },
      });

      map.addLayer({
        id: 'rivers-attract',
        type: 'line',
        source: 'rivers',
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: {
          'line-color': ATTRACT.color,
          'line-gap-width': ATTRACT.gapWidth, // hollow centre — the map shows through
          'line-width': ATTRACT.edgeWidth,    // thickness of each edge stroke
          'line-blur': ATTRACT.edgeBlur,
          'line-opacity': 0, // driven by the rAF pulse only at step 1
        },
      });

      // Layer 1 — wide soft outer aura (feathered edges via line-blur)
      map.addLayer({
        id: 'rivers-glow-outer',
        type: 'line',
        source: 'rivers',
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: {
          'line-color': GLOW_OUTER,
          'line-width': 24,
          'line-blur': 34,
          'line-opacity': 0.4,
        },
        filter: emptyFilter,
      });

      // Layer 2 — tighter inner glow
      map.addLayer({
        id: 'rivers-glow-inner',
        type: 'line',
        source: 'rivers',
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: {
          'line-color': HOVER_BLUE,
          'line-width': 14,
          'line-blur': 7,
          'line-opacity': 0.5,
        },
        filter: emptyFilter,
      });

      // Layer 3 — crisp core highlight stroke
      map.addLayer({
        id: 'rivers-highlight',
        type: 'line',
        source: 'rivers',
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: {
          'line-color': HOVER_BLUE,
          'line-width': 4.5,
          'line-opacity': 0.95,
        },
        filter: emptyFilter,
      });

      // Hover cursor — rivers keep pointer; empty map at step 1 gets pin-drop cursor
      map.on('mouseenter', 'rivers-hit', () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', 'rivers-hit', () => {
        map.getCanvas().style.cursor = bookingStepRef.current === 1 ? PIN_DROP_CURSOR : '';
      });

      // Helper: show/hide the glow stack for a given river id (or '' to hide)
      const glowLayers = ['rivers-glow-outer', 'rivers-glow-inner', 'rivers-highlight'];
      const setGlow = (id, color) => {
        const filter = id ? ['==', ['get', 'id'], id] : ['==', ['get', 'id'], ''];
        glowLayers.forEach(layer => map.setFilter(layer, filter));
        if (color) {
          map.setPaintProperty('rivers-glow-outer', 'line-color', color === SELECT_BLUE ? '#9ED3C6' : GLOW_OUTER);
          map.setPaintProperty('rivers-glow-inner', 'line-color', color);
          map.setPaintProperty('rivers-highlight', 'line-color', color);
        }
      };

      // Expose a stable handle so effects / parent-driven updates (e.g. the
      // dropdown destination picker) can toggle river highlights without
      // duplicating the layer/filter logic.
      map._setRiverGlow = (id) => setGlow(id, id ? SELECT_BLUE : null);

      // Multi-river highlight — used when a radius circle is placed to glow
      // every river that falls within the search area.
      map._setRiversGlow = (ids) => {
        const filter = ids && ids.length > 0
          ? ['in', ['get', 'id'], ['literal', ids]]
          : ['==', ['get', 'id'], ''];
        glowLayers.forEach(layer => map.setFilter(layer, filter));
        if (ids && ids.length > 0) {
          map.setPaintProperty('rivers-glow-outer', 'line-color', GLOW_OUTER);
          map.setPaintProperty('rivers-glow-inner', 'line-color', HOVER_BLUE);
          map.setPaintProperty('rivers-highlight', 'line-color', HOVER_BLUE);
        }
      };

      // Start/stop the idle attract pulse on the 'rivers-attract' layer.
      // A rAF loop eases line-opacity along a sine wave so every river breathes
      // gently, signalling that the paths are interactive. Capped low so it
      // never competes with the hover/selection glow.
      map._startRiverAttract = () => {
        if (map._attractActive) return;
        map._attractActive = true;
        const start = performance.now();
        const tick = (now) => {
          // Bail out if the pulse was stopped or the map/style was torn down
          // (e.g. navigating away to the establishment dashboard). Touching
          // map.getLayer after rem() throws "getOwnLayer of undefined".
          if (!map._attractActive || !map.style) return;
          const elapsed = (now - start) / 1000;
          // Sine pulse: hollow edges + a softer blurred aura beneath (shadow).
          const wave = (Math.sin(elapsed * ATTRACT.speed) + 1) / 2; // 0..1
          const lineOpacity = ATTRACT.lineOpMin + (ATTRACT.lineOpMax - ATTRACT.lineOpMin) * wave;
          const glowOpacity = ATTRACT.glowOpMin + (ATTRACT.glowOpMax - ATTRACT.glowOpMin) * wave;
          if (map.getLayer('rivers-attract')) {
            map.setPaintProperty('rivers-attract', 'line-opacity', lineOpacity);
          }
          if (map.getLayer('rivers-attract-glow')) {
            map.setPaintProperty('rivers-attract-glow', 'line-opacity', glowOpacity);
          }
          map._attractRAF = requestAnimationFrame(tick);
        };
        map._attractRAF = requestAnimationFrame(tick);
      };
      map._stopRiverAttract = () => {
        map._attractActive = false;
        if (map._attractRAF) cancelAnimationFrame(map._attractRAF);
        map._attractRAF = null;
        // The map may already be removed (style undefined) when this runs from
        // an unmount cleanup — guarding avoids the getOwnLayer crash.
        if (!map.style) return;
        if (map.getLayer('rivers-attract')) {
          map.setPaintProperty('rivers-attract', 'line-opacity', 0);
        }
        if (map.getLayer('rivers-attract-glow')) {
          map.setPaintProperty('rivers-attract-glow', 'line-opacity', 0);
        }
      };

      // Hover highlight — skip when circle multi-glow is active so we don't
      // replace the multi-filter with a single-id filter on every mousemove.
      map.on('mousemove', 'rivers-hit', (e) => {
        if (map._circleMode) return;
        // Après l’étape 1 : la rivière choisie reste mise en avant (pas de survol d’une autre rivière).
        if (bookingStepRef.current !== 1 && mapRef.current?._riverSelected) return;
        if (e.features && e.features.length > 0) {
          const id = e.features[0].properties.id;
          if (mapRef.current?._riverSelected !== id) {
            setGlow(id, HOVER_BLUE);
          }
        }
      });
      map.on('mouseleave', 'rivers-hit', () => {
        if (map._circleMode) return; // circle highlight stays untouched
        const sel = mapRef.current?._riverSelected;
        if (sel) {
          setGlow(sel, SELECT_BLUE);
        } else if (infoCardRiverRef.current) {
          // In browse mode, restore glow to the info-card river when cursor leaves.
          setGlow(infoCardRiverRef.current, SELECT_BLUE);
        } else {
          setGlow(null);
        }
      });

      // Click handler — behaviour depends on the current booking step.
      // Step 0 (browse): toggle the info card popup, no booking state change.
      // Step 1 (destination): select the river for the booking flow.
      // Steps 2+ : locked, ignore river clicks.
      map.on('click', 'rivers-hit', (e) => {
        if (!e.features || e.features.length === 0) return;
        const id = e.features[0].properties.id;

        if (bookingStepRef.current === 0) {
          const prev = infoCardRiverRef.current;
          if (prev === id) {
            infoCardRiverRef.current = null;
            setInfoCardRiver(null);
            setGlow(null);
          } else {
            infoCardRiverRef.current = id;
            setInfoCardRiver(id);
            setGlow(id, SELECT_BLUE);
          }
          return;
        }

        if (bookingStepRef.current !== 1) return;

        const prev = mapRef.current?._riverSelected;
        if (prev === id) {
          mapRef.current._riverSelected = null;
          setSelectedRiver(null);
          setGlow(null);
          if (onSelectRiverRef.current) {
            onSelectRiverRef.current(null);
          }
        } else {
          mapRef.current._riverSelected = id;
          setSelectedRiver(id);
          setGlow(id, SELECT_BLUE);
          if (onSelectRiverRef.current) {
            onSelectRiverRef.current(id);
          }
        }
      });

      console.log('All layers added successfully!');
    });
  };

  return (
    <div style={{ 
      position: 'fixed',
      display: 'flex',
      flexDirection: 'row',
      justifyContent: 'stretch',
      alignItems: 'stretch',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: '100%', 
      height: '100dvh', 
      minHeight: '100vh',
      margin: 0, 
      padding: 0,
      backgroundColor: '#f0f0f0',
      overflow: 'hidden'
    }}>
      {/* Mobile backdrop overlay */}
      {isMobile && mobileSheetExpanded && (
        <div
          onClick={() => { if (bookingStep === 0) setMobileSheetExpanded(false); }}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.25)',
            zIndex: 499,
          }}
        />
      )}

      {/* Left Menu Panel (desktop) / Bottom Sheet (mobile) */}
      <div
        onTouchStart={isMobile ? handleSheetTouchStart : undefined}
        onTouchEnd={isMobile ? handleSheetTouchEnd : undefined}
        style={isMobile ? {
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 500,
          height: mobileSheetExpanded ? '78dvh' : '172px',
          maxHeight: '90dvh',
          background: SIDEBAR_PANEL_BG,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          boxSizing: 'border-box',
          padding: 0,
          boxShadow: '0 -8px 32px rgba(31, 58, 46, 0.18)',
          borderRadius: '20px 20px 0 0',
          fontFamily: '"Avenir Next", "Segoe UI", Roboto, sans-serif',
          overflow: 'hidden',
          transition: 'height 0.38s cubic-bezier(0.32, 0.72, 0, 1)',
          willChange: 'height',
        } : isCompactViewport ? {
          // Compact desktop/tablet: même largeur dynamique qu’en grand écran à l’étape 3 (liste + grille chalets).
          position: 'relative',
          ...((bookingStep === 3 || bookingStep === 4) ? {
            flex: `0 0 ${sidebarWidth}`,
            width: sidebarWidth,
            minWidth: sidebarWidth,
            maxWidth: sidebarWidth,
          } : {
            flex: '0 0 clamp(330px, 34vw, 450px)',
            width: 'clamp(330px, 34vw, 450px)',
            minWidth: 'clamp(330px, 34vw, 450px)',
            maxWidth: 'clamp(330px, 34vw, 450px)',
          }),
          height: '100%',
          minHeight: 0,
          background: SIDEBAR_PANEL_BG,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-start',
          alignItems: 'center',
          gap: '0',
          boxSizing: 'border-box',
          padding: 'clamp(12px, 2.2vh, 18px) clamp(10px, 1.6vw, 16px) clamp(10px, 2vh, 14px)',
          boxShadow: '6px 0 26px rgba(31, 58, 46, 0.14)',
          borderRight: '1px solid rgba(72, 102, 86, 0.16)',
          zIndex: 100,
          fontFamily: '"Avenir Next", "Segoe UI", Roboto, sans-serif',
          overflow: 'hidden',
        } : {
          // Étapes réservation desktop : largeur pilotée par `sidebarWidth`
          position: 'relative',
          flex: `0 0 ${sidebarWidth}`,
          width: sidebarWidth,
          minWidth: sidebarWidth,
          maxWidth: sidebarWidth,
          height: '100%',
          minHeight: 0,
          background: SIDEBAR_PANEL_BG,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-start',
          alignItems: 'center',
          gap: '0',
          boxSizing: 'border-box',
          padding: 'clamp(14px, 3vh, 30px) clamp(12px, 2vw, 24px) clamp(12px, 2.2vh, 22px)',
          boxShadow: '6px 0 26px rgba(31, 58, 46, 0.14)',
          borderRight: '1px solid rgba(72, 102, 86, 0.16)',
          zIndex: 100,
          fontFamily: '"Avenir Next", "Segoe UI", Roboto, sans-serif',
          overflow: 'hidden',
        }}
      >
        {/* Mobile drag handle */}
        {isMobile && (
          <div
            onClick={() => setMobileSheetExpanded(prev => !prev)}
            style={{
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              padding: '12px 16px 6px',
              cursor: 'pointer',
              flexShrink: 0,
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            <div style={{
              width: '40px',
              height: '4px',
              borderRadius: '2px',
              background: 'rgba(90, 119, 102, 0.35)',
            }} />
          </div>
        )}

        {/* Mobile collapsed peek content */}
        {isMobile && !mobileSheetExpanded && bookingStep === 0 && (
          <div style={{
            width: '100%',
            padding: '4px 16px 8px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            flexShrink: 0,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h2 style={{
                margin: 0,
                fontSize: '17px',
                fontFamily: '"Iowan Old Style", "Palatino Linotype", serif',
                fontWeight: '600',
                color: '#173428',
              }}>
                {t('Explorez la Gaspésie', 'Explore Gaspesie')}
              </h2>
              {user && (
                <button
                  type="button"
                  onClick={isAccountSettingsOpen}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    cursor: 'pointer',
                    WebkitTapHighlightColor: 'transparent',
                    flexShrink: 0,
                  }}
                >
                  <img
                    src={avatarSrc}
                    alt="Profil"
                    referrerPolicy="no-referrer"
                    onError={handleAvatarError}
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: '50%',
                      border: '2px solid rgba(74, 155, 142, 0.8)',
                      objectFit: 'cover',
                    }}
                  />
                </button>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              {renderLanguageSwitch()}
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                onClick={() => { isTripOpen(true); }}
                style={{
                  flex: 1,
                  border: 'none',
                  borderRadius: '12px',
                  padding: '11px 8px',
                  background: 'linear-gradient(145deg, #214537, #2F5C49)',
                  color: '#FFFCF7',
                  cursor: 'pointer',
                  fontWeight: '600',
                  fontSize: '12.5px',
                  textAlign: 'center',
                  boxShadow: '0 4px 12px rgba(22, 43, 34, 0.2)',
                  WebkitTapHighlightColor: 'transparent',
                }}
              >
                {t('Séjour', 'Trip')}
              </button>
              <button
                type="button"
                onClick={() => { isGuideFlowOpen(true); }}
                style={{
                  flex: 1,
                  border: '1px solid rgba(74, 117, 98, 0.32)',
                  borderRadius: '12px',
                  padding: '11px 8px',
                  background: 'rgba(255, 252, 247, 0.72)',
                  color: '#214337',
                  cursor: 'pointer',
                  fontWeight: '600',
                  fontSize: '12.5px',
                  textAlign: 'center',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '4px',
                  WebkitTapHighlightColor: 'transparent',
                }}
              >
                <img src="/fish.png" alt="" style={{ width: '18px', height: '18px' }} />
                {t('Guide', 'Guide')}
              </button>
              <button
                type="button"
                onClick={() => { isChaletFlowOpen(true); }}
                style={{
                  flex: 1,
                  border: '1px solid rgba(74, 117, 98, 0.32)',
                  borderRadius: '12px',
                  padding: '11px 8px',
                  background: 'rgba(255, 252, 247, 0.72)',
                  color: '#214337',
                  cursor: 'pointer',
                  fontWeight: '600',
                  fontSize: '12.5px',
                  textAlign: 'center',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '4px',
                  WebkitTapHighlightColor: 'transparent',
                }}
              >
                <img src="/chalet.png" alt="" style={{ width: '18px', height: '18px' }} />
                {t('Chalet', 'Chalet')}
              </button>
            </div>
            <button
              type="button"
              onClick={() => setMobileSheetExpanded(true)}
              style={{
                background: 'none',
                border: 'none',
                width: '100%',
                padding: '2px 0 0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px',
                color: '#5A7766',
                fontSize: '11px',
                fontWeight: '500',
                cursor: 'pointer',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              {t('Voir plus ▴', 'Show more ▴')}
            </button>
          </div>
        )}

        {/* Full sidebar content — scrollable wrapper on mobile, transparent on desktop */}
        <div style={isMobile ? {
          width: '100%',
          flex: '1 1 auto',
          minHeight: 0,
          display: (!mobileSheetExpanded && bookingStep === 0) ? 'none' : 'flex',
          flexDirection: 'column',
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
          padding: '0 16px env(safe-area-inset-bottom, 16px)',
        } : {
          display: 'contents',
        }}>
        {/* BOOKING FLOW CONTENT */}
        {bookingStep > 0 ? (
          <div style={{ width: '100%', flex: '1 1 auto', minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: isCompactViewport ? '12px' : '20px', paddingRight: '2px' }}>
            {/* Header with close button */}
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'space-between',
              gap: '12px', 
              marginBottom: '8px',
              width: '100%'
            }}>
              <h2 style={{ 
                margin: 0, 
                fontSize: isCompactViewport ? '15px' : '18px', 
                color: '#1F3A2E', 
                fontWeight: '600',
                flex: 1
              }}>
                {browseMode === 'guide'
                  ? t('Trouver un guide', 'Find a guide')
                  : browseMode === 'chalet'
                  ? t('Trouver un chalet', 'Find a chalet')
                  : t('Planifier votre séjour', 'Plan your trip')}
              </h2>
              
              {/* Close button - visible and accessible */}
              <button
                type="button"
                onClick={resetBookingFlow}
                aria-label={t('Fermer et retourner au menu principal', 'Close and return to main menu')}
                title={t('Fermer (Échap)', 'Close (Esc)')}
                style={{
                  background: 'transparent',
                  border: '1px solid #D1D5DB',
                  cursor: 'pointer',
                  padding: isMobile ? '10px 12px' : '8px 10px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: '6px',
                  fontSize: isMobile ? '20px' : '18px',
                  transition: 'all 0.2s ease',
                  flexShrink: 0,
                  color: '#5A7766',
                  minWidth: isMobile ? '44px' : '36px',
                  minHeight: isMobile ? '44px' : '36px',
                  WebkitTapHighlightColor: 'transparent'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)';
                  e.currentTarget.style.borderColor = '#EF4444';
                  e.currentTarget.style.color = '#EF4444';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                  e.currentTarget.style.borderColor = '#D1D5DB';
                  e.currentTarget.style.color = '#5A7766';
                }}
              >
                ✕
              </button>
            </div>

            {/* Progress indicator (5 segments si parcours chalet : étape 4 = équipements) */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: isCompactViewport ? '8px' : '16px' }}>
              {Array.from({ length: bookingMaxStep }, (_, i) => i + 1).map((step) => (
                <div
                  key={step}
                  style={{
                    flex: 1,
                    height: '4px',
                    borderRadius: '2px',
                    backgroundColor: step <= bookingStep ? '#2D5F4C' : '#D1D5DB'
                  }}
                />
              ))}
            </div>

            {/* Step 1: Destination (NEW FLOW) — unified picker: search / river / map point */}
            {bookingStep === 1 && (() => {
              // Which input method is "active" — drives the selection card
              const hasRiver = Boolean(selectedRiver);
              const hasPoint = Boolean(selectedPoint?.lngLat);
              const hasSelection = hasRiver || hasPoint;
              const selectedRiverDetails = hasRiver && getRiverDetails
                ? getRiverDetails(selectedRiver)
                : null;

              const clearRiver = () => {
                setSelectedRiver(null);
                if (mapRef.current) {
                  mapRef.current._riverSelected = null;
                  if (typeof mapRef.current._setRiverGlow === 'function') {
                    mapRef.current._setRiverGlow(null);
                  }
                }
                if (onSelectRiver) onSelectRiver(null);
              };

              const clearPoint = () => {
                // Clear parent's selectedPoint — this triggers the selectedPoint
                // useEffect which removes layers and clears the multi-glow.
                if (onClick) onClick(null);
              };

              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: isCompactViewport ? '8px' : '14px', height: '100%', minHeight: 0, overflow: 'hidden' }}>
                  <div style={{ flexShrink: 0 }}>
                    <h3 style={{ margin: 0, fontSize: isCompactViewport ? '13px' : '16px', color: '#1F3A2E' }}>
                      1. {t('Votre destination', 'Your destination')}
                    </h3>
                    <p style={{ fontSize: isCompactViewport ? '11px' : '12px', color: '#5A7766', margin: '3px 0 0', lineHeight: 1.5 }}>
                      {t(
                        'Choisissez une rivière dans la liste ou touchez la carte pour partir d’une zone.',
                        'Choose a river from the list or tap the map to start from an area.'
                      )}
                    </p>
                  </div>

                  {/* Unified picker card */}
                  <div style={{
                    padding: isCompactViewport ? '8px 10px' : '12px',
                    backgroundColor: '#FFFCF7',
                    borderRadius: '12px',
                    border: '1px solid #E5E7EB',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: isCompactViewport ? '6px' : '12px',
                    flex: '1 1 auto',
                    minHeight: 0,
                    overflow: 'hidden',
                  }}>
                    {/* Searchable river dropdown — on compact, sits in a row with map-pin badge */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label style={{
                        fontSize: '11px',
                        color: '#5A7766',
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                      }}>
                        🔍 {t('Choisir une rivière', 'Choose a river')}
                      </label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <select
                          value={selectedRiver || ''}
                          onChange={(e) => {
                            const id = e.target.value || null;
                            if (id) {
                              // Selecting a river via dropdown: clear any custom point
                              if (onSelectRiver) onSelectRiver(id);
                              setSelectedRiver(id);
                              if (mapRef.current) {
                                mapRef.current._riverSelected = id;
                                if (typeof mapRef.current._setRiverGlow === 'function') {
                                  mapRef.current._setRiverGlow(id);
                                }
                              }
                            } else {
                              clearRiver();
                            }
                          }}
                          style={{
                            flex: 1,
                            minWidth: 0,
                            padding: isCompactViewport ? '7px 10px' : '10px 12px',
                            borderRadius: '8px',
                            border: '1.5px solid #D1D5DB',
                            backgroundColor: '#FFFFFF',
                            fontSize: isCompactViewport ? '12px' : '14px',
                            color: '#1F3A2E',
                            cursor: 'pointer',
                            appearance: 'none',
                            backgroundImage: 'url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 12 12\'><path fill=\'%235A7766\' d=\'M2 4l4 4 4-4\'/></svg>")',
                            backgroundRepeat: 'no-repeat',
                            backgroundPosition: 'right 10px center',
                            paddingRight: '28px',
                          }}
                        >
                          <option value="">
                            {t('— Sélectionner une rivière —', '— Select a river —')}
                          </option>
                          {[...knownRivers].sort((a, b) => a.localeCompare(b)).map((id) => (
                            <option key={id} value={id}>
                              {formatRiverName ? formatRiverName(id) : `Rivière ${id}`}
                            </option>
                          ))}
                        </select>

                        {/* Compact: map-pin badge beside the dropdown — activates picker mode */}
                        {isCompactViewport && (
                          <button
                            type="button"
                            onClick={() => {
                              setMapPickerActive(true);
                              mapPickerActiveRef.current = true;
                            }}
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              gap: '3px',
                              padding: '6px 10px',
                              borderRadius: '10px',
                              border: mapPickerActive
                                ? '1.5px solid #2D5F4C'
                                : '1.5px dashed rgba(74, 155, 142, 0.55)',
                              backgroundColor: mapPickerActive
                                ? 'rgba(45, 95, 76, 0.12)'
                                : 'rgba(74, 155, 142, 0.07)',
                              flexShrink: 0,
                              cursor: 'pointer',
                              transition: 'background-color 0.2s, border-color 0.2s',
                            }}
                          >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={mapPickerActive ? '#2D5F4C' : '#4A9B8E'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                              <circle cx="12" cy="10" r="3"/>
                            </svg>
                            <span style={{ fontSize: '9px', color: mapPickerActive ? '#2D5F4C' : '#2D7D70', fontWeight: 700, textAlign: 'center', lineHeight: 1.2, whiteSpace: 'nowrap' }}>
                              {t('Carte', 'Map')}
                            </span>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* OR divider — full layout only */}
                    {!isCompactViewport && (
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      color: '#9CA3AF',
                      fontSize: '11px',
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: '0.08em',
                    }}>
                      <div style={{ flex: 1, height: '1px', backgroundColor: '#E5E7EB' }} />
                      <span>{t('ou', 'or')}</span>
                      <div style={{ flex: 1, height: '1px', backgroundColor: '#E5E7EB' }} />
                    </div>
                    )}

                    {/* Map interaction hint — hidden on compact to free vertical space */}
                    {!isCompactViewport && (
                    <div style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                      padding: '10px 12px',
                      backgroundColor: 'rgba(74, 155, 142, 0.08)',
                      border: '1px solid rgba(74, 155, 142, 0.22)',
                      borderRadius: '10px',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#1F3A2E', fontSize: '13px', fontWeight: 600 }}>
                        <span style={{ fontSize: '16px' }}>🧭</span>
                        <span>{t('Point de départ', 'Starting point')}</span>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        <span style={{
                          fontSize: '11px',
                          padding: '4px 8px',
                          borderRadius: '999px',
                          backgroundColor: 'rgba(45, 95, 76, 0.1)',
                          color: '#2D5F4C',
                          fontWeight: 600,
                        }}>
                          {t('Choisir dans la liste', 'Pick from the list')}
                        </span>
                        <span style={{
                          fontSize: '11px',
                          padding: '4px 8px',
                          borderRadius: '999px',
                          backgroundColor: 'rgba(45, 95, 76, 0.1)',
                          color: '#2D5F4C',
                          fontWeight: 600,
                        }}>
                          {t('Cliquer sur la carte', 'Click the map')}
                        </span>
                      </div>
                      <p style={{ margin: 0, fontSize: '12px', color: '#355446', lineHeight: 1.45 }}>
                        {t(
                          'Vous pouvez choisir une rivière ci-dessous ou toucher la carte pour définir la zone.',
                          'You can choose a river below or tap the map to define the area.'
                        )}
                      </p>
                    </div>
                    )}

                    {/* River bio cards — discovery grid */}
                    <div style={{ marginTop: isCompactViewport ? 4 : 14, display: 'flex', flexDirection: 'column', minHeight: isCompactViewport ? 180 : 0, flex: '1 1 auto' }}>
                      <p style={{
                        margin: '0 0 6px',
                        fontSize: 11,
                        fontWeight: 600,
                        color: '#5A7766',
                        textTransform: 'uppercase',
                        letterSpacing: 0.5,
                        flexShrink: 0,
                      }}>
                        {t('Découvrir les rivières', 'Discover rivers')}
                      </p>
                      <div style={{ flex: '1 1 auto', minHeight: isCompactViewport ? 160 : 0, overflowY: 'auto', paddingRight: '2px' }}>
                        <RiverBioCards
                          language={language}
                          selectedPathId={selectedRiver}
                          compact={isCompactViewport}
                          onSelect={(pathId) => {
                            if (onSelectRiver) onSelectRiver(pathId);
                            setSelectedRiver(pathId);
                            if (mapRef.current) {
                              mapRef.current._riverSelected = pathId;
                              if (typeof mapRef.current._setRiverGlow === 'function') {
                                mapRef.current._setRiverGlow(pathId);
                              }
                            }
                          }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Current selection — adaptive card (river OR point) */}
                  <div style={{
                    padding: isCompactViewport ? '7px 9px' : '12px',
                    backgroundColor: hasSelection ? 'rgba(45, 95, 76, 0.08)' : 'transparent',
                    border: hasSelection ? '1px solid #2D5F4C' : '1px dashed #D1D5DB',
                    borderRadius: '12px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: (hasPoint || hasRiver) ? (isCompactViewport ? '6px' : '10px') : '0',
                    flexShrink: 0,
                  }}>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '10px',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                        <span style={{ fontSize: isCompactViewport ? '16px' : '20px' }}>
                          {hasRiver ? '🌊' : hasPoint ? '📍' : '✨'}
                        </span>
                        <div style={{ minWidth: 0 }}>
                          <div style={{
                            fontSize: isCompactViewport ? '12px' : '13px',
                            fontWeight: 600,
                            color: hasSelection ? '#1F3A2E' : '#9CA3AF',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}>
                            {hasRiver
                              ? (formatRiverName ? formatRiverName(selectedRiver) : selectedRiver)
                              : hasPoint
                              ? t('Point personnalisé', 'Custom point')
                              : t('Aucune destination', 'No destination')}
                          </div>
                          {hasPoint && (
                            <div style={{ fontSize: '11px', color: '#5A7766', marginTop: '2px' }}>
                              {t('Zone circulaire', 'Circular area')}
                            </div>
                          )}
                        </div>
                      </div>

                      {hasSelection && (
                        <button
                          type="button"
                          onClick={() => {
                            if (hasRiver) clearRiver();
                            if (hasPoint) clearPoint();
                          }}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            fontSize: '16px',
                            color: '#5A7766',
                            padding: '4px 8px',
                            flexShrink: 0,
                          }}
                          aria-label={t('Retirer la sélection', 'Remove selection')}
                        >
                          ✕
                        </button>
                      )}
                    </div>

                    {hasRiver && selectedRiverDetails?.image && (
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        marginTop: '2px',
                      }}>
                        <img
                          src={selectedRiverDetails.image}
                          alt={selectedRiverDetails.name || 'River'}
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          style={{
                            width: '52px',
                            height: '52px',
                            borderRadius: '8px',
                            objectFit: 'cover',
                            border: '1px solid #D1D5DB',
                            backgroundColor: '#FFFFFF',
                            flexShrink: 0,
                          }}
                          onError={(e) => {
                            e.currentTarget.style.display = 'none';
                          }}
                        />
                        <span style={{ fontSize: '10px', color: '#6B7280', lineHeight: 1.3 }}>
                          {t('Image de référence', 'Reference image')}
                        </span>
                      </div>
                    )}

                    {/* Radius slider + nearby rivers list */}
                    {hasPoint && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            fontSize: '11px',
                            color: '#5A7766',
                          }}>
                            <span>{t('Rayon', 'Radius')}</span>
                            <span style={{ fontWeight: 600, color: '#1F3A2E' }}>{radius} km</span>
                          </div>
                          <input
                            type="range"
                            min="5"
                            max="100"
                            value={radius}
                            onChange={(e) => setRadius(parseInt(e.target.value))}
                            style={{ width: '100%', accentColor: '#2D5F4C' }}
                          />
                        </div>

                        {/* Nearby rivers list — mirrors what's highlighted on the map */}
                        {nearbyRiverIds.length > 0 ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            <span style={{
                              fontSize: '11px',
                              color: '#5A7766',
                              fontWeight: 600,
                              textTransform: 'uppercase',
                              letterSpacing: '0.04em',
                            }}>
                              🎣 {nearbyRiverIds.length} {t('rivière(s) dans la zone', nearbyRiverIds.length === 1 ? 'river in area' : 'rivers in area')}
                            </span>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                              {nearbyRiverIds.map((id) => (
                                <span key={id} style={{
                                  fontSize: '11px',
                                  padding: '3px 8px',
                                  borderRadius: '20px',
                                  backgroundColor: 'rgba(45, 95, 76, 0.12)',
                                  border: '1px solid #2D5F4C',
                                  color: '#1F3A2E',
                                  fontWeight: 500,
                                }}>
                                  🌊 {formatRiverName ? formatRiverName(id) : id}
                                </span>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <span style={{ fontSize: '11px', color: '#9CA3AF', fontStyle: 'italic' }}>
                            {t('Aucune rivière dans cette zone', 'No rivers in this area')}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => setBookingStep(2)}
                    style={{
                      width: '100%',
                      padding: isCompactViewport ? '10px 14px' : '14px 20px',
                      backgroundColor: '#2D5F4C',
                      color: '#FFFCF7',
                      border: 'none',
                      borderRadius: '12px',
                      cursor: 'pointer',
                      fontWeight: '600',
                      fontSize: isCompactViewport ? '13px' : '15px',
                      marginTop: '4px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {t('Continuer →', 'Continue →')}
                  </button>
                </div>
              );
            })()}

            {/* Step 2: Dates (NEW FLOW) */}
            {bookingStep === 2 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: isCompactViewport ? '10px' : '16px' }}>
                <h3 style={{ margin: 0, fontSize: isCompactViewport ? '13px' : '16px', color: '#1F3A2E' }}>
                  2. {t('Vos dates', 'Your dates')}
                </h3>

                <p style={{ fontSize: isCompactViewport ? '11px' : '13px', color: '#5A7766', margin: 0, lineHeight: 1.5 }}>
                  {t(
                    'Sélectionnez une plage de dates en 2 clics: arrivée puis départ.',
                    'Select your date range in 2 clicks: check-in then check-out.'
                  )}
                </p>

                <div style={{
                  backgroundColor: '#FFFCF7',
                  borderRadius: '12px',
                  border: '1px solid rgba(45, 95, 76, 0.14)',
                  overflow: 'hidden',
                }}>
                  <DateRangePicker
                    onDateChange={(checkIn, checkOut) => {
                      setStartDate(toIsoDateLocal(checkIn));
                      setEndDate(toIsoDateLocal(checkOut));
                    }}
                    minDate={new Date()}
                    initialCheckIn={parseIsoDateLocal(startDate)}
                    initialCheckOut={parseIsoDateLocal(endDate)}
                    monthsToShow={1}
                  />
                </div>

                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  padding: '10px 12px',
                  borderRadius: '10px',
                  border: '1px solid rgba(45, 95, 76, 0.18)',
                  backgroundColor: 'rgba(32, 79, 61, 0.05)',
                }}>
                  <p style={{ margin: 0, fontSize: '11px', letterSpacing: '0.04em', fontWeight: 700, color: '#5A7766', textTransform: 'uppercase' }}>
                    {t('Plage sélectionnée', 'Selected range')}
                  </p>
                  {!startDate && !endDate && (
                    <p style={{ margin: 0, fontSize: '13px', color: '#355446' }}>
                      {t('Cliquez une date d\'arrivée puis une date de départ.', 'Click a check-in date, then a check-out date.')}
                    </p>
                  )}
                  {startDate && !endDate && (
                    <p style={{ margin: 0, fontSize: '13px', color: '#355446' }}>
                      {t('Arrivée', 'Check-in')}: <strong>{formatLongDate(startDate)}</strong>
                    </p>
                  )}
                  {startDate && endDate && (
                    <>
                      <p style={{ margin: 0, fontSize: '13px', color: '#1F3A2E', fontWeight: 600 }}>
                        {formatLongDate(startDate)} → {formatLongDate(endDate)}
                      </p>
                      <p style={{ margin: 0, fontSize: '12px', color: '#355446' }}>
                        {Math.max(1, Math.round((parseIsoDateLocal(endDate) - parseIsoDateLocal(startDate)) / (1000 * 60 * 60 * 24)))} {t('nuit(s)', 'night(s)')}
                      </p>
                      {(() => {
                        const activeOption = (alternativeDateOptions || []).find(
                          (option) => option.startDate === startDate && option.endDate === endDate
                        );
                        if (!activeOption) return null;
                        return (
                          <p style={{ margin: 0, fontSize: '12px', color: '#355446' }}>
                            {activeOption.guideCount || 0} {t('guides disponibles', 'guides available')} • {activeOption.chaletCount || 0} {t('chalets disponibles', 'chalets available')}
                          </p>
                        );
                      })()}
                    </>
                  )}
                </div>

                {startDate && endDate && new Date(endDate) <= new Date(startDate) && (
                  <div style={{
                    padding: '10px',
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    borderRadius: '8px',
                    fontSize: '12px',
                    color: '#DC2626',
                  }}>
                    {t('La date de départ doit être après la date d\'arrivée', 'Departure date must be after arrival date')}
                  </div>
                )}

                <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                  <button
                    type="button"
                    onClick={() => setBookingStep(1)}
                    style={{
                      flex: 1,
                      padding: isCompactViewport ? '10px' : '14px',
                      backgroundColor: 'transparent',
                      color: '#5A7766',
                      border: '1.5px solid #5A7766',
                      borderRadius: '12px',
                      cursor: 'pointer',
                      fontWeight: '500',
                      fontSize: isCompactViewport ? '12px' : '14px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {t('← Retour', '← Back')}
                  </button>
                  <button
                    type="button"
                    onClick={goToResultsStep}
                    disabled={!canProceedStep2}
                    style={{
                      flex: 1,
                      padding: isCompactViewport ? '10px' : '14px',
                      backgroundColor: canProceedStep2 ? '#2D5F4C' : '#9CA3AF',
                      color: '#FFFCF7',
                      border: 'none',
                      borderRadius: '12px',
                      cursor: canProceedStep2 ? 'pointer' : 'not-allowed',
                      fontWeight: '600',
                      fontSize: isCompactViewport ? '12px' : '14px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {t('Continuer →', 'Continue →')}
                  </button>
                </div>
              </div>
            )}

            {/* Step 3: Guides + Chalets (NEW FLOW — full-screen overlay) */}
            {bookingStep === 3 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: isCompactViewport ? '8px' : '12px', flex: 1, minHeight: 0, overflow: 'hidden' }}>
                <h3 style={{ margin: 0, fontSize: isCompactViewport ? '13px' : '16px', color: '#1F3A2E', flexShrink: 0 }}>
                  3. {browseMode === 'guide'
                    ? t('Sélectionnez un guide', 'Select a guide')
                    : browseMode === 'chalet'
                    ? t('Sélectionnez un chalet', 'Select a chalet')
                    : t('Sélectionnez guide et hébergement', 'Select guide and accommodation')}
                </h3>

                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  padding: isCompactViewport ? '8px 10px' : '10px 12px',
                  backgroundColor: 'rgba(32, 79, 61, 0.045)',
                  borderRadius: '10px',
                  border: '1px solid rgba(32, 79, 61, 0.14)',
                  flexShrink: 0,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                    <div>
                      <p style={{ margin: 0, fontSize: '11px', fontWeight: 600, color: '#5A7766' }}>
                        {t('Plage active', 'Active range')}
                      </p>
                      <p style={{ margin: '2px 0 0', fontSize: isCompactViewport ? '12px' : '13px', fontWeight: 700, color: '#1F3A2E' }}>
                        {new Date(`${startDate}T00:00:00`).toLocaleDateString(uiLocale, { day: 'numeric', month: 'short' })}
                        {' - '}
                        {new Date(`${endDate}T00:00:00`).toLocaleDateString(uiLocale, { day: 'numeric', month: 'short' })}
                      </p>
                      {(() => {
                        const activeOption = (alternativeDateOptions || []).find(
                          (option) => option.startDate === startDate && option.endDate === endDate
                        );
                        if (!activeOption) return null;
                        return (
                          <p style={{ margin: '2px 0 0', fontSize: '11px', color: '#355446' }}>
                            {activeOption.guideCount || 0} {t('guides', 'guides')} • {activeOption.chaletCount || 0} {t('chalets', 'chalets')}
                          </p>
                        );
                      })()}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {loadingAlternativeDates && (
                        <span style={{ fontSize: '11px', color: '#5A7766' }}>
                          {t('Analyse...', 'Analyzing...')}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => setShowStep3FlexibleDates(prev => !prev)}
                        style={{
                          border: '1px solid #D1D5DB',
                          backgroundColor: '#FFFCF7',
                          borderRadius: '999px',
                          padding: '4px 10px',
                          fontSize: '11px',
                          color: '#355446',
                          cursor: 'pointer',
                          fontWeight: 600,
                        }}
                      >
                        {showStep3FlexibleDates
                          ? t('Masquer dates', 'Hide dates')
                          : t('Voir dates flexibles', 'View flexible dates')}
                      </button>
                    </div>
                  </div>

                  {showStep3FlexibleDates && (
                    <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '2px' }}>
                      {(alternativeDateOptions || []).map((option) => {
                        const isSelected = option.startDate === startDate && option.endDate === endDate;
                        const isOriginal = option.startDate === originalStartDate && option.endDate === originalEndDate;
                        const isWeak = Boolean(option.isWeakOption);

                        return (
                          <button
                            key={option.key || `${option.startDate}-${option.endDate}`}
                            type="button"
                            onClick={() => {
                              applyAlternativeDateOption && applyAlternativeDateOption(option);
                              setShowStep3FlexibleDates(false);
                            }}
                            style={{
                              minWidth: '150px',
                              borderRadius: '8px',
                              border: isSelected
                                ? '2px solid #2D5F4C'
                                : isWeak
                                ? '1px dashed #D97706'
                                : '1px solid #CFE0D8',
                              background: isSelected
                                ? 'rgba(45, 95, 76, 0.12)'
                                : isWeak
                                ? 'rgba(217, 119, 6, 0.08)'
                                : '#FFFCF7',
                              color: '#1F3A2E',
                              padding: '8px',
                              cursor: 'pointer',
                              textAlign: 'left',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '4px',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
                              <span style={{ fontSize: '11px', fontWeight: 700 }}>
                                {new Date(`${option.startDate}T00:00:00`).toLocaleDateString(uiLocale, { day: 'numeric', month: 'short' })}
                                {' - '}
                                {new Date(`${option.endDate}T00:00:00`).toLocaleDateString(uiLocale, { day: 'numeric', month: 'short' })}
                              </span>
                              {isOriginal && (
                                <span style={{ fontSize: '9px', fontWeight: 700, color: '#2D5F4C' }}>
                                  {t('Original', 'Original')}
                                </span>
                              )}
                            </div>

                            <span style={{ fontSize: '10px', color: '#355446' }}>
                              {option.guideCount || 0} {t('guides', 'guides')} • {option.chaletCount || 0} {t('chalets', 'chalets')}
                            </span>

                            <span style={{ fontSize: '10px', color: isWeak ? '#B45309' : '#5A7766' }}>
                              {option.offsetDays === 0
                                ? t('Dates demandées', 'Requested dates')
                                : option.offsetDays > 0
                                ? t(`+${option.offsetDays} jours`, `+${option.offsetDays} days`)
                                : t(`${option.offsetDays} jours`, `${option.offsetDays} days`)}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Filter row — progressive disclosure to reduce initial load */}
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  padding: isCompactViewport ? '7px 9px' : '9px 10px',
                  backgroundColor: 'rgba(45, 95, 76, 0.03)',
                  borderRadius: '10px',
                  border: '1px solid #E6ECE9',
                  flexShrink: 0,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                    <p style={{ margin: 0, fontSize: isCompactViewport ? '11px' : '12px', color: '#355446', fontWeight: 600 }}>
                      {t('Filtres', 'Filters')}: {numberOfPeople} {t('pers.', 'people')}
                      {' • '}
                      {browseMode !== 'chalet'
                        ? (fishType ? FISH_TYPES?.find(f => f.value === fishType)?.label || fishType : t('Tous poissons', 'All fish'))
                        : t('Sans filtre poisson', 'No fish filter')}
                      {' • '}
                      {needsChalet ? t('Chalet', 'Chalet') : t('Sans chalet', 'No chalet')}
                    </p>
                    <button
                      type="button"
                      onClick={() => setShowStep3Filters(prev => !prev)}
                      style={{
                        border: '1px solid #D1D5DB',
                        backgroundColor: '#FFFCF7',
                        borderRadius: '999px',
                        padding: '4px 10px',
                        fontSize: '11px',
                        color: '#355446',
                        cursor: 'pointer',
                        fontWeight: 600,
                      }}
                    >
                      {showStep3Filters ? t('Masquer', 'Hide') : t('Modifier', 'Edit')}
                    </button>
                  </div>

                  {showStep3Filters && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                      {browseMode !== 'chalet' && (
                        <div style={{ flex: '1 1 160px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <label style={{ fontSize: '11px', color: '#5A7766', fontWeight: '500' }}>
                            {t('Poisson (optionnel)', 'Fish (optional)')}
                          </label>
                          <select
                            value={fishType}
                            onChange={(e) => setFishType(e.target.value)}
                            style={{
                              padding: '7px',
                              borderRadius: '6px',
                              border: '1px solid #5A7766',
                              fontSize: '12px',
                              color: '#1F3A2E',
                              backgroundColor: '#FFFCF7',
                              cursor: 'pointer',
                            }}
                          >
                            <option value="">{t('Tous', 'All')}</option>
                            {FISH_TYPES && FISH_TYPES.map(fish => (
                              <option key={fish.value} value={fish.value}>{fish.label}</option>
                            ))}
                          </select>
                        </div>
                      )}

                      <div style={{ flex: '1 1 120px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <label style={{ fontSize: '11px', color: '#5A7766', fontWeight: '500' }}>
                          {t('Personnes', 'People')}
                        </label>
                        <input
                          type="number"
                          min="1"
                          max="20"
                          value={numberOfPeople || ''}
                          onChange={(e) => setNumberOfPeople(parseInt(e.target.value) || 1)}
                          style={{
                            padding: '7px',
                            borderRadius: '6px',
                            border: '1px solid #5A7766',
                            fontSize: '12px',
                            color: '#1F3A2E',
                            backgroundColor: '#FFFCF7',
                          }}
                        />
                      </div>

                      {browseMode === 'trip' && (
                        <div style={{
                          flex: '1 1 120px',
                          display: 'flex',
                          alignItems: 'flex-end',
                          gap: '6px',
                        }}>
                          <input
                            type="checkbox"
                            id="needsChaletStep3"
                            checked={needsChalet}
                            onChange={(e) => setNeedsChalet(e.target.checked)}
                            style={{
                              width: '16px',
                              height: '16px',
                              cursor: 'pointer',
                              accentColor: '#2D5F4C',
                            }}
                          />
                          <label
                            htmlFor="needsChaletStep3"
                            style={{
                              fontSize: '12px',
                              color: '#1F3A2E',
                              fontWeight: '500',
                              cursor: 'pointer',
                              paddingBottom: '2px',
                            }}
                          >
                            {t('Inclure chalet', 'Include chalet')}
                          </label>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {loadingZones && (
                  <div style={{ textAlign: 'center', padding: '4px', color: '#5A7766', fontSize: '11px', flexShrink: 0 }}>
                    {t('Chargement des zones de pêche...', 'Loading fishing zones...')}
                  </div>
                )}

                {/* Scrollable content area for guide and chalet sections */}
                <div style={{
                  flex: 1,
                  minHeight: 0,
                  overflowY: 'auto',
                  overflowX: 'hidden',
                  display: 'grid',
                  // Pile verticale (guides puis chalets) — équipements en étape 4 dédiée.
                  gridTemplateColumns: 'minmax(0, 1fr)',
                  alignItems: 'start',
                  gap: isCompactViewport ? '10px' : '12px',
                }}>
                  {/* GUIDE SECTION - hidden in chalet-only mode */}
                  {browseMode !== 'chalet' && (
                  <div style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    minWidth: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    border: '1px solid #E3EAE6',
                    borderRadius: '10px',
                    backgroundColor: '#FFFCF7',
                    padding: '10px',
                  }}>
                    <h4 style={{ margin: '0 0 8px', flexShrink: 0, fontSize: isCompactViewport ? '13px' : '14px', color: '#1F3A2E', fontWeight: '600' }}>
                      {t('Guides disponibles', 'Available guides')}
                    </h4>

                  {loadingGuides ? (
                    <div style={{ textAlign: 'center', padding: '16px', color: '#5A7766' }}>
                      {t('Chargement des guides...', 'Loading guides...')}
                    </div>
                  ) : availableGuides.length === 0 ? (
                    <div style={{
                      padding: '12px',
                      backgroundColor: 'rgba(245, 158, 11, 0.1)',
                      borderRadius: '8px',
                      color: '#D97706',
                      fontSize: '13px'
                    }}>
                      {fishType
                        ? `${t('Aucun guide spécialisé trouvé pour', 'No specialized guide found for')} "${FISH_TYPES?.find(f => f.value === fishType)?.label || fishType}"`
                        : t('Aucun guide trouvé pour ces dates', 'No guides found for these dates')}
                    </div>
                  ) : (
                    <div style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                      width: '100%',
                      minWidth: 0,
                    }}
                    >
                      {/* Option to skip guide */}
                      <div
                        onClick={() => handleSelectGuide(null)}
                        style={{
                          padding: '8px 10px',
                          backgroundColor: selectedGuide === null ? 'rgba(45, 95, 76, 0.15)' : '#FFFCF7',
                          borderRadius: '8px',
                          border: selectedGuide === null ? '2px solid #2D5F4C' : '1px dashed #D1D5DB',
                          cursor: 'pointer',
                          fontSize: '12px'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <span style={{ fontSize: '18px' }}>✗</span>
                          <span style={{ color: '#5A7766' }}>{t('Continuer sans guide', 'Continue without a guide')}</span>
                        </div>
                      </div>

                      {/* Guide list — compact rows with direct access to slots */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {sortedAvailableGuides.map((guide) => {
                          const isGuideSelected = selectedGuide?.guide_id === guide.guide_id;
                          const isAvailable = guide.is_available !== false;
                          const zones = guide.preferredZoneNames || [];
                          const prefersRiver = !selectedRiverSlug || (zones.length > 0 && zones.some((z) => z.includes(selectedRiverSlug)));
                          const showOutsideZoneNote = selectedRiverSlug && !prefersRiver;

                          return (
                            <div
                              key={guide.guide_id}
                              onMouseEnter={() => s3Highlight(guide.guide_id, 'guide')}
                              onMouseLeave={s3ClearHighlight}
                              onClick={() => openGuideSlotPicker(guide)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                  event.preventDefault();
                                  openGuideSlotPicker(guide);
                                }
                              }}
                              role={isAvailable ? 'button' : undefined}
                              tabIndex={isAvailable ? 0 : -1}
                              style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '8px',
                                padding: '7px 8px',
                                backgroundColor: isGuideSelected
                                  ? 'rgba(45, 95, 76, 0.1)'
                                  : (s3HoveredId === guide.guide_id && s3HoveredType === 'guide')
                                  ? 'rgba(232, 123, 53, 0.08)'
                                  : '#FFFCF7',
                                borderRadius: '8px',
                                border: isGuideSelected ? '1.5px solid #2D5F4C' : '1px solid #E1E7E3',
                                opacity: isAvailable ? 1 : 0.7,
                                transition: 'background-color 0.15s ease',
                                cursor: isAvailable ? 'pointer' : 'default',
                              }}
                            >
                              {/* Row 1: avatar + info */}
                              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', minWidth: 0 }}>
                                <AvatarImage
                                  src={guide.avatarSrc}
                                  name={guide.name || 'Guide'}
                                  alt={guide.name || 'Guide'}
                                  imgStyle={{
                                    width: '32px', height: '32px', borderRadius: '50%',
                                    objectFit: 'cover', flexShrink: 0,
                                    border: '1px solid rgba(74, 155, 142, 0.35)',
                                  }}
                                  fallbackStyle={{
                                    width: '32px', height: '32px', borderRadius: '50%',
                                    backgroundColor: '#4A9B8E', flexShrink: 0,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    color: 'white', fontWeight: '600', fontSize: '12px',
                                  }}
                                  fallback="GU"
                                />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <p style={{ margin: 0, fontWeight: '600', fontSize: '12px', color: '#1F3A2E' }}>
                                    {guide.name}
                                    {!isAvailable && (
                                      <span style={{
                                        marginLeft: 6, fontSize: 10, padding: '2px 6px',
                                        borderRadius: 4, backgroundColor: 'rgba(220, 38, 38, 0.16)',
                                        color: '#B91C1C', fontWeight: 500,
                                      }}>
                                        {t('Non dispo', 'Unavailable')}
                                      </span>
                                    )}
                                  </p>
                                  {guide.fish_types && guide.fish_types.length > 0 && (
                                    <p style={{ margin: '2px 0 0', fontSize: '10px', color: '#5A7766' }}>
                                      {guide.fish_types.slice(0, 3).join(', ')}
                                    </p>
                                  )}
                                  {showOutsideZoneNote && (
                                    <p style={{ margin: '2px 0 0', fontSize: '10px', color: '#92400E', fontStyle: 'italic' }}>
                                      {t('Peut guider hors de ses rivières habituelles', 'Can guide outside their usual rivers')}
                                    </p>
                                  )}
                                  <p style={{ margin: '4px 0 0', fontSize: '11px', color: '#5A7766' }}>
                                    {isAvailable
                                      ? t('Cliquez sur la carte pour voir les créneaux.', 'Click the card to see time slots.')
                                      : t('Ce guide n\'est pas disponible pour la plage de dates active.', 'This guide is unavailable for the active date range.')}
                                  </p>
                                </div>
                              </div>

                              {/* Row 2: action buttons — separate row so they never overflow */}
                              <div style={{
                                display: 'flex', alignItems: 'center',
                                gap: '8px', flexWrap: 'wrap', paddingLeft: '42px',
                              }}>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedGuideForCalendar(guide);
                                    setCalendarModalOpen(true);
                                  }}
                                  title={t('Voir le calendrier mensuel', 'View the monthly calendar')}
                                  style={{
                                    border: '1px solid #D9D9D9', backgroundColor: '#F5F5F5',
                                    color: '#4A9B8E', borderRadius: '999px', padding: '4px 10px',
                                    fontSize: '11px', cursor: 'pointer', display: 'flex',
                                    alignItems: 'center', justifyContent: 'center',
                                    gap: '6px', minHeight: '28px', transition: 'all 0.15s ease',
                                  }}
                                  onMouseEnter={(e) => {
                                    e.currentTarget.style.backgroundColor = '#E8E8E8';
                                    e.currentTarget.style.borderColor = '#4A9B8E';
                                  }}
                                  onMouseLeave={(e) => {
                                    e.currentTarget.style.backgroundColor = '#F5F5F5';
                                    e.currentTarget.style.borderColor = '#D9D9D9';
                                  }}
                                >
                                  📅
                                  <span style={{ whiteSpace: 'nowrap' }}>
                                    {t('Calendrier mensuel', 'Monthly calendar')}
                                  </span>
                                </button>

                                <span style={{
                                  fontSize: '11px', fontWeight: 600, lineHeight: 1,
                                  padding: '4px 8px', borderRadius: '999px',
                                  color: isGuideSelected ? '#2D5F4C' : '#5A7766',
                                  backgroundColor: isGuideSelected ? 'rgba(45, 95, 76, 0.10)' : 'rgba(90, 119, 102, 0.08)',
                                }}>
                                  {isGuideSelected ? t('Choisi', 'Selected') : t('Voir les créneaux', 'View slots')}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Selected slot count stays visible but compact */}
                      {selectedGuide && selectedTimeSlots && selectedTimeSlots.length > 0 && (
                        <div style={{
                          marginTop: '6px',
                          padding: '7px 9px',
                          backgroundColor: 'rgba(34, 197, 94, 0.08)',
                          borderRadius: '8px',
                          fontSize: '11px',
                          color: '#047857'
                        }}>
                          ✓ {selectedTimeSlots.length} {t('créneau(x) sélectionné(s)', 'slot(s) selected')} • {selectedGuide?.name}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                )}

                {/* CHALET SECTION - only if needsChalet is true (always shown in chalet mode) */}
                {needsChalet && (
                  <div style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    minWidth: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    border: '1px solid #E3EAE6',
                    borderRadius: '10px',
                    backgroundColor: '#FFFCF7',
                    padding: '10px',
                    overflow: 'hidden',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                      <h4 style={{ margin: 0, fontSize: '14px', color: '#1F3A2E', fontWeight: '600' }}>
                        {t('Chalets', 'Chalets')}
                        {!loadingChalets && chalets.length > 0 && (
                          <span style={{ marginLeft: '6px', fontSize: '11px', fontWeight: 400, color: '#5A7766' }}>
                            ({chalets.filter(c => c.is_available !== false).length}/{chalets.length} {t('dispo', 'available')})
                          </span>
                        )}
                      </h4>
                      {!loadingChalets && chalets.some(c => c.is_available === false) && (
                        <button
                          type="button"
                          onClick={() => setShowOnlyAvailableChalets(prev => !prev)}
                          style={{
                            padding: '3px 8px',
                            borderRadius: '999px',
                            border: showOnlyAvailableChalets ? '1.5px solid #2D5F4C' : '1px solid #C5D2CB',
                            backgroundColor: showOnlyAvailableChalets ? 'rgba(45, 95, 76, 0.12)' : '#FFFCF7',
                            color: showOnlyAvailableChalets ? '#2D5F4C' : '#5A7766',
                            fontSize: '10px',
                            fontWeight: 600,
                            cursor: 'pointer',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {showOnlyAvailableChalets ? t('Tout afficher', 'Show all') : t('Dispo seulement', 'Available only')}
                        </button>
                      )}
                    </div>

                    {!selectedPoint?.lngLat && !selectedRiverProp ? (
                      <div style={{
                        padding: '12px',
                        backgroundColor: 'rgba(74, 155, 142, 0.08)',
                        borderRadius: '8px',
                        border: '1px dashed #4A9B8E',
                        fontSize: '12px',
                        color: '#2D5F4C',
                        textAlign: 'center',
                      }}>
                        {t(
                          'Retournez à l\'étape 1 pour choisir une destination et voir les chalets à proximité.',
                          'Go back to step 1 to pick a destination and see nearby chalets.'
                        )}
                      </div>
                    ) : (
                      <div style={{
                        flex: 'none',
                        width: '100%',
                        minWidth: 0,
                        overflowX: 'hidden',
                        paddingRight: '2px',
                      }}
                      >
                        {loadingChalets && (
                          <div style={{ textAlign: 'center', padding: '16px', color: '#5A7766' }}>
                            {t('Chargement des chalets...', 'Loading chalets...')}
                          </div>
                        )}

                        {chaletError && (
                          <div style={{
                            padding: '10px',
                            backgroundColor: 'rgba(239, 68, 68, 0.1)',
                            borderRadius: '8px',
                            color: '#DC2626',
                            fontSize: '12px'
                          }}>
                            {t('Erreur', 'Error')}: {chaletError}
                          </div>
                        )}

                        {!loadingChalets && !chaletError && chalets.length === 0 && (
                          <div style={{
                            padding: '10px 12px',
                            backgroundColor: 'rgba(90, 119, 102, 0.08)',
                            borderRadius: '8px',
                            color: '#4B6256',
                            fontSize: '12px',
                            textAlign: 'center'
                          }}>
                            {t('Aucun chalet trouvé à proximité.', 'No chalet found nearby.')}
                          </div>
                        )}

                        {!loadingChalets && !chaletError && chalets.length > 0 && (() => {
                          const displayChalets = showOnlyAvailableChalets
                            ? chalets.filter(c => c.is_available !== false)
                            : chalets;

                          const fmtDist = (dm) => {
                            if (dm == null || !isFinite(dm)) return null;
                            const km = dm / 1000;
                            return km < 1 ? `${Math.round(dm)} m` : `${km.toFixed(1)} km`;
                          };

                          return (
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '8px', padding: '2px' }}>
                              {displayChalets.map((chalet, index) => {
                                const cId = chalet.key || chalet.id;
                                const isChaletHovered = s3HoveredId === cId && s3HoveredType === 'chalet';
                                const isAvailable = chalet.is_available !== false;
                                const distLabel = fmtDist(chalet.distance_m);

                                return (
                                  <div
                                    key={chalet.id || index}
                                    onClick={() => isAvailable && handleSelectedChalet({ id: cId, name: chalet.Name, ...chalet })}
                                    onMouseEnter={() => s3Highlight(cId, 'chalet')}
                                    onMouseLeave={s3ClearHighlight}
                                    style={{
                                      position: 'relative',
                                      minHeight: '132px',
                                      borderRadius: '10px',
                                      overflow: 'hidden',
                                      backgroundColor: selectedChalet?.id === cId
                                        ? 'rgba(45, 95, 76, 0.15)'
                                        : isChaletHovered
                                        ? 'rgba(45, 95, 76, 0.18)'
                                        : 'rgba(45, 95, 76, 0.05)',
                                      opacity: isAvailable ? 1 : 0.55,
                                      border: selectedChalet?.id === cId
                                        ? '2px solid #2D5F4C'
                                        : '1px solid rgba(31, 58, 46, 0.15)',
                                      boxShadow: isChaletHovered && isAvailable
                                        ? '0 8px 18px rgba(31, 58, 46, 0.16)'
                                        : '0 3px 10px rgba(31, 58, 46, 0.08)',
                                      cursor: isAvailable ? 'pointer' : 'default',
                                      transition: 'transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease',
                                      transform: isChaletHovered && isAvailable ? 'translateY(-1px)' : 'translateY(0)',
                                    }}
                                  >
                                    {chalet.Image ? (
                                      <img
                                        src={chalet.Image}
                                        alt={chalet.Name}
                                        style={{
                                          width: '100%',
                                          height: '100%',
                                          objectFit: 'cover',
                                          display: 'block'
                                        }}
                                      />
                                    ) : (
                                      <div style={{
                                        width: '100%',
                                        height: '100%',
                                        background: 'linear-gradient(140deg, #88A89A 0%, #4A9B8E 100%)'
                                      }} />
                                    )}

                                    <div style={{
                                      position: 'absolute',
                                      inset: 0,
                                      background: 'linear-gradient(180deg, rgba(0, 0, 0, 0) 42%, rgba(0, 0, 0, 0.58) 100%)'
                                    }} />

                                    {/* Unavailability badge */}
                                    {!isAvailable && (
                                      <div style={{
                                        position: 'absolute',
                                        top: 0,
                                        left: 0,
                                        right: 0,
                                        zIndex: 3,
                                        backgroundColor: 'rgba(0,0,0,0.54)',
                                        color: '#FFDB99',
                                        fontSize: '9px',
                                        fontWeight: 700,
                                        textAlign: 'center',
                                        padding: '4px 4px',
                                        letterSpacing: '0.3px',
                                      }}>
                                        {t('Indisponible pour ces dates', 'Unavailable for these dates')}
                                      </div>
                                    )}

                                    <div style={{
                                      position: 'absolute',
                                      left: '8px',
                                      right: '8px',
                                      bottom: '8px',
                                      color: '#FFFFFF',
                                      zIndex: 1,
                                      textShadow: '0 2px 8px rgba(0, 0, 0, 0.5)'
                                    }}>
                                      <p style={{ margin: 0, fontWeight: '700', fontSize: '11px', lineHeight: 1.2 }}>
                                        {chalet.Name}
                                      </p>
                                      <p style={{ margin: '2px 0 0', fontSize: '10px', opacity: 0.95 }}>
                                        {chalet.nb_personnes} {t('pers.', 'people')}
                                        {(chalet.price_per_night || chalet.price) && ` • ${Math.round(chalet.price_per_night || chalet.price)}$/${t('nuit', 'night')}`}
                                        {distLabel && ` • ${distLabel}`}
                                      </p>
                                    </div>

                                    {handleVoirPlus && (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleVoirPlus(chalet);
                                        }}
                                        style={{
                                          position: 'absolute',
                                          left: '8px',
                                          top: isAvailable ? '8px' : '28px',
                                          zIndex: 4,
                                          padding: '4px 8px',
                                          borderRadius: '999px',
                                          border: '1px solid rgba(255, 255, 255, 0.7)',
                                          backgroundColor: 'rgba(0, 0, 0, 0.55)',
                                          color: '#FFFCF7',
                                          fontSize: '10px',
                                          fontWeight: '600',
                                          cursor: 'pointer'
                                        }}
                                      >
                                        {t('Voir détails', 'View details')}
                                      </button>
                                    )}

                                    {selectedChalet?.id === cId && (
                                      <span style={{
                                        position: 'absolute',
                                        top: '7px',
                                        right: '7px',
                                        zIndex: 2,
                                        width: '22px',
                                        height: '22px',
                                        borderRadius: '999px',
                                        backgroundColor: '#2D5F4C',
                                        color: '#FFFCF7',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        fontSize: '13px',
                                        fontWeight: '700',
                                        boxShadow: '0 3px 8px rgba(0, 0, 0, 0.3)'
                                      }}>✓</span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                )}

                </div>
                {/* End of scrollable content area */}

                {/* Selection summary */}
                <div style={{
                  padding: '8px 10px',
                  backgroundColor: 'rgba(255, 252, 247, 0.85)',
                  borderRadius: '8px',
                  border: '1px solid #E3EAE6',
                  fontSize: '11px',
                  flexShrink: 0
                }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 12px' }}>
                    <span><strong>{t('Guide', 'Guide')}:</strong> {selectedGuide ? selectedGuide.name : t('Aucun', 'None')}</span>
                    {needsChalet && (
                      <span><strong>{t('Chalet', 'Chalet')}:</strong> {selectedChalet ? selectedChalet.name : t('Aucun', 'None')}</span>
                    )}
                  </div>
                  {selectedGuide && selectedTimeSlots && selectedTimeSlots.length > 0 && (
                    <div style={{ marginTop: '3px', fontSize: '10px', color: '#5A7766' }}>
                      <strong>{t('Créneaux', 'Time slots')}:</strong> {selectedTimeSlots.length} {t('sélectionné(s)', 'selected')}
                    </div>
                  )}
                </div>

                {/* Booking error display (shows above nav when handleBookGuide fails) */}
                {bookingError && (
                  <div style={{
                    padding: '10px 12px',
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    borderRadius: '8px',
                    fontSize: '12px',
                    color: '#DC2626',
                    flexShrink: 0,
                  }}>
                    ⚠️ {bookingError}
                  </div>
                )}

                {/* Navigation: retour dates | suite équipements (chalet) ou réservation directe */}
                <div style={{ display: 'flex', gap: '8px', flexShrink: 0, position: 'sticky', bottom: 0, background: '#FAF7F1', paddingTop: '6px' }}>
                  <button
                    type="button"
                    onClick={() => setBookingStep(2)}
                    disabled={isCreatingBooking}
                    style={{
                      flex: 1,
                      padding: '11px',
                      backgroundColor: 'transparent',
                      color: '#5A7766',
                      border: '1.5px solid #5A7766',
                      borderRadius: '9px',
                      cursor: isCreatingBooking ? 'not-allowed' : 'pointer',
                      fontWeight: '500',
                      fontSize: '12px',
                      opacity: isCreatingBooking ? 0.6 : 1,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {t('← Retour', '← Back')}
                  </button>
                  <button
                    type="button"
                    onClick={goFromStep3ToNext}
                    disabled={!canProceedStep3 || isCreatingBooking}
                    style={{
                      flex: 1,
                      padding: '11px',
                      backgroundColor: (canProceedStep3 && !isCreatingBooking) ? '#2D5F4C' : '#9CA3AF',
                      color: '#FFFCF7',
                      border: 'none',
                      borderRadius: '9px',
                      cursor: (canProceedStep3 && !isCreatingBooking) ? 'pointer' : 'not-allowed',
                      fontWeight: '600',
                      fontSize: '12px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px',
                    }}
                  >
                    {isCreatingBooking ? (
                      <>
                        <span style={{
                          width: '14px',
                          height: '14px',
                          border: '2px solid #FFFCF7',
                          borderTopColor: 'transparent',
                          borderRadius: '50%',
                          animation: 'spin 1s linear infinite',
                        }} />
                        {t('Réservation...', 'Booking...')}
                      </>
                    ) : (
                      (browseMode === 'chalet' || (browseMode === 'trip' && needsChalet)) && selectedChalet
                        ? t('Continuer →', 'Continue →')
                        : t('Réserver →', 'Book →')
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Step 4: Équipements optionnels (parcours avec chalet) — image couverture */}
            {bookingStep === 4 && bookingMaxStep === 5 && selectedChalet && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: isCompactViewport ? '10px' : '14px', flex: 1, minHeight: 0, overflow: 'hidden' }}>
                <h3 style={{ margin: 0, fontSize: isCompactViewport ? '13px' : '17px', color: '#1F3A2E', fontWeight: 700 }}>
                  {`4. ${t('Équipements optionnels', 'Optional equipment')}`}
                </h3>

                <div style={{
                  width: '100%',
                  borderRadius: '14px',
                  overflow: 'hidden',
                  border: '1px solid rgba(45, 95, 76, 0.2)',
                  backgroundColor: 'rgba(32, 79, 61, 0.06)',
                  flexShrink: 0,
                }}>
                  {(selectedChalet.Image || selectedChalet.image) ? (
                    <img
                      src={selectedChalet.Image || selectedChalet.image}
                      alt=""
                      style={{
                        width: '100%',
                        height: isCompactViewport ? 'min(42vw, 160px)' : 'min(200px, 28vh)',
                        objectFit: 'cover',
                        display: 'block',
                      }}
                    />
                  ) : (
                    <div style={{
                      width: '100%',
                      height: isCompactViewport ? '120px' : '140px',
                      background: 'linear-gradient(145deg, #2D5F4C 0%, #5A9078 55%, #8EB8A8 100%)',
                    }} aria-hidden />
                  )}
                  <div style={{ padding: isCompactViewport ? '10px 12px' : '12px 14px', backgroundColor: '#FFFCF7' }}>
                    <p style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#1F3A2E' }}>
                      {selectedChalet.name || selectedChalet.Name || t('Votre chalet', 'Your chalet')}
                    </p>
                    <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#5A7766', fontWeight: 500 }}>
                      {startDate && endDate ? (
                        <>
                          {new Date(`${startDate}T12:00:00`).toLocaleDateString(uiLocale, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
                          {' → '}
                          {new Date(`${endDate}T12:00:00`).toLocaleDateString(uiLocale, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
                        </>
                      ) : null}
                    </p>
                  </div>
                </div>

                <p style={{ margin: 0, fontSize: '12px', color: '#5A7766', lineHeight: 1.45 }}>
                  {t(
                    'Ajoutez du matériel à votre séjour si vous en avez besoin. Vous pouvez passer cette étape sans rien sélectionner.',
                    'Add gear for your stay if you need it. You can skip this step with nothing selected.',
                  )}
                </p>

                <div style={{
                  flex: 1,
                  minHeight: 0,
                  overflowY: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  paddingRight: 2,
                }}>
                  {loadingEquipmentKinds ? (
                    <p style={{ margin: 0, fontSize: 12, color: '#5A7766' }}>{t('Chargement…', 'Loading…')}</p>
                  ) : equipmentKinds.length === 0 ? (
                    <div style={{
                      padding: '14px',
                      borderRadius: '10px',
                      border: '1px dashed #C5D2CB',
                      backgroundColor: 'rgba(45, 95, 76, 0.04)',
                      fontSize: '13px',
                      color: '#5A7766',
                      textAlign: 'center',
                    }}>
                      {t('Aucun équipement optionnel pour cet hébergement.', 'No optional equipment for this property.')}
                    </div>
                  ) : (
                    <>
                      <p style={{ margin: 0, fontSize: 11, color: '#5A7766' }}>
                        {t(
                          `Tarifs selon votre séjour (${addonStayNights} nuitée(s)).`,
                          `Rates for your stay (${addonStayNights} night(s)).`,
                        )}
                      </p>
                      {equipmentKinds.map((kind) => {
                        const qty = Math.floor(Number(inventoryAddonQtyBySlug[kind.slug] ?? 0));
                        const meta = kind.metadata || {};
                        const ps = meta.addon_price_per_stay;
                        const pn = meta.addon_price_per_night;
                        let hint = '';
                        if (ps != null && !Number.isNaN(Number(ps))) {
                          hint = t(
                            `${Math.round(Number(ps))} $ / séjour`,
                            `${Math.round(Number(ps))} $ / stay`,
                          );
                        } else if (pn != null && !Number.isNaN(Number(pn))) {
                          hint = t(
                            `${Math.round(Number(pn))} $/nuit × ${addonStayNights}`,
                            `${Math.round(Number(pn))} $/night × ${addonStayNights}`,
                          );
                        }
                        const lineEst = (() => {
                          if (qty < 1) return null;
                          if (ps != null && !Number.isNaN(Number(ps))) {
                            return Math.round(Number(ps) * qty * 100) / 100;
                          }
                          if (pn != null && !Number.isNaN(Number(pn))) {
                            return Math.round(Number(pn) * addonStayNights * qty * 100) / 100;
                          }
                          return null;
                        })();

                        // null = pas encore chargé ; 0 = épuisé pour ces dates
                        const availableCount = availableCountsLoaded && kind.id
                          ? (availableCountByKindId[kind.id] ?? 0)
                          : null;
                        const isOutOfStock = availableCount === 0;
                        const atMax = availableCount !== null && qty >= availableCount;
                        const plusDisabled = isOutOfStock || atMax || qty >= 50;

                        return (
                          <div
                            key={kind.id || kind.slug}
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 6,
                              padding: '10px 12px',
                              backgroundColor: isOutOfStock ? 'rgba(239,68,68,0.04)' : '#FFFCF7',
                              borderRadius: '10px',
                              border: isOutOfStock
                                ? '1px solid rgba(239,68,68,0.3)'
                                : '1px solid #E6ECE9',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: '13px', fontWeight: 700, color: '#1F3A2E', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                  {kind.label || kind.slug}
                                  {isOutOfStock && (
                                    <span style={{
                                      fontSize: 10,
                                      fontWeight: 600,
                                      padding: '2px 6px',
                                      borderRadius: 4,
                                      backgroundColor: 'rgba(239,68,68,0.12)',
                                      color: '#DC2626',
                                    }}>
                                      {t('Épuisé pour ces dates', 'Sold out for these dates')}
                                    </span>
                                  )}
                                  {!isOutOfStock && availableCount !== null && availableCount <= 3 && (
                                    <span style={{
                                      fontSize: 10,
                                      fontWeight: 600,
                                      padding: '2px 6px',
                                      borderRadius: 4,
                                      backgroundColor: 'rgba(217,119,6,0.12)',
                                      color: '#B45309',
                                    }}>
                                      {t(`${availableCount} restante(s)`, `${availableCount} left`)}
                                    </span>
                                  )}
                                </div>
                                <div style={{ fontSize: 11, color: '#5A7766', marginTop: 2 }}>
                                  {hint}{lineEst != null && qty > 0 && (
                                    <span style={{ color: '#2D5F4C', fontWeight: 600 }}>{` · ≈ ${Math.round(lineEst)} $`}</span>
                                  )}
                                </div>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                                <button
                                  type="button"
                                  onClick={() => bumpInventoryAddonQty(kind.slug, -1, availableCount)}
                                  disabled={qty === 0}
                                  style={{
                                    width: '32px',
                                    height: '32px',
                                    borderRadius: '8px',
                                    border: '1px solid #5A7766',
                                    backgroundColor: qty === 0 ? '#F3F4F6' : '#FFFCF7',
                                    cursor: qty === 0 ? 'not-allowed' : 'pointer',
                                    fontWeight: 700,
                                    fontSize: 16,
                                    color: qty === 0 ? '#9CA3AF' : '#1F3A2E',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    lineHeight: 1,
                                    padding: 0,
                                    opacity: qty === 0 ? 0.5 : 1,
                                  }}
                                  aria-label={t('Diminuer', 'Decrease')}
                                >
                                  −
                                </button>
                                <span style={{ minWidth: '22px', textAlign: 'center', fontWeight: 700, fontSize: '14px' }}>{qty}</span>
                                <button
                                  type="button"
                                  onClick={() => bumpInventoryAddonQty(kind.slug, 1, availableCount)}
                                  disabled={plusDisabled}
                                  style={{
                                    width: '32px',
                                    height: '32px',
                                    borderRadius: '8px',
                                    border: `1px solid ${plusDisabled ? 'transparent' : '#5A7766'}`,
                                    backgroundColor: plusDisabled ? '#F3F4F6' : '#FFFCF7',
                                    cursor: plusDisabled ? 'not-allowed' : 'pointer',
                                    fontWeight: 700,
                                    fontSize: 16,
                                    color: plusDisabled ? '#9CA3AF' : '#1F3A2E',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    lineHeight: 1,
                                    padding: 0,
                                    opacity: plusDisabled ? 0.5 : 1,
                                  }}
                                  aria-label={t('Augmenter', 'Increase')}
                                >
                                  +
                                </button>
                              </div>
                            </div>
                            {/* Inline error quand le max est atteint */}
                            {atMax && !isOutOfStock && (
                              <div style={{
                                fontSize: 11,
                                color: '#B45309',
                                backgroundColor: 'rgba(217,119,6,0.08)',
                                borderRadius: 6,
                                padding: '4px 8px',
                              }}>
                                {t(
                                  `Maximum atteint — seulement ${availableCount} unité(s) disponible(s) pour ces dates.`,
                                  `Maximum reached — only ${availableCount} unit(s) available for these dates.`,
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </>
                  )}
                </div>

                {equipmentTotalUnits > 0 && (
                  <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: '#2D5F4C', textAlign: 'center' }}>
                    {t(`${equipmentTotalUnits} article(s) au total`, `${equipmentTotalUnits} item(s) total`)}
                  </p>
                )}

                {bookingError && (
                  <div style={{
                    padding: '10px 12px',
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    borderRadius: '8px',
                    fontSize: '12px',
                    color: '#DC2626',
                  }}>
                    ⚠️ {bookingError}
                  </div>
                )}

                <div style={{ display: 'flex', gap: '8px', flexShrink: 0, paddingTop: 4 }}>
                  <button
                    type="button"
                    onClick={() => setBookingStep(3)}
                    disabled={isCreatingBooking}
                    style={{
                      flex: 1,
                      padding: '12px',
                      backgroundColor: 'transparent',
                      color: '#5A7766',
                      border: '1.5px solid #5A7766',
                      borderRadius: '10px',
                      cursor: isCreatingBooking ? 'not-allowed' : 'pointer',
                      fontWeight: 600,
                      fontSize: '13px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {t('← Retour', '← Back')}
                  </button>
                  <button
                    type="button"
                    onClick={handleBookGuide}
                    disabled={isCreatingBooking}
                    style={{
                      flex: 1,
                      padding: '12px',
                      backgroundColor: isCreatingBooking ? '#9CA3AF' : '#2D5F4C',
                      color: '#FFFCF7',
                      border: 'none',
                      borderRadius: '10px',
                      cursor: isCreatingBooking ? 'not-allowed' : 'pointer',
                      fontWeight: 700,
                      fontSize: '13px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                    }}
                  >
                    {isCreatingBooking ? (
                      <>
                        <span style={{
                          width: '14px',
                          height: '14px',
                          border: '2px solid #FFFCF7',
                          borderTopColor: 'transparent',
                          borderRadius: '50%',
                          animation: 'spin 1s linear infinite',
                        }} />
                        {t('Réservation...', 'Booking...')}
                      </>
                    ) : (
                      t('Réserver →', 'Book →')
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Confirmation (étape 4 si sans chalet, étape 5 si avec chalet) */}
            {bookingStep === bookingMaxStep && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', textAlign: 'center' }}>
                <div style={{
                  width: '64px',
                  height: '64px',
                  borderRadius: '50%',
                  backgroundColor: 'rgba(34, 197, 94, 0.2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto',
                  fontSize: '32px'
                }}>
                  ✓
                </div>

                <h3 style={{ margin: 0, fontSize: '18px', color: '#1F3A2E' }}>
                  {t('Réservation confirmée!', 'Booking confirmed!')}
                </h3>

                <p style={{ fontSize: '14px', color: '#5A7766', margin: 0 }}>
                  {`${selectedGuide && selectedChalet
                    ? t('Votre chalet et guide ont été réservés avec succès.', 'Your chalet and guide were booked successfully.')
                    : selectedChalet
                    ? t('Votre chalet a été réservé avec succès.', 'Your chalet was booked successfully.')
                    : t('Votre guide a été réservé avec succès.', 'Your guide was booked successfully.')
                  } ${t('Vous recevrez une confirmation par courriel.', 'You will receive a confirmation by email.')}`}
                </p>

                <div style={{
                  padding: '16px',
                  backgroundColor: '#FFFCF7',
                  borderRadius: '12px',
                  border: '1px solid #D1D5DB',
                  textAlign: 'left'
                }}>
                  <p style={{ margin: '0 0 8px', fontSize: '13px', color: '#5A7766' }}>
                    <strong>🎣 Poisson:</strong> {FISH_TYPES?.find(f => f.value === fishType)?.label || fishType}
                  </p>
                  {selectedGuide && (
                    <>
                      <p style={{ margin: '0 0 8px', fontSize: '13px', color: '#5A7766' }}>
                        <strong>🧭 Guide:</strong> {selectedGuide?.name}
                      </p>
                      {selectedTimeSlots && selectedTimeSlots.length > 0 && (
                        <div style={{ margin: '0 0 8px', fontSize: '12px', color: '#5A7766' }}>
                          <strong>⏰ {t('Créneaux réservés', 'Booked slots')}:</strong>
                          <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                            {selectedTimeSlots.map((slot, idx) => {
                                const startTime = new Date(slot.startTime).toLocaleTimeString(uiLocale, { hour: '2-digit', minute: '2-digit' });
                                const endTime = new Date(slot.endTime).toLocaleTimeString(uiLocale, { hour: '2-digit', minute: '2-digit' });
                                const date = new Date(slot.date + 'T00:00:00').toLocaleDateString(uiLocale, { weekday: 'short', day: 'numeric', month: 'short' });
                              return (
                                <li key={idx} style={{ fontSize: '11px' }}>{date}: {startTime} - {endTime}</li>
                              );
                            })}
                          </ul>
                        </div>
                      )}
                    </>
                  )}
                  {selectedChalet && needsChalet && (
                    <div style={{ margin: '0 0 8px', fontSize: '13px', color: '#5A7766' }}>
                      <p style={{ margin: 0 }}>
                        <strong>🏠 Chalet:</strong> {selectedChalet?.name}
                      </p>
                      {handleVoirPlus && (
                        <button
                          type="button"
                          onClick={() => handleVoirPlus(selectedChalet)}
                          style={{
                            marginTop: '6px',
                            border: '1px solid #2D5F4C',
                            backgroundColor: '#FFFCF7',
                            color: '#2D5F4C',
                            borderRadius: '8px',
                            fontSize: '11px',
                            fontWeight: '600',
                            padding: '5px 8px',
                            cursor: 'pointer'
                          }}
                        >
                          {t('Voir la page chalet', 'Open chalet page')}
                        </button>
                      )}
                    </div>
                  )}
                  <p style={{ margin: '0 0 8px', fontSize: '13px', color: '#5A7766' }}>
                    <strong>📅 Dates:</strong> {startDate} - {endDate}
                  </p>
                  <p style={{ margin: '0 0 8px', fontSize: '13px', color: '#5A7766' }}>
                    <strong>👥 Personnes:</strong> {numberOfPeople}
                  </p>
                  {equipmentTotalUnits > 0 && selectedChalet && needsChalet && (
                    <p style={{ margin: 0, fontSize: '13px', color: '#5A7766' }}>
                      <strong>🛶 {t('Équipements', 'Equipment')}:</strong>{' '}
                      {equipmentTotalUnits}{' '}{t('article(s)', 'item(s)')}
                    </p>
                  )}
                </div>

                <button
                  type="button"
                  onClick={resetBookingFlow}
                  style={{
                    width: '100%',
                    padding: '14px 20px',
                    backgroundColor: '#2D5F4C',
                    color: '#FFFCF7',
                    border: 'none',
                    borderRadius: '12px',
                    cursor: 'pointer',
                    fontWeight: '600',
                    fontSize: '15px',
                    marginTop: '12px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {t('Terminer', 'Done')}
                </button>
              </div>
            )}
          </div>
        ) : (
          /* DEFAULT MENU CONTENT */
          <div style={{
            width: '100%',
            flex: '1 1 auto',
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            color: '#1F3A2E'
          }}>
            <div style={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              paddingRight: '2px',
              display: 'flex',
              flexDirection: 'column',
              gap: isMobile ? '10px' : '12px'
            }}>
              <div style={{
                width: '100%',
                paddingBottom: '10px',
                borderBottom: '1px solid rgba(90, 119, 102, 0.24)'
              }}>
                <p style={{
                  margin: 0,
                  fontSize: '11px',
                  letterSpacing: '0.16em',
                  textTransform: 'uppercase',
                  color: '#5A7766',
                  fontWeight: '600'
                }}>
                  Monde Sauvage
                </p>
                <div style={{ marginTop: '8px' }}>
                  {renderLanguageSwitch()}
                </div>
                <h1 style={{
                  margin: '6px 0 0',
                  fontSize: isMobile ? '20px' : isCompactViewport ? '21px' : '26px',
                  lineHeight: 1.1,
                  fontFamily: '"Iowan Old Style", "Palatino Linotype", serif',
                  fontWeight: '600',
                  color: '#173428'
                }}>
                  {t('Carte des aventures', 'Adventure map')}
                </h1>
                <p style={{
                  margin: '4px 0 0',
                  fontSize: isCompactViewport ? '11px' : '12px',
                  color: '#4E695B'
                }}>
                    {t('Séjours et expériences en Gaspésie', 'Trips and experiences in Gaspesie')}
                </p>
              </div>

              <div style={{
                width: '100%',
                padding: isMobile ? '10px 11px 11px' : isCompactViewport ? '10px 12px 11px' : '13px 14px 14px',
                borderRadius: '14px',
                background: 'linear-gradient(145deg, rgba(255, 252, 247, 0.94), rgba(244, 238, 227, 0.96))',
                boxShadow: '0 5px 14px rgba(46, 68, 56, 0.09)'
              }}>
                <h2 style={{
                  margin: 0,
                  fontSize: isMobile ? '16px' : isCompactViewport ? '16px' : '20px',
                  lineHeight: 1.2,
                  fontFamily: '"Iowan Old Style", "Palatino Linotype", serif',
                  color: '#193629'
                }}>
                    {t('Explorez la Gaspésie', 'Explore Gaspesie')}
                </h2>
                <p style={{
                  margin: '4px 0 0',
                  fontSize: isCompactViewport ? '11.5px' : '12.5px',
                  lineHeight: 1.35,
                  color: '#4D685A'
                }}>
                    {t('Réservez un guide, un chalet ou planifiez votre séjour.', 'Book a guide, a chalet, or plan your trip.')}
                </p>
              </div>

              <div style={{
                width: '100%',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px'
              }}>
              <p style={{
                margin: 0,
                fontSize: '11px',
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
                color: '#5A7766',
                fontWeight: '600'
              }}>
                {t('Planification', 'Planning')}
              </p>
              <button
                type="button"
                onClick={() => isTripOpen(true)}
                style={{
                  width: '100%',
                  border: 'none',
                  borderRadius: '14px',
                  padding: isMobile ? '12px 13px' : isCompactViewport ? '11px 12px' : '14px 15px',
                  background: 'linear-gradient(145deg, #214537, #2F5C49)',
                  color: '#FFFCF7',
                  cursor: 'pointer',
                  fontWeight: '600',
                  fontSize: isCompactViewport ? '13px' : '15px',
                  letterSpacing: '0.02em',
                  textAlign: 'left',
                  boxShadow: '0 10px 20px rgba(22, 43, 34, 0.24)',
                  transition: 'transform 0.2s ease, box-shadow 0.2s ease'
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.transform = 'translateY(-1px)';
                  e.currentTarget.style.boxShadow = '0 14px 24px rgba(22, 43, 34, 0.3)';
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 10px 20px rgba(22, 43, 34, 0.24)';
                }}
              >
                {t('Planifiez votre séjour', 'Plan your trip')}
              </button>

              <div style={{
                width: '100%',
                display: 'grid',
                gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
                gap: '8px'
              }}>
                <button
                  type="button"
                  onClick={() => isGuideFlowOpen(true)}
                  style={{
                    width: '100%',
                    border: '1px solid rgba(74, 117, 98, 0.32)',
                    borderRadius: '12px',
                    padding: isMobile ? '9px 10px' : isCompactViewport ? '8px 10px' : '11px',
                    backgroundColor: 'rgba(255, 252, 247, 0.72)',
                    color: '#214337',
                    cursor: 'pointer',
                    fontWeight: '600',
                    fontSize: isCompactViewport ? '12px' : '14px',
                    textAlign: 'left',
                    display: 'flex',
                    alignItems: 'center',
                    gap: isCompactViewport ? '7px' : '10px',
                    transition: 'border-color 0.2s ease, background-color 0.2s ease'
                  }}
                  onMouseOver={(e) => {
                    e.currentTarget.style.backgroundColor = 'rgba(250, 245, 234, 0.9)';
                    e.currentTarget.style.borderColor = '#2D5F4C';
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.backgroundColor = 'rgba(255, 252, 247, 0.72)';
                    e.currentTarget.style.borderColor = 'rgba(74, 117, 98, 0.32)';
                  }}
                >
                  <img
                    src="/fish.png"
                    alt={t('Trouvez un guide', 'Find a guide')}
                    style={{ width: isCompactViewport ? '22px' : '28px', height: isCompactViewport ? '22px' : '28px', flexShrink: 0 }}
                  />
                  <span>{t('Trouvez un guide', 'Find a guide')}</span>
                </button>

                <button
                  type="button"
                  onClick={() => isChaletFlowOpen(true)}
                  style={{
                    width: '100%',
                    border: '1px solid rgba(74, 117, 98, 0.32)',
                    borderRadius: '12px',
                    padding: isMobile ? '9px 10px' : isCompactViewport ? '8px 10px' : '11px',
                    backgroundColor: 'rgba(255, 252, 247, 0.72)',
                    color: '#214337',
                    cursor: 'pointer',
                    fontWeight: '600',
                    fontSize: isCompactViewport ? '12px' : '14px',
                    textAlign: 'left',
                    display: 'flex',
                    alignItems: 'center',
                    gap: isCompactViewport ? '7px' : '10px',
                    transition: 'border-color 0.2s ease, background-color 0.2s ease'
                  }}
                  onMouseOver={(e) => {
                    e.currentTarget.style.backgroundColor = 'rgba(250, 245, 234, 0.9)';
                    e.currentTarget.style.borderColor = '#2D5F4C';
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.backgroundColor = 'rgba(255, 252, 247, 0.72)';
                    e.currentTarget.style.borderColor = 'rgba(74, 117, 98, 0.32)';
                  }}
                >
                  <img
                    src="/chalet.png"
                    alt={t('Réservez un chalet', 'Book a chalet')}
                    style={{ width: isCompactViewport ? '22px' : '28px', height: isCompactViewport ? '22px' : '28px', flexShrink: 0 }}
                  />
                  <span>{t('Réservez un chalet', 'Book a chalet')}</span>
                </button>
              </div>
              </div>

              <div style={{
                width: '100%',
                marginTop: '2px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px'
              }}>
              <p style={{
                margin: 0,
                fontSize: '11px',
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
                color: '#5A7766',
                fontWeight: '600'
              }}>
                {t('Decouvrir', 'Discover')}
              </p>

              {profile?.type === 'admin' && (
                <button
                  type="button"
                  onClick={isSocialFeedOpen}
                  style={{
                    width: '100%',
                    border: '1px solid rgba(74, 117, 98, 0.28)',
                    borderRadius: '12px',
                    padding: isCompactViewport ? '7px 10px' : '10px 13px',
                    backgroundColor: 'rgba(255, 252, 247, 0.68)',
                    color: '#1F3A2E',
                    cursor: 'pointer',
                    fontWeight: '500',
                    fontSize: isCompactViewport ? '12px' : '14px',
                    textAlign: 'left',
                    transition: 'background-color 0.2s ease, border-color 0.2s ease'
                  }}
                  onMouseOver={(e) => {
                    e.currentTarget.style.backgroundColor = 'rgba(245, 238, 225, 0.95)';
                    e.currentTarget.style.borderColor = 'rgba(45, 95, 76, 0.5)';
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.backgroundColor = 'rgba(255, 252, 247, 0.68)';
                    e.currentTarget.style.borderColor = 'rgba(74, 117, 98, 0.28)';
                  }}
                >
                  {t('Section sociale', 'Social feed')}
                </button>
              )}

              {(profile?.type === 'establishment' || profile?.type === 'admin') && (
                <button
                  type="button"
                  onClick={() => isEtablissementOpen(true)}
                  style={{
                    width: '100%',
                    border: '1px solid rgba(74, 117, 98, 0.28)',
                    borderRadius: '12px',
                    padding: isCompactViewport ? '7px 10px' : '10px 13px',
                    backgroundColor: 'rgba(255, 252, 247, 0.68)',
                    color: '#1F3A2E',
                    cursor: 'pointer',
                    fontWeight: '500',
                    fontSize: isCompactViewport ? '12px' : '14px',
                    textAlign: 'left',
                    transition: 'background-color 0.2s ease, border-color 0.2s ease'
                  }}
                  onMouseOver={(e) => {
                    e.currentTarget.style.backgroundColor = 'rgba(245, 238, 225, 0.95)';
                    e.currentTarget.style.borderColor = 'rgba(45, 95, 76, 0.5)';
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.backgroundColor = 'rgba(255, 252, 247, 0.68)';
                    e.currentTarget.style.borderColor = 'rgba(74, 117, 98, 0.28)';
                  }}
                >
                  {t('Etablissement', 'Establishment')}
                </button>
              )}

              <button
                type="button"
                onClick={() => isRejoindreOpen(true)}
                style={{
                  width: '100%',
                  border: '1px solid rgba(74, 117, 98, 0.28)',
                  borderRadius: '12px',
                  padding: isCompactViewport ? '7px 10px' : '10px 13px',
                  backgroundColor: 'rgba(255, 252, 247, 0.68)',
                  color: '#1F3A2E',
                  cursor: 'pointer',
                  fontWeight: '500',
                  fontSize: isCompactViewport ? '12px' : '14px',
                  textAlign: 'left',
                  transition: 'background-color 0.2s ease, border-color 0.2s ease'
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.backgroundColor = 'rgba(245, 238, 225, 0.95)';
                  e.currentTarget.style.borderColor = 'rgba(45, 95, 76, 0.5)';
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.backgroundColor = 'rgba(255, 252, 247, 0.68)';
                  e.currentTarget.style.borderColor = 'rgba(74, 117, 98, 0.28)';
                }}
              >
                {t('Rejoindre Monde Sauvage', 'Join Monde Sauvage')}
              </button>
              </div>
            </div>

            <div style={{
              width: '100%',
              flexShrink: 0,
              marginTop: '8px',
              borderTop: '1px solid rgba(90, 119, 102, 0.24)',
              paddingTop: '10px'
            }}>
              {user && (
                <div style={{
                  borderRadius: '12px',
                  backgroundColor: 'rgba(255, 252, 247, 0.62)',
                  padding: isCompactViewport ? '7px 9px' : '9px 11px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '9px'
                }}>
                  <img
                    src={avatarSrc}
                    alt="Profile"
                    referrerPolicy="no-referrer"
                    onError={handleAvatarError}
                    style={{
                      width: isCompactViewport ? 32 : 40,
                      height: isCompactViewport ? 32 : 40,
                      borderRadius: '50%',
                      border: '2px solid rgba(74, 155, 142, 0.8)',
                      objectFit: 'cover',
                      flexShrink: 0
                    }}
                  />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <p style={{
                      margin: 0,
                      fontWeight: '600',
                      fontSize: '13px',
                      color: '#173428',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    }}>
                      {user.user_metadata?.name || user.user_metadata?.full_name || user.email}
                    </p>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      marginTop: '3px'
                    }}>
                      <button
                        type="button"
                        onClick={isAccountSettingsOpen}
                        data-onboarding="account-settings"
                        style={{
                          padding: 0,
                          backgroundColor: 'transparent',
                          color: '#4D685A',
                          border: 'none',
                          cursor: 'pointer',
                          fontWeight: '500',
                          fontSize: '12px'
                        }}
                        onMouseOver={(e) => { e.currentTarget.style.color = '#2D5F4C'; }}
                        onMouseOut={(e) => { e.currentTarget.style.color = '#4D685A'; }}
                      >
                        {t('Paramètres', 'Settings')}
                      </button>
                      <button
                        type="button"
                        onClick={handleSignOut}
                        style={{
                          padding: 0,
                          backgroundColor: 'transparent',
                          color: '#4D685A',
                          border: 'none',
                          cursor: 'pointer',
                          fontWeight: '500',
                          fontSize: '12px',
                          textDecoration: 'underline'
                        }}
                        onMouseOver={(e) => { e.currentTarget.style.color = '#1F3A2E'; }}
                        onMouseOut={(e) => { e.currentTarget.style.color = '#4D685A'; }}
                      >
                        {t('Se déconnecter', 'Sign out')}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={() => console.log('Nos affiliation clicked')}
                style={{
                  width: '100%',
                  marginTop: user ? '4px' : 0,
                  border: 'none',
                  background: 'transparent',
                  color: '#5A7766',
                  cursor: 'pointer',
                  fontWeight: '500',
                  fontSize: '12px',
                  textAlign: 'left',
                  letterSpacing: '0.02em',
                  padding: '2px 4px'
                }}
                onMouseOver={(e) => { e.currentTarget.style.color = '#2D5F4C'; }}
                onMouseOut={(e) => { e.currentTarget.style.color = '#5A7766'; }}
              >
                {t('Nos affiliations', 'Our partners')}
              </button>
            </div>
          </div>
        )}
        </div>
      </div>

      {/* Carte : occupe tout l’espace à droite du menu — aucune marge beige ni cadre autour de Mapbox */}
      <div style={{
        position: 'relative',
        flex: '1 1 auto',
        minWidth: 0,
        minHeight: 0,
        height: '100%',
        overflow: 'hidden',
      }}
      onMouseEnter={() => setMapHoverInteractions(true)}
      onMouseLeave={() => setMapHoverInteractions(false)}
      >
        <div
          ref={mapContainerRef}
          style={{ position: 'absolute', inset: 0, cursor: mapPickerActive ? 'crosshair' : (bookingStep === 1 ? PIN_DROP_CURSOR : undefined) }}
        />

        {/* Map picker overlay — pointer-events:none so clicks reach Mapbox underneath */}
        {mapPickerActive && bookingStep === 1 && (
          <div style={{
            position: 'absolute',
            inset: 0,
            zIndex: 25,
            pointerEvents: 'none',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '14px',
          }}>
            {/* Pulsing rectangle */}
            <div className="map-picker-pulse" style={{
              position: 'absolute',
              inset: '12px',
              borderRadius: '14px',
              border: '2.5px dashed rgba(45, 95, 76, 0.55)',
              backgroundColor: 'rgba(180, 200, 190, 0.18)',
            }} />

            {/* Center label card */}
            <div style={{
              position: 'relative',
              background: 'rgba(255, 252, 247, 0.96)',
              borderRadius: '14px',
              padding: '14px 20px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '8px',
              border: '1.5px solid rgba(45, 95, 76, 0.35)',
              boxShadow: '0 8px 28px rgba(0,0,0,0.16)',
              maxWidth: '220px',
              textAlign: 'center',
            }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#2D5F4C" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                <circle cx="12" cy="10" r="3"/>
              </svg>
              <span style={{ fontSize: '14px', fontWeight: 700, color: '#1F3A2E', lineHeight: 1.3 }}>
                {t('Touchez la carte pour choisir un point', 'Tap the map to place a pin')}
              </span>
              <span style={{ fontSize: '11px', color: '#5A7766', lineHeight: 1.4 }}>
                {t('Un cercle de recherche apparaîtra', 'A search radius will appear')}
              </span>
            </div>

            {/* Cancel button — needs its own pointer-events */}
            <button
              type="button"
              onClick={() => {
                setMapPickerActive(false);
                mapPickerActiveRef.current = false;
              }}
              style={{
                position: 'relative',
                pointerEvents: 'auto',
                background: 'rgba(255,252,247,0.95)',
                border: '1px solid #D1D5DB',
                borderRadius: '999px',
                padding: '6px 16px',
                fontSize: '12px',
                fontWeight: 600,
                color: '#5A7766',
                cursor: 'pointer',
              }}
            >
              {t('Annuler', 'Cancel')}
            </button>
          </div>
        )}

        {/* River layers are now rendered natively by Mapbox — no HTML SVG overlay */}

        {/* Browse-mode (step 0) river info card — shown on river click */}
        {infoCardRiver && bookingStep === 0 && (
          <RiverInfoCard
            pathId={infoCardRiver}
            language={language}
            onClose={() => {
              setInfoCardRiver(null);
              infoCardRiverRef.current = null;
              if (mapRef.current && typeof mapRef.current._setRiverGlow === "function") {
                mapRef.current._setRiverGlow(null);
              }
            }}
            onBook={() => {
              if (isTripOpen) isTripOpen(true);
            }}
          />
        )}

        {/* Encart rivière — uniquement à l’étape 1 ; masqué aux étapes suivantes sans désélectionner */}
        {selectedRiver && bookingStep === 1 && (
          <RiverInfoCard
            pathId={selectedRiver}
            language={language}
            onClose={() => {
              setSelectedRiver(null);
              if (mapRef.current) {
                mapRef.current._riverSelected = null;
                if (typeof mapRef.current._setRiverGlow === "function") {
                  mapRef.current._setRiverGlow(null);
                }
              }
              if (onSelectRiver) onSelectRiver(null);
            }}
            onBook={() => {
              if (isTripOpen) isTripOpen(true);
            }}
          />
        )}

        {/* Step 3: Preview card on marker click */}
        {step3MarkersActive && s3PreviewItem && s3PreviewPos && (
          <div style={{
            position: 'absolute',
            left: Math.min(Math.max(s3PreviewPos.x - 140, 8), (mapContainerRef.current?.offsetWidth || 600) - 290),
            top: Math.max(s3PreviewPos.y - 320, 8),
            zIndex: 50,
          }}>
            <PreviewCard
              item={s3PreviewItem}
              type={s3PreviewType}
              onClose={s3ClosePreview}
              onSelect={s3PreviewSelect}
              onViewDetails={(item, itemType) => {
                if (itemType === 'chalet' && handleVoirPlus) {
                  handleVoirPlus(item);
                }
              }}
              language={language}
            />
          </div>
        )}

        {/* Step 3: Map legend */}
        {step3MarkersActive && (
          <MapLegend
            language={language}
            hasChalets={chalets.length > 0}
            hasGuides={availableGuides.length > 0}
          />
        )}

        {/* Step 3: Layer toggle (declutters when chalets + guides overlap) */}
        {step3MarkersActive && (chalets.length > 0 || availableGuides.length > 0) && (
          <div
            style={{
              position: 'absolute',
              top: 16,
              left: 52,
              right: 'auto',
              zIndex: 800,
              display: 'flex',
              flexWrap: 'wrap',
              maxWidth: 'calc(100% - 68px)',
              background: 'rgba(255, 252, 247, 0.96)',
              border: '1px solid rgba(15, 23, 42, 0.08)',
              borderRadius: 999,
              padding: 4,
              boxShadow: '0 6px 18px rgba(15, 23, 42, 0.12)',
              gap: 2,
            }}
            role="group"
            aria-label={t('Filtrer la carte', 'Filter the map')}
          >
            {[
              { key: 'all', labelFr: 'Tout', labelEn: 'All', icon: '✦' },
              { key: 'chalets', labelFr: 'Chalets', labelEn: 'Chalets', icon: '🛖' },
              { key: 'guides', labelFr: 'Guides', labelEn: 'Guides', icon: '🎣' },
            ].map((opt) => {
              const active = mapLayerFilter === opt.key;
              return (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setMapLayerFilter(opt.key)}
                  aria-pressed={active}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 999,
                    border: 'none',
                    background: active ? '#2D5F4C' : 'transparent',
                    color: active ? '#FFFCF7' : '#1F3A2E',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    transition: 'background 120ms ease, color 120ms ease',
                  }}
                >
                  <span aria-hidden="true">{opt.icon}</span>
                  <span>{language === 'en' ? opt.labelEn : opt.labelFr}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {mapInitError && (
        <div
          role="alert"
          style={{
            position: 'fixed',
            right: isMobile ? '12px' : '20px',
            bottom: isMobile ? '12px' : '20px',
            left: isMobile ? '12px' : 'auto',
            maxWidth: isMobile ? 'calc(100% - 24px)' : '420px',
            zIndex: 1200,
            background: 'rgba(255, 252, 247, 0.96)',
            border: '1px solid rgba(199, 85, 58, 0.35)',
            color: '#7A2E1D',
            borderRadius: '12px',
            padding: '12px 14px',
            boxShadow: '0 10px 24px rgba(24, 43, 35, 0.18)',
            fontSize: '13px',
            lineHeight: 1.45
          }}
        >
          <div>{mapInitError}</div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '10px', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={handleRetryMapInit}
              style={{
                border: '1px solid rgba(122, 46, 29, 0.45)',
                background: '#fff',
                color: '#7A2E1D',
                borderRadius: '8px',
                padding: '6px 10px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              {t('Reessayer', 'Retry')}
            </button>
            {typeof onOpenHelp === 'function' && (
              <button
                type="button"
                onClick={() => onOpenHelp(false)}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: '#7A2E1D',
                  textDecoration: 'underline',
                  textUnderlineOffset: '2px',
                  padding: '6px 2px',
                  fontSize: '12px',
                  fontWeight: 500,
                  cursor: 'pointer'
                }}
              >
                {t('Ouvrir l\'aide', 'Open help')}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Back to homepage button — always accessible from the map */}
      {onGoHome && (
        <button
          type="button"
          onClick={onGoHome}
          title={t("Retour à l'accueil", 'Back to homepage')}
          style={{
            position: 'fixed',
            top: isMobile ? '16px' : '20px',
            right: isMobile ? '16px' : '24px',
            zIndex: 1001,
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: isMobile ? '9px 12px' : '10px 16px',
            backgroundColor: 'rgba(255, 252, 247, 0.95)',
            color: '#173428',
            border: '1px solid rgba(72, 102, 86, 0.24)',
            borderRadius: '12px',
            cursor: 'pointer',
            fontWeight: '600',
            fontSize: isMobile ? '13px' : '14px',
            boxShadow: '0 4px 12px rgba(45, 95, 76, 0.16)',
          }}
        >
          <span aria-hidden="true">←</span>
          {!isMobile && t('Accueil', 'Home')}
        </button>
      )}

      {/* Login Button - Only shown when not logged in */}
      {!user && (
        <button
          type="button"
          onClick={login}
          style={{
            position: 'fixed',
            top: '20px',
            left: '24px',
            zIndex: 1000,
            padding: '10px 20px',
            backgroundColor: '#2D5F4C',
            color: '#FFFCF7',
            border: '2px solid #4A9B8E',
            borderRadius: '12px',
            cursor: 'pointer',
            fontWeight: '600',
            fontSize: '14px',
            boxShadow: '0 4px 12px rgba(45, 95, 76, 0.2)',
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
          }}
          onMouseOver={(e) => {
            e.target.style.backgroundColor = '#3A7360';
            e.target.style.transform = 'translateY(-2px)';
          }}
          onMouseOut={(e) => {
            e.target.style.backgroundColor = '#2D5F4C';
            e.target.style.transform = 'translateY(0)';
          }}
        >
          {t('Se connecter', 'Sign in')}
        </button>
      )}

      {/* Landscape suggestion overlay — shown once per session on portrait phones */}
      {showLandscapeHint && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 10000,
            background: 'rgba(11, 18, 32, 0.82)',
            backdropFilter: 'blur(6px)',
            WebkitBackdropFilter: 'blur(6px)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '20px',
            padding: '32px 24px',
            fontFamily: '"Avenir Next", "Segoe UI", Roboto, sans-serif',
            animation: 'fadeIn 0.4s ease-out',
          }}
        >
          {/* Rotate icon */}
          <div style={{
            width: '72px',
            height: '72px',
            border: '2px solid rgba(255, 252, 247, 0.5)',
            borderRadius: '16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            animation: 'landscapeRotateHint 2s ease-in-out infinite',
          }}>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#FFFCF7" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="4" y="2" width="16" height="20" rx="2" />
              <path d="M12 18h.01" />
            </svg>
          </div>

          <div style={{ textAlign: 'center', maxWidth: '280px' }}>
            <p style={{
              margin: 0,
              fontSize: '18px',
              fontWeight: '600',
              color: '#FFFCF7',
              lineHeight: 1.3,
            }}>
              {t('Tournez votre appareil', 'Rotate your device')}
            </p>
            <p style={{
              margin: '8px 0 0',
              fontSize: '14px',
              color: 'rgba(255, 252, 247, 0.7)',
              lineHeight: 1.4,
            }}>
              {t('La carte interactive est plus agréable en mode paysage.', 'The interactive map is easier to use in landscape mode.')}
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', width: '100%', maxWidth: '260px', marginTop: '4px' }}>
            <button
              type="button"
              onClick={dismissLandscapeHint}
              style={{
                width: '100%',
                padding: '13px 20px',
                borderRadius: '12px',
                border: 'none',
                background: 'linear-gradient(145deg, #214537, #2F5C49)',
                color: '#FFFCF7',
                fontWeight: '600',
                fontSize: '15px',
                cursor: 'pointer',
                boxShadow: '0 6px 18px rgba(22, 43, 34, 0.35)',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              {t('Continuer en portrait', 'Continue in portrait')}
            </button>
          </div>
        </div>
      )}

      {/* Keyframe for landscape hint rotate animation */}
      {showLandscapeHint && (
        <style>{`
          @keyframes landscapeRotateHint {
            0%, 100% { transform: rotate(0deg); }
            30%, 70% { transform: rotate(-90deg); }
          }
        `}</style>
      )}

      {/* Guide Availability Calendar Modal */}
      <GuideAvailabilityCalendarModal
        guide={selectedGuideForCalendar}
        isOpen={calendarModalOpen}
        onClose={() => {
          setCalendarModalOpen(false);
          setSelectedGuideForCalendar(null);
        }}
        dateRange={startDate && endDate ? { startDate, endDate } : null}
      />

      {/* Client-facing fullscreen slot picker (replaces inline sidebar list) */}
      <GuideSlotPickerModal
        open={slotPickerOpen}
        onClose={() => setSlotPickerOpen(false)}
        onConfirm={() => setSlotPickerOpen(false)}
        guide={selectedGuide}
        events={guideAvailabilityEvents || []}
        loading={loadingGuideAvailability}
        selectedSlots={selectedTimeSlots || []}
        onToggleSlot={(slot) => handleSelectTimeSlot && handleSelectTimeSlot(slot)}
        language={language}
        dateRange={startDate && endDate ? { start: startDate, end: endDate } : null}
        hourlyRate={selectedGuide?.hourly_rate}
      />

      {/* River-flow / tide bottom-sheet drawer (additive environmental layers) */}
      <EnvironmentalDrawer
        selection={envSelection}
        fetchRiverDetail={fetchRiverDetail}
        fetchTideDetail={fetchTideDetail}
        onClose={() => setEnvSelection(null)}
      />
    </div>
  );
};

export default GaspesieMap;