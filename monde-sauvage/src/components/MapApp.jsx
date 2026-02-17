import { useEffect, useState, useCallback } from "react";
import GaspesieMap from "./Map.jsx";
import LoginModal from "../modals/loginModal.jsx";
import JoinUs from "../modals/joinUsModal.jsx";
import EtablissementModal from "../modals/etablissementModal.jsx";
import GuideBookingModal from "../modals/guideBookingModal.jsx";
import GuideClientModal from "../modals/guideClientModal.jsx";
import ChaletDetailModal from "../modals/chaletDetailModal.jsx";
import GuideOnboardingModal, { shouldShowGuideOnboarding } from "../modals/guideOnboardingModal.jsx";
import AccountSettingsModal from "../modals/accountSettingsModal.jsx";
import HighlightOverlay from "./HighlightOverlay.jsx";
import supabase from "../utils/supabase.js";
import { createGuideBooking } from "../utils/guideBookingService.js";
import { createBooking } from "../utils/bookingService.js";
import CheckoutModal from "../modals/checkoutModal.jsx";

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
    
    // Browse mode: 'trip' = full flow, 'guide' = guide-only, 'chalet' = chalet-only
    const [browseMode, setBrowseMode] = useState('trip');
    
    // Account settings modal
    const [isAccountSettingsOpen, setIsAccountSettingsOpen] = useState(false);
    
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
    
    // NEW: Guide availability time slots
    const [guideAvailabilityEvents, setGuideAvailabilityEvents] = useState([]);
    const [loadingGuideAvailability, setLoadingGuideAvailability] = useState(false);
    const [selectedTimeSlots, setSelectedTimeSlots] = useState([]); // Array of {date, startTime, endTime, eventId}
    
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
    
    // Booking creation state
    const [isCreatingBooking, setIsCreatingBooking] = useState(false);
    const [bookingError, setBookingError] = useState(null);
    
    // Other modals
    const [isLoginOpen, setIsLoginOpen] = useState(false);
    const [isRejoindreOpen, setIsRejoindreOpen] = useState(false);
    const [isEtablissementOpen, setIsEtablissementOpen] = useState(false);
    const [isGuideBookingModalOpen, setIsGuideBookingModalOpen] = useState(false);
    const [guideForBooking, setGuideForBooking] = useState(null);
    const [isGuideClientModalOpen, setIsGuideClientModalOpen] = useState(false);
    const [settingsWasOpenBeforeClients, setSettingsWasOpenBeforeClients] = useState(false);
    
    // Stripe payment checkout state for main booking flow
    const [showPaymentCheckout, setShowPaymentCheckout] = useState(false);
    const [paymentCheckoutData, setPaymentCheckoutData] = useState(null);
    const [paymentCheckoutType, setPaymentCheckoutType] = useState(null); // 'guide' or 'chalet'
    const [pendingChaletBooking, setPendingChaletBooking] = useState(null); // chalet data waiting after guide payment
    
    // Guide onboarding state
    const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);
    const [highlightedElement, setHighlightedElement] = useState(null);
    const [onboardingStartStep, setOnboardingStartStep] = useState(0);
    
    // Function to manually open onboarding (for help button)
    // skipGuideButton: if true, starts at step 2 (after guide-button step) - used when opening from guide modal
    const openOnboarding = (skipGuideButton = false) => {
        setOnboardingStartStep(skipGuideButton ? 2 : 0);
        setIsOnboardingOpen(true);
    };
    
    // Check if guide onboarding should be shown
    useEffect(() => {
        if (profile && shouldShowGuideOnboarding(profile)) {
            // Small delay to let the page render first
            const timer = setTimeout(() => {
                setIsOnboardingOpen(true);
            }, 500);
            return () => clearTimeout(timer);
        }
    }, [profile]);
    
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

    // Fetch guides filtered by fish type AND availability when entering step 2
    useEffect(() => {
        if (bookingStep !== 2 || !startDate || !endDate) return;

        const fetchGuides = async () => {
            setLoadingGuides(true);
            try {
                console.log("🔍 Fetching guides for fish type:", fishType, "dates:", startDate, "-", endDate);
                
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
                
                console.log("👤 Guides found from DB:", guides);
                console.log("👤 Number of guides:", guides?.length || 0);
                if (guides?.length > 0) {
                    console.log("👤 Guide IDs:", guides.map(g => `${g.name} (${g.id})`));
                }

                // Now check actual calendar availability for these guides
                const startISO = new Date(startDate + 'T00:00:00').toISOString();
                const endISO = new Date(endDate + 'T23:59:59').toISOString();
                
                console.log("📆 Date inputs:", { startDate, endDate });
                console.log("📆 ISO dates:", { startISO, endISO });
                
                const availabilityUrl = `https://fhpbftdkqnkncsagvsph.supabase.co/functions/v1/google-calendar-availability-all?start=${encodeURIComponent(startISO)}&end=${encodeURIComponent(endISO)}`;
                console.log("🌐 Availability URL:", availabilityUrl);
                
                const availabilityRes = await fetch(availabilityUrl, {
                    method: "GET",
                    headers: {
                        "Authorization": `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
                        "Content-Type": "application/json",
                    },
                });
                
                const availabilityData = await availabilityRes.json();
                console.log("📅 Availability response status:", availabilityRes.status);
                console.log("📅 Availability data for all guides:", availabilityData);
                
                // Create a map of guide_id -> availability info
                const availabilityMap = new Map();
                if (Array.isArray(availabilityData)) {
                    availabilityData.forEach(item => {
                        console.log(`  📊 Guide ${item.guide_id} (${item.name}): is_available=${item.is_available}, events=${item.events?.length || 0}, booked=${item.booked_slots?.length || 0}, error=${item.error || 'none'}`);
                        availabilityMap.set(item.guide_id, item);
                    });
                } else {
                    console.warn("⚠️ availabilityData is not an array:", availabilityData);
                }
                
                // Transform guides — a guide is available unless the API explicitly says they're fully booked
                const formattedGuides = (guides || [])
                    .map(g => {
                        const availability = availabilityMap.get(g.id);
                        
                        // If guide is in availability response, use the API's is_available
                        // If guide is NOT in the response (no calendar connected), they're still available  
                        const isAvailable = availability 
                            ? (availability.is_available !== false && !availability.error)
                            : true; // Guide with refresh token but not in response → available by default
                        
                        console.log(`🔍 Guide ${g.name}: inMap=${!!availability}, is_available=${isAvailable}, error=${availability?.error || 'none'}`);
                        
                        return {
                            guide_id: g.id,
                            name: g.name,
                            email: g.email,
                            fish_types: g.fish_types || [],
                            hourly_rate: g.hourly_rate,
                            stripe_charges_enabled: g.stripe_charges_enabled || false,
                            stripe_account_id: g.stripe_account_id || null,
                            is_available: isAvailable,
                            events: availability?.events || [],
                            booked_slots: availability?.booked_slots || []
                        };
                    })
                    .filter(g => g.is_available);
                
                console.log("✅ Guides with availability:", formattedGuides.length, formattedGuides);
                setAvailableGuides(formattedGuides);
            } catch (err) {
                console.error("❌ Error fetching guides:", err);
                setAvailableGuides([]);
            } finally {
                setLoadingGuides(false);
            }
        };

        fetchGuides();
    }, [bookingStep, fishType, startDate, endDate]);

    // Fetch guide availability events when a guide is selected in Step 2
    useEffect(() => {
        if (bookingStep !== 2 || !selectedGuide || !startDate || !endDate) {
            setGuideAvailabilityEvents([]);
            return;
        }

        const fetchGuideAvailability = async () => {
            setLoadingGuideAvailability(true);
            try {
                console.log("📅 Fetching availability for guide:", selectedGuide.guide_id, "from", startDate, "to", endDate);
                
                // Convert dates to ISO format for Google Calendar API
                // Add time component: start at beginning of day, end at end of day
                const startISO = new Date(startDate + 'T00:00:00').toISOString();
                const endISO = new Date(endDate + 'T23:59:59').toISOString();
                
                const url = `https://fhpbftdkqnkncsagvsph.supabase.co/functions/v1/google-calendar-availability?guideId=${selectedGuide.guide_id}&start=${encodeURIComponent(startISO)}&end=${encodeURIComponent(endISO)}`;
                const res = await fetch(url, {
                    method: "GET",
                    headers: {
                        "Authorization": `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
                        "Content-Type": "application/json",
                    },
                });
                
                const data = await res.json();
                console.log("📅 Guide availability events:", data);
                
                if (data.items && Array.isArray(data.items)) {
                    // Process events to extract time slots for each day
                    const events = data.items.map(event => ({
                        id: event.id,
                        summary: event.summary || 'Disponible',
                        start: event.start?.dateTime || event.start?.date,
                        end: event.end?.dateTime || event.end?.date,
                        date: event.start?.dateTime ? event.start.dateTime.split('T')[0] : event.start?.date,
                    }));
                    setGuideAvailabilityEvents(events);
                } else {
                    setGuideAvailabilityEvents([]);
                }
            } catch (err) {
                console.error("❌ Error fetching guide availability:", err);
                setGuideAvailabilityEvents([]);
            } finally {
                setLoadingGuideAvailability(false);
            }
        };

        fetchGuideAvailability();
    }, [bookingStep, selectedGuide, startDate, endDate]);

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
            // BUT: Skip this check if user has already selected specific time slots
            // because they've already chosen from the guide's available times
            if (selectedGuide && (!selectedTimeSlots || selectedTimeSlots.length === 0)) {
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
            // If user selected time slots, the guide is confirmed available for those times

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
    }, [startDate, endDate, selectedGuide, selectedChalet, selectedTimeSlots]);

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
        setBrowseMode('trip');
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

    function startGuideFlow() {
        // Guide-only browsing flow (uses same booking steps, chalet disabled)
        setBrowseMode('guide');
        setSelectedPoint(null);
        setSelectedChalet(null);
        setSelectedGuide(null);
        setChalets([]);
        setFishType('');
        setNeedsChalet(false); // No chalet in guide-only mode
        setNumberOfPeople(2);
        setFishingZones([]);
        setStartDate('');
        setEndDate('');
        setDateConflicts(null);
        setBookingStep(1);
    }

    function startChaletFlow() {
        // Chalet-only browsing flow (guide is optional, chalet is required)
        setBrowseMode('chalet');
        setSelectedPoint(null);
        setSelectedChalet(null);
        setSelectedGuide(null);
        setChalets([]);
        setFishType('');
        setNeedsChalet(true); // Always need chalet in chalet mode
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
            setSelectedTimeSlots([]); // Clear selected time slots
            setGuideAvailabilityEvents([]); // Clear availability events
            return;
        }
        
        // Toggle selection
        if (selectedGuide?.guide_id === guide.guide_id) {
            setSelectedGuide(null);
            setSelectedTimeSlots([]); // Clear selected time slots
            setGuideAvailabilityEvents([]); // Clear availability events
        } else {
            setSelectedGuide(guide);
            setSelectedTimeSlots([]); // Clear any previously selected slots when changing guide
        }
    }

    // Handle time slot selection/deselection for guide booking
    function handleSelectTimeSlot(event) {
        setSelectedTimeSlots(prev => {
            const isAlreadySelected = prev.some(slot => slot.id === event.id);
            if (isAlreadySelected) {
                // Remove if already selected
                return prev.filter(slot => slot.id !== event.id);
            } else {
                // Add to selection
                return [...prev, {
                    id: event.id,
                    date: event.date,
                    startTime: event.start,
                    endTime: event.end,
                    summary: event.summary
                }];
            }
        });
    }

    function handleSelectGuideEvent(guide) {
        // Legacy function for compatibility - now just selects guide
        handleSelectGuide(guide);
    }

    function proceedToStep3() {
        // Validate step 2 selection based on browseMode
        if (browseMode === 'chalet') {
            if (!selectedChalet) {
                alert('Veuillez sélectionner un chalet.');
                return;
            }
        } else if (browseMode === 'guide') {
            if (!selectedGuide) {
                alert('Veuillez sélectionner un guide.');
                return;
            }
        } else {
            // Trip mode
            if (!selectedGuide && needsChalet && !selectedChalet) {
                alert('Veuillez sélectionner au moins un guide ou un chalet.');
                return;
            }
            if (!selectedGuide && !needsChalet) {
                alert('Veuillez sélectionner un guide.');
                return;
            }
        }
        setBookingStep(3);
    }

    async function handleBookGuide() {
        // Reset error state
        setBookingError(null);
        setIsCreatingBooking(true);
        
        try {
            const guideNeedsStripe = selectedGuide && selectedTimeSlots.length > 0 
                && selectedGuide.stripe_charges_enabled 
                && selectedGuide.hourly_rate > 0;
            
            // If guide needs Stripe payment, open CheckoutModal for guide first
            if (guideNeedsStripe) {
                // Calculate total hours from all selected time slots
                const totalHours = selectedTimeSlots.reduce((sum, slot) => {
                    const start = new Date(slot.startTime);
                    const end = new Date(slot.endTime);
                    return sum + (end - start) / (1000 * 60 * 60);
                }, 0);
                
                // Use the first/last slot for the combined booking timerange
                const sortedSlots = [...selectedTimeSlots].sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
                
                const guideCheckoutData = {
                    guideId: selectedGuide.guide_id,
                    startTime: sortedSlots[0].startTime,
                    endTime: sortedSlots[sortedSlots.length - 1].endTime,
                    customerName: user?.user_metadata?.name || 'Guest',
                    customerEmail: user?.email || '',
                    tripType: `Pêche ${FISH_TYPES.find(f => f.value === fishType)?.label || fishType}`,
                    numberOfPeople: numberOfPeople,
                    notes: `Réservation via Monde Sauvage - ${fishType}`,
                    durationHours: totalHours,
                    hourlyRate: selectedGuide.hourly_rate,
                    totalAmount: selectedGuide.hourly_rate * totalHours,
                    allSlots: selectedTimeSlots
                };
                
                // Save chalet data for after guide payment succeeds
                if (needsChalet && selectedChalet) {
                    setPendingChaletBooking({
                        chaletId: selectedChalet.key,
                        startDate: startDate,
                        endDate: endDate,
                        customerName: user?.user_metadata?.name || 'Guest',
                        customerEmail: user?.email || '',
                        notes: `Réservation via Monde Sauvage - ${numberOfPeople} personne(s) - Guide: ${selectedGuide.name}`,
                        pricePerNight: selectedChalet.price_per_night || 0,
                        chaletName: selectedChalet.name || selectedChalet.chalet_name || 'Chalet'
                    });
                }
                
                setPaymentCheckoutData(guideCheckoutData);
                setPaymentCheckoutType('guide');
                setShowPaymentCheckout(true);
                setIsCreatingBooking(false);
                return; // Wait for payment callback
            }
            
            // No Stripe needed — use existing direct flow
            const bookingResults = {
                guideBookings: [],
                chaletBooking: null
            };
            
            // 1. Create guide bookings directly (no Stripe)
            if (selectedGuide && selectedTimeSlots.length > 0) {
                console.log('📅 Creating guide bookings for selected time slots:', selectedTimeSlots);
                
                for (const slot of selectedTimeSlots) {
                    const guideBookingData = {
                        guideId: selectedGuide.guide_id,
                        startTime: slot.startTime,
                        endTime: slot.endTime,
                        customerName: user?.user_metadata?.name || 'Guest',
                        customerEmail: user?.email || '',
                        tripType: `Pêche ${FISH_TYPES.find(f => f.value === fishType)?.label || fishType}`,
                        numberOfPeople: numberOfPeople,
                        notes: `Réservation via Monde Sauvage - ${fishType}`,
                        status: 'pending',
                        skipAvailabilityCheck: true
                    };
                    
                    const guideBooking = await createGuideBooking(guideBookingData);
                    bookingResults.guideBookings.push(guideBooking);
                    console.log('✅ Guide booking created:', guideBooking);
                }
            }
            
            // 2. Create chalet booking directly (no Stripe)
            if (needsChalet && selectedChalet) {
                console.log('🏠 Creating chalet booking:', selectedChalet);
                
                const chaletBookingData = {
                    chaletId: selectedChalet.key,
                    startDate: startDate,
                    endDate: endDate,
                    customerName: user?.user_metadata?.name || 'Guest',
                    customerEmail: user?.email || '',
                    notes: `Réservation via Monde Sauvage - ${numberOfPeople} personne(s)${selectedGuide ? ` - Guide: ${selectedGuide.name}` : ''}`
                };
                
                const chaletBooking = await createBooking(chaletBookingData);
                bookingResults.chaletBooking = chaletBooking;
                console.log('✅ Chalet booking created:', chaletBooking);
            }
            
            console.log('🎉 All bookings created successfully:', bookingResults);
            setBookingStep(4);
            
        } catch (error) {
            console.error('❌ Error creating booking:', error);
            setBookingError(error.message || 'Une erreur est survenue lors de la réservation');
        } finally {
            setIsCreatingBooking(false);
        }
    }

    function handleGuideBookingCreated(booking) {
        console.log("Guide booking created:", booking);
        setIsGuideBookingModalOpen(false);
        setBookingStep(4);
    }

    // Handle payment success from the main booking flow CheckoutModal
    async function handleMainFlowPaymentSuccess(result) {
        console.log('💳 Payment success for', paymentCheckoutType, result);
        setShowPaymentCheckout(false);
        setPaymentCheckoutData(null);
        
        if (paymentCheckoutType === 'guide') {
            // Guide payment done. Check if there's a pending chalet booking
            if (pendingChaletBooking) {
                const chaletData = pendingChaletBooking;
                setPendingChaletBooking(null);
                
                // For now, create chalet booking directly (chalet Stripe handled via ChaletDetailModal separately)
                try {
                    const chaletBooking = await createBooking({
                        chaletId: chaletData.chaletId,
                        startDate: chaletData.startDate,
                        endDate: chaletData.endDate,
                        customerName: chaletData.customerName,
                        customerEmail: chaletData.customerEmail,
                        notes: chaletData.notes
                    });
                    console.log('✅ Chalet booking created after guide payment:', chaletBooking);
                } catch (err) {
                    console.warn('⚠️ Chalet booking failed after guide payment:', err);
                }
            }
            setPaymentCheckoutType(null);
            setBookingStep(4);
        } else if (paymentCheckoutType === 'chalet') {
            setPaymentCheckoutType(null);
            setBookingStep(4);
        }
    }

    function handleMainFlowPaymentClose() {
        setShowPaymentCheckout(false);
        setPaymentCheckoutData(null);
        setPaymentCheckoutType(null);
        setPendingChaletBooking(null);
        setIsCreatingBooking(false);
    }

    function resetBookingFlow() {
        setBookingStep(0);
        setBrowseMode('trip');
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
        setGuideAvailabilityEvents([]);
        setSelectedTimeSlots([]);
        setBookingError(null);
        setIsCreatingBooking(false);
        // Reset payment state
        setShowPaymentCheckout(false);
        setPaymentCheckoutData(null);
        setPaymentCheckoutType(null);
        setPendingChaletBooking(null);
    }

    // Validation for step 1: preferences + dates
    // In chalet-only mode, fish type is optional
    const canProceedStep1 = numberOfPeople > 0 && 
        (browseMode === 'chalet' || fishType !== '') && 
        startDate && 
        endDate && 
        new Date(endDate) > new Date(startDate);

    // Validation for step 2: guide/chalet selection
    // Adapts based on browseMode
    const canProceedStep2 = browseMode === 'chalet'
        ? (selectedChalet != null) // Chalet mode: just need a chalet
        : browseMode === 'guide'
        ? (selectedGuide && selectedTimeSlots.length > 0) // Guide mode: need guide + slots
        : (selectedGuide && selectedTimeSlots.length > 0) || 
          (!selectedGuide && needsChalet && selectedChalet) ||
          (selectedGuide && selectedTimeSlots.length > 0 && needsChalet && selectedChalet);

    // Validation for step 3: availability confirmed (dates already validated in step 1)
    const canProceedStep3 = !dateConflicts?.guide && 
        !dateConflicts?.chalet;
    
    return (
        <div>
            <GaspesieMap 
                onClick={onClick}
                radius={radius}
                login={login}
                isTripOpen={startBookingFlow}
                isGuideFlowOpen={startGuideFlow}
                isChaletFlowOpen={startChaletFlow}
                isAccountSettingsOpen={() => setIsAccountSettingsOpen(true)}
                user={user}
                profile={profile}
                guide={guide}
                isRejoindreOpen={setIsRejoindreOpen}
                isEtablissementOpen={setIsEtablissementOpen}
                // Pass booking flow state to control the sidebar
                browseMode={browseMode}
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
                // NEW: Booking creation state
                isCreatingBooking={isCreatingBooking}
                bookingError={bookingError}
                // NEW: Guide availability time slots
                guideAvailabilityEvents={guideAvailabilityEvents}
                loadingGuideAvailability={loadingGuideAvailability}
                selectedTimeSlots={selectedTimeSlots}
                handleSelectTimeSlot={handleSelectTimeSlot}
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
            
            <GuideClientModal
                isOpen={isGuideClientModalOpen}
                onClose={() => {
                    setIsGuideClientModalOpen(false);
                    if (settingsWasOpenBeforeClients) {
                        setSettingsWasOpenBeforeClients(false);
                        setIsAccountSettingsOpen(true);
                    }
                }}
                guide={guide}
                profile={profile}
            />

            <JoinUs
                isRejoindreOpen={isRejoindreOpen}
                onClose={() => setIsRejoindreOpen(false)}
            />

            <EtablissementModal
                isEtablissementOpen={isEtablissementOpen}
                onClose={() => setIsEtablissementOpen(false)}
            />

            <AccountSettingsModal
                isOpen={isAccountSettingsOpen}
                onClose={() => setIsAccountSettingsOpen(false)}
                user={user}
                profile={profile}
                guide={guide}
                onOpenClients={() => {
                    setSettingsWasOpenBeforeClients(true);
                    setIsAccountSettingsOpen(false);
                    setIsGuideClientModalOpen(true);
                }}
                onOpenHelp={() => openOnboarding(true)}
            />

            <GuideBookingModal
                guide={guideForBooking}
                isOpen={isGuideBookingModalOpen}
                onClose={() => setIsGuideBookingModalOpen(false)}
                onBookingCreated={handleGuideBookingCreated}
            />

            {/* Guide Onboarding */}
            <HighlightOverlay 
                targetId={highlightedElement} 
                isActive={isOnboardingOpen && highlightedElement !== null}
                onBackdropClick={() => {
                    // Mark as complete when clicking backdrop
                    localStorage.setItem('guide_onboarding_complete', 'true');
                    setIsOnboardingOpen(false);
                    setHighlightedElement(null);
                }}
            />
            <GuideOnboardingModal
                isOpen={isOnboardingOpen}
                onClose={() => {
                    setIsOnboardingOpen(false);
                    setHighlightedElement(null);
                }}
                onComplete={() => {
                    setHighlightedElement(null);
                }}
                onHighlightElement={setHighlightedElement}
                startStep={onboardingStartStep}
            />

            {/* Stripe Payment Checkout for main booking flow */}
            {showPaymentCheckout && paymentCheckoutData && (
                <CheckoutModal
                    isOpen={showPaymentCheckout}
                    onClose={handleMainFlowPaymentClose}
                    bookingData={paymentCheckoutData}
                    bookingType={paymentCheckoutType}
                    title={paymentCheckoutType === 'guide' ? selectedGuide?.name : selectedChalet?.name}
                    onSuccess={handleMainFlowPaymentSuccess}
                />
            )}
            
        </div>
    );
}

export default MapApp;