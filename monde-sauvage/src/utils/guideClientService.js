/**
 * Guide Client Service
 * Manages CRUD operations for a guide's recurring client list.
 * Clients are scoped per guide — each guide can only access their own.
 * Admin users can view/manage clients across all guides.
 */

import supabase from './supabase.js';

// ─── ADMIN: FETCH ALL GUIDES ───────────────────────────────────────────────

/**
 * Fetch all guides (for admin's guide-selector dropdown).
 *
 * @returns {Promise<Array>} List of guide objects with id and name
 */
export const getAllGuides = async () => {
  try {
    const { data, error } = await supabase
      .from('guide')
      .select('id, name, email')
      .order('name', { ascending: true });

    if (error) {
      console.error('❌ Error fetching guides:', error);
      throw new Error('Failed to fetch guides: ' + error.message);
    }

    return data || [];
  } catch (error) {
    console.error('❌ Error in getAllGuides:', error);
    throw error;
  }
};

// ─── ADMIN: FETCH ALL CLIENTS ──────────────────────────────────────────────

/**
 * Get all clients across all guides (admin view).
 * Joins with guide table to show guide name alongside each client.
 *
 * @param {Object} [options]
 * @param {string} [options.search] - Search term
 * @param {string} [options.guideId] - Optional: filter to a specific guide
 * @param {string} [options.orderBy] - Column to order by (default: 'full_name')
 * @param {boolean} [options.ascending] - Sort ascending (default: true)
 * @returns {Promise<Array>} List of client objects with guide info
 */
export const getAllGuideClients = async (options = {}) => {
  try {
    const { search, guideId, orderBy = 'full_name', ascending = true } = options;

    let query = supabase
      .from('guide_clients')
      .select('*, guide:guide_id(id, name, email)')
      .order(orderBy, { ascending });

    if (guideId) {
      query = query.eq('guide_id', guideId);
    }

    if (search && search.trim()) {
      const term = `%${search.trim()}%`;
      query = query.or(`full_name.ilike.${term},email.ilike.${term},phone.ilike.${term}`);
    }

    const { data, error } = await query;

    if (error) {
      console.error('❌ Error fetching all guide clients:', error);
      throw new Error('Failed to fetch clients: ' + error.message);
    }

    return data || [];
  } catch (error) {
    console.error('❌ Error in getAllGuideClients:', error);
    throw error;
  }
};

// ─── FETCH ──────────────────────────────────────────────────────────────────

/**
 * Get all clients for a guide, with optional search filtering.
 *
 * @param {string} guideId - Guide UUID
 * @param {Object} [options]
 * @param {string} [options.search] - Search term matched against name, email, phone
 * @param {string} [options.orderBy] - Column to order by (default: 'full_name')
 * @param {boolean} [options.ascending] - Sort ascending (default: true)
 * @returns {Promise<Array>} List of client objects
 */
export const getGuideClients = async (guideId, options = {}) => {
  try {
    const { search, orderBy = 'full_name', ascending = true } = options;

    let query = supabase
      .from('guide_clients')
      .select('*')
      .eq('guide_id', guideId)
      .order(orderBy, { ascending });

    // Apply search filter across name, email, phone using ilike
    if (search && search.trim()) {
      const term = `%${search.trim()}%`;
      query = query.or(`full_name.ilike.${term},email.ilike.${term},phone.ilike.${term}`);
    }

    const { data, error } = await query;

    if (error) {
      console.error('❌ Error fetching guide clients:', error);
      throw new Error('Failed to fetch clients: ' + error.message);
    }

    return data || [];
  } catch (error) {
    console.error('❌ Error in getGuideClients:', error);
    throw error;
  }
};

// ─── GET SINGLE ─────────────────────────────────────────────────────────────

/**
 * Get a single client by ID.
 *
 * @param {string} clientId - Client UUID
 * @returns {Promise<Object>} Client object
 */
export const getGuideClient = async (clientId) => {
  try {
    const { data, error } = await supabase
      .from('guide_clients')
      .select('*')
      .eq('id', clientId)
      .single();

    if (error || !data) {
      throw new Error('Client not found');
    }

    return data;
  } catch (error) {
    console.error('❌ Error in getGuideClient:', error);
    throw error;
  }
};

// ─── CREATE ─────────────────────────────────────────────────────────────────

/**
 * Create a new client for a guide.
 *
 * @param {Object} clientData
 * @param {string} clientData.guideId - Guide UUID
 * @param {string} clientData.fullName - Client full name (required)
 * @param {string} [clientData.email] - Client email
 * @param {string} [clientData.phone] - Client phone
 * @param {string} [clientData.notes] - Optional notes
 * @returns {Promise<Object>} Created client object
 */
export const createGuideClient = async (clientData) => {
  try {
    if (!clientData.guideId) throw new Error('Guide ID is required');
    if (!clientData.fullName?.trim()) throw new Error('Client name is required');

    const { data, error } = await supabase
      .from('guide_clients')
      .insert([{
        guide_id: clientData.guideId,
        full_name: clientData.fullName.trim(),
        email: clientData.email?.trim() || null,
        phone: clientData.phone?.trim() || null,
        notes: clientData.notes?.trim() || null,
      }])
      .select()
      .single();

    if (error) {
      console.error('❌ Error creating guide client:', error);
      throw new Error('Failed to create client: ' + error.message);
    }

    console.log('✅ Guide client created:', data.id);
    return data;
  } catch (error) {
    console.error('❌ Error in createGuideClient:', error);
    throw error;
  }
};

// ─── UPDATE ─────────────────────────────────────────────────────────────────

/**
 * Update an existing client.
 *
 * @param {string} clientId - Client UUID
 * @param {Object} updates - Fields to update
 * @param {string} [updates.fullName]
 * @param {string} [updates.email]
 * @param {string} [updates.phone]
 * @param {string} [updates.notes]
 * @returns {Promise<Object>} Updated client object
 */
export const updateGuideClient = async (clientId, updates) => {
  try {
    const payload = {};
    if (updates.fullName !== undefined) payload.full_name = updates.fullName.trim();
    if (updates.email !== undefined) payload.email = updates.email.trim() || null;
    if (updates.phone !== undefined) payload.phone = updates.phone.trim() || null;
    if (updates.notes !== undefined) payload.notes = updates.notes.trim() || null;

    if (Object.keys(payload).length === 0) {
      throw new Error('No fields to update');
    }

    const { data, error } = await supabase
      .from('guide_clients')
      .update(payload)
      .eq('id', clientId)
      .select()
      .single();

    if (error) {
      console.error('❌ Error updating guide client:', error);
      throw new Error('Failed to update client: ' + error.message);
    }

    console.log('✅ Guide client updated:', data.id);
    return data;
  } catch (error) {
    console.error('❌ Error in updateGuideClient:', error);
    throw error;
  }
};

// ─── DELETE ─────────────────────────────────────────────────────────────────

/**
 * Permanently delete a client.
 *
 * @param {string} clientId - Client UUID
 * @returns {Promise<void>}
 */
export const deleteGuideClient = async (clientId) => {
  try {
    const { error } = await supabase
      .from('guide_clients')
      .delete()
      .eq('id', clientId);

    if (error) {
      console.error('❌ Error deleting guide client:', error);
      throw new Error('Failed to delete client: ' + error.message);
    }

    console.log('✅ Guide client deleted:', clientId);
  } catch (error) {
    console.error('❌ Error in deleteGuideClient:', error);
    throw error;
  }
};

// ─── ADMIN FUNCTIONS ────────────────────────────────────────────────────────
