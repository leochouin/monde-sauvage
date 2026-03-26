/* eslint-disable no-unused-vars */
import React, { useState, useEffect } from "react";
void React;
import GuideCalendar from "../components/GuideCalendar.jsx";
import AvatarImage from "../components/AvatarImage.jsx";
import supabase from "../utils/supabase.js";
import { resolveAvatarFromSources } from "../utils/avatar.js";

// Fish types available for guides to specialize in
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

  const isMissingGuideServiceLocationsTableError = (error) => {
    const message = String(error?.message || '').toLowerCase();
    return (
      error?.code === '42P01'
      || error?.code === 'PGRST205'
      || message.includes("could not find the table 'public.guide_service_locations'")
      || message.includes('relation "guide_service_locations" does not exist')
    );
  };

// -------------------
// Named export: GuideCalendar
// -------------------

// -------------------
// Default export: GuideProfile
// -------------------
export default function GuideProfile({ isGuideOpen, closeGuide, guide, onOpenHelp, onOpenClients }) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedGuide, setEditedGuide] = useState({
    name: '',
    experience: '',
    bio: '',
    hourly_rate: '',
    phone: '',
    email: '',
    fish_types: [],
  });
  const [availableZonesByFishType, setAvailableZonesByFishType] = useState({});
  const [selectedServiceLocationIds, setSelectedServiceLocationIds] = useState([]);
  const [selectedLocationRows, setSelectedLocationRows] = useState([]);
  const [serviceLocationError, setServiceLocationError] = useState('');
  const [loadingServiceLocations, setLoadingServiceLocations] = useState(false);
  const [isLocationDropdownOpen, setIsLocationDropdownOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [guideAvatarSrc, setGuideAvatarSrc] = useState('');
  console.log("GuideProfile render, guide =", guide);

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
    }
  }, [guide]);

  useEffect(() => {
    let cancelled = false;

    const loadGuideAvatar = async () => {
      if (!guide) {
        if (!cancelled) setGuideAvatarSrc('');
        return;
      }

      let linkedUser = null;
      if (guide?.user_id) {
        const { data: userRow, error: userError } = await supabase
          .from('users')
          .select('*')
          .eq('id', guide.user_id)
          .maybeSingle();

        if (!userError) {
          linkedUser = userRow || null;
        }
      }

      let authUser = null;
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (!authError && authData?.user?.id === guide?.user_id) {
        authUser = authData.user;
      }

      const { avatarSrc } = await resolveAvatarFromSources([guide, linkedUser, authUser], {
        supabase,
        emptySrcFallback: '',
      });

      if (!cancelled) {
        setGuideAvatarSrc(avatarSrc);
      }
    };

    loadGuideAvatar();

    return () => {
      cancelled = true;
    };
  }, [guide]);

  useEffect(() => {
    const selectedFishTypes = editedGuide.fish_types || [];
    const fetchAvailableZones = async () => {
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
        setServiceLocationError('Impossible de charger les lieux de peche.');
      }
    };

    fetchAvailableZones();
  }, [editedGuide.fish_types]);

  useEffect(() => {
    if (!guide?.id) return;

    const fetchGuideServiceLocations = async () => {
      setLoadingServiceLocations(true);
      try {
        const { data, error } = await supabase
          .from('guide_service_locations')
          .select('fish_type, fishing_zone_id, fishing_zone:fishing_zone_id(id, name, fish_type, description)')
          .eq('guide_id', guide.id)
          .order('fish_type', { ascending: true });

        if (error) {
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
      } catch (err) {
        console.error('Error fetching guide service locations:', err);
        setSelectedLocationRows([]);
        setSelectedServiceLocationIds([]);
        setServiceLocationError('Impossible de charger les lieux de service sauvegardes.');
      } finally {
        setLoadingServiceLocations(false);
      }
    };

    fetchGuideServiceLocations();
  }, [guide?.id]);

  useEffect(() => {
    const allAvailableZoneIds = new Set(
      Object.values(availableZonesByFishType)
        .flat()
        .map((zone) => zone.id)
    );
    setSelectedServiceLocationIds((prev) => prev.filter((id) => allAvailableZoneIds.has(id)));
  }, [availableZonesByFishType]);


  if (!isGuideOpen) return null;
  
  const handleSave = async () => {
    console.log("Saving guide data:", editedGuide);
    if (!guide?.id) {
      alert('Impossible de sauvegarder: ID du guide manquant.');
      return;
    }

    setIsSaving(true);
    // Prepare payload: ensure hourly_rate is a number or null
    const payload = {
      name: editedGuide.name,
      experience: editedGuide.experience,
      bio: editedGuide.bio,
      phone: editedGuide.phone,
      email: editedGuide.email,
      fish_types: editedGuide.fish_types,
      hourly_rate:
        editedGuide.hourly_rate === "" || editedGuide.hourly_rate == null
          ? null
          : Number(editedGuide.hourly_rate),
    };

    try {
      const { data, error } = await supabase
        .from("guide")
        .update(payload)
        .eq("id", guide.id)
        .select()
        .single();

      if (error) {
        console.error("Supabase update error:", error);
        alert("Erreur lors de la sauvegarde: " + error.message);
      } else {
        try {
          const zoneById = new Map(
            Object.values(availableZonesByFishType)
              .flat()
              .map((zone) => [zone.id, zone])
          );

          const rows = selectedServiceLocationIds
            .map((zoneId) => zoneById.get(zoneId))
            .filter((zone) => zone && (editedGuide.fish_types || []).includes(zone.fish_type))
            .map((zone) => ({
              guide_id: guide.id,
              fish_type: zone.fish_type,
              fishing_zone_id: zone.id,
            }));

          const { error: deleteError } = await supabase
            .from('guide_service_locations')
            .delete()
            .eq('guide_id', guide.id);

          if (deleteError) {
            if (isMissingGuideServiceLocationsTableError(deleteError)) {
              setServiceLocationError('Le schema des lieux de service n\'est pas encore migre. Lancez la migration Supabase.');
              return;
            }
            throw deleteError;
          }

          if (rows.length > 0) {
            const { error: insertError } = await supabase
              .from('guide_service_locations')
              .insert(rows);
            if (insertError) {
              if (isMissingGuideServiceLocationsTableError(insertError)) {
                setServiceLocationError('Le schema des lieux de service n\'est pas encore migre. Lancez la migration Supabase.');
                return;
              }
              throw insertError;
            }
          }
        } catch (syncErr) {
          console.error('Error syncing guide service locations:', syncErr);
          alert('Profil sauve, mais erreur lors de la sauvegarde des lieux de service: ' + syncErr.message);
        }

        console.log("Guide updated:", data);
        // Update local state with returned row
        setEditedGuide({
          name: data.name || "",
          experience: data.experience || "",
          bio: data.bio || "",
          hourly_rate: data.hourly_rate || "",
          phone: data.phone || "",
          email: data.email || "",
          fish_types: data.fish_types || [],
        });
        setIsEditing(false);
        // Optional: inform parent (if they rely on guide prop) via console.
        console.log('Guide saved to Supabase.');
      }
    } catch (err) {
      console.error('Unexpected error saving guide:', err);
      alert('Erreur inattendue lors de la sauvegarde. Voir la console pour plus de détails.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setEditedGuide({
      name: guide?.name || "",
      experience: guide?.experience || "",
      bio: guide?.bio || "",
      hourly_rate: guide?.hourly_rate || "",
      phone: guide?.phone || "",
      email: guide?.email || "",
      fish_types: guide?.fish_types || [],
    });
    setIsEditing(false);
  };

  // Toggle fish type selection
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

  const toggleServiceLocation = (zoneId) => {
    setSelectedServiceLocationIds((prev) => {
      if (prev.includes(zoneId)) {
        return prev.filter((id) => id !== zoneId);
      }
      return [...prev, zoneId];
    });
  };


  // derive initials for avatar
  const initials = (editedGuide.name || guide?.name || "Guide")
    .split(" ")
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  // Link to open Google Calendar. If a specific calendar id is available, open that calendar view.
  const googleCalendarHref = guide?.google_calendar_id
    ? `https://calendar.google.com/calendar/u/0/r?cid=${encodeURIComponent(
        guide.google_calendar_id
      )}`
    : "https://calendar.google.com";

  return (
    <div className="guide-profile-fullscreen">
      {/* Header - modern, compact */}
      <div className="guide-profile-header">
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <button type="button" className="guide-back-button" onClick={closeGuide}>
            ← Retour
          </button>
          <AvatarImage
            src={guideAvatarSrc}
            name={editedGuide.name || guide?.name || 'Guide'}
            alt={editedGuide.name || guide?.name || 'Guide'}
            className="guide-avatar"
            fallbackClassName="guide-avatar"
            fallback={initials || 'GU'}
          />
          <div>
            <div style={{ fontSize: 12, color: "#6b7280" }}>Profil</div>
            <h1 className="guide-profile-title">{editedGuide.name || guide?.name || "Mon Profil de Guide"}</h1>
          </div>
        </div>

        <div className="guide-header-actions">
          {onOpenClients && (
            <button 
              type="button" 
              className="guide-clients-button" 
              onClick={onOpenClients}
              title="Gérer mes clients"
              style={{
                padding: '8px 14px',
                backgroundColor: '#eff6ff',
                color: '#1d4ed8',
                border: '1px solid #bfdbfe',
                borderRadius: '8px',
                cursor: 'pointer',
                fontWeight: '500',
                fontSize: '13px',
                transition: 'all 0.2s ease',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                marginRight: '8px'
              }}
              onMouseOver={(e) => {
                e.target.style.backgroundColor = '#dbeafe';
                e.target.style.borderColor = '#93c5fd';
              }}
              onMouseOut={(e) => {
                e.target.style.backgroundColor = '#eff6ff';
                e.target.style.borderColor = '#bfdbfe';
              }}
            >
              👥 Mes Clients
            </button>
          )}
          {onOpenHelp && (
            <button 
              type="button" 
              className="guide-help-button" 
              onClick={onOpenHelp}
              title="Voir le tutoriel"
              style={{
                padding: '8px 14px',
                backgroundColor: 'transparent',
                color: '#5A7766',
                border: '1px dashed #5A7766',
                borderRadius: '8px',
                cursor: 'pointer',
                fontWeight: '500',
                fontSize: '13px',
                transition: 'all 0.2s ease',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                marginRight: '8px'
              }}
              onMouseOver={(e) => {
                e.target.style.backgroundColor = 'rgba(90, 119, 102, 0.1)';
                e.target.style.borderStyle = 'solid';
              }}
              onMouseOut={(e) => {
                e.target.style.backgroundColor = 'transparent';
                e.target.style.borderStyle = 'dashed';
              }}
            >
              ❓ Aide
            </button>
          )}
          {!isEditing ? (
            <button type="button" className="guide-edit-button" onClick={() => setIsEditing(true)}>
              ✏️ Modifier
            </button>
          ) : (
            <div className="guide-edit-actions">
              <button type="button" className="guide-cancel-button" onClick={handleCancel}>
                Annuler
              </button>
              <button
                type="button"
                className="guide-save-button"
                onClick={handleSave}
                disabled={isSaving}
              >
                {isSaving ? "Enregistrement..." : "💾 Sauvegarder"}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="guide-profile-content">
        {/* Left Column - Profile Information */}
        <div className="guide-profile-left">
          {/* Personal Info */}
          <div className="guide-section guide-card">
            <h2 className="guide-section-title">Informations Personnelles</h2>
            <div className="guide-section-content">
              {/* Name */}
              <div className="guide-form-group">
                <label>Nom complet</label>
                {isEditing ? (
                  <input
                    type="text"
                    value={editedGuide.name}
                    onChange={(e) =>
                      setEditedGuide({ ...editedGuide, name: e.target.value })
                    }
                    className="guide-input"
                  />
                ) : (
                  <p className="guide-text">{editedGuide.name || "Non défini"}</p>
                )}
              </div>

              {/* Experience */}
              <div className="guide-form-group">
                <label>Expérience</label>
                {isEditing ? (
                  <textarea
                    value={editedGuide.experience}
                    onChange={(e) =>
                      setEditedGuide({ ...editedGuide, experience: e.target.value })
                    }
                    className="guide-textarea"
                    rows="3"
                  />
                ) : (
                  <p className="guide-text">{editedGuide.experience || "Non défini"}</p>
                )}
              </div>

              {/* Phone & Email */}
              <div className="guide-form-row">
                <div className="guide-form-group">
                  <label>Téléphone</label>
                  {isEditing ? (
                    <input
                      type="tel"
                      value={editedGuide.phone}
                      onChange={(e) =>
                        setEditedGuide({ ...editedGuide, phone: e.target.value })
                      }
                      className="guide-input"
                      placeholder="(418) 123-4567"
                    />
                  ) : (
                    <p className="guide-text">{editedGuide.phone || "Non défini"}</p>
                  )}
                </div>

                <div className="guide-form-group">
                  <label>Courriel</label>
                  {isEditing ? (
                    <input
                      type="email"
                      value={editedGuide.email}
                      onChange={(e) =>
                        setEditedGuide({ ...editedGuide, email: e.target.value })
                      }
                      className="guide-input"
                      placeholder="guide@example.com"
                    />
                  ) : (
                    <p className="guide-text">{editedGuide.email || "Non défini"}</p>
                  )}
                </div>
              </div>

              {/* Hourly Rate */}
              <div className="guide-form-group">
                <label>Tarif horaire ($)</label>
                {isEditing ? (
                  <input
                    type="number"
                    value={editedGuide.hourly_rate}
                    onChange={(e) =>
                      setEditedGuide({ ...editedGuide, hourly_rate: e.target.value })
                    }
                    className="guide-input"
                    placeholder="Ex: 75"
                  />
                ) : (
                  <p className="guide-text">
                    {editedGuide.hourly_rate
                      ? `${editedGuide.hourly_rate}$ / heure`
                      : "Non défini"}
                  </p>
                )}
              </div>

              {/* Fish Types - Specializations */}
              <div className="guide-form-group">
                <label>Spécialisations (types de poissons)</label>
                {isEditing ? (
                  <div style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '8px',
                    marginTop: '8px'
                  }}>
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
                            gap: '6px'
                          }}
                        >
                          {isSelected && <span>✓</span>}
                          🐟 {fish.label}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '8px',
                    marginTop: '8px'
                  }}>
                    {(editedGuide.fish_types || []).length > 0 ? (
                      editedGuide.fish_types.map((fishValue) => {
                        const fish = FISH_TYPES.find(f => f.value === fishValue);
                        return (
                          <span
                            key={fishValue}
                            style={{
                              padding: '6px 12px',
                              borderRadius: '16px',
                              backgroundColor: 'rgba(74, 155, 142, 0.15)',
                              color: '#2D5F4C',
                              fontSize: '13px',
                              fontWeight: '500'
                            }}
                          >
                            🐟 {fish?.label || fishValue}
                          </span>
                        );
                      })
                    ) : (
                      <p className="guide-text" style={{ margin: 0 }}>Aucune spécialisation</p>
                    )}
                  </div>
                )}
              </div>

              <div className="guide-form-group">
                <label>Lieux de service (selection multiple)</label>
                {(editedGuide.fish_types || []).length === 0 ? (
                  <p className="guide-text" style={{ margin: 0 }}>
                    Selectionnez d'abord un ou plusieurs types de poisson.
                  </p>
                ) : isEditing ? (
                  <div style={{ position: 'relative' }}>
                    <button
                      type="button"
                      onClick={() => setIsLocationDropdownOpen((prev) => !prev)}
                      className="guide-input"
                      style={{ textAlign: 'left', cursor: 'pointer' }}
                    >
                      {selectedServiceLocationIds.length > 0
                        ? `${selectedServiceLocationIds.length} lieu(x) selectionne(s)`
                        : 'Choisir les lieux de service'}
                      <span style={{ float: 'right' }}>{isLocationDropdownOpen ? '▲' : '▼'}</span>
                    </button>

                    {isLocationDropdownOpen && (
                      <div style={{
                        position: 'absolute',
                        zIndex: 30,
                        left: 0,
                        right: 0,
                        marginTop: 6,
                        backgroundColor: '#fff',
                        border: '1px solid #D1D5DB',
                        borderRadius: 8,
                        boxShadow: '0 8px 20px rgba(15, 23, 42, 0.12)',
                        maxHeight: 260,
                        overflowY: 'auto',
                        padding: 8,
                      }}>
                        {loadingServiceLocations ? (
                          <div style={{ fontSize: 13, color: '#6B7280', padding: '6px 4px' }}>Chargement...</div>
                        ) : (
                          (editedGuide.fish_types || []).map((fishType) => {
                            const zones = availableZonesByFishType[fishType] || [];
                            return (
                              <div key={fishType} style={{ padding: '6px 4px', borderBottom: '1px solid #F3F4F6' }}>
                                <div style={{ fontSize: 12, fontWeight: 600, color: '#2D5F4C', marginBottom: 6 }}>
                                  🐟 {getFishLabel(fishType)}
                                </div>
                                {zones.length === 0 ? (
                                  <div style={{ fontSize: 12, color: '#9CA3AF', fontStyle: 'italic' }}>
                                    Aucun lieu disponible pour ce type de poisson.
                                  </div>
                                ) : (
                                  zones.map((zone) => (
                                    <label key={zone.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '5px 2px', fontSize: 13 }}>
                                      <input
                                        type="checkbox"
                                        checked={selectedServiceLocationIds.includes(zone.id)}
                                        onChange={() => toggleServiceLocation(zone.id)}
                                      />
                                      <span>{zone.name}</span>
                                    </label>
                                  ))
                                )}
                              </div>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                    {selectedLocationRows.length > 0 ? (
                      selectedLocationRows.map((row) => (
                        row.fishing_zone && (
                          <span key={row.fishing_zone_id} style={{ padding: '6px 12px', borderRadius: 16, backgroundColor: 'rgba(74, 155, 142, 0.15)', color: '#2D5F4C', fontSize: 13, fontWeight: 500 }}>
                            📍 {row.fishing_zone.name}
                          </span>
                        )
                      ))
                    ) : (
                      <p className="guide-text" style={{ margin: 0 }}>Aucun lieu de service</p>
                    )}
                  </div>
                )}
                {serviceLocationError && (
                  <p style={{ margin: '6px 0 0', fontSize: 12, color: '#B45309' }}>{serviceLocationError}</p>
                )}
              </div>
            </div>
          </div>

          {/* Biography */}
          <div className="guide-section guide-card">
            <h2 className="guide-section-title">Biographie</h2>
            <div className="guide-section-content">
              {isEditing ? (
                <textarea
                  value={editedGuide.bio}
                  onChange={(e) =>
                    setEditedGuide({ ...editedGuide, bio: e.target.value })
                  }
                  className="guide-textarea"
                  rows="6"
                  placeholder="Parlez de votre passion, votre expertise, et ce qui rend vos sorties uniques..."
                />
              ) : (
                <p className="guide-text">{editedGuide.bio || "Aucune biographie"}</p>
              )}
            </div>
          </div>
        </div>

        {/* Right Column - Calendar */}
        <div className="guide-profile-right">
          <div className="guide-calendar-container">
            <GuideCalendar guideId={guide?.id} />
          </div>

          {/* Link/button to open Google Calendar in a new tab. Uses specific calendar if available. */}
          <div style={{ marginTop: 8 }}>
            <a
              className="guide-open-calendar-button"
              href={googleCalendarHref}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-block",
                padding: "8px 12px",
                background: "#1a73e8",
                color: "#fff",
                borderRadius: 6,
                textDecoration: "none",
                fontSize: 14,
              }}
            >
              Ouvrir Google Calendar
            </a>
          </div>

          {guide && !guide.google_refresh_token && (
            <button
              type="button"
              onClick={() => {
                if (!guide?.id) return;
                const redirectTo = encodeURIComponent(globalThis.location.href); // Return to current page
                console.log("Redirecting to Google OAuth for guideId:", guide.id);
                globalThis.location.href = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-calendar-oauth?guideId=${guide.id}&redirect_to=${redirectTo}`;
              }}
              className="guide-connect-button"
            >
              Connecter Google Calendar
            </button>
          )}

          {/* Stats */}
          <div className="guide-section">
            <h2 className="guide-section-title">Statistiques</h2>
            <div className="guide-section-content">
              <div className="guide-stats">
                <div className="guide-stat-item">
                  <div className="guide-stat-value">0</div>
                  <div className="guide-stat-label">Réservations totales</div>
                </div>
                <div className="guide-stat-item">
                  <div className="guide-stat-value">0</div>
                  <div className="guide-stat-label">Avis reçus</div>
                </div>
                <div className="guide-stat-item">
                  <div className="guide-stat-value">N/A</div>
                  <div className="guide-stat-label">Note moyenne</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}