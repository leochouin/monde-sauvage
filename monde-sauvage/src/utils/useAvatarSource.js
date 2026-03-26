import { useCallback, useEffect, useMemo, useState } from 'react';
import supabase from './supabase.js';
import {
  FALLBACK_AVATAR_SRC,
  getAvatarVersionKey,
  getAvatarImmediateSource,
  getUserAvatarRawValue,
  resolveAvatarSource,
} from './avatar.js';

const MAX_AVATAR_RETRIES = 2;

const buildRetryUrl = (rawUrl, retryCount) => {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return '';
  if (rawUrl.startsWith('data:image/') || rawUrl.startsWith('blob:')) return '';

  try {
    const parsed = new URL(rawUrl, globalThis.location?.origin || 'http://localhost');
    if (!/^https?:$/i.test(parsed.protocol)) return '';
    parsed.searchParams.set('_avtr', `${Date.now()}-${retryCount}`);
    return parsed.toString();
  } catch {
    return '';
  }
};

export default function useAvatarSource(user) {
  const avatarRawValue = getUserAvatarRawValue(user);
  const avatarVersionKey = getAvatarVersionKey(user);
  const immediateAvatarSrc = getAvatarImmediateSource(avatarRawValue, {
    versionKey: avatarVersionKey,
  });

  const [avatarSrc, setAvatarSrc] = useState(immediateAvatarSrc || FALLBACK_AVATAR_SRC);

  useEffect(() => {
    if (immediateAvatarSrc) {
      setAvatarSrc(immediateAvatarSrc);
      return undefined;
    }

    let cancelled = false;

    const loadAvatar = async () => {
      const resolvedSource = await resolveAvatarSource(avatarRawValue, {
        supabase,
        versionKey: avatarVersionKey,
      });

      if (!cancelled) {
        setAvatarSrc(resolvedSource || FALLBACK_AVATAR_SRC);
      }
    };

    loadAvatar();

    return () => {
      cancelled = true;
    };
  }, [avatarRawValue, avatarVersionKey, immediateAvatarSrc]);

  const handleAvatarError = useCallback((event) => {
    const imageElement = event?.currentTarget;
    if (!imageElement) return;

    const retryCount = Number(imageElement.dataset.avatarRetryCount || '0');
    if (retryCount < MAX_AVATAR_RETRIES) {
      const sourceForRetry = imageElement.currentSrc || imageElement.src || imageElement.getAttribute('src') || '';
      const retrySrc = buildRetryUrl(sourceForRetry, retryCount + 1);
      if (retrySrc) {
        imageElement.dataset.avatarRetryCount = String(retryCount + 1);
        imageElement.src = retrySrc;
        return;
      }
    }

    imageElement.onerror = null;
    imageElement.src = FALLBACK_AVATAR_SRC;
  }, []);

  const avatarDebug = useMemo(() => ({
    userId: user?.id || null,
    userEmail: user?.email || null,
    avatarRawValue: avatarRawValue || null,
    avatarVersionKey: avatarVersionKey || null,
    immediateAvatarSrc: immediateAvatarSrc || null,
    resolvedAvatarSrc: avatarSrc || null,
    isFallback: avatarSrc === FALLBACK_AVATAR_SRC,
    metadata: {
      avatar_url: user?.user_metadata?.avatar_url || user?.raw_user_meta_data?.avatar_url || null,
      photo_url: user?.user_metadata?.photo_url || user?.raw_user_meta_data?.photo_url || null,
      picture: user?.user_metadata?.picture || user?.raw_user_meta_data?.picture || null,
      google_avatar: user?.user_metadata?.google_avatar || user?.raw_user_meta_data?.google_avatar || null,
      google_avatar_url: user?.user_metadata?.google_avatar_url || user?.raw_user_meta_data?.google_avatar_url || null,
      profile_photo_url: user?.user_metadata?.profile_photo_url || user?.raw_user_meta_data?.profile_photo_url || null,
      image_url: user?.user_metadata?.image_url || user?.raw_user_meta_data?.image_url || null,
    },
  }), [user, avatarRawValue, avatarVersionKey, immediateAvatarSrc, avatarSrc]);

  return { avatarSrc, handleAvatarError, avatarDebug };
}
