import supabase from './supabase.js';

/**
 * Check if a chalet is available for a given date range
 * Combines both Supabase bookings table and Google Calendar availability
 * 
 * @param {string} chaletId - The chalet key/id
 * @param {string} startDate - ISO format date (YYYY-MM-DD)
 * @param {string} endDate - ISO format date (YYYY-MM-DD)
 * @returns {Promise<{available: boolean, reason?: string}>}
 */
export const checkChaletAvailability = async (chaletId, startDate, endDate) => {
    try {
        console.log('🔍 Checking availability for chalet:', chaletId, 'from', startDate, 'to', endDate);

        // 1️⃣ Check Supabase bookings table for overlapping bookings
        // Logic: A new booking from startDate to endDate conflicts if:
        // - An existing booking starts before the new endDate AND
        // - An existing booking ends after the new startDate
        // Note: We use .gte instead of .gt for end_date because checkout day should be available
        // (checkout at 11am, new checkin at 3pm on same day is OK)
        const { data: overlappingBookings, error: bookingsError } = await supabase
            .from('bookings')
            .select('*')
            .eq('chalet_id', chaletId)
            .eq('status', 'confirmed')
            .lt('start_date', endDate)
            .gt('end_date', startDate);

        if (bookingsError) {
            console.error('❌ Error checking bookings:', bookingsError);
            throw new Error('Failed to check booking availability');
        }

        if (overlappingBookings && overlappingBookings.length > 0) {
            console.log('❌ Found overlapping bookings:', overlappingBookings.length);
            return {
                available: false,
                reason: 'Dates already booked in database'
            };
        }

        // 2️⃣ Check Google Calendar availability
        // First, get the chalet to access its google_calendar ID
        const { data: chalet, error: chaletError } = await supabase
            .from('chalets')
            .select('google_calendar, etablishment_id')
            .eq('key', chaletId)
            .single();

        if (chaletError) {
            console.error('❌ Error fetching chalet:', chaletError);
            throw new Error('Failed to fetch chalet information');
        }

        // If chalet has a Google Calendar, check it for availability
        if (chalet.google_calendar) {
            console.log('📅 Checking Google Calendar:', chalet.google_calendar);

            try {
                const calendarCheckUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chalet-calendar-events`;
                const params = new URLSearchParams({
                    calendar_id: chalet.google_calendar,
                    chalet_id: chaletId,
                    start_date: startDate,
                    end_date: endDate
                });

                const response = await fetch(`${calendarCheckUrl}?${params}`, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
                        'Content-Type': 'application/json'
                    }
                });

                if (!response.ok) {
                    const errorData = await response.json();
                    
                    // If it's just not connected, that's OK - continue without calendar check
                    if (errorData.requiresAuth) {
                        console.log('⚠️ Google Calendar not connected, skipping calendar check');
                    } else {
                        console.error('❌ Calendar check error:', errorData);
                        throw new Error(errorData.error || 'Failed to check Google Calendar');
                    }
                } else {
                    const calendarData = await response.json();
                    
                    // Check if there are any overlapping events
                    if (calendarData.bookings && calendarData.bookings.length > 0) {
                        console.log('❌ Found overlapping Google Calendar events:', calendarData.bookings.length);
                        return {
                            available: false,
                            reason: 'Dates already booked in Google Calendar'
                        };
                    }
                }
            } catch (calendarError) {
                console.warn('⚠️ Could not check Google Calendar:', calendarError.message);
                // Continue - if calendar check fails, rely on database bookings only
            }
        }

        console.log('✅ Chalet is available!');
        return {
            available: true
        };

    } catch (error) {
        console.error('❌ Error in checkChaletAvailability:', error);
        throw error;
    }
};

/**
 * Calculate the total price for a booking
 * 
 * @param {number} pricePerNight - Price per night from chalet data
 * @param {string} startDate - ISO format date (YYYY-MM-DD)
 * @param {string} endDate - ISO format date (YYYY-MM-DD)
 * @returns {{nights: number, subtotal: number, serviceFee: number, total: number}}
 */
export const calculateBookingPrice = (pricePerNight, startDate, endDate) => {
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    // Calculate number of nights
    const diffTime = Math.abs(end - start);
    const nights = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    // Calculate prices
    const subtotal = pricePerNight * nights;
    const serviceFee = 0; // Placeholder for future service fee
    const total = subtotal + serviceFee;
    
    return {
        nights,
        subtotal,
        serviceFee,
        total
    };
};

/**
 * Create a new booking (reservation) in the database AND Google Calendar
 * This is architected to be payment-ready:
 * - Status starts as "pending"
 * - Can be upgraded to "confirmed" after payment
 * - Source is "website" for user-initiated bookings
 * - Automatically creates Google Calendar event if chalet has calendar
 * 
 * @param {Object} bookingData
 * @param {string} bookingData.chaletId - The chalet key
 * @param {string} bookingData.startDate - ISO format date
 * @param {string} bookingData.endDate - ISO format date
 * @param {string} bookingData.customerName - Guest name
 * @param {string} bookingData.customerEmail - Guest email
 * @param {string} bookingData.notes - Optional booking notes
 * @returns {Promise<Object>} The created booking
 */
export const createBooking = async (bookingData) => {
    try {
        console.log('📝 Creating booking:', bookingData);

        // Double-check availability before creating booking
        const availabilityCheck = await checkChaletAvailability(
            bookingData.chaletId,
            bookingData.startDate,
            bookingData.endDate
        );

        if (!availabilityCheck.available) {
            throw new Error(availabilityCheck.reason || 'Chalet is not available for selected dates');
        }

        // Create the booking record (source of truth)
        const { data: booking, error: bookingError } = await supabase
            .from('bookings')
            .insert([{
                chalet_id: bookingData.chaletId,
                start_date: bookingData.startDate,
                end_date: bookingData.endDate,
                status: 'pending', // Payment-ready: starts as pending
                source: 'website', // Indicates this came from the website, not Google Calendar
                customer_name: bookingData.customerName,
                customer_email: bookingData.customerEmail,
                notes: bookingData.notes || null,
                google_event_id: null // Will be populated after Google Calendar sync
            }])
            .select()
            .single();

        if (bookingError) {
            console.error('❌ Error creating booking:', bookingError);
            throw new Error('Failed to create booking: ' + bookingError.message);
        }

        console.log('✅ Booking created in database:', booking);

        // Sync to Google Calendar (non-blocking - if it fails, booking is still created)
        syncBookingToGoogleCalendar(booking).catch(error => {
            console.warn('⚠️ Failed to sync to Google Calendar (booking still valid):', error);
        });

        return booking;

    } catch (error) {
        console.error('❌ Error in createBooking:', error);
        throw error;
    }
};

/**
 * Sync a booking to Google Calendar
 * Creates an event in the chalet's Google Calendar
 * 
 * @param {Object} booking - The booking object from database
 * @returns {Promise<void>}
 */
/**
 * @param {Object} booking
 * @param {Object} [options]
 * @param {string} [options.accessToken] — JWT session (recommended for Edge Function invoke)
 * @returns {Promise<{ ok: boolean, skipped?: string, error?: string, event_id?: string }>}
 */
export const syncBookingToGoogleCalendar = async (booking, options = {}) => {
    const accessToken = options.accessToken;
    const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;

    try {
        console.log('📅 Syncing booking to Google Calendar:', booking.id);

        const { data: chalet, error: chaletError } = await supabase
            .from('chalets')
            .select('google_calendar, Name')
            .eq('key', booking.chalet_id)
            .single();

        if (chaletError || !chalet) {
            console.log('⏭️ Chalet not found or no access, skipping Google sync');
            return { ok: false, skipped: 'chalet_not_found' };
        }

        if (!chalet.google_calendar) {
            console.log('⏭️ No Google Calendar connected for this chalet, skipping sync');
            return { ok: false, skipped: 'no_chalet_calendar' };
        }

        const authBearer = accessToken || anon;

        const response = await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-booking-calendar-event`,
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${authBearer}`,
                    apikey: anon,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    booking_id: booking.id,
                    calendar_id: chalet.google_calendar,
                    chalet_name: chalet.Name,
                    start_date: booking.start_date,
                    end_date: booking.end_date,
                    customer_name: booking.customer_name,
                    customer_email: booking.customer_email,
                    notes: booking.notes,
                }),
            },
        );

        const payload = await response.json().catch(() => ({}));

        if (!response.ok) {
            console.warn('⚠️ Google Calendar sync failed:', payload);
            const detail =
                payload.details ||
                payload.message ||
                (typeof payload === 'string' ? payload : '');
            const base =
                payload.error ||
                payload.message ||
                `HTTP ${response.status}`;
            return {
                ok: false,
                error: detail ? `${base} — ${detail}` : base,
                requiresAuth: Boolean(payload.requiresAuth),
            };
        }

        const result = payload;
        console.log('✅ Booking synced to Google Calendar:', result.event_id);

        if (result.event_id) {
            const { error: updateError } = await supabase
                .from('bookings')
                .update({ google_event_id: result.event_id })
                .eq('id', booking.id);

            if (updateError) {
                console.warn('⚠️ Failed to update booking with Google event ID:', updateError);
            }
        }

        return { ok: true, event_id: result.event_id };
    } catch (error) {
        console.error('❌ Error syncing to Google Calendar:', error);
        return { ok: false, error: error.message || String(error) };
    }
};

/**
 * Confirm a booking (for future payment integration)
 * This would be called after successful payment
 * Also updates the Google Calendar event if it exists
 * 
 * @param {number} bookingId - The booking ID
 * @returns {Promise<Object>} The updated booking
 */
export const confirmBooking = async (bookingId) => {
    try {
        const { data: booking, error } = await supabase
            .from('bookings')
            .update({ status: 'confirmed' })
            .eq('id', bookingId)
            .select()
            .single();

        if (error) throw error;
        
        console.log('✅ Booking confirmed:', booking);

        // Update Google Calendar event title if it exists
        if (booking.google_event_id) {
            updateGoogleCalendarEventStatus(booking, 'confirmed').catch(err => {
                console.warn('⚠️ Failed to update Google Calendar event:', err);
            });
        }

        return booking;

    } catch (error) {
        console.error('❌ Error confirming booking:', error);
        throw error;
    }
};

/**
 * Cancel a booking (for future payment integration)
 * This would be called if payment fails or user cancels
 * Also deletes or updates the Google Calendar event
 * 
 * @param {number} bookingId - The booking ID
 * @param {boolean} deleteFromCalendar - Whether to delete the event from Google Calendar (default: true)
 * @returns {Promise<Object>} The updated booking
 */
export const cancelBooking = async (bookingId, deleteFromCalendar = true) => {
    try {
        // Get booking first to access google_event_id
        const { data: existingBooking, error: fetchError } = await supabase
            .from('bookings')
            .select('*')
            .eq('id', bookingId)
            .single();

        if (fetchError) throw fetchError;

        const { data: booking, error } = await supabase
            .from('bookings')
            .update({ status: 'cancelled' })
            .eq('id', bookingId)
            .select()
            .single();

        if (error) throw error;
        
        console.log('🚫 Booking cancelled:', booking);

        // Delete or update Google Calendar event
        if (existingBooking.google_event_id && deleteFromCalendar) {
            deleteGoogleCalendarEvent(existingBooking).catch(err => {
                console.warn('⚠️ Failed to delete Google Calendar event:', err);
            });
        }

        return booking;

    } catch (error) {
        console.error('❌ Error cancelling booking:', error);
        throw error;
    }
};

/**
 * Update Google Calendar event status
 * @param {Object} booking - The booking object
 * @param {string} status - The new status
 */
const updateGoogleCalendarEventStatus = (booking, status) => {
    console.log('📅 Would update Google Calendar event:', booking.google_event_id, 'to status:', status);
    // Updating chalet calendar event titles requires a dedicated edge function
    // (needs establishment OAuth token). Not yet implemented — returns a resolved
    // promise so the .catch() call in confirmBooking() does not throw a TypeError.
    return Promise.resolve();
};

/**
 * Delete Google Calendar event
 * @param {Object} booking - The booking object
 */
const deleteGoogleCalendarEvent = async (booking) => {
    try {
        console.log('🗑️ Deleting Google Calendar event:', booking.google_event_id);
        
        const { data: chalet } = await supabase
            .from('chalets')
            .select('google_calendar, etablishment_id')
            .eq('key', booking.chalet_id)
            .single();

        if (!chalet || !chalet.google_calendar) {
            console.log('⏭️ No Google Calendar for this chalet');
            return;
        }

        // Call edge function to delete event
        const response = await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/delete-booking-calendar-event`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    event_id: booking.google_event_id,
                    calendar_id: chalet.google_calendar,
                    establishment_id: chalet.etablishment_id
                })
            }
        );

        if (response.ok) {
            console.log('✅ Google Calendar event deleted');
        } else {
            console.warn('⚠️ Failed to delete Google Calendar event');
        }
    } catch (error) {
        console.error('❌ Error deleting Google Calendar event:', error);
    }
};

/**
 * Get all bookings for a specific chalet
 * 
 * @param {string} chaletId - The chalet key
 * @returns {Promise<Array>} Array of bookings
 */
export const getChaletBookings = async (chaletId) => {
    try {
        const { data: bookings, error } = await supabase
            .from('bookings')
            .select('*')
            .eq('chalet_id', chaletId)
            .order('start_date', { ascending: true });

        if (error) throw error;
        
        return bookings || [];

    } catch (error) {
        console.error('❌ Error fetching chalet bookings:', error);
        throw error;
    }
};

/** Normalise YYYY-MM-DD → ISO pour insertion cohérente avec les autres réservations. */
function ymdToUtcMidnightIso(ymd) {
    const s = String(ymd).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        throw new Error(`Date invalide (attendu AAAA-MM-JJ): ${ymd}`);
    }
    return `${s}T00:00:00.000Z`;
}

/**
 * Liste les réservations pour plusieurs chalets (RLS établissement).
 */
export const getBookingsForChaletIds = async (chaletIds, options = {}) => {
    if (!chaletIds?.length) return [];
    const limit = options.limit ?? 300;
    let q = supabase
        .from('bookings')
        .select('*')
        .in('chalet_id', chaletIds)
        .order('start_date', { ascending: false })
        .limit(limit);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return data || [];
};

/**
 * Création par le propriétaire (migration / saisie manuelle). Pas de commission plateforme.
 * @param {Object} o
 * @param {boolean} [o.skipOverlapCheck=false] — pour import bulk migration : ignorer dispo
 * @param {boolean} [o.syncToGoogle=true]
 */
export const createEstablishmentManualBooking = async (o) => {
    const {
        chaletId,
        startDateYmd,
        endDateYmd,
        customerName,
        customerEmail,
        notes,
        status = 'confirmed',
        skipOverlapCheck = false,
        syncToGoogle = true,
        source = 'migration',
    } = o;

    if (!chaletId) throw new Error('Chalet requis');
    if (!customerName?.trim()) throw new Error('Nom du client requis');

    const startIso = ymdToUtcMidnightIso(startDateYmd);
    const endIso = ymdToUtcMidnightIso(endDateYmd);
    if (new Date(endIso) <= new Date(startIso)) {
        throw new Error('La date de fin doit être après la date de début.');
    }

    if (!skipOverlapCheck) {
        const availabilityCheck = await checkChaletAvailability(chaletId, startIso, endIso);
        if (!availabilityCheck.available) {
            throw new Error(availabilityCheck.reason || 'Dates non disponibles');
        }
    }

    const insertPayload = {
        chalet_id: chaletId,
        start_date: startIso,
        end_date: endIso,
        status,
        source,
        customer_name: customerName.trim(),
        customer_email: customerEmail?.trim() || null,
        notes: notes?.trim() || null,
        booking_origin: 'establishment_manual',
        platform_fee_amount: 0,
        platform_fee_waived: true,
        payment_status: 'paid',
    };

    const { data: booking, error: bookingError } = await supabase
        .from('bookings')
        .insert([insertPayload])
        .select()
        .single();

    if (bookingError) {
        console.error('createEstablishmentManualBooking:', bookingError);
        throw new Error(bookingError.message || 'Impossible de créer la réservation');
    }

    let googleSync = { ok: true, skipped: syncToGoogle ? undefined : 'sync_disabled' };
    if (syncToGoogle) {
        const session = (await supabase.auth.getSession()).data.session;
        googleSync = await syncBookingToGoogleCalendar(booking, {
            accessToken: session?.access_token,
        });
    }

    return { booking, googleSync };
};

/**
 * Import plusieurs réservations ; renvoie inserted count et erreurs par ligne.
 */
export const importEstablishmentBookingsBatch = async (rows, resolveChaletId, options = {}) => {
    const syncToGoogle = options.syncToGoogle === true;
    const errors = [];
    let inserted = 0;

    for (let i = 0; i < rows.length; i += 1) {
        const r = rows[i];
        try {
            const chaletId = typeof resolveChaletId === 'function' ? resolveChaletId(r) : r.chaletId;
            if (!chaletId) {
                errors.push({ row: i + 1, message: 'Chalet introuvable' });
                continue;
            }
            if (!r.customerName?.trim()) {
                errors.push({ row: i + 1, message: 'Nom client vide' });
                continue;
            }
            await createEstablishmentManualBooking({
                chaletId,
                startDateYmd: r.startDateYmd,
                endDateYmd: r.endDateYmd,
                customerName: r.customerName,
                customerEmail: r.customerEmail,
                notes: r.notes,
                skipOverlapCheck: true,
                syncToGoogle,
                source: 'migration',
            });
            inserted += 1;
        } catch (err) {
            errors.push({ row: i + 1, message: err.message || String(err) });
        }
    }

    return { inserted, errors };
};
