import { useState, useEffect, useMemo, useRef } from 'react';
import supabase from '../utils/supabase.js';
import ChaletHoraireModal from './chaletHoraireModal.jsx';
import StripeOnboarding from './stripeOnboarding.jsx';
import { isInGaspesieBounds, toCoordinateInputValue, searchAddressesInGaspesie } from '../utils/locationService.js';
import {
    DndContext,
    DragOverlay,
    PointerSensor,
    closestCenter,
    useSensor,
    useSensors
} from '@dnd-kit/core';
import {
    SortableContext,
    arrayMove,
    rectSortingStrategy,
    useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

const PREDEFINED_AMENITIES = [
    {
        id: 'river_view',
        label: 'Vue sur la riviere',
        icon: '🌊',
        keywords: ['vue sur la riviere', 'river view', 'riviere']
    },
    {
        id: 'fire_pit',
        label: 'Foyer exterieur',
        icon: '🔥',
        keywords: ['foyer', 'fire pit', 'feu exterieur']
    },
    {
        id: 'hot_tub',
        label: 'Spa',
        icon: '♨️',
        keywords: ['spa', 'hot tub', 'jacuzzi']
    },
    {
        id: 'fireplace',
        label: 'Foyer interieur',
        icon: '🪵',
        keywords: ['foyer interieur', 'fireplace', 'poele']
    },
    {
        id: 'wifi',
        label: 'Wifi rapide',
        icon: '📶',
        keywords: ['wifi', 'wi-fi', 'internet']
    },
    {
        id: 'bbq',
        label: 'BBQ',
        icon: '🍖',
        keywords: ['bbq', 'barbecue', 'grill']
    },
    {
        id: 'kayaks',
        label: 'Kayaks',
        icon: '🛶',
        keywords: ['kayak', 'canoe', 'canot']
    },
    {
        id: 'dock',
        label: 'Acces au quai',
        icon: '⚓',
        keywords: ['quai', 'dock', 'acces au lac']
    },
    {
        id: 'pet_friendly',
        label: 'Animaux acceptes',
        icon: '🐾',
        keywords: ['animaux', 'pet friendly', 'chiens']
    },
    {
        id: 'parking',
        label: 'Stationnement',
        icon: '🚗',
        keywords: ['stationnement', 'parking']
    }
];

const CHALET_WIZARD_STEPS = [
    { key: 'type', label: 'Type de propriete' },
    { key: 'location', label: 'Localisation' },
    { key: 'basic', label: 'Infos de base' },
    { key: 'amenities', label: 'Commodites' },
    { key: 'photos', label: 'Photos' },
    { key: 'pricing', label: 'Tarification' },
    { key: 'review', label: 'Verification' }
];

const ChaletWizardStepPanel = ({ title, subtitle, children }) => (
    <div className="chalet-wizard-step-panel" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div>
            <h3 style={{ fontSize: '1.22rem', color: '#1e293b', margin: 0 }}>{title}</h3>
            {subtitle && (
                <p style={{ margin: '8px 0 0', color: '#64748b', fontSize: '0.92rem' }}>{subtitle}</p>
            )}
        </div>
        {children}
    </div>
);

const AmenityIcon = ({ amenityId, size = 18 }) => {
    const common = {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: '1.7',
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true
    };

    if (amenityId === 'river_view') {
        return (
            <svg {...common}>
                <path d="M2 15c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 4-2" />
                <path d="M2 19c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 4-2" />
            </svg>
        );
    }

    if (amenityId === 'fire_pit') {
        return (
            <svg {...common}>
                <path d="M8 21h8" />
                <path d="M6 17h12" />
                <path d="M12 4c3 2.2 3.3 5.4 1.7 7-1.1 1.1-3.2 1.3-4.5 0-.8-.8-.9-2-.2-3.1" />
                <path d="M10.5 14c.7 1 2.3 1.1 3.2.2" />
            </svg>
        );
    }

    if (amenityId === 'hot_tub') {
        return (
            <svg {...common}>
                <path d="M4 14h16" />
                <path d="M5 14v3a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3v-3" />
                <path d="M8 5c0 1-.8 1.3-.8 2.3" />
                <path d="M12 4c0 1-.8 1.3-.8 2.3" />
                <path d="M16 5c0 1-.8 1.3-.8 2.3" />
            </svg>
        );
    }

    if (amenityId === 'fireplace') {
        return (
            <svg {...common}>
                <path d="M5 21V8l7-5 7 5v13" />
                <path d="M8 21v-6h8v6" />
                <path d="M12 10c1.4 1.1 1.5 2.8.7 3.6-.6.6-1.7.7-2.4.1" />
            </svg>
        );
    }

    if (amenityId === 'wifi') {
        return (
            <svg {...common}>
                <path d="M2.5 8.8a14 14 0 0 1 19 0" />
                <path d="M5.6 12a9.5 9.5 0 0 1 12.8 0" />
                <path d="M8.8 15.2a5.3 5.3 0 0 1 6.4 0" />
                <circle cx="12" cy="18.5" r="1" fill="currentColor" stroke="none" />
            </svg>
        );
    }

    if (amenityId === 'bbq') {
        return (
            <svg {...common}>
                <circle cx="12" cy="11" r="4" />
                <path d="M8 15h8" />
                <path d="M9 15l-1.5 5" />
                <path d="M15 15l1.5 5" />
                <path d="M6 9h12" />
            </svg>
        );
    }

    if (amenityId === 'kayaks') {
        return (
            <svg {...common}>
                <path d="M3 14h18" />
                <path d="M5 14c1.8 2 4 3 7 3s5.2-1 7-3" />
                <path d="M10 8l2 6 2-6" />
            </svg>
        );
    }

    if (amenityId === 'dock') {
        return (
            <svg {...common}>
                <path d="M6 4v10" />
                <path d="M12 4v10" />
                <path d="M18 4v10" />
                <path d="M4 14h16" />
                <path d="M2 19c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 4-2" />
            </svg>
        );
    }

    if (amenityId === 'pet_friendly') {
        return (
            <svg {...common}>
                <circle cx="8" cy="8" r="1.6" />
                <circle cx="12" cy="6.5" r="1.6" />
                <circle cx="16" cy="8" r="1.6" />
                <path d="M12 20c-2.6 0-5-1.7-5-4 0-1.9 1.3-3.2 2.9-3.2 1 0 1.8.6 2.1 1.2.3-.6 1.1-1.2 2.1-1.2 1.6 0 2.9 1.3 2.9 3.2 0 2.3-2.4 4-5 4Z" />
            </svg>
        );
    }

    if (amenityId === 'parking') {
        return (
            <svg {...common}>
                <rect x="4" y="3" width="16" height="18" rx="2" />
                <path d="M9 17V7h4a3 3 0 0 1 0 6H9" />
            </svg>
        );
    }

    return (
        <svg {...common}>
            <circle cx="12" cy="12" r="9" />
        </svg>
    );
};

const UploadIcon = ({ size = 30 }) => (
    <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
    >
        <path d="M12 15V5" />
        <path d="m8.5 8.5 3.5-3.5 3.5 3.5" />
        <path d="M4 15.5v2A2.5 2.5 0 0 0 6.5 20h11a2.5 2.5 0 0 0 2.5-2.5v-2" />
    </svg>
);

const SortablePhotoCard = ({ id, children }) => {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({ id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition: transition || 'transform 180ms ease',
        touchAction: 'none',
        cursor: isDragging ? 'grabbing' : 'grab',
        zIndex: isDragging ? 30 : 1,
        opacity: isDragging ? 0.88 : 1,
        boxShadow: isDragging
            ? '0 14px 28px rgba(15, 23, 42, 0.22)'
            : '0 1px 3px rgba(15, 23, 42, 0.12)'
    };

    return (
        <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
            {children}
        </div>
    );
};

const normalizeAmenityText = (value = '') => value.toLowerCase();

const inferSelectedAmenitiesFromDescription = (description = '') => {
    const normalized = normalizeAmenityText(description);
    return PREDEFINED_AMENITIES
        .filter((amenity) => amenity.keywords.some((keyword) => normalized.includes(keyword)))
        .map((amenity) => amenity.id);
};

const buildAmenitiesDescription = (selectedAmenityIds, manualDescription) => {
    const selectedLabels = PREDEFINED_AMENITIES
        .filter((amenity) => selectedAmenityIds.includes(amenity.id))
        .map((amenity) => amenity.label);

    const cleanManualDescription = manualDescription.trim();

    if (selectedLabels.length > 0 && cleanManualDescription) {
        return `Commodites: ${selectedLabels.join(', ')}.\n\n${cleanManualDescription}`;
    }

    if (selectedLabels.length > 0) {
        return `Commodites: ${selectedLabels.join(', ')}`;
    }

    return cleanManualDescription;
};

const EtablissementModal = ({ isEtablissementOpen, onClose }) => {
    const [establishments, setEstablishments] = useState([]);
    const [selectedEstablishment, setSelectedEstablishment] = useState(null);
    const [chalets, setChalets] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadingChalets, setLoadingChalets] = useState(false);
    const [error, setError] = useState(null);
    const [chaletError, setChaletError] = useState(null);
    
    // Chalet form states
    const [isCreatingChalet, setIsCreatingChalet] = useState(false);
    const [editingChalet, setEditingChalet] = useState(null);
    const [chaletForm, setChaletForm] = useState({
        Name: '',
        Description: '',
        nb_personnes: '',
        price_per_night: '',
        latitude: '',
        longitude: '',
        Image: null
    });
    const [locationAddress, setLocationAddress] = useState('');
    const [isSearchingLocation, setIsSearchingLocation] = useState(false);
    const [locationSuggestions, setLocationSuggestions] = useState([]);
    const [isPickingLocationOnMap, setIsPickingLocationOnMap] = useState(false);
    const [locationLookupError, setLocationLookupError] = useState(null);
    const [locationLookupSuccess, setLocationLookupSuccess] = useState(null);
    const [imageFiles, setImageFiles] = useState([]);
    const [existingImages, setExistingImages] = useState([]);
    const [uploadingImages, setUploadingImages] = useState(false);
    const [draggingImageId, setDraggingImageId] = useState(null);
    const [imageOrder, setImageOrder] = useState([]);
    const [selectedAmenities, setSelectedAmenities] = useState([]);
    const [isDraggingFiles, setIsDraggingFiles] = useState(false);
    const fileInputRef = useRef(null);
    const [isCompactChaletForm, setIsCompactChaletForm] = useState(false);
    const [chaletWizardStep, setChaletWizardStep] = useState(0);
    const [chaletStepErrors, setChaletStepErrors] = useState({});
    const dragSensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 6
            }
        })
    );

    // Chalet horaire modal states
    const [isHoraireModalOpen, setIsHoraireModalOpen] = useState(false);
    const [selectedChaletForHoraire, setSelectedChaletForHoraire] = useState(null);

    // Google Calendar connection states
    const [isConnectingGoogle, setIsConnectingGoogle] = useState(false);
    const [googleConnectionError, setGoogleConnectionError] = useState(null);
    const [googleConnectionSuccess, setGoogleConnectionSuccess] = useState(false);
    const [showGoogleConnectModal, setShowGoogleConnectModal] = useState(false);
    const [pendingEstablishmentSelect, setPendingEstablishmentSelect] = useState(null);
    const [pendingSection, setPendingSection] = useState(null);
    const [chaletCreationStep, setChaletCreationStep] = useState(null);

    // Establishment form states
    const [isCreatingEstablishment, setIsCreatingEstablishment] = useState(false);
    const [editingEstablishment, setEditingEstablishment] = useState(null);
    const [establishmentForm, setEstablishmentForm] = useState({
        name: '',
        adresse: '',
        telephone: '',
        email: ''
    });
    const [savingEstablishment, setSavingEstablishment] = useState(false);
    const [establishmentError, setEstablishmentError] = useState(null);
    const [activeEstablishmentSection, setActiveEstablishmentSection] = useState('overview');
    const [selectedChaletCategory, setSelectedChaletCategory] = useState('all');

    const establishmentSections = [
        { key: 'overview', label: 'Aperçu', icon: '📋' },
        { key: 'chalets', label: 'Chalets', icon: '🏠' },
        { key: 'calendar', label: 'Calendrier', icon: '📅' },
        { key: 'payments', label: 'Paiements', icon: '💳' }
    ];

    useEffect(() => {
        if (isEtablissementOpen) {
            setSelectedEstablishment(null);
            setActiveEstablishmentSection('overview');
            fetchEstablishment();

            // Check if we're returning from Google OAuth
            const urlParams = new URLSearchParams(globalThis.location.search);
            if (urlParams.get('google_connected') === 'true') {
                setGoogleConnectionSuccess(true);
                // Restore the establishment and section we were on before OAuth
                const returnEstablishment = urlParams.get('establishment');
                const returnSection = urlParams.get('section');
                if (returnEstablishment) setPendingEstablishmentSelect(returnEstablishment);
                if (returnSection) setPendingSection(returnSection);
                // Clean up URL without reloading
                globalThis.history.replaceState({}, globalThis.document.title, globalThis.location.pathname);

                // Auto-dismiss success message after 5 seconds
                setTimeout(() => {
                    setGoogleConnectionSuccess(false);
                }, 5000);
            }
        }
    }, [isEtablissementOpen]);

    // Auto-select establishment and section when returning from Google OAuth
    useEffect(() => {
        if (pendingEstablishmentSelect && establishments.length > 0) {
            const estab = establishments.find(
                (e) => String(e.key || e.id) === String(pendingEstablishmentSelect)
            );
            if (estab) {
                setSelectedEstablishment(estab);
                if (pendingSection) {
                    setActiveEstablishmentSection(pendingSection);
                }
                setPendingEstablishmentSelect(null);
                setPendingSection(null);
            }
        }
    }, [establishments, pendingEstablishmentSelect]);

    useEffect(() => {
        if (selectedEstablishment) {
            // Use 'key' if it exists, otherwise fall back to 'id'
            const establishmentKey = selectedEstablishment.key || selectedEstablishment.id;
            fetchChalets(establishmentKey);
        }
    }, [selectedEstablishment]);

    useEffect(() => {
        if (selectedEstablishment) {
            setActiveEstablishmentSection('overview');
            setSelectedChaletCategory('all');
        }
    }, [selectedEstablishment?.key, selectedEstablishment?.id]);

    useEffect(() => {
        const syncChaletFormViewport = () => {
            setIsCompactChaletForm((globalThis.innerWidth || 0) < 1024);
        };

        syncChaletFormViewport();
        globalThis.addEventListener('resize', syncChaletFormViewport);
        return () => globalThis.removeEventListener('resize', syncChaletFormViewport);
    }, []);

    const inferChaletCategory = (chalet) => {
        const text = `${chalet?.Name || ''} ${chalet?.Description || ''}`.toLowerCase();

        if (text.includes('loft')) return 'Loft';
        if (text.includes('tent') || text.includes('tente')) return 'Tente';
        if (text.includes('cabane')) return 'Cabane';
        if (text.includes('dome') || text.includes('dôme')) return 'Dôme';
        if (text.includes('suite')) return 'Suite';
        return 'Chalet';
    };

    const chaletCategories = [
        'all',
        ...Array.from(new Set(chalets.map(inferChaletCategory)))
    ];

    const filteredChalets = selectedChaletCategory === 'all'
        ? chalets
        : chalets.filter((chalet) => inferChaletCategory(chalet) === selectedChaletCategory);

    const fetchEstablishment = async () => {
        try {
            setLoading(true);
            setError(null);

            // Get current user
            const { data: { user }, error: userError } = await supabase.auth.getUser();
            
            if (userError) throw userError;
            if (!user) {
                setError("Vous devez être connecté pour voir votre établissement");
                setLoading(false);
                return;
            }

            // Fetch establishment where owner_id matches user id
            // Try different possible column names and table names
            let data = null;
            let fetchError = null;

            // First try with Etablissement (capital E) and owner_id
            let response = await supabase
                .from('Etablissement')
                .select('*')
                .eq('owner_id', user.id);

            if (response.error) {
                // Try lowercase table name
                response = await supabase
                    .from('etablissement')
                    .select('*')
                    .eq('owner_id', user.id);
            }

            if (response.error) {
                // Try with ownerId (camelCase)
                response = await supabase
                    .from('Etablissement')
                    .select('*')
                    .eq('ownerId', user.id);
            }

            data = response.data;
            console.log("Fetched establishment data:", data);
            fetchError = response.error;

            if (fetchError) {
                console.error('Fetch error:', fetchError);
                throw fetchError;
            }

            if (!data || data.length === 0) {
                setEstablishments([]);
                setError("Aucun établissement trouvé pour cet utilisateur");
            } else {
                setEstablishments(data);
            }
        } catch (err) {
            console.error('Error fetching establishment:', err);
            console.error('Error details:', err.message, err.code, err.details);
            setError(`Erreur lors du chargement de l'établissement: ${err.message || 'Erreur inconnue'}`);
        } finally {
            setLoading(false);
        }
    };

    const fetchChalets = async (establishmentKey) => {
        try {
            setLoadingChalets(true);
            setChaletError(null);

            console.log("Fetching chalets for establishment key:", establishmentKey);
            console.log("Full establishment object:", selectedEstablishment);

            // First, let's see ALL chalets to debug
            const allChalets = await supabase
                .from('chalets')
                .select('*');
            console.log("ALL chalets in database:", allChalets.data);
            
            // The correct column name is 'etablishment_id' (note the typo in your database)
            let response = await supabase
                .from('chalets')
                .select(`
                    *,
                    coordinates:location
                `)
                .eq('etablishment_id', establishmentKey);

            console.log("Query attempt (chalets/etablishment_id):", response);

            // If that fails, try with correct spelling 'establishment_id'
            if (response.error) {
                response = await supabase
                    .from('chalets')
                    .select('*')
                    .eq('establishment_id', establishmentKey);
                console.log("Second attempt (chalets/establishment_id):", response);
            }

            // Try with capital C
            if (response.error) {
                response = await supabase
                    .from('Chalets')
                    .select('*')
                    .eq('etablishment_id', establishmentKey);
                console.log("Third attempt (Chalets/etablishment_id):", response);
            }

            // Try establishmentId (camelCase)
            if (response.error) {
                response = await supabase
                    .from('chalets')
                    .select('*')
                    .eq('establishmentId', establishmentKey);
                console.log("Fourth attempt (chalets/establishmentId):", response);
            }

            const { data, error: fetchError } = response;

            if (fetchError) {
                console.error('Fetch chalets error:', fetchError);
                throw fetchError;
            }

            console.log("Fetched chalets:", data);
            
            if (!data || data.length === 0) {
                console.warn(`No chalets found with etablishment_id = "${establishmentKey}"`);
                console.warn("Please verify in Supabase that:");
                console.warn("1. The 'chalets' table has rows");
                console.warn("2. The 'etablishment_id' column values match this UUID");
            }
            
            setChalets(data || []);
        } catch (err) {
            console.error('Error fetching chalets:', err);
            setChaletError(`Erreur lors du chargement des chalets: ${err.message || 'Erreur inconnue'}`);
        } finally {
            setLoadingChalets(false);
        }
    };

    const handleOpenCreateChalet = () => {
        setChaletForm({
            Name: '',
            Description: '',
            nb_personnes: '',
            price_per_night: '',
            latitude: '',
            longitude: '',
            Image: null
        });
        setLocationAddress('');
        setLocationSuggestions([]);
        setLocationLookupError(null);
        setLocationLookupSuccess(null);
        setImageFiles([]);
        setExistingImages([]);
        setImageOrder([]);
        setSelectedAmenities([]);
        setIsDraggingFiles(false);
        setChaletWizardStep(0);
        setChaletStepErrors({});
        setEditingChalet(null);
        setIsCreatingChalet(true);
    };

    const handleOpenEditChalet = async (chalet) => {
        // Extract lat/lon from PostGIS geometry if available
        let latitude = '';
        let longitude = '';
        
        if (chalet.location) {
            // If location is already in lat/lon format (from a previous edit)
            if (typeof chalet.location === 'object' && chalet.location.coordinates) {
                longitude = chalet.location.coordinates[0];
                latitude = chalet.location.coordinates[1];
            }
        }
        
        setChaletForm({
            Name: chalet.Name || '',
            Description: chalet.Description || '',
            nb_personnes: chalet.nb_personnes || '',
            price_per_night: chalet.price_per_night || '',
            latitude: latitude,
            longitude: longitude,
            Image: chalet.Image || null
        });
        setLocationAddress('');
        setLocationSuggestions([]);
        setLocationLookupError(null);
        setLocationLookupSuccess(null);
        setImageFiles([]);
        setImageOrder([]);
        setSelectedAmenities(inferSelectedAmenitiesFromDescription(chalet.Description || ''));
        setIsDraggingFiles(false);
        
        // Fetch existing images from chalet_images table
        try {
            const { data: images, error } = await supabase
                .from('chalet_images')
                .select('*')
                .eq('chalet_id', chalet.key)
                .order('display_order', { ascending: true });
            
            if (error) {
                console.error('Error fetching chalet images:', error);
                setExistingImages([]);
                setImageOrder([]);
            } else {
                setExistingImages(images || []);
                setImageOrder((images || []).map((img) => `existing-${img.id}`));
            }
        } catch (err) {
            console.error('Error fetching chalet images:', err);
            setExistingImages([]);
            setImageOrder([]);
        }
        
        setEditingChalet(chalet);
        setChaletWizardStep(0);
        setChaletStepErrors({});
        setIsCreatingChalet(true);
    };

    const handleCloseForm = () => {
        setIsCreatingChalet(false);
        setEditingChalet(null);
        setIsPickingLocationOnMap(false);
        globalThis.__MS_PICKING_LOCATION__ = false;
        setChaletForm({
            Name: '',
            Description: '',
            nb_personnes: '',
            price_per_night: '',
            latitude: '',
            longitude: '',
            Image: null
        });
        setLocationAddress('');
        setLocationSuggestions([]);
        setLocationLookupError(null);
        setLocationLookupSuccess(null);
        setImageFiles([]);
        setExistingImages([]);
        setImageOrder([]);
        setSelectedAmenities([]);
        setIsDraggingFiles(false);
        setChaletWizardStep(0);
        setChaletStepErrors({});
    };

    const handleOpenHoraireModal = (chalet) => {
        setSelectedChaletForHoraire(chalet);
        setIsHoraireModalOpen(true);
    };

    const handleCloseHoraireModal = () => {
        setIsHoraireModalOpen(false);
        setSelectedChaletForHoraire(null);
    };

    const handleConnectGoogleCalendar = () => {
        if (!selectedEstablishment) return;

        try {
            setIsConnectingGoogle(true);
            setGoogleConnectionError(null);

            const establishmentKey = selectedEstablishment.key || selectedEstablishment.id;

            // Redirect to OAuth endpoint with establishment ID
            const oauthUrl = new URL(
                `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-calendar-oauth`
            );
            oauthUrl.searchParams.set('establishmentId', establishmentKey);
            
            // Build redirect URL so we return to this establishment's calendar section
            const redirectUrl = new URL(globalThis.location.origin + globalThis.location.pathname);
            redirectUrl.searchParams.set('openEstablishment', 'true');
            redirectUrl.searchParams.set('google_connected', 'true');
            redirectUrl.searchParams.set('establishment', establishmentKey);
            redirectUrl.searchParams.set('section', 'calendar');
            oauthUrl.searchParams.set('redirect_to', redirectUrl.toString());

            // Redirect to Google OAuth
            globalThis.location.href = oauthUrl.toString();
        } catch (err) {
            console.error('Error connecting Google Calendar:', err);
            setGoogleConnectionError(err.message || 'Erreur lors de la connexion à Google Calendar');
            setIsConnectingGoogle(false);
        }
    };

    const isGoogleCalendarConnectionError = (statusCode, errorData) => {
        if (statusCode === 401 || errorData?.requiresAuth) return true;

        const errorText = `${errorData?.error || ''} ${errorData?.message || ''}`.toLowerCase();
        return errorText.includes('google') && (
            errorText.includes('auth')
            || errorText.includes('connect')
            || errorText.includes('reconnect')
            || errorText.includes('token')
            || errorText.includes('expired')
        );
    };

    const promptGoogleCalendarConnectionForChaletCreation = () => {
        setShowGoogleConnectModal(true);
    };

    const createGoogleCalendarForChalet = async ({ chaletId, chaletName }) => {
        const session = (await supabase.auth.getSession()).data.session;
        const accessToken = session?.access_token;

        const response = await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-chalet-calendar`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
                },
                body: JSON.stringify({
                    chalet_id: chaletId,
                    chalet_name: chaletName
                })
            }
        );

        let payload = {};
        try {
            payload = await response.json();
        } catch {
            payload = {};
        }

        if (!response.ok) {
            if (isGoogleCalendarConnectionError(response.status, payload)) {
                throw new Error('GOOGLE_CALENDAR_CONNECTION_REQUIRED');
            }

            throw new Error(payload.error || payload.message || 'Erreur lors de la creation de l\'agenda Google Calendar du chalet.');
        }

        return payload;
    };

    const handleDisconnectGoogleCalendar = async () => {
        if (!selectedEstablishment) return;

        const confirmDisconnect = globalThis.confirm(
            'Êtes-vous sûr de vouloir déconnecter Google Calendar ? Les calendriers des chalets resteront actifs mais ne pourront plus être synchronisés.'
        );

        if (!confirmDisconnect) return;

        try {
            setIsConnectingGoogle(true);
            setGoogleConnectionError(null);

            const establishmentKey = selectedEstablishment.key || selectedEstablishment.id;

            // Update the establishment to remove google_calendar_id
            const { error: updateError } = await supabase
                .from('Etablissement')
                .update({ google_calendar_id: null })
                .eq('key', establishmentKey);

            if (updateError) {
                // Try lowercase table name
                const { error: updateError2 } = await supabase
                    .from('etablissement')
                    .update({ google_calendar_id: null })
                    .eq('key', establishmentKey);
                
                if (updateError2) throw updateError2;
            }

            // Refresh the establishment data
            await fetchEstablishment();
        } catch (err) {
            console.error('Error disconnecting Google Calendar:', err);
            setGoogleConnectionError(err.message || 'Erreur lors de la déconnexion');
        } finally {
            setIsConnectingGoogle(false);
        }
    };

    const handleFormChange = (e) => {
        const { name, value } = e.target;
        setChaletForm(prev => ({
            ...prev,
            [name]: value
        }));
    };

    const applyResolvedCoordinates = ({ latitude, longitude }) => {
        setChaletForm(prev => ({
            ...prev,
            latitude: toCoordinateInputValue(latitude),
            longitude: toCoordinateInputValue(longitude)
        }));
    };

    const handleSelectAddressSuggestion = (suggestion) => {
        applyResolvedCoordinates(suggestion);
        setLocationAddress(suggestion.displayName || '');
        setLocationSuggestions([]);
        setLocationLookupError(null);
        setLocationLookupSuccess(suggestion.displayName || 'Adresse localisee en Gaspesie.');
    };

    const handleStartMapLocationPick = () => {
        setLocationLookupError(null);
        setLocationLookupSuccess('Cliquez sur la carte pour choisir l\'emplacement exact.');
        setIsPickingLocationOnMap(true);
        globalThis.__MS_PICKING_LOCATION__ = true;
    };

    const handleCancelMapLocationPick = () => {
        setIsPickingLocationOnMap(false);
        globalThis.__MS_PICKING_LOCATION__ = false;
    };

    useEffect(() => {
        if (!isCreatingChalet || chaletWizardStep !== 1) return;

        const query = locationAddress.trim();
        if (query.length < 3) {
            setLocationSuggestions([]);
            setIsSearchingLocation(false);
            return;
        }

        const timeoutId = setTimeout(async () => {
            try {
                setIsSearchingLocation(true);
                setLocationLookupError(null);
                const suggestions = await searchAddressesInGaspesie(query, 6);
                setLocationSuggestions(suggestions);
            } catch (err) {
                setLocationSuggestions([]);
                setLocationLookupError(err.message || 'Impossible de rechercher cette adresse.');
            } finally {
                setIsSearchingLocation(false);
            }
        }, 300);

        return () => clearTimeout(timeoutId);
    }, [locationAddress, isCreatingChalet, chaletWizardStep]);

    useEffect(() => {
        const handleMapLocationPicked = (event) => {
            const latitude = event?.detail?.latitude;
            const longitude = event?.detail?.longitude;

            if (!isInGaspesieBounds(latitude, longitude)) {
                setLocationLookupError('Le point selectionne est hors de la region cible (Gaspesie).');
                setLocationLookupSuccess(null);
                setLocationSuggestions([]);
                setIsPickingLocationOnMap(false);
                globalThis.__MS_PICKING_LOCATION__ = false;
                return;
            }

            applyResolvedCoordinates({ latitude, longitude });
            setLocationLookupError(null);
            setLocationLookupSuccess('Point de carte selectionne avec succes.');
            setLocationSuggestions([]);
            setIsPickingLocationOnMap(false);
            globalThis.__MS_PICKING_LOCATION__ = false;
        };

        globalThis.addEventListener('ms:map-location-picked', handleMapLocationPicked);

        return () => {
            globalThis.removeEventListener('ms:map-location-picked', handleMapLocationPicked);
            globalThis.__MS_PICKING_LOCATION__ = false;
        };
    }, []);

    const addImageFiles = (files) => {
        const imageOnlyFiles = files.filter((file) => file.type?.startsWith('image/'));
        if (imageOnlyFiles.length > 0) {
            const mapped = imageOnlyFiles.map((file) => ({
                id: `new-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
                file
            }));

            setImageFiles((prev) => [...prev, ...mapped]);
            setImageOrder((prev) => [...prev, ...mapped.map((item) => item.id)]);
        }
    };

    const handleImageChange = (e) => {
        const files = Array.from(e.target.files || []);
        addImageFiles(files);

        if (e.target) {
            e.target.value = '';
        }
    };

    const handleFileDragEnter = (e) => {
        e.preventDefault();
        setIsDraggingFiles(true);
    };

    const handleFileDragOver = (e) => {
        e.preventDefault();
        setIsDraggingFiles(true);
    };

    const handleFileDragLeave = (e) => {
        e.preventDefault();
        setIsDraggingFiles(false);
    };

    const handleFileDrop = (e) => {
        e.preventDefault();
        setIsDraggingFiles(false);
        addImageFiles(Array.from(e.dataTransfer.files || []));
    };

    const handleToggleAmenity = (amenityId) => {
        setSelectedAmenities((prev) => (
            prev.includes(amenityId)
                ? prev.filter((id) => id !== amenityId)
                : [...prev, amenityId]
        ));
    };

    const handleRemoveNewImage = (imageId) => {
        setImageFiles((prev) => prev.filter((item) => item.id !== imageId));
        setImageOrder((prev) => prev.filter((id) => id !== imageId));
    };

    const handleRemoveExistingImage = async (imageId) => {
        try {
            const { error } = await supabase
                .from('chalet_images')
                .delete()
                .eq('id', imageId);
            
            if (error) throw error;
            
            setExistingImages((prev) => prev.filter((img) => img.id !== imageId));
            setImageOrder((prev) => prev.filter((id) => id !== `existing-${imageId}`));
        } catch (error) {
            console.error('Error removing image:', error);
            alert('Erreur lors de la suppression de l\'image');
        }
    };

    const existingImageItems = existingImages.map((img) => ({
        id: `existing-${img.id}`,
        kind: 'existing',
        image: img
    }));

    const newImageItems = imageFiles.map((item) => ({
        id: item.id,
        kind: 'new',
        file: item.file
    }));

    const imageItemMap = new Map([...existingImageItems, ...newImageItems].map((item) => [item.id, item]));

    const orderedImageItems = imageOrder
        .map((id) => imageItemMap.get(id))
        .filter(Boolean);

    useEffect(() => {
        const validIds = new Set([...existingImageItems, ...newImageItems].map((item) => item.id));
        setImageOrder((prev) => {
            const filtered = prev.filter((id) => validIds.has(id));
            const missing = [...validIds].filter((id) => !filtered.includes(id));
            return [...filtered, ...missing];
        });
    }, [existingImages, imageFiles]);

    const previewUrlMap = useMemo(() => {
        const map = {};
        imageFiles.forEach((item) => {
            map[item.id] = URL.createObjectURL(item.file);
        });
        return map;
    }, [imageFiles]);

    useEffect(() => {
        return () => {
            Object.values(previewUrlMap).forEach((url) => URL.revokeObjectURL(url));
        };
    }, [previewUrlMap]);

    const handlePhotoDragStart = (event) => {
        setDraggingImageId(event.active?.id || null);
    };

    const handlePhotoDragEnd = (event) => {
        const { active, over } = event;
        setDraggingImageId(null);

        if (!active?.id || !over?.id || active.id === over.id) return;

        setImageOrder((prev) => {
            const oldIndex = prev.indexOf(active.id);
            const newIndex = prev.indexOf(over.id);
            if (oldIndex === -1 || newIndex === -1) return prev;
            return arrayMove(prev, oldIndex, newIndex);
        });
    };

    const activeImage = draggingImageId ? imageItemMap.get(draggingImageId) : null;

    const uploadImage = async (file) => {
        try {
            const fileExt = file.name.split('.').pop();
            const fileName = `${Math.random().toString(36).substring(2)}-${Date.now()}.${fileExt}`;
            const filePath = `images/${fileName}`;

            const { error: uploadError } = await supabase.storage
                .from('chalets')
                .upload(filePath, file);

            if (uploadError) {
                throw uploadError;
            }

            const { data: { publicUrl } } = supabase.storage
                .from('chalets')
                .getPublicUrl(filePath);

            return publicUrl;
        } catch (error) {
            console.error('Error uploading image:', error);
            throw error;
        }
    };

    const uploadMultipleImages = async (files) => {
        setUploadingImages(true);
        try {
            const uploaded = await Promise.all(
                files.map(async (imageItem) => {
                    const url = await uploadImage(imageItem.file);
                    return { id: imageItem.id, url };
                })
            );
            return uploaded;
        } catch (error) {
            console.error('Error uploading images:', error);
            throw error;
        } finally {
            setUploadingImages(false);
        }
    };

    const getActivePropertyType = () => inferChaletCategory({
        Name: chaletForm.Name,
        Description: chaletForm.Description
    });

    const hasAnyChaletImage = () => (
        existingImages.length > 0
        || imageFiles.length > 0
        || Boolean(chaletForm.Image)
    );

    const getChaletStepValidation = (stepIndex) => {
        const errors = {};

        if (stepIndex === 0) {
            if (!chaletForm.Name.trim()) {
                errors.Name = 'Le nom du chalet est requis pour continuer.';
            }
        }

        if (stepIndex === 1) {
            if (!chaletForm.latitude || !chaletForm.longitude) {
                errors.location = 'Selectionnez une localisation (coordonnees GPS) pour continuer.';
            }
        }

        if (stepIndex === 2) {
            const capacity = parseInt(chaletForm.nb_personnes, 10);
            if (!chaletForm.nb_personnes || Number.isNaN(capacity) || capacity < 1) {
                errors.nb_personnes = 'La capacite doit etre au moins de 1 personne.';
            }
        }

        if (stepIndex === 3) {
            if (selectedAmenities.length === 0 && !chaletForm.Description.trim()) {
                errors.Description = 'Selectionnez au moins une commodite ou ajoutez une description.';
            }
        }

        if (stepIndex === 4) {
            if (!hasAnyChaletImage()) {
                errors.images = 'Ajoutez au moins une photo pour continuer.';
            }
        }

        if (stepIndex === 5) {
            const price = parseFloat(chaletForm.price_per_night);
            if (!chaletForm.price_per_night || Number.isNaN(price) || price < 0) {
                errors.price_per_night = 'Ajoutez un prix valide par nuit.';
            }
        }

        return {
            isValid: Object.keys(errors).length === 0,
            errors
        };
    };

    const handleWizardNext = () => {
        const validation = getChaletStepValidation(chaletWizardStep);
        if (!validation.isValid) {
            setChaletStepErrors(prev => ({ ...prev, ...validation.errors }));
            return;
        }

        setChaletStepErrors({});
        setChaletWizardStep(prev => Math.min(prev + 1, CHALET_WIZARD_STEPS.length - 1));
    };

    const handleWizardBack = () => {
        setChaletStepErrors({});
        setChaletWizardStep(prev => Math.max(prev - 1, 0));
    };

    const wizardValidation = getChaletStepValidation(chaletWizardStep);
    const generatedAmenitiesDescription = buildAmenitiesDescription(selectedAmenities, chaletForm.Description);
    const wizardProgress = ((chaletWizardStep + 1) / CHALET_WIZARD_STEPS.length) * 100;

    const handleSubmitChalet = async (e) => {
        if (e?.preventDefault) {
            e.preventDefault();
        }
        
        try {
            setLoadingChalets(true);
            setChaletError(null);
            setChaletCreationStep(null);

            const orderedItems = orderedImageItems.length > 0
                ? orderedImageItems
                : [...existingImageItems, ...newImageItems];

            // New chalets require an active Google Calendar connection because
            // the chalet agenda is now created automatically at creation time.
            if (!editingChalet && !selectedEstablishment?.google_calendar_id) {
                setChaletError('Connexion Google Calendar requise. La creation du chalet est en attente tant que le calendrier Google n\'est pas connecte.');
                setLoadingChalets(false);
                setChaletCreationStep(null);
                promptGoogleCalendarConnectionForChaletCreation();
                return;
            }

            // Upload new images if there are any, preserving on-screen order
            let newImageUploads = [];
            const orderedNewImages = orderedItems.filter((item) => item.kind === 'new');
            if (orderedNewImages.length > 0) {
                setChaletCreationStep('Telechargement des photos...');
                newImageUploads = await uploadMultipleImages(orderedNewImages);
            }

            const newImageUrlById = new Map(newImageUploads.map((item) => [item.id, item.url]));

            const establishmentKey = selectedEstablishment.key || selectedEstablishment.id;

            // Keep the first existing or new image as the main Image field (for backward compatibility)
            let mainImageUrl = chaletForm.Image;
            const firstImage = orderedItems[0];
            if (firstImage?.kind === 'existing') {
                mainImageUrl = firstImage.image.image_url;
            } else if (firstImage?.kind === 'new') {
                mainImageUrl = newImageUrlById.get(firstImage.id) || chaletForm.Image;
            }

            const chaletData = {
                Name: chaletForm.Name,
                Description: buildAmenitiesDescription(selectedAmenities, chaletForm.Description),
                nb_personnes: chaletForm.nb_personnes ? parseInt(chaletForm.nb_personnes) : null,
                price_per_night: chaletForm.price_per_night ? parseFloat(chaletForm.price_per_night) : null,
                etablishment_id: establishmentKey,
                Image: mainImageUrl
            };

            // Add location if both latitude and longitude are provided
            if (chaletForm.latitude && chaletForm.longitude) {
                const lat = parseFloat(chaletForm.latitude);
                const lon = parseFloat(chaletForm.longitude);

                if (!isNaN(lat) && !isNaN(lon)) {
                    // Create a GeoJSON Point object that PostGIS can understand
                    // Format: POINT(longitude latitude)
                    chaletData.location = `POINT(${lon} ${lat})`;
                }
            }

            let chaletKey;
            if (editingChalet) {
                setChaletCreationStep('Mise a jour du chalet...');
                // Update existing chalet
                const { error: updateError } = await supabase
                    .from('chalets')
                    .update(chaletData)
                    .eq('key', editingChalet.key);

                if (updateError) throw updateError;
                chaletKey = editingChalet.key;

                // Update display order for existing images based on current visual order
                const orderedExisting = orderedItems
                    .map((item, index) => ({ item, index }))
                    .filter(({ item }) => item.kind === 'existing');

                for (const { item, index } of orderedExisting) {
                    const { error: orderError } = await supabase
                        .from('chalet_images')
                        .update({ display_order: index })
                        .eq('id', item.image.id);

                    if (orderError) console.error('Error updating image order:', orderError);
                }
            } else {
                setChaletCreationStep('Creation du chalet...');
                // Create new chalet
                const { data: newChalet, error: insertError } = await supabase
                    .from('chalets')
                    .insert([chaletData])
                    .select();

                if (insertError) throw insertError;
                chaletKey = newChalet[0].key;

                // Automatically create the chalet Google Calendar agenda.
                setChaletCreationStep('Creation de l\'agenda Google Calendar... (peut prendre quelques secondes)');
                try {
                    await createGoogleCalendarForChalet({
                        chaletId: chaletKey,
                        chaletName: chaletForm.Name
                    });
                } catch (calendarErr) {
                    // Keep DB consistent: remove chalet if agenda creation failed.
                    await supabase.from('chalets').delete().eq('key', chaletKey);

                    if (calendarErr.message === 'GOOGLE_CALENDAR_CONNECTION_REQUIRED') {
                        promptGoogleCalendarConnectionForChaletCreation();
                        throw new Error('Google Calendar n\'est pas connecte ou a expire. La creation du chalet est en attente jusqu\'a la connexion et la creation de l\'agenda.');
                    }

                    throw calendarErr;
                }
            }
            
            // Insert new images into chalet_images table
            if (newImageUploads.length > 0) {
                const imageRecords = orderedItems
                    .map((item, index) => ({ item, index }))
                    .filter(({ item }) => item.kind === 'new')
                    .map(({ item, index }) => ({
                        chalet_id: chaletKey,
                        image_url: newImageUrlById.get(item.id),
                        display_order: index
                    }))
                    .filter((record) => Boolean(record.image_url));
                
                const { error: imageError } = await supabase
                    .from('chalet_images')
                    .insert(imageRecords);
                
                if (imageError) {
                    console.error('Error inserting images:', imageError);
                }
            }

            // Refresh the chalets list
            await fetchChalets(establishmentKey);
            handleCloseForm();
        } catch (err) {
            console.error('Error saving chalet:', err);
            setChaletError(`Erreur lors de la sauvegarde: ${err.message || 'Erreur inconnue'}`);
        } finally {
            setLoadingChalets(false);
            setChaletCreationStep(null);
        }
    };

    const handleDeleteChalet = async (chaletKey) => {
        if (!globalThis.confirm('Êtes-vous sûr de vouloir supprimer ce chalet?')) {
            return;
        }

        try {
            setLoadingChalets(true);
            setChaletError(null);

            const { error: deleteError } = await supabase
                .from('chalets')
                .delete()
                .eq('key', chaletKey);

            if (deleteError) throw deleteError;

            // Refresh the chalets list
            const establishmentKey = selectedEstablishment.key || selectedEstablishment.id;
            await fetchChalets(establishmentKey);
        } catch (err) {
            console.error('Error deleting chalet:', err);
            setChaletError(`Erreur lors de la suppression: ${err.message || 'Erreur inconnue'}`);
        } finally {
            setLoadingChalets(false);
        }
    };

    const handleOpenCreateEstablishment = () => {
        setEstablishmentForm({
            name: '',
            adresse: '',
            telephone: '',
            email: ''
        });
        setEstablishmentError(null);
        setEditingEstablishment(null);
        setIsCreatingEstablishment(true);
    };

    const handleOpenEditEstablishment = (establishment) => {
        setEstablishmentForm({
            name: establishment.Name || establishment.name || '',
            adresse: establishment.Description || establishment.adresse || '',
            telephone: establishment.telephone || '',
            email: establishment.email || ''
        });
        setEstablishmentError(null);
        setEditingEstablishment(establishment);
        setIsCreatingEstablishment(true);
    };

    const handleCloseEstablishmentForm = () => {
        setIsCreatingEstablishment(false);
        setEditingEstablishment(null);
        setEstablishmentForm({
            name: '',
            adresse: '',
            telephone: '',
            email: ''
        });
        setEstablishmentError(null);
    };

    const handleEstablishmentFormChange = (e) => {
        const { name, value } = e.target;
        setEstablishmentForm(prev => ({
            ...prev,
            [name]: value
        }));
    };

    const handleSubmitEstablishment = async (e) => {
        e.preventDefault();
        
        try {
            setSavingEstablishment(true);
            setEstablishmentError(null);

            // Get current user
            const { data: { user }, error: userError } = await supabase.auth.getUser();
            
            if (userError) throw userError;
            if (!user) throw new Error('Vous devez être connecté');

            if (editingEstablishment) {
                // Update existing establishment
                const { error: updateError } = await supabase
                    .from('Etablissement')
                    .update({
                        Name: establishmentForm.name,
                        Description: establishmentForm.adresse || '',
                        telephone: establishmentForm.telephone || null,
                        email: establishmentForm.email || null
                    })
                    .eq('key', editingEstablishment.key || editingEstablishment.id);

                if (updateError) throw updateError;

                // Close form and refresh list
                handleCloseEstablishmentForm();
                await fetchEstablishment();
            } else {
                // Create new establishment
                const { data, error: insertError } = await supabase
                    .from('Etablissement')
                    .insert([
                        {
                            Name: establishmentForm.name,
                            Description: establishmentForm.adresse || '',
                            telephone: establishmentForm.telephone || null,
                            email: establishmentForm.email || null,
                            owner_id: user.id
                        }
                    ])
                    .select();

                if (insertError) throw insertError;

                // Close form and refresh list
                handleCloseEstablishmentForm();
                await fetchEstablishment();

                // Auto-select the new establishment
                if (data && data.length > 0) {
                    setSelectedEstablishment(data[0]);
                }
            }
        } catch (err) {
            console.error('Error saving establishment:', err);
            setEstablishmentError(`Erreur lors de ${editingEstablishment ? 'la modification' : 'la création'}: ${err.message || 'Erreur inconnue'}`);
        } finally {
            setSavingEstablishment(false);
        }
    };

    const handleDeleteEstablishment = async (establishmentKey) => {
        const establishment = establishments.find(est => 
            (est.key || est.id) === establishmentKey
        );
        
        const confirmMessage = `Êtes-vous sûr de vouloir supprimer "${establishment?.Name || establishment?.name || 'cet établissement'}" ?\n\nCette action supprimera également tous les chalets associés et ne peut pas être annulée.`;
        
        if (!globalThis.confirm(confirmMessage)) {
            return;
        }

        try {
            setLoading(true);
            setError(null);

            // Delete the establishment (cascade should handle chalets)
            const { error: deleteError } = await supabase
                .from('Etablissement')
                .delete()
                .eq('key', establishmentKey);

            if (deleteError) throw deleteError;

            // Refresh establishments list
            await fetchEstablishment();

            // If we deleted the currently selected establishment, clear selection
            if (selectedEstablishment && (selectedEstablishment.key || selectedEstablishment.id) === establishmentKey) {
                setSelectedEstablishment(null);
                setChalets([]);
            }
        } catch (err) {
            console.error('Error deleting establishment:', err);
            setError(`Erreur lors de la suppression: ${err.message}`);
        } finally {
            setLoading(false);
        }
    };

    if (!isEtablissementOpen) return null;

    if (isPickingLocationOnMap) {
        return (
            <div
                style={{
                    position: 'fixed',
                    inset: 0,
                    zIndex: 2500,
                    pointerEvents: 'none'
                }}
            >
                <div
                    style={{
                        pointerEvents: 'auto',
                        maxWidth: '680px',
                        margin: '20px auto 0',
                        background: 'rgba(15, 23, 42, 0.95)',
                        color: '#ffffff',
                        borderRadius: '12px',
                        padding: '16px 18px',
                        boxShadow: '0 10px 25px rgba(0, 0, 0, 0.35)'
                    }}
                >
                    <p style={{ margin: 0, fontWeight: 600, fontSize: '1rem' }}>
                        Selection de position active
                    </p>
                    <p style={{ margin: '8px 0 0', fontSize: '0.92rem', opacity: 0.92 }}>
                        Cliquez sur la carte interactive pour choisir la position precise du chalet.
                    </p>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '12px' }}>
                        <button
                            type="button"
                            onClick={handleCancelMapLocationPick}
                            style={{
                                padding: '8px 12px',
                                borderRadius: '6px',
                                border: '1px solid rgba(255, 255, 255, 0.35)',
                                background: 'transparent',
                                color: '#ffffff',
                                cursor: 'pointer',
                                fontWeight: 600
                            }}
                        >
                            Annuler
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="guide-profile-fullscreen">
            {/* Header */}
            <div className="guide-profile-header">
                <div style={{ display: "flex", alignItems: "center", gap: 16, justifyContent: "space-between", width: "100%" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                        <button
                            type="button"
                            className="etablissement-close-button"
                            onClick={onClose}
                            aria-label="Fermer la fenêtre établissements"
                            title="Fermer"
                        >
                            X
                        </button>
                        <div>
                            <h1 className="guide-profile-title" style={{ marginBottom: '4px' }}>Mes Établissements</h1>
                            <p style={{ fontSize: '0.9rem', color: '#64748b', margin: 0 }}>Gérez vos lieux de réservation</p>
                        </div>
                    </div>
                    {!loading && !error && (
                        <button
                            type="button"
                            onClick={handleOpenCreateEstablishment}
                            style={{
                                padding: '10px 20px',
                                backgroundColor: '#059669',
                                color: 'white',
                                border: 'none',
                                borderRadius: '8px',
                                cursor: 'pointer',
                                fontWeight: '600',
                                fontSize: '0.95rem',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                            }}
                        >
                            <span style={{ fontSize: '1.2rem' }}>+</span>
                            <span>Ajouter un lieu</span>
                        </button>
                    )}
                </div>
            </div>

            {/* Main Content */}
            <div className="guide-profile-content">
                {/* Loading State */}
                {loading && establishments.length === 0 && (
                    <div style={{ textAlign: 'center', padding: '60px', color: '#64748b' }}>
                        <div style={{ fontSize: '2rem', marginBottom: '16px' }}>⏳</div>
                        <p style={{ fontSize: '1.1rem' }}>Chargement de vos établissements...</p>
                    </div>
                )}

                {/* Error State */}
                {error && !loading && (
                    <div style={{ textAlign: 'center', padding: '60px' }}>
                        <div style={{ fontSize: '2rem', marginBottom: '16px' }}>⚠️</div>
                        <p style={{ color: '#ef4444', marginBottom: '20px', fontSize: '1.05rem' }}>{error}</p>
                        <button 
                            type="button"
                            onClick={fetchEstablishment}
                            style={{
                                padding: '12px 24px',
                                backgroundColor: '#059669',
                                color: 'white',
                                border: 'none',
                                borderRadius: '8px',
                                cursor: 'pointer',
                                fontSize: '1rem',
                                fontWeight: '600'
                            }}
                        >
                            Réessayer
                        </button>
                    </div>
                )}

                {/* No establishments state */}
                {!loading && !error && establishments.length === 0 && (
                    <div style={{ textAlign: 'center', padding: '60px' }}>
                        <div style={{ fontSize: '3rem', marginBottom: '20px' }}>🏕️</div>
                        <h2 style={{ fontSize: '1.5rem', color: '#334155', marginBottom: '12px' }}>Aucun établissement encore</h2>
                        <p style={{ color: '#64748b', marginBottom: '28px', fontSize: '1.05rem' }}>
                            Commencez par ajouter votre premier lieu de réservation
                        </p>
                        <button
                            type="button"
                            onClick={handleOpenCreateEstablishment}
                            style={{
                                padding: '14px 28px',
                                backgroundColor: '#059669',
                                color: 'white',
                                border: 'none',
                                borderRadius: '8px',
                                cursor: 'pointer',
                                fontWeight: '600',
                                fontSize: '1.05rem',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '10px'
                            }}
                        >
                            <span style={{ fontSize: '1.3rem' }}>+</span>
                            <span>Ajouter mon premier lieu</span>
                        </button>
                    </div>
                )}

                {/* Display Establishments List */}
                {!error && establishments.length > 0 && !selectedEstablishment && (
                    <div style={{ padding: '20px' }}>
                        <h2 style={{ fontSize: '1.3rem', color: '#334155', marginBottom: '8px' }}>Vos lieux de réservation</h2>
                        <p style={{ color: '#64748b', marginBottom: '24px' }}>
                            Sélectionnez un établissement pour le gérer
                            {loading ? ' • Mise à jour en arrière-plan...' : ''}
                        </p>
                        
                        <div style={{ display: 'grid', gap: '16px' }}>
                            {establishments.map((est) => (
                                <div
                                    key={est.id}
                                    style={{
                                        padding: '20px',
                                        backgroundColor: 'white',
                                        borderRadius: '10px',
                                        border: '2px solid #e2e8f0',
                                        cursor: 'pointer',
                                        transition: 'all 0.2s',
                                        position: 'relative'
                                    }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.borderColor = '#059669';
                                        e.currentTarget.style.boxShadow = '0 4px 12px rgba(5, 150, 105, 0.15)';
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.borderColor = '#e2e8f0';
                                        e.currentTarget.style.boxShadow = 'none';
                                    }}
                                >
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                                        <div 
                                            style={{ flex: 1 }}
                                            onClick={() => setSelectedEstablishment(est)}
                                        >
                                            <h3 style={{ fontSize: '1.2rem', color: '#059669', marginBottom: '12px', fontWeight: '600' }}>
                                                {est.Name || est.name || `Établissement ${est.key || est.id}`}
                                            </h3>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                {(est.Description || est.adresse) && (
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#64748b' }}>
                                                        <span>📍</span>
                                                        <span>{est.Description || est.adresse}</span>
                                                    </div>
                                                )}
                                                {est.telephone && (
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#64748b' }}>
                                                        <span>📞</span>
                                                        <span>{est.telephone}</span>
                                                    </div>
                                                )}
                                                {est.email && (
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#64748b' }}>
                                                        <span>✉️</span>
                                                        <span>{est.email}</span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleDeleteEstablishment(est.key || est.id);
                                            }}
                                            style={{
                                                padding: '8px 16px',
                                                backgroundColor: '#fee2e2',
                                                color: '#dc2626',
                                                border: '1px solid #fecaca',
                                                borderRadius: '6px',
                                                cursor: 'pointer',
                                                fontSize: '0.9rem',
                                                fontWeight: '500',
                                                transition: 'all 0.2s'
                                            }}
                                            onMouseEnter={(e) => {
                                                e.currentTarget.style.backgroundColor = '#dc2626';
                                                e.currentTarget.style.color = 'white';
                                            }}
                                            onMouseLeave={(e) => {
                                                e.currentTarget.style.backgroundColor = '#fee2e2';
                                                e.currentTarget.style.color = '#dc2626';
                                            }}
                                        >
                                            Supprimer
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Display Selected Establishment Data */}
                {!error && selectedEstablishment && (
                    <>
                        {/* Back to list button */}
                        <div style={{ padding: '20px', paddingBottom: '0' }}>
                            <button
                                type="button"
                                onClick={() => setSelectedEstablishment(null)}
                                style={{
                                    padding: '8px 16px',
                                    backgroundColor: '#f1f5f9',
                                    color: '#475569',
                                    border: '1px solid #cbd5e1',
                                    borderRadius: '6px',
                                    cursor: 'pointer',
                                    fontSize: '0.9rem',
                                    fontWeight: '500',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px'
                                }}
                            >
                                <span>←</span>
                                <span>Retour à la liste</span>
                            </button>
                        </div>

                        <div style={{ padding: '20px', paddingTop: '14px', paddingBottom: 0 }}>
                            <div className="etablissement-section-tabs" role="tablist" aria-label="Sections établissement">
                                {establishmentSections.map((section) => (
                                    <button
                                        key={section.key}
                                        type="button"
                                        role="tab"
                                        aria-selected={activeEstablishmentSection === section.key}
                                        onClick={() => setActiveEstablishmentSection(section.key)}
                                        className={`etablissement-section-tab ${activeEstablishmentSection === section.key ? 'active' : ''}`}
                                    >
                                        <span>{section.icon}</span>
                                        <span>{section.label}</span>
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div style={{ gridColumn: '1 / -1', padding: '20px', paddingTop: '16px' }}>
                            {activeEstablishmentSection === 'overview' && (
                                <div className="guide-section guide-card" style={{
                                    border: '1px solid #e2e8f0',
                                    borderRadius: '12px',
                                    backgroundColor: 'white',
                                    padding: '20px'
                                }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', gap: '8px', flexWrap: 'wrap' }}>
                                        <h2 className="guide-section-title" style={{ marginBottom: 0, padding: 0 }}>📋 Informations du lieu</h2>
                                        <div style={{ display: 'flex', gap: '8px' }}>
                                            <button
                                                type="button"
                                                onClick={() => handleOpenEditEstablishment(selectedEstablishment)}
                                                style={{
                                                    padding: '6px 14px',
                                                    backgroundColor: '#dbeafe',
                                                    color: '#1e40af',
                                                    border: '1px solid #93c5fd',
                                                    borderRadius: '6px',
                                                    cursor: 'pointer',
                                                    fontSize: '0.85rem',
                                                    fontWeight: '500'
                                                }}
                                            >
                                                ✏️ Modifier
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleDeleteEstablishment(selectedEstablishment.key || selectedEstablishment.id)}
                                                style={{
                                                    padding: '6px 14px',
                                                    backgroundColor: '#fee2e2',
                                                    color: '#dc2626',
                                                    border: '1px solid #fecaca',
                                                    borderRadius: '6px',
                                                    cursor: 'pointer',
                                                    fontSize: '0.85rem',
                                                    fontWeight: '500'
                                                }}
                                            >
                                                🗑️ Supprimer
                                            </button>
                                        </div>
                                    </div>
                                    <div className="guide-section-content" style={{ padding: 0 }}>
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' }}>
                                            <div>
                                                <label style={{ fontWeight: '600', color: '#334155', fontSize: '0.9rem' }}>Nom du lieu</label>
                                                <p style={{ color: '#64748b', marginTop: '6px', fontSize: '1.05rem' }}>
                                                    {selectedEstablishment.Name || selectedEstablishment.name || <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>Non renseigné</span>}
                                                </p>
                                            </div>

                                            <div>
                                                <label style={{ fontWeight: '600', color: '#334155', fontSize: '0.9rem' }}>Téléphone</label>
                                                <p style={{ color: '#64748b', marginTop: '6px', fontSize: '1.05rem' }}>
                                                    {selectedEstablishment.telephone || <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>Non renseigné</span>}
                                                </p>
                                            </div>

                                            <div style={{ gridColumn: '1 / -1' }}>
                                                <label style={{ fontWeight: '600', color: '#334155', fontSize: '0.9rem' }}>Description / Adresse</label>
                                                <p style={{ color: '#64748b', marginTop: '6px', fontSize: '1.05rem' }}>
                                                    {selectedEstablishment.Description || selectedEstablishment.adresse || <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>Non renseigné</span>}
                                                </p>
                                            </div>

                                            <div>
                                                <label style={{ fontWeight: '600', color: '#334155', fontSize: '0.9rem' }}>Courriel</label>
                                                <p style={{ color: '#64748b', marginTop: '6px', fontSize: '1.05rem' }}>
                                                    {selectedEstablishment.email || <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>Non renseigné</span>}
                                                </p>
                                            </div>

                                            <div>
                                                <label style={{ fontWeight: '600', color: '#334155', fontSize: '0.9rem' }}>Statut calendrier</label>
                                                <p style={{ color: selectedEstablishment.google_calendar_id ? '#059669' : '#92400e', marginTop: '6px', fontSize: '1.05rem', fontWeight: '600' }}>
                                                    {selectedEstablishment.google_calendar_id ? 'Connecté' : 'Non connecté'}
                                                </p>
                                            </div>

                                            <div>
                                                <label style={{ fontWeight: '600', color: '#334155', fontSize: '0.9rem' }}>Nombre de chalets</label>
                                                <p style={{ color: '#64748b', marginTop: '6px', fontSize: '1.05rem' }}>
                                                    {chalets.length}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {activeEstablishmentSection === 'payments' && (
                                <div className="guide-section guide-card" style={{
                                    border: '1px solid #e2e8f0',
                                    borderRadius: '12px',
                                    backgroundColor: 'white',
                                    padding: '20px'
                                }}>
                                    <StripeOnboarding
                                        establishment={selectedEstablishment}
                                        onStatusUpdate={(status) => {
                                            // Update the local state with the new Stripe status
                                            setSelectedEstablishment(prev => ({
                                                ...prev,
                                                stripe_charges_enabled: status.chargesEnabled,
                                                stripe_payouts_enabled: status.payoutsEnabled,
                                                stripe_onboarding_complete: status.onboardingComplete,
                                            }));
                                        }}
                                    />
                                </div>
                            )}

                            {activeEstablishmentSection === 'calendar' && (
                                <div className="guide-section guide-card" style={{
                                    border: '1px solid #e2e8f0',
                                    borderRadius: '12px',
                                    backgroundColor: 'white',
                                    padding: '20px'
                                }}>
                                    <h2 className="guide-section-title" style={{ padding: 0 }}>📅 Calendrier de réservations</h2>
                                    <p style={{ color: '#64748b', fontSize: '0.95rem', marginBottom: '16px', marginTop: '8px' }}>
                                        Synchronisez vos réservations avec Google Calendar
                                    </p>
                                    <div className="guide-section-content" style={{ padding: 0 }}>
                                        {googleConnectionSuccess && (
                                            <div style={{
                                                padding: '12px',
                                                backgroundColor: '#d1fae5',
                                                color: '#065f46',
                                                borderRadius: '6px',
                                                marginBottom: '16px',
                                                fontSize: '0.9rem',
                                                border: '1px solid #10b981',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '8px'
                                            }}>
                                                <span>✅</span>
                                                <span>Google Calendar connecté avec succès!</span>
                                            </div>
                                        )}
                                        {selectedEstablishment.google_calendar_id ? (
                                            <div>
                                                <div style={{
                                                    padding: '16px',
                                                    backgroundColor: '#f0fdf4',
                                                    borderRadius: '8px',
                                                    marginBottom: '16px',
                                                    border: '1px solid #86efac'
                                                }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                                                        <span style={{ fontSize: '1.2rem' }}>✅</span>
                                                        <span style={{ color: '#059669', fontWeight: '600' }}>
                                                            Calendrier connecté
                                                        </span>
                                                    </div>
                                                    <p style={{ color: '#64748b', fontSize: '0.95rem', marginLeft: '28px' }}>
                                                        Vos chalets peuvent synchroniser leurs réservations automatiquement.
                                                    </p>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={handleDisconnectGoogleCalendar}
                                                    disabled={isConnectingGoogle}
                                                    style={{
                                                        padding: '10px 20px',
                                                        backgroundColor: '#ef4444',
                                                        color: 'white',
                                                        border: 'none',
                                                        borderRadius: '6px',
                                                        cursor: isConnectingGoogle ? 'not-allowed' : 'pointer',
                                                        fontWeight: '500',
                                                        fontSize: '0.9rem',
                                                        opacity: isConnectingGoogle ? 0.6 : 1
                                                    }}
                                                >
                                                    {isConnectingGoogle ? 'Déconnexion...' : 'Déconnecter le calendrier'}
                                                </button>
                                            </div>
                                        ) : (
                                            <div>
                                                <div style={{
                                                    padding: '16px',
                                                    backgroundColor: '#fef3c7',
                                                    borderRadius: '8px',
                                                    marginBottom: '16px',
                                                    border: '1px solid #fbbf24'
                                                }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                                                        <span style={{ fontSize: '1.2rem' }}>⚠️</span>
                                                        <span style={{ color: '#92400e', fontWeight: '600' }}>
                                                            Calendrier non connecté
                                                        </span>
                                                    </div>
                                                    <p style={{ color: '#92400e', fontSize: '0.95rem', marginLeft: '28px' }}>
                                                        Connectez Google Calendar pour gérer automatiquement les réservations de vos chalets.
                                                    </p>
                                                </div>

                                                {googleConnectionError && (
                                                    <div style={{
                                                        padding: '12px',
                                                        backgroundColor: '#fee2e2',
                                                        color: '#991b1b',
                                                        borderRadius: '6px',
                                                        marginBottom: '16px',
                                                        fontSize: '0.9rem'
                                                    }}>
                                                        {googleConnectionError}
                                                    </div>
                                                )}

                                                <button
                                                    type="button"
                                                    onClick={handleConnectGoogleCalendar}
                                                    disabled={isConnectingGoogle}
                                                    style={{
                                                        padding: '10px 20px',
                                                        backgroundColor: '#3b82f6',
                                                        color: 'white',
                                                        border: 'none',
                                                        borderRadius: '6px',
                                                        cursor: isConnectingGoogle ? 'not-allowed' : 'pointer',
                                                        fontWeight: '500',
                                                        fontSize: '0.9rem',
                                                        opacity: isConnectingGoogle ? 0.6 : 1,
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '8px'
                                                    }}
                                                >
                                                    <span>📅</span>
                                                    <span>{isConnectingGoogle ? 'Connexion...' : 'Connecter mon calendrier'}</span>
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {activeEstablishmentSection === 'chalets' && (
                                <div className="guide-section guide-card" style={{
                                    border: '1px solid #e2e8f0',
                                    borderRadius: '12px',
                                    backgroundColor: 'white',
                                    padding: '20px'
                                }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '16px' }}>
                                    <div>
                                        <h2 className="guide-section-title" style={{ marginBottom: '6px', padding: 0 }}>🏠 Vos chalets</h2>
                                        <p style={{ color: '#64748b', fontSize: '0.95rem', margin: 0 }}>
                                            Les unités de location disponibles pour vos clients
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={handleOpenCreateChalet}
                                        style={{
                                            padding: '10px 18px',
                                            backgroundColor: '#059669',
                                            color: 'white',
                                            border: 'none',
                                            borderRadius: '8px',
                                            cursor: 'pointer',
                                            fontWeight: '600',
                                            fontSize: '0.95rem',
                                            whiteSpace: 'nowrap'
                                        }}
                                    >
                                        + Ajouter un chalet
                                    </button>
                                </div>
                                <div className="guide-section-content" style={{ padding: 0, marginTop: '16px' }}>
                                    {loadingChalets && (
                                        <div style={{ textAlign: 'center', padding: '20px' }}>
                                            <p style={{ color: '#64748b', fontSize: '0.95rem' }}>⏳ Chargement...</p>
                                        </div>
                                    )}

                                    {chaletError && (
                                        <div style={{ padding: '16px', backgroundColor: '#fee2e2', borderRadius: '8px', marginBottom: '12px' }}>
                                            <p style={{ color: '#dc2626', fontSize: '0.95rem', margin: 0 }}>
                                                ⚠️ {chaletError}
                                            </p>
                                        </div>
                                    )}

                                    {!loadingChalets && !chaletError && chalets.length === 0 && (
                                        <div style={{ textAlign: 'center', padding: '30px', backgroundColor: '#f8fafc', borderRadius: '8px' }}>
                                            <div style={{ fontSize: '2.5rem', marginBottom: '12px' }}>🏠</div>
                                            <p style={{ color: '#64748b', fontSize: '1rem', marginBottom: '8px' }}>
                                                Aucun chalet pour le moment
                                            </p>
                                            <p style={{ color: '#94a3b8', fontSize: '0.9rem' }}>
                                                Cliquez sur "Ajouter un chalet" pour commencer
                                            </p>
                                        </div>
                                    )}

                                    {!loadingChalets && !chaletError && chalets.length > 0 && (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                            <div className="etablissement-chalet-filters">
                                                {chaletCategories.map((category) => (
                                                    <button
                                                        key={category}
                                                        type="button"
                                                        onClick={() => setSelectedChaletCategory(category)}
                                                        className={`etablissement-chalet-filter ${selectedChaletCategory === category ? 'active' : ''}`}
                                                    >
                                                        {category === 'all' ? 'Tous' : category}
                                                    </button>
                                                ))}
                                            </div>

                                            <div className="etablissement-chalet-rail">
                                                {filteredChalets.map((chalet, index) => {
                                                    const category = inferChaletCategory(chalet);
                                                    return (
                                                        <div
                                                            key={chalet.id || chalet.key || `chalet-${index}`}
                                                            className="etablissement-chalet-card"
                                                        >
                                                            {chalet.Image && (
                                                                <img
                                                                    src={chalet.Image}
                                                                    alt={chalet.Name}
                                                                    className="etablissement-chalet-image"
                                                                />
                                                            )}

                                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: '8px' }}>
                                                                <h3 style={{
                                                                    fontSize: '1rem',
                                                                    fontWeight: '700',
                                                                    color: '#334155',
                                                                    marginBottom: '8px',
                                                                    marginTop: 0,
                                                                    lineHeight: 1.2
                                                                }}>
                                                                    {chalet.Name || `Chalet ${chalet.id}`}
                                                                </h3>
                                                                <span className="etablissement-chalet-category-chip">{category}</span>
                                                            </div>

                                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '10px' }}>
                                                                {chalet.nb_personnes && (
                                                                    <p style={{ color: '#64748b', fontSize: '0.82rem', margin: 0 }}>
                                                                        <strong>Capacité:</strong> {chalet.nb_personnes} pers.
                                                                    </p>
                                                                )}
                                                                {chalet.price_per_night && (
                                                                    <p style={{ color: '#64748b', fontSize: '0.82rem', margin: 0 }}>
                                                                        <strong>Prix:</strong> {chalet.price_per_night}$ / nuit
                                                                    </p>
                                                                )}
                                                                {chalet.Description && (
                                                                    <p
                                                                        style={{
                                                                            color: '#64748b',
                                                                            fontSize: '0.82rem',
                                                                            margin: 0,
                                                                            display: '-webkit-box',
                                                                            WebkitLineClamp: 2,
                                                                            WebkitBoxOrient: 'vertical',
                                                                            overflow: 'hidden'
                                                                        }}
                                                                    >
                                                                        {chalet.Description}
                                                                    </p>
                                                                )}
                                                            </div>

                                                            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleOpenEditChalet(chalet)}
                                                                    style={{
                                                                        padding: '6px 10px',
                                                                        backgroundColor: '#3b82f6',
                                                                        color: 'white',
                                                                        border: 'none',
                                                                        borderRadius: '4px',
                                                                        cursor: 'pointer',
                                                                        fontSize: '0.78rem',
                                                                        fontWeight: '600'
                                                                    }}
                                                                >
                                                                    Modifier
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleDeleteChalet(chalet.key)}
                                                                    style={{
                                                                        padding: '6px 10px',
                                                                        backgroundColor: '#ef4444',
                                                                        color: 'white',
                                                                        border: 'none',
                                                                        borderRadius: '4px',
                                                                        cursor: 'pointer',
                                                                        fontSize: '0.78rem',
                                                                        fontWeight: '600'
                                                                    }}
                                                                >
                                                                    Supprimer
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleOpenHoraireModal(chalet)}
                                                                    style={{
                                                                        padding: '6px 10px',
                                                                        backgroundColor: '#10b981',
                                                                        color: 'white',
                                                                        border: 'none',
                                                                        borderRadius: '4px',
                                                                        cursor: 'pointer',
                                                                        fontSize: '0.78rem',
                                                                        fontWeight: '600'
                                                                    }}
                                                                >
                                                                    Agenda
                                                                </button>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>

                                            {filteredChalets.length === 0 && (
                                                <p style={{ color: '#64748b', fontSize: '0.9rem', margin: 0 }}>
                                                    Aucun chalet dans la catégorie "{selectedChaletCategory}".
                                                </p>
                                            )}

                                            <p style={{
                                                color: '#059669',
                                                fontSize: '0.9rem',
                                                marginTop: '4px',
                                                fontWeight: 'bold'
                                            }}>
                                                Affichage: {filteredChalets.length} / {chalets.length}
                                            </p>
                                        </div>
                                    )}
                                </div>
                            </div>
                            )}
                        </div>
                    </>
                )}
            </div>

            {/* Chalet Form Modal */}
            {isCreatingChalet && (
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: '#f3f4f6',
                    zIndex: 1000,
                    overflow: 'hidden'
                }}>
                    <div style={{
                        height: '100vh',
                        width: '100vw',
                        display: 'grid',
                        gridTemplateColumns: isCompactChaletForm ? '1fr' : '320px minmax(0, 1fr)',
                        backgroundColor: '#ffffff'
                    }}>
                        <aside style={{
                            background: '#f9fafb',
                            borderRight: isCompactChaletForm ? 'none' : '1px solid #e5e7eb',
                            borderBottom: isCompactChaletForm ? '1px solid #e5e7eb' : 'none',
                            padding: isCompactChaletForm ? '16px 18px' : '24px 22px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '16px'
                        }}>
                            <div style={{ display: 'flex', alignItems: 'start', justifyContent: 'space-between', gap: '10px' }}>
                                <div>
                                    <p style={{ margin: 0, fontSize: '0.78rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>
                                        Configuration
                                    </p>
                                    <h2 style={{ margin: '8px 0 0', fontSize: '1.28rem', color: '#111827', lineHeight: 1.2 }}>
                                        {editingChalet ? 'Modifier le chalet' : 'Nouvelle propriete'}
                                    </h2>
                                </div>
                                <button
                                    type="button"
                                    onClick={handleCloseForm}
                                    aria-label="Fermer la creation du chalet"
                                    style={{
                                        border: 'none',
                                        background: 'transparent',
                                        color: '#111827',
                                        width: '26px',
                                        height: '26px',
                                        cursor: 'pointer',
                                        fontWeight: 700,
                                        lineHeight: 1,
                                        fontSize: '1.5rem',
                                        padding: 0
                                    }}
                                >
                                    ×
                                </button>
                            </div>

                            <div>
                                <p style={{ margin: 0, color: '#4b5563', fontSize: '0.9rem' }}>
                                    Etape {chaletWizardStep + 1} / {CHALET_WIZARD_STEPS.length}
                                </p>
                                <p style={{ margin: '3px 0 0', color: '#111827', fontWeight: 700, fontSize: '0.95rem' }}>
                                    {CHALET_WIZARD_STEPS[chaletWizardStep].label}
                                </p>
                            </div>

                            <div style={{ height: '6px', background: '#e5e7eb', borderRadius: '999px', overflow: 'hidden' }}>
                                <div
                                    style={{
                                        width: `${wizardProgress}%`,
                                        height: '100%',
                                        background: '#111827',
                                        transition: 'width 220ms ease'
                                    }}
                                />
                            </div>

                            <div style={{
                                display: 'grid',
                                gap: '6px',
                                maxHeight: isCompactChaletForm ? '160px' : 'none',
                                overflowY: isCompactChaletForm ? 'auto' : 'visible'
                            }}>
                                {CHALET_WIZARD_STEPS.map((step, index) => (
                                    <button
                                        key={step.key}
                                        type="button"
                                        onClick={() => {
                                            if (index <= chaletWizardStep) {
                                                setChaletWizardStep(index);
                                                setChaletStepErrors({});
                                            }
                                        }}
                                        disabled={index > chaletWizardStep}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '9px',
                                            width: '100%',
                                            border: 'none',
                                            borderRadius: '8px',
                                            padding: '7px 8px',
                                            background: index === chaletWizardStep ? '#111827' : 'transparent',
                                            color: index === chaletWizardStep ? '#ffffff' : index <= chaletWizardStep ? '#111827' : '#9ca3af',
                                            cursor: index <= chaletWizardStep ? 'pointer' : 'not-allowed',
                                            textAlign: 'left'
                                        }}
                                    >
                                        <span style={{
                                            width: '20px',
                                            height: '20px',
                                            borderRadius: '999px',
                                            border: index === chaletWizardStep ? '1px solid #ffffff' : '1px solid #d1d5db',
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            fontSize: '0.74rem',
                                            fontWeight: 700,
                                            flexShrink: 0
                                        }}>
                                            {index + 1}
                                        </span>
                                        <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>{step.label}</span>
                                    </button>
                                ))}
                            </div>

                            {!isCompactChaletForm && (
                                <div style={{
                                    marginTop: 'auto',
                                    border: '1px solid #e5e7eb',
                                    borderRadius: '10px',
                                    padding: '12px',
                                    background: '#ffffff'
                                }}>
                                    <p style={{ margin: 0, color: '#6b7280', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>
                                        Resume rapide
                                    </p>
                                    <p style={{ margin: '8px 0 0', color: '#111827', fontWeight: 700, fontSize: '0.9rem' }}>
                                        {chaletForm.Name || 'Nom a definir'}
                                    </p>
                                    <p style={{ margin: '4px 0 0', color: '#4b5563', fontSize: '0.82rem' }}>
                                        {chaletForm.nb_personnes || '-'} pers. • {chaletForm.price_per_night || '-'} $/nuit
                                    </p>
                                </div>
                            )}
                        </aside>

                        <div style={{
                            minHeight: 0,
                            display: 'flex',
                            flexDirection: 'column',
                            background: '#ffffff'
                        }}>
                        <form onSubmit={handleSubmitChalet} style={{
                            display: 'flex',
                            flexDirection: 'column',
                            minHeight: 0,
                            flex: 1
                        }}>
                            <div style={{
                                padding: isCompactChaletForm ? '18px' : '28px',
                                overflowY: 'auto',
                                minHeight: 0,
                                flex: 1
                            }}>
                            <div key={chaletWizardStep} className="chalet-wizard-step-panel" style={{ transition: 'all 200ms ease' }}>
                                {chaletWizardStep === 0 && (
                                    <ChaletWizardStepPanel
                                        title="Type de propriete"
                                        subtitle="Donnez un nom clair a la propriete. Le type est determine automatiquement a partir du nom/description existants."
                                    >
                                        <div>
                                            <label style={{ display: 'block', fontWeight: '600', color: '#334155', marginBottom: '6px' }}>
                                                Nom du Chalet *
                                            </label>
                                            <input
                                                type="text"
                                                name="Name"
                                                value={chaletForm.Name}
                                                onChange={handleFormChange}
                                                placeholder="Ex: Chalet du Lac"
                                                style={{
                                                    width: '100%',
                                                    padding: '10px',
                                                    borderRadius: '6px',
                                                    border: wizardValidation.errors.Name ? '1px solid #dc2626' : '1px solid #cbd5e1',
                                                    fontSize: '1rem'
                                                }}
                                            />
                                            {wizardValidation.errors.Name && (
                                                <p style={{ margin: '8px 0 0', color: '#b91c1c', fontSize: '0.9rem' }}>{wizardValidation.errors.Name}</p>
                                            )}
                                        </div>
                                        <div style={{
                                            border: '1px solid #d1fae5',
                                            background: '#f0fdf4',
                                            borderRadius: '10px',
                                            padding: '12px'
                                        }}>
                                            <p style={{ margin: 0, color: '#065f46', fontSize: '0.9rem', fontWeight: 600 }}>
                                                Type detecte: {getActivePropertyType()}
                                            </p>
                                        </div>
                                    </ChaletWizardStepPanel>
                                )}

                                {chaletWizardStep === 1 && (
                                    <ChaletWizardStepPanel
                                        title="Localisation"
                                        subtitle="Tapez votre adresse pour voir des suggestions instantanees, puis selectionnez le resultat."
                                    >
                                        <div>
                                            <label style={{ display: 'block', fontWeight: '600', color: '#334155', marginBottom: '6px' }}>
                                                Adresse du chalet
                                            </label>
                                            <input
                                                type="text"
                                                value={locationAddress}
                                                onChange={(e) => {
                                                    setLocationAddress(e.target.value);
                                                    setLocationLookupSuccess(null);
                                                }}
                                                placeholder="ex: 235 rue Bacon, QC"
                                                style={{
                                                    width: '100%',
                                                    padding: '10px',
                                                    borderRadius: '6px',
                                                    border: '1px solid #cbd5e1',
                                                    fontSize: '1rem',
                                                    color: '#111827',
                                                    boxSizing: 'border-box'
                                                }}
                                            />

                                            {isSearchingLocation && (
                                                <p style={{ marginTop: '8px', marginBottom: 0, color: '#475569', fontSize: '0.9rem' }}>
                                                    Recherche d'adresses...
                                                </p>
                                            )}

                                            {!isSearchingLocation && locationAddress.trim().length >= 3 && locationSuggestions.length > 0 && (
                                                <div style={{
                                                    marginTop: '10px',
                                                    border: '1px solid #cbd5e1',
                                                    borderRadius: '8px',
                                                    overflow: 'hidden',
                                                    maxHeight: '220px',
                                                    overflowY: 'auto'
                                                }}>
                                                    {locationSuggestions.map((suggestion, index) => (
                                                        <button
                                                            key={`${suggestion.latitude}-${suggestion.longitude}-${index}`}
                                                            type="button"
                                                            onClick={() => handleSelectAddressSuggestion(suggestion)}
                                                            style={{
                                                                width: '100%',
                                                                textAlign: 'left',
                                                                padding: '10px 12px',
                                                                border: 'none',
                                                                borderBottom: index === locationSuggestions.length - 1 ? 'none' : '1px solid #e2e8f0',
                                                                background: '#ffffff',
                                                                color: '#111827',
                                                                cursor: 'pointer',
                                                                fontSize: '0.92rem',
                                                                lineHeight: 1.35
                                                            }}
                                                        >
                                                            {suggestion.displayName}
                                                        </button>
                                                    ))}
                                                </div>
                                            )}

                                            {!isSearchingLocation && locationAddress.trim().length >= 3 && locationSuggestions.length === 0 && !locationLookupError && (
                                                <p style={{ marginTop: '8px', marginBottom: 0, color: '#64748b', fontSize: '0.9rem' }}>
                                                    Aucune suggestion trouvee pour cette saisie.
                                                </p>
                                            )}

                                            <div style={{ display: 'flex', gap: '10px', marginTop: '10px', flexWrap: 'wrap' }}>
                                                <button
                                                    type="button"
                                                    onClick={handleStartMapLocationPick}
                                                    style={{
                                                        padding: '9px 14px',
                                                        borderRadius: '6px',
                                                        border: '1px solid #1d4ed8',
                                                        background: '#dbeafe',
                                                        color: '#1e3a8a',
                                                        fontWeight: '600',
                                                        cursor: 'pointer'
                                                    }}
                                                >
                                                    Choisir sur la carte
                                                </button>
                                            </div>
                                            {locationLookupError && (
                                                <p style={{ marginTop: '8px', marginBottom: 0, color: '#b91c1c', fontSize: '0.9rem' }}>
                                                    {locationLookupError}
                                                </p>
                                            )}
                                            {locationLookupSuccess && (
                                                <p style={{ marginTop: '8px', marginBottom: 0, color: '#0f766e', fontSize: '0.9rem' }}>
                                                    {locationLookupSuccess}
                                                </p>
                                            )}
                                        </div>

                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px' }}>
                                            <div>
                                                <label style={{ display: 'block', fontWeight: '600', color: '#334155', marginBottom: '6px' }}>Latitude</label>
                                                <input
                                                    type="text"
                                                    name="latitude"
                                                    value={chaletForm.latitude}
                                                    readOnly
                                                    placeholder="Detectee automatiquement"
                                                    style={{
                                                        width: '100%',
                                                        padding: '10px',
                                                        borderRadius: '6px',
                                                        border: wizardValidation.errors.location ? '1px solid #dc2626' : '1px solid #cbd5e1',
                                                        fontSize: '1rem',
                                                        background: '#f1f5f9',
                                                        color: '#111827',
                                                        fontWeight: 600,
                                                        boxSizing: 'border-box',
                                                        minWidth: 0
                                                    }}
                                                />
                                            </div>
                                            <div>
                                                <label style={{ display: 'block', fontWeight: '600', color: '#334155', marginBottom: '6px' }}>Longitude</label>
                                                <input
                                                    type="text"
                                                    name="longitude"
                                                    value={chaletForm.longitude}
                                                    readOnly
                                                    placeholder="Detectee automatiquement"
                                                    style={{
                                                        width: '100%',
                                                        padding: '10px',
                                                        borderRadius: '6px',
                                                        border: wizardValidation.errors.location ? '1px solid #dc2626' : '1px solid #cbd5e1',
                                                        fontSize: '1rem',
                                                        background: '#f1f5f9',
                                                        color: '#111827',
                                                        fontWeight: 600,
                                                        boxSizing: 'border-box',
                                                        minWidth: 0
                                                    }}
                                                />
                                            </div>
                                        </div>
                                        {wizardValidation.errors.location && (
                                            <p style={{ margin: '2px 0 0', color: '#b91c1c', fontSize: '0.9rem' }}>{wizardValidation.errors.location}</p>
                                        )}
                                    </ChaletWizardStepPanel>
                                )}

                                {chaletWizardStep === 2 && (
                                    <ChaletWizardStepPanel
                                        title="Infos de base"
                                        subtitle="Capacite de votre propriete (equivalent section guests/rooms/beds avec les champs disponibles)."
                                    >
                                        <div>
                                            <label style={{ display: 'block', fontWeight: '600', color: '#334155', marginBottom: '6px' }}>
                                                Nombre de personnes *
                                            </label>
                                            <input
                                                type="number"
                                                name="nb_personnes"
                                                value={chaletForm.nb_personnes}
                                                onChange={handleFormChange}
                                                min="1"
                                                style={{
                                                    width: '100%',
                                                    padding: '10px',
                                                    borderRadius: '6px',
                                                    border: wizardValidation.errors.nb_personnes ? '1px solid #dc2626' : '1px solid #cbd5e1',
                                                    fontSize: '1rem'
                                                }}
                                            />
                                            {wizardValidation.errors.nb_personnes && (
                                                <p style={{ margin: '8px 0 0', color: '#b91c1c', fontSize: '0.9rem' }}>{wizardValidation.errors.nb_personnes}</p>
                                            )}
                                        </div>
                                    </ChaletWizardStepPanel>
                                )}

                                {chaletWizardStep === 3 && (
                                    <ChaletWizardStepPanel
                                        title="Commodites"
                                        subtitle="Selectionnez des commodites predefinies, puis ajoutez une description complementaire si necessaire."
                                    >
                                        <div>
                                            <label style={{ display: 'block', fontWeight: '600', color: '#334155', marginBottom: '8px' }}>
                                                Commodites predefinies
                                            </label>
                                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '10px' }}>
                                                {PREDEFINED_AMENITIES.map((amenity) => {
                                                    const isSelected = selectedAmenities.includes(amenity.id);
                                                    return (
                                                        <button
                                                            key={amenity.id}
                                                            type="button"
                                                            onClick={() => handleToggleAmenity(amenity.id)}
                                                            style={{
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                gap: '8px',
                                                                borderRadius: '12px',
                                                                border: isSelected ? '1px solid #111827' : '1px solid #d1d5db',
                                                                background: isSelected ? '#111827' : '#ffffff',
                                                                color: isSelected ? '#ffffff' : '#111827',
                                                                padding: '10px 12px',
                                                                fontWeight: 600,
                                                                cursor: 'pointer',
                                                                textAlign: 'left',
                                                                transition: 'all 180ms ease'
                                                            }}
                                                        >
                                                            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                                                                <AmenityIcon amenityId={amenity.id} size={18} />
                                                            </span>
                                                            <span style={{ fontSize: '0.9rem', lineHeight: 1.2 }}>{amenity.label}</span>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>

                                        <div>
                                            <label style={{ display: 'block', fontWeight: '600', color: '#334155', marginBottom: '6px' }}>
                                                Description complementaire
                                            </label>
                                            <textarea
                                                name="Description"
                                                value={chaletForm.Description}
                                                onChange={handleFormChange}
                                                rows="5"
                                                placeholder="Ex: Ambiance chaleureuse, terrasse orientee plein sud, ideal pour familles..."
                                                style={{
                                                    width: '100%',
                                                    padding: '10px',
                                                    borderRadius: '6px',
                                                    border: wizardValidation.errors.Description ? '1px solid #dc2626' : '1px solid #cbd5e1',
                                                    fontSize: '1rem',
                                                    resize: 'vertical'
                                                }}
                                            />
                                            {wizardValidation.errors.Description && (
                                                <p style={{ margin: '8px 0 0', color: '#b91c1c', fontSize: '0.9rem' }}>{wizardValidation.errors.Description}</p>
                                            )}
                                        </div>

                                        {(selectedAmenities.length > 0 || chaletForm.Description.trim()) && (
                                            <div style={{
                                                borderRadius: '10px',
                                                border: '1px solid #bae6fd',
                                                background: '#f0f9ff',
                                                padding: '12px'
                                            }}>
                                                <p style={{ margin: '0 0 8px', color: '#0c4a6e', fontWeight: 700, fontSize: '0.88rem' }}>
                                                    Apercu du texte final
                                                </p>
                                                <p style={{ margin: 0, color: '#334155', fontSize: '0.9rem', whiteSpace: 'pre-wrap' }}>
                                                    {generatedAmenitiesDescription}
                                                </p>
                                            </div>
                                        )}
                                    </ChaletWizardStepPanel>
                                )}

                                {chaletWizardStep === 4 && (
                                    <ChaletWizardStepPanel
                                        title="Photos"
                                        subtitle="Glissez vos photos ici ou cliquez pour importer. Vous pouvez ensuite les reordonner."
                                    >
                                        {orderedImageItems.length > 0 && (
                                            <DndContext
                                                sensors={dragSensors}
                                                collisionDetection={closestCenter}
                                                onDragStart={handlePhotoDragStart}
                                                onDragEnd={handlePhotoDragEnd}
                                                onDragCancel={() => setDraggingImageId(null)}
                                            >
                                                <SortableContext items={imageOrder} strategy={rectSortingStrategy}>
                                                    <div
                                                        style={{
                                                            display: 'grid',
                                                            gridTemplateColumns: 'repeat(auto-fill, minmax(min(120px, 100%), 1fr))',
                                                            gap: '10px',
                                                            width: '100%',
                                                            maxWidth: '100%',
                                                            boxSizing: 'border-box'
                                                        }}
                                                    >
                                                        {orderedImageItems.map((item, index) => {
                                                            const imageSrc = item.kind === 'existing'
                                                                ? item.image.image_url
                                                                : previewUrlMap[item.id];

                                                            return (
                                                                <SortablePhotoCard key={item.id} id={item.id}>
                                                                    <div style={{ position: 'relative', border: '2px solid #111827', borderRadius: '8px', overflow: 'hidden', background: '#fff' }}>
                                                                        <img
                                                                            src={imageSrc}
                                                                            alt={`Image ${index + 1}`}
                                                                            style={{ width: '100%', height: '120px', objectFit: 'cover', display: 'block' }}
                                                                        />
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => {
                                                                                if (item.kind === 'existing') {
                                                                                    handleRemoveExistingImage(item.image.id);
                                                                                } else {
                                                                                    handleRemoveNewImage(item.id);
                                                                                }
                                                                            }}
                                                                            aria-label={`Supprimer l'image ${index + 1}`}
                                                                            style={{
                                                                                position: 'absolute',
                                                                                top: '6px',
                                                                                right: '6px',
                                                                                background: 'transparent',
                                                                                color: '#111827',
                                                                                border: 'none',
                                                                                width: '22px',
                                                                                height: '22px',
                                                                                cursor: 'pointer',
                                                                                fontSize: '1.1rem',
                                                                                fontWeight: 700,
                                                                                lineHeight: 1,
                                                                                padding: 0
                                                                            }}
                                                                        >
                                                                            ×
                                                                        </button>
                                                                    </div>
                                                                </SortablePhotoCard>
                                                            );
                                                        })}
                                                    </div>
                                                </SortableContext>

                                                <DragOverlay>
                                                    {activeImage && (
                                                        <div style={{ width: 140, border: '2px solid #111827', borderRadius: '8px', overflow: 'hidden', boxShadow: '0 18px 32px rgba(15, 23, 42, 0.3)' }}>
                                                            <img
                                                                src={activeImage.kind === 'existing' ? activeImage.image.image_url : previewUrlMap[activeImage.id]}
                                                                alt="Apercu image glissee"
                                                                style={{ width: '100%', height: '120px', objectFit: 'cover', display: 'block' }}
                                                            />
                                                        </div>
                                                    )}
                                                </DragOverlay>
                                            </DndContext>
                                        )}

                                        <div
                                            onClick={() => fileInputRef.current?.click()}
                                            onDragEnter={handleFileDragEnter}
                                            onDragOver={handleFileDragOver}
                                            onDragLeave={handleFileDragLeave}
                                            onDrop={handleFileDrop}
                                            style={{
                                                width: '100%',
                                                maxWidth: '100%',
                                                minWidth: 0,
                                                boxSizing: 'border-box',
                                                borderRadius: '16px',
                                                border: wizardValidation.errors.images
                                                    ? '2px dashed #dc2626'
                                                    : isDraggingFiles
                                                        ? '2px dashed #111827'
                                                        : '2px dashed #9ca3af',
                                                background: isDraggingFiles ? '#f3f4f6' : '#f9fafb',
                                                padding: '26px 18px',
                                                cursor: 'pointer',
                                                textAlign: 'center',
                                                transition: 'all 180ms ease'
                                            }}
                                        >
                                            <div style={{ color: '#111827', marginBottom: '8px', display: 'inline-flex' }}>
                                                <UploadIcon size={32} />
                                            </div>
                                            <p style={{ margin: 0, color: '#111827', fontSize: '0.95rem', fontWeight: 700 }}>
                                                {isDraggingFiles ? 'Deposez vos images ici' : 'Glissez-deposez vos images'}
                                            </p>
                                            <p style={{ margin: '6px 0 0', color: '#4b5563', fontSize: '0.88rem' }}>
                                                ou cliquez pour selectionner des fichiers
                                            </p>
                                            <p style={{ margin: '10px 0 0', color: '#9ca3af', fontSize: '0.8rem' }}>
                                                PNG, JPG, WEBP
                                            </p>
                                            <input
                                                ref={fileInputRef}
                                                type="file"
                                                accept="image/*"
                                                multiple
                                                onChange={handleImageChange}
                                                style={{ display: 'none' }}
                                            />
                                        </div>
                                        {wizardValidation.errors.images && (
                                            <p style={{ margin: '8px 0 0', color: '#b91c1c', fontSize: '0.9rem' }}>{wizardValidation.errors.images}</p>
                                        )}
                                    </ChaletWizardStepPanel>
                                )}

                                {chaletWizardStep === 5 && (
                                    <ChaletWizardStepPanel
                                        title="Tarification"
                                        subtitle="Definissez le prix de base par nuit."
                                    >
                                        <div>
                                            <label style={{ display: 'block', fontWeight: '600', color: '#334155', marginBottom: '6px' }}>
                                                Prix par nuit ($) *
                                            </label>
                                            <input
                                                type="number"
                                                name="price_per_night"
                                                value={chaletForm.price_per_night}
                                                onChange={handleFormChange}
                                                min="0"
                                                step="0.01"
                                                style={{
                                                    width: '100%',
                                                    padding: '10px',
                                                    borderRadius: '6px',
                                                    border: wizardValidation.errors.price_per_night ? '1px solid #dc2626' : '1px solid #cbd5e1',
                                                    fontSize: '1rem'
                                                }}
                                            />
                                            {wizardValidation.errors.price_per_night && (
                                                <p style={{ margin: '8px 0 0', color: '#b91c1c', fontSize: '0.9rem' }}>{wizardValidation.errors.price_per_night}</p>
                                            )}
                                        </div>
                                    </ChaletWizardStepPanel>
                                )}

                                {chaletWizardStep === 6 && (
                                    <ChaletWizardStepPanel
                                        title="Verification finale"
                                        subtitle="Revisez toutes les sections avant enregistrement."
                                    >
                                        <div style={{ display: 'grid', gap: '10px' }}>
                                            <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px' }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                    <strong>1. Type de propriete</strong>
                                                    <button type="button" onClick={() => setChaletWizardStep(0)} style={{ border: 'none', background: 'transparent', color: '#0f766e', cursor: 'pointer', fontWeight: 600 }}>Modifier</button>
                                                </div>
                                                <p style={{ margin: '8px 0 0', color: '#475569' }}>{chaletForm.Name || 'Non renseigne'} • {getActivePropertyType()}</p>
                                            </div>

                                            <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px' }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                    <strong>2. Localisation</strong>
                                                    <button type="button" onClick={() => setChaletWizardStep(1)} style={{ border: 'none', background: 'transparent', color: '#0f766e', cursor: 'pointer', fontWeight: 600 }}>Modifier</button>
                                                </div>
                                                <p style={{ margin: '8px 0 0', color: '#475569' }}>Lat: {chaletForm.latitude || '-'} • Lon: {chaletForm.longitude || '-'}</p>
                                            </div>

                                            <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px' }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                    <strong>3. Infos de base</strong>
                                                    <button type="button" onClick={() => setChaletWizardStep(2)} style={{ border: 'none', background: 'transparent', color: '#0f766e', cursor: 'pointer', fontWeight: 600 }}>Modifier</button>
                                                </div>
                                                <p style={{ margin: '8px 0 0', color: '#475569' }}>Capacite: {chaletForm.nb_personnes || '-'} personnes</p>
                                            </div>

                                            <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px' }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                    <strong>4. Commodites</strong>
                                                    <button type="button" onClick={() => setChaletWizardStep(3)} style={{ border: 'none', background: 'transparent', color: '#0f766e', cursor: 'pointer', fontWeight: 600 }}>Modifier</button>
                                                </div>
                                                <p style={{ margin: '8px 0 0', color: '#475569', whiteSpace: 'pre-wrap' }}>{generatedAmenitiesDescription || 'Non renseigne'}</p>
                                            </div>

                                            <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px' }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                    <strong>5. Photos</strong>
                                                    <button type="button" onClick={() => setChaletWizardStep(4)} style={{ border: 'none', background: 'transparent', color: '#0f766e', cursor: 'pointer', fontWeight: 600 }}>Modifier</button>
                                                </div>
                                                <p style={{ margin: '8px 0 0', color: '#475569' }}>{existingImages.length + imageFiles.length + (chaletForm.Image ? 1 : 0)} image(s)</p>
                                            </div>

                                            <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px' }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                    <strong>6. Tarification</strong>
                                                    <button type="button" onClick={() => setChaletWizardStep(5)} style={{ border: 'none', background: 'transparent', color: '#0f766e', cursor: 'pointer', fontWeight: 600 }}>Modifier</button>
                                                </div>
                                                <p style={{ margin: '8px 0 0', color: '#475569' }}>{chaletForm.price_per_night || '-'} $ / nuit</p>
                                            </div>
                                        </div>
                                    </ChaletWizardStepPanel>
                                )}

                                {chaletError && (
                                    <p style={{ color: '#ef4444', fontSize: '0.9rem', marginTop: '14px' }}>{chaletError}</p>
                                )}
                                {Object.keys(chaletStepErrors).length > 0 && (
                                    <p style={{ color: '#b91c1c', fontSize: '0.86rem', marginTop: '8px' }}>
                                        Certains champs requis sont manquants pour cette etape.
                                    </p>
                                )}

                                <div style={{ display: 'flex', gap: '12px', marginTop: '24px', justifyContent: 'space-between' }}>
                                    <div style={{ display: 'flex', gap: '10px' }}>
                                        <button
                                            type="button"
                                            onClick={handleCloseForm}
                                            disabled={uploadingImages || loadingChalets}
                                            style={{
                                                padding: '10px 18px',
                                                backgroundColor: '#f1f5f9',
                                                color: '#334155',
                                                border: 'none',
                                                borderRadius: '6px',
                                                cursor: uploadingImages || loadingChalets ? 'not-allowed' : 'pointer',
                                                fontWeight: '600',
                                                opacity: uploadingImages || loadingChalets ? 0.6 : 1
                                            }}
                                        >
                                            Annuler
                                        </button>
                                        {chaletWizardStep > 0 && (
                                            <button
                                                type="button"
                                                onClick={handleWizardBack}
                                                disabled={uploadingImages || loadingChalets}
                                                style={{
                                                    padding: '10px 18px',
                                                    backgroundColor: '#e2e8f0',
                                                    color: '#334155',
                                                    border: 'none',
                                                    borderRadius: '6px',
                                                    cursor: uploadingImages || loadingChalets ? 'not-allowed' : 'pointer',
                                                    fontWeight: '600',
                                                    opacity: uploadingImages || loadingChalets ? 0.6 : 1
                                                }}
                                            >
                                                Retour
                                            </button>
                                        )}
                                    </div>

                                    {chaletWizardStep < CHALET_WIZARD_STEPS.length - 1 ? (
                                        <button
                                            type="button"
                                            onClick={handleWizardNext}
                                            disabled={!wizardValidation.isValid || uploadingImages || loadingChalets}
                                            style={{
                                                padding: '10px 20px',
                                                backgroundColor: '#059669',
                                                color: 'white',
                                                border: 'none',
                                                borderRadius: '6px',
                                                cursor: (!wizardValidation.isValid || uploadingImages || loadingChalets) ? 'not-allowed' : 'pointer',
                                                fontWeight: '600',
                                                opacity: (!wizardValidation.isValid || uploadingImages || loadingChalets) ? 0.6 : 1
                                            }}
                                        >
                                            Suivant
                                        </button>
                                    ) : (
                                        <button
                                            type="submit"
                                            disabled={uploadingImages || loadingChalets}
                                            style={{
                                                padding: '10px 20px',
                                                backgroundColor: '#059669',
                                                color: 'white',
                                                border: 'none',
                                                borderRadius: '6px',
                                                cursor: uploadingImages || loadingChalets ? 'not-allowed' : 'pointer',
                                                fontWeight: '600',
                                                opacity: uploadingImages || loadingChalets ? 0.6 : 1
                                            }}
                                        >
                                            {uploadingImages ? 'Telechargement des photos...' : loadingChalets ? (chaletCreationStep || 'Enregistrement...') : 'Enregistrer et creer l\'agenda'}
                                        </button>
                                    )}
                                </div>
                            </div>
                            </div>
                        </form>
                        </div>
                    </div>
                </div>
            )}

            {/* Establishment Creation Modal */}
            {isCreatingEstablishment && (
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: 'rgba(0, 0, 0, 0.5)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 1000
                }}>
                    <div style={{
                        backgroundColor: 'white',
                        borderRadius: '12px',
                        padding: '32px',
                        maxWidth: '550px',
                        width: '90%',
                        maxHeight: '90vh',
                        overflowY: 'auto',
                        boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)'
                    }}>
                        <div style={{ marginBottom: '24px' }}>
                            <h2 style={{ 
                                fontSize: '1.6rem', 
                                fontWeight: 'bold', 
                                color: '#334155',
                                marginBottom: '8px'
                            }}>
                                🏕️ {editingEstablishment ? 'Modifier le lieu' : 'Ajouter un lieu'}
                            </h2>
                            <p style={{ color: '#64748b', fontSize: '0.95rem', margin: 0 }}>
                                {editingEstablishment 
                                    ? 'Mettez à jour les informations de votre établissement'
                                    : 'Créez un nouvel établissement pour gérer vos chalets et réservations'
                                }
                            </p>
                        </div>

                        <form onSubmit={handleSubmitEstablishment}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                                {/* Name */}
                                <div>
                                    <label style={{ 
                                        display: 'block',
                                        fontWeight: '600',
                                        color: '#334155',
                                        marginBottom: '8px',
                                        fontSize: '0.95rem'
                                    }}>
                                        Nom du lieu <span style={{ color: '#dc2626' }}>*</span>
                                    </label>
                                    <input
                                        type="text"
                                        name="name"
                                        value={establishmentForm.name}
                                        onChange={handleEstablishmentFormChange}
                                        required
                                        placeholder="Ex: Pourvoirie du Lac Bleu"
                                        style={{
                                            width: '100%',
                                            padding: '12px',
                                            borderRadius: '8px',
                                            border: '2px solid #e2e8f0',
                                            fontSize: '1rem',
                                            transition: 'border-color 0.2s'
                                        }}
                                        onFocus={(e) => e.target.style.borderColor = '#059669'}
                                        onBlur={(e) => e.target.style.borderColor = '#e2e8f0'}
                                    />
                                    <p style={{ fontSize: '0.85rem', color: '#64748b', marginTop: '6px', margin: 0 }}>
                                        Le nom que vos clients verront
                                    </p>
                                </div>

                                {/* Address */}
                                <div>
                                    <label style={{ 
                                        display: 'block',
                                        fontWeight: '600',
                                        color: '#334155',
                                        marginBottom: '8px',
                                        fontSize: '0.95rem'
                                    }}>
                                        Description / Adresse
                                    </label>
                                    <textarea
                                        name="adresse"
                                        value={establishmentForm.adresse}
                                        onChange={handleEstablishmentFormChange}
                                        placeholder="Ex: 123 Chemin du Lac, Ville, Province"
                                        rows="3"
                                        style={{
                                            width: '100%',
                                            padding: '12px',
                                            borderRadius: '8px',
                                            border: '2px solid #e2e8f0',
                                            fontSize: '1rem',
                                            resize: 'vertical'
                                        }}
                                        onFocus={(e) => e.target.style.borderColor = '#059669'}
                                        onBlur={(e) => e.target.style.borderColor = '#e2e8f0'}
                                    />
                                    <p style={{ fontSize: '0.85rem', color: '#64748b', marginTop: '6px', margin: 0 }}>
                                        Ajoutez des détails sur votre établissement
                                    </p>
                                </div>

                                {/* Telephone */}
                                <div>
                                    <label style={{ 
                                        display: 'block',
                                        fontWeight: '600',
                                        color: '#334155',
                                        marginBottom: '8px',
                                        fontSize: '0.95rem'
                                    }}>
                                        Téléphone
                                    </label>
                                    <input
                                        type="tel"
                                        name="telephone"
                                        value={establishmentForm.telephone}
                                        onChange={handleEstablishmentFormChange}
                                        placeholder="Ex: (418) 555-1234"
                                        style={{
                                            width: '100%',
                                            padding: '12px',
                                            borderRadius: '8px',
                                            border: '2px solid #e2e8f0',
                                            fontSize: '1rem'
                                        }}
                                        onFocus={(e) => e.target.style.borderColor = '#059669'}
                                        onBlur={(e) => e.target.style.borderColor = '#e2e8f0'}
                                    />
                                </div>

                                {/* Email */}
                                <div>
                                    <label style={{ 
                                        display: 'block',
                                        fontWeight: '600',
                                        color: '#334155',
                                        marginBottom: '8px',
                                        fontSize: '0.95rem'
                                    }}>
                                        Courriel
                                    </label>
                                    <input
                                        type="email"
                                        name="email"
                                        value={establishmentForm.email}
                                        onChange={handleEstablishmentFormChange}
                                        placeholder="Ex: contact@pourvoirie.com"
                                        style={{
                                            width: '100%',
                                            padding: '12px',
                                            borderRadius: '8px',
                                            border: '2px solid #e2e8f0',
                                            fontSize: '1rem'
                                        }}
                                        onFocus={(e) => e.target.style.borderColor = '#059669'}
                                        onBlur={(e) => e.target.style.borderColor = '#e2e8f0'}
                                    />
                                </div>

                                {/* Error message */}
                                {establishmentError && (
                                    <div style={{
                                        padding: '12px',
                                        backgroundColor: '#fee2e2',
                                        color: '#dc2626',
                                        borderRadius: '8px',
                                        fontSize: '0.9rem',
                                        border: '1px solid #fecaca'
                                    }}>
                                        ⚠️ {establishmentError}
                                    </div>
                                )}

                                {/* Buttons */}
                                <div style={{ 
                                    display: 'flex', 
                                    gap: '12px', 
                                    marginTop: '8px',
                                    justifyContent: 'flex-end' 
                                }}>
                                    <button
                                        type="button"
                                        onClick={handleCloseEstablishmentForm}
                                        disabled={savingEstablishment}
                                        style={{
                                            padding: '12px 24px',
                                            backgroundColor: '#f1f5f9',
                                            color: '#475569',
                                            border: '1px solid #cbd5e1',
                                            borderRadius: '8px',
                                            cursor: savingEstablishment ? 'not-allowed' : 'pointer',
                                            fontWeight: '600',
                                            fontSize: '0.95rem',
                                            opacity: savingEstablishment ? 0.6 : 1
                                        }}
                                    >
                                        Annuler
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={savingEstablishment}
                                        style={{
                                            padding: '12px 24px',
                                            backgroundColor: '#059669',
                                            color: 'white',
                                            border: 'none',
                                            borderRadius: '8px',
                                            cursor: savingEstablishment ? 'not-allowed' : 'pointer',
                                            fontWeight: '600',
                                            fontSize: '0.95rem',
                                            opacity: savingEstablishment ? 0.6 : 1
                                        }}
                                    >
                                        {savingEstablishment 
                                            ? '💾 Enregistrement...' 
                                            : editingEstablishment 
                                                ? '✅ Enregistrer les modifications' 
                                                : '✅ Créer ce lieu'
                                        }
                                    </button>
                                </div>
                            </div>
                        </form>
                    </div>
                </div>
            )}
            
            {/* Google Calendar Connection Required Modal */}
            {showGoogleConnectModal && (
                <div
                    style={{
                        position: 'fixed',
                        inset: 0,
                        backgroundColor: 'rgba(0,0,0,0.55)',
                        zIndex: 9999,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '16px'
                    }}
                    onClick={() => setShowGoogleConnectModal(false)}
                >
                    <div
                        style={{
                            background: '#fff',
                            borderRadius: '16px',
                            padding: '32px',
                            maxWidth: '440px',
                            width: '100%',
                            boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '20px'
                        }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <div style={{
                                width: '44px',
                                height: '44px',
                                borderRadius: '12px',
                                background: '#fef3c7',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '22px',
                                flexShrink: 0
                            }}>📅</div>
                            <div>
                                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: '#1e293b' }}>
                                    Google Calendar requis
                                </h3>
                                <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: '#64748b' }}>
                                    Connexion necessaire pour creer un chalet
                                </p>
                            </div>
                        </div>
                        <p style={{ margin: 0, color: '#374151', fontSize: '0.95rem', lineHeight: 1.6 }}>
                            Google Calendar doit etre connecte avant de creer un chalet. Un agenda sera automatiquement cree pour gerer les reservations.
                        </p>
                        <p style={{ margin: 0, color: '#6b7280', fontSize: '0.88rem', lineHeight: 1.5, background: '#f8fafc', borderRadius: '8px', padding: '10px 14px', border: '1px solid #e2e8f0' }}>
                            La creation du chalet reprendra automatiquement une fois Google Calendar connecte et l'agenda cree.
                        </p>
                        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                            <button
                                type="button"
                                onClick={() => setShowGoogleConnectModal(false)}
                                style={{
                                    padding: '10px 20px',
                                    borderRadius: '8px',
                                    border: '1px solid #e2e8f0',
                                    background: '#fff',
                                    color: '#374151',
                                    fontWeight: 600,
                                    fontSize: '0.9rem',
                                    cursor: 'pointer'
                                }}
                            >
                                Annuler
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setShowGoogleConnectModal(false);
                                    setActiveEstablishmentSection('calendar');
                                    handleConnectGoogleCalendar();
                                }}
                                style={{
                                    padding: '10px 20px',
                                    borderRadius: '8px',
                                    border: 'none',
                                    background: '#059669',
                                    color: '#fff',
                                    fontWeight: 600,
                                    fontSize: '0.9rem',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px'
                                }}
                            >
                                <span>📅</span>
                                <span>Connecter Google Calendar</span>
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Chalet Horaire Modal */}
            <ChaletHoraireModal
                isOpen={isHoraireModalOpen}
                onClose={handleCloseHoraireModal}
                chalet={selectedChaletForHoraire}
            />
        </div>
    );
};

export default EtablissementModal;