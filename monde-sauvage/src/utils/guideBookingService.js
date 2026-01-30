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
 */

import supabase from './supabase.js';

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

        // 1️⃣ Check database for conflicts using the built-in function
        const { data: conflictCheck, error: conflictError } = await supabase
            .rpc('check_guide_booking_conflict', {
                p_guide_id: guideId,
                p_start_time: startTime,
                p_end_time: endTime,
                p_exclude_booking_id: excludeBookingId
            });

        if (conflictError) {
            console.error('❌ Error checking conflicts:', conflictError);
            throw new Error('Failed to check booking conflicts');
        }

        if (conflictCheck && conflictCheck.length > 0 && conflictCheck[0].has_conflict) {
            console.log('❌ Found conflicting bookings:', conflictCheck[0].conflicting_bookings);
            return {
                available: false,
                conflicts: conflictCheck[0].conflicting_bookings,
                reason: 'Guide has conflicting bookings'
            };
        }

        // 2️⃣ Double-check Google Calendar for events not yet synced
        const { data: guide, error: guideError } = await supabase
            .from('guide')
            .select('google_refresh_token, email')
            .eq('id', guideId)
            .single();

        if (guideError) {
            console.error('❌ Error fetching guide:', guideError);
            throw new Error('Failed to fetch guide information');
        }

        // If guide has Google Calendar access, check it
        if (guide.google_refresh_token) {
            console.log('📅 Checking Google Calendar for guide:', guide.email);

            try {
                const calendarCheckUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/guide-calendar-availability`;
                const params = new URLSearchParams({
                    guide_id: guideId,
                    start_time: startTime,
                    end_time: endTime
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
                    console.warn('⚠️ Could not check Google Calendar:', errorData.error);
                    // Continue - if calendar check fails, rely on database only
                } else {
                    const calendarData = await response.json();
                    
                    if (calendarData.conflicts && calendarData.conflicts.length > 0) {
                        console.log('❌ Found overlapping Google Calendar events:', calendarData.conflicts.length);
                        return {
                            available: false,
                            conflicts: calendarData.conflicts,
                            reason: 'Guide has events in Google Calendar not yet synced'
                        };
                    }
                }
            } catch (calendarError) {
                console.warn('⚠️ Google Calendar check failed:', calendarError.message);
                // Continue - calendar check is a secondary validation
            }
        }

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
                google_event_id: null // Will be populated after calendar sync
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
            const calendarEventUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-guide-booking-event`;
            
            const eventResponse = await fetch(calendarEventUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    booking_id: booking.id,
                    guide_id: bookingData.guideId,
                    start_time: bookingData.startTime,
                    end_time: bookingData.endTime,
                    customer_name: bookingData.customerName,
                    customer_email: bookingData.customerEmail,
                    trip_type: bookingData.tripType,
                    notes: bookingData.notes
                })
            });

            if (eventResponse.ok) {
                const eventData = await eventResponse.json();
                console.log('✅ Google Calendar event created:', eventData.event_id);
                
                // 4️⃣ Update booking with google_event_id
                const { error: updateError } = await supabase
                    .from('guide_booking')
                    .update({ 
                        google_event_id: eventData.event_id,
                        synced_at: new Date().toISOString()
                    })
                    .eq('id', booking.id);

                if (updateError) {
                    console.warn('⚠️ Could not update google_event_id:', updateError);
                }

                return { ...booking, google_event_id: eventData.event_id };
            } else {
                const errorData = await eventResponse.json();
                console.warn('⚠️ Could not create Google Calendar event:', errorData.error);
                // Booking still exists in database, calendar sync failed
                return booking;
            }
        } catch (calendarError) {
            console.warn('⚠️ Google Calendar sync failed:', calendarError.message);
            // Booking still exists in database, continue
            return booking;
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
            throw new Error('Failed to update booking');
        }

        console.log('✅ Booking updated in database');

        // 5️⃣ Update Google Calendar event if it exists
        if (currentBooking.google_event_id) {
            try {
                const updateEventUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/update-guide-booking-event`;
                
                await fetch(updateEventUrl, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        booking_id: bookingId,
                        event_id: currentBooking.google_event_id,
                        guide_id: currentBooking.guide_id,
                        updates: {
                            start_time: newStartTime,
                            end_time: newEndTime,
                            customer_name: updates.customer_name || currentBooking.customer_name,
                            notes: updates.notes !== undefined ? updates.notes : currentBooking.notes
                        }
                    })
                });

                console.log('✅ Google Calendar event updated');
            } catch (calendarError) {
                console.warn('⚠️ Google Calendar update failed:', calendarError.message);
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
                const deleteEventUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/delete-guide-booking-event`;
                
                await fetch(deleteEventUrl, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        event_id: booking.google_event_id,
                        guide_id: booking.guide_id
                    })
                });

                console.log('✅ Google Calendar event deleted');
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

        // Filter by historical (past bookings)
        if (!options.includeHistorical) {
            query = query.gte('end_time', new Date().toISOString());
        }

        // Filter by status
        if (options.status) {
            query = query.eq('status', options.status);
        }

        const { data: bookings, error } = await query;

        if (error) {
            throw new Error('Failed to fetch bookings');
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
 * Detects deletions and new events, updates database accordingly
 * 
 * @param {string} guideId - Guide UUID
 * @returns {Promise<Object>} Sync results
 */
export const syncGuideBookingsWithCalendar = async (guideId) => {
    try {
        console.log('🔄 Syncing guide bookings with Google Calendar:', guideId);

        const syncUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sync-guide-calendar`;
        
        const response = await fetch(syncUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                guide_id: guideId
            })
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
