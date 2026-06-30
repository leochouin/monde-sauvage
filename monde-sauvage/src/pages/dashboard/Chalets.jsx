import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useEstablishment } from '../../components/layout/EstablishmentLayout.jsx';
import ChaletHoraireModal from '../../modals/chaletHoraireModal.jsx';
import supabase from '../../utils/supabase.js';
import { toast } from '../../utils/toast.js';
import { isInGaspesieBounds, toCoordinateInputValue, searchAddressesInGaspesie } from '../../utils/locationService.js';
import './establishment-dashboard.css';
import {
  DndContext, DragOverlay, PointerSensor, closestCenter, useSensor, useSensors,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// ─── Constantes ───────────────────────────────────────────────────────────────
const PREDEFINED_AMENITIES = [
  { id: 'river_view', label: 'Vue sur la riviere', icon: '🌊', keywords: ['vue sur la riviere', 'river view', 'riviere'] },
  { id: 'fire_pit', label: 'Foyer exterieur', icon: '🔥', keywords: ['foyer', 'fire pit', 'feu exterieur'] },
  { id: 'hot_tub', label: 'Spa', icon: '♨️', keywords: ['spa', 'hot tub', 'jacuzzi'] },
  { id: 'fireplace', label: 'Foyer interieur', icon: '🪵', keywords: ['foyer interieur', 'fireplace', 'poele'] },
  { id: 'wifi', label: 'Wifi rapide', icon: '📶', keywords: ['wifi', 'wi-fi', 'internet'] },
  { id: 'bbq', label: 'BBQ', icon: '🍖', keywords: ['bbq', 'barbecue', 'grill'] },
  { id: 'kayaks', label: 'Kayaks', icon: '🛶', keywords: ['kayak', 'canoe', 'canot'] },
  { id: 'dock', label: 'Acces au quai', icon: '⚓', keywords: ['quai', 'dock', 'acces au lac'] },
  { id: 'pet_friendly', label: 'Animaux acceptes', icon: '🐾', keywords: ['animaux', 'pet friendly', 'chiens'] },
  { id: 'parking', label: 'Stationnement', icon: '🚗', keywords: ['stationnement', 'parking'] },
];

const CHALET_WIZARD_STEPS = [
  { key: 'type', label: 'Type de propriete' },
  { key: 'location', label: 'Localisation' },
  { key: 'basic', label: 'Infos de base' },
  { key: 'amenities', label: 'Commodites' },
  { key: 'photos', label: 'Photos' },
  { key: 'pricing', label: 'Tarification' },
  { key: 'review', label: 'Verification' },
];

// ─── Utilitaires ──────────────────────────────────────────────────────────────
const inferChaletCategory = (chalet) => {
  const text = `${chalet?.Name || ''} ${chalet?.Description || ''}`.toLowerCase();
  if (text.includes('loft')) return 'Loft';
  if (text.includes('tent') || text.includes('tente')) return 'Tente';
  if (text.includes('cabane')) return 'Cabane';
  if (text.includes('dome') || text.includes('dôme')) return 'Dôme';
  if (text.includes('suite')) return 'Suite';
  return 'Chalet';
};

const inferAmenitiesFromDescription = (desc = '') => {
  const norm = desc.toLowerCase();
  return PREDEFINED_AMENITIES.filter((a) => a.keywords.some((kw) => norm.includes(kw))).map((a) => a.id);
};

const buildAmenitiesDescription = (ids, manual) => {
  const labels = PREDEFINED_AMENITIES.filter((a) => ids.includes(a.id)).map((a) => a.label);
  const clean = manual.trim();
  if (labels.length > 0 && clean) return `Commodites: ${labels.join(', ')}.\n\n${clean}`;
  if (labels.length > 0) return `Commodites: ${labels.join(', ')}`;
  return clean;
};

// ─── Mini-composants ──────────────────────────────────────────────────────────
const WizardStepPanel = ({ title, subtitle, children }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
    <div>
      <h3 style={{ fontSize: '1.22rem', color: '#1e293b', margin: 0 }}>{title}</h3>
      {subtitle && <p style={{ margin: '8px 0 0', color: '#64748b', fontSize: '0.92rem' }}>{subtitle}</p>}
    </div>
    {children}
  </div>
);

const UploadIcon = ({ size = 30 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 15V5" /><path d="m8.5 8.5 3.5-3.5 3.5 3.5" />
    <path d="M4 15.5v2A2.5 2.5 0 0 0 6.5 20h11a2.5 2.5 0 0 0 2.5-2.5v-2" />
  </svg>
);

const SortablePhotoCard = ({ id, children }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition: transition || 'transform 180ms ease', touchAction: 'none', cursor: isDragging ? 'grabbing' : 'grab', zIndex: isDragging ? 30 : 1, opacity: isDragging ? 0.88 : 1 }} {...attributes} {...listeners}>
      {children}
    </div>
  );
};

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function Chalets() {
  const navigate = useNavigate();
  const { selectedEstablishment, chalets, loading: ctxLoading, refresh: refreshCtx } = useEstablishment();

  const estabKey = String(selectedEstablishment?.key ?? selectedEstablishment?.id ?? '');

  // ── État wizard ──
  const [isCreatingChalet, setIsCreatingChalet] = useState(false);
  const [editingChalet, setEditingChalet] = useState(null);
  const [chaletForm, setChaletForm] = useState({ Name: '', Description: '', nb_personnes: '', price_per_night: '', latitude: '', longitude: '', Image: null });
  const [chaletWizardStep, setChaletWizardStep] = useState(0);
  const [chaletStepErrors, setChaletStepErrors] = useState({});
  const [chaletCreationStep, setChaletCreationStep] = useState(null);

  // ── État loading local ──
  const [loadingChalets, setLoadingChalets] = useState(false);
  const [chaletError, setChaletError] = useState(null);

  // ── État horaire modal ──
  const [isHoraireModalOpen, setIsHoraireModalOpen] = useState(false);
  const [selectedChaletForHoraire, setSelectedChaletForHoraire] = useState(null);

  // ── État filtres ──
  const [selectedCategory, setSelectedCategory] = useState('all');

  // ── État images ──
  const [imageFiles, setImageFiles] = useState([]);
  const [existingImages, setExistingImages] = useState([]);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [draggingImageId, setDraggingImageId] = useState(null);
  const [imageOrder, setImageOrder] = useState([]);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const fileInputRef = useRef(null);

  // ── État localisation ──
  const [locationAddress, setLocationAddress] = useState('');
  const [isSearchingLocation, setIsSearchingLocation] = useState(false);
  const [locationSuggestions, setLocationSuggestions] = useState([]);
  const [locationLookupError, setLocationLookupError] = useState(null);
  const [locationLookupSuccess, setLocationLookupSuccess] = useState(null);

  // ── État commodités ──
  const [selectedAmenities, setSelectedAmenities] = useState([]);

  // ── État compact ──
  const [isCompact, setIsCompact] = useState(false);

  // ── Google Calendar ──
  const [showGoogleModal, setShowGoogleModal] = useState(false);

  const dragSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  useEffect(() => {
    const sync = () => setIsCompact((globalThis.innerWidth || 0) < 1024);
    sync();
    globalThis.addEventListener('resize', sync);
    return () => globalThis.removeEventListener('resize', sync);
  }, []);

  // Recherche d'adresse avec debounce
  useEffect(() => {
    if (!isCreatingChalet || chaletWizardStep !== 1) return;
    const q = locationAddress.trim();
    if (q.length < 3) { setLocationSuggestions([]); setIsSearchingLocation(false); return; }
    const id = setTimeout(async () => {
      try {
        setIsSearchingLocation(true);
        setLocationLookupError(null);
        const suggestions = await searchAddressesInGaspesie(q, 6);
        setLocationSuggestions(suggestions);
      } catch (err) {
        setLocationSuggestions([]);
        setLocationLookupError(err.message || 'Impossible de rechercher cette adresse.');
      } finally {
        setIsSearchingLocation(false);
      }
    }, 300);
    return () => clearTimeout(id);
  }, [locationAddress, isCreatingChalet, chaletWizardStep]);

  // Écoute clic sur la carte
  useEffect(() => {
    const handlePick = (event) => {
      const { latitude, longitude } = event?.detail ?? {};
      if (!isInGaspesieBounds(latitude, longitude)) {
        setLocationLookupError('Le point sélectionné est hors de la région cible (Gaspésie).');
        setLocationLookupSuccess(null);
        setLocationSuggestions([]);
        globalThis.__MS_PICKING_LOCATION__ = false;
        return;
      }
      setChaletForm((prev) => ({ ...prev, latitude: toCoordinateInputValue(latitude), longitude: toCoordinateInputValue(longitude) }));
      setLocationLookupError(null);
      setLocationLookupSuccess('Point de carte sélectionné avec succès.');
      setLocationSuggestions([]);
      globalThis.__MS_PICKING_LOCATION__ = false;
    };
    globalThis.addEventListener('ms:map-location-picked', handlePick);
    return () => { globalThis.removeEventListener('ms:map-location-picked', handlePick); globalThis.__MS_PICKING_LOCATION__ = false; };
  }, []);

  // Sync des IDs d'images
  useEffect(() => {
    const existingItems = existingImages.map((img) => ({ id: `existing-${img.id}` }));
    const newItems = imageFiles.map((item) => ({ id: item.id }));
    const allIds = new Set([...existingItems, ...newItems].map((i) => i.id));
    setImageOrder((prev) => {
      const filtered = prev.filter((id) => allIds.has(id));
      const missing = [...allIds].filter((id) => !filtered.includes(id));
      return [...filtered, ...missing];
    });
  }, [existingImages, imageFiles]);

  const previewUrlMap = useMemo(() => {
    const map = {};
    imageFiles.forEach((item) => { map[item.id] = URL.createObjectURL(item.file); });
    return map;
  }, [imageFiles]);

  useEffect(() => () => Object.values(previewUrlMap).forEach((u) => URL.revokeObjectURL(u)), [previewUrlMap]);

  // ── Catégories ──
  const chaletCategories = ['all', ...Array.from(new Set(chalets.map(inferChaletCategory)))];
  const filteredChalets = selectedCategory === 'all' ? chalets : chalets.filter((c) => inferChaletCategory(c) === selectedCategory);

  // ── Validation wizard ──
  const getChaletStepValidation = (step) => {
    const errors = {};
    if (step === 0 && !chaletForm.Name.trim()) errors.Name = 'Le nom du chalet est requis.';
    if (step === 1 && (!chaletForm.latitude || !chaletForm.longitude)) errors.location = 'Sélectionnez une localisation GPS.';
    if (step === 2) {
      const cap = parseInt(chaletForm.nb_personnes, 10);
      if (!chaletForm.nb_personnes || isNaN(cap) || cap < 1) errors.nb_personnes = 'La capacité doit être au moins de 1 personne.';
    }
    if (step === 3 && selectedAmenities.length === 0 && !chaletForm.Description.trim()) errors.Description = 'Sélectionnez au moins une commodité ou ajoutez une description.';
    if (step === 4 && existingImages.length === 0 && imageFiles.length === 0 && !chaletForm.Image) errors.images = 'Ajoutez au moins une photo.';
    if (step === 5) {
      const price = parseFloat(chaletForm.price_per_night);
      if (!chaletForm.price_per_night || isNaN(price) || price < 0) errors.price_per_night = 'Ajoutez un prix valide par nuit.';
    }
    return { isValid: Object.keys(errors).length === 0, errors };
  };

  const wizardValidation = getChaletStepValidation(chaletWizardStep);
  const wizardProgress = ((chaletWizardStep + 1) / CHALET_WIZARD_STEPS.length) * 100;
  const generatedDescription = buildAmenitiesDescription(selectedAmenities, chaletForm.Description);

  const getActivePropertyType = () => inferChaletCategory({ Name: chaletForm.Name, Description: chaletForm.Description });

  // Items images ordonnés
  const existingImageItems = existingImages.map((img) => ({ id: `existing-${img.id}`, kind: 'existing', image: img }));
  const newImageItems = imageFiles.map((item) => ({ id: item.id, kind: 'new', file: item.file }));
  const imageItemMap = new Map([...existingImageItems, ...newImageItems].map((i) => [i.id, i]));
  const orderedImageItems = imageOrder.map((id) => imageItemMap.get(id)).filter(Boolean);
  const activeImage = draggingImageId ? imageItemMap.get(draggingImageId) : null;

  // ── Handlers images ──
  const addImageFiles = (files) => {
    const imgs = files.filter((f) => f.type?.startsWith('image/'));
    if (imgs.length > 0) {
      const mapped = imgs.map((f) => ({ id: `new-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`, file: f }));
      setImageFiles((prev) => [...prev, ...mapped]);
      setImageOrder((prev) => [...prev, ...mapped.map((m) => m.id)]);
    }
  };

  const handleRemoveNewImage = (id) => {
    setImageFiles((prev) => prev.filter((i) => i.id !== id));
    setImageOrder((prev) => prev.filter((x) => x !== id));
  };

  const handleRemoveExistingImage = async (imageId) => {
    try {
      const { error } = await supabase.from('chalet_images').delete().eq('id', imageId);
      if (error) throw error;
      setExistingImages((prev) => prev.filter((img) => img.id !== imageId));
      setImageOrder((prev) => prev.filter((x) => x !== `existing-${imageId}`));
    } catch {
      toast.error("Erreur lors de la suppression de l'image.");
    }
  };

  // ── Upload ──
  const uploadImage = async (file) => {
    const ext = file.name.split('.').pop();
    const path = `images/${Math.random().toString(36).substring(2)}-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from('chalets').upload(path, file);
    if (error) throw error;
    const { data: { publicUrl } } = supabase.storage.from('chalets').getPublicUrl(path);
    return publicUrl;
  };

  const uploadMultipleImages = async (items) => {
    setUploadingImages(true);
    try {
      return await Promise.all(items.map(async (item) => ({ id: item.id, url: await uploadImage(item.file) })));
    } finally {
      setUploadingImages(false);
    }
  };

  // ── Google Calendar pour chalets ──
  const createGoogleCalendarForChalet = async ({ chaletId, chaletName }) => {
    const session = (await supabase.auth.getSession()).data.session;
    const accessToken = session?.access_token;
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-chalet-calendar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
      body: JSON.stringify({ chalet_id: chaletId, chalet_name: chaletName }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401 || payload?.requiresAuth) throw new Error('GOOGLE_CALENDAR_CONNECTION_REQUIRED');
      throw new Error(payload?.error || payload?.message || "Erreur lors de la création de l'agenda.");
    }
    return payload;
  };

  // ── Reset formulaire ──
  const resetChaletForm = () => {
    setChaletForm({ Name: '', Description: '', nb_personnes: '', price_per_night: '', latitude: '', longitude: '', Image: null });
    setLocationAddress(''); setLocationSuggestions([]); setLocationLookupError(null); setLocationLookupSuccess(null);
    setImageFiles([]); setExistingImages([]); setImageOrder([]); setSelectedAmenities([]);
    setIsDraggingFiles(false); setChaletWizardStep(0); setChaletStepErrors({});
    globalThis.__MS_PICKING_LOCATION__ = false;
  };

  // ── Ouvrir wizard ──
  const handleOpenCreate = () => {
    resetChaletForm(); setEditingChalet(null); setIsCreatingChalet(true);
  };

  const handleOpenEdit = async (chalet) => {
    let latitude = '', longitude = '';
    if (chalet.location?.coordinates) { longitude = chalet.location.coordinates[0]; latitude = chalet.location.coordinates[1]; }
    setChaletForm({ Name: chalet.Name || '', Description: chalet.Description || '', nb_personnes: chalet.nb_personnes || '', price_per_night: chalet.price_per_night || '', latitude, longitude, Image: chalet.Image || null });
    setLocationAddress(''); setLocationSuggestions([]); setLocationLookupError(null); setLocationLookupSuccess(null);
    setImageFiles([]); setImageOrder([]);
    setSelectedAmenities(inferAmenitiesFromDescription(chalet.Description || ''));
    setIsDraggingFiles(false);
    try {
      const { data: images } = await supabase.from('chalet_images').select('*').eq('chalet_id', chalet.key).order('display_order');
      setExistingImages(images || []);
      setImageOrder((images || []).map((img) => `existing-${img.id}`));
    } catch { setExistingImages([]); setImageOrder([]); }
    setEditingChalet(chalet); setChaletWizardStep(0); setChaletStepErrors({}); setIsCreatingChalet(true);
  };

  const handleCloseForm = () => {
    setIsCreatingChalet(false); setEditingChalet(null); resetChaletForm();
  };

  // ── Wizard navigation ──
  const handleWizardNext = () => {
    const { isValid, errors } = getChaletStepValidation(chaletWizardStep);
    if (!isValid) { setChaletStepErrors((prev) => ({ ...prev, ...errors })); return; }
    setChaletStepErrors({});
    setChaletWizardStep((p) => Math.min(p + 1, CHALET_WIZARD_STEPS.length - 1));
  };

  const handleWizardBack = () => { setChaletStepErrors({}); setChaletWizardStep((p) => Math.max(p - 1, 0)); };

  // ── Submit chalet ──
  const handleSubmitChalet = async (e) => {
    e?.preventDefault?.();
    try {
      setLoadingChalets(true); setChaletError(null); setChaletCreationStep(null);

      const orderedItems = orderedImageItems.length > 0 ? orderedImageItems : [...existingImageItems, ...newImageItems];

      if (!editingChalet && !selectedEstablishment?.google_calendar_id) {
        setChaletError("Connexion Google Calendar requise avant la création d'un chalet.");
        setLoadingChalets(false);
        setShowGoogleModal(true);
        return;
      }

      let newImageUploads = [];
      const orderedNewImages = orderedItems.filter((i) => i.kind === 'new');
      if (orderedNewImages.length > 0) {
        setChaletCreationStep('Téléchargement des photos…');
        newImageUploads = await uploadMultipleImages(orderedNewImages);
      }

      const newImageUrlById = new Map(newImageUploads.map((i) => [i.id, i.url]));

      let mainImageUrl = chaletForm.Image;
      const firstImage = orderedItems[0];
      if (firstImage?.kind === 'existing') mainImageUrl = firstImage.image.image_url;
      else if (firstImage?.kind === 'new') mainImageUrl = newImageUrlById.get(firstImage.id) || chaletForm.Image;

      const chaletData = {
        Name: chaletForm.Name,
        Description: buildAmenitiesDescription(selectedAmenities, chaletForm.Description),
        nb_personnes: chaletForm.nb_personnes ? parseInt(chaletForm.nb_personnes) : null,
        price_per_night: chaletForm.price_per_night ? parseFloat(chaletForm.price_per_night) : null,
        etablishment_id: estabKey,
        Image: mainImageUrl,
      };

      if (chaletForm.latitude && chaletForm.longitude) {
        const lat = parseFloat(chaletForm.latitude), lon = parseFloat(chaletForm.longitude);
        if (!isNaN(lat) && !isNaN(lon)) chaletData.location = `POINT(${lon} ${lat})`;
      }

      let chaletKey;
      if (editingChalet) {
        setChaletCreationStep('Mise à jour du chalet…');
        const { error } = await supabase.from('chalets').update(chaletData).eq('key', editingChalet.key);
        if (error) throw error;
        chaletKey = editingChalet.key;
        const orderedExisting = orderedItems.map((item, index) => ({ item, index })).filter(({ item }) => item.kind === 'existing');
        for (const { item, index } of orderedExisting) {
          await supabase.from('chalet_images').update({ display_order: index }).eq('id', item.image.id);
        }
      } else {
        setChaletCreationStep('Création du chalet…');
        const { data: newChalet, error: insertError } = await supabase.from('chalets').insert([chaletData]).select();
        if (insertError) throw insertError;
        chaletKey = newChalet[0].key;

        setChaletCreationStep("Création de l'agenda Google Calendar…");
        try {
          await createGoogleCalendarForChalet({ chaletId: chaletKey, chaletName: chaletForm.Name });
        } catch (calErr) {
          await supabase.from('chalets').delete().eq('key', chaletKey);
          if (calErr.message === 'GOOGLE_CALENDAR_CONNECTION_REQUIRED') {
            setShowGoogleModal(true);
            throw new Error("Google Calendar n'est pas connecté. Reconnectez-le dans l'onglet Calendrier.");
          }
          throw calErr;
        }
      }

      if (newImageUploads.length > 0) {
        const imageRecords = orderedItems
          .map((item, index) => ({ item, index }))
          .filter(({ item }) => item.kind === 'new')
          .map(({ item, index }) => ({ chalet_id: chaletKey, image_url: newImageUrlById.get(item.id), display_order: index }))
          .filter((r) => r.image_url);
        await supabase.from('chalet_images').insert(imageRecords);
      }

      await refreshCtx();
      handleCloseForm();
      toast.success(editingChalet ? 'Chalet mis à jour.' : 'Chalet créé avec son agenda Google.');
    } catch (err) {
      setChaletError(`Erreur lors de la sauvegarde : ${err.message || 'Erreur inconnue'}`);
    } finally {
      setLoadingChalets(false); setChaletCreationStep(null);
    }
  };

  // ── Supprimer chalet ──
  const handleDeleteChalet = async (key) => {
    if (!globalThis.confirm('Êtes-vous sûr de vouloir supprimer ce chalet ?')) return;
    try {
      setLoadingChalets(true); setChaletError(null);
      const { error } = await supabase.from('chalets').delete().eq('key', key);
      if (error) throw error;
      await refreshCtx();
    } catch (err) {
      setChaletError(`Erreur lors de la suppression : ${err.message || 'Erreur inconnue'}`);
    } finally {
      setLoadingChalets(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────────
  if (ctxLoading) {
    return (
      <div className="esbl-loading-state">
        <span style={{ fontSize: '2rem' }}>🏠</span>
        <p style={{ margin: 0 }}>Chargement…</p>
      </div>
    );
  }

  if (!selectedEstablishment) {
    return (
      <div className="esbl-empty-state">
        <div style={{ fontSize: '3rem' }}>🏠</div>
        <p>Aucun établissement sélectionné.</p>
      </div>
    );
  }

  // ─── Rendu wizard (plein écran) ───────────────────────────────────────────────
  if (isCreatingChalet) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: '#f3f4f6', zIndex: 1000, overflow: 'hidden' }}>
        <div style={{ height: '100vh', width: '100vw', display: 'grid', gridTemplateColumns: isCompact ? '1fr' : '320px minmax(0, 1fr)', background: '#fff' }}>
          {/* Sidebar wizard */}
          <aside style={{ background: '#f9fafb', borderRight: isCompact ? 'none' : '1px solid #e5e7eb', borderBottom: isCompact ? '1px solid #e5e7eb' : 'none', padding: isCompact ? '16px 18px' : '24px 22px', display: 'flex', flexDirection: 'column', gap: 16, overflow: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'start', justifyContent: 'space-between', gap: 10 }}>
              <div>
                <p style={{ margin: 0, fontSize: '0.78rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>Configuration</p>
                <h2 style={{ margin: '8px 0 0', fontSize: '1.28rem', color: '#111827', lineHeight: 1.2 }}>{editingChalet ? 'Modifier le chalet' : 'Nouvelle propriété'}</h2>
              </div>
              <button type="button" onClick={handleCloseForm} aria-label="Fermer" style={{ border: 'none', background: 'transparent', color: '#111827', width: 26, height: 26, cursor: 'pointer', fontWeight: 700, fontSize: '1.5rem', padding: 0, lineHeight: 1 }}>×</button>
            </div>

            <div>
              <p style={{ margin: 0, color: '#4b5563', fontSize: '0.9rem' }}>Étape {chaletWizardStep + 1} / {CHALET_WIZARD_STEPS.length}</p>
              <p style={{ margin: '3px 0 0', color: '#111827', fontWeight: 700, fontSize: '0.95rem' }}>{CHALET_WIZARD_STEPS[chaletWizardStep].label}</p>
            </div>

            <div style={{ height: 6, background: '#e5e7eb', borderRadius: 999, overflow: 'hidden' }}>
              <div style={{ width: `${wizardProgress}%`, height: '100%', background: '#111827', transition: 'width 220ms ease' }} />
            </div>

            <div style={{ display: 'grid', gap: 6, maxHeight: isCompact ? 160 : 'none', overflowY: isCompact ? 'auto' : 'visible' }}>
              {CHALET_WIZARD_STEPS.map((step, index) => (
                <button key={step.key} type="button" onClick={() => { if (index <= chaletWizardStep) { setChaletWizardStep(index); setChaletStepErrors({}); } }} disabled={index > chaletWizardStep}
                  style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', border: 'none', borderRadius: 8, padding: '7px 8px', background: index === chaletWizardStep ? '#111827' : 'transparent', color: index === chaletWizardStep ? '#fff' : index <= chaletWizardStep ? '#111827' : '#9ca3af', cursor: index <= chaletWizardStep ? 'pointer' : 'not-allowed', textAlign: 'left' }}>
                  <span style={{ width: 20, height: 20, borderRadius: 999, border: index === chaletWizardStep ? '1px solid #fff' : '1px solid #d1d5db', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.74rem', fontWeight: 700, flexShrink: 0 }}>{index + 1}</span>
                  <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>{step.label}</span>
                </button>
              ))}
            </div>

            {!isCompact && (
              <div style={{ marginTop: 'auto', border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, background: '#fff' }}>
                <p style={{ margin: 0, color: '#6b7280', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>Résumé rapide</p>
                <p style={{ margin: '8px 0 0', color: '#111827', fontWeight: 700, fontSize: '0.9rem' }}>{chaletForm.Name || 'Nom à définir'}</p>
                <p style={{ margin: '4px 0 0', color: '#4b5563', fontSize: '0.82rem' }}>{chaletForm.nb_personnes || '-'} pers. • {chaletForm.price_per_night || '-'} $/nuit</p>
              </div>
            )}
          </aside>

          {/* Zone formulaire */}
          <div style={{ minHeight: 0, display: 'flex', flexDirection: 'column', background: '#fff' }}>
            <form onSubmit={handleSubmitChalet} style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
              <div style={{ padding: isCompact ? '18px' : '28px', overflowY: 'auto', minHeight: 0, flex: 1 }}>
                <div key={chaletWizardStep} style={{ transition: 'all 200ms ease' }}>

                  {/* Étape 0 — Type */}
                  {chaletWizardStep === 0 && (
                    <WizardStepPanel title="Type de propriété" subtitle="Donnez un nom clair à la propriété. Le type est déterminé automatiquement.">
                      <div>
                        <label style={{ display: 'block', fontWeight: 600, color: '#334155', marginBottom: 6 }}>Nom du Chalet *</label>
                        <input type="text" name="Name" value={chaletForm.Name} onChange={(e) => setChaletForm((p) => ({ ...p, [e.target.name]: e.target.value }))} placeholder="Ex: Chalet du Lac"
                          style={{ width: '100%', padding: 10, borderRadius: 6, border: wizardValidation.errors.Name ? '1px solid #dc2626' : '1px solid #cbd5e1', fontSize: '1rem' }} />
                        {wizardValidation.errors.Name && <p style={{ margin: '8px 0 0', color: '#b91c1c', fontSize: '0.9rem' }}>{wizardValidation.errors.Name}</p>}
                      </div>
                      <div style={{ border: '1px solid #d1fae5', background: '#f0fdf4', borderRadius: 10, padding: 12 }}>
                        <p style={{ margin: 0, color: '#065f46', fontSize: '0.9rem', fontWeight: 600 }}>Type détecté : {getActivePropertyType()}</p>
                      </div>
                    </WizardStepPanel>
                  )}

                  {/* Étape 1 — Localisation */}
                  {chaletWizardStep === 1 && (
                    <WizardStepPanel title="Localisation" subtitle="Tapez votre adresse pour voir des suggestions, puis sélectionnez le résultat.">
                      <div>
                        <label style={{ display: 'block', fontWeight: 600, color: '#334155', marginBottom: 6 }}>Adresse du chalet</label>
                        <input type="text" value={locationAddress} onChange={(e) => { setLocationAddress(e.target.value); setLocationLookupSuccess(null); }} placeholder="ex: 235 rue Bacon, QC"
                          style={{ width: '100%', padding: 10, borderRadius: 6, border: '1px solid #cbd5e1', fontSize: '1rem', boxSizing: 'border-box' }} />
                        {isSearchingLocation && <p style={{ marginTop: 8, marginBottom: 0, color: '#475569', fontSize: '0.9rem' }}>Recherche d'adresses…</p>}
                        {!isSearchingLocation && locationAddress.trim().length >= 3 && locationSuggestions.length > 0 && (
                          <div style={{ marginTop: 10, border: '1px solid #cbd5e1', borderRadius: 8, overflow: 'hidden', maxHeight: 220, overflowY: 'auto' }}>
                            {locationSuggestions.map((s, i) => (
                              <button key={`${s.latitude}-${s.longitude}-${i}`} type="button"
                                onClick={() => { setChaletForm((p) => ({ ...p, latitude: toCoordinateInputValue(s.latitude), longitude: toCoordinateInputValue(s.longitude) })); setLocationAddress(s.displayName || ''); setLocationSuggestions([]); setLocationLookupSuccess(s.displayName || 'Adresse localisée.'); setLocationLookupError(null); }}
                                style={{ width: '100%', textAlign: 'left', padding: '10px 12px', border: 'none', borderBottom: i === locationSuggestions.length - 1 ? 'none' : '1px solid #e2e8f0', background: '#fff', color: '#111827', cursor: 'pointer', fontSize: '0.92rem' }}>
                                {s.displayName}
                              </button>
                            ))}
                          </div>
                        )}
                        <div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
                          <button type="button" onClick={() => { setLocationLookupError(null); setLocationLookupSuccess("Cliquez sur la carte pour choisir l'emplacement exact."); globalThis.__MS_PICKING_LOCATION__ = true; }}
                            style={{ padding: '9px 14px', borderRadius: 6, border: '1px solid #1d4ed8', background: '#dbeafe', color: '#1e3a8a', fontWeight: 600, cursor: 'pointer' }}>
                            Choisir sur la carte
                          </button>
                        </div>
                        {locationLookupError && <p style={{ marginTop: 8, marginBottom: 0, color: '#b91c1c', fontSize: '0.9rem' }}>{locationLookupError}</p>}
                        {locationLookupSuccess && <p style={{ marginTop: 8, marginBottom: 0, color: '#0f766e', fontSize: '0.9rem' }}>{locationLookupSuccess}</p>}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
                        {['latitude', 'longitude'].map((field) => (
                          <div key={field}>
                            <label style={{ display: 'block', fontWeight: 600, color: '#334155', marginBottom: 6, textTransform: 'capitalize' }}>{field}</label>
                            <input type="text" name={field} value={chaletForm[field]} readOnly placeholder="Détectée automatiquement"
                              style={{ width: '100%', padding: 10, borderRadius: 6, border: wizardValidation.errors.location ? '1px solid #dc2626' : '1px solid #cbd5e1', fontSize: '1rem', background: '#f1f5f9', fontWeight: 600, boxSizing: 'border-box' }} />
                          </div>
                        ))}
                      </div>
                      {wizardValidation.errors.location && <p style={{ margin: '2px 0 0', color: '#b91c1c', fontSize: '0.9rem' }}>{wizardValidation.errors.location}</p>}
                    </WizardStepPanel>
                  )}

                  {/* Étape 2 — Infos de base */}
                  {chaletWizardStep === 2 && (
                    <WizardStepPanel title="Infos de base" subtitle="Capacité de votre propriété.">
                      <div>
                        <label style={{ display: 'block', fontWeight: 600, color: '#334155', marginBottom: 6 }}>Nombre de personnes *</label>
                        <input type="number" name="nb_personnes" value={chaletForm.nb_personnes} onChange={(e) => setChaletForm((p) => ({ ...p, [e.target.name]: e.target.value }))} min="1"
                          style={{ width: '100%', padding: 10, borderRadius: 6, border: wizardValidation.errors.nb_personnes ? '1px solid #dc2626' : '1px solid #cbd5e1', fontSize: '1rem' }} />
                        {wizardValidation.errors.nb_personnes && <p style={{ margin: '8px 0 0', color: '#b91c1c', fontSize: '0.9rem' }}>{wizardValidation.errors.nb_personnes}</p>}
                      </div>
                    </WizardStepPanel>
                  )}

                  {/* Étape 3 — Commodités */}
                  {chaletWizardStep === 3 && (
                    <WizardStepPanel title="Commodités" subtitle="Sélectionnez des commodités prédéfinies, puis ajoutez une description complémentaire.">
                      <div>
                        <label style={{ display: 'block', fontWeight: 600, color: '#334155', marginBottom: 8 }}>Commodités prédéfinies</label>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
                          {PREDEFINED_AMENITIES.map((amenity) => {
                            const selected = selectedAmenities.includes(amenity.id);
                            return (
                              <button key={amenity.id} type="button" onClick={() => setSelectedAmenities((prev) => selected ? prev.filter((id) => id !== amenity.id) : [...prev, amenity.id])}
                                style={{ display: 'flex', alignItems: 'center', gap: 8, borderRadius: 12, border: selected ? '1px solid #111827' : '1px solid #d1d5db', background: selected ? '#111827' : '#fff', color: selected ? '#fff' : '#111827', padding: '10px 12px', fontWeight: 600, cursor: 'pointer', textAlign: 'left', transition: 'all 180ms ease' }}>
                                <span>{amenity.icon}</span>
                                <span style={{ fontSize: '0.9rem', lineHeight: 1.2 }}>{amenity.label}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <div>
                        <label style={{ display: 'block', fontWeight: 600, color: '#334155', marginBottom: 6 }}>Description complémentaire</label>
                        <textarea name="Description" value={chaletForm.Description} onChange={(e) => setChaletForm((p) => ({ ...p, [e.target.name]: e.target.value }))} rows="5" placeholder="Ex: Ambiance chaleureuse, terrasse orientée plein sud…"
                          style={{ width: '100%', padding: 10, borderRadius: 6, border: wizardValidation.errors.Description ? '1px solid #dc2626' : '1px solid #cbd5e1', fontSize: '1rem', resize: 'vertical' }} />
                        {wizardValidation.errors.Description && <p style={{ margin: '8px 0 0', color: '#b91c1c', fontSize: '0.9rem' }}>{wizardValidation.errors.Description}</p>}
                      </div>
                      {(selectedAmenities.length > 0 || chaletForm.Description.trim()) && (
                        <div style={{ borderRadius: 10, border: '1px solid #bae6fd', background: '#f0f9ff', padding: 12 }}>
                          <p style={{ margin: '0 0 8px', color: '#0c4a6e', fontWeight: 700, fontSize: '0.88rem' }}>Aperçu du texte final</p>
                          <p style={{ margin: 0, color: '#334155', fontSize: '0.9rem', whiteSpace: 'pre-wrap' }}>{generatedDescription}</p>
                        </div>
                      )}
                    </WizardStepPanel>
                  )}

                  {/* Étape 4 — Photos */}
                  {chaletWizardStep === 4 && (
                    <WizardStepPanel title="Photos" subtitle="Glissez vos photos ici ou cliquez pour importer. Vous pouvez ensuite les réordonner.">
                      {orderedImageItems.length > 0 && (
                        <DndContext sensors={dragSensors} collisionDetection={closestCenter} onDragStart={(e) => setDraggingImageId(e.active?.id || null)} onDragEnd={(e) => { const { active, over } = e; setDraggingImageId(null); if (!active?.id || !over?.id || active.id === over.id) return; setImageOrder((prev) => { const oi = prev.indexOf(active.id), ni = prev.indexOf(over.id); if (oi === -1 || ni === -1) return prev; return arrayMove(prev, oi, ni); }); }} onDragCancel={() => setDraggingImageId(null)}>
                          <SortableContext items={imageOrder} strategy={rectSortingStrategy}>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(120px, 100%), 1fr))', gap: 10 }}>
                              {orderedImageItems.map((item, index) => {
                                const src = item.kind === 'existing' ? item.image.image_url : previewUrlMap[item.id];
                                return (
                                  <SortablePhotoCard key={item.id} id={item.id}>
                                    <div style={{ position: 'relative', border: '2px solid #111827', borderRadius: 8, overflow: 'hidden' }}>
                                      <img src={src} alt={`Image ${index + 1}`} style={{ width: '100%', height: 120, objectFit: 'cover', display: 'block' }} />
                                      <button type="button" onClick={() => item.kind === 'existing' ? handleRemoveExistingImage(item.image.id) : handleRemoveNewImage(item.id)} aria-label={`Supprimer l'image ${index + 1}`}
                                        style={{ position: 'absolute', top: 6, right: 6, background: 'transparent', color: '#111827', border: 'none', width: 22, height: 22, cursor: 'pointer', fontWeight: 700, fontSize: '1.1rem', padding: 0 }}>×</button>
                                    </div>
                                  </SortablePhotoCard>
                                );
                              })}
                            </div>
                          </SortableContext>
                          <DragOverlay>
                            {activeImage && (
                              <div style={{ width: 140, border: '2px solid #111827', borderRadius: 8, overflow: 'hidden', boxShadow: '0 18px 32px rgba(15,23,42,0.3)' }}>
                                <img src={activeImage.kind === 'existing' ? activeImage.image.image_url : previewUrlMap[activeImage.id]} alt="Aperçu" style={{ width: '100%', height: 120, objectFit: 'cover', display: 'block' }} />
                              </div>
                            )}
                          </DragOverlay>
                        </DndContext>
                      )}

                      <div onClick={() => fileInputRef.current?.click()} onDragEnter={(e) => { e.preventDefault(); setIsDraggingFiles(true); }} onDragOver={(e) => { e.preventDefault(); setIsDraggingFiles(true); }} onDragLeave={(e) => { e.preventDefault(); setIsDraggingFiles(false); }} onDrop={(e) => { e.preventDefault(); setIsDraggingFiles(false); addImageFiles(Array.from(e.dataTransfer.files || [])); }}
                        style={{ borderRadius: 16, border: wizardValidation.errors.images ? '2px dashed #dc2626' : isDraggingFiles ? '2px dashed #111827' : '2px dashed #9ca3af', background: isDraggingFiles ? '#f3f4f6' : '#f9fafb', padding: '26px 18px', cursor: 'pointer', textAlign: 'center', transition: 'all 180ms ease' }}>
                        <div style={{ color: '#111827', marginBottom: 8, display: 'inline-flex' }}><UploadIcon size={32} /></div>
                        <p style={{ margin: 0, color: '#111827', fontSize: '0.95rem', fontWeight: 700 }}>{isDraggingFiles ? 'Déposez vos images ici' : 'Glissez-déposez vos images'}</p>
                        <p style={{ margin: '6px 0 0', color: '#4b5563', fontSize: '0.88rem' }}>ou cliquez pour sélectionner</p>
                        <p style={{ margin: '10px 0 0', color: '#9ca3af', fontSize: '0.8rem' }}>PNG, JPG, WEBP</p>
                        <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={(e) => { addImageFiles(Array.from(e.target.files || [])); if (e.target) e.target.value = ''; }} style={{ display: 'none' }} />
                      </div>
                      {wizardValidation.errors.images && <p style={{ margin: '8px 0 0', color: '#b91c1c', fontSize: '0.9rem' }}>{wizardValidation.errors.images}</p>}
                    </WizardStepPanel>
                  )}

                  {/* Étape 5 — Tarification */}
                  {chaletWizardStep === 5 && (
                    <WizardStepPanel title="Tarification" subtitle="Définissez le prix de base par nuit.">
                      <div>
                        <label style={{ display: 'block', fontWeight: 600, color: '#334155', marginBottom: 6 }}>Prix par nuit ($) *</label>
                        <input type="number" name="price_per_night" value={chaletForm.price_per_night} onChange={(e) => setChaletForm((p) => ({ ...p, [e.target.name]: e.target.value }))} min="0" step="0.01"
                          style={{ width: '100%', padding: 10, borderRadius: 6, border: wizardValidation.errors.price_per_night ? '1px solid #dc2626' : '1px solid #cbd5e1', fontSize: '1rem' }} />
                        {wizardValidation.errors.price_per_night && <p style={{ margin: '8px 0 0', color: '#b91c1c', fontSize: '0.9rem' }}>{wizardValidation.errors.price_per_night}</p>}
                      </div>
                    </WizardStepPanel>
                  )}

                  {/* Étape 6 — Vérification */}
                  {chaletWizardStep === 6 && (
                    <WizardStepPanel title="Vérification finale" subtitle="Révisez toutes les sections avant enregistrement.">
                      <div style={{ display: 'grid', gap: 10 }}>
                        {[
                          { label: '1. Type de propriété', content: `${chaletForm.Name || 'Non renseigné'} • ${getActivePropertyType()}`, step: 0 },
                          { label: '2. Localisation', content: `Lat: ${chaletForm.latitude || '-'} • Lon: ${chaletForm.longitude || '-'}`, step: 1 },
                          { label: '3. Infos de base', content: `Capacité: ${chaletForm.nb_personnes || '-'} personnes`, step: 2 },
                          { label: '4. Commodités', content: generatedDescription || 'Non renseigné', step: 3 },
                          { label: '5. Photos', content: `${existingImages.length + imageFiles.length + (chaletForm.Image ? 1 : 0)} image(s)`, step: 4 },
                          { label: '6. Tarification', content: `${chaletForm.price_per_night || '-'} $ / nuit`, step: 5 },
                        ].map(({ label, content, step }) => (
                          <div key={label} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 12 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <strong>{label}</strong>
                              <button type="button" onClick={() => setChaletWizardStep(step)} style={{ border: 'none', background: 'transparent', color: '#0f766e', cursor: 'pointer', fontWeight: 600 }}>Modifier</button>
                            </div>
                            <p style={{ margin: '8px 0 0', color: '#475569', whiteSpace: 'pre-wrap' }}>{content}</p>
                          </div>
                        ))}
                      </div>
                    </WizardStepPanel>
                  )}

                  {chaletError && <p style={{ color: '#ef4444', fontSize: '0.9rem', marginTop: 14 }}>{chaletError}</p>}
                  {Object.keys(chaletStepErrors).length > 0 && <p style={{ color: '#b91c1c', fontSize: '0.86rem', marginTop: 8 }}>Certains champs requis sont manquants.</p>}

                  {/* Navigation */}
                  <div style={{ display: 'flex', gap: 12, marginTop: 24, justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <button type="button" onClick={handleCloseForm} disabled={uploadingImages || loadingChalets}
                        style={{ padding: '10px 18px', background: '#f1f5f9', color: '#334155', border: 'none', borderRadius: 6, cursor: (uploadingImages || loadingChalets) ? 'not-allowed' : 'pointer', fontWeight: 600, opacity: (uploadingImages || loadingChalets) ? 0.6 : 1 }}>
                        Annuler
                      </button>
                      {chaletWizardStep > 0 && (
                        <button type="button" onClick={handleWizardBack} disabled={uploadingImages || loadingChalets}
                          style={{ padding: '10px 18px', background: '#e2e8f0', color: '#334155', border: 'none', borderRadius: 6, cursor: (uploadingImages || loadingChalets) ? 'not-allowed' : 'pointer', fontWeight: 600, opacity: (uploadingImages || loadingChalets) ? 0.6 : 1 }}>
                          Retour
                        </button>
                      )}
                    </div>
                    {chaletWizardStep < CHALET_WIZARD_STEPS.length - 1 ? (
                      <button type="button" onClick={handleWizardNext} disabled={!wizardValidation.isValid || uploadingImages || loadingChalets}
                        style={{ padding: '10px 20px', background: '#059669', color: 'white', border: 'none', borderRadius: 6, cursor: (!wizardValidation.isValid || uploadingImages || loadingChalets) ? 'not-allowed' : 'pointer', fontWeight: 600, opacity: (!wizardValidation.isValid || uploadingImages || loadingChalets) ? 0.6 : 1 }}>
                        Suivant
                      </button>
                    ) : (
                      <button type="submit" disabled={uploadingImages || loadingChalets}
                        style={{ padding: '10px 20px', background: '#059669', color: 'white', border: 'none', borderRadius: 6, cursor: (uploadingImages || loadingChalets) ? 'not-allowed' : 'pointer', fontWeight: 600, opacity: (uploadingImages || loadingChalets) ? 0.6 : 1 }}>
                        {uploadingImages ? 'Téléchargement des photos…' : loadingChalets ? (chaletCreationStep || 'Enregistrement…') : "Enregistrer et créer l'agenda"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </form>
          </div>
        </div>

        {/* Modale Google Calendar requis */}
        {showGoogleModal && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }}>
            <div style={{ background: 'white', borderRadius: 12, padding: 32, maxWidth: 420, width: '90%', textAlign: 'center' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>📅</div>
              <h2 style={{ margin: '0 0 12px', color: '#0f172a' }}>Google Calendar requis</h2>
              <p style={{ margin: '0 0 20px', color: '#64748b', fontSize: '0.95rem' }}>Connectez Google Calendar dans l'onglet Calendrier avant de créer un chalet (l'agenda est créé automatiquement à la création).</p>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                <button type="button" onClick={() => setShowGoogleModal(false)} style={{ padding: '8px 16px', border: '1px solid #e2e8f0', borderRadius: 6, background: 'white', cursor: 'pointer', fontWeight: 500 }}>Fermer</button>
                <button type="button" onClick={() => { setShowGoogleModal(false); handleCloseForm(); navigate('/dashboard/establishment/calendrier'); }} style={{ padding: '8px 16px', border: 'none', borderRadius: 6, background: '#6366f1', color: 'white', cursor: 'pointer', fontWeight: 600 }}>Aller au Calendrier</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ─── Rendu liste des chalets ──────────────────────────────────────────────────
  return (
    <div className="esbl-page">
      <header className="esbl-page-header">
        <div>
          <p className="esbl-eyebrow">Hébergement</p>
          <h1 className="esbl-page-title">🏠 Chalets</h1>
          <p className="esbl-page-subtitle">Les unités de location disponibles pour vos clients.</p>
        </div>
        <button type="button" onClick={handleOpenCreate} className="esbl-btn esbl-btn--emerald">
          + Ajouter un chalet
        </button>
      </header>

      {chaletError && (
        <div className="esbl-alert esbl-alert--error">
          ⚠️ {chaletError}
        </div>
      )}

      {loadingChalets && <div className="esbl-loading-state">⏳ Chargement…</div>}

      {!loadingChalets && chalets.length === 0 && (
        <div className="esbl-empty-state">
          <div style={{ fontSize: '2.5rem' }}>🏠</div>
          <p style={{ fontSize: '1rem', margin: 0 }}>Aucun chalet pour le moment</p>
          <p style={{ fontSize: '0.9rem', margin: 0 }}>Cliquez sur "Ajouter un chalet" pour commencer</p>
        </div>
      )}

      {!loadingChalets && chalets.length > 0 && (
        <>
          {/* Filtres catégories */}
          <div className="esbl-filter-row">
            {chaletCategories.map((cat) => (
              <button key={cat} type="button" onClick={() => setSelectedCategory(cat)}
                className={`esbl-filter-pill${selectedCategory === cat ? ' esbl-filter-pill--active' : ''}`}>
                {cat === 'all' ? 'Tous' : cat}
              </button>
            ))}
          </div>

          {/* Grille chalets */}
          <div className="esbl-chalet-grid">
            {filteredChalets.map((chalet, index) => (
              <div key={chalet.id || chalet.key || `chalet-${index}`} className="esbl-chalet-card">
                {chalet.Image && <img src={chalet.Image} alt={chalet.Name} className="esbl-chalet-image" />}
                <div className="esbl-chalet-body">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 8 }}>
                    <h3 className="esbl-chalet-title">{chalet.Name || `Chalet ${chalet.id}`}</h3>
                    <span className="esbl-chalet-tag">{inferChaletCategory(chalet)}</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {chalet.nb_personnes && <p className="esbl-list-meta"><strong>Capacité :</strong> {chalet.nb_personnes} pers.</p>}
                    {chalet.price_per_night && <p className="esbl-list-meta"><strong>Prix :</strong> {chalet.price_per_night}$ / nuit</p>}
                    {chalet.Description && (
                      <p className="esbl-list-meta" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {chalet.Description}
                      </p>
                    )}
                  </div>
                  <div className="esbl-chalet-actions">
                    <button type="button" onClick={() => handleOpenEdit(chalet)} className="esbl-btn esbl-btn--primary">Modifier</button>
                    <button type="button" onClick={() => handleDeleteChalet(chalet.key)} className="esbl-btn esbl-btn--danger">Supprimer</button>
                    <button type="button" onClick={() => { setSelectedChaletForHoraire(chalet); setIsHoraireModalOpen(true); }} className="esbl-btn esbl-btn--emerald">Agenda</button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {filteredChalets.length === 0 && (
            <p style={{ color: '#64748b', fontSize: '0.9rem' }}>Aucun chalet dans la catégorie "{selectedCategory}".</p>
          )}
          <p style={{ color: '#0f766e', fontSize: '0.9rem', fontWeight: 700 }}>Affichage : {filteredChalets.length} / {chalets.length}</p>
        </>
      )}

      {/* Modale horaire */}
      {isHoraireModalOpen && selectedChaletForHoraire && (
        <ChaletHoraireModal
          isOpen={isHoraireModalOpen}
          onClose={() => { setIsHoraireModalOpen(false); setSelectedChaletForHoraire(null); }}
          chalet={selectedChaletForHoraire}
        />
      )}
    </div>
  );
}
