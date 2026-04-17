const GASPESIE_BOUNDS = {
  north: 49.7,
  south: 47.6,
  west: -68.8,
  east: -63.2
};

const NOMINATIM_BASE_URL = 'https://nominatim.openstreetmap.org/search';

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const isInGaspesieBounds = (latitude, longitude) => {
  const lat = toNumber(latitude);
  const lon = toNumber(longitude);

  if (lat === null || lon === null) return false;

  return (
    lat <= GASPESIE_BOUNDS.north
    && lat >= GASPESIE_BOUNDS.south
    && lon >= GASPESIE_BOUNDS.west
    && lon <= GASPESIE_BOUNDS.east
  );
};

const fetchNominatim = async (query, signal, limit = 1) => {
  const params = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    limit: String(limit),
    addressdetails: '1',
    countrycodes: 'ca',
    bounded: '1',
    viewbox: `${GASPESIE_BOUNDS.west},${GASPESIE_BOUNDS.north},${GASPESIE_BOUNDS.east},${GASPESIE_BOUNDS.south}`
  });

  const response = await fetch(`${NOMINATIM_BASE_URL}?${params.toString()}`, {
    method: 'GET',
    signal,
    headers: {
      Accept: 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error('Le service de geolocalisation est temporairement indisponible.');
  }

  const payload = await response.json();
  return Array.isArray(payload) ? payload : [];
};

export const geocodeAddressInGaspesie = async (rawAddress) => {
  const baseQuery = String(rawAddress || '').trim();
  if (!baseQuery) {
    throw new Error('Veuillez entrer une adresse.');
  }

  const queryVariants = [
    baseQuery,
    `${baseQuery}, Gaspesie, Quebec, Canada`,
    `${baseQuery}, Quebec, Canada`
  ];

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    for (const query of queryVariants) {
      const results = await fetchNominatim(query, controller.signal, 1);
      const bestMatch = results[0];
      if (!bestMatch) continue;

      const latitude = toNumber(bestMatch.lat);
      const longitude = toNumber(bestMatch.lon);
      if (latitude === null || longitude === null) continue;
      if (!isInGaspesieBounds(latitude, longitude)) continue;

      return {
        latitude,
        longitude,
        displayName: bestMatch.display_name || ''
      };
    }

    throw new Error('Adresse introuvable en Gaspesie. Ajoutez plus de details (ville, code postal, etc.).');
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('La recherche d\'adresse a pris trop de temps. Reessayez.');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
};

export const searchAddressesInGaspesie = async (rawAddress, maxResults = 5) => {
  const baseQuery = String(rawAddress || '').trim();
  if (baseQuery.length < 3) {
    return [];
  }

  const queryVariants = [
    baseQuery,
    `${baseQuery}, Gaspesie, Quebec, Canada`,
    `${baseQuery}, Quebec, Canada`
  ];

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const uniqueByCoords = new Map();

    for (const query of queryVariants) {
      const results = await fetchNominatim(query, controller.signal, maxResults);
      for (const result of results) {
        const latitude = toNumber(result.lat);
        const longitude = toNumber(result.lon);
        if (latitude === null || longitude === null) continue;
        if (!isInGaspesieBounds(latitude, longitude)) continue;

        const coordKey = `${latitude.toFixed(6)}:${longitude.toFixed(6)}`;
        if (uniqueByCoords.has(coordKey)) continue;

        uniqueByCoords.set(coordKey, {
          latitude,
          longitude,
          displayName: result.display_name || ''
        });

        if (uniqueByCoords.size >= maxResults) break;
      }

      if (uniqueByCoords.size >= maxResults) break;
    }

    return Array.from(uniqueByCoords.values());
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('La recherche d\'adresse a pris trop de temps. Reessayez.');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
};

export const toCoordinateInputValue = (value) => {
  const parsed = toNumber(value);
  return parsed === null ? '' : parsed.toFixed(6);
};
