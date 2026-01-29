import { useEffect, useState, useCallback } from "react";
import GaspesieMap from "./Map.jsx";
import LoginModal from "../modals/loginModal.jsx";
import Guide from "../modals/guideModal.jsx";
import JoinUs from "../modals/joinUsModal.jsx";
import EtablissementModal from "../modals/etablissementModal.jsx";
import GuideBookingModal from "../modals/guideBookingModal.jsx";
import ChaletDetailModal from "../modals/chaletDetailModal.jsx";
import supabase from "../utils/supabase.js";

// Fish types available for selection
const FISH_TYPES = [
    { value: 'saumon', label: 'Saumon Atlantique' },
    { value: 'truite', label: 'Truite mouchetée' },
    { value: 'omble', label: 'Omble de fontaine' },
    { value: 'brochet', label: 'Brochet' },
    { value: 'perchaude', label: 'Perchaude' },
    { value: 'bar', label: 'Bar rayé' },
    { value: 'maquereau', label: 'Maquereau' },
    { value: 'plie', label: 'Plie' },
    { value: 'capelan', label: 'Capelan' }
];

function MapApp({ user, profile, guide }) {
    // NEW FLOW: Step 1 (preferences) -> Step 2 (guide+chalet selection) -> Step 3 (dates) -> Step 4 (confirmation)
    
    // Booking flow state
    const [bookingStep, setBookingStep] = useState(0); // 0 = not started, 1 = preferences, 2 = guide+chalet, 3 = dates, 4 = confirmation
    
    // Step 1: Trip preferences
    const [numberOfPeople, setNumberOfPeople] = useState(2);
    const [fishType, setFishType] = useState('');
    const [needsChalet, setNeedsChalet] = useState(true);
    const [fishingZones, setFishingZones] = useState([]);
    const [loadingZones, setLoadingZones] = useState(false);
    
    // Step 2: Guide + Chalet selection
    const [radius, setRadius] = useState(20);
    const [selectedPoint, setSelectedPoint] = useState(null);
    const [selectedChalet, setSelectedChalet] = useState(null);
    const [availableGuides, setAvailableGuides] = useState([]);
    const [selectedGuide, setSelectedGuide] = useState(null);
    const [loadingGuides, setLoadingGuides] = useState(false);
    
    // Chalet search state
    const [chalets, setChalets] = useState([]);
    const [loadingChalets, setLoadingChalets] = useState(false);
    const [chaletError, setChaletError] = useState(null);
    const [expandedEstablishments, setExpandedEstablishments] = useState(new Set());
    const [chaletDetailModalOpen, setChaletDetailModalOpen] = useState(false);
    const [chaletForDetail, setChaletForDetail] = useState(null);
    
    // Step 3: Date selection (moved to after guide/chalet)
    const [startDate, setStartDate] = useState("");
    const [endDate, setEndDate] = useState("");
    const [selectedGuideEvent, setSelectedGuideEvent] = useState(null);
    const [dateConflicts, setDateConflicts] = useState(null);
    const [checkingAvailability, setCheckingAvailability] = useState(false);
    
    // Other modals
    const [isLoginOpen, setIsLoginOpen] = useState(false);
    const [isGuideOpen, setIsGuideOpen] = useState(false);
    const [isRejoindreOpen, setIsRejoindreOpen] = useState(false);
    const [isEtablissementOpen, setIsEtablissementOpen] = useState(false);
    const [isGuideBookingModalOpen, setIsGuideBookingModalOpen] = useState(false);
    const [guideForBooking, setGuideForBooking] = useState(null);
    
    // Check URL parameters on mount to reopen establishment modal if needed
    useEffect(() => {
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('openEstablishment') === 'true') {
            setIsEtablissementOpen(true);
            // Clean up URL parameter
            urlParams.delete('openEstablishment');
            const newUrl = urlParams.toString() 
                ? `${window.location.pathname}?${urlParams.toString()}`
                : window.location.pathname;
            window.history.replaceState({}, document.title, newUrl);
        }
    }, []);

    // Fetch fishing zones when fish type changes
    useEffect(() => {
        if (!fishType) {
            setFishingZones([]);
            return;
        }

        const fetchFishingZones = async () => {
            setLoadingZones(true);
            try {
                console.log("🎣 Fetching fishing zones for:", fishType);
                const { data, error } = await supabase.rpc('get_fishing_zones_by_fish_type', {
                    p_fish_type: fishType
                });
                
                if (error) throw error;
                
                console.log("📍 Fishing zones found:", data);
                setFishingZones(data || []);
            } catch (err) {
                console.error("❌ Error fetching fishing zones:", err);
                setFishingZones([]);
            } finally {
                setLoadingZones(false);
            }
        };

        fetchFishingZones();
    }, [fishType]);

    function onClick(e) {
        console.log("click");
        setSelectedPoint(e);
        console.log(e);
    }

    // Fetch guides filtered by fish type when entering step 2
    useEffect(() => {
        if (bookingStep !== 2) return;

        const fetchGuides = async () => {
            setLoadingGuides(true);
            try {
                console.log("🔍 Fetching guides for fish type:", fishType);
                
                // First get guides from our database filtered by fish type
                let query = supabase
                    .from('guide')
                    .select('*')
                    .not('google_refresh_token', 'is', null);
                
                if (fishType) {
                    query = query.contains('fish_types', [fishType]);
                }
                
                const { data: guides, error } = await query;
                
                if (error) throw error;
                
                console.log("👤 Guides found:", guides);
                
                // Transform to match expected format (with is_available flag for now)
                const formattedGuides = (guides || []).map(g => ({
                    guide_id: g.id,
                    name: g.name,
                    email: g.email,
                    fish_types: g.fish_types || [],
                    hourly_rate: g.hourlyRate,
                    is_available: true, // Will be verified when dates are selected
                    events: []
                }));
                
                setAvailableGuides(formattedGuides);
            } catch (err) {
                console.error("❌ Error fetching guides:", err);
                setAvailableGuides([]);
            } finally {
                setLoadingGuides(false);
            }
        };

        fetchGuides();
    }, [bookingStep, fishType]);

    // Fetch ALL chalets within radius (no filtering by capacity/dates)
    // The filtering criteria from step 1 will be used to highlight matching chalets
    useEffect(() => {
        if (bookingStep !== 2 || !selectedPoint?.lngLat || !needsChalet) return;

        const fetchChalets = async () => {
            console.log("Querying Supabase for ALL chalets within radius:", {
                lng: selectedPoint.lngLat?.lng,
                lat: selectedPoint.lngLat?.lat,
                radius_km: radius || 20
            });
            
            try {
                setLoadingChalets(true);
                setChaletError(null);

                // Fetch ALL chalets within radius - no capacity or date filtering
                const { data, error } = await supabase.rpc('get_chalets_nearby', {
                    lng: selectedPoint.lngLat.lng,
                    lat: selectedPoint.lngLat.lat,
                    radius_m: (radius || 20) * 1000,
                    min_capacity: null,
                    check_start_date: null,
                    check_end_date: null
                });

                if (error) throw error;

                setChalets(Array.isArray(data) ? data : []);
                
                // Automatically expand all establishments
                if (data && data.length > 0) {
                    const uniqueEstablishmentIds = new Set(
                        data.map(chalet => chalet.etablishment_id || 'no-establishment')
                    );
                    setExpandedEstablishments(uniqueEstablishmentIds);
                }
            } catch (err) {
                console.error("❌ Error fetching nearby chalets:", err);
                setChaletError(err.message);
            } finally {
                setLoadingChalets(false);
            }
        };

        fetchChalets();
    }, [bookingStep, selectedPoint, radius, needsChalet]);

    // Check availability when dates change in step 3
    const checkAvailability = useCallback(async () => {
        if (!startDate || !endDate) return;
        if (!selectedGuide && !selectedChalet) return;

        setCheckingAvailability(true);
        setDateConflicts(null);

        try {
            const conflicts = { guide: null, chalet: null };

            // Check guide availability via Google Calendar
            if (selectedGuide) {
                const url = `https://fhpbftdkqnkncsagvsph.supabase.co/functions/v1/google-calendar-availability?guideId=${selectedGuide.guide_id}&start=${startDate}&end=${endDate}`;
                const res = await fetch(url, {
                    method: "GET",
                    headers: {
                        "Authorization": `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
                        "Content-Type": "application/json",
                    },
                });
                const data = await res.json();
                
                if (!data.is_available) {
                    conflicts.guide = {
                        message: `${selectedGuide.name} n'est pas disponible pour ces dates.`,
                        busyEvents: data.busy_events || []
                    };
                }
            }

            // Check chalet availability via bookings table
            if (selectedChalet) {
                const { data: existingBookings, error } = await supabase
                    .from('bookings')
                    .select('*')
                    .eq('chalet_id', selectedChalet.id)
                    .in('status', ['blocked', 'confirmed'])
                    .lt('start_date', endDate)
                    .gt('end_date', startDate);

                if (error) throw error;

                if (existingBookings && existingBookings.length > 0) {
                    conflicts.chalet = {
                        message: `${selectedChalet.name} n'est pas disponible pour ces dates.`,
                        conflictingBookings: existingBookings
                    };
                }
            }

            if (conflicts.guide || conflicts.chalet) {
                setDateConflicts(conflicts);
            }

        } catch (err) {
            console.error("❌ Error checking availability:", err);
        } finally {
            setCheckingAvailability(false);
        }
    }, [startDate, endDate, selectedGuide, selectedChalet]);

    useEffect(() => {
        if (bookingStep === 3) {
            checkAvailability();
        }
    }, [bookingStep, startDate, endDate, checkAvailability]);

    function handleVoirPlus(chalet) {
        setChaletForDetail(chalet);
        setChaletDetailModalOpen(true);
    }

    function toggleEstablishment(establishmentId) {
        setExpandedEstablishments(prev => {
            const newSet = new Set(prev);
            if (newSet.has(establishmentId)) {
                newSet.delete(establishmentId);
            } else {
                newSet.add(establishmentId);
            }
            return newSet;
        });
    }

    function onClose() {
        setIsModalOpen(false);
        console.log("closebdwiubwdiub");
    }

    function login() {
        console.log("login");
        setIsLoginOpen(true);
    }

    function startBookingFlow() {
        // Clear any previous state when starting a new booking
        setSelectedPoint(null);
        setSelectedChalet(null);
        setSelectedGuide(null);
        setChalets([]);
        setFishType('');
        setNeedsChalet(true);
        setNumberOfPeople(2);
        setFishingZones([]);
        setStartDate('');
        setEndDate('');
        setDateConflicts(null);
        setBookingStep(1);
    }

    function handleSelectedChalet(chalet) {
        // Toggle selection if clicking the same chalet
        if (selectedChalet?.id === chalet.id) {
            setSelectedChalet(null);
        } else {
            setSelectedChalet(chalet);
        }
    }

    function handleSelectGuide(guide) {
        // Handle "no guide" selection
        if (guide === null) {
            setSelectedGuide(null);
            return;
        }
        
        // Toggle selection
        if (selectedGuide?.guide_id === guide.guide_id) {
            setSelectedGuide(null);
        } else {
            setSelectedGuide(guide);
        }
    }

    function handleSelectGuideEvent(guide) {
        // Legacy function for compatibility - now just selects guide
        handleSelectGuide(guide);
    }

    function proceedToStep3() {
        // Validate step 2 selection
        if (!selectedGuide && needsChalet && !selectedChalet) {
            alert('Veuillez sélectionner au moins un guide ou un chalet.');
            return;
        }
        if (!selectedGuide && !needsChalet) {
            alert('Veuillez sélectionner un guide.');
            return;
        }
        setBookingStep(3);
    }

    function handleBookGuide() {
        if (!selectedGuide) {
            // No guide selected, just confirm chalet booking
            setBookingStep(4);
            return;
        }
        
        setGuideForBooking({
            id: selectedGuide.guide_id,
            name: selectedGuide.name,
            email: selectedGuide.email,
            hourlyRate: selectedGuide.hourly_rate,
            prefilledStartTime: `${startDate}T09:00:00`,
            prefilledEndTime: `${endDate}T17:00:00`
        });
        setIsGuideBookingModalOpen(true);
    }

    function handleGuideBookingCreated(booking) {
        console.log("Guide booking created:", booking);
        setIsGuideBookingModalOpen(false);
        setBookingStep(4);
    }

    function resetBookingFlow() {
        setBookingStep(0);
        setStartDate("");
        setEndDate("");
        setNumberOfPeople(2);
        setFishType('');
        setNeedsChalet(true);
        setRadius(20);
        setSelectedPoint(null);
        setSelectedChalet(null);
        setChalets([]);
        setExpandedEstablishments(new Set());
        setAvailableGuides([]);
        setSelectedGuide(null);
        setSelectedGuideEvent(null);
        setFishingZones([]);
        setDateConflicts(null);
    }

    // Validation for step 1: preferences + dates
    const canProceedStep1 = numberOfPeople > 0 && 
        fishType !== '' && 
        startDate && 
        endDate && 
        new Date(endDate) > new Date(startDate);

    // Validation for step 2: guide/chalet selection
    const canProceedStep2 = selectedGuide || (needsChalet && selectedChalet);

    // Validation for step 3: availability confirmed (dates already validated in step 1)
    const canProceedStep3 = !dateConflicts?.guide && 
        !dateConflicts?.chalet;
    
    return (
        <div>
            <GaspesieMap 
                onClick={onClick}
                radius={radius}
                login={login}
                GuideOpen={setIsGuideOpen}
                isTripOpen={startBookingFlow}
                user={user}
                profile={profile}
                isRejoindreOpen={setIsRejoindreOpen}
                isEtablissementOpen={setIsEtablissementOpen}
                // Pass booking flow state to control the sidebar
                bookingStep={bookingStep}
                setBookingStep={setBookingStep}
                startDate={startDate}
                setStartDate={setStartDate}
                endDate={endDate}
                setEndDate={setEndDate}
                numberOfPeople={numberOfPeople}
                setNumberOfPeople={setNumberOfPeople}
                setRadius={setRadius}
                selectedChalet={selectedChalet}
                availableGuides={availableGuides}
                loadingGuides={loadingGuides}
                selectedGuide={selectedGuide}
                selectedGuideEvent={selectedGuideEvent}
                handleSelectGuideEvent={handleSelectGuideEvent}
                handleSelectGuide={handleSelectGuide}
                handleBookGuide={handleBookGuide}
                resetBookingFlow={resetBookingFlow}
                canProceedStep1={canProceedStep1}
                canProceedStep2={canProceedStep2}
                canProceedStep3={canProceedStep3}
                // Chalet search props for Step 2
                chalets={chalets}
                loadingChalets={loadingChalets}
                chaletError={chaletError}
                expandedEstablishments={expandedEstablishments}
                toggleEstablishment={toggleEstablishment}
                handleVoirPlus={handleVoirPlus}
                handleSelectedChalet={handleSelectedChalet}
                selectedPoint={selectedPoint}
                // NEW: Step 1 preferences props
                fishType={fishType}
                setFishType={setFishType}
                needsChalet={needsChalet}
                setNeedsChalet={setNeedsChalet}
                fishingZones={fishingZones}
                loadingZones={loadingZones}
                FISH_TYPES={FISH_TYPES}
                proceedToStep3={proceedToStep3}
                // NEW: Step 3 date conflict props
                dateConflicts={dateConflicts}
                checkingAvailability={checkingAvailability}
            />
            <ChaletDetailModal
                isOpen={chaletDetailModalOpen}
                onClose={() => setChaletDetailModalOpen(false)}
                chalet={chaletForDetail}
            />
            <LoginModal 
                isLoginOpen={isLoginOpen}
                onLoginClose={() => setIsLoginOpen(false)}
            />
            
            <Guide
                isGuideOpen={isGuideOpen}
                closeGuide={() => setIsGuideOpen(false)}
                guide={guide}
            />

            <JoinUs
                isRejoindreOpen={isRejoindreOpen}
                onClose={() => setIsRejoindreOpen(false)}
            />

            <EtablissementModal
                isEtablissementOpen={isEtablissementOpen}
                onClose={() => setIsEtablissementOpen(false)}
            />

            <GuideBookingModal
                guide={guideForBooking}
                isOpen={isGuideBookingModalOpen}
                onClose={() => setIsGuideBookingModalOpen(false)}
                onBookingCreated={handleGuideBookingCreated}
            />
            
        </div>
    );
}

export default MapApp;