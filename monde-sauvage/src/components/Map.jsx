import { useEffect, useRef, useState } from 'react';
import AvatarImage from './AvatarImage.jsx';
import supabase from '../utils/supabase.js';
import useAvatarSource from '../utils/useAvatarSource.js';

const GaspesieMap = ({ 
  onClick, 
  login, 
  user, 
  profile, 
  guide: _guide,
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
  numberOfPeople,
  setNumberOfPeople,
  setRadius,
  selectedChalet,
  availableGuides,
  loadingGuides,
  selectedGuide,
  selectedGuideEvent: _selectedGuideEvent,
  handleSelectGuideEvent: _handleSelectGuideEvent,
  handleSelectGuide,
  handleBookGuide,
  resetBookingFlow,
  canProceedStep1,
  canProceedStep2,
  canProceedStep3,
  // Chalet search props for Step 2
  chalets,
  loadingChalets,
  chaletError,
  expandedEstablishments,
  toggleEstablishment,
  handleVoirPlus: _handleVoirPlus,
  handleSelectedChalet,
  selectedPoint,
  // NEW: Step 1 preferences props
  fishType,
  setFishType,
  needsChalet,
  setNeedsChalet,
  fishingZones,
  loadingZones,
  FISH_TYPES,
  proceedToStep3,
  // NEW: Step 3 date conflict props
  dateConflicts,
  checkingAvailability,
  // NEW: Booking creation state
  isCreatingBooking,
  bookingError,
  // Help/onboarding
  onOpenHelp: _onOpenHelp,
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

  // Detect if mobile for responsive button sizing
  const [isMobile, setIsMobile] = useState(typeof globalThis !== 'undefined' && globalThis.innerWidth < 768);

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

  // First useEffect - Initialize map
  useEffect(() => {
    if (mapRef.current) return;

    if (mapContainerRef.current) {
      mapContainerRef.current.innerHTML = '';
    }

    const link = document.createElement('link');
    link.href = 'https://api.mapbox.com/mapbox-gl-js/v3.15.0/mapbox-gl.css';
    link.rel = 'stylesheet';
    document.head.appendChild(link);

    const script = document.createElement('script');
    script.src = 'https://api.mapbox.com/mapbox-gl-js/v3.15.0/mapbox-gl.js';
    script.async = true;

    script.onload = () => {
      if (!mapRef.current) {
        initializeMap();
      }
    };

    document.head.appendChild(script);

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      if (document.head.contains(link)) {
        document.head.removeChild(link);
      }
      if (document.head.contains(script)) {
        document.head.removeChild(script);
      }
    };
  }, []);
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

  // Second useEffect - Handle map clicks for chalet search in step 2
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const handleClick = (e) => {
      // ✅ only runs if in step 2 (chalet selection)
      if (bookingStep !== 2) return;

      onClick(e);
      console.log('Map clicked while in step 2');
      setCircleCenter(e);
      drawCircle(map, e.lngLat, radius);
    };

    if (bookingStep === 2) {
      console.log('🟢 Attaching click listener for circle (step 2)');
      map.on('click', handleClick);
    } else {
      if (map.getLayer('circle-outline')) map.removeLayer('circle-outline');
      if (map.getLayer('circle')) map.removeLayer('circle');
      if (map.getSource('circle-source')) map.removeSource('circle-source');
      setCircleCenter(null); // Reset circle center when leaving step 2
    }

    return () => {
      console.log('🔴 Detaching click listener');
      map.off('click', handleClick);
    };
  }, [bookingStep, onClick, radius]);

  // Third useEffect - Redraw circle when radius changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !circleCenter || bookingStep !== 2) return;

    console.log('🔄 Redrawing circle with new radius:', radius);
    drawCircle(map, circleCenter.lngLat, radius);
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

  const initializeMap = () => {
    const mapboxgl = globalThis.mapboxgl;
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
          if (error) throw error;
          map.addImage(logo.id, image);
        });
      });
      
      map.loadImage('https://i.ibb.co/tpNkVbKw/location.png', (error, image) => {
        if (error) throw error;
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

      console.log('All layers added successfully!');
    });
  };

  return (
    <div style={{ 
      position: 'fixed',
      display: 'flex',
      flexDirection: isMobile ? 'column' : 'row',
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
      {/* Left Menu Panel - 20% */}
      <div style={{
        position: 'relative',
        flex: isMobile ? '0 0 min(52dvh, 460px)' : '0 0 clamp(300px, 30vw, 420px)',
        width: isMobile ? '100%' : 'clamp(300px, 30vw, 420px)',
        maxWidth: '100%',
        height: isMobile ? 'min(52dvh, 460px)' : '100%',
        minHeight: 0,
        background: 'linear-gradient(165deg, #f8f4ea 0%, #f4efe3 48%, #f2ede2 100%)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-start',
        alignItems: 'center',
        gap: '0',
        boxSizing: 'border-box',
        padding: isMobile
          ? 'clamp(10px, 2vh, 16px) clamp(12px, 3vw, 16px) clamp(10px, 2vh, 16px)'
          : 'clamp(14px, 3vh, 30px) clamp(12px, 2vw, 24px) clamp(12px, 2.2vh, 22px)',
        boxShadow: '6px 0 26px rgba(31, 58, 46, 0.14)',
        borderRight: '1px solid rgba(72, 102, 86, 0.16)',
        zIndex: 100,
        fontFamily: '"Avenir Next", "Segoe UI", Roboto, sans-serif',
        overflow: 'hidden'
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
                {browseMode === 'guide' ? 'Trouver un guide' : browseMode === 'chalet' ? 'Trouver un chalet' : 'Planifier votre séjour'}
              </h2>
              
              {/* Close button - visible and accessible */}
              <button
                type="button"
                onClick={resetBookingFlow}
                aria-label="Fermer et retourner au menu principal"
                title="Fermer (Échap)"
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

            {/* Step 1: Trip Preferences (NEW FLOW) */}
            {bookingStep === 1 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <h3 style={{ margin: 0, fontSize: '16px', color: '#1F3A2E' }}>
                  1. {browseMode === 'guide' ? 'Préférences de guide' : browseMode === 'chalet' ? 'Préférences d\'hébergement' : 'Préférences de voyage'}
                </h3>
                
                {/* Number of people */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <label style={{ fontSize: '14px', color: '#5A7766', fontWeight: '500' }}>
                    Nombre de personnes
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="20"
                    value={numberOfPeople}
                    onChange={(e) => setNumberOfPeople(parseInt(e.target.value) || 1)}
                    style={{
                      padding: '12px',
                      borderRadius: '8px',
                      color: '#1F3A2E',
                      border: '1.5px solid #5A7766',
                      fontSize: '14px',
                      backgroundColor: '#FFFCF7'
                    }}
                  />
                </div>

                {/* Fish type selection */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <label style={{ fontSize: '14px', color: '#5A7766', fontWeight: '500' }}>
                    Type de poisson recherché
                  </label>
                  <select
                    value={fishType}
                    onChange={(e) => setFishType(e.target.value)}
                    style={{
                      padding: '12px',
                      borderRadius: '8px',
                      border: '1.5px solid #5A7766',
                      fontSize: '14px',
                      color: '#1F3A2E',
                      backgroundColor: '#FFFCF7',
                      cursor: 'pointer'
                    }}
                  >
                    <option value="">-- Sélectionnez un poisson --</option>
                    {FISH_TYPES && FISH_TYPES.map(fish => (
                      <option key={fish.value} value={fish.value}>{fish.label}</option>
                    ))}
                  </select>
                </div>

                {/* Fishing zones info */}
                {loadingZones && (
                  <div style={{ textAlign: 'center', padding: '12px', color: '#5A7766' }}>
                    Chargement des zones de pêche...
                  </div>
                )}
                {fishType && !loadingZones && fishingZones.length > 0 && (
                  <div style={{
                    padding: '12px',
                    backgroundColor: 'rgba(74, 155, 142, 0.1)',
                    borderRadius: '8px',
                    fontSize: '13px',
                    color: '#2D5F4C'
                  }}>
                    <strong>🎣 {fishingZones.length} zone(s)</strong> de pêche affichée(s) sur la carte
                  </div>
                )}
                {fishType && !loadingZones && fishingZones.length === 0 && (
                  <div style={{
                    padding: '12px',
                    backgroundColor: 'rgba(245, 158, 11, 0.1)',
                    borderRadius: '8px',
                    fontSize: '13px',
                    color: '#D97706'
                  }}>
                    Aucune zone de pêche trouvée pour ce poisson
                  </div>
                )}

                {/* Date selection - moved from step 3 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <label style={{ fontSize: '14px', color: '#5A7766', fontWeight: '500' }}>
                    Dates du séjour
                  </label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      type="date"
                      value={startDate || ''}
                      onChange={(e) => setStartDate(e.target.value)}
                      placeholder="Arrivée"
                      style={{
                        flex: 1,
                        padding: '10px',
                        borderRadius: '8px',
                        border: '1.5px solid #5A7766',
                        fontSize: '13px',
                        color: '#1F3A2E',
                        backgroundColor: '#FFFCF7'
                      }}
                    />
                    <input
                      type="date"
                      value={endDate || ''}
                      onChange={(e) => setEndDate(e.target.value)}
                      min={startDate || ''}
                      placeholder="Départ"
                      style={{
                        flex: 1,
                        padding: '10px',
                        borderRadius: '8px',
                        border: '1.5px solid #5A7766',
                        color: '#1F3A2E',
                        fontSize: '13px',
                        backgroundColor: '#FFFCF7'
                      }}
                    />
                  </div>
                  {startDate && endDate && new Date(endDate) <= new Date(startDate) && (
                    <div style={{
                      padding: '8px',
                      backgroundColor: 'rgba(239, 68, 68, 0.1)',
                      borderRadius: '6px',
                      fontSize: '12px',
                      color: '#DC2626'
                    }}>
                      La date de départ doit être après la date d'arrivée
                    </div>
                  )}
                </div>

                {/* Needs chalet checkbox - only shown in 'trip' mode */}
                {browseMode === 'trip' && (
                <div style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '12px',
                  padding: '12px',
                  backgroundColor: 'rgba(255, 252, 247, 0.7)',
                  borderRadius: '8px',
                  border: '1px solid #E5E7EB'
                }}>
                  <input
                    type="checkbox"
                    id="needsChalet"
                    checked={needsChalet}
                    onChange={(e) => setNeedsChalet(e.target.checked)}
                    style={{
                      width: '20px',
                      height: '20px',
                      cursor: 'pointer',
                      accentColor: '#2D5F4C'
                    }}
                  />
                  <label 
                    htmlFor="needsChalet" 
                    style={{ 
                      fontSize: '14px', 
                      color: '#1F3A2E', 
                      fontWeight: '500',
                      cursor: 'pointer'
                    }}
                  >
                    J'ai besoin d'un chalet
                  </label>
                </div>
                )}

                <button
                  type="button"
                  onClick={() => setBookingStep(2)}
                  disabled={!canProceedStep1}
                  style={{
                    width: '100%',
                    padding: '14px 20px',
                    backgroundColor: canProceedStep1 ? '#2D5F4C' : '#9CA3AF',
                    color: '#FFFCF7',
                    border: 'none',
                    borderRadius: '12px',
                    cursor: canProceedStep1 ? 'pointer' : 'not-allowed',
                    fontWeight: '600',
                    fontSize: '15px',
                    marginTop: '12px'
                  }}
                >
                  Continuer →
                </button>
              </div>
            )}

            {/* Step 2: Combined Guide + Chalet Selection (NEW FLOW) */}
            {bookingStep === 2 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', flex: 1, minHeight: 0, overflow: 'hidden' }}>
                <h3 style={{ margin: 0, fontSize: '16px', color: '#1F3A2E', flexShrink: 0 }}>
                  2. {browseMode === 'guide' ? 'Sélectionnez un guide' : browseMode === 'chalet' ? 'Sélectionnez un chalet' : 'Sélectionnez guide et hébergement'}
                </h3>

                {/* Summary of preferences */}
                <div style={{
                  padding: '10px 12px',
                  backgroundColor: 'rgba(45, 95, 76, 0.08)',
                  borderRadius: '8px',
                  fontSize: '12px',
                  color: '#5A7766',
                  flexShrink: 0
                }}>
                  <div>🎣 Poisson: <strong>{FISH_TYPES?.find(f => f.value === fishType)?.label || fishType}</strong></div>
                  <div>👥 {numberOfPeople} personne(s)</div>
                  <div>🏠 Chalet: <strong>{needsChalet ? 'Oui' : 'Non'}</strong></div>
                </div>

                {/* Scrollable content area for guide and chalet sections */}
                <div style={{ 
                  flex: 1, 
                  overflowY: 'auto', 
                  display: 'flex', 
                  flexDirection: 'column', 
                  gap: '16px',
                  paddingRight: '4px'
                }}>
                  {/* GUIDE SECTION - hidden in chalet-only mode */}
                  {browseMode !== 'chalet' && (
                  <div style={{ 
                    borderBottom: needsChalet ? '1px solid #E5E7EB' : 'none', 
                    paddingBottom: needsChalet ? '16px' : '0'
                  }}>
                    <h4 style={{ margin: '0 0 12px', fontSize: '14px', color: '#1F3A2E', fontWeight: '600' }}>
                      🧭 Guides disponibles
                    </h4>

                  {loadingGuides ? (
                    <div style={{ textAlign: 'center', padding: '16px', color: '#5A7766' }}>
                      Chargement des guides...
                    </div>
                  ) : availableGuides.length === 0 ? (
                    <div style={{
                      padding: '12px',
                      backgroundColor: 'rgba(245, 158, 11, 0.1)',
                      borderRadius: '8px',
                      color: '#D97706',
                      fontSize: '13px'
                    }}>
                      Aucun guide spécialisé trouvé pour "{FISH_TYPES?.find(f => f.value === fishType)?.label || fishType}"
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {/* Option to skip guide */}
                      <div
                        onClick={() => handleSelectGuide(null)}
                        style={{
                          padding: '10px',
                          backgroundColor: selectedGuide === null ? 'rgba(45, 95, 76, 0.15)' : '#FFFCF7',
                          borderRadius: '8px',
                          border: selectedGuide === null ? '2px solid #2D5F4C' : '1px dashed #D1D5DB',
                          cursor: 'pointer',
                          fontSize: '13px'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <span style={{ fontSize: '18px' }}>✗</span>
                          <span style={{ color: '#5A7766' }}>Continuer sans guide</span>
                        </div>
                      </div>
                      
                      {/* Guide list */}
                      <div style={{ maxHeight: selectedGuide ? '100px' : '150px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {availableGuides.map((guide) => (
                          <div
                            key={guide.guide_id}
                            onClick={() => handleSelectGuide(guide)}
                            style={{
                              padding: '10px',
                              backgroundColor: selectedGuide?.guide_id === guide.guide_id ? 'rgba(45, 95, 76, 0.15)' : '#FFFCF7',
                              borderRadius: '8px',
                              border: selectedGuide?.guide_id === guide.guide_id ? '2px solid #2D5F4C' : '1px solid #D1D5DB',
                              cursor: 'pointer'
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
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
                              <div>
                                <p style={{ margin: 0, fontWeight: '600', fontSize: '13px', color: '#1F3A2E' }}>
                                  {guide.name}
                                </p>
                                {guide.fish_types && guide.fish_types.length > 0 && (
                                  <p style={{ margin: '2px 0 0', fontSize: '11px', color: '#5A7766' }}>
                                    🎣 {guide.fish_types.slice(0, 3).join(', ')}
                                  </p>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* TIME SLOTS SECTION - shown when a guide is selected */}
                      {selectedGuide && (
                        <div style={{ marginTop: '12px' }}>
                          <h5 style={{ margin: '0 0 8px', fontSize: '13px', color: '#1F3A2E', fontWeight: '600' }}>
                            📅 Disponibilités de {selectedGuide.name}
                          </h5>
                          <p style={{ fontSize: '11px', color: '#5A7766', margin: '0 0 8px' }}>
                            Sélectionnez les créneaux horaires souhaités
                          </p>

                          {loadingGuideAvailability ? (
                            <div style={{ textAlign: 'center', padding: '12px', color: '#5A7766', fontSize: '12px' }}>
                              Chargement des disponibilités...
                            </div>
                          ) : guideAvailabilityEvents && guideAvailabilityEvents.length > 0 ? (
                            <div style={{ maxHeight: '200px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                              {/* Group events by date */}
                              {(() => {
                                // Group events by date
                                const eventsByDate = guideAvailabilityEvents.reduce((acc, event) => {
                                  const date = event.date || (event.start ? event.start.split('T')[0] : 'unknown');
                                  if (!acc[date]) acc[date] = [];
                                  acc[date].push(event);
                                  return acc;
                                }, {});

                                return Object.entries(eventsByDate).map(([date, events]) => (
                                  <div key={date} style={{ marginBottom: '8px' }}>
                                    <div style={{ 
                                      fontSize: '11px', 
                                      fontWeight: '600', 
                                      color: '#1F3A2E',
                                      marginBottom: '4px',
                                      padding: '4px 8px',
                                      backgroundColor: 'rgba(45, 95, 76, 0.08)',
                                      borderRadius: '4px'
                                    }}>
                                      {new Date(date + 'T00:00:00').toLocaleDateString('fr-CA', { 
                                        weekday: 'short', 
                                        day: 'numeric', 
                                        month: 'short' 
                                      })}
                                    </div>
                                    {events.map((event) => {
                                      const isSelected = selectedTimeSlots?.some(slot => slot.id === event.id);
                                      const startTime = event.start ? new Date(event.start).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' }) : '';
                                      const endTime = event.end ? new Date(event.end).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' }) : '';
                                      
                                      return (
                                        <div
                                          key={event.id}
                                          onClick={() => handleSelectTimeSlot && handleSelectTimeSlot(event)}
                                          style={{
                                            padding: '8px 10px',
                                            backgroundColor: isSelected ? 'rgba(34, 197, 94, 0.15)' : '#FFFCF7',
                                            borderRadius: '6px',
                                            border: isSelected ? '2px solid #22C55E' : '1px solid #E5E7EB',
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            marginBottom: '4px',
                                            transition: 'all 0.2s ease'
                                          }}
                                        >
                                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <span style={{ 
                                              fontSize: '14px',
                                              opacity: isSelected ? 1 : 0.5
                                            }}>
                                              {isSelected ? '✓' : '○'}
                                            </span>
                                            <div>
                                              <p style={{ margin: 0, fontSize: '12px', fontWeight: '500', color: '#1F3A2E' }}>
                                                {startTime} - {endTime}
                                              </p>
                                              {event.summary && event.summary.toLowerCase() !== 'disponible' && (
                                                <p style={{ margin: '2px 0 0', fontSize: '10px', color: '#5A7766' }}>
                                                  {event.summary}
                                                </p>
                                              )}
                                            </div>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                ));
                              })()}
                            </div>
                          ) : (
                            <div style={{
                              padding: '12px',
                              backgroundColor: 'rgba(245, 158, 11, 0.1)',
                              borderRadius: '8px',
                              color: '#D97706',
                              fontSize: '12px',
                              textAlign: 'center'
                            }}>
                              Aucune disponibilité trouvée pour les dates sélectionnées ({startDate} - {endDate})
                            </div>
                          )}

                          {/* Selected slots summary */}
                          {selectedTimeSlots && selectedTimeSlots.length > 0 && (
                            <div style={{
                              marginTop: '8px',
                              padding: '8px',
                              backgroundColor: 'rgba(34, 197, 94, 0.1)',
                              borderRadius: '6px',
                              fontSize: '11px',
                              color: '#059669'
                            }}>
                              ✓ {selectedTimeSlots.length} créneau(x) sélectionné(s)
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                )}

                {/* CHALET SECTION - only if needsChalet is true (always shown in chalet mode) */}
                {needsChalet && (
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <h4 style={{ margin: '0 0 8px', fontSize: '14px', color: '#1F3A2E', fontWeight: '600' }}>
                      🏠 Chalets disponibles
                    </h4>
                    
                    <p style={{ fontSize: '12px', color: '#5A7766', margin: '0 0 8px' }}>
                      Cliquez sur la carte pour définir votre zone de recherche
                    </p>

                    {/* Radius slider */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '12px' }}>
                      <label style={{ fontSize: '12px', color: '#5A7766' }}>
                        Rayon: {radius} km
                      </label>
                      <input
                        type="range"
                        min="5"
                        max="100"
                        value={radius}
                        onChange={(e) => setRadius(parseInt(e.target.value))}
                        style={{ width: '100%' }}
                      />
                    </div>

                    {!selectedPoint?.lngLat ? (
                      <div style={{
                        padding: '12px',
                        backgroundColor: 'rgba(74, 155, 142, 0.1)',
                        borderRadius: '8px',
                        border: '1px dashed #4A9B8E'
                      }}>
                        <p style={{ fontSize: '12px', color: '#2D5F4C', margin: 0, textAlign: 'center' }}>
                          👆 Cliquez sur la carte
                        </p>
                      </div>
                    ) : (
                      <div>
                        {loadingChalets && (
                          <div style={{ textAlign: 'center', padding: '16px', color: '#5A7766' }}>
                            Chargement des chalets...
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
                            Erreur: {chaletError}
                          </div>
                        )}

                        {!loadingChalets && !chaletError && chalets.length === 0 && (
                          <div style={{
                            padding: '12px',
                            backgroundColor: 'rgba(239, 68, 68, 0.1)',
                            borderRadius: '8px',
                            color: '#DC2626',
                            fontSize: '12px',
                            textAlign: 'center'
                          }}>
                            Aucun chalet trouvé à proximité
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
                            const estName = chalet.etablishment_name || 'Sans établissement';
                            
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
                                                {chalet.nb_personnes} pers. {chalet.price && `• ${chalet.price}$/nuit`}
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
                  padding: '10px',
                  backgroundColor: '#FFFCF7',
                  borderRadius: '8px',
                  border: '1px solid #E5E7EB',
                  fontSize: '12px',
                  flexShrink: 0
                }}>
                  <div><strong>Guide:</strong> {selectedGuide ? selectedGuide.name : 'Aucun'}</div>
                  {selectedGuide && selectedTimeSlots && selectedTimeSlots.length > 0 && (
                    <div style={{ marginTop: '4px', fontSize: '11px', color: '#5A7766' }}>
                      <strong>Créneaux:</strong> {selectedTimeSlots.length} sélectionné(s)
                    </div>
                  )}
                  {needsChalet && (
                    <div><strong>Chalet:</strong> {selectedChalet ? selectedChalet.name : 'Aucun'}</div>
                  )}
                </div>

                {/* Navigation buttons */}
                <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                  <button
                    type="button"
                    onClick={() => setBookingStep(1)}
                    style={{
                      flex: 1,
                      padding: '12px',
                      backgroundColor: 'transparent',
                      color: '#5A7766',
                      border: '1.5px solid #5A7766',
                      borderRadius: '10px',
                      cursor: 'pointer',
                      fontWeight: '500',
                      fontSize: '13px'
                    }}
                  >
                    ← Retour
                  </button>
                  <button
                    type="button"
                    onClick={proceedToStep3}
                    disabled={!canProceedStep2}
                    style={{
                      flex: 1,
                      padding: '12px',
                      backgroundColor: canProceedStep2 ? '#2D5F4C' : '#9CA3AF',
                      color: '#FFFCF7',
                      border: 'none',
                      borderRadius: '10px',
                      cursor: canProceedStep2 ? 'pointer' : 'not-allowed',
                      fontWeight: '600',
                      fontSize: '13px'
                    }}
                  >
                    Continuer →
                  </button>
                </div>
              </div>
            )}

            {/* Step 3: Featured Activities (NEW - replaced date selection) */}
            {bookingStep === 3 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <h3 style={{ margin: 0, fontSize: '16px', color: '#1F3A2E' }}>
                  3. Activités à proximité
                </h3>

                {/* Selection summary */}
                <div style={{
                  padding: '12px',
                  backgroundColor: 'rgba(45, 95, 76, 0.1)',
                  borderRadius: '8px',
                  fontSize: '13px',
                  color: '#2D5F4C'
                }}>
                  <div><strong>📅 Dates:</strong> {startDate} au {endDate}</div>
                  {selectedGuide && (
                    <>
                      <div><strong>🧭 Guide:</strong> {selectedGuide.name}</div>
                      {selectedTimeSlots && selectedTimeSlots.length > 0 && (
                        <div style={{ fontSize: '11px', marginTop: '4px' }}>
                          <strong>⏰ Créneaux:</strong> {selectedTimeSlots.map(slot => {
                            const startTime = new Date(slot.startTime).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' });
                            const endTime = new Date(slot.endTime).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' });
                            const date = new Date(slot.date + 'T00:00:00').toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' });
                            return `${date} ${startTime}-${endTime}`;
                          }).join(', ')}
                        </div>
                      )}
                    </>
                  )}
                  {selectedChalet && needsChalet && (
                    <div><strong>🏠 Chalet:</strong> {selectedChalet.name}</div>
                  )}
                </div>

                {/* Featured activities header */}
                <div style={{
                  padding: '16px',
                  background: 'linear-gradient(135deg, rgba(74, 155, 142, 0.15) 0%, rgba(45, 95, 76, 0.1) 100%)',
                  borderRadius: '12px',
                  textAlign: 'center'
                }}>
                  <h4 style={{ margin: '0 0 8px', fontSize: '15px', color: '#1F3A2E' }}>
                    🌲 Découvrez la région
                  </h4>
                  <p style={{ margin: 0, fontSize: '13px', color: '#5A7766' }}>
                    Activités populaires près de votre hébergement
                  </p>
                </div>

                {/* Featured activities list */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {/* Activity 1 */}
                  <div style={{
                    padding: '14px',
                    backgroundColor: '#FFFCF7',
                    borderRadius: '10px',
                    border: '1px solid #E5E7EB',
                    display: 'flex',
                    gap: '12px',
                    alignItems: 'center'
                  }}>
                    <div style={{
                      width: '44px',
                      height: '44px',
                      borderRadius: '10px',
                      backgroundColor: 'rgba(74, 155, 142, 0.15)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '22px',
                      flexShrink: 0
                    }}>
                      🚣
                    </div>
                    <div style={{ flex: 1 }}>
                      <p style={{ margin: 0, fontWeight: '600', fontSize: '13px', color: '#1F3A2E' }}>
                        Kayak sur la rivière
                      </p>
                      <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#5A7766' }}>
                        Location disponible • 2h à 4h
                      </p>
                    </div>
                  </div>

                  {/* Activity 2 */}
                  <div style={{
                    padding: '14px',
                    backgroundColor: '#FFFCF7',
                    borderRadius: '10px',
                    border: '1px solid #E5E7EB',
                    display: 'flex',
                    gap: '12px',
                    alignItems: 'center'
                  }}>
                    <div style={{
                      width: '44px',
                      height: '44px',
                      borderRadius: '10px',
                      backgroundColor: 'rgba(74, 155, 142, 0.15)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '22px',
                      flexShrink: 0
                    }}>
                      🥾
                    </div>
                    <div style={{ flex: 1 }}>
                      <p style={{ margin: 0, fontWeight: '600', fontSize: '13px', color: '#1F3A2E' }}>
                        Randonnée pédestre
                      </p>
                      <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#5A7766' }}>
                        Sentiers balisés • Tous niveaux
                      </p>
                    </div>
                  </div>

                  {/* Activity 3 */}
                  <div style={{
                    padding: '14px',
                    backgroundColor: '#FFFCF7',
                    borderRadius: '10px',
                    border: '1px solid #E5E7EB',
                    display: 'flex',
                    gap: '12px',
                    alignItems: 'center'
                  }}>
                    <div style={{
                      width: '44px',
                      height: '44px',
                      borderRadius: '10px',
                      backgroundColor: 'rgba(74, 155, 142, 0.15)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '22px',
                      flexShrink: 0
                    }}>
                      🦌
                    </div>
                    <div style={{ flex: 1 }}>
                      <p style={{ margin: 0, fontWeight: '600', fontSize: '13px', color: '#1F3A2E' }}>
                        Observation de la faune
                      </p>
                      <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#5A7766' }}>
                        Orignal, cerf, oiseaux
                      </p>
                    </div>
                  </div>

                  {/* Activity 4 */}
                  <div style={{
                    padding: '14px',
                    backgroundColor: '#FFFCF7',
                    borderRadius: '10px',
                    border: '1px solid #E5E7EB',
                    display: 'flex',
                    gap: '12px',
                    alignItems: 'center'
                  }}>
                    <div style={{
                      width: '44px',
                      height: '44px',
                      borderRadius: '10px',
                      backgroundColor: 'rgba(74, 155, 142, 0.15)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '22px',
                      flexShrink: 0
                    }}>
                      🍽️
                    </div>
                    <div style={{ flex: 1 }}>
                      <p style={{ margin: 0, fontWeight: '600', fontSize: '13px', color: '#1F3A2E' }}>
                        Gastronomie locale
                      </p>
                      <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#5A7766' }}>
                        Restaurants et producteurs
                      </p>
                    </div>
                  </div>
                </div>

                {/* Availability status */}
                {checkingAvailability && (
                  <div style={{ textAlign: 'center', padding: '12px', color: '#5A7766' }}>
                    Vérification de la disponibilité...
                  </div>
                )}

                {/* Date conflicts */}
                {dateConflicts && (
                  <div style={{
                    padding: '12px',
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    borderRadius: '8px',
                    fontSize: '13px'
                  }}>
                    {dateConflicts.guide && (
                      <div style={{ color: '#DC2626', marginBottom: dateConflicts.chalet ? '8px' : 0 }}>
                        ⚠️ {dateConflicts.guide.message}
                      </div>
                    )}
                    {dateConflicts.chalet && (
                      <div style={{ color: '#DC2626' }}>
                        ⚠️ {dateConflicts.chalet.message}
                      </div>
                    )}
                    <p style={{ margin: '8px 0 0', fontSize: '12px', color: '#5A7766' }}>
                      Veuillez retourner à l'étape 1 pour modifier vos dates.
                    </p>
                  </div>
                )}

                {/* Success indicator */}
                {!checkingAvailability && !dateConflicts && (
                  <div style={{
                    padding: '12px',
                    backgroundColor: 'rgba(34, 197, 94, 0.1)',
                    borderRadius: '8px',
                    fontSize: '13px',
                    color: '#059669'
                  }}>
                    ✓ Disponibilité confirmée pour vos dates
                  </div>
                )}

                {/* Booking error display */}
                {bookingError && (
                  <div style={{
                    padding: '12px',
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    borderRadius: '8px',
                    fontSize: '13px',
                    color: '#DC2626'
                  }}>
                    ⚠️ {bookingError}
                  </div>
                )}

                {/* Navigation */}
                <div style={{ display: 'flex', gap: '12px', marginTop: '12px' }}>
                  <button
                    type="button"
                    onClick={() => setBookingStep(2)}
                    disabled={isCreatingBooking}
                    style={{
                      flex: 1,
                      padding: '12px',
                      backgroundColor: 'transparent',
                      color: '#5A7766',
                      border: '1.5px solid #5A7766',
                      borderRadius: '10px',
                      cursor: isCreatingBooking ? 'not-allowed' : 'pointer',
                      fontWeight: '500',
                      fontSize: '14px',
                      opacity: isCreatingBooking ? 0.6 : 1
                    }}
                  >
                    ← Retour
                  </button>
                  <button
                    type="button"
                    onClick={handleBookGuide}
                    disabled={!canProceedStep3 || isCreatingBooking}
                    style={{
                      flex: 1,
                      padding: '12px',
                      backgroundColor: (canProceedStep3 && !isCreatingBooking) ? '#2D5F4C' : '#9CA3AF',
                      color: '#FFFCF7',
                      border: 'none',
                      borderRadius: '10px',
                      cursor: (canProceedStep3 && !isCreatingBooking) ? 'pointer' : 'not-allowed',
                      fontWeight: '600',
                      fontSize: '14px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px'
                    }}
                  >
                    {isCreatingBooking ? (
                      <>
                        <span style={{
                          width: '16px',
                          height: '16px',
                          border: '2px solid #FFFCF7',
                          borderTopColor: 'transparent',
                          borderRadius: '50%',
                          animation: 'spin 1s linear infinite'
                        }} />
                        Réservation...
                      </>
                    ) : (
                      'Réserver →'
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
                  Réservation confirmée!
                </h3>

                <p style={{ fontSize: '14px', color: '#5A7766', margin: 0 }}>
                  {selectedGuide && selectedChalet
                    ? 'Votre chalet et guide ont été réservés avec succès.'
                    : selectedChalet
                    ? 'Votre chalet a été réservé avec succès.'
                    : 'Votre guide a été réservé avec succès.'
                  }
                  {' '}Vous recevrez une confirmation par courriel.
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
                          <strong>⏰ Créneaux réservés:</strong>
                          <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                            {selectedTimeSlots.map((slot, idx) => {
                              const startTime = new Date(slot.startTime).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' });
                              const endTime = new Date(slot.endTime).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' });
                              const date = new Date(slot.date + 'T00:00:00').toLocaleDateString('fr-CA', { weekday: 'short', day: 'numeric', month: 'short' });
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
                  Terminer
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
                <h1 style={{
                  margin: '6px 0 0',
                  fontSize: isMobile ? '22px' : '26px',
                  lineHeight: 1.1,
                  fontFamily: '"Iowan Old Style", "Palatino Linotype", serif',
                  fontWeight: '600',
                  color: '#173428'
                }}>
                  Carte des aventures
                </h1>
                <p style={{
                  margin: '4px 0 0',
                  fontSize: '12px',
                  color: '#4E695B'
                }}>
                    Séjours et expériences en Gaspésie
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
                    Explorez la Gaspésie
                </h2>
                <p style={{
                  margin: '6px 0 0',
                  fontSize: '12.5px',
                  lineHeight: 1.35,
                  color: '#4D685A'
                }}>
                    Réservez un guide, un chalet ou planifiez votre séjour.
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
                Planification
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
                Planifiez votre séjour
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
                    alt="Trouvez un guide"
                    style={{ width: '28px', height: '28px', flexShrink: 0 }}
                  />
                  <span>Trouvez un guide</span>
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
                    alt="Réservez un chalet"
                    style={{ width: '28px', height: '28px', flexShrink: 0 }}
                  />
                  <span>Réservez un chalet</span>
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
                Decouvrir
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
                Section sociale
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
                  Etablissement
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
                Rejoindre Monde Sauvage
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
                        Paramètres
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
                        Se déconnecter
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
                Nos affiliations
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Map Container - 80% */}
      <div 
        ref={mapContainerRef} 
        style={{ 
          position: 'relative',
          top: 0,
          left: 0,
          flex: '1 1 auto',
          minWidth: 0,
          justifyContent: 'flex-end',
          height: '100%' 
        }} 
      />

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
          Se connecter
        </button>
      )}
    </div>
  );
};

export default GaspesieMap;