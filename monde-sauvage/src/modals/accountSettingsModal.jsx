/* eslint-disable no-unused-vars */
import React, { useState, useEffect, useCallback } from "react";
void React;
import supabase from "../utils/supabase.js";
import GuideCalendar from "../components/GuideCalendar.jsx";
import GuideReservationsPanel from "./guideReservationsPanel.jsx";
import { getGuideBookings } from "../utils/guideBookingService.js";
import { startGuideOnboarding, checkGuideOnboardingStatus, createGuideDashboardLink } from "../utils/stripeService.js";
import useAvatarSource from "../utils/useAvatarSource.js";

// Fish types - shared constant
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

const getFishLabel = (fishValue) => FISH_TYPES.find((f) => f.value === fishValue)?.label || fishValue;

const formatDashboardCurrency = (amount) => {
  const value = Number(amount) || 0;
  return new Intl.NumberFormat('fr-CA', {
    style: 'currency',
    currency: 'CAD',
    maximumFractionDigits: 0,
  }).format(value);
};

const isMissingGuideServiceLocationsTableError = (error) => {
  const message = String(error?.message || '').toLowerCase();
  return (
    error?.code === '42P01'
    || error?.code === 'PGRST205'
    || message.includes("could not find the table 'public.guide_service_locations'")
    || message.includes('relation "guide_service_locations" does not exist')
  );
};

export default function AccountSettingsModal({ isOpen, onClose, user, profile, guide, onOpenClients, onOpenHelp }) {
  const [activeTab, setActiveTab] = useState('profile');
  const [activeGuideSection, setActiveGuideSection] = useState('dashboard');
  const { avatarSrc, handleAvatarError } = useAvatarSource(user);
  const [isCompactLayout, setIsCompactLayout] = useState(
    typeof globalThis !== 'undefined' && globalThis.innerWidth < 1100
  );
  const [dashboardStats, setDashboardStats] = useState({
    totalReservations: 0,
    upcomingReservations: 0,
    pendingReservations: 0,
    paidReservations: 0,
    totalRevenue: 0,
    pendingRevenue: 0,
    averageRating: null,
    reviewCount: 0,
    monthlyRevenue: [],
    loading: false,
  });
  
  // Profile editing state
  const [editedProfile, setEditedProfile] = useState({
    display_name: '',
    phone: '',
    preferred_language: 'fr',
  });

  // Guide editing state
  const [editedGuide, setEditedGuide] = useState({
    name: '',
    experience: '',
    bio: '',
    hourly_rate: '',
    phone: '',
    email: '',
    fish_types: [],
  });
  const [isSavingGuide, setIsSavingGuide] = useState(false);

  // Service locations state (normalized via fishing_zones + guide_service_locations)
  const [availableZonesByFishType, setAvailableZonesByFishType] = useState({}); // { fish_type: [{ id, name, fish_type, description }] }
  const [selectedServiceLocationIds, setSelectedServiceLocationIds] = useState([]); // UUID[] of fishing_zones.id
  const [selectedLocationRows, setSelectedLocationRows] = useState([]); // joined rows from guide_service_locations
  const [legacyFishTypeLocations, setLegacyFishTypeLocations] = useState({}); // fallback from guide_fish_type_locations
  const [loadingServiceLocations, setLoadingServiceLocations] = useState(false);
  const [serviceLocationError, setServiceLocationError] = useState('');
  const [isLocationDropdownOpen, setIsLocationDropdownOpen] = useState(false);

  // Stripe onboarding state
  const [stripeLoading, setStripeLoading] = useState(false);
  const [stripeDashboardLoading, setStripeDashboardLoading] = useState(false);
  const [stripeError, setStripeError] = useState(null);
  const [stripeStatus, setStripeStatus] = useState({
    chargesEnabled: false,
    payoutsEnabled: false,
    onboardingComplete: false,
    hasAccount: false,
  });

  // Initialize profile data
  useEffect(() => {
    if (user) {
      setEditedProfile({
        display_name: user.user_metadata?.name || user.user_metadata?.full_name || '',
        phone: profile?.phone || '',
        preferred_language: profile?.preferred_language || 'fr',
      });
    }
  }, [user, profile]);

  // Initialize guide data
  useEffect(() => {
    if (guide) {
      setEditedGuide({
        name: guide.name || '',
        experience: guide.experience || '',
        bio: guide.bio || '',
        hourly_rate: guide.hourly_rate || '',
        phone: guide.phone || '',
        email: guide.email || '',
        fish_types: guide.fish_types || [],
      });
      // Init Stripe status from guide data
      setStripeStatus({
        chargesEnabled: guide.stripe_charges_enabled || false,
        payoutsEnabled: guide.stripe_payouts_enabled || false,
        onboardingComplete: guide.stripe_onboarding_complete || false,
        hasAccount: !!guide.stripe_account_id,
      });
    }
  }, [guide]);

  // Check Stripe status on mount if they have an account but charges aren't enabled
  useEffect(() => {
    if (guide?.stripe_account_id && !guide?.stripe_charges_enabled) {
      handleCheckStripeStatus();
    }
  }, [guide?.stripe_account_id]);

  useEffect(() => {
    const handleResize = () => {
      setIsCompactLayout(typeof globalThis !== 'undefined' && globalThis.innerWidth < 1100);
    };

    if (typeof globalThis !== 'undefined' && globalThis.addEventListener) {
      globalThis.addEventListener('resize', handleResize);
      return () => globalThis.removeEventListener('resize', handleResize);
    }
  }, []);

  // Check if returning from Stripe onboarding
  useEffect(() => {
    const params = new URLSearchParams(globalThis.location.search);
    const stripeOnboard = params.get('stripe_onboard');
    const guideParam = params.get('guide');
    if (stripeOnboard === 'complete' && guideParam && guide?.id === guideParam) {
      handleCheckStripeStatus();
      // Open the settings modal to the guide tab so user sees the result
      setActiveTab('guide');
      globalThis.history.replaceState({}, document.title, globalThis.location.pathname);
    } else if (stripeOnboard === 'refresh' && guideParam && guide?.id === guideParam) {
      setStripeError("L'inscription Stripe n'a pas été complétée. Vous pouvez réessayer.");
      setActiveTab('guide');
      globalThis.history.replaceState({}, document.title, globalThis.location.pathname);
    }
  }, [guide?.id]);

  const handleStartStripeOnboarding = async () => {
    setStripeLoading(true);
    setStripeError(null);
    try {
      const result = await startGuideOnboarding(guide.id);
      globalThis.location.href = result.url;
    } catch (err) {
      console.error('Stripe onboarding error:', err);
      setStripeError(err.message);
      setStripeLoading(false);
    }
  };

  const handleCheckStripeStatus = async () => {
    try {
      const result = await checkGuideOnboardingStatus(guide.id);
      setStripeStatus({
        chargesEnabled: result.chargesEnabled,
        payoutsEnabled: result.payoutsEnabled,
        onboardingComplete: result.onboardingComplete,
        hasAccount: true,
      });
    } catch (err) {
      console.error('Stripe status check error:', err);
    }
  };

  const handleOpenStripeDashboard = async () => {
    setStripeDashboardLoading(true);
    setStripeError(null);
    try {
      const result = await createGuideDashboardLink(guide.id);
      globalThis.open(result.url, '_blank');
    } catch (err) {
      console.error('Stripe dashboard link error:', err);
      setStripeError('Impossible d\'ouvrir le tableau de bord Stripe. ' + err.message);
    } finally {
      setStripeDashboardLoading(false);
    }
  };

  // Fetch available fishing zones based on selected fish types
  const fetchAvailableZones = useCallback(async (fishTypes) => {
    const selectedFishTypes = fishTypes || [];
    if (selectedFishTypes.length === 0) {
      setAvailableZonesByFishType({});
      return;
    }

    try {
      const { data, error } = await supabase
        .from('fishing_zones')
        .select('id, name, fish_type, description')
        .in('fish_type', selectedFishTypes)
        .order('name', { ascending: true });

      if (error) throw error;

      const grouped = (data || []).reduce((acc, zone) => {
        if (!acc[zone.fish_type]) acc[zone.fish_type] = [];
        acc[zone.fish_type].push(zone);
        return acc;
      }, {});

      setAvailableZonesByFishType(grouped);
      setServiceLocationError('');
    } catch (err) {
      console.error('Error fetching fishing zones:', err);
      setAvailableZonesByFishType({});
      setServiceLocationError('Impossible de charger les lieux de peche pour les types selectionnes.');
    }
  }, []);

  // Fetch selected service locations (normalized table) for guide
  const fetchGuideServiceLocations = useCallback(async () => {
    if (!guide?.id) return;

    setLoadingServiceLocations(true);
    try {
      const { data, error } = await supabase
        .from('guide_service_locations')
        .select('fish_type, fishing_zone_id, fishing_zone:fishing_zone_id(id, name, fish_type, description)')
        .eq('guide_id', guide.id)
        .order('fish_type', { ascending: true });

      if (error) {
        // Table may not exist in older environments. Keep UI usable with graceful fallback.
        if (isMissingGuideServiceLocationsTableError(error)) {
          setSelectedLocationRows([]);
          setSelectedServiceLocationIds([]);
          setServiceLocationError('Le schema des lieux de service n\'est pas encore migre.');
          return;
        }
        throw error;
      }

      const rows = data || [];
      setSelectedLocationRows(rows);
      setSelectedServiceLocationIds(rows.map((row) => row.fishing_zone_id));
      setServiceLocationError('');
    } catch (err) {
      console.error('Error fetching guide service locations:', err);
      setSelectedLocationRows([]);
      setSelectedServiceLocationIds([]);
      setServiceLocationError('Impossible de charger les lieux de service sauvegardes.');
    } finally {
      setLoadingServiceLocations(false);
    }
  }, [guide?.id]);

  // Fetch legacy free-text locations for migration hint visibility
  const fetchLegacyFishTypeLocations = useCallback(async () => {
    if (!guide?.id) return;

    try {
      const { data, error } = await supabase
        .from('guide_fish_type_locations')
        .select('fish_type, location_name')
        .eq('guide_id', guide.id)
        .order('fish_type', { ascending: true });

      if (error) {
        if (error.code === '42P01') {
          setLegacyFishTypeLocations({});
          return;
        }
        throw error;
      }

      const grouped = (data || []).reduce((acc, item) => {
        if (!acc[item.fish_type]) acc[item.fish_type] = [];
        acc[item.fish_type].push(item.location_name);
        return acc;
      }, {});

      setLegacyFishTypeLocations(grouped);
    } catch (err) {
      console.error('Error fetching legacy fish type locations:', err);
      setLegacyFishTypeLocations({});
    }
  }, [guide?.id]);

  useEffect(() => {
    if (!isOpen || !guide?.id || activeTab !== 'guide') return;
    fetchGuideServiceLocations();
    fetchLegacyFishTypeLocations();
  }, [isOpen, guide?.id, activeTab, fetchGuideServiceLocations, fetchLegacyFishTypeLocations]);

  useEffect(() => {
    if (!isOpen || !guide?.id || activeTab !== 'guide') return;

    let cancelled = false;
    const loadGuideRatings = async () => {
      const candidateTables = ['guide_reviews', 'guide_review'];

      for (const tableName of candidateTables) {
        const { data, error } = await supabase
          .from(tableName)
          .select('rating')
          .eq('guide_id', guide.id);

        if (error) {
          const isMissing = error.code === '42P01' || error.code === 'PGRST205';
          if (isMissing) continue;
          console.warn(`Unable to fetch ratings from ${tableName}:`, error);
          return { averageRating: null, reviewCount: 0 };
        }

        const ratings = (data || [])
          .map((row) => Number(row.rating))
          .filter((value) => Number.isFinite(value) && value > 0);

        if (ratings.length === 0) {
          return { averageRating: null, reviewCount: 0 };
        }

        const sum = ratings.reduce((acc, value) => acc + value, 0);
        return {
          averageRating: sum / ratings.length,
          reviewCount: ratings.length,
        };
      }

      return { averageRating: null, reviewCount: 0 };
    };

    const buildMonthlyRevenue = (bookings) => {
      const now = new Date();
      const buckets = Array.from({ length: 6 }, (_, index) => {
        const monthDate = new Date(now.getFullYear(), now.getMonth() - 5 + index, 1);
        const key = `${monthDate.getFullYear()}-${monthDate.getMonth()}`;
        const label = monthDate.toLocaleDateString('fr-CA', { month: 'short' });
        return { key, label, value: 0 };
      });

      const bucketByKey = new Map(buckets.map((bucket) => [bucket.key, bucket]));

      bookings.forEach((booking) => {
        if (!booking?.is_paid) return;
        const amount = Number(booking.payment_amount);
        if (!Number.isFinite(amount) || amount <= 0) return;

        const bookingDate = new Date(booking.start_time);
        const key = `${bookingDate.getFullYear()}-${bookingDate.getMonth()}`;
        const targetBucket = bucketByKey.get(key);
        if (targetBucket) {
          targetBucket.value += amount;
        }
      });

      return buckets;
    };

    const loadDashboardStats = async () => {
      setDashboardStats((prev) => ({ ...prev, loading: true }));
      try {
        const [bookingsResponse, ratings] = await Promise.all([
          getGuideBookings(guide.id, {
            includeDeleted: false,
            includeHistorical: true,
          }),
          loadGuideRatings(),
        ]);

        const now = new Date();
        const all = bookingsResponse || [];
        const upcoming = all.filter((b) => new Date(b.end_time) >= now && b.status !== 'cancelled');
        const pending = all.filter((b) => b.status === 'pending' || b.status === 'pending_payment');
        const paid = all.filter((b) => b.is_paid === true);
        const totalRevenue = paid.reduce((sum, b) => {
          const amount = Number(b.payment_amount);
          return Number.isFinite(amount) && amount > 0 ? sum + amount : sum;
        }, 0);
        const pendingRevenue = all
          .filter((b) => b.is_paid !== true && (b.payment_status === 'pending' || b.payment_status === 'pending_payment' || b.status === 'pending_payment'))
          .reduce((sum, b) => {
            const amount = Number(b.payment_amount);
            return Number.isFinite(amount) && amount > 0 ? sum + amount : sum;
          }, 0);

        if (!cancelled) {
          setDashboardStats({
            totalReservations: all.length,
            upcomingReservations: upcoming.length,
            pendingReservations: pending.length,
            paidReservations: paid.length,
            totalRevenue,
            pendingRevenue,
            averageRating: ratings.averageRating,
            reviewCount: ratings.reviewCount,
            monthlyRevenue: buildMonthlyRevenue(all),
            loading: false,
          });
        }
      } catch (error) {
        console.error('Error loading dashboard stats:', error);
        if (!cancelled) {
          setDashboardStats((prev) => ({ ...prev, loading: false }));
        }
      }
    };

    loadDashboardStats();

    return () => {
      cancelled = true;
    };
  }, [isOpen, guide?.id, activeTab]);

  useEffect(() => {
    fetchAvailableZones(editedGuide.fish_types || []);
  }, [editedGuide.fish_types, fetchAvailableZones]);

  useEffect(() => {
    const allAvailableZoneIds = new Set(
      Object.values(availableZonesByFishType)
        .flat()
        .map((zone) => zone.id)
    );
    setSelectedServiceLocationIds((prev) => prev.filter((id) => allAvailableZoneIds.has(id)));
  }, [availableZonesByFishType]);

  const toggleServiceLocation = (zoneId) => {
    setSelectedServiceLocationIds((prev) => {
      if (prev.includes(zoneId)) {
        return prev.filter((id) => id !== zoneId);
      }
      return [...prev, zoneId];
    });
  };

  const syncGuideServiceLocations = async (guideId, fishTypes) => {
    const zoneById = new Map(
      Object.values(availableZonesByFishType)
        .flat()
        .map((zone) => [zone.id, zone])
    );

    const normalizedRows = selectedServiceLocationIds
      .map((zoneId) => zoneById.get(zoneId))
      .filter((zone) => zone && fishTypes.includes(zone.fish_type))
      .map((zone) => ({
        guide_id: guideId,
        fish_type: zone.fish_type,
        fishing_zone_id: zone.id,
      }));

    const { error: deleteError } = await supabase
      .from('guide_service_locations')
      .delete()
      .eq('guide_id', guideId);

    if (deleteError) {
      if (isMissingGuideServiceLocationsTableError(deleteError)) {
        setServiceLocationError('Le schema des lieux de service n\'est pas encore migre. Lancez la migration Supabase.');
        return;
      }
      throw deleteError;
    }

    if (normalizedRows.length === 0) {
      setSelectedLocationRows([]);
      return;
    }

    const { data: insertedRows, error: insertError } = await supabase
      .from('guide_service_locations')
      .insert(normalizedRows)
      .select('fish_type, fishing_zone_id, fishing_zone:fishing_zone_id(id, name, fish_type, description)');

    if (insertError) {
      if (isMissingGuideServiceLocationsTableError(insertError)) {
        setServiceLocationError('Le schema des lieux de service n\'est pas encore migre. Lancez la migration Supabase.');
        return;
      }
      throw insertError;
    }

    setSelectedLocationRows(insertedRows || []);
  };

  // Toggle fish type
  const toggleFishType = (fishValue) => {
    setEditedGuide(prev => {
      const currentTypes = prev.fish_types || [];
      if (currentTypes.includes(fishValue)) {
        return { ...prev, fish_types: currentTypes.filter(t => t !== fishValue) };
      } else {
        return { ...prev, fish_types: [...currentTypes, fishValue] };
      }
    });
  };

  // Save guide profile
  const handleSaveGuide = async () => {
    if (!guide?.id) return;
    setIsSavingGuide(true);
    try {
      const payload = {
        name: editedGuide.name,
        experience: editedGuide.experience,
        bio: editedGuide.bio,
        phone: editedGuide.phone,
        email: editedGuide.email,
        fish_types: editedGuide.fish_types,
        hourly_rate: editedGuide.hourly_rate === "" || editedGuide.hourly_rate == null
          ? null : Number(editedGuide.hourly_rate),
      };

      const { error } = await supabase
        .from("guide")
        .update(payload)
        .eq("id", guide.id);

      if (error) throw error;

      await syncGuideServiceLocations(guide.id, editedGuide.fish_types || []);
      console.log('Guide profile saved successfully');
    } catch (err) {
      console.error('Error saving guide:', err);
      alert('Erreur lors de la sauvegarde: ' + err.message);
    } finally {
      setIsSavingGuide(false);
    }
  };

  if (!isOpen) return null;

  const isGuide = profile?.type === 'guide' || profile?.type === 'admin';

  // Google Calendar link
  const googleCalendarHref = guide?.google_calendar_id
    ? `https://calendar.google.com/calendar/u/0/r?cid=${encodeURIComponent(guide.google_calendar_id)}`
    : "https://calendar.google.com";

  return (
    <div style={{
      position: 'fixed',
      top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.5)',
      zIndex: 10000,
      display: 'flex',
      alignItems: 'stretch',
      justifyContent: 'stretch',
    }}>
      <div style={{
        width: '100%',
        height: '100dvh',
        minHeight: '100vh',
        backgroundColor: '#FFFCF7',
        boxShadow: '0 24px 48px rgba(0,0,0,0.2)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: 'clamp(14px, 3vh, 32px) clamp(14px, 3vw, 40px)',
          borderBottom: '1px solid #E5E7EB',
          flexShrink: 0,
          backgroundColor: 'white',
          gap: '12px',
          flexWrap: 'wrap',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <img
              src={avatarSrc}
              alt="Avatar"
              referrerPolicy="no-referrer"
              onError={handleAvatarError}
              style={{ width: 56, height: 56, borderRadius: '50%', border: '3px solid #4A9B8E', objectFit: 'cover' }}
            />
            <div>
              <h2 style={{ margin: 0, fontSize: '24px', color: '#1F3A2E', fontWeight: '600' }}>
                Paramètres du compte
              </h2>
              <p style={{ margin: 0, fontSize: '14px', color: '#5A7766' }}>
                {user?.email}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'none', border: 'none', fontSize: '32px',
              cursor: 'pointer', color: '#5A7766', padding: '8px 12px',
              borderRadius: '8px',
              transition: 'all 0.2s ease',
            }}
            onMouseOver={(e) => { e.target.style.backgroundColor = 'rgba(239, 68, 68, 0.1)'; e.target.style.color = '#DC2626'; }}
            onMouseOut={(e) => { e.target.style.backgroundColor = 'transparent'; e.target.style.color = '#5A7766'; }}
          >
            ✕
          </button>
        </div>

        {/* Tab Navigation */}
        <div style={{
          display: 'flex',
          borderBottom: '1px solid #E5E7EB',
          padding: '0 clamp(10px, 3vw, 40px)',
          flexShrink: 0,
          backgroundColor: 'white',
          overflowX: 'auto',
          whiteSpace: 'nowrap',
        }}>
          <button
            type="button"
            onClick={() => setActiveTab('profile')}
            style={{
              padding: '12px 20px',
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: activeTab === 'profile' ? '600' : '400',
              color: activeTab === 'profile' ? '#2D5F4C' : '#5A7766',
              borderBottom: activeTab === 'profile' ? '2px solid #2D5F4C' : '2px solid transparent',
              transition: 'all 0.2s ease',
            }}
          >
            👤 Profil
          </button>
          {isGuide && (
            <button
              type="button"
              onClick={() => setActiveTab('guide')}
              style={{
                padding: '12px 20px',
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: activeTab === 'guide' ? '600' : '400',
                color: activeTab === 'guide' ? '#2D5F4C' : '#5A7766',
                borderBottom: activeTab === 'guide' ? '2px solid #2D5F4C' : '2px solid transparent',
                transition: 'all 0.2s ease',
              }}
            >
              🧭 Guide
            </button>
          )}
        </div>

        {/* Content */}
        <div style={{ 
          flex: 1, 
          overflowY: 'auto', 
          padding: 'clamp(12px, 3vw, 40px)',
          display: 'flex',
          justifyContent: 'center'
        }}>
          <div style={{ width: '100%', maxWidth: '1200px' }}>
          
          {/* PROFILE TAB */}
          {activeTab === 'profile' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div style={{
                padding: '20px',
                backgroundColor: 'white',
                borderRadius: '12px',
                border: '1px solid #E5E7EB',
              }}>
                <h3 style={{ margin: '0 0 16px', fontSize: '16px', color: '#1F3A2E' }}>
                  Informations personnelles
                </h3>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', color: '#5A7766', fontWeight: '500', marginBottom: '6px' }}>
                      Nom d'affichage
                    </label>
                    <input
                      type="text"
                      value={editedProfile.display_name}
                      onChange={(e) => setEditedProfile(prev => ({ ...prev, display_name: e.target.value }))}
                      style={{
                        width: '100%', padding: '10px 12px', borderRadius: '8px',
                        border: '1.5px solid #D1D5DB', fontSize: '14px', color: '#1F3A2E',
                        backgroundColor: '#FFFCF7', boxSizing: 'border-box',
                      }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '13px', color: '#5A7766', fontWeight: '500', marginBottom: '6px' }}>
                      Courriel
                    </label>
                    <input
                      type="email"
                      value={user?.email || ''}
                      disabled
                      style={{
                        width: '100%', padding: '10px 12px', borderRadius: '8px',
                        border: '1.5px solid #E5E7EB', fontSize: '14px', color: '#9CA3AF',
                        backgroundColor: '#F3F4F6', boxSizing: 'border-box',
                      }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '13px', color: '#5A7766', fontWeight: '500', marginBottom: '6px' }}>
                      Téléphone
                    </label>
                    <input
                      type="tel"
                      value={editedProfile.phone}
                      onChange={(e) => setEditedProfile(prev => ({ ...prev, phone: e.target.value }))}
                      placeholder="(418) 123-4567"
                      style={{
                        width: '100%', padding: '10px 12px', borderRadius: '8px',
                        border: '1.5px solid #D1D5DB', fontSize: '14px', color: '#1F3A2E',
                        backgroundColor: '#FFFCF7', boxSizing: 'border-box',
                      }}
                    />
                  </div>
                </div>
              </div>

              <div style={{
                padding: '16px 20px',
                backgroundColor: 'rgba(74, 155, 142, 0.08)',
                borderRadius: '10px',
                fontSize: '13px',
                color: '#5A7766',
              }}>
                <strong>Type de compte:</strong> {profile?.type === 'guide' ? 'Guide' : profile?.type === 'establishment' ? 'Établissement' : profile?.type === 'admin' ? 'Administrateur' : 'Utilisateur'}
              </div>
            </div>
          )}

          {/* GUIDE TAB */}
          {activeTab === 'guide' && isGuide && (
            <div style={{ display: 'flex', flexDirection: isCompactLayout ? 'column' : 'row', gap: '24px', alignItems: 'flex-start' }}>

              {/* Left Sidebar Nav */}
              <div style={{
                flexShrink: 0,
                width: isCompactLayout ? '100%' : '200px',
                backgroundColor: 'white',
                borderRadius: '12px',
                border: '1px solid #E5E7EB',
                overflow: 'hidden',
                position: isCompactLayout ? 'relative' : 'sticky',
                top: isCompactLayout ? 'auto' : '0',
              }}>
                {[
                  { key: 'dashboard', icon: '📊', label: 'Dashboard' },
                  { key: 'profil', icon: '👤', label: 'Profil de guide' },
                  { key: 'specialisations', icon: '🐟', label: 'Spécialisations' },
                  { key: 'paiements', icon: '💳', label: 'Paiements en ligne' },
                  { key: 'calendrier', icon: '📅', label: 'Calendrier' },
                  { key: 'reservations', icon: '📋', label: 'Réservations' },
                  { key: 'avis', icon: '⭐', label: 'Avis' },
                ].map(({ key, icon, label }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setActiveGuideSection(key)}
                    style={{
                      width: '100%',
                      padding: '14px 16px',
                      border: 'none',
                      borderLeft: activeGuideSection === key ? '3px solid #2D5F4C' : '3px solid transparent',
                      backgroundColor: activeGuideSection === key ? 'rgba(45, 95, 76, 0.08)' : 'transparent',
                      color: activeGuideSection === key ? '#2D5F4C' : '#5A7766',
                      cursor: 'pointer',
                      fontWeight: activeGuideSection === key ? '600' : '400',
                      fontSize: '13px',
                      textAlign: 'left',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      transition: 'all 0.15s ease',
                      borderBottom: '1px solid #F3F4F6',
                    }}
                    onMouseOver={(e) => {
                      if (activeGuideSection !== key) e.currentTarget.style.backgroundColor = 'rgba(45, 95, 76, 0.04)';
                    }}
                    onMouseOut={(e) => {
                      if (activeGuideSection !== key) e.currentTarget.style.backgroundColor = 'transparent';
                    }}
                  >
                    <span>{icon}</span>
                    {label}
                  </button>
                ))}
                {onOpenHelp && (
                  <button
                    type="button"
                    onClick={onOpenHelp}
                    style={{
                      width: '100%',
                      padding: '12px 16px',
                      border: 'none',
                      borderLeft: '3px solid transparent',
                      backgroundColor: 'transparent',
                      color: '#9CA3AF',
                      cursor: 'pointer',
                      fontSize: '12px',
                      textAlign: 'left',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      transition: 'all 0.15s ease',
                    }}
                    onMouseOver={(e) => { e.currentTarget.style.color = '#5A7766'; }}
                    onMouseOut={(e) => { e.currentTarget.style.color = '#9CA3AF'; }}
                  >
                    ❓ Aide
                  </button>
                )}
              </div>

              {/* Right Content */}
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '20px' }}>

              {/* Guide Dashboard Section */}
              {activeGuideSection === 'dashboard' && <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={{
                  padding: '20px',
                  backgroundColor: 'white',
                  borderRadius: '12px',
                  border: '1px solid #E5E7EB',
                }}>
                  <h3 style={{ margin: '0 0 6px', fontSize: '18px', color: '#1F3A2E' }}>
                    Dashboard Guide Studio
                  </h3>
                  <p style={{ margin: 0, fontSize: '13px', color: '#5A7766' }}>
                    Vue analytique de vos réservations, notes et revenus.
                  </p>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: isCompactLayout ? '1fr' : 'repeat(4, minmax(180px, 1fr))', gap: '12px' }}>
                  <div style={dashboardCardStyle}>
                    <div style={dashboardValueStyle}>{dashboardStats.loading ? '...' : dashboardStats.totalReservations}</div>
                    <div style={dashboardLabelStyle}>Réservations totales</div>
                  </div>
                  <div style={dashboardCardStyle}>
                    <div style={dashboardValueStyle}>
                      {dashboardStats.loading
                        ? '...'
                        : dashboardStats.averageRating == null
                          ? 'N/A'
                          : dashboardStats.averageRating.toFixed(1)}
                    </div>
                    <div style={dashboardLabelStyle}>Note moyenne ({dashboardStats.reviewCount})</div>
                  </div>
                  <div style={dashboardCardStyle}>
                    <div style={dashboardValueStyle}>{dashboardStats.loading ? '...' : formatDashboardCurrency(dashboardStats.totalRevenue)}</div>
                    <div style={dashboardLabelStyle}>Revenus encaissés</div>
                  </div>
                  <div style={dashboardCardStyle}>
                    <div style={dashboardValueStyle}>{dashboardStats.loading ? '...' : formatDashboardCurrency(dashboardStats.pendingRevenue)}</div>
                    <div style={dashboardLabelStyle}>Revenus en attente</div>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: isCompactLayout ? '1fr' : 'minmax(0, 2fr) minmax(0, 1fr)', gap: '12px' }}>
                  <div style={dashboardPanelStyle}>
                    <h4 style={dashboardPanelTitleStyle}>📈 Flux de revenus (6 derniers mois)</h4>
                    {dashboardStats.loading ? (
                      <p style={dashboardTextStyle}>Chargement des données de revenus...</p>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'end', gap: '8px', minHeight: '180px', marginTop: '8px' }}>
                        {dashboardStats.monthlyRevenue.map((month) => {
                          const maxRevenue = Math.max(...dashboardStats.monthlyRevenue.map((item) => item.value), 0);
                          const heightPercent = maxRevenue > 0 ? Math.max(10, Math.round((month.value / maxRevenue) * 100)) : 10;
                          return (
                            <div key={month.label} style={{ flex: 1, minWidth: 0, textAlign: 'center' }}>
                              <div
                                title={`${month.label}: ${formatDashboardCurrency(month.value)}`}
                                style={{
                                  height: `${heightPercent}%`,
                                  minHeight: '14px',
                                  background: 'linear-gradient(180deg, #4A9B8E 0%, #2D5F4C 100%)',
                                  borderRadius: '8px 8px 2px 2px',
                                  marginBottom: '8px',
                                }}
                              />
                              <div style={{ fontSize: '11px', color: '#5A7766' }}>{month.label}</div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div style={dashboardPanelStyle}>
                    <h4 style={dashboardPanelTitleStyle}>🎯 Performance</h4>
                    <p style={dashboardTextStyle}><strong>Réservations à venir:</strong> {dashboardStats.loading ? '...' : dashboardStats.upcomingReservations}</p>
                    <p style={dashboardTextStyle}><strong>Réservations payées:</strong> {dashboardStats.loading ? '...' : dashboardStats.paidReservations}</p>
                    <p style={dashboardTextStyle}><strong>Réservations en attente:</strong> {dashboardStats.loading ? '...' : dashboardStats.pendingReservations}</p>
                    <p style={dashboardTextStyle}>
                      <strong>Google Calendar:</strong>{' '}
                      {guide?.calendar_connection_status === 'disconnected' ? 'Déconnecté' : (guide?.google_refresh_token ? 'Connecté' : 'Non connecté')}
                    </p>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: isCompactLayout ? '1fr' : 'repeat(4, minmax(180px, 1fr))', gap: '12px' }}>
                  <div style={dashboardPanelStyle}>
                    <h4 style={dashboardPanelTitleStyle}>📋 Réservations</h4>
                    <p style={dashboardTextStyle}>Gérez vos réservations et vos clients.</p>
                    <button type="button" onClick={() => setActiveGuideSection('reservations')} style={dashboardLinkButtonStyle}>Ouvrir Réservations</button>
                  </div>

                  <div style={dashboardPanelStyle}>
                    <h4 style={dashboardPanelTitleStyle}>📅 Calendrier</h4>
                    <p style={dashboardTextStyle}>Consultez et synchronisez vos disponibilités.</p>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      <button type="button" onClick={() => setActiveGuideSection('calendrier')} style={dashboardLinkButtonStyle}>Ouvrir Calendrier</button>
                      <a href={googleCalendarHref} target="_blank" rel="noopener noreferrer" style={dashboardAnchorStyle}>Google Calendar</a>
                    </div>
                  </div>

                  <div style={dashboardPanelStyle}>
                    <h4 style={dashboardPanelTitleStyle}>💳 Paiements</h4>
                    <p style={dashboardTextStyle}>{stripeStatus.chargesEnabled ? 'Paiements actifs' : 'Paiements à configurer'}</p>
                    <button type="button" onClick={() => setActiveGuideSection('paiements')} style={dashboardLinkButtonStyle}>Configurer Paiements</button>
                  </div>

                  <div style={dashboardPanelStyle}>
                    <h4 style={dashboardPanelTitleStyle}>⭐ Avis</h4>
                    <p style={dashboardTextStyle}><strong>Avis reçus:</strong> {dashboardStats.reviewCount}</p>
                    <p style={dashboardTextStyle}>
                      <strong>Note moyenne:</strong>{' '}
                      {dashboardStats.averageRating == null ? 'N/A' : dashboardStats.averageRating.toFixed(1)}
                    </p>
                    <button type="button" onClick={() => setActiveGuideSection('avis')} style={dashboardLinkButtonStyle}>Voir les stats</button>
                  </div>
                </div>
              </div>}

              {/* Guide Profile Section */}
              {activeGuideSection === 'profil' && <div style={{
                padding: '20px',
                backgroundColor: 'white',
                borderRadius: '12px',
                border: '1px solid #E5E7EB',
              }}>
                <h3 style={{ margin: '0 0 16px', fontSize: '16px', color: '#1F3A2E' }}>
                  Profil de guide
                </h3>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                    <div style={{ flex: '1 1 280px' }}>
                      <label style={labelStyle}>Nom</label>
                      <input
                        type="text"
                        value={editedGuide.name}
                        onChange={(e) => setEditedGuide(p => ({ ...p, name: e.target.value }))}
                        style={inputStyle}
                      />
                    </div>
                    <div style={{ flex: '1 1 280px' }}>
                      <label style={labelStyle}>Tarif horaire ($)</label>
                      <input
                        type="number"
                        value={editedGuide.hourly_rate}
                        onChange={(e) => setEditedGuide(p => ({ ...p, hourly_rate: e.target.value }))}
                        placeholder="75"
                        style={inputStyle}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                    <div style={{ flex: '1 1 280px' }}>
                      <label style={labelStyle}>Téléphone</label>
                      <input
                        type="tel"
                        value={editedGuide.phone}
                        onChange={(e) => setEditedGuide(p => ({ ...p, phone: e.target.value }))}
                        style={inputStyle}
                      />
                    </div>
                    <div style={{ flex: '1 1 280px' }}>
                      <label style={labelStyle}>Courriel</label>
                      <input
                        type="email"
                        value={editedGuide.email}
                        onChange={(e) => setEditedGuide(p => ({ ...p, email: e.target.value }))}
                        style={inputStyle}
                      />
                    </div>
                  </div>

                  <div>
                    <label style={labelStyle}>Expérience</label>
                    <textarea
                      value={editedGuide.experience}
                      onChange={(e) => setEditedGuide(p => ({ ...p, experience: e.target.value }))}
                      rows={3}
                      style={{ ...inputStyle, resize: 'vertical' }}
                    />
                  </div>

                  <div>
                    <label style={labelStyle}>Biographie</label>
                    <textarea
                      value={editedGuide.bio}
                      onChange={(e) => setEditedGuide(p => ({ ...p, bio: e.target.value }))}
                      rows={4}
                      placeholder="Parlez de votre passion..."
                      style={{ ...inputStyle, resize: 'vertical' }}
                    />
                  </div>

                  <button
                    type="button"
                    onClick={handleSaveGuide}
                    disabled={isSavingGuide}
                    style={{
                      padding: '12px 20px',
                      backgroundColor: '#2D5F4C',
                      color: '#FFFCF7',
                      border: 'none',
                      borderRadius: '10px',
                      cursor: isSavingGuide ? 'not-allowed' : 'pointer',
                      fontWeight: '600',
                      fontSize: '14px',
                      opacity: isSavingGuide ? 0.7 : 1,
                      alignSelf: 'flex-end',
                    }}
                  >
                    {isSavingGuide ? 'Enregistrement...' : '💾 Sauvegarder le profil'}
                  </button>
                </div>
              </div>}

              {/* Fish Types + Locations Section */}
              {activeGuideSection === 'specialisations' && <div style={{
                padding: '20px',
                backgroundColor: 'white',
                borderRadius: '12px',
                border: '1px solid #E5E7EB',
              }}>
                <h3 style={{ margin: '0 0 8px', fontSize: '16px', color: '#1F3A2E' }}>
                  Spécialisations & Lieux de pêche
                </h3>
                <p style={{ margin: '0 0 16px', fontSize: '13px', color: '#5A7766' }}>
                  Sélectionnez vos types de poissons, puis choisissez des lieux valides depuis la base de donnees.
                </p>

                {/* Fish type selection pills */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '20px' }}>
                  {FISH_TYPES.map((fish) => {
                    const isSelected = (editedGuide.fish_types || []).includes(fish.value);
                    return (
                      <button
                        key={fish.value}
                        type="button"
                        onClick={() => toggleFishType(fish.value)}
                        style={{
                          padding: '8px 14px',
                          borderRadius: '20px',
                          border: isSelected ? '2px solid #2D5F4C' : '1px solid #D1D5DB',
                          backgroundColor: isSelected ? 'rgba(45, 95, 76, 0.15)' : '#FFFCF7',
                          color: isSelected ? '#2D5F4C' : '#5A7766',
                          cursor: 'pointer',
                          fontSize: '13px',
                          fontWeight: isSelected ? '600' : '400',
                          transition: 'all 0.2s ease',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}
                      >
                        {isSelected && <span>✓</span>}
                        🐟 {fish.label}
                      </button>
                    );
                  })}
                </div>

                <div style={{ marginBottom: '14px' }}>
                  <label style={{ ...labelStyle, marginBottom: '6px' }}>Lieux de service (selection multiple)</label>
                  {(editedGuide.fish_types || []).length === 0 ? (
                    <div style={{
                      border: '1px dashed #D1D5DB',
                      borderRadius: '8px',
                      padding: '10px 12px',
                      color: '#9CA3AF',
                      fontSize: '13px',
                      backgroundColor: '#F9FAFB',
                    }}>
                      Selectionnez d'abord un ou plusieurs types de poisson.
                    </div>
                  ) : (
                    <div style={{ position: 'relative' }}>
                      <button
                        type="button"
                        onClick={() => setIsLocationDropdownOpen((prev) => !prev)}
                        style={{
                          width: '100%',
                          textAlign: 'left',
                          border: '1px solid #D1D5DB',
                          borderRadius: '8px',
                          padding: '10px 12px',
                          fontSize: '13px',
                          color: '#1F3A2E',
                          backgroundColor: 'white',
                          cursor: 'pointer',
                        }}
                      >
                        {selectedServiceLocationIds.length > 0
                          ? `${selectedServiceLocationIds.length} lieu(x) selectionne(s)`
                          : 'Choisir les lieux de service'}
                        <span style={{ float: 'right', color: '#6B7280' }}>{isLocationDropdownOpen ? '▲' : '▼'}</span>
                      </button>

                      {isLocationDropdownOpen && (
                        <div style={{
                          position: 'absolute',
                          zIndex: 30,
                          left: 0,
                          right: 0,
                          marginTop: '6px',
                          backgroundColor: 'white',
                          border: '1px solid #D1D5DB',
                          borderRadius: '8px',
                          boxShadow: '0 8px 20px rgba(15, 23, 42, 0.12)',
                          maxHeight: '280px',
                          overflowY: 'auto',
                          padding: '8px',
                        }}>
                          {loadingServiceLocations ? (
                            <div style={{ padding: '8px', fontSize: '13px', color: '#6B7280' }}>Chargement...</div>
                          ) : (
                            (editedGuide.fish_types || []).map((fishType) => {
                              const fishZones = availableZonesByFishType[fishType] || [];
                              return (
                                <div key={fishType} style={{ padding: '6px 4px', borderBottom: '1px solid #F3F4F6' }}>
                                  <div style={{ fontSize: '12px', fontWeight: '600', color: '#2D5F4C', marginBottom: '6px' }}>
                                    🐟 {getFishLabel(fishType)}
                                  </div>
                                  {fishZones.length === 0 ? (
                                    <div style={{ fontSize: '12px', color: '#9CA3AF', fontStyle: 'italic', paddingBottom: '6px' }}>
                                      Aucun lieu disponible pour ce type de poisson.
                                    </div>
                                  ) : (
                                    fishZones.map((zone) => {
                                      const checked = selectedServiceLocationIds.includes(zone.id);
                                      return (
                                        <label
                                          key={zone.id}
                                          style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '8px',
                                            padding: '6px 4px',
                                            fontSize: '13px',
                                            color: '#1F3A2E',
                                            cursor: 'pointer',
                                          }}
                                        >
                                          <input
                                            type="checkbox"
                                            checked={checked}
                                            onChange={() => toggleServiceLocation(zone.id)}
                                          />
                                          <span>{zone.name}</span>
                                        </label>
                                      );
                                    })
                                  )}
                                </div>
                              );
                            })
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {selectedServiceLocationIds.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' }}>
                    {selectedLocationRows
                      .filter((row) => selectedServiceLocationIds.includes(row.fishing_zone_id) && row.fishing_zone)
                      .map((row) => (
                        <span
                          key={row.fishing_zone_id}
                          style={{
                            padding: '6px 10px',
                            backgroundColor: 'rgba(45, 95, 76, 0.1)',
                            borderRadius: '16px',
                            fontSize: '12px',
                            color: '#2D5F4C',
                          }}
                        >
                          📍 {row.fishing_zone.name}
                        </span>
                      ))}
                    {Object.values(availableZonesByFishType)
                      .flat()
                      .filter((zone) => selectedServiceLocationIds.includes(zone.id))
                      .filter((zone, index, arr) => arr.findIndex((z) => z.id === zone.id) === index)
                      .filter((zone) => !selectedLocationRows.some((row) => row.fishing_zone_id === zone.id))
                      .map((zone) => (
                        <span
                          key={zone.id}
                          style={{
                            padding: '6px 10px',
                            backgroundColor: 'rgba(45, 95, 76, 0.1)',
                            borderRadius: '16px',
                            fontSize: '12px',
                            color: '#2D5F4C',
                          }}
                        >
                          📍 {zone.name}
                        </span>
                      ))}
                  </div>
                )}

                {serviceLocationError && (
                  <p style={{ margin: '8px 0 0', fontSize: '12px', color: '#B45309' }}>
                    {serviceLocationError}
                  </p>
                )}

                {Object.keys(legacyFishTypeLocations).length > 0 && (
                  <div style={{
                    marginTop: '10px',
                    padding: '10px',
                    borderRadius: '8px',
                    border: '1px solid #FCD34D',
                    backgroundColor: '#FFFBEB',
                  }}>
                    <p style={{ margin: '0 0 8px', fontSize: '12px', color: '#92400E', fontWeight: '600' }}>
                      Anciens lieux texte detectes (migration recommandee)
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      {Object.entries(legacyFishTypeLocations).map(([fishType, names]) => (
                        <p key={fishType} style={{ margin: 0, fontSize: '12px', color: '#92400E' }}>
                          🐟 {getFishLabel(fishType)}: {names.join(', ')}
                        </p>
                      ))}
                    </div>
                  </div>
                )}

                {(editedGuide.fish_types || []).length === 0 && (
                  <p style={{ margin: 0, fontSize: '13px', color: '#9CA3AF', fontStyle: 'italic' }}>
                    Sélectionnez au moins un type de poisson pour configurer les lieux.
                  </p>
                )}

                {/* Save fish types button (saves to guide.fish_types) */}
                {(editedGuide.fish_types || []).length > 0 && (
                  <button
                    type="button"
                    onClick={handleSaveGuide}
                    disabled={isSavingGuide}
                    style={{
                      marginTop: '16px',
                      padding: '10px 18px',
                      backgroundColor: '#2D5F4C',
                      color: '#FFFCF7',
                      border: 'none',
                      borderRadius: '10px',
                      cursor: isSavingGuide ? 'not-allowed' : 'pointer',
                      fontWeight: '600',
                      fontSize: '13px',
                      opacity: isSavingGuide ? 0.7 : 1,
                    }}
                  >
                    {isSavingGuide ? 'Enregistrement...' : '💾 Sauvegarder les spécialisations'}
                  </button>
                )}
              </div>}


              {/* Stripe Payments Section */}
              {activeGuideSection === 'paiements' && <div style={{
                padding: '20px',
                backgroundColor: 'white',
                borderRadius: '12px',
                border: '1px solid #E5E7EB',
              }}>
                <h3 style={{ margin: '0 0 8px', fontSize: '16px', color: '#1F3A2E' }}>
                  💳 Paiements en ligne
                </h3>
                <p style={{ margin: '0 0 16px', fontSize: '13px', color: '#5A7766' }}>
                  Acceptez les paiements de vos clients directement sur votre compte bancaire via Stripe
                </p>

                {/* Status badges */}
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
                  {stripeStatus.chargesEnabled && stripeStatus.payoutsEnabled ? (
                    <>
                      <span style={{ padding: '4px 12px', borderRadius: '12px', background: '#dcfce7', color: '#166534', fontSize: '13px', fontWeight: '500' }}>✅ Paiements activés</span>
                      <span style={{ padding: '4px 12px', borderRadius: '12px', background: '#dcfce7', color: '#166534', fontSize: '13px', fontWeight: '500' }}>✅ Virements activés</span>
                    </>
                  ) : stripeStatus.hasAccount ? (
                    <>
                      <span style={{ padding: '4px 12px', borderRadius: '12px', background: stripeStatus.chargesEnabled ? '#dcfce7' : '#fef3c7', color: stripeStatus.chargesEnabled ? '#166534' : '#92400e', fontSize: '13px', fontWeight: '500' }}>
                        {stripeStatus.chargesEnabled ? '✅' : '⏳'} Paiements
                      </span>
                      <span style={{ padding: '4px 12px', borderRadius: '12px', background: stripeStatus.payoutsEnabled ? '#dcfce7' : '#fef3c7', color: stripeStatus.payoutsEnabled ? '#166534' : '#92400e', fontSize: '13px', fontWeight: '500' }}>
                        {stripeStatus.payoutsEnabled ? '✅' : '⏳'} Virements
                      </span>
                    </>
                  ) : (
                    <span style={{ padding: '4px 12px', borderRadius: '12px', background: '#f1f5f9', color: '#64748b', fontSize: '13px' }}>
                      Non configuré
                    </span>
                  )}
                </div>

                {stripeError && (
                  <div style={{ padding: '8px 12px', background: '#fef2f2', color: '#991b1b', borderRadius: '8px', fontSize: '13px', marginBottom: '12px' }}>
                    {stripeError}
                  </div>
                )}

                {/* Not yet configured — show setup button */}
                {!stripeStatus.chargesEnabled && (
                  <button
                    type="button"
                    onClick={handleStartStripeOnboarding}
                    disabled={stripeLoading}
                    style={{
                      width: '100%',
                      padding: '12px',
                      backgroundColor: '#6366f1',
                      color: 'white',
                      border: 'none',
                      borderRadius: '10px',
                      fontSize: '14px',
                      fontWeight: '600',
                      cursor: stripeLoading ? 'wait' : 'pointer',
                      opacity: stripeLoading ? 0.7 : 1,
                      transition: 'all 0.2s ease',
                    }}
                  >
                    {stripeLoading ? 'Redirection vers Stripe...' : (stripeStatus.hasAccount ? 'Reprendre la configuration Stripe' : 'Configurer les paiements')}
                  </button>
                )}

                {/* Fully configured — show management options */}
                {stripeStatus.chargesEnabled && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>

                    {/* Stripe Express Dashboard button */}
                    <button
                      type="button"
                      onClick={handleOpenStripeDashboard}
                      disabled={stripeDashboardLoading}
                      style={{
                        width: '100%',
                        padding: '12px',
                        backgroundColor: '#6366f1',
                        color: 'white',
                        border: 'none',
                        borderRadius: '10px',
                        fontSize: '14px',
                        fontWeight: '600',
                        cursor: stripeDashboardLoading ? 'wait' : 'pointer',
                        opacity: stripeDashboardLoading ? 0.7 : 1,
                        transition: 'all 0.2s ease',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px',
                      }}
                    >
                      {stripeDashboardLoading ? 'Ouverture...' : '📊 Tableau de bord Stripe'}
                    </button>

                    {/* Info card about the dashboard */}
                    <div style={{
                      padding: '12px 14px',
                      background: '#f0f4ff',
                      borderRadius: '10px',
                      border: '1px solid #e0e7ff',
                    }}>
                      <p style={{ margin: '0 0 6px', fontSize: '13px', fontWeight: '600', color: '#3730a3' }}>
                        Depuis votre tableau de bord vous pouvez :
                      </p>
                      <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '12px', color: '#4338ca', lineHeight: '1.6' }}>
                        <li>Consulter vos paiements et virements</li>
                        <li>Modifier vos informations bancaires</li>
                        <li>Voir l'historique des transactions</li>
                        <li>Gérer vos coordonnées fiscales</li>
                      </ul>
                    </div>

                    {/* Secondary actions row */}
                    <div style={{ display: 'flex', gap: '8px' }}>
                      {/* Update Stripe info button */}
                      <button
                        type="button"
                        onClick={handleStartStripeOnboarding}
                        disabled={stripeLoading}
                        style={{
                          flex: 1,
                          padding: '10px 12px',
                          backgroundColor: 'white',
                          color: '#4338ca',
                          border: '1px solid #c7d2fe',
                          borderRadius: '10px',
                          fontSize: '13px',
                          fontWeight: '600',
                          cursor: stripeLoading ? 'wait' : 'pointer',
                          opacity: stripeLoading ? 0.7 : 1,
                          transition: 'all 0.2s ease',
                        }}
                      >
                        {stripeLoading ? '...' : '🔄 Mettre à jour'}
                      </button>

                      {/* Refresh status button */}
                      <button
                        type="button"
                        onClick={handleCheckStripeStatus}
                        style={{
                          flex: 1,
                          padding: '10px 12px',
                          backgroundColor: 'white',
                          color: '#5A7766',
                          border: '1px solid #E5E7EB',
                          borderRadius: '10px',
                          fontSize: '13px',
                          fontWeight: '600',
                          cursor: 'pointer',
                          transition: 'all 0.2s ease',
                        }}
                      >
                        🔃 Rafraîchir le statut
                      </button>
                    </div>

                    {/* Hourly rate warning */}
                    {!editedGuide.hourly_rate && (
                      <div style={{ padding: '8px 12px', background: '#fef3c7', color: '#92400e', borderRadius: '8px', fontSize: '13px' }}>
                        ⚠️ Définissez votre tarif horaire dans votre profil pour que les clients puissent payer en ligne
                      </div>
                    )}

                    {/* Commission info */}
                    <div style={{
                      padding: '10px 14px',
                      background: '#f8fafc',
                      borderRadius: '10px',
                      border: '1px solid #e2e8f0',
                      fontSize: '12px',
                      color: '#64748b',
                    }}>
                      ℹ️ Une commission de 10% s'applique aux réservations générées par la plateforme. Les réservations saisies manuellement par le guide n'ont pas de commission Monde Sauvage.
                    </div>
                  </div>
                )}

                {/* Hourly rate warning when not fully set up */}
                {stripeStatus.chargesEnabled === false && stripeStatus.hasAccount && !editedGuide.hourly_rate && (
                  <div style={{ padding: '8px 12px', background: '#fef3c7', color: '#92400e', borderRadius: '8px', fontSize: '13px', marginTop: '8px' }}>
                    ⚠️ Définissez votre tarif horaire ci-dessus pour que les clients puissent payer en ligne
                  </div>
                )}
              </div>}

              {/* Statistics / Avis */}
              {activeGuideSection === 'avis' && <div style={{
                padding: '20px',
                backgroundColor: 'white',
                borderRadius: '12px',
                border: '1px solid #E5E7EB',
              }}>
                <h3 style={{ margin: '0 0 12px', fontSize: '16px', color: '#1F3A2E' }}>
                  Avis & Statistiques
                </h3>
                <div style={{
                  display: 'flex',
                  gap: '16px',
                  flexWrap: 'wrap',
                }}>
                  <div style={{
                    flex: '1 1 120px',
                    padding: '16px',
                    backgroundColor: 'rgba(74, 155, 142, 0.08)',
                    borderRadius: '10px',
                    textAlign: 'center',
                  }}>
                    <div style={{ fontSize: '24px', fontWeight: '700', color: '#2D5F4C' }}>0</div>
                    <div style={{ fontSize: '12px', color: '#5A7766', marginTop: '4px' }}>Réservations totales</div>
                  </div>
                  <div style={{
                    flex: '1 1 120px',
                    padding: '16px',
                    backgroundColor: 'rgba(74, 155, 142, 0.08)',
                    borderRadius: '10px',
                    textAlign: 'center',
                  }}>
                    <div style={{ fontSize: '24px', fontWeight: '700', color: '#2D5F4C' }}>0</div>
                    <div style={{ fontSize: '12px', color: '#5A7766', marginTop: '4px' }}>Avis reçus</div>
                  </div>
                  <div style={{
                    flex: '1 1 120px',
                    padding: '16px',
                    backgroundColor: 'rgba(74, 155, 142, 0.08)',
                    borderRadius: '10px',
                    textAlign: 'center',
                  }}>
                    <div style={{ fontSize: '24px', fontWeight: '700', color: '#2D5F4C' }}>N/A</div>
                    <div style={{ fontSize: '12px', color: '#5A7766', marginTop: '4px' }}>Note moyenne</div>
                  </div>
                </div>
              </div>}

              {/* Calendar Section */}
              {activeGuideSection === 'calendrier' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', height: '100%' }}>
                  {guide?.calendar_connection_status === 'disconnected' && (
                    <div style={{
                      padding: '16px 20px',
                      backgroundColor: '#fff5f5',
                      border: '2px solid #fc8181',
                      borderRadius: '10px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '14px',
                    }}>
                      <span style={{ fontSize: '28px' }}>🚨</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: '700', color: '#c53030', fontSize: '14px', marginBottom: '4px' }}>
                          Connexion Google Calendar perdue
                        </div>
                        <div style={{ fontSize: '13px', color: '#742a2a' }}>
                          Vos réservations sont bloquées jusqu&apos;à la reconnexion.
                          {guide?.calendar_disconnect_reason && (
                            <span style={{ opacity: 0.7 }}> ({guide.calendar_disconnect_reason})</span>
                          )}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          if (!guide?.id) return;
                          const redirectTo = encodeURIComponent(globalThis.location.href);
                          globalThis.location.href = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-calendar-oauth?guideId=${guide.id}&redirect_to=${redirectTo}`;
                        }}
                        style={{
                          padding: '10px 18px',
                          backgroundColor: '#e53e3e',
                          color: 'white',
                          border: 'none',
                          borderRadius: '8px',
                          cursor: 'pointer',
                          fontSize: '13px',
                          fontWeight: '600',
                          whiteSpace: 'nowrap',
                          boxShadow: '0 2px 4px rgba(229,62,62,0.3)',
                        }}
                      >
                        Reconnecter maintenant
                      </button>
                    </div>
                  )}

                  <div style={{ flex: 1, minHeight: '500px', position: 'relative' }}>
                    <div style={{
                      position: 'fixed',
                      bottom: '30px',
                      right: '30px',
                      display: 'flex',
                      gap: '8px',
                      zIndex: 1000,
                    }}>
                      {(!guide?.google_refresh_token || guide?.calendar_connection_status === 'disconnected') && (
                        <button
                          type="button"
                          onClick={() => {
                            if (!guide?.id) return;
                            const redirectTo = encodeURIComponent(globalThis.location.href);
                            globalThis.location.href = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-calendar-oauth?guideId=${guide.id}&redirect_to=${redirectTo}`;
                          }}
                          style={{
                            padding: '8px 14px',
                            backgroundColor: guide?.calendar_connection_status === 'disconnected' ? '#e53e3e' : '#f59e0b',
                            color: 'white',
                            border: 'none',
                            borderRadius: '8px',
                            cursor: 'pointer',
                            fontSize: '13px',
                            fontWeight: '500',
                            boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                          }}
                        >
                          {guide?.calendar_connection_status === 'disconnected' ? '🔄 Reconnecter Google Calendar' : 'Connecter Google Calendar'}
                        </button>
                      )}
                      <a
                        href={guide?.google_calendar_id ? `https://calendar.google.com/calendar/u/0/r?cid=${encodeURIComponent(guide.google_calendar_id)}` : "https://calendar.google.com"}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          padding: '8px 14px',
                          background: '#1a73e8',
                          color: '#fff',
                          borderRadius: '8px',
                          textDecoration: 'none',
                          fontSize: '13px',
                          fontWeight: '500',
                          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                        }}
                      >
                        Ouvrir Google Calendar
                      </a>
                    </div>
                    <GuideCalendar guideId={guide?.id} />
                  </div>
                </div>
              )}

              {/* Reservations Section */}
              {activeGuideSection === 'reservations' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  {onOpenClients && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <button
                        type="button"
                        onClick={onOpenClients}
                        style={{
                          padding: '10px 18px',
                          backgroundColor: '#eff6ff',
                          color: '#1d4ed8',
                          border: '1px solid #bfdbfe',
                          borderRadius: '10px',
                          cursor: 'pointer',
                          fontWeight: '500',
                          fontSize: '14px',
                          transition: 'all 0.2s ease',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                        }}
                        onMouseOver={(e) => {
                          e.currentTarget.style.backgroundColor = '#dbeafe';
                          e.currentTarget.style.borderColor = '#93c5fd';
                        }}
                        onMouseOut={(e) => {
                          e.currentTarget.style.backgroundColor = '#eff6ff';
                          e.currentTarget.style.borderColor = '#bfdbfe';
                        }}
                      >
                        👥 Gérer mes clients
                      </button>
                    </div>
                  )}
                  <GuideReservationsPanel guide={guide} />
                </div>
              )}
              </div>
            </div>
          )}

          </div>
        </div>
      </div>
    </div>
  );
}

// Shared styles
const labelStyle = {
  display: 'block',
  fontSize: '13px',
  color: '#5A7766',
  fontWeight: '500',
  marginBottom: '6px',
};

const inputStyle = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: '8px',
  border: '1.5px solid #D1D5DB',
  fontSize: '14px',
  color: '#1F3A2E',
  backgroundColor: '#FFFCF7',
  boxSizing: 'border-box',
};

const dashboardCardStyle = {
  padding: '16px',
  backgroundColor: 'white',
  borderRadius: '12px',
  border: '1px solid #E5E7EB',
};

const dashboardValueStyle = {
  fontSize: '28px',
  fontWeight: 700,
  color: '#2D5F4C',
  lineHeight: 1.1,
};

const dashboardLabelStyle = {
  marginTop: '6px',
  fontSize: '12px',
  color: '#5A7766',
};

const dashboardPanelStyle = {
  padding: '16px',
  backgroundColor: 'white',
  borderRadius: '12px',
  border: '1px solid #E5E7EB',
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
};

const dashboardPanelTitleStyle = {
  margin: 0,
  fontSize: '14px',
  color: '#1F3A2E',
};

const dashboardTextStyle = {
  margin: 0,
  fontSize: '13px',
  color: '#5A7766',
};

const dashboardLinkButtonStyle = {
  marginTop: '6px',
  alignSelf: 'flex-start',
  padding: '8px 12px',
  borderRadius: '8px',
  border: '1px solid #D1D5DB',
  backgroundColor: '#F9FAFB',
  color: '#1F3A2E',
  cursor: 'pointer',
  fontSize: '12px',
  fontWeight: 600,
};

const dashboardAnchorStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '8px 12px',
  borderRadius: '8px',
  backgroundColor: '#1a73e8',
  color: '#fff',
  fontSize: '12px',
  fontWeight: 600,
  textDecoration: 'none',
};
