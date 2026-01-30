/* eslint-disable no-unused-vars */
import React, { useState, useEffect } from "react";
void React;
import GuideCalendar from "../components/GuideCalendar.jsx";
import supabase from "../utils/supabase.js";

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

// -------------------
// Named export: GuideCalendar
// -------------------

// -------------------
// Default export: GuideProfile
// -------------------
export default function GuideProfile({ isGuideOpen, closeGuide, guide, onOpenHelp }) {
  const [isEditing, setIsEditing] = useState(false);
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
  const [isSaving, setIsSaving] = useState(false);
  console.log("GuideProfile render, guide =", guide);

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
    }
  }, [guide]);


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
      location: editedGuide.location,
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
        console.log("Guide updated:", data);
        // Update local state with returned row
        setEditedGuide({
          name: data.name || "",
          experience: data.experience || "",
          bio: data.bio || "",
          hourly_rate: data.hourly_rate || "",
          location: data.location || "",
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
      location: guide?.location || "",
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
          <div className="guide-avatar" aria-hidden>
            {initials}
          </div>
          <div>
            <div style={{ fontSize: 12, color: "#6b7280" }}>Profil</div>
            <h1 className="guide-profile-title">{editedGuide.name || guide?.name || "Mon Profil de Guide"}</h1>
          </div>
        </div>

        <div className="guide-header-actions">
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

              {/* Location */}
              <div className="guide-form-group">
                <label>Localisation</label>
                {isEditing ? (
                  <input
                    type="text"
                    value={editedGuide.location}
                    onChange={(e) =>
                      setEditedGuide({ ...editedGuide, location: e.target.value })
                    }
                    className="guide-input"
                    placeholder="Ex: Charlevoix, QC"
                  />
                ) : (
                  <p className="guide-text">{editedGuide.location || "Non défini"}</p>
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