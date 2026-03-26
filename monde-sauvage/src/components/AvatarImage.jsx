import { useEffect, useMemo, useState } from 'react';
import { buildAvatarInitials } from '../utils/avatar.js';

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

export default function AvatarImage({
  src,
  name,
  alt,
  className,
  fallbackClassName,
  imgStyle,
  fallbackStyle,
  loading = 'lazy',
  fallback = 'GU',
}) {
  const normalizedSrc = typeof src === 'string' ? src.trim() : '';
  const [hasLoadError, setHasLoadError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [activeSrc, setActiveSrc] = useState(normalizedSrc);

  useEffect(() => {
    setHasLoadError(false);
    setRetryCount(0);
    setActiveSrc(normalizedSrc);
  }, [normalizedSrc]);

  const initials = useMemo(
    () => buildAvatarInitials(name, fallback),
    [name, fallback],
  );

  if (!normalizedSrc || hasLoadError) {
    return (
      <span className={fallbackClassName} style={fallbackStyle}>
        {initials}
      </span>
    );
  }

  return (
    <img
      src={activeSrc || normalizedSrc}
      alt={alt || name || 'Avatar'}
      className={className}
      loading={loading}
      style={imgStyle}
      onError={() => {
        if (retryCount < MAX_AVATAR_RETRIES) {
          const retrySrc = buildRetryUrl(activeSrc || normalizedSrc, retryCount + 1);
          if (retrySrc) {
            setRetryCount((prev) => prev + 1);
            setActiveSrc(retrySrc);
            return;
          }
        }

        setHasLoadError(true);
      }}
    />
  );
}
