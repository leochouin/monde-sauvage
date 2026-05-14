import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import supabase from '../utils/supabase.js';
import DateRangePicker from '../components/DateRangePicker.jsx';
import './ChaletDetailPage.css';

const parseLegacyImageField = (value) => {
    if (!value) return [];
    if (Array.isArray(value)) return value.filter(Boolean).map(String);
    const raw = String(value).trim();
    if (!raw) return [];
    if (raw.startsWith('[') && raw.endsWith(']')) {
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) return parsed.filter(Boolean).map((item) => String(item).trim()).filter(Boolean);
        } catch { /* fall through */ }
    }
    if (raw.includes(',')) return raw.split(',').map((item) => item.trim()).filter(Boolean);
    return [raw];
};

const ChaletDetailPage = () => {
    const { id } = useParams();
    const [chalet, setChalet] = useState(null);
    const [images, setImages] = useState([]);
    const [blockedDates, setBlockedDates] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [showAllImages, setShowAllImages] = useState(false);
    const [lightboxIndex, setLightboxIndex] = useState(null);

    useEffect(() => {
        if (!id) return;
        loadAll();
    }, [id]);

    const loadAll = async () => {
        setLoading(true);
        setError(null);

        // ── 1. Chalet data ───────────────────────────────────────────
        let chaletData = null;
        try {
            const cached = localStorage.getItem(`ms_chalet_preview_${id}`);
            if (cached) {
                chaletData = JSON.parse(cached);
                localStorage.removeItem(`ms_chalet_preview_${id}`);
            }
        } catch {}

        if (!chaletData) {
            try {
                const { data, error: chaletError } = await supabase
                    .from('chalets')
                    .select('*')
                    .eq('key', id)
                    .single();
                if (chaletError) throw chaletError;
                chaletData = data;
            } catch (err) {
                setError(err.message || 'Erreur de chargement');
                setLoading(false);
                return;
            }
        }

        setChalet(chaletData);
        const fallback = parseLegacyImageField(chaletData?.Image);

        // ── 2. Gallery images (isolated — failure shows fallback) ────
        try {
            const { data: dbImages } = await supabase
                .from('chalet_images')
                .select('image_url')
                .eq('chalet_id', id)
                .order('display_order', { ascending: true });

            if (dbImages && dbImages.length > 0) {
                const urls = dbImages.map((r) => r.image_url).filter(Boolean);
                setImages([...new Set([...urls, ...fallback])]);
            } else {
                setImages(fallback);
            }
        } catch {
            setImages(fallback);
        }

        // ── 3. Blocked dates (isolated — failure is non-fatal) ───────
        try {
            const { data: bookings } = await supabase
                .from('bookings')
                .select('start_date, end_date')
                .eq('chalet_id', id)
                .in('status', ['confirmed', 'pending', 'blocked']);
            setBlockedDates((bookings || []).map((b) => ({ start: b.start_date, end: b.end_date })));
        } catch {}

        setLoading(false);
    };

    const handleBack = () => {
        if (window.history.length > 1) {
            window.history.back();
        } else {
            window.close();
        }
    };

    const getAmenities = () => {
        const amenities = [];
        if (chalet?.nb_personnes) amenities.push({ icon: '🛏️', label: `${chalet.nb_personnes} lits` });
        amenities.push(
            { icon: '📶', label: 'Wifi' },
            { icon: '🔥', label: 'Foyer à bois' },
            { icon: '🚿', label: 'Bloc sanitaire' },
            { icon: '🍳', label: 'Cuisine équipée' },
            { icon: '🏞️', label: 'Vue sur nature' },
        );
        return amenities;
    };

    return (
        <div className="cdp-root">
            {/* Top nav bar */}
            <header className="cdp-nav">
                <button className="cdp-back" onClick={handleBack} type="button">
                    ← Retour
                </button>
                <span className="cdp-brand">Monde Sauvage</span>
                <div className="cdp-nav-spacer" />
            </header>

            <main className="cdp-main">
                {loading && (
                    <div className="cdp-loading">Chargement…</div>
                )}

                {error && (
                    <div className="cdp-error">{error}</div>
                )}

                {!loading && !error && chalet && (
                    <>
                        <h1 className="cdp-title">{chalet.Name}</h1>
                        {chalet.price_per_night && (
                            <p className="cdp-subtitle">
                                <strong>{chalet.price_per_night}$ CAD</strong> / nuit
                            </p>
                        )}

                        {/* Gallery */}
                        {images.length > 0 && (
                            <div className={`cdp-gallery cdp-gallery--${Math.min(images.length, 5)}`}>
                                {(showAllImages ? images : images.slice(0, 5)).map((src, i) => (
                                    <div
                                        key={i}
                                        className={`cdp-gallery-cell ${i === 0 ? 'cdp-gallery-cell--main' : ''}`}
                                        onClick={() => setLightboxIndex(i)}
                                    >
                                        <img src={src} alt={`${chalet.Name} - ${i + 1}`} />
                                    </div>
                                ))}
                                {!showAllImages && images.length > 5 && (
                                    <button
                                        className="cdp-show-all"
                                        onClick={(e) => { e.stopPropagation(); setShowAllImages(true); }}
                                        type="button"
                                    >
                                        Voir toutes les photos ({images.length})
                                    </button>
                                )}
                            </div>
                        )}

                        {/* Body: content + sticky sidebar */}
                        <div className="cdp-body">
                            <div className="cdp-content">
                                {/* Description */}
                                <section className="cdp-section">
                                    <h2 className="cdp-section-title">Description</h2>
                                    {chalet.Description && <p className="cdp-text">{chalet.Description}</p>}
                                    {chalet.nb_personnes && (
                                        <p className="cdp-text">
                                            <strong>Capacité :</strong> {chalet.nb_personnes} personnes et plus
                                        </p>
                                    )}
                                    <p className="cdp-text"><strong>Configuration des lits :</strong> Lits confortables adaptés au nombre d'invités</p>
                                    <p className="cdp-text"><strong>Salle de bain :</strong> Accès au bloc sanitaire avec douches et toilettes</p>
                                    <p className="cdp-text"><strong>Cuisine :</strong> Cuisine équipée pour préparer vos repas</p>
                                </section>

                                <hr className="cdp-divider" />

                                {/* Amenities */}
                                <section className="cdp-section">
                                    <h2 className="cdp-section-title">Commodités</h2>
                                    <div className="cdp-amenities">
                                        {getAmenities().map((a, i) => (
                                            <div key={i} className="cdp-amenity">
                                                <span className="cdp-amenity-icon">{a.icon}</span>
                                                <span className="cdp-amenity-label">{a.label}</span>
                                            </div>
                                        ))}
                                    </div>
                                </section>

                                <hr className="cdp-divider" />

                                {/* Availability */}
                                <section className="cdp-section">
                                    <h2 className="cdp-section-title">Disponibilités</h2>
                                    <p className="cdp-text" style={{ marginBottom: '12px' }}>
                                        Les journées barrées sont indisponibles.
                                    </p>
                                    <DateRangePicker
                                        onDateChange={() => {}}
                                        blockedDates={blockedDates}
                                        monthsToShow={2}
                                        readOnly
                                    />
                                </section>
                            </div>

                            {/* Sticky booking card */}
                            <aside className="cdp-sidebar">
                                <div className="cdp-booking-card">
                                    {chalet.price_per_night && (
                                        <p className="cdp-booking-price">
                                            <strong>{chalet.price_per_night}$</strong>
                                            <span> CAD / nuit</span>
                                        </p>
                                    )}
                                    <button
                                        className="cdp-booking-cta"
                                        type="button"
                                        onClick={() => {
                                            localStorage.setItem('ms_select_chalet', JSON.stringify({ key: chalet.key, ts: Date.now() }));
                                            window.close();
                                        }}
                                    >
                                        Réserver — retourner à la carte
                                    </button>
                                    <p className="cdp-booking-hint">
                                        Sélectionnez ce chalet sur la carte pour démarrer une réservation.
                                    </p>
                                </div>
                            </aside>
                        </div>
                    </>
                )}
            </main>

            {/* Lightbox */}
            {lightboxIndex !== null && (
                <div className="cdp-lightbox" onClick={() => setLightboxIndex(null)}>
                    <button className="cdp-lightbox-close" type="button" onClick={() => setLightboxIndex(null)}>✕</button>
                    <button
                        className="cdp-lightbox-arrow cdp-lightbox-arrow--prev"
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setLightboxIndex((lightboxIndex - 1 + images.length) % images.length); }}
                    >‹</button>
                    <img
                        src={images[lightboxIndex]}
                        alt=""
                        className="cdp-lightbox-img"
                        onClick={(e) => e.stopPropagation()}
                    />
                    <button
                        className="cdp-lightbox-arrow cdp-lightbox-arrow--next"
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setLightboxIndex((lightboxIndex + 1) % images.length); }}
                    >›</button>
                    <span className="cdp-lightbox-counter">{lightboxIndex + 1} / {images.length}</span>
                </div>
            )}
        </div>
    );
};

export default ChaletDetailPage;
