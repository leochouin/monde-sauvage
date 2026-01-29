import { useState, useEffect, useRef } from 'react';
import supabase from '../utils/supabase.js';

const ChaletHoraireModal = ({ isOpen, onClose, chalet }) => {
    const [bookings, setBookings] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [calendarId, setCalendarId] = useState(null);
    const [isCreatingCalendar, setIsCreatingCalendar] = useState(false);
    const [processingBooking, setProcessingBooking] = useState(null);
    const [deleteConfirmId, setDeleteConfirmId] = useState(null);
    const refreshIntervalRef = useRef(null);

    // Load calendar events when modal opens or chalet changes
    useEffect(() => {
        if (isOpen && chalet) {
            loadCalendarEvents();
            
            // Set up auto-refresh every 30 seconds
            refreshIntervalRef.current = setInterval(() => {
                loadCalendarEvents();
            }, 30000);

            // Cleanup interval on unmount or when modal closes
            return () => {
                if (refreshIntervalRef.current) {
                    clearInterval(refreshIntervalRef.current);
                }
            };
        }
    }, [isOpen, chalet]);

    const loadCalendarEvents = async () => {
        if (!chalet) return;

        try {
            setLoading(true);
            setError(null);

            // Check if chalet has a Google Calendar
            if (chalet.google_calendar) {
                setCalendarId(chalet.google_calendar);
                await fetchCalendarEvents(chalet.google_calendar);
            } else {
                // No calendar exists, we'll need to create one
                setCalendarId(null);
                setBookings([]);
            }
        } catch (err) {
            console.error('Error loading calendar events:', err);
            
            // Check if it's a Google Calendar authentication error that requires reconnection
            if (err.message && err.message.includes('Google Calendar access')) {
                setError('Vous devez d\'abord connecter votre compte Google Calendar dans les paramètres de l\'établissement avant de pouvoir gérer l\'agenda de ce chalet.');
            } else if (err.message && err.message.includes('reconnect')) {
                setError('Votre connexion Google Calendar a expiré. Veuillez reconnecter votre compte dans les paramètres de l\'établissement.');
            } else {
                // For other errors, show a generic message without asking to reconnect
                setError(err.message || 'Erreur lors du chargement des événements');
            }
        } finally {
            setLoading(false);
        }
    };

    const fetchCalendarEvents = async (calendarId) => {
        try {
            // Get current user for OAuth token
            const { data: { user: _user }, error: userError } = await supabase.auth.getUser();
            if (userError) throw userError;

            console.log('🔍 Fetching calendar events for:', {
                calendarId,
                chaletId: chalet.key || chalet.id,
                chaletKey: chalet.key,
                chaletIdField: chalet.id
            });

            // Call edge function to get calendar events and sync to bookings
            const response = await fetch(
                `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chalet-calendar-events?calendar_id=${calendarId}&chalet_id=${chalet.key || chalet.id}`,
                {
                    headers: {
                        'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`
                    }
                }
            );

            if (!response.ok) {
                const errorData = await response.json();
                console.error('❌ Edge function error:', errorData);
                
                // Check if it requires reconnection to Google
                if (errorData.requiresAuth) {
                    throw new Error('Please reconnect your Google Calendar in establishment settings.');
                }
                
                throw new Error(errorData.error || 'Failed to fetch calendar events');
            }

            const data = await response.json();
            console.log('✅ Received data:', {
                eventsCount: data.events?.length,
                bookingsCount: data.bookings?.length,
                bookings: data.bookings
            });
            
            setBookings(data.bookings || []);
        } catch (err) {
            console.error('Error fetching calendar events:', err);
            throw err;
        }
    };

    const handleCreateCalendar = async () => {
        if (!chalet) return;

        try {
            setIsCreatingCalendar(true);
            setError(null);

            // Get current user
            const { data: { user: _user }, error: userError } = await supabase.auth.getUser();
            if (userError) throw userError;

            // Call edge function to create calendar
            const response = await fetch(
                `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-chalet-calendar`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`
                    },
                    body: JSON.stringify({
                        chalet_id: chalet.key || chalet.id,
                        chalet_name: chalet.Name
                    })
                }
            );

            if (!response.ok) {
                const errorData = await response.json();
                
                // Handle 401 errors with more user-friendly messages
                if (response.status === 401 || errorData.requiresAuth) {
                    throw new Error('Vous devez d\'abord connecter votre compte Google Calendar dans les paramètres de l\'établissement avant de pouvoir créer un calendrier pour ce chalet.');
                }
                
                throw new Error(errorData.error || 'Failed to create calendar');
            }

            const data = await response.json();
            
            // Update local state
            setCalendarId(data.calendar_id);
            
            // Refresh the chalet data by reloading
            await loadCalendarEvents();
            
        } catch (err) {
            console.error('Error creating calendar:', err);
            setError(err.message || 'Erreur lors de la création du calendrier');
        } finally {
            setIsCreatingCalendar(false);
        }
    };

    const handleConfirmBooking = async (bookingId) => {
        try {
            setProcessingBooking(bookingId);
            setError(null);

            const { error: updateError } = await supabase
                .from('bookings')
                .update({ status: 'confirmed' })
                .eq('id', bookingId);

            if (updateError) throw updateError;

            // Refresh bookings
            await loadCalendarEvents();
        } catch (err) {
            console.error('Error confirming booking:', err);
            setError('Erreur lors de la confirmation de la réservation');
        } finally {
            setProcessingBooking(null);
        }
    };

    const handleRejectBooking = async (bookingId) => {
        try {
            setProcessingBooking(bookingId);
            setError(null);

            const { error: updateError } = await supabase
                .from('bookings')
                .update({ status: 'cancelled' })
                .eq('id', bookingId);

            if (updateError) throw updateError;

            // Refresh bookings
            await loadCalendarEvents();
        } catch (err) {
            console.error('Error rejecting booking:', err);
            setError('Erreur lors du rejet de la réservation');
        } finally {
            setProcessingBooking(null);
        }
    };

    const handleDeleteBooking = async (bookingId) => {
        try {
            setProcessingBooking(bookingId);
            setError(null);

            const { error: deleteError } = await supabase
                .from('bookings')
                .delete()
                .eq('id', bookingId);

            if (deleteError) throw deleteError;

            // Refresh bookings
            await loadCalendarEvents();
            setDeleteConfirmId(null);
        } catch (err) {
            console.error('Error deleting booking:', err);
            setError('Erreur lors de la suppression de la réservation');
        } finally {
            setProcessingBooking(null);
        }
    };

    const formatDate = (dateString) => {
        const date = new Date(dateString);
        return date.toLocaleDateString('fr-CA', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    if (!isOpen) return null;

    return (
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
            zIndex: 1001
        }}>
            <div style={{
                backgroundColor: 'white',
                borderRadius: '12px',
                padding: '24px',
                maxWidth: '800px',
                width: '90%',
                maxHeight: '90vh',
                overflowY: 'auto'
            }}>
                {/* Header */}
                <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '20px'
                }}>
                    <h2 style={{
                        fontSize: '1.5rem',
                        fontWeight: 'bold',
                        color: '#334155'
                    }}>
                        📅 Agenda - {chalet?.Name || 'Chalet'}
                    </h2>
                    <button
                        type="button"
                        onClick={onClose}
                        style={{
                            padding: '8px 16px',
                            backgroundColor: '#f1f5f9',
                            color: '#334155',
                            border: 'none',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            fontWeight: '500'
                        }}
                    >
                        Fermer
                    </button>
                </div>

                {/* Content */}
                {loading && !calendarId ? (
                    <div style={{
                        textAlign: 'center',
                        padding: '40px',
                        color: '#64748b'
                    }}>
                        Chargement...
                    </div>
                ) : error ? (
                    <div>
                        <div style={{
                            padding: '20px',
                            backgroundColor: '#fee2e2',
                            color: '#991b1b',
                            borderRadius: '8px',
                            marginBottom: '16px'
                        }}>
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                                <span style={{ fontSize: '1.5rem' }}>⚠️</span>
                                <div style={{ flex: 1 }}>
                                    <p style={{ fontWeight: '600', marginBottom: '8px', fontSize: '1.1rem' }}>
                                        Connexion Google Calendar requise
                                    </p>
                                    <p style={{ marginBottom: '12px' }}>{error}</p>
                                    {error.includes('Google Calendar') && (
                                        <div style={{
                                            padding: '12px',
                                            backgroundColor: '#fef3c7',
                                            color: '#92400e',
                                            borderRadius: '6px',
                                            marginTop: '12px',
                                            fontSize: '0.9rem',
                                            border: '1px solid #fbbf24'
                                        }}>
                                            <p style={{ fontWeight: '600', marginBottom: '6px' }}>💡 Comment connecter Google Calendar:</p>
                                            <ol style={{ marginLeft: '20px', marginTop: '8px' }}>
                                                <li>Fermez cette fenêtre</li>
                                                <li>Dans la section "Connexion Google Calendar", cliquez sur le bouton "Connecter Google Calendar"</li>
                                                <li>Autorisez l'accès à votre calendrier Google</li>
                                                <li>Revenez ici pour gérer l'agenda du chalet</li>
                                            </ol>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                        <div style={{ textAlign: 'center' }}>
                            <button
                                type="button"
                                onClick={onClose}
                                style={{
                                    padding: '12px 24px',
                                    backgroundColor: '#3b82f6',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '6px',
                                    cursor: 'pointer',
                                    fontWeight: '500',
                                    fontSize: '1rem'
                                }}
                            >
                                Retour aux paramètres
                            </button>
                        </div>
                    </div>
                ) : !calendarId ? (
                    <div style={{
                        textAlign: 'center',
                        padding: '40px'
                    }}>
                        <p style={{
                            color: '#64748b',
                            marginBottom: '20px',
                            fontSize: '1rem'
                        }}>
                            Ce chalet n'a pas encore de calendrier Google associé.
                        </p>
                        <button
                            type="button"
                            onClick={handleCreateCalendar}
                            disabled={isCreatingCalendar}
                            style={{
                                padding: '12px 24px',
                                backgroundColor: '#059669',
                                color: 'white',
                                border: 'none',
                                borderRadius: '6px',
                                cursor: isCreatingCalendar ? 'not-allowed' : 'pointer',
                                fontWeight: '500',
                                fontSize: '1rem',
                                opacity: isCreatingCalendar ? 0.6 : 1
                            }}
                        >
                            {isCreatingCalendar ? 'Création en cours...' : 'Créer un calendrier'}
                        </button>
                    </div>
                ) : (
                    <div>
                        {/* Calendar info */}
                        <div style={{
                            padding: '16px',
                            backgroundColor: '#f0fdf4',
                            borderRadius: '6px',
                            marginBottom: '20px',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center'
                        }}>
                            <div>
                                <p style={{
                                    color: '#059669',
                                    fontWeight: '600',
                                    marginBottom: '4px'
                                }}>
                                    ✓ Calendrier connecté
                                </p>
                                <p style={{
                                    color: '#64748b',
                                    fontSize: '0.85rem'
                                }}>
                                    Les réservations s'affichent automatiquement
                                </p>
                            </div>
                            {loading && (
                                <span style={{
                                    color: '#64748b',
                                    fontSize: '0.85rem'
                                }}>
                                    Actualisation...
                                </span>
                            )}
                        </div>

                        {/* Events list */}
                        <div style={{
                            marginTop: '20px'
                        }}>
                            <h3 style={{
                                fontSize: '1.1rem',
                                fontWeight: '600',
                                color: '#334155',
                                marginBottom: '16px'
                            }}>
                                Réservations à venir
                            </h3>

                            {bookings.length === 0 ? (
                                <div style={{
                                    textAlign: 'center',
                                    padding: '40px',
                                    backgroundColor: '#f8fafc',
                                    borderRadius: '6px',
                                    color: '#64748b'
                                }}>
                                    Aucune réservation pour le moment
                                </div>
                            ) : (
                                <div style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '12px'
                                }}>
                                    {bookings.map((booking) => {
                                        const isBlocked = booking.status === 'blocked';
                                        const isPending = booking.status === 'pending';
                                        const isConfirmed = booking.status === 'confirmed';
                                        const isCancelled = booking.status === 'cancelled';
                                        const isProcessing = processingBooking === booking.id;

                                        return (
                                            <div
                                                key={booking.id}
                                                style={{
                                                    padding: '16px',
                                                    backgroundColor: isCancelled ? '#fee2e2' : isConfirmed ? '#f0fdf4' : (isPending || isBlocked) ? '#fff7ed' : '#f8fafc',
                                                    borderRadius: '6px',
                                                    borderLeft: `4px solid ${isCancelled ? '#dc2626' : isConfirmed ? '#059669' : (isPending || isBlocked) ? '#f59e0b' : '#94a3b8'}`,
                                                    opacity: isProcessing ? 0.6 : 1
                                                }}
                                            >
                                                <div style={{
                                                    display: 'flex',
                                                    justifyContent: 'space-between',
                                                    alignItems: 'flex-start',
                                                    marginBottom: '8px'
                                                }}>
                                                    <h4 style={{
                                                        fontSize: '1rem',
                                                        fontWeight: '600',
                                                        color: '#334155',
                                                        flex: 1
                                                    }}>
                                                        {booking.customer_name || 'Réservation'}
                                                    </h4>
                                                    <div style={{
                                                        display: 'flex',
                                                        gap: '8px',
                                                        alignItems: 'center'
                                                    }}>
                                                        {/* Status badge */}
                                                        <span style={{
                                                            padding: '4px 8px',
                                                            backgroundColor: isCancelled ? '#dc2626' : isConfirmed ? '#059669' : (isPending || isBlocked) ? '#f59e0b' : '#94a3b8',
                                                            color: 'white',
                                                            borderRadius: '4px',
                                                            fontSize: '0.75rem',
                                                            fontWeight: '600',
                                                            textTransform: 'uppercase'
                                                        }}>
                                                            {isCancelled ? 'Annulée' : isConfirmed ? 'Confirmée' : isPending ? 'En attente' : isBlocked ? 'Bloquée' : 'Autre'}
                                                        </span>
                                                        {/* Source badge */}
                                                        {booking.source === 'google' && (
                                                            <span style={{
                                                                padding: '4px 8px',
                                                                backgroundColor: '#e0e7ff',
                                                                color: '#3730a3',
                                                                borderRadius: '4px',
                                                                fontSize: '0.75rem',
                                                                fontWeight: '600'
                                                            }}>
                                                                📅 Google
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>

                                                <div style={{
                                                    display: 'flex',
                                                    flexDirection: 'column',
                                                    gap: '4px',
                                                    fontSize: '0.9rem',
                                                    color: '#64748b',
                                                    marginBottom: (isBlocked || isPending) ? '12px' : '0'
                                                }}>
                                                    <p>📅 Début: {formatDate(booking.start_date)}</p>
                                                    <p>📅 Fin: {formatDate(booking.end_date)}</p>
                                                    {booking.customer_email && (
                                                        <p>✉️ {booking.customer_email}</p>
                                                    )}
                                                    {booking.notes && (
                                                        <p style={{
                                                            marginTop: '8px',
                                                            color: '#475569'
                                                        }}>
                                                            {booking.notes}
                                                        </p>
                                                    )}
                                                </div>

                                                {/* Action buttons for blocked/pending bookings */}
                                                {(isBlocked || booking.status === 'pending') && (
                                                    <div style={{
                                                        display: 'flex',
                                                        gap: '8px',
                                                        marginTop: '12px'
                                                    }}>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleConfirmBooking(booking.id)}
                                                            disabled={isProcessing}
                                                            style={{
                                                                flex: 1,
                                                                padding: '8px 16px',
                                                                backgroundColor: '#059669',
                                                                color: 'white',
                                                                border: 'none',
                                                                borderRadius: '6px',
                                                                cursor: isProcessing ? 'not-allowed' : 'pointer',
                                                                fontWeight: '500',
                                                                fontSize: '0.9rem',
                                                                opacity: isProcessing ? 0.6 : 1
                                                            }}
                                                        >
                                                            ✓ Confirmer
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleRejectBooking(booking.id)}
                                                            disabled={isProcessing}
                                                            style={{
                                                                flex: 1,
                                                                padding: '8px 16px',
                                                                backgroundColor: '#dc2626',
                                                                color: 'white',
                                                                border: 'none',
                                                                borderRadius: '6px',
                                                                cursor: isProcessing ? 'not-allowed' : 'pointer',
                                                                fontWeight: '500',
                                                                fontSize: '0.9rem',
                                                                opacity: isProcessing ? 0.6 : 1
                                                            }}
                                                        >
                                                            ✕ Refuser
                                                        </button>
                                                    </div>
                                                )}

                                                {/* Delete button - bottom right */}
                                                <div style={{
                                                    display: 'flex',
                                                    justifyContent: 'flex-end',
                                                    marginTop: '12px'
                                                }}>
                                                    {deleteConfirmId === booking.id ? (
                                                        <div style={{
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: '8px',
                                                            padding: '8px 12px',
                                                            backgroundColor: '#fee2e2',
                                                            borderRadius: '6px',
                                                            border: '1px solid #fecaca'
                                                        }}>
                                                            <span style={{
                                                                fontSize: '0.8rem',
                                                                color: '#991b1b',
                                                                fontWeight: '500'
                                                            }}>
                                                                Supprimer définitivement?
                                                            </span>
                                                            <button
                                                                type="button"
                                                                onClick={() => handleDeleteBooking(booking.id)}
                                                                disabled={isProcessing}
                                                                style={{
                                                                    padding: '4px 10px',
                                                                    backgroundColor: '#dc2626',
                                                                    color: 'white',
                                                                    border: 'none',
                                                                    borderRadius: '4px',
                                                                    cursor: isProcessing ? 'not-allowed' : 'pointer',
                                                                    fontWeight: '600',
                                                                    fontSize: '0.75rem',
                                                                    opacity: isProcessing ? 0.6 : 1
                                                                }}
                                                            >
                                                                Oui
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => setDeleteConfirmId(null)}
                                                                disabled={isProcessing}
                                                                style={{
                                                                    padding: '4px 10px',
                                                                    backgroundColor: '#f1f5f9',
                                                                    color: '#334155',
                                                                    border: 'none',
                                                                    borderRadius: '4px',
                                                                    cursor: isProcessing ? 'not-allowed' : 'pointer',
                                                                    fontWeight: '600',
                                                                    fontSize: '0.75rem'
                                                                }}
                                                            >
                                                                Non
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <button
                                                            type="button"
                                                            onClick={() => setDeleteConfirmId(booking.id)}
                                                            disabled={isProcessing}
                                                            style={{
                                                                padding: '4px 10px',
                                                                backgroundColor: '#dc2626',
                                                                color: 'white',
                                                                border: 'none',
                                                                borderRadius: '4px',
                                                                cursor: isProcessing ? 'not-allowed' : 'pointer',
                                                                fontWeight: '500',
                                                                fontSize: '0.75rem',
                                                                opacity: isProcessing ? 0.6 : 1,
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                gap: '4px'
                                                            }}
                                                        >
                                                            🗑️ Supprimer
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {/* Open in Google Calendar link */}
                        <div style={{
                            marginTop: '24px',
                            textAlign: 'center'
                        }}>
                            <a
                                href={`https://calendar.google.com/calendar/u/0/r?cid=${encodeURIComponent(calendarId)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{
                                    color: '#3b82f6',
                                    textDecoration: 'none',
                                    fontSize: '0.9rem',
                                    fontWeight: '500'
                                }}
                            >
                                📆 Ouvrir dans Google Calendar →
                            </a>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ChaletHoraireModal;
