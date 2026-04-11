import { useCallback, useEffect, useRef, useState } from 'react';
import AvatarImage from './AvatarImage.jsx';
import DateRangePicker from './DateRangePicker.jsx';
import supabase from '../utils/supabase.js';
import useAvatarSource from '../utils/useAvatarSource.js';
import { buildRiverGeoJSON } from '../utils/riverPaths.js';

let mapboxAssetsPromise = null;

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
  expandedEstablishments,
  toggleEstablishment,
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
  handleSelectTimeSlot
}) => {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const mapStyleLoaded = useRef(false);

  const [circleCenter, setCircleCenter] = useState(null);
  // Rivers within the current circle radius — shown in sidebar + drives multi-glow.
  const [nearbyRiverIds, setNearbyRiverIds] = useState([]);
  const [mapInitError, setMapInitError] = useState('');
  const [mapInitAttempt, setMapInitAttempt] = useState(0);

  // River overlay (native Mapbox layers).
  // Local state mirrors the map highlight; when in the booking flow we also
  // sync to the parent via `onSelectRiver` so MapApp can use it for chalet search.
  const [selectedRiver, setSelectedRiver] = useState(null);

  // Ref mirror of bookingStep — click handlers registered inside map.on('load')
  // close over the initial value, so we read through a ref instead of the prop.
  const bookingStepRef = useRef(bookingStep);
  useEffect(() => { bookingStepRef.current = bookingStep; }, [bookingStep]);

  // Ref for the river selection callback, same rationale as bookingStepRef.
  const onSelectRiverRef = useRef(onSelectRiver);
  useEffect(() => { onSelectRiverRef.current = onSelectRiver; }, [onSelectRiver]);

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
    // Clear the multi-river glow (single-river or nothing takes over)
    if (typeof map._setRiversGlow === 'function') map._setRiversGlow([]);
  }, [selectedPoint]);

  // Detect if mobile for responsive button sizing
  const [isMobile, setIsMobile] = useState(typeof globalThis !== 'undefined' && globalThis.innerWidth < 768);
  const [mobileSheetExpanded, setMobileSheetExpanded] = useState(false);
  const [expandedGuideId, setExpandedGuideId] = useState(null);
  const [showStep3FlexibleDates, setShowStep3FlexibleDates] = useState(false);
  const [showStep3Filters, setShowStep3Filters] = useState(false);
  const sheetTouchStartY = useRef(0);

  // Auto-expand/collapse mobile sheet with booking flow
  useEffect(() => {
    if (!isMobile) return;
    if (bookingStep > 0) setMobileSheetExpanded(true);
    else setMobileSheetExpanded(false);
  }, [isMobile, bookingStep]);

  // Keep accordion/filter presentation state scoped to the step-3 results surface.
  useEffect(() => {
    if (bookingStep !== 3) {
      setExpandedGuideId(null);
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
  const t = useCallback((frText, enText) => (isEnglish ? enText : frText), [isEnglish]);

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
      setIsMobile(typeof globalThis !== 'undefined' && globalThis.innerWidth < 768);
    };

    if (typeof globalThis !== 'undefined' && globalThis.addEventListener) {
      globalThis.addEventListener('resize', handleResize);
      return () => globalThis.removeEventListener('resize', handleResize);
    }
  }, []);

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
      center: [-66, 49.2],
      maxBounds: gaspBounds
    });

    mapRef.current = map;

    map.addControl(new mapboxgl.NavigationControl());
    map.scrollZoom.disable();

    map.on('load', () => {
      console.log('Map loaded successfully!');
      const mapImage = '/NewMap.png';

      // Add vector source for businesses
      map.addSource('businesses', {
        type: 'vector',
        url: 'mapbox://leochouinard.cmfiagsm01tfl1qo364rq7ye3-71qfa'
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
      
        
      
      
      // Business icon click handler
      map.on('click', 'business-icons', (e) => {
        const feature = e.features[0];
        const properties = feature.properties;

        new mapboxgl.Popup({ offset: 25 })
          .setLngLat(e.lngLat)
          .setHTML(`
            <div style="padding: 15px; font-family: 'Inter', sans-serif;">
              <h3 style="font-size: 1.25rem; font-weight: 600; color: #333; margin: 0 0 10px 0;">
                ${properties.name}
              </h3>
              <p style="font-size: 0.95rem; color: #555; margin-bottom: 15px;">
                ${properties.description || 'No description available'}
              </p>
              ${properties.website ? `
                <a href="${properties.website}" target="_blank" style="
                  text-decoration: none; background: #4f46e5; color: white;
                  padding: 8px 16px; border-radius: 6px; font-weight: 500;
                  display: inline-block;">Visit Website</a>
              ` : ''}
            </div>
          `)
          .addTo(map);
      });

      map.on('mouseenter', 'business-icons', () => {
        map.getCanvas().style.cursor = 'pointer';
      });

      map.on('mouseleave', 'business-icons', () => {
        map.getCanvas().style.cursor = '';
      });

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
        paint: {
          'line-color': 'transparent',
          'line-width': 14,
          'line-cap': 'round',
          'line-join': 'round',
        },
      });

      // Glow stack: outer aura → inner glow → core stroke
      const HOVER_BLUE = '#ff0800';   // brighter blue for hover
      const SELECT_BLUE = '#f34821';  // vivid blue for selected
      const GLOW_OUTER  = '#f66764';  // bright outer aura

      const emptyFilter = ['==', ['get', 'id'], ''];

      // Layer 1 — wide soft outer aura (feathered edges via line-blur)
      map.addLayer({
        id: 'rivers-glow-outer',
        type: 'line',
        source: 'rivers',
        paint: {
          'line-color': GLOW_OUTER,
          'line-width': 24,
          'line-blur': 34,
          'line-opacity': 0.4,
          'line-cap': 'round',
          'line-join': 'round',
        },
        filter: emptyFilter,
      });

      // Layer 2 — tighter inner glow
      map.addLayer({
        id: 'rivers-glow-inner',
        type: 'line',
        source: 'rivers',
        paint: {
          'line-color': HOVER_BLUE,
          'line-width': 14,
          'line-blur': 7,
          'line-opacity': 0.5,
          'line-cap': 'round',
          'line-join': 'round',
        },
        filter: emptyFilter,
      });

      // Layer 3 — crisp core highlight stroke
      map.addLayer({
        id: 'rivers-highlight',
        type: 'line',
        source: 'rivers',
        paint: {
          'line-color': HOVER_BLUE,
          'line-width': 4.5,
          'line-opacity': 0.95,
          'line-cap': 'round',
          'line-join': 'round',
        },
        filter: emptyFilter,
      });

      // Hover cursor
      map.on('mouseenter', 'rivers-hit', () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', 'rivers-hit', () => {
        map.getCanvas().style.cursor = '';
      });

      // Helper: show/hide the glow stack for a given river id (or '' to hide)
      const glowLayers = ['rivers-glow-outer', 'rivers-glow-inner', 'rivers-highlight'];
      const setGlow = (id, color) => {
        const filter = id ? ['==', ['get', 'id'], id] : ['==', ['get', 'id'], ''];
        glowLayers.forEach(layer => map.setFilter(layer, filter));
        if (color) {
          map.setPaintProperty('rivers-glow-outer', 'line-color', color === SELECT_BLUE ? '#64B5F6' : GLOW_OUTER);
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

      // Hover highlight — skip when circle multi-glow is active so we don't
      // replace the multi-filter with a single-id filter on every mousemove.
      map.on('mousemove', 'rivers-hit', (e) => {
        if (map._circleMode) return;
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
        } else {
          setGlow(null);
        }
      });

      // Click to select/deselect.
      // When in booking step 1 (destination), also sync to parent via
      // onSelectRiver so MapApp can anchor chalet search to the river.
      map.on('click', 'rivers-hit', (e) => {
        if (e.features && e.features.length > 0) {
          const id = e.features[0].properties.id;
          const prev = mapRef.current?._riverSelected;
          const isBookingDestinationStep = bookingStepRef.current === 1;

          if (prev === id) {
            mapRef.current._riverSelected = null;
            setSelectedRiver(null);
            setGlow(null);
            if (isBookingDestinationStep && onSelectRiverRef.current) {
              onSelectRiverRef.current(null);
            }
          } else {
            mapRef.current._riverSelected = id;
            setSelectedRiver(id);
            setGlow(id, SELECT_BLUE);
            if (isBookingDestinationStep && onSelectRiverRef.current) {
              onSelectRiverRef.current(id);
            }
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
          background: 'linear-gradient(165deg, #f8f4ea 0%, #f4efe3 48%, #f2ede2 100%)',
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
        } : {
          // NEW FLOW: at step 3 (guides + chalets) the panel goes full screen
          // to give enough room for both guide and chalet cards plus filters.
          position: bookingStep === 3 ? 'fixed' : 'relative',
          top: bookingStep === 3 ? 0 : undefined,
          left: bookingStep === 3 ? 0 : undefined,
          right: bookingStep === 3 ? 0 : undefined,
          bottom: bookingStep === 3 ? 0 : undefined,
          flex: bookingStep === 3 ? 'none' : '0 0 clamp(300px, 30vw, 420px)',
          width: bookingStep === 3 ? '100vw' : 'clamp(300px, 30vw, 420px)',
          maxWidth: '100%',
          height: '100%',
          minHeight: 0,
          background: 'linear-gradient(165deg, #f8f4ea 0%, #f4efe3 48%, #f2ede2 100%)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-start',
          alignItems: 'center',
          gap: '0',
          boxSizing: 'border-box',
          padding: 'clamp(14px, 3vh, 30px) clamp(12px, 2vw, 24px) clamp(12px, 2.2vh, 22px)',
          boxShadow: '6px 0 26px rgba(31, 58, 46, 0.14)',
          borderRight: '1px solid rgba(72, 102, 86, 0.16)',
          zIndex: bookingStep === 3 ? 600 : 100,
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
          <div style={{ width: '100%', flex: '1 1 auto', minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '20px', paddingRight: '2px' }}>
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
                fontSize: '18px', 
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

            {/* Progress indicator */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
              {[1, 2, 3, 4].map((step) => (
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
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '16px', color: '#1F3A2E' }}>
                      1. {t('Votre destination', 'Your destination')}
                    </h3>
                    <p style={{ fontSize: '12px', color: '#5A7766', margin: '4px 0 0', lineHeight: 1.5 }}>
                      {t(
                        'Optionnel — choisissez une rivière, cherchez-en une ou cliquez sur la carte.',
                        'Optional — pick a river, search for one, or click the map.'
                      )}
                    </p>
                  </div>

                  {/* Unified picker card */}
                  <div style={{
                    padding: '12px',
                    backgroundColor: '#FFFCF7',
                    borderRadius: '12px',
                    border: '1px solid #E5E7EB',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px',
                  }}>
                    {/* Searchable river dropdown */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label style={{
                        fontSize: '11px',
                        color: '#5A7766',
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                      }}>
                        🔍 {t('Rechercher une rivière', 'Search a river')}
                      </label>
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
                          width: '100%',
                          padding: '10px 12px',
                          borderRadius: '8px',
                          border: '1.5px solid #D1D5DB',
                          backgroundColor: '#FFFFFF',
                          fontSize: '14px',
                          color: '#1F3A2E',
                          cursor: 'pointer',
                          appearance: 'none',
                          backgroundImage: 'url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 12 12\'><path fill=\'%235A7766\' d=\'M2 4l4 4 4-4\'/></svg>")',
                          backgroundRepeat: 'no-repeat',
                          backgroundPosition: 'right 12px center',
                          paddingRight: '34px',
                        }}
                      >
                        <option value="">
                          {t('— Toutes les rivières —', '— All rivers —')}
                        </option>
                        {[...knownRivers].sort((a, b) => a.localeCompare(b)).map((id) => (
                          <option key={id} value={id}>
                            {formatRiverName ? formatRiverName(id) : `Rivière ${id}`}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* OR divider */}
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

                    {/* Map interaction hint */}
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      fontSize: '12px',
                      color: '#2D5F4C',
                      backgroundColor: 'rgba(74, 155, 142, 0.1)',
                      border: '1px dashed #4A9B8E',
                      borderRadius: '8px',
                      padding: '10px 12px',
                    }}>
                      <span style={{ fontSize: '18px' }}>🗺️</span>
                      <span style={{ lineHeight: 1.4 }}>
                        {t(
                          'Cliquez sur une rivière ou sur un point de la carte',
                          'Click a river or a point on the map'
                        )}
                      </span>
                    </div>
                  </div>

                  {/* Current selection — adaptive card (river OR point) */}
                  <div style={{
                    padding: '12px',
                    backgroundColor: hasSelection ? 'rgba(45, 95, 76, 0.08)' : 'transparent',
                    border: hasSelection ? '1px solid #2D5F4C' : '1px dashed #D1D5DB',
                    borderRadius: '12px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: (hasPoint || hasRiver) ? '10px' : '0',
                  }}>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '10px',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                        <span style={{ fontSize: '20px' }}>
                          {hasRiver ? '🌊' : hasPoint ? '📍' : '✨'}
                        </span>
                        <div style={{ minWidth: 0 }}>
                          <div style={{
                            fontSize: '13px',
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
                          <div style={{ fontSize: '11px', color: '#5A7766', marginTop: '2px' }}>
                            {hasRiver
                              ? (selectedRiverDetails?.description || t('Recherche autour de cette rivière', 'Search around this river'))
                              : hasPoint
                              ? t('Zone circulaire', 'Circular area')
                              : t('Toute la Gaspésie sera explorée', 'Browsing all of Gaspésie')}
                          </div>
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
                      padding: '14px 20px',
                      backgroundColor: '#2D5F4C',
                      color: '#FFFCF7',
                      border: 'none',
                      borderRadius: '12px',
                      cursor: 'pointer',
                      fontWeight: '600',
                      fontSize: '15px',
                      marginTop: '4px',
                    }}
                  >
                    {t('Continuer →', 'Continue →')}
                  </button>
                </div>
              );
            })()}

            {/* Step 2: Dates (NEW FLOW) */}
            {bookingStep === 2 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <h3 style={{ margin: 0, fontSize: '16px', color: '#1F3A2E' }}>
                  2. {t('Vos dates', 'Your dates')}
                </h3>

                <p style={{ fontSize: '13px', color: '#5A7766', margin: 0, lineHeight: 1.5 }}>
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

                <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                  <button
                    type="button"
                    onClick={() => setBookingStep(1)}
                    style={{
                      flex: 1,
                      padding: '14px',
                      backgroundColor: 'transparent',
                      color: '#5A7766',
                      border: '1.5px solid #5A7766',
                      borderRadius: '12px',
                      cursor: 'pointer',
                      fontWeight: '500',
                      fontSize: '14px',
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
                      padding: '14px',
                      backgroundColor: canProceedStep2 ? '#2D5F4C' : '#9CA3AF',
                      color: '#FFFCF7',
                      border: 'none',
                      borderRadius: '12px',
                      cursor: canProceedStep2 ? 'pointer' : 'not-allowed',
                      fontWeight: '600',
                      fontSize: '14px',
                    }}
                  >
                    {t('Continuer →', 'Continue →')}
                  </button>
                </div>
              </div>
            )}

            {/* Step 3: Guides + Chalets (NEW FLOW — full-screen overlay) */}
            {bookingStep === 3 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', flex: 1, minHeight: 0, overflow: 'hidden' }}>
                <h3 style={{ margin: 0, fontSize: '16px', color: '#1F3A2E', flexShrink: 0 }}>
                  3. {browseMode === 'guide'
                    ? t('Sélectionnez un guide', 'Select a guide')
                    : browseMode === 'chalet'
                    ? t('Sélectionnez un chalet', 'Select a chalet')
                    : t('Sélectionnez guide et hébergement', 'Select guide and accommodation')}
                </h3>

                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  padding: '10px 12px',
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
                      <p style={{ margin: '2px 0 0', fontSize: '13px', fontWeight: 700, color: '#1F3A2E' }}>
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
                  gap: '8px',
                  padding: '9px 10px',
                  backgroundColor: 'rgba(45, 95, 76, 0.03)',
                  borderRadius: '10px',
                  border: '1px solid #E6ECE9',
                  flexShrink: 0,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                    <p style={{ margin: 0, fontSize: '12px', color: '#355446', fontWeight: 600 }}>
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
                  overflow: 'hidden',
                  display: 'grid',
                  gridTemplateColumns: (!isMobile && needsChalet && browseMode !== 'chalet') ? 'minmax(0, 1fr) minmax(0, 1fr)' : '1fr',
                  gap: '12px',
                }}>
                  {/* GUIDE SECTION - hidden in chalet-only mode */}
                  {browseMode !== 'chalet' && (
                  <div style={{ 
                    minHeight: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    border: '1px solid #E3EAE6',
                    borderRadius: '10px',
                    backgroundColor: '#FFFCF7',
                    padding: '10px'
                  }}>
                    <h4 style={{ margin: '0 0 10px', fontSize: '14px', color: '#1F3A2E', fontWeight: '600' }}>
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
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minHeight: 0, overflowY: 'auto', paddingRight: '2px' }}>
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

                      {/* Guide list — compact rows, details only on expand */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {[...availableGuides]
                          .sort((a, b) => (b.is_available === true) - (a.is_available === true))
                          .map((guide) => {
                            const isGuideSelected = selectedGuide?.guide_id === guide.guide_id;
                            const isGuideExpanded = expandedGuideId === guide.guide_id;
                            const isAvailable = guide.is_available !== false;

                            return (
                              <div
                                key={guide.guide_id}
                                style={{
                                  padding: '7px 8px',
                                  backgroundColor: isGuideSelected ? 'rgba(45, 95, 76, 0.1)' : '#FFFCF7',
                                  borderRadius: '8px',
                                  border: isGuideSelected ? '1.5px solid #2D5F4C' : '1px solid #E1E7E3',
                                  opacity: isAvailable ? 1 : 0.7,
                                }}
                              >
                                <div
                                  onClick={() => {
                                    setExpandedGuideId((prev) => prev === guide.guide_id ? null : guide.guide_id);
                                    if (isAvailable && !isGuideSelected) {
                                      handleSelectGuide(guide);
                                    }
                                  }}
                                  style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}
                                >
                                  <AvatarImage
                                    src={guide.avatarSrc}
                                    name={guide.name || 'Guide'}
                                    alt={guide.name || 'Guide'}
                                    imgStyle={{
                                      width: '32px',
                                      height: '32px',
                                      borderRadius: '50%',
                                      objectFit: 'cover',
                                      border: '1px solid rgba(74, 155, 142, 0.35)',
                                    }}
                                    fallbackStyle={{
                                      width: '32px',
                                      height: '32px',
                                      borderRadius: '50%',
                                      backgroundColor: '#4A9B8E',
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      color: 'white',
                                      fontWeight: '600',
                                      fontSize: '12px',
                                    }}
                                    fallback="GU"
                                  />
                                  <div style={{ flex: 1 }}>
                                    <p style={{ margin: 0, fontWeight: '600', fontSize: '12px', color: '#1F3A2E' }}>
                                      {guide.name}
                                      {!isAvailable && (
                                        <span style={{
                                          marginLeft: 6,
                                          fontSize: 10,
                                          padding: '2px 6px',
                                          borderRadius: 4,
                                          backgroundColor: 'rgba(245, 158, 11, 0.2)',
                                          color: '#D97706',
                                          fontWeight: 500,
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
                                  </div>

                                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    {isAvailable && (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          if (isGuideSelected) {
                                            handleSelectGuide(null);
                                            if (isGuideExpanded) setExpandedGuideId(null);
                                          } else {
                                            handleSelectGuide(guide);
                                            setExpandedGuideId(guide.guide_id);
                                          }
                                        }}
                                        style={{
                                          border: isGuideSelected ? '1px solid #2D5F4C' : '1px solid #C5D2CB',
                                          backgroundColor: isGuideSelected ? '#2D5F4C' : '#FFFCF7',
                                          color: isGuideSelected ? '#FFFCF7' : '#2D5F4C',
                                          borderRadius: '999px',
                                          padding: '4px 9px',
                                          fontSize: '11px',
                                          fontWeight: 600,
                                          cursor: 'pointer',
                                        }}
                                      >
                                        {isGuideSelected ? t('Choisi', 'Selected') : t('Choisir', 'Select')}
                                      </button>
                                    )}

                                    <span style={{ fontSize: '14px', color: '#5A7766', lineHeight: 1 }}>
                                      {isGuideExpanded ? '▾' : '▸'}
                                    </span>
                                  </div>
                                </div>

                                {isGuideExpanded && (
                                  <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid #E8ECEA' }}>
                                    {!isAvailable && (
                                      <div style={{
                                        padding: '8px 10px',
                                        backgroundColor: 'rgba(245, 158, 11, 0.08)',
                                        borderRadius: '7px',
                                        color: '#B45309',
                                        fontSize: '11px'
                                      }}>
                                        {t('Ce guide n\'est pas disponible pour la plage de dates active.', 'This guide is unavailable for the active date range.')}
                                      </div>
                                    )}

                                    {isAvailable && (
                                      <p style={{ fontSize: '11px', color: '#5A7766', margin: '0 0 6px' }}>
                                        {t('Disponibilités pour vos dates actives', 'Availability for your active dates')}
                                      </p>
                                    )}

                                    {!isGuideSelected && (
                                      <div style={{
                                        padding: '7px 9px',
                                        borderRadius: '6px',
                                        border: '1px solid #E3EAE6',
                                        backgroundColor: '#FCFDFC',
                                        fontSize: '11px',
                                        color: '#5A7766',
                                      }}>
                                        {t('Sélectionnez ce guide pour charger et choisir des créneaux.', 'Select this guide to load and choose time slots.')}
                                      </div>
                                    )}

                                    {isGuideSelected && (loadingGuideAvailability ? (
                                      <div style={{ textAlign: 'center', padding: '10px', color: '#5A7766', fontSize: '12px' }}>
                                        {t('Chargement des disponibilités...', 'Loading availability...')}
                                      </div>
                                    ) : guideAvailabilityEvents && guideAvailabilityEvents.length > 0 ? (
                                      <div style={{ maxHeight: '170px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                        {(() => {
                                          const eventsByDate = guideAvailabilityEvents.reduce((acc, event) => {
                                            const date = event.date || (event.start ? event.start.split('T')[0] : 'unknown');
                                            if (!acc[date]) acc[date] = [];
                                            acc[date].push(event);
                                            return acc;
                                          }, {});

                                          return Object.entries(eventsByDate).map(([date, events]) => (
                                            <div key={date} style={{ marginBottom: '4px' }}>
                                              <div style={{
                                                fontSize: '10px',
                                                fontWeight: '600',
                                                color: '#1F3A2E',
                                                marginBottom: '3px',
                                                padding: '3px 7px',
                                                backgroundColor: 'rgba(45, 95, 76, 0.06)',
                                                borderRadius: '4px'
                                              }}>
                                                {new Date(date + 'T00:00:00').toLocaleDateString(uiLocale, {
                                                  weekday: 'short',
                                                  day: 'numeric',
                                                  month: 'short'
                                                })}
                                              </div>
                                              {events.map((event) => {
                                                const isSelected = selectedTimeSlots?.some(slot => slot.id === event.id);
                                                const startTime = event.start ? new Date(event.start).toLocaleTimeString(uiLocale, { hour: '2-digit', minute: '2-digit' }) : '';
                                                const endTime = event.end ? new Date(event.end).toLocaleTimeString(uiLocale, { hour: '2-digit', minute: '2-digit' }) : '';

                                                return (
                                                  <div
                                                    key={event.id}
                                                    onClick={() => handleSelectTimeSlot && handleSelectTimeSlot(event)}
                                                    style={{
                                                      padding: '6px 8px',
                                                      backgroundColor: isSelected ? 'rgba(34, 197, 94, 0.15)' : '#FFFCF7',
                                                      borderRadius: '5px',
                                                      border: isSelected ? '1.5px solid #22C55E' : '1px solid #E5E7EB',
                                                      cursor: 'pointer',
                                                      display: 'flex',
                                                      alignItems: 'center',
                                                      gap: '7px',
                                                      marginBottom: '3px',
                                                    }}
                                                  >
                                                    <span style={{ fontSize: '14px', opacity: isSelected ? 1 : 0.45 }}>
                                                      {isSelected ? '✓' : '○'}
                                                    </span>
                                                    <p style={{ margin: 0, fontSize: '11px', fontWeight: '500', color: '#1F3A2E' }}>
                                                      {startTime} - {endTime}
                                                    </p>
                                                  </div>
                                                );
                                              })}
                                            </div>
                                          ));
                                        })()}
                                      </div>
                                    ) : (
                                      <div style={{
                                        padding: '10px',
                                        backgroundColor: 'rgba(245, 158, 11, 0.1)',
                                        borderRadius: '8px',
                                        color: '#D97706',
                                        fontSize: '11px',
                                        textAlign: 'center'
                                      }}>
                                        {t('Aucun créneau disponible pour cette période.', 'No slots available for this range.')}
                                      </div>
                                    ))}
                                  </div>
                                )}
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
                    minHeight: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    border: '1px solid #E3EAE6',
                    borderRadius: '10px',
                    backgroundColor: '#FFFCF7',
                    padding: '10px'
                  }}>
                    <h4 style={{ margin: '0 0 8px', fontSize: '14px', color: '#1F3A2E', fontWeight: '600' }}>
                      {t('Chalets disponibles', 'Available chalets')}
                    </h4>

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
                      <div style={{ minHeight: 0, overflowY: 'auto', paddingRight: '2px' }}>
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
                            {t('Aucun chalet trouvé pour ces dates à proximité.', 'No chalet found nearby for these dates.')}
                          </div>
                        )}

                        {!loadingChalets && !chaletError && chalets.length > 0 && (() => {
                          // Helper function to check if a chalet fits the Step 1 criteria
                          const chaletFitsCriteria = (chalet) => {
                            if (chalet.nb_personnes && numberOfPeople > chalet.nb_personnes) {
                              return false;
                            }
                            return true;
                          };

                          // Group chalets by establishment
                          const chaletsByEstablishment = chalets.reduce((acc, chalet) => {
                            const estId = chalet.etablishment_id || 'no-establishment';
                            const estName = chalet.etablishment_name || t('Sans établissement', 'No establishment');
                            
                            if (!acc[estId]) {
                              acc[estId] = { id: estId, name: estName, chalets: [] };
                            }
                            acc[estId].chalets.push({ ...chalet, fitsCriteria: chaletFitsCriteria(chalet) });
                            return acc;
                          }, {});

                          const establishmentGroups = Object.values(chaletsByEstablishment);

                          return (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                              {establishmentGroups.map((establishment) => (
                                <div 
                                  key={establishment.id} 
                                  style={{
                                    backgroundColor: '#FFFCF7',
                                    borderRadius: '8px',
                                    border: '1px solid #E5E7EB',
                                    overflow: 'hidden'
                                  }}
                                >
                                  {/* Establishment header */}
                                  <div 
                                    onClick={() => toggleEstablishment(establishment.id)}
                                    style={{
                                      padding: '10px',
                                      backgroundColor: 'rgba(45, 95, 76, 0.05)',
                                      cursor: 'pointer',
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '6px',
                                      borderBottom: expandedEstablishments.has(establishment.id) ? '1px solid #E5E7EB' : 'none'
                                    }}
                                  >
                                    <span style={{ fontSize: '10px', color: '#5A7766' }}>
                                      {expandedEstablishments.has(establishment.id) ? '▼' : '▶'}
                                    </span>
                                    <span style={{ fontWeight: '600', fontSize: '12px', color: '#1F3A2E', flex: 1 }}>
                                      {establishment.name}
                                    </span>
                                    <span style={{ fontSize: '11px', color: '#5A7766' }}>
                                      ({establishment.chalets.length})
                                    </span>
                                  </div>

                                  {/* Chalets list */}
                                  {expandedEstablishments.has(establishment.id) && (
                                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                                      {establishment.chalets.map((chalet, index) => (
                                        <div 
                                          key={chalet.id || index}
                                          onClick={() => handleSelectedChalet({ id: chalet.key || chalet.id, name: chalet.Name, ...chalet })}
                                          style={{
                                            padding: '10px',
                                            borderBottom: index < establishment.chalets.length - 1 ? '1px solid #F3F4F6' : 'none',
                                            backgroundColor: selectedChalet?.id === (chalet.key || chalet.id) 
                                              ? 'rgba(45, 95, 76, 0.15)' 
                                              : (chalet.fitsCriteria ? 'rgba(45, 95, 76, 0.05)' : 'transparent'),
                                            opacity: chalet.fitsCriteria ? 1 : 0.6,
                                            borderLeft: selectedChalet?.id === (chalet.key || chalet.id)
                                              ? '3px solid #2D5F4C'
                                              : (chalet.fitsCriteria ? '3px solid #4A9B8E' : '3px solid transparent'),
                                            cursor: 'pointer'
                                          }}
                                        >
                                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            {chalet.Image && (
                                              <img 
                                                src={chalet.Image} 
                                                alt={chalet.Name}
                                                style={{
                                                  width: '40px',
                                                  height: '40px',
                                                  borderRadius: '4px',
                                                  objectFit: 'cover'
                                                }}
                                              />
                                            )}
                                            <div style={{ flex: 1 }}>
                                              <p style={{ margin: 0, fontWeight: '600', fontSize: '12px', color: '#1F3A2E' }}>
                                                {chalet.Name}
                                              </p>
                                              <p style={{ margin: '2px 0 0', fontSize: '11px', color: '#5A7766' }}>
                                                {chalet.nb_personnes} {t('pers.', 'people')} {chalet.price && `• ${chalet.price}$/${t('nuit', 'night')}`}
                                              </p>
                                            </div>
                                            {selectedChalet?.id === (chalet.key || chalet.id) && (
                                              <span style={{ color: '#2D5F4C', fontWeight: 'bold' }}>✓</span>
                                            )}
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              ))}
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

                {/* Navigation buttons: Back → step 2 | Reserve → handleBookGuide → step 4 */}
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
                    }}
                  >
                    {t('← Retour', '← Back')}
                  </button>
                  <button
                    type="button"
                    onClick={handleBookGuide}
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
                      t('Réserver →', 'Book →')
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Step 4: Confirmation */}
            {bookingStep === 4 && (
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
                    <p style={{ margin: '0 0 8px', fontSize: '13px', color: '#5A7766' }}>
                      <strong>🏠 Chalet:</strong> {selectedChalet?.name}
                    </p>
                  )}
                  <p style={{ margin: '0 0 8px', fontSize: '13px', color: '#5A7766' }}>
                    <strong>📅 Dates:</strong> {startDate} - {endDate}
                  </p>
                  <p style={{ margin: 0, fontSize: '13px', color: '#5A7766' }}>
                    <strong>👥 Personnes:</strong> {numberOfPeople}
                  </p>
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
                    marginTop: '12px'
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
                  fontSize: isMobile ? '22px' : '26px',
                  lineHeight: 1.1,
                  fontFamily: '"Iowan Old Style", "Palatino Linotype", serif',
                  fontWeight: '600',
                  color: '#173428'
                }}>
                  {t('Carte des aventures', 'Adventure map')}
                </h1>
                <p style={{
                  margin: '4px 0 0',
                  fontSize: '12px',
                  color: '#4E695B'
                }}>
                    {t('Séjours et expériences en Gaspésie', 'Trips and experiences in Gaspesie')}
                </p>
              </div>

              <div style={{
                width: '100%',
                padding: isMobile ? '12px 12px 13px' : '13px 14px 14px',
                borderRadius: '14px',
                background: 'linear-gradient(145deg, rgba(255, 252, 247, 0.94), rgba(244, 238, 227, 0.96))',
                boxShadow: '0 5px 14px rgba(46, 68, 56, 0.09)'
              }}>
                <h2 style={{
                  margin: 0,
                  fontSize: isMobile ? '18px' : '20px',
                  lineHeight: 1.2,
                  fontFamily: '"Iowan Old Style", "Palatino Linotype", serif',
                  color: '#193629'
                }}>
                    {t('Explorez la Gaspésie', 'Explore Gaspesie')}
                </h2>
                <p style={{
                  margin: '6px 0 0',
                  fontSize: '12.5px',
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
                  padding: isMobile ? '13px 13px' : '14px 15px',
                  background: 'linear-gradient(145deg, #214537, #2F5C49)',
                  color: '#FFFCF7',
                  cursor: 'pointer',
                  fontWeight: '600',
                  fontSize: '15px',
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
                    padding: isMobile ? '10px 11px' : '11px',
                    backgroundColor: 'rgba(255, 252, 247, 0.72)',
                    color: '#214337',
                    cursor: 'pointer',
                    fontWeight: '600',
                    fontSize: '14px',
                    textAlign: 'left',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
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
                    style={{ width: '28px', height: '28px', flexShrink: 0 }}
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
                    padding: isMobile ? '10px 11px' : '11px',
                    backgroundColor: 'rgba(255, 252, 247, 0.72)',
                    color: '#214337',
                    cursor: 'pointer',
                    fontWeight: '600',
                    fontSize: '14px',
                    textAlign: 'left',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
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
                    style={{ width: '28px', height: '28px', flexShrink: 0 }}
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

              <button
                type="button"
                onClick={isSocialFeedOpen}
                style={{
                  width: '100%',
                  border: '1px solid rgba(74, 117, 98, 0.28)',
                  borderRadius: '12px',
                  padding: '10px 13px',
                  backgroundColor: 'rgba(255, 252, 247, 0.68)',
                  color: '#1F3A2E',
                  cursor: 'pointer',
                  fontWeight: '500',
                  fontSize: '14px',
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

              {(profile?.type === 'establishment' || profile?.type === 'admin') && (
                <button
                  type="button"
                  onClick={() => isEtablissementOpen(true)}
                  style={{
                    width: '100%',
                    border: '1px solid rgba(74, 117, 98, 0.28)',
                    borderRadius: '12px',
                    padding: '10px 13px',
                    backgroundColor: 'rgba(255, 252, 247, 0.68)',
                    color: '#1F3A2E',
                    cursor: 'pointer',
                    fontWeight: '500',
                    fontSize: '14px',
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
                  padding: '10px 13px',
                  backgroundColor: 'rgba(255, 252, 247, 0.68)',
                  color: '#1F3A2E',
                  cursor: 'pointer',
                  fontWeight: '500',
                  fontSize: '14px',
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
                  padding: '9px 11px',
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
                      width: 40,
                      height: 40,
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

      {/* Map Container - 80% */}
      <div style={{
        position: 'relative',
        flex: '1 1 auto',
        minWidth: 0,
        height: '100%',
        overflow: 'hidden',
      }}>
        <div
          ref={mapContainerRef}
          style={{ position: 'absolute', inset: 0 }}
        />

        {/* River layers are now rendered natively by Mapbox — no HTML SVG overlay */}

        {/* Selected river info box */}
        {selectedRiver && (
          (() => {
            const selectedRiverMeta = getRiverDetails ? getRiverDetails(selectedRiver) : null;
            const title = formatRiverName ? formatRiverName(selectedRiver) : selectedRiver;
            const subtitle = selectedRiverMeta?.description || 'Zone de peche selectionnee';
            return (
          <div style={{
            position: 'absolute',
            top: 12,
            right: 12,
            zIndex: 20,
            background: 'rgba(255,252,247,0.96)',
            border: '1px solid rgba(33,150,243,0.35)',
            borderRadius: 10,
            padding: '10px 16px',
            fontSize: 13,
            color: '#1a3a2a',
            boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
            minWidth: 140,
          }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              {title}
            </div>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 6, lineHeight: 1.35 }}>
              {subtitle}
            </div>
            <button
              type="button"
              onClick={() => {
                setSelectedRiver(null);
                mapRef.current._riverSelected = null;
                const map = mapRef.current;
                if (map) {
                  const hide = ['==', ['get', 'id'], ''];
                  ['rivers-glow-outer', 'rivers-glow-inner', 'rivers-highlight'].forEach(l => {
                    if (map.getLayer(l)) map.setFilter(l, hide);
                  });
                }
              }}
              style={{
                background: 'none',
                border: '1px solid #ccc',
                borderRadius: 6,
                padding: '3px 10px',
                cursor: 'pointer',
                fontSize: 12,
                color: '#555',
              }}
            >Fermer</button>
          </div>
            );
          })()
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
    </div>
  );
};

export default GaspesieMap;