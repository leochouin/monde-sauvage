import { lazy, Suspense, useEffect, useState, useCallback, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import GuideOnboardingModal, { shouldShowGuideOnboarding } from "../modals/guideOnboardingModal.jsx";
import HighlightOverlay from "./HighlightOverlay.jsx";
import { toast } from "../utils/toast.js";
import supabase from "../utils/supabase.js";
import { createGuideBooking, checkGuideConflictsServer } from "../utils/guideBookingService.js";
import { createBooking } from "../utils/bookingService.js";
import { resumeBookingPayment } from "../utils/stripeService.js";
import { getGuideByUserId } from "../utils/socialFeedService.js";
import {
    buildNearbyDateCandidates,
    curateAlternativeDateOptions,
    dateRangeKey,
} from "../utils/altDatePlanner.js";
import {
    resolveAvatarFromSources,
} from "../utils/avatar.js";
import {
    formatRiverDisplayName,
    getKnownRiverPathIds,
    getRiverByPathId,
    getRiverGuideByPathId,
    RIVER_CENTERS_BY_PATH_ID,
} from "../utils/riverGuideData.js";
import { expandAllDayEvent } from "../utils/guideSchedule.js";

const GaspesieMap = lazy(() => import("./Map.jsx"));
const SocialFeedPage = lazy(() => import("../pages/SocialFeedPage.jsx"));
const LoginModal = lazy(() => import("../modals/loginModal.jsx"));
const JoinUs = lazy(() => import("../modals/joinUsModal.jsx"));
const EtablissementModal = lazy(() => import("../modals/etablissementModal.jsx"));
const GuideBookingModal = lazy(() => import("../modals/guideBookingModal.jsx"));
const GuideProfilePreviewModal = lazy(() => import("../modals/guideProfilePreviewModal.jsx"));
const GuideClientModal = lazy(() => import("../modals/guideClientModal.jsx"));
const AccountSettingsModal = lazy(() => import("../modals/accountSettingsModal.jsx"));
const CheckoutModal = lazy(() => import("../modals/checkoutModal.jsx"));
const ReservationCart = lazy(() => import("./ReservationCart.jsx"));

const FISH_TYPES_BASE = [
    { value: 'saumon', labelFr: 'Saumon Atlantique', labelEn: 'Atlantic Salmon' },
    { value: 'truite', labelFr: 'Truite mouchetée', labelEn: 'Brook Trout' },
    { value: 'omble', labelFr: 'Omble de fontaine', labelEn: 'Arctic Char' },
    { value: 'brochet', labelFr: 'Brochet', labelEn: 'Northern Pike' },
    { value: 'perchaude', labelFr: 'Perchaude', labelEn: 'Yellow Perch' },
    { value: 'bar', labelFr: 'Bar rayé', labelEn: 'Striped Bass' },
    { value: 'maquereau', labelFr: 'Maquereau', labelEn: 'Mackerel' },
    { value: 'plie', labelFr: 'Plie', labelEn: 'Plaice' },
    { value: 'capelan', labelFr: 'Capelan', labelEn: 'Capelin' }
];

function MapApp({ user, profile, guide, language = 'fr', setLanguage }) {
    const navigate = useNavigate();
    const location = useLocation();
    const isSocialRoute = location.pathname === '/social';
    const isEnglish = language === 'en';
    const knownRivers = getKnownRiverPathIds();
    const formatRiverName = useCallback((id) => formatRiverDisplayName(id, language), [language]);
    const getRiverDetails = useCallback((id) => getRiverGuideByPathId(id), []);
    const FISH_TYPES = FISH_TYPES_BASE.map((fish) => ({
        value: fish.value,
        label: isEnglish ? fish.labelEn : fish.labelFr,
    }));

    // Réservation : 1 destination, 2 dates, 3 guide/chalet, 4 équipements (si chalet), confirmation 4 ou 5.
    
    // Browse mode: 'trip' = full flow, 'guide' = guide-only, 'chalet' = chalet-only
    const [browseMode, setBrowseMode] = useState('trip');
    
    // Account settings modal — restore open state across reloads via sessionStorage
    const [isAccountSettingsOpen, setIsAccountSettingsOpen] = useState(() => {
        try { return sessionStorage.getItem('ms_settings_open') === '1'; } catch { return false; }
    });
    const openAccountSettings = () => {
        try { sessionStorage.setItem('ms_settings_open', '1'); } catch {}
        setIsAccountSettingsOpen(true);
    };
    const closeAccountSettings = () => {
        try { sessionStorage.removeItem('ms_settings_open'); } catch {}
        setIsAccountSettingsOpen(false);
    };
    
    // Booking flow state
    const [bookingStep, setBookingStep] = useState(0); // 0=closed, 1=dest, 2=dates, 3=guide/chalet, 4=équipements (si chalet), 4|5=confirmation selon parcours
    
    // Step 1: Trip preferences
    const [numberOfPeople, setNumberOfPeople] = useState(2);
    const [fishType, setFishType] = useState('');
    const [needsChalet, setNeedsChalet] = useState(true);

    const bookingConfirmationStep = useMemo(() => (
      (browseMode === 'chalet' || (browseMode === 'trip' && needsChalet)) ? 5 : 4
    ), [browseMode, needsChalet]);

    const [fishingZones, setFishingZones] = useState([]);
    const [loadingZones, setLoadingZones] = useState(false);
    
    // Step 1: Destination (river selection OR radius circle — both coexist)
    const [selectedRiver, setSelectedRiver] = useState(null);

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
    // Step 3: Date selection (moved to after guide/chalet)
    const [startDate, setStartDate] = useState("");
    const [endDate, setEndDate] = useState("");
    const [originalStartDate, setOriginalStartDate] = useState("");
    const [originalEndDate, setOriginalEndDate] = useState("");
    const [alternativeDateOptions, setAlternativeDateOptions] = useState([]);
    const [loadingAlternativeDates, setLoadingAlternativeDates] = useState(false);
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
    const [isGuideProfilePreviewOpen, setIsGuideProfilePreviewOpen] = useState(false);
    const [guideForBooking, setGuideForBooking] = useState(null);
    const [isGuideClientModalOpen, setIsGuideClientModalOpen] = useState(false);
    const [settingsWasOpenBeforeClients, setSettingsWasOpenBeforeClients] = useState(false);
    
    // Stripe payment checkout state for main booking flow
    const [showPaymentCheckout, setShowPaymentCheckout] = useState(false);
    const [paymentCheckoutData, setPaymentCheckoutData] = useState(null);
    const [paymentCheckoutType, setPaymentCheckoutType] = useState(null); // 'guide' | 'chalet' | 'combined'

    /** Types d'équipements (addons) pour l'établissement du chalet sélectionné */
    const [equipmentKinds, setEquipmentKinds] = useState([]);
    const [loadingEquipmentKinds, setLoadingEquipmentKinds] = useState(false);
    /** Quantités demandées par slug (ex. { chaloupe: 2 }) */
    const [inventoryAddonQtyBySlug, setInventoryAddonQtyBySlug] = useState({});
    /** Stock disponible par equipment_kind_id pour les dates choisies */
    const [availableCountByKindId, setAvailableCountByKindId] = useState({});
    /** true une fois que get_available_equipment_counts a retourné (même si vide) */
    const [availableCountsLoaded, setAvailableCountsLoaded] = useState(false);

    const buildInventoryAddonsForCheckout = useCallback(() => {
        const lines = [];
        for (const kind of equipmentKinds) {
            const q = Math.floor(Number(inventoryAddonQtyBySlug[kind.slug] ?? 0));
            if (q > 0) lines.push({ slug: kind.slug, quantity: Math.min(50, q) });
        }
        return lines;
    }, [equipmentKinds, inventoryAddonQtyBySlug]);

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
    
    useEffect(() => {
        const estId = selectedChalet?.etablishment_id;
        if (!estId || !needsChalet) {
            setEquipmentKinds([]);
            setLoadingEquipmentKinds(false);
            return;
        }
        let cancelled = false;
        setLoadingEquipmentKinds(true);
        (async () => {
            const { data, error } = await supabase
                .from('equipment_kind')
                .select('id, slug, label, metadata')
                .eq('establishment_id', estId)
                .eq('is_active', true)
                .order('slug');
            if (cancelled) return;
            if (error) {
                console.warn('equipment_kind:', error.message);
                setEquipmentKinds([]);
            } else {
                setEquipmentKinds(data || []);
            }
            setLoadingEquipmentKinds(false);
        })();
        return () => { cancelled = true; };
    }, [selectedChalet?.etablishment_id, needsChalet]);

    useEffect(() => {
        setInventoryAddonQtyBySlug({});
        setAvailableCountByKindId({});
        setAvailableCountsLoaded(false);
    }, [selectedChalet?.key || selectedChalet?.id]);

    // Fetch available stock counts when entering the equipment step
    useEffect(() => {
        const estId = selectedChalet?.etablishment_id;
        const chaletId = selectedChalet?.key || selectedChalet?.id;
        if (!estId || !chaletId || !startDate || !endDate || !needsChalet) {
            setAvailableCountByKindId({});
            return;
        }
        let cancelled = false;
        (async () => {
            const { data, error } = await supabase.rpc('get_available_equipment_counts', {
                p_establishment_id: estId,
                p_chalet_id: chaletId,
                p_start_date: startDate,
                p_end_date: endDate,
            });
            if (cancelled) return;
            if (error) {
                console.warn('get_available_equipment_counts:', error.message);
                setAvailableCountsLoaded(true);
                return;
            }
            const map = {};
            for (const row of data || []) {
                map[row.equipment_kind_id] = Number(row.available_count);
            }
            setAvailableCountByKindId(map);
            setAvailableCountsLoaded(true);
        })();
        return () => { cancelled = true; };
    }, [selectedChalet?.etablishment_id, selectedChalet?.key, selectedChalet?.id, startDate, endDate, needsChalet]);

    // Sync Stripe readiness from latest RPC row (évite chalet sans stripe_charges_enabled après refresh liste).
    useEffect(() => {
        if (!selectedChalet?.key || !Array.isArray(chalets)) return;
        const row = chalets.find((c) => String(c.key) === String(selectedChalet.key));
        if (!row || typeof row.stripe_charges_enabled === 'undefined') return;
        if (selectedChalet.stripe_charges_enabled === row.stripe_charges_enabled) return;
        setSelectedChalet((prev) => (prev ? { ...prev, stripe_charges_enabled: row.stripe_charges_enabled } : prev));
    }, [chalets, selectedChalet?.key, selectedChalet?.stripe_charges_enabled]);

    // Listen for chalet selection signaled from a detail page tab
    useEffect(() => {
        const handleStorage = (e) => {
            if (e.key !== 'ms_select_chalet') return;
            try {
                const { key: chaletKey } = JSON.parse(e.newValue || '{}');
                if (!chaletKey) return;
                const found = chalets.find((c) => (c.key || c.id) === chaletKey);
                if (found) handleSelectedChalet({ id: chaletKey, name: found.Name, ...found });
                localStorage.removeItem('ms_select_chalet');
            } catch { /* ignore parse errors */ }
        };
        window.addEventListener('storage', handleStorage);
        return () => window.removeEventListener('storage', handleStorage);
    }, [chalets]);

    // Check URL parameters on mount to reopen establishment modal if needed
    useEffect(() => {
        const urlParams = new URLSearchParams(globalThis.location.search);
        if (urlParams.get('openEstablishment') === 'true') {
            setIsEtablissementOpen(true);
            // Clean up URL parameter
            urlParams.delete('openEstablishment');
            const newUrl = urlParams.toString() 
                ? `${globalThis.location.pathname}?${urlParams.toString()}`
                : globalThis.location.pathname;
            globalThis.history.replaceState({}, document.title, newUrl);
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

    // Fetch guides filtered by fish type AND availability when entering step 3
    // (in the new flow, destination is step 1, dates are step 2, guide+chalet is step 3)
    useEffect(() => {
        if (bookingStep !== 3 || !startDate || !endDate) return;

        const fetchGuides = async () => {
            setLoadingGuides(true);
            try {
                console.log("🔍 Fetching guides for fish type:", fishType, "dates:", startDate, "-", endDate);
                
                // First get guides from our database filtered by fish type
                let query = supabase
                    .from('guide')
                    .select('*')
                    .eq('calendar_connection_status', 'connected');
                
                if (fishType) {
                    query = query.contains('fish_types', [fishType]);
                }
                
                const { data: guides, error } = await query;
                
                if (error) throw error;

                // Fetch guide service locations (preferred fishing zones) for river priority sorting
                const guideIds = (guides || []).map((g) => g.id).filter(Boolean);
                let serviceLocationsByGuide = {};
                if (guideIds.length > 0) {
                    try {
                        const { data: locData } = await supabase
                            .from('guide_service_locations')
                            .select('guide_id, fishing_zone:fishing_zone_id(id, name)')
                            .in('guide_id', guideIds);
                        if (locData) {
                            for (const row of locData) {
                                if (!serviceLocationsByGuide[row.guide_id]) serviceLocationsByGuide[row.guide_id] = [];
                                if (row.fishing_zone?.name) {
                                    serviceLocationsByGuide[row.guide_id].push(
                                        row.fishing_zone.name.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
                                    );
                                }
                            }
                        }
                    } catch (locErr) {
                        console.warn('Could not fetch guide service locations (non-fatal):', locErr);
                    }
                }

                const guideUserIds = [...new Set((guides || []).map((g) => g.user_id).filter(Boolean))];
                let usersById = new Map();
                if (guideUserIds.length > 0) {
                    const { data: usersData, error: usersError } = await supabase
                        .from('users')
                        .select('*')
                        .in('id', guideUserIds);

                    if (usersError) {
                        console.warn('Unable to load user profile rows for guide avatars:', usersError.message);
                    } else {
                        usersById = new Map((usersData || []).map((row) => [row.id, row]));
                    }
                }
                
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
                // NEW FLOW: We keep unavailable guides in the list (is_available:false) so
                // step 3 can surface "Air Canada" style alternative dates when they ARE free.
                // Only truly broken guides (API error, missing from response) are dropped.
                const formattedGuides = (await Promise.all((guides || [])
                    .map(async (g) => {
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

                        const rawEvents = availability.events || [];
                        const bookedSlots = availability.booked_slots || [];

                        // ── Client-side subtraction (safety net) ──
                        const bookedIntervals = bookedSlots.map(slot => {
                            const s = new Date(slot.start).getTime();
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

                        // Final availability = server says yes AND client finds ≥1 net window
                        const serverAvailable = availability.is_available !== false;
                        const clientAvailable = totalNetWindows > 0;
                        const isAvailable = serverAvailable && clientAvailable;

                        console.log(`🔍 Guide ${g.name}: server=${availability.is_available}, client=${clientAvailable}, is_available=${isAvailable} (${rawEvents.length} events, ${bookedSlots.length} bookings, ${totalNetWindows} net windows)`);

                        const linkedUser = usersById.get(g.user_id);
                        const { avatarSrc } = await resolveAvatarFromSources([g, linkedUser], {
                            supabase,
                            emptySrcFallback: '',
                        });

                        return {
                            guide_id: g.id,
                            name: g.name,
                            email: g.email,
                            fish_types: g.fish_types || [],
                            hourly_rate: g.hourly_rate,
                            stripe_charges_enabled: g.stripe_charges_enabled || false,
                            stripe_account_id: g.stripe_account_id || null,
                            is_available: isAvailable,
                            events: rawEvents,
                            booked_slots: bookedSlots,
                            avatarSrc,
                            // Normalized fishing zone names for river-priority sorting
                            preferredZoneNames: serviceLocationsByGuide[g.id] || [],
                        };
                    })))
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

    const evaluateGuideCountForRange = useCallback(async (rangeStart, rangeEnd) => {
        try {
            const startISO = `${rangeStart}T00:00:00Z`;
            const endISO = `${rangeEnd}T23:59:59Z`;
            const availabilityUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-calendar-availability-all?start=${encodeURIComponent(startISO)}&end=${encodeURIComponent(endISO)}`;
            const res = await fetch(availabilityUrl, {
                method: "GET",
                headers: {
                    "Authorization": `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
                    "Content-Type": "application/json",
                },
            });

            if (!res.ok) return 0;
            const rows = await res.json();
            if (!Array.isArray(rows)) return 0;

            return rows.filter((guideRow) => {
                if (guideRow?.is_available === false) return false;
                if (!fishType) return true;
                const guideFromCurrentList = availableGuides.find((g) => g.guide_id === guideRow.guide_id);
                if (!guideFromCurrentList) return true;
                return Array.isArray(guideFromCurrentList.fish_types)
                    ? guideFromCurrentList.fish_types.includes(fishType)
                    : false;
            }).length;
        } catch (error) {
            console.warn("Failed to evaluate guide count for alt dates:", error);
            return 0;
        }
    }, [fishType, availableGuides]);

    const evaluateChaletCountForRange = useCallback(async (rangeStart, rangeEnd) => {
        let anchor = null;
        if (selectedPoint?.lngLat) {
            anchor = { lng: selectedPoint.lngLat.lng, lat: selectedPoint.lngLat.lat };
        } else if (selectedRiver && RIVER_CENTERS_BY_PATH_ID[selectedRiver]) {
            anchor = RIVER_CENTERS_BY_PATH_ID[selectedRiver];
        }

        if (!anchor) return 0;

        try {
            const { data, error } = await supabase.rpc('get_chalets_nearby', {
                lng: anchor.lng,
                lat: anchor.lat,
                radius_m: (radius || 20) * 1000,
                min_capacity: numberOfPeople || null,
                check_start_date: `${rangeStart}T00:00:00Z`,
                check_end_date: `${rangeEnd}T23:59:59Z`,
            });

            if (error) throw error;
            return Array.isArray(data) ? data.length : 0;
        } catch (error) {
            console.warn("Failed to evaluate chalet count for alt dates:", error);
            return 0;
        }
    }, [selectedPoint, selectedRiver, radius, numberOfPeople]);

    useEffect(() => {
        const canComputeAlternatives = (
            bookingStep === 3
            && originalStartDate
            && originalEndDate
            && new Date(originalEndDate) > new Date(originalStartDate)
        );

        if (!canComputeAlternatives) {
            setAlternativeDateOptions([]);
            setLoadingAlternativeDates(false);
            return;
        }

        let cancelled = false;

        const computeAlternativeDates = async () => {
            setLoadingAlternativeDates(true);
            try {
                const candidates = buildNearbyDateCandidates(originalStartDate, originalEndDate, 7);
                const evaluated = await Promise.all(candidates.map(async (candidate) => {
                    const [guideCount, chaletCount] = await Promise.all([
                        evaluateGuideCountForRange(candidate.startDate, candidate.endDate),
                        evaluateChaletCountForRange(candidate.startDate, candidate.endDate),
                    ]);

                    return {
                        ...candidate,
                        guideCount,
                        chaletCount,
                        key: dateRangeKey(candidate.startDate, candidate.endDate),
                    };
                }));

                const curated = curateAlternativeDateOptions(evaluated, 7);
                if (!cancelled) {
                    setAlternativeDateOptions(curated);
                }
            } catch (error) {
                console.error("❌ Error computing alternative dates:", error);
                if (!cancelled) setAlternativeDateOptions([]);
            } finally {
                if (!cancelled) setLoadingAlternativeDates(false);
            }
        };

        computeAlternativeDates();

        return () => {
            cancelled = true;
        };
    }, [
        bookingStep,
        originalStartDate,
        originalEndDate,
        evaluateGuideCountForRange,
        evaluateChaletCountForRange,
    ]);

    // Fetch guide availability events when a guide is selected in Step 3
    // Also refresh every 30 seconds to detect bookings made by other users.
    useEffect(() => {
        if (bookingStep !== 3 || !selectedGuide || !startDate || !endDate) {
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
                    // Process events to extract time slots for each day.
                    // All-day events get split into 8h sessions (DEFAULT_DAY_HOURS)
                    // so the client doesn't see/bill 24h slots.
                    const guideScheduleConfig = selectedGuide?.schedule_config || null;
                    const events = data.items.flatMap(event => {
                        const isAllDay = !event.start?.dateTime && Boolean(event.start?.date);

                        if (isAllDay) {
                            const dayStart = new Date(event.start.date + 'T00:00:00');
                            const endExclusive = new Date(event.end.date + 'T00:00:00');
                            const lastDay = new Date(endExclusive);
                            lastDay.setDate(lastDay.getDate() - 1);

                            const sessions = expandAllDayEvent(
                                {
                                    id: event.id,
                                    summary: event.summary || 'Disponible',
                                    start: dayStart,
                                    end: lastDay,
                                },
                                guideScheduleConfig,
                            );

                            return sessions.map(s => {
                                const localDate = `${s.start.getFullYear()}-${String(s.start.getMonth()+1).padStart(2,'0')}-${String(s.start.getDate()).padStart(2,'0')}`;
                                return {
                                    id: s.id,
                                    summary: s.summary,
                                    start: s.start.toISOString(),
                                    end: s.end.toISOString(),
                                    date: localDate,
                                    durationHours: s.durationHours,
                                    sessionLabel: s.sessionLabel,
                                };
                            });
                        }

                        const startStr = event.start?.dateTime || event.start?.date;
                        const endStr = event.end?.dateTime || event.end?.date;
                        const startDate_obj = new Date(startStr);
                        const localDate = !isNaN(startDate_obj.getTime())
                            ? `${startDate_obj.getFullYear()}-${String(startDate_obj.getMonth()+1).padStart(2,'0')}-${String(startDate_obj.getDate()).padStart(2,'0')}`
                            : (startStr || '').split('T')[0];

                        const durationMs = (new Date(endStr) - new Date(startStr));
                        return [{
                            id: event.id,
                            summary: event.summary || 'Disponible',
                            start: startStr,
                            end: endStr,
                            date: localDate,
                            durationHours: !isNaN(durationMs) ? durationMs / 3_600_000 : null,
                        }];
                    });

                    // ── Build a combined list of booked intervals ──────────
                    // Use BOTH the guide's booked_slots (from the -all endpoint,
                    // fetched with service-role key — reliable) AND a fresh DB
                    // query as a safety-net.
                    const bookedIntervals = [];

                    // Source 1: booked_slots already loaded on guide object
                    if (selectedGuide.booked_slots && selectedGuide.booked_slots.length > 0) {
                        for (const slot of selectedGuide.booked_slots) {
                            const s = new Date(slot.start).getTime();
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
                                const s = new Date(booking.start_time).getTime();
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

    // Fetch ALL chalets regardless of radius, then mark availability for the selected dates.
    // Two parallel RPC calls: one without date filter (all chalets), one with dates (available only).
    // Results are merged: each chalet gets is_available=true/false, then sorted available-first,
    // distance-second. This enables an Airbnb-style browse-all UX instead of hard filtering.
    useEffect(() => {
        if (bookingStep !== 3 || !needsChalet || !startDate || !endDate) return;

        let anchor = null;
        if (selectedPoint?.lngLat) {
            anchor = { lng: selectedPoint.lngLat.lng, lat: selectedPoint.lngLat.lat };
        } else if (selectedRiver && RIVER_CENTERS_BY_PATH_ID[selectedRiver]) {
            anchor = RIVER_CENTERS_BY_PATH_ID[selectedRiver];
        }

        if (!anchor) return;

        const WIDE_RADIUS_M = 500_000; // 500 km — covers all of Quebec

        const fetchChalets = async () => {
            console.log("Querying Supabase for ALL chalets + availability:", {
                lng: anchor.lng,
                lat: anchor.lat,
                source: selectedPoint?.lngLat ? 'point' : `river:${selectedRiver}`,
            });

            try {
                setLoadingChalets(true);
                setChaletError(null);

                // Parallel: all chalets (null dates → bypasses availability filter in RPC)
                // + available chalets (with actual dates) to build the is_available flag
                const [allResult, availResult] = await Promise.all([
                    supabase.rpc('get_chalets_nearby', {
                        lng: anchor.lng,
                        lat: anchor.lat,
                        radius_m: WIDE_RADIUS_M,
                        min_capacity: numberOfPeople || null,
                        check_start_date: null,
                        check_end_date: null,
                    }),
                    supabase.rpc('get_chalets_nearby', {
                        lng: anchor.lng,
                        lat: anchor.lat,
                        radius_m: WIDE_RADIUS_M,
                        min_capacity: numberOfPeople || null,
                        check_start_date: `${startDate}T00:00:00Z`,
                        check_end_date: `${endDate}T23:59:59Z`,
                    }),
                ]);

                if (allResult.error) throw allResult.error;
                // If the availability RPC fails, data is empty but the "all chalets" call may succeed —
                // that would incorrectly mark every chalet unavailable (empty key set).
                if (availResult.error) throw availResult.error;

                const allChalets = Array.isArray(allResult.data) ? allResult.data : [];
                const availableKeySet = new Set(
                    (Array.isArray(availResult.data) ? availResult.data : []).map(c => String(c.key))
                );

                const enriched = allChalets.map(chalet => ({
                    ...chalet,
                    is_available: availableKeySet.has(String(chalet.key)),
                }));

                // Sort: available first, then by distance ascending
                enriched.sort((a, b) => {
                    if (a.is_available !== b.is_available) return a.is_available ? -1 : 1;
                    return (a.distance_m ?? Infinity) - (b.distance_m ?? Infinity);
                });

                setChalets(enriched);

                if (enriched.length > 0) {
                    const uniqueEstablishmentIds = new Set(
                        enriched.map(chalet => chalet.etablishment_id || 'no-establishment')
                    );
                    setExpandedEstablishments(uniqueEstablishmentIds);
                }
            } catch (err) {
                console.error("❌ Error fetching chalets:", err);
                setChaletError(err.message);
            } finally {
                setLoadingChalets(false);
            }
        };

        fetchChalets();
    }, [bookingStep, selectedPoint, selectedRiver, needsChalet, numberOfPeople, startDate, endDate]);

    const goToResultsStep = useCallback(() => {
        if (!startDate || !endDate || new Date(endDate) <= new Date(startDate)) return;
        setOriginalStartDate(startDate);
        setOriginalEndDate(endDate);
        setSelectedGuide(null);
        setSelectedTimeSlots([]);
        setBookingStep(3);
    }, [startDate, endDate]);

    const applyAlternativeDateOption = useCallback((option) => {
        if (!option?.startDate || !option?.endDate) return;
        setStartDate(option.startDate);
        setEndDate(option.endDate);
        setSelectedGuide(null);
        setSelectedTimeSlots([]);
        setBookingError(null);
    }, []);

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
        // Re-check availability when entering the confirmation step (4 ou 5 selon parcours chalet).
        if (bookingStep === bookingConfirmationStep) {
            checkAvailability();
        }
    }, [bookingStep, bookingConfirmationStep, startDate, endDate, checkAvailability]);

    function handleVoirPlus(chalet) {
        const chaletId = chalet?.key || chalet?.id;
        if (chaletId) {
            try { localStorage.setItem(`ms_chalet_preview_${chaletId}`, JSON.stringify(chalet)); } catch {}
            window.open(`/chalet/${chaletId}`, '_blank');
        }
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

    function login() {
        console.log("login");
        setIsLoginOpen(true);
    }

    function startBookingFlow() {
        // Clear any previous state when starting a new booking
        setBrowseMode('trip');
        setSelectedRiver(null);
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
        setOriginalStartDate('');
        setOriginalEndDate('');
        setAlternativeDateOptions([]);
        setDateConflicts(null);
        setBookingStep(1);
    }

    function startGuideFlow() {
        // Guide-only browsing flow (uses same booking steps, chalet disabled)
        setBrowseMode('guide');
        setSelectedRiver(null);
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
        setOriginalStartDate('');
        setOriginalEndDate('');
        setAlternativeDateOptions([]);
        setDateConflicts(null);
        setBookingStep(1);
    }

    function startChaletFlow() {
        // Chalet-only browsing flow (guide is optional, chalet is required)
        setBrowseMode('chalet');
        setSelectedRiver(null);
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
        setOriginalStartDate('');
        setOriginalEndDate('');
        setAlternativeDateOptions([]);
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

    // River selection callback — called from Map.jsx click handler while
    // in the booking destination step. Selecting a river anchors the search
    // area to that river and clears any manually placed radius point.
    function handleSelectRiver(riverId) {
        setSelectedRiver(riverId);
        if (riverId) {
            // River replaces manual point; clear it so they don't compete.
            setSelectedPoint(null);
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

    // Ancien aide-mémoire validation → étape suivante ; le flux passe par Map (goFromStep3ToNext).
    function proceedToStep4() {
        if (browseMode === 'chalet') {
            if (!selectedChalet) {
                toast.error('Veuillez sélectionner un chalet.');
                return;
            }
        } else if (browseMode === 'guide') {
            if (!selectedGuide) {
                toast.error('Veuillez sélectionner un guide.');
                return;
            }
        } else {
            if (!selectedGuide && needsChalet && !selectedChalet) {
                toast.error('Veuillez sélectionner au moins un guide ou un chalet.');
                return;
            }
            if (!selectedGuide && !needsChalet) {
                toast.error('Veuillez sélectionner un guide.');
                return;
            }
        }
        if ((browseMode === 'chalet' || (browseMode === 'trip' && needsChalet)) && selectedChalet) {
            setBookingStep(4);
        }
    }

    async function handleBookGuide() {
        // Reset error state
        setBookingError(null);
        setIsCreatingBooking(true);
        
        try {
            // ── Server-side conflict check before proceeding ──────────
            // Prevents stale-data race conditions: another user may have
            // booked the same slot since availability was last fetched.
            // Check EACH slot individually to avoid false positives from
            // a merged range (e.g. Mar 11 9-10 + Mar 13 9-10 would falsely
            // flag anything on Mar 12 if checked as one range).
            if (selectedGuide && selectedTimeSlots.length > 0) {
                try {
                    for (const slot of selectedTimeSlots) {
                        const conflictResult = await checkGuideConflictsServer(
                            selectedGuide.guide_id,
                            slot.startTime,
                            slot.endTime
                        );
                        if (!conflictResult.available) {
                            setBookingError('Ce créneau vient d\'être réservé par un autre utilisateur. Veuillez rafraîchir et choisir un autre horaire.');
                            setIsCreatingBooking(false);
                            return;
                        }
                    }
                } catch (conflictErr) {
                    console.warn('Server conflict check failed — proceeding (stripe-create-booking will validate):', conflictErr);
                }
            }

            const chaletPriced =
                Boolean(
                    needsChalet &&
                    selectedChalet &&
                    Number(selectedChalet.price_per_night ?? 0) > 0,
                );
            const chaletStripeReady = Boolean(selectedChalet?.stripe_charges_enabled);

            if (needsChalet && selectedChalet && chaletPriced && !chaletStripeReady) {
                const msg =
                    'Ce logement affiche un tarif mais le paiement en ligne n’est pas activé pour son établissement (Stripe). Le propriétaire doit terminer l’activation ou vous contacter.';
                setBookingError(msg);
                toast.error(msg);
                setIsCreatingBooking(false);
                return;
            }

            const guideNeedsStripe = selectedGuide && selectedTimeSlots.length > 0
                && selectedGuide.stripe_charges_enabled
                && selectedGuide.hourly_rate > 0;
            const chaletNeedsStripe = needsChalet && selectedChalet && chaletPriced && chaletStripeReady;

            const customerName = user?.user_metadata?.name || 'Guest';
            const customerEmail = user?.email || '';
            const tripLabel = `Pêche ${FISH_TYPES.find(f => f.value === fishType)?.label || fishType}`;
            const allSlots = selectedTimeSlots.map(slot => ({
                startTime: slot.startTime,
                endTime: slot.endTime,
            }));

            // Defensive guard: a slot must carry full ISO timestamps with
            // time-of-day. If anything upstream stripped them down to
            // "YYYY-MM-DD", or start/end ended up equal, refuse to send —
            // otherwise we'd silently insert zero-length bookings that break
            // the availability subtraction algorithm.
            const DATE_ONLY_RX = /^\d{4}-\d{2}-\d{2}$/;
            const badSlot = allSlots.find(s =>
                !s.startTime || !s.endTime ||
                DATE_ONLY_RX.test(String(s.startTime)) ||
                DATE_ONLY_RX.test(String(s.endTime)) ||
                new Date(s.endTime).getTime() <= new Date(s.startTime).getTime()
            );
            if (badSlot) {
                console.error('❌ [DATE GUARD] Refusing to create booking — malformed slot:', badSlot);
                console.error('   selectedTimeSlots snapshot:', JSON.parse(JSON.stringify(selectedTimeSlots)));
                const msg = 'Un créneau sélectionné est invalide (heure manquante). Veuillez rafraîchir la disponibilité et re-sélectionner vos créneaux.';
                setBookingError(msg);
                toast.error(msg);
                setIsCreatingBooking(false);
                return;
            }

            // ── COMBINED: guide + chalet → single PaymentIntent ──────────
            if (guideNeedsStripe && chaletNeedsStripe) {
                const inv = buildInventoryAddonsForCheckout();
                const combinedCheckoutData = {
                    customerName,
                    customerEmail,
                    notes: `Réservation via Monde Sauvage — ${numberOfPeople} personne(s) — Guide ${selectedGuide.name} + ${selectedChalet.name || selectedChalet.chalet_name || 'Chalet'}`,
                    guide: {
                        guideId: selectedGuide.guide_id,
                        slots: allSlots,
                        tripType: tripLabel,
                        numberOfPeople,
                    },
                    chalet: {
                        chaletId: selectedChalet.key,
                        startDate,
                        endDate,
                        ...(inv.length ? { inventoryAddons: inv } : {}),
                    },
                };
                setPaymentCheckoutData(combinedCheckoutData);
                setPaymentCheckoutType('combined');
                setShowPaymentCheckout(true);
                setIsCreatingBooking(false);
                return;
            }

            // ── GUIDE ONLY (Stripe) ─────────────────────────────────────
            if (guideNeedsStripe) {
                const totalHours = selectedTimeSlots.reduce((sum, slot) => {
                    const start = new Date(slot.startTime);
                    const end = new Date(slot.endTime);
                    return sum + (end - start) / (1000 * 60 * 60);
                }, 0);

                const guideCheckoutData = {
                    guideId: selectedGuide.guide_id,
                    startTime: allSlots[0].startTime,
                    endTime: allSlots[allSlots.length - 1].endTime,
                    customerName,
                    customerEmail,
                    tripType: tripLabel,
                    numberOfPeople,
                    notes: `Réservation via Monde Sauvage - ${fishType}`,
                    durationHours: totalHours,
                    hourlyRate: selectedGuide.hourly_rate,
                    totalAmount: selectedGuide.hourly_rate * totalHours,
                    allSlots,
                };

                setPaymentCheckoutData(guideCheckoutData);
                setPaymentCheckoutType('guide');
                setShowPaymentCheckout(true);
                setIsCreatingBooking(false);
                return;
            }

            // Guides sans paiement Stripe (créés avant tout checkout chalet, si besoin plus bas)
            const bookingResults = { guideBookings: [], chaletBooking: null };
            if (selectedGuide && selectedTimeSlots.length > 0 && !guideNeedsStripe) {
                console.log('📅 Creating guide bookings (sans Stripe web):', selectedTimeSlots);

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
                        skipAvailabilityCheck: true,
                    };

                    const guideBooking = await createGuideBooking(guideBookingData);
                    bookingResults.guideBookings.push(guideBooking);
                    console.log('✅ Guide booking created:', guideBooking);
                }
            }

            // ── CHALET Stripe : chalet seul OU guide sans Stripe au panier (anciennement chalet gratuit)
            if (chaletNeedsStripe && (!selectedGuide || !guideNeedsStripe)) {
                const inv = buildInventoryAddonsForCheckout();
                const guideHint = selectedGuide && selectedTimeSlots.length > 0 && !guideNeedsStripe
                    ? ` — Créneaux guide (${selectedGuide.name}) déjà réservés côté site ; complétez le paiement du chalet.`
                    : '';
                const chaletCheckoutData = {
                    chaletId: selectedChalet.key,
                    startDate,
                    endDate,
                    customerName,
                    customerEmail,
                    notes:
                        `Réservation via Monde Sauvage - ${numberOfPeople} personne(s)${guideHint}`,
                    ...(inv.length ? { inventoryAddons: inv } : {}),
                };
                setPaymentCheckoutData(chaletCheckoutData);
                setPaymentCheckoutType('chalet');
                setShowPaymentCheckout(true);
                setIsCreatingBooking(false);
                return;
            }

            // ── Sinon : aucun paiement carte requis pour le chalet ─ insert direct(s)
            if (needsChalet && selectedChalet && !chaletNeedsStripe) {
                console.log('🏠 Creating chalet booking (sans Stripe):', selectedChalet);

                const chaletBookingData = {
                    chaletId: selectedChalet.key,
                    startDate: startDate,
                    endDate: endDate,
                    customerName: user?.user_metadata?.name || 'Guest',
                    customerEmail: user?.email || '',
                    notes: `Réservation via Monde Sauvage - ${numberOfPeople} personne(s)${selectedGuide ? ` - Guide: ${selectedGuide.name}` : ''}`,
                };

                const chaletBooking = await createBooking(chaletBookingData);
                bookingResults.chaletBooking = chaletBooking;
                console.log('✅ Chalet booking created:', chaletBooking);
            }

            console.log('🎉 Réservations enregistrées:', bookingResults);
            setBookingStep(bookingConfirmationStep);
            
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

    async function handleOpenGuideProfileFromSocial(guideUserId) {
        try {
            const guideData = await getGuideByUserId(guideUserId);

            if (!guideData) {
                toast.error('Profil guide introuvable.');
                return;
            }

            setGuideForBooking(guideData);
            setIsGuideProfilePreviewOpen(true);
        } catch (error) {
            console.error('Error opening guide profile from social:', error);
            toast.error(error.message || 'Impossible d\'ouvrir le profil du guide.');
        }
    }

    function handleReserveFromGuideProfilePreview() {
        setIsGuideProfilePreviewOpen(false);
        setIsGuideBookingModalOpen(true);
    }

    // Handle payment success from the main booking flow CheckoutModal.
    // The webhook now owns booking confirmation + calendar sync + email +
    // (in combined mode) the per-vendor transfers, so this handler just
    // tidies up local UI state and advances the flow.
    async function handleMainFlowPaymentSuccess(result) {
        console.log('💳 Payment success for', paymentCheckoutType, result);
        setShowPaymentCheckout(false);
        setPaymentCheckoutData(null);
        setPaymentCheckoutType(null);
        // Always advance to the computed confirmation step so it matches
        // bookingMaxStep in Map.jsx and the confirmation panel renders.
        setBookingStep(bookingConfirmationStep);
    }

    function handleMainFlowPaymentClose() {
        setShowPaymentCheckout(false);
        setPaymentCheckoutData(null);
        setPaymentCheckoutType(null);
        setIsCreatingBooking(false);
    }

    function resetBookingFlow() {
        setBookingStep(0);
        setBrowseMode('trip');
        setStartDate("");
        setEndDate("");
        setOriginalStartDate("");
        setOriginalEndDate("");
        setNumberOfPeople(2);
        setFishType('');
        setNeedsChalet(true);
        setRadius(20);
        setSelectedRiver(null);
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
        setAlternativeDateOptions([]);
        setLoadingAlternativeDates(false);
        setIsCreatingBooking(false);
        // Reset payment state
        setShowPaymentCheckout(false);
        setPaymentCheckoutData(null);
        setPaymentCheckoutType(null);
        setEquipmentKinds([]);
        setInventoryAddonQtyBySlug({});
    }

    // NEW FLOW:
    // Step 1 = destination (river OR radius point) — ALWAYS optional, user can browse all
    const canProceedStep1 = true;

    // Step 2 = dates — need a valid range
    const canProceedStep2 = Boolean(
        startDate && endDate && new Date(endDate) > new Date(startDate)
    );

    // Step 3 = guide + chalet selection — adapts based on browseMode
    const canProceedStep3 = browseMode === 'chalet'
        ? (selectedChalet != null) // Chalet mode: just need a chalet
        : browseMode === 'guide'
        ? (selectedGuide && selectedTimeSlots.length > 0) // Guide mode: need guide + slots
        : (selectedGuide && selectedTimeSlots.length > 0) ||
          (!selectedGuide && needsChalet && selectedChalet) ||
          (selectedGuide && selectedTimeSlots.length > 0 && needsChalet && selectedChalet);
    
    return (
        <div>
            <Suspense fallback={null}>
                {isSocialRoute ? (
                    <SocialFeedPage
                        user={user}
                        guide={guide}
                        language={language}
                        setLanguage={setLanguage}
                        onOpenGuideProfile={handleOpenGuideProfileFromSocial}
                        onBack={() => navigate({ pathname: '/map', search: location.search })}
                    />
                ) : (
                    <GaspesieMap 
                        onClick={onClick}
                        radius={radius}
                        login={login}
                        isTripOpen={startBookingFlow}
                        isGuideFlowOpen={startGuideFlow}
                        isChaletFlowOpen={startChaletFlow}
                        isAccountSettingsOpen={openAccountSettings}
                        isSocialFeedOpen={() => navigate({ pathname: '/social', search: location.search })}
                        user={user}
                        profile={profile}
                        guide={guide}
                        language={language}
                        setLanguage={setLanguage}
                        isRejoindreOpen={setIsRejoindreOpen}
                        isEtablissementOpen={setIsEtablissementOpen}
                        onOpenHelp={openOnboarding}
                        // Pass booking flow state to control the sidebar
                        browseMode={browseMode}
                        bookingStep={bookingStep}
                        setBookingStep={setBookingStep}
                        startDate={startDate}
                        setStartDate={setStartDate}
                        endDate={endDate}
                        setEndDate={setEndDate}
                        originalStartDate={originalStartDate}
                        originalEndDate={originalEndDate}
                        alternativeDateOptions={alternativeDateOptions}
                        loadingAlternativeDates={loadingAlternativeDates}
                        applyAlternativeDateOption={applyAlternativeDateOption}
                        goToResultsStep={goToResultsStep}
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
                        // NEW FLOW: Step 1 destination props (river + radius coexist)
                        selectedRiver={selectedRiver}
                        onSelectRiver={handleSelectRiver}
                        formatRiverName={formatRiverName}
                        getRiverDetails={getRiverDetails}
                        knownRivers={knownRivers}
                        // Step 3 preferences / filters (fish type, people, chalet)
                        fishType={fishType}
                        setFishType={setFishType}
                        needsChalet={needsChalet}
                        setNeedsChalet={setNeedsChalet}
                        fishingZones={fishingZones}
                        loadingZones={loadingZones}
                        FISH_TYPES={FISH_TYPES}
                        // Step 3 → 4 transition (guide/chalet selection validator)
                        proceedToStep4={proceedToStep4}
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
                        equipmentKinds={equipmentKinds}
                        loadingEquipmentKinds={loadingEquipmentKinds}
                        inventoryAddonQtyBySlug={inventoryAddonQtyBySlug}
                        setInventoryAddonQtyBySlug={setInventoryAddonQtyBySlug}
                        availableCountByKindId={availableCountByKindId}
                        availableCountsLoaded={availableCountsLoaded}
                    />
                )}
            </Suspense>
            <Suspense fallback={null}>
<LoginModal 
                    isLoginOpen={isLoginOpen}
                    onLoginClose={() => setIsLoginOpen(false)}
                    language={language}
                />
                
                <GuideClientModal
                    isOpen={isGuideClientModalOpen}
                    onClose={() => {
                        setIsGuideClientModalOpen(false);
                        if (settingsWasOpenBeforeClients) {
                            setSettingsWasOpenBeforeClients(false);
                            openAccountSettings();
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
                    onClose={closeAccountSettings}
                    user={user}
                    profile={profile}
                    guide={guide}
                    onOpenClients={() => {
                        setSettingsWasOpenBeforeClients(true);
                        closeAccountSettings();
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

                <GuideProfilePreviewModal
                    guide={guideForBooking}
                    isOpen={isGuideProfilePreviewOpen}
                    onClose={() => setIsGuideProfilePreviewOpen(false)}
                    onReserve={handleReserveFromGuideProfilePreview}
                />
            </Suspense>

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
                <Suspense fallback={null}>
                    <CheckoutModal
                        isOpen={showPaymentCheckout}
                        onClose={handleMainFlowPaymentClose}
                        bookingData={paymentCheckoutData}
                        bookingType={paymentCheckoutType}
                        title={
                            paymentCheckoutType === 'combined'
                                ? `${selectedGuide?.name || 'Guide'} + ${selectedChalet?.name || selectedChalet?.chalet_name || 'Chalet'}`
                                : paymentCheckoutType === 'guide'
                                    ? selectedGuide?.name
                                    : selectedChalet?.name
                        }
                        onSuccess={handleMainFlowPaymentSuccess}
                    />
                </Suspense>
            )}

            {/* Reservation Cart — shows pending unpaid bookings */}
            {user && (
                <Suspense fallback={null}>
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
                                toast.error('Erreur lors de la reprise du paiement : ' + err.message);
                            }
                        }}
                    />
                </Suspense>
            )}
            
        </div>
    );
}

export default MapApp;