/**
 * Establishment Client Service — carnet clients par établissement (pourvoirie).
 */

import supabase from './supabase.js';

/**
 * @param {string} establishmentId - Etablissement.key (uuid)
 * @param {Object} [options]
 * @param {string} [options.search]
 * @param {string} [options.orderBy]
 * @param {boolean} [options.ascending]
 */
export const getEstablishmentClients = async (establishmentId, options = {}) => {
  if (!establishmentId) throw new Error('Établissement requis');

  const { search, orderBy = 'full_name', ascending = true } = options;

  let query = supabase
    .from('establishment_clients')
    .select('*')
    .eq('establishment_id', establishmentId)
    .order(orderBy, { ascending });

  if (search && search.trim()) {
    const term = `%${search.trim()}%`;
    query = query.or(`full_name.ilike.${term},email.ilike.${term},phone.ilike.${term}`);
  }

  const { data, error } = await query;
  if (error) {
    console.error('Error fetching establishment clients:', error);
    throw new Error(error.message);
  }
  return data || [];
};

/**
 * @param {Object} clientData
 * @param {string} clientData.establishmentId
 * @param {string} clientData.fullName
 */
export const createEstablishmentClient = async (clientData) => {
  if (!clientData.establishmentId) throw new Error('Établissement requis');
  if (!clientData.fullName?.trim()) throw new Error('Le nom est requis');

  const { data, error } = await supabase
    .from('establishment_clients')
    .insert([
      {
        establishment_id: clientData.establishmentId,
        full_name: clientData.fullName.trim(),
        email: clientData.email?.trim() || null,
        phone: clientData.phone?.trim() || null,
        notes: clientData.notes?.trim() || null,
      },
    ])
    .select()
    .single();

  if (error) {
    console.error('Error creating establishment client:', error);
    throw new Error(error.message);
  }
  return data;
};

/**
 * @param {string} clientId
 * @param {Object} updates
 */
export const updateEstablishmentClient = async (clientId, updates) => {
  const payload = {};
  if (updates.fullName !== undefined) payload.full_name = updates.fullName.trim();
  if (updates.email !== undefined) payload.email = updates.email?.trim() || null;
  if (updates.phone !== undefined) payload.phone = updates.phone?.trim() || null;
  if (updates.notes !== undefined) payload.notes = updates.notes?.trim() || null;

  if (Object.keys(payload).length === 0) throw new Error('Aucun champ à mettre à jour');

  const { data, error } = await supabase
    .from('establishment_clients')
    .update(payload)
    .eq('id', clientId)
    .select()
    .single();

  if (error) {
    console.error('Error updating establishment client:', error);
    throw new Error(error.message);
  }
  return data;
};

export const deleteEstablishmentClient = async (clientId) => {
  const { error } = await supabase.from('establishment_clients').delete().eq('id', clientId);
  if (error) {
    console.error('Error deleting establishment client:', error);
    throw new Error(error.message);
  }
};

/**
 * Insert plusieurs lignes une par une pour erreurs granulaires.
 * @param {string} establishmentId
 * @param {Array<{ fullName: string, email?: string, phone?: string, notes?: string }>} rows
 */
export const importEstablishmentClientsBatch = async (establishmentId, rows) => {
  if (!establishmentId) throw new Error('Établissement requis');

  const errors = [];
  let inserted = 0;

  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i];
    const name = r.fullName?.trim();
    if (!name) {
      errors.push({ row: i + 1, message: 'Nom vide' });
      continue;
    }
    const { error: oneErr } = await supabase.from('establishment_clients').insert([
      {
        establishment_id: establishmentId,
        full_name: name,
        email: r.email?.trim() || null,
        phone: r.phone?.trim() || null,
        notes: r.notes?.trim() || null,
      },
    ]);
    if (oneErr) {
      errors.push({ row: i + 1, message: oneErr.message });
    } else {
      inserted += 1;
    }
  }

  return { inserted, errors };
};
