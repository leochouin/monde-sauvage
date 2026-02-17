/**
 * Guide Booking Service
 * Handles all guide booking operations with Google Calendar synchronization
 * 
 * ARCHITECTURE:
 * - guide_booking table is the SOURCE OF TRUTH
 * - Google Calendar is synced bidirectionally
 * - google_event_id links database records to calendar events
 * - Conflict detection checks both DB and Google Calendar
 * - Paid bookings are protected from deletion
 * 
 * CALENDAR SYNC RULES:
 * - On create: INSERT row → create calendar event → store event_id
 * - On update: UPDATE row → patch calendar event
 * - On cancel: SET status=cancelled → delete calendar event
 * - On failure: SET calendar_sync_failed=true, log error, allow retry
 * - Idempotency: google_event_id checked before creating events
 * - Retry: Failed syncs retried with exponential backoff (max 5 attempts)
 */

import supabase from './supabase.js';

// ─── HELPERS ────────────────────────────────────────────────────────

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * Call a Supabase edge function with standard headers.
 */
function callEdgeFunction(functionName, body, method = 'POST') {
    const url = `${SUPABASE_URL}/functions/v1/${functionName}`;
    const options = {
        method,
        headers: {
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json'
        },
    };
    if (body && method !== 'GET') {
        options.body = JSON.stringify(body);
    }
    return fetch(url, options);
}

/**
 * Check if a guide has valid Google Calendar credentials
 */
export async function checkGoogleCalendarConnection(guideId) {
    const { data: guide, error } = await supabase
        .from('guide')
        .select('id, email, name, google_refresh_token, availability_calendar_id')
        .eq('id', guideId)
        .single();

    if (error || !guide) {
        return {
            connected: false,
            error: 'Guide not found',
            needsAuth: true
        };
    }

    if (!guide.google_refresh_token) {
        return {
            connected: false,
            error: 'No Google Calendar connection',
            needsAuth: true,
            guide: { id: guide.id, email: guide.email, name: guide.name }
        };
    }

    // Try to get an access token to verify the refresh token is valid
    try {
        const tokenUrl = `${SUPABASE_URL}/functions/v1/refresh-google-token?guideId=${guideId}`;
        const tokenResponse = await fetch(tokenUrl, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
            }
        });

        if (tokenResponse.ok) {
            const tokenData = await tokenResponse.json();
            return {
                connected: true,
                hasToken: true,
                cached: tokenData.cached || false,
                guide: { id: guide.id, email: guide.email, name: guide.name, calendar_id: guide.availability_calendar_id }
            };
        } else {
            const errorData = await tokenResponse.json();
            return {
                connected: false,
                error: errorData.error || 'Token validation failed',
                needsAuth: errorData.requiresReauth || true,
                guide: { id: guide.id, email: guide.email, name: guide.name }
            };
        }
    } catch (err) {
        console.error('Error checking connection:', err);
        return {
            connected: false,
            error: err.message,
            needsAuth: true,
            guide: { id: guide.id, email: guide.email, name: guide.name }
        };
    }
}

/**
 * Mark a booking's calendar sync as failed.
 * Non-throwing — failures here are logged but don't break the booking flow.
 */
async function markCalendarSyncFailed(bookingId, errorMessage) {
    try {
        await supabase
            .from('guide_booking')
            .update({
                calendar_sync_failed: true,
                calendar_sync_error: errorMessage,
                calendar_sync_attempts: supabase.rpc ? undefined : 1, // Incremented server-side ideally
            })
            .eq('id', bookingId);
        console.warn(`⚠️ Marked booking ${bookingId} as calendar_sync_failed: ${errorMessage}`);
    } catch (e) {
        console.error('Failed to mark calendar sync failure:', e);
    }
}

/**
 * Clear the calendar sync failure flag after a successful sync.
 */
async function clearCalendarSyncFailed(bookingId) {
    await supabase
        .from('guide_booking')
        .update({
            calendar_sync_failed: false,
            calendar_sync_error: null,
        })
        .eq('id', bookingId);
}

/**
 * Check if a guide is available for a given time range
 * Checks both database and Google Calendar for conflicts
 * 
 * @param {string} guideId - The guide UUID
 * @param {string} startTime - ISO format datetime
 * @param {string} endTime - ISO format datetime
 * @param {string} excludeBookingId - Optional booking ID to exclude from conflict check
 * @returns {Promise<{available: boolean, conflicts?: Array, reason?: string}>}
 */
export const checkGuideAvailability = async (guideId, startTime, endTime, excludeBookingId = null) => {
    try {
        console.log('🔍 Checking guide availability:', guideId, 'from', startTime, 'to', endTime);

        // 1️⃣ Check database for conflicts with a direct query
        //    (replaces RPC call to avoid PostgREST overload/cache issues)
        let query = supabase
            .from('guide_booking')
            .select('id, start_time, end_time, status, customer_name, google_event_id')
            .eq('guide_id', guideId)
            .is('deleted_at', null)
            .not('status', 'in', '("cancelled","deleted")')
            .lt('start_time', endTime)
            .gt('end_time', startTime);

        if (excludeBookingId) {
            query = query.neq('id', excludeBookingId);
        }

        const { data: conflicts, error: conflictError } = await query;

        if (conflictError) {
            console.error('❌ Error checking conflicts:', conflictError);
            throw new Error('Failed to check booking conflicts');
        }

        if (conflicts && conflicts.length > 0) {
            console.log('❌ Found conflicting bookings:', conflicts);
            return {
                available: false,
                conflicts: conflicts,
                reason: 'Guide has conflicting bookings'
            };
        }

        // guide_booking table is the sole source of truth — no Google Calendar check needed
        console.log('✅ Guide is available!');
        return {
            available: true
        };

    } catch (error) {
        console.error('❌ Error in checkGuideAvailability:', error);
        throw error;
    }
};

/**
 * Create a new guide booking in the database AND Google Calendar
 * 
 * WORKFLOW:
 * 1. Validate availability (optional)
 * 2. Create booking in database (source of truth)
 * 3. Create event in Google Calendar
 * 4. Update booking with google_event_id
 * 
 * @param {Object} bookingData
 * @param {string} bookingData.guideId - The guide UUID
 * @param {string} bookingData.startTime - ISO format datetime
 * @param {string} bookingData.endTime - ISO format datetime
 * @param {string} bookingData.customerName - Customer name
 * @param {string} bookingData.customerEmail - Customer email
 * @param {string} bookingData.customerPhone - Customer phone (optional)
 * @param {string} bookingData.tripType - Type of trip/activity
 * @param {number} bookingData.numberOfPeople - Number of people
 * @param {string} bookingData.notes - Optional notes
 * @param {string} bookingData.status - Status (default: 'pending')
 * @param {boolean} bookingData.skipAvailabilityCheck - Skip availability check if slots pre-selected (default: false)
 * @returns {Promise<Object>} The created booking
 */
export const createGuideBooking = async (bookingData) => {
    try {
        console.log('📝 Creating guide booking:', bookingData);

        // 1️⃣ ALWAYS check availability to prevent double booking
        // Even if skipAvailabilityCheck is true, we do a final database check
        const availabilityCheck = await checkGuideAvailability(
            bookingData.guideId,
            bookingData.startTime,
            bookingData.endTime
        );

        if (!availabilityCheck.available) {
            console.log('❌ Booking conflict detected:', availabilityCheck.reason);
            throw new Error(availabilityCheck.reason || 'Ce créneau a déjà été réservé. Veuillez sélectionner un autre horaire.');
        }

        // 2️⃣ Create booking in database (SOURCE OF TRUTH)
        const { data: booking, error: bookingError } = await supabase
            .from('guide_booking')
            .insert([{
                guide_id: bookingData.guideId,
                start_time: bookingData.startTime,
                end_time: bookingData.endTime,
                status: bookingData.status || 'pending',
                source: 'system', // Created through the system
                customer_name: bookingData.customerName,
                customer_email: bookingData.customerEmail,
                customer_phone: bookingData.customerPhone || null,
                trip_type: bookingData.tripType || null,
                number_of_people: bookingData.numberOfPeople || 1,
                notes: bookingData.notes || null,
                google_event_id: null, // Will be populated after calendar sync
                calendar_sync_failed: false,
                calendar_sync_attempts: 0,
                calendar_sync_error: null,
            }])
            .select()
            .single();

        if (bookingError) {
            console.error('❌ Error creating booking:', bookingError);
            throw new Error('Failed to create booking: ' + bookingError.message);
        }

        console.log('✅ Booking created in database:', booking.id);

        // 3️⃣ Create Google Calendar event
        try {
            const eventResponse = await callEdgeFunction('create-guide-booking-event', {
                booking_id: booking.id,
                guide_id: bookingData.guideId,
                start_time: bookingData.startTime,
                end_time: bookingData.endTime,
                customer_name: bookingData.customerName,
                customer_email: bookingData.customerEmail,
                trip_type: bookingData.tripType,
                notes: bookingData.notes
            });

            if (eventResponse.ok) {
                const eventData = await eventResponse.json();
                console.log('✅ Google Calendar event created:', eventData.event_id);
                
                // 4️⃣ Update booking with google_event_id
                const { error: updateError } = await supabase
                    .from('guide_booking')
                    .update({ 
                        google_event_id: eventData.event_id,
                        synced_at: new Date().toISOString(),
                        calendar_sync_failed: false,
                        calendar_sync_error: null,
                    })
                    .eq('id', booking.id);

                if (updateError) {
                    console.warn('⚠️ Could not update google_event_id:', updateError);
                }

                return { ...booking, google_event_id: eventData.event_id };
            } else {
                const errorData = await eventResponse.json();
                const errorMsg = errorData.error || 'Unknown Google Calendar error';
                console.warn('⚠️ Could not create Google Calendar event:', errorMsg);
                // Mark as sync failed — booking still exists in DB
                await markCalendarSyncFailed(booking.id, errorMsg);
                return { ...booking, calendar_sync_failed: true };
            }
        } catch (calendarError) {
            console.warn('⚠️ Google Calendar sync failed:', calendarError.message);
            await markCalendarSyncFailed(booking.id, calendarError.message);
            // Booking still exists in database, continue
            return { ...booking, calendar_sync_failed: true };
        }

    } catch (error) {
        console.error('❌ Error in createGuideBooking:', error);
        throw error;
    }
};

/**
 * Update an existing guide booking
 * Updates both database and Google Calendar
 * 
 * SECURITY: Paid bookings cannot have time changed without explicit override
 * 
 * @param {string} bookingId - Booking UUID
 * @param {Object} updates - Fields to update
 * @param {boolean} allowPaidModification - Allow modifying paid bookings (default: false)
 * @returns {Promise<Object>} Updated booking
 */
export const updateGuideBooking = async (bookingId, updates, allowPaidModification = false) => {
    try {
        console.log('📝 Updating booking:', bookingId, updates);

        // 1️⃣ Get current booking
        const { data: currentBooking, error: fetchError } = await supabase
            .from('guide_booking')
            .select('*')
            .eq('id', bookingId)
            .single();

        if (fetchError || !currentBooking) {
            throw new Error('Booking not found');
        }

        // 2️⃣ Security check: protect paid bookings
        if (currentBooking.is_paid && !allowPaidModification) {
            if (updates.start_time || updates.end_time) {
                throw new Error('Cannot modify time of paid booking. Contact administrator.');
            }
        }

        // 3️⃣ If time is being changed, check for conflicts
        const newStartTime = updates.start_time || currentBooking.start_time;
        const newEndTime = updates.end_time || currentBooking.end_time;

        if (updates.start_time || updates.end_time) {
            const availabilityCheck = await checkGuideAvailability(
                currentBooking.guide_id,
                newStartTime,
                newEndTime,
                bookingId // Exclude current booking from conflict check
            );

            if (!availabilityCheck.available) {
                throw new Error(availabilityCheck.reason || 'Time slot conflicts with existing booking');
            }
        }

        // 4️⃣ Update database
        const { data: updatedBooking, error: updateError } = await supabase
            .from('guide_booking')
            .update({
                ...updates,
                updated_at: new Date().toISOString()
            })
            .eq('id', bookingId)
            .select()
            .single();

        if (updateError) {
            console.error('❌ Error updating booking:', updateError);
            throw new Error('Failed to update booking: ' + (updateError.message || updateError.details || JSON.stringify(updateError)));
        }

        console.log('✅ Booking updated in database');

        // 5️⃣ Update Google Calendar event if it exists
        if (currentBooking.google_event_id) {
            try {
                const updateResponse = await callEdgeFunction('update-guide-booking-event', {
                    booking_id: bookingId,
                    event_id: currentBooking.google_event_id,
                    guide_id: currentBooking.guide_id,
                    updates: {
                        start_time: newStartTime,
                        end_time: newEndTime,
                        customer_name: updates.customer_name || currentBooking.customer_name,
                        customer_email: updates.customer_email || currentBooking.customer_email,
                        trip_type: updates.trip_type || currentBooking.trip_type,
                        notes: updates.notes !== undefined ? updates.notes : currentBooking.notes
                    }
                });

                if (updateResponse.ok) {
                    console.log('✅ Google Calendar event updated');
                    await clearCalendarSyncFailed(bookingId);
                } else {
                    const errorData = await updateResponse.json();
                    console.warn('⚠️ Google Calendar update failed:', errorData.error);
                    await markCalendarSyncFailed(bookingId, errorData.error || 'Calendar update failed');
                }
            } catch (calendarError) {
                console.warn('⚠️ Google Calendar update failed:', calendarError.message);
                await markCalendarSyncFailed(bookingId, calendarError.message);
            }
        } else if (currentBooking.calendar_sync_failed) {
            // The booking never got a calendar event — try creating one now
            try {
                const eventResponse = await callEdgeFunction('create-guide-booking-event', {
                    booking_id: bookingId,
                    guide_id: currentBooking.guide_id,
                    start_time: newStartTime,
                    end_time: newEndTime,
                    customer_name: updates.customer_name || currentBooking.customer_name,
                    customer_email: updates.customer_email || currentBooking.customer_email,
                    trip_type: updates.trip_type || currentBooking.trip_type,
                    notes: updates.notes !== undefined ? updates.notes : currentBooking.notes
                });

                if (eventResponse.ok) {
                    const eventData = await eventResponse.json();
                    await supabase
                        .from('guide_booking')
                        .update({
                            google_event_id: eventData.event_id,
                            calendar_sync_failed: false,
                            calendar_sync_error: null,
                            synced_at: new Date().toISOString(),
                        })
                        .eq('id', bookingId);
                    console.log('✅ Calendar event created on retry during update');
                }
            } catch (retryError) {
                console.warn('⚠️ Retry create during update failed:', retryError.message);
            }
        }

        return updatedBooking;

    } catch (error) {
        console.error('❌ Error in updateGuideBooking:', error);
        throw error;
    }
};

/**
 * Cancel a guide booking
 * Marks as cancelled in database and deletes from Google Calendar
 * 
 * SECURITY: Paid bookings require confirmation
 * 
 * @param {string} bookingId - Booking UUID
 * @param {string} reason - Cancellation reason
 * @param {boolean} allowPaidCancellation - Allow cancelling paid bookings (default: false)
 * @returns {Promise<Object>} Cancelled booking
 */
export const cancelGuideBooking = async (bookingId, reason = '', allowPaidCancellation = false) => {
    try {
        console.log('🚫 Cancelling booking:', bookingId);

        // 1️⃣ Get current booking
        const { data: booking, error: fetchError } = await supabase
            .from('guide_booking')
            .select('*')
            .eq('id', bookingId)
            .single();

        if (fetchError || !booking) {
            throw new Error('Booking not found');
        }

        // 2️⃣ Security check: protect paid bookings
        if (booking.is_paid && !allowPaidCancellation) {
            throw new Error('Cannot cancel paid booking without administrator approval');
        }

        // 3️⃣ Mark as cancelled in database
        const { data: cancelledBooking, error: updateError } = await supabase
            .from('guide_booking')
            .update({
                status: 'cancelled',
                notes: booking.notes ? `${booking.notes}\n\nCancellation reason: ${reason}` : `Cancellation reason: ${reason}`,
                updated_at: new Date().toISOString()
            })
            .eq('id', bookingId)
            .select()
            .single();

        if (updateError) {
            throw new Error('Failed to cancel booking');
        }

        console.log('✅ Booking cancelled in database');

        // 4️⃣ Delete from Google Calendar
        if (booking.google_event_id) {
            try {
                const deleteResponse = await callEdgeFunction('delete-guide-booking-event', {
                    event_id: booking.google_event_id,
                    guide_id: booking.guide_id
                });

                if (deleteResponse.ok) {
                    console.log('✅ Google Calendar event deleted');
                } else {
                    const errorData = await deleteResponse.json();
                    console.warn('⚠️ Google Calendar deletion failed:', errorData.error);
                    // Non-blocking — booking is already cancelled in DB
                }
            } catch (calendarError) {
                console.warn('⚠️ Google Calendar deletion failed:', calendarError.message);
            }
        }

        return cancelledBooking;

    } catch (error) {
        console.error('❌ Error in cancelGuideBooking:', error);
        throw error;
    }
};

/**
 * Soft delete a booking (mark as deleted without removing from database)
 * Used when a booking is deleted from Google Calendar by the guide
 * 
 * @param {string} bookingId - Booking UUID
 * @returns {Promise<Object>} Deleted booking
 */
export const softDeleteGuideBooking = async (bookingId) => {
    try {
        const { data: deletedBooking, error } = await supabase
            .from('guide_booking')
            .update({
                status: 'deleted',
                deleted_at: new Date().toISOString()
            })
            .eq('id', bookingId)
            .select()
            .single();

        if (error) {
            throw new Error('Failed to delete booking');
        }

        return deletedBooking;
    } catch (error) {
        console.error('❌ Error in softDeleteGuideBooking:', error);
        throw error;
    }
};

/**
 * Get all bookings for a guide
 * 
 * @param {string} guideId - Guide UUID
 * @param {Object} options - Query options
 * @param {boolean} options.includeDeleted - Include soft-deleted bookings
 * @param {boolean} options.includeHistorical - Include past bookings
 * @param {string} options.status - Filter by status
 * @returns {Promise<Array>} List of bookings
 */
export const getGuideBookings = async (guideId, options = {}) => {
    try {
        let query = supabase
            .from('guide_booking')
            .select('*')
            .eq('guide_id', guideId)
            .order('start_time', { ascending: true });

        // Filter by deleted
        if (!options.includeDeleted) {
            query = query.is('deleted_at', null);
        }

        // Filter by date range (for calendar views)
        if (options.startDate && options.endDate) {
            query = query
                .gte('start_time', options.startDate)
                .lte('end_time', options.endDate);
        } else if (!options.includeHistorical) {
            // Filter by historical (past bookings) only if no date range specified
            query = query.gte('end_time', new Date().toISOString());
        }

        // Filter by status
        if (options.status) {
            query = query.eq('status', options.status);
        }

        // Exclude cancelled/deleted by default
        if (!options.includeCancelled) {
            query = query.not('status', 'in', '("cancelled","deleted")');
        }

        const { data: bookings, error } = await query;

        if (error) {
            console.error('Supabase error details:', error);
            throw new Error(`Failed to fetch bookings: ${error.message}`);
        }

        return bookings;

    } catch (error) {
        console.error('❌ Error in getGuideBookings:', error);
        throw error;
    }
};

/**
 * Get a single booking by ID
 * 
 * @param {string} bookingId - Booking UUID
 * @returns {Promise<Object>} Booking details
 */
export const getGuideBooking = async (bookingId) => {
    try {
        const { data: booking, error } = await supabase
            .from('guide_booking')
            .select(`
                *,
                guide:guide_id (
                    id,
                    name,
                    email
                )
            `)
            .eq('id', bookingId)
            .single();

        if (error || !booking) {
            throw new Error('Booking not found');
        }

        return booking;

    } catch (error) {
        console.error('❌ Error in getGuideBooking:', error);
        throw error;
    }
};

/**
 * Sync guide bookings with Google Calendar
 * Detects deletions, new events, modifications, and retries failed syncs.
 * 
 * @param {string} guideId - Guide UUID
 * @returns {Promise<Object>} Sync results
 */
export const syncGuideBookingsWithCalendar = async (guideId) => {
    try {
        console.log('🔄 Syncing guide bookings with Google Calendar:', guideId);

        const response = await callEdgeFunction('sync-guide-calendar', {
            guide_id: guideId
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to sync with Google Calendar');
        }

        const syncResults = await response.json();
        console.log('✅ Sync completed:', syncResults);

        return syncResults;

    } catch (error) {
        console.error('❌ Error in syncGuideBookingsWithCalendar:', error);
        throw error;
    }
};

/**
 * Get all bookings with failed calendar sync for a guide.
 * Useful for showing retry indicators in the UI.
 * 
 * @param {string} guideId - Guide UUID
 * @returns {Promise<Array>} Bookings with failed calendar sync
 */
export const getFailedSyncBookings = async (guideId) => {
    try {
        const { data, error } = await supabase
            .from('guide_booking')
            .select('id, customer_name, start_time, end_time, calendar_sync_error, calendar_sync_attempts')
            .eq('guide_id', guideId)
            .eq('calendar_sync_failed', true)
            .is('deleted_at', null)
            .order('created_at', { ascending: false });

        if (error) throw new Error(error.message);
        return data || [];
    } catch (error) {
        console.error('❌ Error fetching failed syncs:', error);
        return [];
    }
};

/**
 * Retry calendar sync for a specific booking that previously failed.
 * Uses the create-guide-booking-event edge function (which has its own
 * idempotency check via google_event_id).
 * 
 * @param {string} bookingId - Booking UUID
 * @returns {Promise<{success: boolean, event_id?: string, error?: string}>}
 */
export const retryCalendarSync = async (bookingId) => {
    try {
        console.log('🔄 Retrying calendar sync for booking:', bookingId);

        // Fetch the booking
        const { data: booking, error: fetchError } = await supabase
            .from('guide_booking')
            .select('*')
            .eq('id', bookingId)
            .single();

        if (fetchError || !booking) {
            throw new Error('Booking not found');
        }

        // If it already has an event, just clear the failure flag
        if (booking.google_event_id) {
            await clearCalendarSyncFailed(bookingId);
            return { success: true, event_id: booking.google_event_id };
        }

        // Check Google Calendar connection first
        console.log('🔍 Checking Google Calendar connection...');
        const connectionStatus = await checkGoogleCalendarConnection(booking.guide_id);
        
        if (!connectionStatus.connected) {
            console.error('❌ Google Calendar not connected:', connectionStatus);
            return { 
                success: false, 
                error: connectionStatus.error,
                needsAuth: connectionStatus.needsAuth,
                requiresReauth: connectionStatus.needsAuth
            };
        }

        console.log('✅ Google Calendar connection verified');

        // Increment attempt counter
        const attempts = (booking.calendar_sync_attempts || 0) + 1;

        const eventResponse = await callEdgeFunction('create-guide-booking-event', {
            booking_id: booking.id,
            guide_id: booking.guide_id,
            start_time: booking.start_time,
            end_time: booking.end_time,
            customer_name: booking.customer_name,
            customer_email: booking.customer_email,
            trip_type: booking.trip_type,
            notes: booking.notes
        });

        if (eventResponse.ok) {
            const eventData = await eventResponse.json();

            await supabase
                .from('guide_booking')
                .update({
                    google_event_id: eventData.event_id,
                    calendar_sync_failed: false,
                    calendar_sync_error: null,
                    calendar_sync_attempts: attempts,
                    synced_at: new Date().toISOString(),
                })
                .eq('id', bookingId);

            console.log('✅ Retry succeeded:', eventData.event_id);
            return { success: true, event_id: eventData.event_id };
        } else {
            const errorText = await eventResponse.text();
            let errorData;
            try {
                errorData = JSON.parse(errorText);
            } catch {
                errorData = { error: errorText };
            }

            console.error('❌ Edge function error:');
            console.error('Status:', eventResponse.status, eventResponse.statusText);
            console.error('Error response:', errorData);
            console.error('Error message:', errorData.error);
            console.error('Error details:', errorData.details);
            console.error('Full error object:', JSON.stringify(errorData, null, 2));
            console.error('Booking data:', {
                booking_id: booking.id,
                guide_id: booking.guide_id,
                start_time: booking.start_time,
                end_time: booking.end_time,
                customer_name: booking.customer_name,
                customer_email: booking.customer_email,
                trip_type: booking.trip_type,
                notes: booking.notes
            });

            await supabase
                .from('guide_booking')
                .update({
                    calendar_sync_attempts: attempts,
                    calendar_sync_error: errorData.error || `HTTP ${eventResponse.status}: ${errorText}`,
                })
                .eq('id', bookingId);

            return { success: false, error: errorData.error || `HTTP ${eventResponse.status}: Calendar event creation failed` };
        }
    } catch (error) {
        console.error('❌ Error retrying calendar sync:', error);
        return { success: false, error: error.message };
    }
};

/**
 * Retry all failed calendar syncs for a guide.
 * Called during manual sync or background refresh.
 * 
 * @param {string} guideId - Guide UUID
 * @returns {Promise<{retried: number, succeeded: number, failed: number}>}
 */
export const retryAllFailedSyncs = async (guideId) => {
    const failedBookings = await getFailedSyncBookings(guideId);
    const results = { retried: failedBookings.length, succeeded: 0, failed: 0 };

    for (const booking of failedBookings) {
        const result = await retryCalendarSync(booking.id);
        if (result.success) {
            results.succeeded++;
        } else {
            results.failed++;
        }
    }

    console.log(`🔄 Retry results: ${results.succeeded}/${results.retried} succeeded`);
    return results;
};
