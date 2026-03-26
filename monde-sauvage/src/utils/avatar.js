const INVALID_AVATAR_VALUES = new Set(['', 'null', 'undefined', 'false', 'nan']);
const AVATAR_CACHE_MAX_ENTRIES = 500;
const STORAGE_AVATAR_CACHE_TTL_MS = 45 * 60 * 1000;
const DIRECT_AVATAR_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const FALLBACK_AVATAR_CACHE_TTL_MS = 5 * 60 * 1000;

const resolvedAvatarCache = new Map();
const pendingAvatarResolutions = new Map();

const FALLBACK_AVATAR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96" role="img" aria-label="Default avatar"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#2D5F4C"/><stop offset="100%" stop-color="#4A9B8E"/></linearGradient></defs><rect width="96" height="96" rx="48" fill="url(#g)"/><circle cx="48" cy="37" r="18" fill="#F4F1E8"/><path d="M20 84c3-17 15-27 28-27s25 10 28 27" fill="#F4F1E8"/></svg>`;

export const FALLBACK_AVATAR_SRC = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(FALLBACK_AVATAR_SVG)}`;

const trimString = (value) => (typeof value === 'string' ? value.trim() : '');

const normalizeAvatarValue = (value) => {
  const trimmed = trimString(value);
  if (!trimmed) return '';

  const lowered = trimmed.toLowerCase();
  return INVALID_AVATAR_VALUES.has(lowered) ? '' : trimmed;
};

const pickAvatarValueFromIdentity = (identity) => normalizeAvatarValue(
  identity?.avatar_url
  || identity?.photo_url
  || identity?.picture
  || identity?.image_url
  || identity?.identity_data?.avatar_url
  || identity?.identity_data?.photo_url
  || identity?.identity_data?.picture
  || identity?.identity_data?.image_url
);

const pickAvatarValueFromIdentities = (identities) => {
  if (!Array.isArray(identities)) return '';

  for (const identity of identities) {
    const value = pickAvatarValueFromIdentity(identity);
    if (value) return value;
  }

  return '';
};

const pickAvatarValueFromSource = (source) => normalizeAvatarValue(
  source?.avatar_url
  || source?.photo_url
  || source?.profile_photo_url
  || source?.google_avatar
  || source?.google_avatar_url
  || source?.picture
  || source?.image_url
  || source?.user_metadata?.avatar_url
  || source?.user_metadata?.photo_url
  || source?.user_metadata?.picture
  || source?.raw_user_meta_data?.avatar_url
  || source?.raw_user_meta_data?.photo_url
  || source?.raw_user_meta_data?.picture
  || source?.identity_data?.avatar_url
  || source?.identity_data?.picture
  || pickAvatarValueFromIdentity(source?.identity)
  || pickAvatarValueFromIdentities(source?.identities)
);

const pickAvatarVersionFromSource = (source) => normalizeAvatarValue(
  source?.avatar_updated_at
  || source?.avatar_version
  || source?.updated_at
  || source?.last_sign_in_at
  || source?.user_metadata?.avatar_updated_at
  || source?.user_metadata?.updated_at
  || source?.raw_user_meta_data?.avatar_updated_at
  || source?.raw_user_meta_data?.updated_at
);

export const getAvatarRawValueFromSources = (...sources) => {
  for (const source of sources) {
    const value = pickAvatarValueFromSource(source);
    if (value) return value;
  }
  return '';
};

export const getAvatarVersionKeyFromSources = (...sources) => {
  for (const source of sources) {
    const value = pickAvatarVersionFromSource(source);
    if (value) return value;
  }
  return '';
};

const decodePath = (path) => {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
};

const getConfiguredAvatarBucket = () => normalizeAvatarValue(
  import.meta?.env?.VITE_SUPABASE_AVATAR_BUCKET || ''
);

const getSupabaseHost = () => {
  const supabaseUrl = normalizeAvatarValue(import.meta?.env?.VITE_SUPABASE_URL || '');
  if (!supabaseUrl) return '';

  try {
    return new URL(supabaseUrl).host;
  } catch {
    return '';
  }
};

const inferStorageRef = (value) => {
  const normalized = normalizeAvatarValue(value);
  if (!normalized) return null;

  const cleaned = normalized.replace(/^\.\//, '');

  const storageMatch = cleaned.match(/\/?storage\/v1\/object\/(?:public|sign)\/([^/]+)\/([^?#]+)/i);
  if (storageMatch) {
    return {
      bucket: decodePath(storageMatch[1]),
      path: decodePath(storageMatch[2]),
    };
  }

  if (/^(https?:\/\/|data:image\/|blob:)/i.test(cleaned)) {
    return null;
  }

  if (cleaned.startsWith('/')) {
    return null;
  }

  const configuredBucket = getConfiguredAvatarBucket();
  const knownBuckets = new Set([
    configuredBucket,
    'avatars',
    'avatar',
    'profile-pictures',
    'profile-images',
    'user-avatars',
  ].filter(Boolean));

  const segments = cleaned.split('/').filter(Boolean);
  if (segments.length >= 2 && knownBuckets.has(segments[0])) {
    return {
      bucket: segments[0],
      path: segments.slice(1).join('/'),
    };
  }

  // Support common raw values like "users/u1.png" by defaulting to avatar bucket.
  if (segments.length >= 2) {
    return {
      bucket: configuredBucket || 'avatars',
      path: cleaned,
    };
  }

  if (configuredBucket) {
    return {
      bucket: configuredBucket,
      path: cleaned,
    };
  }

  return null;
};

const addVersionParam = (url, versionKey) => {
  const version = normalizeAvatarValue(versionKey);
  if (!version) return url;
  if (!url || url.startsWith('data:image/') || url.startsWith('blob:')) return url;

  const supabaseHost = getSupabaseHost();

  try {
    if (/^https?:\/\//i.test(url)) {
      const parsed = new URL(url);

      // Keep external avatar URLs (e.g. Google profile photos) untouched.
      // Adding arbitrary query params can break some providers and trigger onError.
      const isSupabaseStorageUrl = parsed.pathname.includes('/storage/v1/object/')
        && (!supabaseHost || parsed.host === supabaseHost);
      if (!isSupabaseStorageUrl) {
        return url;
      }

      parsed.searchParams.set('v', version);
      return parsed.toString();
    }

    if (url.startsWith('/')) {
      const parsed = new URL(url, globalThis.location?.origin || 'http://localhost');
      parsed.searchParams.set('v', version);
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
  } catch {
    return url;
  }

  return url;
};

const buildAvatarCacheKey = ({ rawAvatarValue, versionKey }) => {
  const raw = normalizeAvatarValue(rawAvatarValue);
  const version = normalizeAvatarValue(versionKey);
  return `${raw}|${version}`;
};

const readResolvedAvatarCache = (cacheKey) => {
  const cachedEntry = resolvedAvatarCache.get(cacheKey);
  if (!cachedEntry) return '';

  if (cachedEntry.expiresAt > Date.now()) {
    return cachedEntry.avatarSrc;
  }

  resolvedAvatarCache.delete(cacheKey);
  return '';
};

const pruneResolvedAvatarCache = () => {
  if (resolvedAvatarCache.size <= AVATAR_CACHE_MAX_ENTRIES) return;

  const overflow = resolvedAvatarCache.size - AVATAR_CACHE_MAX_ENTRIES;
  const cacheKeys = [...resolvedAvatarCache.keys()];
  for (let index = 0; index < overflow; index += 1) {
    resolvedAvatarCache.delete(cacheKeys[index]);
  }
};

const writeResolvedAvatarCache = ({ cacheKey, avatarSrc, ttlMs }) => {
  if (!cacheKey || !avatarSrc) return;

  resolvedAvatarCache.set(cacheKey, {
    avatarSrc,
    expiresAt: Date.now() + Math.max(1000, ttlMs),
  });
  pruneResolvedAvatarCache();
};

export const getAvatarVersionKey = (user) => (
  getAvatarVersionKeyFromSources(user, user?.user_metadata, user?.raw_user_meta_data)
);

export const getUserAvatarRawValue = (user) => (
  getAvatarRawValueFromSources(user, user?.user_metadata, user?.raw_user_meta_data)
);

export const buildAvatarInitials = (name, fallback = 'GU') => {
  const safeFallback = normalizeAvatarValue(fallback) || 'GU';
  const source = trimString(name);
  if (!source) return safeFallback;

  const initials = source
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('');

  return initials || safeFallback;
};

export const getAvatarImmediateSource = (rawAvatarValue, { versionKey } = {}) => {
  const normalized = normalizeAvatarValue(rawAvatarValue);
  if (!normalized) {
    return FALLBACK_AVATAR_SRC;
  }

  const storageRef = inferStorageRef(normalized);
  if (storageRef) {
    return '';
  }

  if (/^(https?:\/\/|data:image\/|blob:)/i.test(normalized) || normalized.startsWith('/')) {
    return addVersionParam(normalized, versionKey);
  }

  return FALLBACK_AVATAR_SRC;
};

export const resolveAvatarSource = (rawAvatarValue, { supabase, versionKey } = {}) => {
  const normalized = normalizeAvatarValue(rawAvatarValue);
  if (!normalized) {
    return FALLBACK_AVATAR_SRC;
  }

  const cacheKey = buildAvatarCacheKey({ rawAvatarValue: normalized, versionKey });
  const cachedAvatarSrc = readResolvedAvatarCache(cacheKey);
  if (cachedAvatarSrc) {
    return cachedAvatarSrc;
  }

  if (pendingAvatarResolutions.has(cacheKey)) {
    return pendingAvatarResolutions.get(cacheKey);
  }

  const pending = (async () => {
    const storageRef = inferStorageRef(normalized);
    if (storageRef && supabase) {
      const { bucket, path } = storageRef;

      try {
        const { data: signedData, error: signedError } = await supabase.storage
          .from(bucket)
          .createSignedUrl(path, 60 * 60);

        if (!signedError && signedData?.signedUrl) {
          const avatarSrc = addVersionParam(signedData.signedUrl, versionKey);
          writeResolvedAvatarCache({
            cacheKey,
            avatarSrc,
            ttlMs: STORAGE_AVATAR_CACHE_TTL_MS,
          });
          return avatarSrc;
        }
      } catch {
        // Continue with public URL fallback.
      }

      try {
        const { data: publicData } = supabase.storage.from(bucket).getPublicUrl(path);
        if (publicData?.publicUrl) {
          const avatarSrc = addVersionParam(publicData.publicUrl, versionKey);
          writeResolvedAvatarCache({
            cacheKey,
            avatarSrc,
            ttlMs: STORAGE_AVATAR_CACHE_TTL_MS,
          });
          return avatarSrc;
        }
      } catch {
        // Ignore and return safe fallback below.
      }

      writeResolvedAvatarCache({
        cacheKey,
        avatarSrc: FALLBACK_AVATAR_SRC,
        ttlMs: FALLBACK_AVATAR_CACHE_TTL_MS,
      });
      return FALLBACK_AVATAR_SRC;
    }

    if (/^(https?:\/\/|data:image\/|blob:)/i.test(normalized) || normalized.startsWith('/')) {
      const avatarSrc = addVersionParam(normalized, versionKey);
      writeResolvedAvatarCache({
        cacheKey,
        avatarSrc,
        ttlMs: DIRECT_AVATAR_CACHE_TTL_MS,
      });
      return avatarSrc;
    }

    writeResolvedAvatarCache({
      cacheKey,
      avatarSrc: FALLBACK_AVATAR_SRC,
      ttlMs: FALLBACK_AVATAR_CACHE_TTL_MS,
    });
    return FALLBACK_AVATAR_SRC;
  })().finally(() => {
    pendingAvatarResolutions.delete(cacheKey);
  });

  pendingAvatarResolutions.set(cacheKey, pending);
  return pending;
};

export const resolveAvatarFromSources = async (sources = [], { supabase, versionKey, emptySrcFallback = '' } = {}) => {
  const normalizedSources = Array.isArray(sources) ? sources : [sources];
  const avatarRawValue = getAvatarRawValueFromSources(...normalizedSources);
  const avatarVersionKey = normalizeAvatarValue(versionKey)
    || getAvatarVersionKeyFromSources(...normalizedSources);

  if (!avatarRawValue) {
    return {
      avatarRawValue: '',
      avatarVersionKey,
      avatarSrc: emptySrcFallback,
    };
  }

  const avatarSrc = await resolveAvatarSource(avatarRawValue, {
    supabase,
    versionKey: avatarVersionKey,
  });

  return {
    avatarRawValue,
    avatarVersionKey,
    avatarSrc,
  };
};
