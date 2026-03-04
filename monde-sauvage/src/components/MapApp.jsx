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
import { createGuideBooking, checkGuideConflictsServer } from "../utils/guideBookingService.js";
import { createBooking } from "../utils/bookingService.js";
import { resumeBookingPayment } from "../utils/stripeService.js";
import CheckoutModal from "../modals/checkoutModal.jsx";
import ReservationCart from "./ReservationCart.jsx";

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
                    .not('google_refresh_token', 'is', null)
                    .neq('calendar_connection_status', 'disconnected');
                
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
                // Use Z-suffix to ensure UTC interpretation (avoids local-timezone day shift)
                const startISO = `${startDate}T00:00:00Z`;
                const endISO = `${endDate}T23:59:59Z`;
                
                console.log("📆 Date inputs:", { startDate, endDate });
                console.log("📆 ISO dates (UTC):", { startISO, endISO });
                
                const availabilityUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-calendar-availability-all?start=${encodeURIComponent(startISO)}&end=${encodeURIComponent(endISO)}`;
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
                        console.log(`  📊 Guide ${item.guide_id} (${item.name}): is_available=${item.is_available}, net_windows=${item.net_available_windows ?? '?'}, events=${item.events?.length || 0}, booked=${item.booked_slots?.length || 0}, error=${item.error || 'none'}`);
                        availabilityMap.set(item.guide_id, item);
                    });
                } else {
                    console.warn("⚠️ availabilityData is not an array:", availabilityData);
                }
                
                // ── Availability keyword matching (same word bank as edge function) ──
                // Used as a client-side safety net — the server now also does this computation.
                const AVAILABILITY_KEYWORDS = /dispo|disponible|disponibilit[eé]|available|availability|free|open|slot/i;
                const normalizeText = (t) => (t || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
                const isAvailabilityEvent = (ev) => {
                    const raw = `${ev.summary || ''} ${ev.description || ''} ${ev.location || ''}`;
                    return AVAILABILITY_KEYWORDS.test(normalizeText(raw));
                };

                // Transform guides — use server-side availability determination as PRIMARY,
                // with client-side subtraction as a SECONDARY safety net.
                const formattedGuides = (guides || [])
                    .map(g => {
                        const availability = availabilityMap.get(g.id);

                        // If the API explicitly returned an error, guide is unavailable
                        if (availability?.error) {
                            console.log(`🔍 Guide ${g.name}: error=${availability.error} → hidden`);
                            return null;
                        }

                        // If guide is NOT in the response, skip (no calendar data)
                        if (!availability) {
                            console.log(`🔍 Guide ${g.name}: not in availability response → hidden`);
                            return null;
                        }

                        // ── PRIMARY CHECK: Use server-computed is_available ──
                        // The server now does full keyword matching + booking subtraction
                        // and returns is_available=false if all availability is consumed.
                        if (availability.is_available === false) {
                            console.log(`🔍 Guide ${g.name}: server says is_available=false (${availability.net_available_windows ?? 0} net windows) → hidden`);
                            return null;
                        }

                        const rawEvents = availability.events || [];
                        const bookedSlots = availability.booked_slots || [];

                        // ── SECONDARY CHECK: Client-side subtraction as safety net ──
                        const bookedIntervals = bookedSlots.map(slot => {
                            let s = new Date(slot.start).getTime();
                            let e = new Date(slot.end).getTime();
                            // Date-only bookings: start===end (both midnight UTC). Expand to full day.
                            if (!isNaN(s) && !isNaN(e) && s >= e) e = s + 24 * 60 * 60 * 1000;
                            return { start: s, end: e };
                        }).filter(b => !isNaN(b.start) && !isNaN(b.end) && b.start < b.end);

                        let totalNetWindows = 0;
                        for (const ev of rawEvents) {
                            if (ev.status === 'cancelled') continue;
                            if (!isAvailabilityEvent(ev)) continue;

                            const startStr = ev.start?.dateTime || ev.start?.date;
                            const endStr = ev.end?.dateTime || ev.end?.date;
                            if (!startStr || !endStr) continue;

                            const evStart = new Date(startStr).getTime();
                            const evEnd = new Date(endStr).getTime();
                            if (isNaN(evStart) || isNaN(evEnd) || evStart >= evEnd) continue;

                            const remaining = subtractBookings(evStart, evEnd, bookedIntervals);
                            totalNetWindows += remaining.length;
                        }

                        const hasAvailability = totalNetWindows > 0;
                        console.log(`🔍 Guide ${g.name}: server=${availability.is_available}, client=${hasAvailability} (${rawEvents.length} events, ${bookedSlots.length} bookings, ${totalNetWindows} net windows)`);

                        // Guide must pass BOTH server and client checks
                        if (!hasAvailability) {
                            console.log(`🔍 Guide ${g.name}: client-side check says no availability → hidden`);
                            return null;
                        }

                        return {
                            guide_id: g.id,
                            name: g.name,
                            email: g.email,
                            fish_types: g.fish_types || [],
                            hourly_rate: g.hourly_rate,
                            stripe_charges_enabled: g.stripe_charges_enabled || false,
                            stripe_account_id: g.stripe_account_id || null,
                            is_available: true,
                            events: rawEvents,
                            booked_slots: bookedSlots
                        };
                    })
                    .filter(g => g !== null);
                
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
    }, [bookingStep, fishType, startDate, endDate, browseMode]);

    // ── Interval subtraction helper ─────────────────────────────
    // Given an availability window and a list of booked intervals,
    // returns the remaining sub-windows after removing all overlaps.
    // This correctly handles partial overlaps (splits the window).
    const subtractBookings = useCallback((availStart, availEnd, bookedIntervals) => {
        const sorted = bookedIntervals
            .filter(b => b.start < availEnd && b.end > availStart) // only overlapping
            .sort((a, b) => a.start - b.start);

        if (sorted.length === 0) return [{ start: availStart, end: availEnd }];

        const result = [];
        let cursor = availStart;

        for (const busy of sorted) {
            if (busy.start > cursor) {
                result.push({ start: cursor, end: Math.min(busy.start, availEnd) });
            }
            cursor = Math.max(cursor, busy.end);
            if (cursor >= availEnd) break;
        }
        if (cursor < availEnd) {
            result.push({ start: cursor, end: availEnd });
        }
        // Filter out windows shorter than 15 minutes
        return result.filter(r => r.end - r.start >= 15 * 60 * 1000);
    }, []);

    // Fetch guide availability events when a guide is selected in Step 2
    // Also refresh every 30 seconds to detect bookings made by other users.
    useEffect(() => {
        if (bookingStep !== 2 || !selectedGuide || !startDate || !endDate) {
            setGuideAvailabilityEvents([]);
            return;
        }

        const fetchGuideAvailability = async (isRefresh = false) => {
            if (!isRefresh) setLoadingGuideAvailability(true);
            try {
                console.log("📅 Fetching availability for guide:", selectedGuide.guide_id, "from", startDate, "to", endDate);
                
                // Convert dates to ISO format for Google Calendar API
                // Use Z-suffix for explicit UTC (prevents local-tz day boundary shift)
                const startISO = `${startDate}T00:00:00Z`;
                const endISO = `${endDate}T23:59:59Z`;
                
                const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-calendar-availability?guideId=${selectedGuide.guide_id}&start=${encodeURIComponent(startISO)}&end=${encodeURIComponent(endISO)}`;
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
                    // IMPORTANT: Use LOCAL date for grouping, not UTC date.
                    // This prevents events near midnight UTC from being grouped
                    // under the wrong day relative to the guide's timezone.
                    const events = data.items.map(event => {
                        const startStr = event.start?.dateTime || event.start?.date;
                        const endStr = event.end?.dateTime || event.end?.date;
                        // Derive local date for display grouping
                        const startDate_obj = new Date(startStr);
                        const localDate = !isNaN(startDate_obj.getTime())
                            ? `${startDate_obj.getFullYear()}-${String(startDate_obj.getMonth()+1).padStart(2,'0')}-${String(startDate_obj.getDate()).padStart(2,'0')}`
                            : (startStr || '').split('T')[0];
                        return {
                            id: event.id,
                            summary: event.summary || 'Disponible',
                            start: startStr,
                            end: endStr,
                            date: localDate,
                        };
                    });

                    // ── Build a combined list of booked intervals ──────────
                    // Use BOTH the guide's booked_slots (from the -all endpoint,
                    // fetched with service-role key — reliable) AND a fresh DB
                    // query as a safety-net.
                    const bookedIntervals = [];

                    // Source 1: booked_slots already loaded on guide object
                    if (selectedGuide.booked_slots && selectedGuide.booked_slots.length > 0) {
                        for (const slot of selectedGuide.booked_slots) {
                            let s = new Date(slot.start).getTime();
                            let e = new Date(slot.end).getTime();
                            // Date-only bookings: start===end. Expand to full day.
                            if (!isNaN(s) && !isNaN(e) && s >= e) e = s + 24 * 60 * 60 * 1000;
                            if (!isNaN(s) && !isNaN(e) && s < e) {
                                bookedIntervals.push({ start: s, end: e });
                            }
                        }
                        console.log('📋 Booked slots from guide object:', selectedGuide.booked_slots.length);
                    }

                    // Source 2: fresh DB query (may fail due to RLS — that's OK,
                    // source 1 is the primary defense)
                    try {
                        const { data: dbBookings, error: dbError } = await supabase
                            .from('guide_booking')
                            .select('id, start_time, end_time, status')
                            .eq('guide_id', selectedGuide.guide_id)
                            .is('deleted_at', null)
                            .not('status', 'in', '("cancelled","deleted")')
                            .lt('start_time', endISO)
                            .gt('end_time', startISO);

                        if (dbError) {
                            console.warn('⚠️ DB booking query error (using booked_slots fallback):', dbError);
                        } else if (dbBookings && dbBookings.length > 0) {
                            console.log('📋 Fresh DB bookings found:', dbBookings.length);
                            for (const booking of dbBookings) {
                                let s = new Date(booking.start_time).getTime();
                                let e = new Date(booking.end_time).getTime();
                                // Date-only bookings: start===end. Expand to full day.
                                if (!isNaN(s) && !isNaN(e) && s >= e) e = s + 24 * 60 * 60 * 1000;
                                if (!isNaN(s) && !isNaN(e) && s < e) {
                                    bookedIntervals.push({ start: s, end: e });
                                }
                            }
                        }
                    } catch (dbErr) {
                        console.warn('⚠️ Could not query DB for bookings:', dbErr);
                    }

                    // De-duplicate overlapping intervals (merge them)
                    const mergedBookings = [];
                    if (bookedIntervals.length > 0) {
                        const sorted = [...bookedIntervals].sort((a, b) => a.start - b.start);
                        let current = { ...sorted[0] };
                        for (let i = 1; i < sorted.length; i++) {
                            if (sorted[i].start <= current.end) {
                                current.end = Math.max(current.end, sorted[i].end);
                            } else {
                                mergedBookings.push(current);
                                current = { ...sorted[i] };
                            }
                        }
                        mergedBookings.push(current);
                    }

                    console.log('📋 Total merged booking intervals:', mergedBookings.length);

                    // ── Subtract bookings from each availability event ───
                    // This handles partial overlaps by splitting events into
                    // the remaining available sub-windows.
                    if (mergedBookings.length > 0) {
                        const resultEvents = [];
                        for (const event of events) {
                            const evStart = new Date(event.start).getTime();
                            const evEnd = new Date(event.end).getTime();
                            if (isNaN(evStart) || isNaN(evEnd)) continue;

                            const remaining = subtractBookings(evStart, evEnd, mergedBookings);
                            for (const window of remaining) {
                                const windowStartDate = new Date(window.start);
                                // Use LOCAL date for grouping (not UTC split)
                                const localDate = `${windowStartDate.getFullYear()}-${String(windowStartDate.getMonth()+1).padStart(2,'0')}-${String(windowStartDate.getDate()).padStart(2,'0')}`;
                                resultEvents.push({
                                    id: `${event.id}_${window.start}`,
                                    summary: event.summary,
                                    start: windowStartDate.toISOString(),
                                    end: new Date(window.end).toISOString(),
                                    date: localDate,
                                });
                            }
                        }
                        console.log(`✅ After subtracting bookings: ${resultEvents.length} available slots (from ${events.length} events)`);
                        setGuideAvailabilityEvents(resultEvents);
                    } else {
                        setGuideAvailabilityEvents(events);
                    }
                } else {
                    setGuideAvailabilityEvents([]);
                }
            } catch (err) {
                console.error("❌ Error fetching guide availability:", err);
                if (!isRefresh) setGuideAvailabilityEvents([]);
            } finally {
                setLoadingGuideAvailability(false);
            }
        };

        fetchGuideAvailability(false);

        // Refresh availability every 30 seconds to detect bookings by other users.
        // Silent refresh — doesn't show loading indicator to avoid UI flicker.
        const refreshInterval = setInterval(() => {
            console.log('🔄 Auto-refreshing guide availability…');
            fetchGuideAvailability(true);
        }, 30_000);

        return () => clearInterval(refreshInterval);
    }, [bookingStep, selectedGuide, startDate, endDate, subtractBookings]);

    // ── Clean up stale selected time slots when availability refreshes ──
    // If a selected slot no longer appears in the available events
    // (e.g. another user booked it), remove it from the selection.
    useEffect(() => {
        if (selectedTimeSlots.length === 0 || guideAvailabilityEvents.length === 0) return;

        const stillValid = selectedTimeSlots.filter(slot => {
            // Check if the slot's time range still overlaps with any available event
            const slotStart = new Date(slot.startTime).getTime();
            const slotEnd = new Date(slot.endTime).getTime();
            return guideAvailabilityEvents.some(event => {
                const evStart = new Date(event.start).getTime();
                const evEnd = new Date(event.end).getTime();
                // The selected slot must be fully contained within an available event
                return evStart <= slotStart && evEnd >= slotEnd;
            });
        });

        if (stillValid.length < selectedTimeSlots.length) {
            const removedCount = selectedTimeSlots.length - stillValid.length;
            console.warn(`⚠️ ${removedCount} selected slot(s) no longer available — removing`);
            setSelectedTimeSlots(stillValid);
            if (removedCount > 0 && stillValid.length === 0) {
                setBookingError('Le(s) créneau(x) sélectionné(s) vien(nen)t d\'être réservé(s) par un autre utilisateur. Veuillez en choisir un autre.');
            }
        }
    }, [guideAvailabilityEvents]);

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
                const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-calendar-availability?guideId=${selectedGuide.guide_id}&start=${startDate}&end=${endDate}`;
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
        setAvailableGuides([]);
        setGuideAvailabilityEvents([]);
        setSelectedTimeSlots([]);
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
        setAvailableGuides([]);
        setGuideAvailabilityEvents([]);
        setSelectedTimeSlots([]);
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
        setAvailableGuides([]);
        setGuideAvailabilityEvents([]);
        setSelectedTimeSlots([]);
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
                const slot = {
                    id: event.id,
                    date: event.date,
                    startTime: event.start,
                    endTime: event.end,
                    summary: event.summary
                };
                console.log('[DATE TRACE] Time slot selected:', {
                    startTime: slot.startTime,
                    endTime: slot.endTime,
                    startLocal: new Date(slot.startTime).toLocaleString(),
                    endLocal: new Date(slot.endTime).toLocaleString(),
                    dateGroup: slot.date,
                    browserTZ: Intl.DateTimeFormat().resolvedOptions().timeZone,
                });
                return [...prev, slot];
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
            // ── Server-side conflict check before proceeding ──────────
            // Prevents stale-data race conditions: another user may have
            // booked the same slot since availability was last fetched.
            if (selectedGuide && selectedTimeSlots.length > 0) {
                const sortedSlots = [...selectedTimeSlots].sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
                const firstStart = sortedSlots[0].startTime;
                const lastEnd = sortedSlots[sortedSlots.length - 1].endTime;

                try {
                    const conflictResult = await checkGuideConflictsServer(
                        selectedGuide.guide_id,
                        firstStart,
                        lastEnd
                    );
                    if (!conflictResult.available) {
                        setBookingError('Ce créneau vient d\'être réservé par un autre utilisateur. Veuillez rafraîchir et choisir un autre horaire.');
                        setIsCreatingBooking(false);
                        return;
                    }
                } catch (conflictErr) {
                    console.warn('Server conflict check failed — proceeding (stripe-create-booking will validate):', conflictErr);
                }
            }

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
                
                // DATE SHIFT GUARD: Log the exact values being sent to the backend
                console.log('[DATE TRACE] Checkout payload:', {
                    startTime: guideCheckoutData.startTime,
                    endTime: guideCheckoutData.endTime,
                    startLocal: new Date(guideCheckoutData.startTime).toLocaleString(),
                    endLocal: new Date(guideCheckoutData.endTime).toLocaleString(),
                    browserTZ: Intl.DateTimeFormat().resolvedOptions().timeZone,
                });
                
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

        // Capture checkout data before clearing state
        const currentCheckoutData = paymentCheckoutData;
        const currentCheckoutType = paymentCheckoutType;

        setShowPaymentCheckout(false);
        setPaymentCheckoutData(null);

        // Sync Google Calendar event for guide booking (frontend backup — webhook also does this)
        if (currentCheckoutType === 'guide' && result?.bookingId && currentCheckoutData) {
            try {
                const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
                const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
                await fetch(`${SUPABASE_URL}/functions/v1/create-guide-booking-event`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        booking_id: result.bookingId,
                        guide_id: currentCheckoutData.guideId,
                        start_time: currentCheckoutData.startTime,
                        end_time: currentCheckoutData.endTime,
                        customer_name: currentCheckoutData.customerName,
                        customer_email: currentCheckoutData.customerEmail,
                        trip_type: currentCheckoutData.tripType,
                        notes: currentCheckoutData.notes,
                    })
                });
                console.log('📅 Google Calendar event synced for guide booking');
            } catch (calendarErr) {
                console.warn('⚠️ Could not sync Google Calendar event:', calendarErr);
            }
        }
        
        if (currentCheckoutType === 'guide') {
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
        } else if (currentCheckoutType === 'chalet') {
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

            {/* Reservation Cart — shows pending unpaid bookings */}
            {user && (
                <ReservationCart
                    userEmail={user.email}
                    onResumePayment={async (booking) => {
                        try {
                            // Get client_secret for existing booking via dedicated endpoint
                            const result = await resumeBookingPayment(booking.id);
                            // Open CheckoutModal with pre-fetched result
                            setPaymentCheckoutData({
                                guideId: booking.guide_id,
                                startTime: booking.start_time,
                                endTime: booking.end_time,
                                customerName: booking.customer_name,
                                customerEmail: booking.customer_email,
                                tripType: booking.trip_type,
                                numberOfPeople: booking.number_of_people,
                                notes: booking.notes,
                                // Attach the pre-fetched result so CheckoutModal skips booking creation
                                _resumeResult: result,
                            });
                            setPaymentCheckoutType('guide');
                            setShowPaymentCheckout(true);
                        } catch (err) {
                            console.error('Failed to resume payment:', err);
                            alert('Erreur lors de la reprise du paiement: ' + err.message);
                        }
                    }}
                />
            )}
            
        </div>
    );
}

export default MapApp;