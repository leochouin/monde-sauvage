/* eslint-disable no-unused-vars */
import React, { useState, useEffect, useCallback } from "react";
void React;
import supabase from "../utils/supabase.js";
import GuideCalendar from "../components/GuideCalendar.jsx";
import GuideReservationsPanel from "./guideReservationsPanel.jsx";
import { startGuideOnboarding, checkGuideOnboardingStatus } from "../utils/stripeService.js";

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

export default function AccountSettingsModal({ isOpen, onClose, user, profile, guide, onOpenClients, onOpenHelp }) {
  const [activeTab, setActiveTab] = useState('profile');
  
  // Profile editing state
  const [editedProfile, setEditedProfile] = useState({
    display_name: '',
    phone: '',
    preferred_language: 'fr',
  });
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  // Guide editing state
  const [editedGuide, setEditedGuide] = useState({
    name: '',
    experience: '',
    bio: '',
    hourly_rate: '',
    location: '',
    phone: '',
    email: '',
    fish_types: [],
  });
  const [isSavingGuide, setIsSavingGuide] = useState(false);

  // Fish type locations state
  const [fishTypeLocations, setFishTypeLocations] = useState({}); // { fish_type: [{ id, location_name, description }] }
  const [loadingLocations, setLoadingLocations] = useState(false);
  const [newLocationInputs, setNewLocationInputs] = useState({}); // { fish_type: { name: '', description: '' } }

  // Fullscreen calendar modal state
  const [showCalendarModal, setShowCalendarModal] = useState(false);

  // Stripe onboarding state
  const [stripeLoading, setStripeLoading] = useState(false);
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
        location: guide.location || '',
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

  // Check if returning from Stripe onboarding
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const stripeOnboard = params.get('stripe_onboard');
    const guideParam = params.get('guide');
    if (stripeOnboard === 'complete' && guideParam && guide?.id === guideParam) {
      handleCheckStripeStatus();
      // Open the settings modal to the guide tab so user sees the result
      setActiveTab('guide');
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (stripeOnboard === 'refresh' && guideParam && guide?.id === guideParam) {
      setStripeError("L'inscription Stripe n'a pas été complétée. Vous pouvez réessayer.");
      setActiveTab('guide');
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, [guide?.id]);

  const handleStartStripeOnboarding = async () => {
    setStripeLoading(true);
    setStripeError(null);
    try {
      const result = await startGuideOnboarding(guide.id);
      window.location.href = result.url;
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

  // Fetch fish type locations for guide
  const fetchFishTypeLocations = useCallback(async () => {
    if (!guide?.id) return;
    
    setLoadingLocations(true);
    try {
      const { data, error } = await supabase
        .from('guide_fish_type_locations')
        .select('*')
        .eq('guide_id', guide.id)
        .order('fish_type', { ascending: true });

      if (error) throw error;

      // Group by fish_type
      const grouped = (data || []).reduce((acc, item) => {
        if (!acc[item.fish_type]) acc[item.fish_type] = [];
        acc[item.fish_type].push(item);
        return acc;
      }, {});
      
      setFishTypeLocations(grouped);
    } catch (err) {
      console.error('Error fetching fish type locations:', err);
    } finally {
      setLoadingLocations(false);
    }
  }, [guide?.id]);

  useEffect(() => {
    if (isOpen && guide?.id && activeTab === 'guide') {
      fetchFishTypeLocations();
    }
  }, [isOpen, guide?.id, activeTab, fetchFishTypeLocations]);

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
        location: editedGuide.location,
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
      console.log('Guide profile saved successfully');
    } catch (err) {
      console.error('Error saving guide:', err);
      alert('Erreur lors de la sauvegarde: ' + err.message);
    } finally {
      setIsSavingGuide(false);
    }
  };

  // Add location for a fish type
  const handleAddLocation = async (fishType) => {
    if (!guide?.id) return;
    const input = newLocationInputs[fishType];
    if (!input?.name?.trim()) return;

    try {
      const { data, error } = await supabase
        .from('guide_fish_type_locations')
        .insert({
          guide_id: guide.id,
          fish_type: fishType,
          location_name: input.name.trim(),
          description: input.description?.trim() || null,
        })
        .select()
        .single();

      if (error) throw error;

      // Update local state
      setFishTypeLocations(prev => ({
        ...prev,
        [fishType]: [...(prev[fishType] || []), data]
      }));
      
      // Clear input
      setNewLocationInputs(prev => ({
        ...prev,
        [fishType]: { name: '', description: '' }
      }));
    } catch (err) {
      console.error('Error adding location:', err);
      if (err.code === '23505') {
        alert('Ce lieu existe déjà pour ce type de poisson.');
      } else {
        alert('Erreur lors de l\'ajout: ' + err.message);
      }
    }
  };

  // Remove a location
  const handleRemoveLocation = async (locationId, fishType) => {
    try {
      const { error } = await supabase
        .from('guide_fish_type_locations')
        .delete()
        .eq('id', locationId);

      if (error) throw error;

      setFishTypeLocations(prev => ({
        ...prev,
        [fishType]: (prev[fishType] || []).filter(loc => loc.id !== locationId)
      }));
    } catch (err) {
      console.error('Error removing location:', err);
    }
  };

  if (!isOpen) return null;

  const isGuide = profile?.type === 'guide' || profile?.type === 'admin';

  // Google Calendar link
  const googleCalendarHref = guide?.google_calendar_id
    ? `https://calendar.google.com/calendar/u/0/r?cid=${encodeURIComponent(guide.google_calendar_id)}`
    : "https://calendar.google.com";

  const avatarUrl = user?.user_metadata?.avatar_url || user?.raw_user_meta_data?.avatar_url || '/default-avatar.png';

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
        width: '100vw',
        height: '100vh',
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
          padding: '32px 40px',
          borderBottom: '1px solid #E5E7EB',
          flexShrink: 0,
          backgroundColor: 'white',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <img
              src={avatarUrl}
              alt="Avatar"
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
          padding: '0 40px',
          flexShrink: 0,
          backgroundColor: 'white',
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
          {isGuide && (
            <button
              type="button"
              onClick={() => setActiveTab('reservations')}
              style={{
                padding: '12px 20px',
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: activeTab === 'reservations' ? '600' : '400',
                color: activeTab === 'reservations' ? '#2D5F4C' : '#5A7766',
                borderBottom: activeTab === 'reservations' ? '2px solid #2D5F4C' : '2px solid transparent',
                transition: 'all 0.2s ease',
              }}
            >
              📅 Réservations
            </button>
          )}
        </div>

        {/* Content */}
        <div style={{ 
          flex: 1, 
          overflowY: 'auto', 
          padding: '40px',
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

              {/* Top action buttons */}
              <div style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '10px',
                flexWrap: 'wrap',
              }}>
                <button
                  type="button"
                  onClick={() => setShowCalendarModal(true)}
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
                  📅 Gérer le calendrier
                </button>
                {onOpenClients && (
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
                )}
                {onOpenHelp && (
                  <button
                    type="button"
                    onClick={onOpenHelp}
                    style={{
                      padding: '10px 18px',
                      backgroundColor: 'transparent',
                      color: '#5A7766',
                      border: '1px dashed #5A7766',
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
                      e.currentTarget.style.backgroundColor = 'rgba(90, 119, 102, 0.1)';
                      e.currentTarget.style.borderStyle = 'solid';
                    }}
                    onMouseOut={(e) => {
                      e.currentTarget.style.backgroundColor = 'transparent';
                      e.currentTarget.style.borderStyle = 'dashed';
                    }}
                  >
                    ❓ Aide
                  </button>
                )}
              </div>

              {/* Guide Profile Section */}
              <div style={{
                padding: '20px',
                backgroundColor: 'white',
                borderRadius: '12px',
                border: '1px solid #E5E7EB',
              }}>
                <h3 style={{ margin: '0 0 16px', fontSize: '16px', color: '#1F3A2E' }}>
                  Profil de guide
                </h3>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div style={{ display: 'flex', gap: '12px' }}>
                    <div style={{ flex: 1 }}>
                      <label style={labelStyle}>Nom</label>
                      <input
                        type="text"
                        value={editedGuide.name}
                        onChange={(e) => setEditedGuide(p => ({ ...p, name: e.target.value }))}
                        style={inputStyle}
                      />
                    </div>
                    <div style={{ flex: 1 }}>
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

                  <div style={{ display: 'flex', gap: '12px' }}>
                    <div style={{ flex: 1 }}>
                      <label style={labelStyle}>Téléphone</label>
                      <input
                        type="tel"
                        value={editedGuide.phone}
                        onChange={(e) => setEditedGuide(p => ({ ...p, phone: e.target.value }))}
                        style={inputStyle}
                      />
                    </div>
                    <div style={{ flex: 1 }}>
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
                    <label style={labelStyle}>Localisation</label>
                    <input
                      type="text"
                      value={editedGuide.location}
                      onChange={(e) => setEditedGuide(p => ({ ...p, location: e.target.value }))}
                      placeholder="Ex: Gaspésie, QC"
                      style={inputStyle}
                    />
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
              </div>

              {/* Fish Types + Locations Section */}
              <div style={{
                padding: '20px',
                backgroundColor: 'white',
                borderRadius: '12px',
                border: '1px solid #E5E7EB',
              }}>
                <h3 style={{ margin: '0 0 8px', fontSize: '16px', color: '#1F3A2E' }}>
                  Spécialisations & Lieux de pêche
                </h3>
                <p style={{ margin: '0 0 16px', fontSize: '13px', color: '#5A7766' }}>
                  Sélectionnez vos types de poissons, puis associez des lieux spécifiques pour chacun.
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

                {/* Location assignments per selected fish type */}
                {(editedGuide.fish_types || []).length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {(editedGuide.fish_types || []).map(ft => {
                      const fishLabel = FISH_TYPES.find(f => f.value === ft)?.label || ft;
                      const locations = fishTypeLocations[ft] || [];
                      const inputVal = newLocationInputs[ft] || { name: '', description: '' };

                      return (
                        <div key={ft} style={{
                          padding: '14px',
                          backgroundColor: 'rgba(74, 155, 142, 0.05)',
                          borderRadius: '10px',
                          border: '1px solid rgba(74, 155, 142, 0.2)',
                        }}>
                          <h4 style={{ margin: '0 0 10px', fontSize: '14px', color: '#1F3A2E' }}>
                            🐟 {fishLabel}
                          </h4>

                          {/* Existing locations */}
                          {locations.length > 0 && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' }}>
                              {locations.map(loc => (
                                <div
                                  key={loc.id}
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    padding: '6px 10px',
                                    backgroundColor: 'rgba(45, 95, 76, 0.1)',
                                    borderRadius: '16px',
                                    fontSize: '12px',
                                    color: '#2D5F4C',
                                  }}
                                >
                                  📍 {loc.location_name}
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveLocation(loc.id, ft)}
                                    style={{
                                      background: 'none', border: 'none',
                                      cursor: 'pointer', fontSize: '12px',
                                      color: '#DC2626', padding: '0 2px',
                                      lineHeight: 1,
                                    }}
                                  >
                                    ✕
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Add new location */}
                          <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
                            <div style={{ flex: 1 }}>
                              <input
                                type="text"
                                value={inputVal.name}
                                onChange={(e) => setNewLocationInputs(prev => ({
                                  ...prev,
                                  [ft]: { ...prev[ft], name: e.target.value }
                                }))}
                                placeholder="Nom du lieu (ex: Rivière Cascapédia)"
                                style={{
                                  width: '100%', padding: '8px 10px', borderRadius: '8px',
                                  border: '1px solid #D1D5DB', fontSize: '13px',
                                  color: '#1F3A2E', backgroundColor: 'white',
                                  boxSizing: 'border-box',
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleAddLocation(ft);
                                }}
                              />
                            </div>
                            <button
                              type="button"
                              onClick={() => handleAddLocation(ft)}
                              disabled={!inputVal.name?.trim()}
                              style={{
                                padding: '8px 14px',
                                backgroundColor: inputVal.name?.trim() ? '#2D5F4C' : '#9CA3AF',
                                color: 'white',
                                border: 'none',
                                borderRadius: '8px',
                                cursor: inputVal.name?.trim() ? 'pointer' : 'not-allowed',
                                fontSize: '13px',
                                fontWeight: '500',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              + Ajouter
                            </button>
                          </div>

                          {locations.length === 0 && (
                            <p style={{ margin: '8px 0 0', fontSize: '11px', color: '#9CA3AF', fontStyle: 'italic' }}>
                              Aucun lieu associé. Ajoutez des rivières, lacs ou zones.
                            </p>
                          )}
                        </div>
                      );
                    })}
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
              </div>


              {/* Stripe Payments Section */}
              <div style={{
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
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
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

                {stripeStatus.chargesEnabled && !editedGuide.hourly_rate && (
                  <div style={{ padding: '8px 12px', background: '#fef3c7', color: '#92400e', borderRadius: '8px', fontSize: '13px', marginTop: '8px' }}>
                    ⚠️ Définissez votre tarif horaire ci-dessus pour que les clients puissent payer en ligne
                  </div>
                )}
              </div>

              {/* Statistics */}
              <div style={{
                padding: '20px',
                backgroundColor: 'white',
                borderRadius: '12px',
                border: '1px solid #E5E7EB',
              }}>
                <h3 style={{ margin: '0 0 12px', fontSize: '16px', color: '#1F3A2E' }}>
                  Statistiques
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
              </div>
            </div>
          )}

          {/* RESERVATIONS TAB */}
          {activeTab === 'reservations' && isGuide && (
            <GuideReservationsPanel guide={guide} />
          )}

          </div>
        </div>

        {/* Fullscreen Calendar Modal */}
        {showCalendarModal && (
          <div style={{
            position: 'fixed',
            top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.6)',
            zIndex: 20000,
            display: 'flex',
            alignItems: 'stretch',
            justifyContent: 'stretch',
          }}>
            <div style={{
              width: '100vw',
              height: '100vh',
              backgroundColor: '#FFFCF7',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}>
              {/* Calendar modal header */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '20px 32px',
                borderBottom: '1px solid #E5E7EB',
                backgroundColor: 'white',
                flexShrink: 0,
              }}>
                <h2 style={{ margin: 0, fontSize: '20px', color: '#1F3A2E', fontWeight: '600' }}>
                  📅 Calendrier
                </h2>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <a
                    href={googleCalendarHref}
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
                    }}
                  >
                    Ouvrir Google Calendar
                  </a>
                  {!guide?.google_refresh_token && (
                    <button
                      type="button"
                      onClick={() => {
                        if (!guide?.id) return;
                        const redirectTo = encodeURIComponent(globalThis.location.href);
                        globalThis.location.href = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-calendar-oauth?guideId=${guide.id}&redirect_to=${redirectTo}`;
                      }}
                      style={{
                        padding: '8px 14px',
                        backgroundColor: '#f59e0b',
                        color: 'white',
                        border: 'none',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        fontSize: '13px',
                        fontWeight: '500',
                      }}
                    >
                      Connecter Google Calendar
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowCalendarModal(false)}
                    style={{
                      background: 'none', border: 'none', fontSize: '28px',
                      cursor: 'pointer', color: '#5A7766', padding: '4px 10px',
                      borderRadius: '8px',
                      transition: 'all 0.2s ease',
                    }}
                    onMouseOver={(e) => { e.target.style.backgroundColor = 'rgba(239, 68, 68, 0.1)'; e.target.style.color = '#DC2626'; }}
                    onMouseOut={(e) => { e.target.style.backgroundColor = 'transparent'; e.target.style.color = '#5A7766'; }}
                  >
                    ✕
                  </button>
                </div>
              </div>
              {/* Calendar body */}
              <div style={{ flex: 1, overflow: 'auto', padding: '24px 32px', display: 'flex', flexDirection: 'column' }}>
                {guide?.google_refresh_token ? (
                  <div style={{
                    marginBottom: '16px',
                    padding: '10px 14px',
                    backgroundColor: 'rgba(34, 197, 94, 0.1)',
                    borderRadius: '8px',
                    fontSize: '13px',
                    color: '#059669',
                    display: 'inline-block',
                    flexShrink: 0,
                  }}>
                    ✓ Google Calendar est connecté
                  </div>
                ) : null}
                <div style={{ flex: 1, minHeight: 0 }}>
                  <GuideCalendar guideId={guide?.id} />
                </div>
              </div>
            </div>
          </div>
        )}
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
