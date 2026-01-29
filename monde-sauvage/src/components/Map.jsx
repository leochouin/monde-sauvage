import { useEffect, useRef, useState } from 'react';
import supabase from '../utils/supabase.js';

const GaspesieMap = ({ 
  onClick, 
  GuideOpen, 
  login, 
  user, 
  profile, 
  isTripOpen, 
  radius, 
  isRejoindreOpen, 
  isEtablissementOpen,
  // Booking flow props
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
  selectedGuideEvent,
  handleSelectGuideEvent,
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
  handleVoirPlus,
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
  checkingAvailability
}) => {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const mapStyleLoaded = useRef(false);

  const [circleCenter, setCircleCenter] = useState(null);

  // Sign out function
  const handleSignOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error('Error signing out:', error);
    } else {
      console.log('✅ Signed out successfully');
    }
  };

  const avatarUrl = user
    ? user.user_metadata?.avatar_url || user.raw_user_meta_data?.avatar_url || '/default-avatar.png'
    : '/default-avatar.png';
    

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
    
    mapboxgl.accessToken = 'pk.eyJ1IjoibGVvY2hvdWluYXJkIiwiYSI6ImNtZmltbnYwbzBvNnUycW9zMWZ1ZHB4dGUifQ.-WHGlNmEXAleoIE4-nkKSA';

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
      position: 'absolute',
      display: 'flex',
      justifyContent: 'flex-end',
      alignItems: 'center',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: '100%', 
      height: '100vh', 
      margin: 0, 
      padding: 0,
      backgroundColor: '#f0f0f0'
    }}>
      {/* Left Menu Panel - 20% */}
      <div style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: '20vw',
        height: '100vh',
        background: 'linear-gradient(165deg, #F9F7F3 0%, #E8F3ED 100%)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-start',
        alignItems: 'center',
        gap: '0',
        padding: '60px 24px 40px',
        boxShadow: '4px 0 24px rgba(45, 95, 76, 0.08)',
        zIndex: 100,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        overflowY: 'auto'
      }}>
        {/* BOOKING FLOW CONTENT */}
        {bookingStep > 0 ? (
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {/* Header with back button */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
              <button
                type="button"
                onClick={resetBookingFlow}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '20px',
                  padding: '4px',
                  display: 'flex',
                  alignItems: 'center'
                }}
              >
                ←
              </button>
              <h2 style={{ margin: 0, fontSize: '18px', color: '#1F3A2E', fontWeight: '600' }}>
                Planifier votre séjour
              </h2>
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
                  1. Préférences de voyage
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

                {/* Needs chalet checkbox */}
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
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', height: '100%', overflow: 'hidden' }}>
                <h3 style={{ margin: 0, fontSize: '16px', color: '#1F3A2E' }}>
                  2. Sélectionnez guide et hébergement
                </h3>

                {/* Summary of preferences */}
                <div style={{
                  padding: '10px 12px',
                  backgroundColor: 'rgba(45, 95, 76, 0.08)',
                  borderRadius: '8px',
                  fontSize: '12px',
                  color: '#5A7766'
                }}>
                  <div>🎣 Poisson: <strong>{FISH_TYPES?.find(f => f.value === fishType)?.label || fishType}</strong></div>
                  <div>👥 {numberOfPeople} personne(s)</div>
                  <div>🏠 Chalet: <strong>{needsChalet ? 'Oui' : 'Non'}</strong></div>
                </div>

                {/* GUIDE SECTION */}
                <div style={{ 
                  borderBottom: '1px solid #E5E7EB', 
                  paddingBottom: '16px',
                  flex: needsChalet ? 'none' : 1,
                  overflow: 'auto'
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
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '180px', overflowY: 'auto' }}>
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
                            <div style={{
                              width: '32px',
                              height: '32px',
                              borderRadius: '50%',
                              backgroundColor: '#4A9B8E',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              color: 'white',
                              fontWeight: '600',
                              fontSize: '12px'
                            }}>
                              {guide.name?.charAt(0) || 'G'}
                            </div>
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
                  )}
                </div>

                {/* CHALET SECTION - only if needsChalet is true */}
                {needsChalet && (
                  <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
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
                      <div style={{ flex: 1, overflowY: 'auto' }}>
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

                {/* Selection summary */}
                <div style={{
                  padding: '10px',
                  backgroundColor: '#FFFCF7',
                  borderRadius: '8px',
                  border: '1px solid #E5E7EB',
                  fontSize: '12px'
                }}>
                  <div><strong>Guide:</strong> {selectedGuide ? selectedGuide.name : 'Aucun'}</div>
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
                    <div><strong>🧭 Guide:</strong> {selectedGuide.name}</div>
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

                {/* Navigation */}
                <div style={{ display: 'flex', gap: '12px', marginTop: '12px' }}>
                  <button
                    type="button"
                    onClick={() => setBookingStep(2)}
                    style={{
                      flex: 1,
                      padding: '12px',
                      backgroundColor: 'transparent',
                      color: '#5A7766',
                      border: '1.5px solid #5A7766',
                      borderRadius: '10px',
                      cursor: 'pointer',
                      fontWeight: '500',
                      fontSize: '14px'
                    }}
                  >
                    ← Retour
                  </button>
                  <button
                    type="button"
                    onClick={handleBookGuide}
                    disabled={!canProceedStep3}
                    style={{
                      flex: 1,
                      padding: '12px',
                      backgroundColor: canProceedStep3 ? '#2D5F4C' : '#9CA3AF',
                      color: '#FFFCF7',
                      border: 'none',
                      borderRadius: '10px',
                      cursor: canProceedStep3 ? 'pointer' : 'not-allowed',
                      fontWeight: '600',
                      fontSize: '14px'
                    }}
                  >
                    Réserver →
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
                    <p style={{ margin: '0 0 8px', fontSize: '13px', color: '#5A7766' }}>
                      <strong>🧭 Guide:</strong> {selectedGuide?.name}
                    </p>
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
          <>
            {/* User Profile Section */}
            {user && (
              <div style={{
                width: '100%',
                marginBottom: '32px',
                padding: '20px',
                backgroundColor: 'rgba(255, 252, 247, 0.7)',
                borderRadius: '16px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '12px',
                boxShadow: '0 2px 8px rgba(45, 95, 76, 0.06)'
              }}>
                <img
                  src={avatarUrl}
                  alt="Profile"
                  style={{ 
                    width: 64, 
                    height: 64, 
                    borderRadius: '50%',
                    border: '3px solid #4A9B8E',
                    objectFit: 'cover'
                  }}
                />
                <p style={{ 
                  margin: 0, 
                  fontWeight: '500', 
                  fontSize: '15px',
                  color: '#1F3A2E',
                  textAlign: 'center'
                }}>
                  {user.user_metadata.name}
                </p>
                <button
                  type="button"
                  onClick={handleSignOut}
                  style={{
                    padding: '6px 14px',
                    backgroundColor: 'transparent',
                    color: '#5A7766',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontWeight: '500',
                    fontSize: '13px',
                    textDecoration: 'underline',
                    transition: 'color 0.2s ease'
                  }}
                  onMouseOver={(e) => {
                    e.target.style.color = '#1F3A2E';
                  }}
                  onMouseOut={(e) => {
                    e.target.style.color = '#5A7766';
                  }}
                >
                  Se déconnecter
                </button>
              </div>
            )}

            {/* Primary CTA */}
            <button
              type="button"
              onClick={() => isTripOpen(true)}
              style={{
                width: '100%',
                padding: '16px 20px',
                backgroundColor: '#2D5F4C',
                color: '#FFFCF7',
                border: '2px solid #4A9B8E',
                borderRadius: '12px',
                cursor: 'pointer',
                fontWeight: '600',
                fontSize: '17px',
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                boxShadow: '0 4px 12px rgba(45, 95, 76, 0.15), 0 2px 4px rgba(45, 95, 76, 0.08)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '10px',
                marginBottom: '32px'
              }}
              onMouseOver={(e) => {
                e.target.style.backgroundColor = '#3A7360';
                e.target.style.transform = 'translateY(-2px)';
                e.target.style.boxShadow = '0 8px 20px rgba(45, 95, 76, 0.25), 0 4px 8px rgba(45, 95, 76, 0.12)';
              }}
              onMouseOut={(e) => {
                e.target.style.backgroundColor = '#2D5F4C';
                e.target.style.transform = 'translateY(0)';
                e.target.style.boxShadow = '0 4px 12px rgba(45, 95, 76, 0.15), 0 2px 4px rgba(45, 95, 76, 0.08)';
              }}
            >
              <span style={{ fontSize: '20px' }}></span>
              Planifiez votre séjour
            </button>

            {/* Divider */}
            {(profile?.type === "guide" || profile?.type === "establishment" || profile?.type === "admin") && (
              <div style={{
                width: '60%',
                height: '1px',
                background: 'linear-gradient(90deg, transparent, #4A9B8E, transparent)',
                margin: '0 0 24px 0',
                opacity: 0.3
              }}></div>
            )}

            {/* Secondary Actions Group */}
            <div style={{
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
              marginBottom: '32px'
            }}>
              {(profile?.type === "guide" || profile?.type === "admin") && (
                <button
                  type="button"
                  onClick={() => GuideOpen(true)}
                  style={{
                    width: '100%',
                    padding: '14px 20px',
                    backgroundColor: '#FFFCF7',
                    color: '#2D5F4C',
                    border: '2px solid #2D5F4C',
                    borderRadius: '12px',
                    cursor: 'pointer',
                    fontWeight: '500',
                    fontSize: '15px',
                    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                    boxShadow: '0 2px 6px rgba(45, 95, 76, 0.08)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '10px'
                  }}
                  onMouseOver={(e) => {
                    e.target.style.backgroundColor = 'rgba(74, 155, 142, 0.12)';
                    e.target.style.transform = 'translateY(-1px)';
                    e.target.style.boxShadow = '0 4px 12px rgba(45, 95, 76, 0.15)';
                  }}
                  onMouseOut={(e) => {
                    e.target.style.backgroundColor = '#FFFCF7';
                    e.target.style.transform = 'translateY(0)';
                    e.target.style.boxShadow = '0 2px 6px rgba(45, 95, 76, 0.08)';
                  }}
                >
                  <span style={{ fontSize: '18px' }}></span>
                  Guide
                </button>
              )}

              {(profile?.type === "establishment" || profile?.type === "admin") && (
                <button
                  type="button"
                  onClick={() => isEtablissementOpen(true)}
                  style={{
                    width: '100%',
                    padding: '14px 20px',
                    backgroundColor: '#FFFCF7',
                    color: '#2D5F4C',
                    border: '2px solid #2D5F4C',
                    borderRadius: '12px',
                    cursor: 'pointer',
                    fontWeight: '500',
                    fontSize: '15px',
                    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                    boxShadow: '0 2px 6px rgba(45, 95, 76, 0.08)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '10px'
                  }}
                  onMouseOver={(e) => {
                    e.target.style.backgroundColor = 'rgba(74, 155, 142, 0.12)';
                    e.target.style.transform = 'translateY(-1px)';
                    e.target.style.boxShadow = '0 4px 12px rgba(45, 95, 76, 0.15)';
                  }}
                  onMouseOut={(e) => {
                    e.target.style.backgroundColor = '#FFFCF7';
                    e.target.style.transform = 'translateY(0)';
                    e.target.style.boxShadow = '0 2px 6px rgba(45, 95, 76, 0.08)';
                  }}
                >
                  <span style={{ fontSize: '18px' }}></span>
                  Établissement
                </button>
              )}
            </div>

            {/* Divider */}
            <div style={{
              width: '60%',
              height: '1px',
              background: 'linear-gradient(90deg, transparent, #4A9B8E, transparent)',
              margin: '0 0 24px 0',
              opacity: 0.3
            }}></div>

            {/* Tertiary Actions Group */}
            <div style={{
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px'
            }}>
              <button
                type="button"
                onClick={() => isRejoindreOpen(true)}
                style={{
                  width: '100%',
                  padding: '14px 20px',
                  backgroundColor: 'transparent',
                  color: '#1F3A2E',
                  border: '1.5px solid #5A7766',
                  borderRadius: '12px',
                  cursor: 'pointer',
                  fontWeight: '500',
                  fontSize: '15px',
                  transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '10px'
                }}
                onMouseOver={(e) => {
                  e.target.style.backgroundColor = 'rgba(90, 119, 102, 0.08)';
                  e.target.style.borderColor = '#2D5F4C';
                  e.target.style.color = '#2D5F4C';
                }}
                onMouseOut={(e) => {
                  e.target.style.backgroundColor = 'transparent';
                  e.target.style.borderColor = '#5A7766';
                  e.target.style.color = '#1F3A2E';
                }}
              >
                <span style={{ fontSize: '18px' }}></span>
                Rejoindre monde sauvage
              </button>

              <button
                type="button"
                onClick={() => console.log('Nos affiliation clicked')}
                style={{
                  width: '100%',
                  padding: '14px 20px',
                  backgroundColor: 'transparent',
                  color: '#1F3A2E',
                  border: '1.5px solid #5A7766',
                  borderRadius: '12px',
                  cursor: 'pointer',
                  fontWeight: '500',
                  fontSize: '15px',
                  transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '10px'
                }}
                onMouseOver={(e) => {
                  e.target.style.backgroundColor = 'rgba(90, 119, 102, 0.08)';
                  e.target.style.borderColor = '#2D5F4C';
                  e.target.style.color = '#2D5F4C';
                }}
                onMouseOut={(e) => {
                  e.target.style.backgroundColor = 'transparent';
                  e.target.style.borderColor = '#5A7766';
                  e.target.style.color = '#1F3A2E';
                }}
              >
                <span style={{ fontSize: '18px' }}>🤝</span>
                Nos affiliations
              </button>
            </div>
          </>
        )}
      </div>

      {/* Map Container - 80% */}
      <div 
        ref={mapContainerRef} 
        style={{ 
          position: 'relative',
          top: 0,
          left: 0,
          width: '80vw', 
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
            top: '50px',
            left: '50px',
            zIndex: 1000,
            padding: '12px 24px',
            backgroundColor: '#2D5F4C',
            color: '#FFFCF7',
            border: '2px solid #4A9B8E',
            borderRadius: '12px',
            cursor: 'pointer',
            fontWeight: '600',
            fontSize: '15px',
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