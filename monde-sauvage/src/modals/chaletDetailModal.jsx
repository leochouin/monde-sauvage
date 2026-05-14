import { useState, useEffect } from 'react';
import supabase from '../utils/supabase.js';
import DateRangePicker from '../components/DateRangePicker.jsx';
import Lightbox from '../components/Lightbox.jsx';

const ChaletDetailModal = ({ isOpen, onClose, chalet }) => {
    const [chaletData, setChaletData] = useState(null);
    const [images, setImages] = useState([]);
    const [loading, setLoading] = useState(false);
    const [blockedDates, setBlockedDates] = useState([]);
    const [lightboxIndex, setLightboxIndex] = useState(null);

    useEffect(() => {
        if (isOpen && chalet) {
            loadChaletDetails();
            loadBlockedDates();
            setLightboxIndex(null);
        }
    }, [isOpen, chalet]);

    const parseLegacyImageField = (value) => {
        if (!value) return [];
        if (Array.isArray(value)) return value.filter(Boolean).map(String);

        const raw = String(value).trim();
        if (!raw) return [];

        if (raw.startsWith('[') && raw.endsWith(']')) {
            try {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                    return parsed.filter(Boolean).map((item) => String(item).trim()).filter(Boolean);
                }
            } catch {
                // Fall through to CSV-like parsing.
            }
        }

        if (raw.includes(',')) {
            return raw
                .split(',')
                .map((item) => item.trim())
                .filter(Boolean);
        }

        return [raw];
    };

    const loadBlockedDates = async () => {
        try {
            const chaletId = chalet?.key || chalet?.id;
            if (!chaletId) {
                setBlockedDates([]);
                return;
            }

            // Fetch all bookings for this chalet
            const { data: bookings, error } = await supabase
                .from('bookings')
                .select('start_date, end_date, status')
                .eq('chalet_id', chaletId)
                .in('status', ['confirmed', 'pending', 'blocked']);

            if (error) {
                console.error('Error fetching bookings:', error);
                return;
            }

            // Convert bookings to blocked date ranges
            // Exclude the end_date since checkout day is available for new check-ins
            const blocked = (bookings || []).map(booking => ({
                start: booking.start_date,
                end: booking.end_date
            }));

            console.log('Blocked dates loaded:', blocked);
            setBlockedDates(blocked);
        } catch (error) {
            console.error('Error loading blocked dates:', error);
        }
    };

    const loadChaletDetails = async () => {
        setLoading(true);
        try {
            // For now, use the chalet data passed in
            // In the future, you could fetch more detailed data from Supabase
            setChaletData(chalet);
            const fallbackMainImage = parseLegacyImageField(chalet?.Image);

            // Match Etablissement flow: chalet_images uses chalet key.
            // If key is missing in this context, resolve it from chalets.
            let resolvedChaletKey = chalet?.key ?? null;
            if (!resolvedChaletKey && chalet?.id) {
                resolvedChaletKey = chalet.id;
            }

            if (!resolvedChaletKey && (chalet?.Name || chalet?.name)) {
                const chaletName = chalet?.Name || chalet?.name;
                let keyLookupQuery = supabase
                    .from('chalets')
                    .select('key')
                    .eq('Name', chaletName)
                    .limit(1);

                if (chalet?.etablishment_id) {
                    keyLookupQuery = keyLookupQuery.eq('etablishment_id', chalet.etablishment_id);
                }

                const { data: keyLookupData, error: keyLookupError } = await keyLookupQuery;
                if (!keyLookupError && keyLookupData && keyLookupData.length > 0) {
                    resolvedChaletKey = keyLookupData[0].key;
                }
            }

            const candidateIds = [
                resolvedChaletKey,
                chalet?.key,
                chalet?.id,
                chalet?.chalet_id,
            ].filter((id, index, arr) => Boolean(id) && arr.indexOf(id) === index);

            let chaletImages = [];
            let queryError = null;

            for (const candidateId of candidateIds) {
                try {
                    const { data, error } = await supabase
                        .from('chalet_images')
                        .select('*')
                        .eq('chalet_id', candidateId)
                        .order('display_order', { ascending: true });

                    if (error) {
                        queryError = error;
                        continue;
                    }

                    if (Array.isArray(data) && data.length > 0) {
                        chaletImages = data;
                        break;
                    }
                } catch (err) {
                    queryError = err;
                }
            }
            
            if (queryError && chaletImages.length === 0) {
                console.error('Error fetching chalet images:', queryError);
                setImages(fallbackMainImage);
            } else if (chaletImages && chaletImages.length > 0) {
                const imageUrls = chaletImages
                    .map((img) => img.image_url)
                    .filter(Boolean);
                const deduped = [...new Set([...imageUrls, ...fallbackMainImage])];
                setImages(deduped);
            } else {
                setImages(fallbackMainImage);
            }
        } catch (error) {
            console.error('Error loading chalet details:', error);
            const imageList = chalet.Image ? [chalet.Image] : [];
            setImages(imageList);
        } finally {
            setLoading(false);
        }
    };

    // Default amenities based on chalet data
    const getAmenities = () => {
        const amenities = [];
        
        if (chaletData?.nb_personnes) {
            amenities.push({
                icon: '🛏️',
                label: `${chaletData.nb_personnes} lits`
            });
        }
        
        // Add default amenities (in production, these would come from database)
        amenities.push(
            { icon: '📶', label: 'Wifi' },
            { icon: '🔥', label: 'Foyer à bois' },
            { icon: '🚿', label: 'Bloc sanitaire' },
            { icon: '🍳', label: 'Cuisine équipée' },
            { icon: '🏞️', label: 'Vue sur nature' }
        );
        
        return amenities;
    };

    if (!isOpen || !chalet) return null;

    return (
        <div className="chalet-detail-overlay" onClick={onClose}>
            <div className="chalet-detail-modal" onClick={(e) => e.stopPropagation()}>
                {/* Close Button */}
                <button 
                    className="chalet-detail-close" 
                    onClick={onClose}
                    type="button"
                >
                    ✕
                </button>

                {loading ? (
                    <div className="chalet-detail-loading">
                        Chargement...
                    </div>
                ) : (
                    <>
                        {/* Page Header */}
                        <div className="chalet-detail-header">
                            <h1 className="chalet-detail-title">{chaletData?.Name || 'Chalet'}</h1>
                        </div>

                        {/* Image Gallery Section */}
                        <div className="chalet-detail-gallery">
                            {images.length > 0 ? (
                                <>
                                    <div className="chalet-detail-gallery-main">
                                        <img
                                            src={images[0]}
                                            alt={chaletData?.Name}
                                            className="chalet-detail-main-image"
                                            onClick={() => setLightboxIndex(0)}
                                            style={{ cursor: 'zoom-in' }}
                                        />
                                    </div>
                                    {images.length > 1 && (
                                        <div className="chalet-detail-gallery-grid">
                                            {images.slice(1, 5).map((img, index) => {
                                                const realIndex = index + 1;
                                                const isLastVisible = realIndex === 4 && images.length > 5;
                                                return (
                                                    <button
                                                        key={realIndex}
                                                        type="button"
                                                        onClick={() => setLightboxIndex(realIndex)}
                                                        className="chalet-detail-grid-image"
                                                        style={{
                                                            position: 'relative',
                                                            padding: 0,
                                                            border: 'none',
                                                            cursor: 'zoom-in',
                                                            overflow: 'hidden',
                                                            background: 'transparent',
                                                        }}
                                                    >
                                                        <img
                                                            src={img}
                                                            alt={`${chaletData?.Name} - ${realIndex + 1}`}
                                                            style={{
                                                                width: '100%',
                                                                height: '100%',
                                                                objectFit: 'cover',
                                                                opacity: isLastVisible ? 0.55 : 1,
                                                                display: 'block',
                                                            }}
                                                        />
                                                        {isLastVisible && (
                                                            <div style={{
                                                                position: 'absolute',
                                                                inset: 0,
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                justifyContent: 'center',
                                                                color: 'white',
                                                                fontWeight: 600,
                                                                fontSize: '0.95rem',
                                                                background: 'rgba(0,0,0,0.35)',
                                                                gap: 6,
                                                            }}>
                                                                <span>➕</span>
                                                                <span>{images.length - 5} photos</span>
                                                            </div>
                                                        )}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    )}
                                    {images.length > 1 && (
                                        <button
                                            type="button"
                                            onClick={() => setLightboxIndex(0)}
                                            style={{
                                                marginTop: 12,
                                                padding: '10px 18px',
                                                backgroundColor: '#fff',
                                                color: '#0f172a',
                                                border: '1px solid #0f172a',
                                                borderRadius: 8,
                                                cursor: 'pointer',
                                                fontSize: '0.9rem',
                                                fontWeight: 600,
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                gap: 8,
                                            }}
                                        >
                                            <span>🖼️</span>
                                            Voir les {images.length} photos
                                        </button>
                                    )}
                                </>
                            ) : (
                                <div style={{
                                    padding: '40px',
                                    textAlign: 'center',
                                    color: '#64748b'
                                }}>
                                    Aucune image disponible
                                </div>
                            )}
                        </div>

                        <Lightbox
                            images={images}
                            index={lightboxIndex}
                            onIndexChange={setLightboxIndex}
                            onClose={() => setLightboxIndex(null)}
                            alt={chaletData?.Name || 'Chalet'}
                        />

                        {/* Description Section */}
                        <div className="chalet-detail-section">
                            <h2 className="chalet-detail-section-title">Description</h2>
                            <div className="chalet-detail-description">
                                {chaletData?.Description && (
                                    <p className="chalet-detail-text">{chaletData.Description}</p>
                                )}
                                
                                {chaletData?.nb_personnes && (
                                    <p className="chalet-detail-text">
                                        <strong>Capacité:</strong> Peut accueillir {chaletData.nb_personnes} personnes et plus
                                    </p>
                                )}
                                
                                {/* Default description items */}
                                <p className="chalet-detail-text">
                                    <strong>Configuration des lits:</strong> Lits confortables adaptés au nombre d'invités
                                </p>
                                <p className="chalet-detail-text">
                                    <strong>Salle de bain:</strong> Accès au bloc sanitaire avec douches et toilettes
                                </p>
                                <p className="chalet-detail-text">
                                    <strong>Cuisine:</strong> Cuisine équipée pour préparer vos repas
                                </p>
                                
                                {chaletData?.price_per_night && (
                                    <p className="chalet-detail-price">
                                        <strong>{chaletData.price_per_night}$ CAD</strong> par nuit
                                    </p>
                                )}
                            </div>
                        </div>

                        {/* Divider */}
                        <div className="chalet-detail-divider"></div>

                        {/* Amenities Section */}
                        <div className="chalet-detail-section">
                            <h2 className="chalet-detail-section-title">Commodités</h2>
                            <div className="chalet-detail-amenities">
                                {getAmenities().map((amenity, index) => (
                                    <div key={index} className="chalet-detail-amenity-item">
                                        <span className="chalet-detail-amenity-icon">{amenity.icon}</span>
                                        <span className="chalet-detail-amenity-label">{amenity.label}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Divider */}
                        <div className="chalet-detail-divider"></div>

                        {/* Availability Section - read-only */}
                        <div className="chalet-detail-section">
                            <h2 className="chalet-detail-section-title">Calendrier des disponibilités</h2>
                            <div className="reservation-container">
                                <p className="chalet-detail-text" style={{ marginBottom: '12px' }}>
                                    Les journées barrées sont indisponibles (déjà réservées).
                                </p>
                                <div className="reservation-calendar-wrapper">
                                    <DateRangePicker
                                        onDateChange={() => {}}
                                        blockedDates={blockedDates}
                                        monthsToShow={2}
                                        readOnly
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Future sections placeholder */}
                        <div className="chalet-detail-future-sections">
                            {/* Additional sections can be added here */}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default ChaletDetailModal;
