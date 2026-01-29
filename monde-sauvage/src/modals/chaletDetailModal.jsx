import { useState, useEffect } from 'react';
import supabase from '../utils/supabase.js';
import { 
    checkChaletAvailability, 
    calculateBookingPrice, 
    createBooking 
} from '../utils/bookingService.js';
import DateRangePicker from '../components/DateRangePicker.jsx';

const ChaletDetailModal = ({ isOpen, onClose, chalet }) => {
    const [chaletData, setChaletData] = useState(null);
    const [images, setImages] = useState([]);
    const [loading, setLoading] = useState(false);
    const [showAllImages, setShowAllImages] = useState(false);

    // Reservation states
    const [checkInDate, setCheckInDate] = useState('');
    const [checkOutDate, setCheckOutDate] = useState('');
    const [guestName, setGuestName] = useState('');
    const [guestEmail, setGuestEmail] = useState('');
    const [notes, setNotes] = useState('');
    const [isCheckingAvailability, setIsCheckingAvailability] = useState(false);
    const [availabilityStatus, setAvailabilityStatus] = useState(null); // null, 'available', 'unavailable'
    const [availabilityMessage, setAvailabilityMessage] = useState('');
    const [priceBreakdown, setPriceBreakdown] = useState(null);
    const [isSubmittingBooking, setIsSubmittingBooking] = useState(false);
    const [bookingSuccess, setBookingSuccess] = useState(false);
    const [bookingError, setBookingError] = useState(null);
    const [blockedDates, setBlockedDates] = useState([]);

    useEffect(() => {
        if (isOpen && chalet) {
            loadChaletDetails();
            loadBlockedDates();
            // Reset reservation states when modal opens
            resetReservationForm();
        }
    }, [isOpen, chalet]);

    // Check availability and calculate price when dates change
    useEffect(() => {
        if (checkInDate && checkOutDate && chaletData) {
            handleAvailabilityCheck();
        } else {
            setAvailabilityStatus(null);
            setPriceBreakdown(null);
        }
    }, [checkInDate, checkOutDate, chaletData]);

    const resetReservationForm = () => {
        setCheckInDate('');
        setCheckOutDate('');
        setGuestName('');
        setGuestEmail('');
        setNotes('');
        setAvailabilityStatus(null);
        setAvailabilityMessage('');
        setPriceBreakdown(null);
        setBookingSuccess(false);
        setBookingError(null);
    };

    const handleAvailabilityCheck = async () => {
        if (!checkInDate || !checkOutDate || !chaletData) return;

        // Validate dates
        const checkIn = new Date(checkInDate);
        const checkOut = new Date(checkOutDate);
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        if (checkIn < today) {
            setAvailabilityStatus('unavailable');
            setAvailabilityMessage('La date d\'arrivée ne peut pas être dans le passé');
            setPriceBreakdown(null);
            return;
        }

        if (checkOut <= checkIn) {
            setAvailabilityStatus('unavailable');
            setAvailabilityMessage('La date de départ doit être après la date d\'arrivée');
            setPriceBreakdown(null);
            return;
        }

        setIsCheckingAvailability(true);
        setAvailabilityMessage('Vérification de la disponibilité...');

        try {
            // Check availability
            const result = await checkChaletAvailability(
                chaletData.key,
                checkInDate,
                checkOutDate
            );

            if (result.available) {
                setAvailabilityStatus('available');
                setAvailabilityMessage('✅ Disponible pour ces dates');

                // Calculate price
                const pricing = calculateBookingPrice(
                    chaletData.price_per_night,
                    checkInDate,
                    checkOutDate
                );
                setPriceBreakdown(pricing);
            } else {
                setAvailabilityStatus('unavailable');
                setAvailabilityMessage(`❌ Non disponible: ${result.reason || 'Dates déjà réservées'}`);
                setPriceBreakdown(null);
            }
        } catch (error) {
            console.error('Error checking availability:', error);
            setAvailabilityStatus('unavailable');
            setAvailabilityMessage('❌ Erreur lors de la vérification de disponibilité');
            setPriceBreakdown(null);
        } finally {
            setIsCheckingAvailability(false);
        }
    };

    const handleSubmitReservation = async (e) => {
        e.preventDefault();

        // Validate form
        if (!guestName.trim() || !guestEmail.trim()) {
            setBookingError('Veuillez remplir tous les champs requis');
            return;
        }

        if (availabilityStatus !== 'available') {
            setBookingError('Le chalet n\'est pas disponible pour ces dates');
            return;
        }

        setIsSubmittingBooking(true);
        setBookingError(null);

        try {
            const booking = await createBooking({
                chaletId: chaletData.key,
                startDate: checkInDate,
                endDate: checkOutDate,
                customerName: guestName,
                customerEmail: guestEmail,
                notes: notes
            });

            console.log('✅ Reservation created:', booking);
            setBookingSuccess(true);
            
            // Reset form after 3 seconds
            setTimeout(() => {
                resetReservationForm();
            }, 3000);

        } catch (error) {
            console.error('Error creating reservation:', error);
            setBookingError(error.message || 'Erreur lors de la création de la réservation');
        } finally {
            setIsSubmittingBooking(false);
        }
    };

    const loadBlockedDates = async () => {
        try {
            // Fetch all bookings for this chalet
            const { data: bookings, error } = await supabase
                .from('bookings')
                .select('start_date, end_date, status')
                .eq('chalet_id', chalet.key || chalet.id)
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
            
            // Fetch images from chalet_images table
            const { data: chaletImages, error } = await supabase
                .from('chalet_images')
                .select('*')
                .eq('chalet_id', chalet.key)
                .order('display_order', { ascending: true });
            
            if (error) {
                console.error('Error fetching chalet images:', error);
                // Fallback to main image if available
                const imageList = chalet.Image ? [chalet.Image] : [];
                setImages(imageList);
            } else if (chaletImages && chaletImages.length > 0) {
                // Use images from chalet_images table
                const imageUrls = chaletImages.map(img => img.image_url);
                setImages(imageUrls);
            } else {
                // Fallback to main image if no images in chalet_images
                const imageList = chalet.Image ? [chalet.Image] : [];
                setImages(imageList);
            }
        } catch (error) {
            console.error('Error loading chalet details:', error);
            // Fallback to main image
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
                                        />
                                    </div>
                                    {images.length > 1 && (
                                        <div className="chalet-detail-gallery-grid">
                                            {images.slice(1, showAllImages ? images.length : 5).map((img, index) => (
                                                <img 
                                                    key={index + 1}
                                                    src={img} 
                                                    alt={`${chaletData?.Name} - ${index + 2}`}
                                                    className="chalet-detail-grid-image"
                                                />
                                            ))}
                                            {images.length > 5 && !showAllImages && (
                                                <button
                                                    type="button"
                                                    onClick={() => setShowAllImages(true)}
                                                    className="chalet-detail-view-more"
                                                    style={{
                                                        position: 'relative',
                                                        backgroundColor: 'rgba(0, 0, 0, 0.7)',
                                                        color: 'white',
                                                        border: 'none',
                                                        borderRadius: '8px',
                                                        cursor: 'pointer',
                                                        fontSize: '1rem',
                                                        fontWeight: '600',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        padding: '0',
                                                        overflow: 'hidden'
                                                    }}
                                                >
                                                    <img 
                                                        src={images[5]} 
                                                        alt="More"
                                                        style={{
                                                            width: '100%',
                                                            height: '100%',
                                                            objectFit: 'cover',
                                                            opacity: 0.4
                                                        }}
                                                    />
                                                    <div style={{
                                                        position: 'absolute',
                                                        top: '50%',
                                                        left: '50%',
                                                        transform: 'translate(-50%, -50%)',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '8px'
                                                    }}>
                                                        <span>➕</span>
                                                        <span>{images.length - 5} photos</span>
                                                    </div>
                                                </button>
                                            )}
                                        </div>
                                    )}
                                    {showAllImages && images.length > 5 && (
                                        <button
                                            type="button"
                                            onClick={() => setShowAllImages(false)}
                                            style={{
                                                marginTop: '10px',
                                                padding: '8px 16px',
                                                backgroundColor: '#059669',
                                                color: 'white',
                                                border: 'none',
                                                borderRadius: '6px',
                                                cursor: 'pointer',
                                                fontSize: '0.9rem',
                                                fontWeight: '500'
                                            }}
                                        >
                                            Voir moins
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

                        {/* Reservation Section - Airbnb Style */}
                        <div className="chalet-detail-section">
                            <h2 className="chalet-detail-section-title">Réserver ce chalet</h2>
                            
                            {bookingSuccess ? (
                                <div className="reservation-success-message">
                                    <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>✅</div>
                                    <h3 style={{ marginBottom: '0.5rem' }}>Réservation confirmée!</h3>
                                    <p>Votre demande de réservation a été enregistrée avec succès.</p>
                                    <p style={{ fontSize: '0.9rem', color: '#64748b' }}>
                                        Un email de confirmation sera envoyé à {guestEmail}
                                    </p>
                                </div>
                            ) : (
                                <div className="reservation-container">
                                    {/* Date Selection Calendar */}
                                    <div className="reservation-calendar-wrapper">
                                        <div className="reservation-selected-dates">
                                            <div className="selected-date-box">
                                                <label className="selected-date-label">Arrivée</label>
                                                <div className="selected-date-value">
                                                    {checkInDate ? (() => {
                                                        const [year, month, day] = checkInDate.split('-');
                                                        const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
                                                        return date.toLocaleDateString('fr-FR', { 
                                                            day: 'numeric', 
                                                            month: 'short', 
                                                            year: 'numeric' 
                                                        });
                                                    })() : 'Sélectionner'}
                                                </div>
                                            </div>
                                            <div className="selected-date-divider">→</div>
                                            <div className="selected-date-box">
                                                <label className="selected-date-label">Départ</label>
                                                <div className="selected-date-value">
                                                    {checkOutDate ? (() => {
                                                        const [year, month, day] = checkOutDate.split('-');
                                                        const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
                                                        return date.toLocaleDateString('fr-FR', { 
                                                            day: 'numeric', 
                                                            month: 'short', 
                                                            year: 'numeric' 
                                                        });
                                                    })() : 'Sélectionner'}
                                                </div>
                                            </div>
                                        </div>
                                        <DateRangePicker
                                            onDateChange={(checkIn, checkOut) => {
                                                // Format date as YYYY-MM-DD in local timezone to avoid timezone shifts
                                                if (checkIn) {
                                                    const year = checkIn.getFullYear();
                                                    const month = String(checkIn.getMonth() + 1).padStart(2, '0');
                                                    const day = String(checkIn.getDate()).padStart(2, '0');
                                                    setCheckInDate(`${year}-${month}-${day}`);
                                                } else {
                                                    setCheckInDate('');
                                                }
                                                if (checkOut) {
                                                    const year = checkOut.getFullYear();
                                                    const month = String(checkOut.getMonth() + 1).padStart(2, '0');
                                                    const day = String(checkOut.getDate()).padStart(2, '0');
                                                    setCheckOutDate(`${year}-${month}-${day}`);
                                                } else {
                                                    setCheckOutDate('');
                                                }
                                            }}
                                            blockedDates={blockedDates}
                                            initialCheckIn={checkInDate ? (() => {
                                                const [year, month, day] = checkInDate.split('-');
                                                return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
                                            })() : null}
                                            initialCheckOut={checkOutDate ? (() => {
                                                const [year, month, day] = checkOutDate.split('-');
                                                return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
                                            })() : null}
                                        />
                                    </div>

                                    {/* Availability Status */}
                                    {checkInDate && checkOutDate && (
                                        <div className={`availability-status ${availabilityStatus || 'checking'}`}>
                                            {isCheckingAvailability ? (
                                                <span>🔄 {availabilityMessage}</span>
                                            ) : (
                                                <span>{availabilityMessage}</span>
                                            )}
                                        </div>
                                    )}

                                    {/* Price Breakdown */}
                                    {priceBreakdown && availabilityStatus === 'available' && (
                                        <div className="price-breakdown">
                                            <div className="price-row">
                                                <span>{chaletData.price_per_night}$ × {priceBreakdown.nights} {priceBreakdown.nights > 1 ? 'nuits' : 'nuit'}</span>
                                                <span>{priceBreakdown.subtotal}$ CAD</span>
                                            </div>
                                            {priceBreakdown.serviceFee > 0 && (
                                                <div className="price-row">
                                                    <span>Frais de service</span>
                                                    <span>{priceBreakdown.serviceFee}$ CAD</span>
                                                </div>
                                            )}
                                            <div className="price-divider"></div>
                                            <div className="price-row price-total">
                                                <span>Total</span>
                                                <span>{priceBreakdown.total}$ CAD</span>
                                            </div>
                                        </div>
                                    )}

                                    {/* Guest Information Form */}
                                    {availabilityStatus === 'available' && (
                                        <form onSubmit={handleSubmitReservation} className="reservation-form">
                                            <div className="form-group">
                                                <label htmlFor="guestName">Nom complet *</label>
                                                <input
                                                    id="guestName"
                                                    type="text"
                                                    value={guestName}
                                                    onChange={(e) => setGuestName(e.target.value)}
                                                    placeholder="Votre nom"
                                                    required
                                                    className="form-input"
                                                />
                                            </div>
                                            <div className="form-group">
                                                <label htmlFor="guestEmail">Email *</label>
                                                <input
                                                    id="guestEmail"
                                                    type="email"
                                                    value={guestEmail}
                                                    onChange={(e) => setGuestEmail(e.target.value)}
                                                    placeholder="votre@email.com"
                                                    required
                                                    className="form-input"
                                                />
                                            </div>
                                            <div className="form-group">
                                                <label htmlFor="notes">Notes (optionnel)</label>
                                                <textarea
                                                    id="notes"
                                                    value={notes}
                                                    onChange={(e) => setNotes(e.target.value)}
                                                    placeholder="Informations supplémentaires..."
                                                    rows="3"
                                                    className="form-textarea"
                                                />
                                            </div>

                                            {bookingError && (
                                                <div className="booking-error">
                                                    {bookingError}
                                                </div>
                                            )}

                                            <button
                                                type="submit"
                                                disabled={isSubmittingBooking || availabilityStatus !== 'available'}
                                                className="reserve-button"
                                            >
                                                {isSubmittingBooking ? 'Réservation en cours...' : 'Réserver'}
                                            </button>

                                            <p className="reservation-note">
                                                💡 Cette réservation est en attente de confirmation. 
                                                Aucun paiement n'est requis pour le moment.
                                            </p>
                                        </form>
                                    )}
                                </div>
                            )}
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
