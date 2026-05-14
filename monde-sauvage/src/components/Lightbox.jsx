import { useCallback, useEffect, useRef, useState } from 'react';

const Lightbox = ({ images, index, onClose, onIndexChange, alt = '' }) => {
  const touchStartX = useRef(null);
  const [imgLoaded, setImgLoaded] = useState(false);

  const total = images?.length || 0;
  const safeIndex = Math.max(0, Math.min(index ?? 0, total - 1));

  const goPrev = useCallback(() => {
    if (total === 0) return;
    onIndexChange((safeIndex - 1 + total) % total);
  }, [safeIndex, total, onIndexChange]);

  const goNext = useCallback(() => {
    if (total === 0) return;
    onIndexChange((safeIndex + 1) % total);
  }, [safeIndex, total, onIndexChange]);

  useEffect(() => {
    setImgLoaded(false);
  }, [safeIndex]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') goPrev();
      else if (e.key === 'ArrowRight') goNext();
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose, goPrev, goNext]);

  // Preload neighbours for snappy navigation
  useEffect(() => {
    if (total < 2) return;
    [(safeIndex + 1) % total, (safeIndex - 1 + total) % total].forEach((i) => {
      const img = new Image();
      img.src = images[i];
    });
  }, [safeIndex, total, images]);

  if (index === null || index === undefined || total === 0) return null;

  const handleTouchStart = (e) => {
    touchStartX.current = e.touches[0].clientX;
  };
  const handleTouchEnd = (e) => {
    if (touchStartX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    if (Math.abs(dx) > 50) {
      if (dx > 0) goPrev();
      else goNext();
    }
    touchStartX.current = null;
  };

  return (
    <div
      onClick={onClose}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.94)',
        zIndex: 10000,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 16,
          left: 20,
          color: 'white',
          fontSize: 14,
          fontWeight: 500,
          letterSpacing: 0.3,
        }}
      >
        {safeIndex + 1} / {total}
      </div>

      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        aria-label="Fermer"
        style={{
          position: 'absolute',
          top: 12,
          right: 16,
          background: 'rgba(255,255,255,0.12)',
          color: 'white',
          border: 'none',
          width: 40,
          height: 40,
          borderRadius: '50%',
          cursor: 'pointer',
          fontSize: 20,
          lineHeight: 1,
        }}
      >
        ✕
      </button>

      {total > 1 && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); goPrev(); }}
          aria-label="Précédent"
          style={{
            position: 'absolute',
            left: 16,
            top: '50%',
            transform: 'translateY(-50%)',
            background: 'rgba(255,255,255,0.12)',
            color: 'white',
            border: 'none',
            width: 48,
            height: 48,
            borderRadius: '50%',
            cursor: 'pointer',
            fontSize: 24,
          }}
        >
          ‹
        </button>
      )}

      <img
        src={images[safeIndex]}
        alt={alt}
        onClick={(e) => e.stopPropagation()}
        onLoad={() => setImgLoaded(true)}
        style={{
          maxWidth: 'min(92vw, 1400px)',
          maxHeight: '78vh',
          objectFit: 'contain',
          borderRadius: 4,
          opacity: imgLoaded ? 1 : 0,
          transition: 'opacity 180ms ease',
          boxShadow: '0 30px 80px rgba(0,0,0,0.5)',
        }}
      />

      {total > 1 && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); goNext(); }}
          aria-label="Suivant"
          style={{
            position: 'absolute',
            right: 16,
            top: '50%',
            transform: 'translateY(-50%)',
            background: 'rgba(255,255,255,0.12)',
            color: 'white',
            border: 'none',
            width: 48,
            height: 48,
            borderRadius: '50%',
            cursor: 'pointer',
            fontSize: 24,
          }}
        >
          ›
        </button>
      )}

      {total > 1 && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            bottom: 16,
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            gap: 8,
            padding: '8px 12px',
            background: 'rgba(0,0,0,0.4)',
            borderRadius: 12,
            maxWidth: '92vw',
            overflowX: 'auto',
          }}
        >
          {images.map((src, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onIndexChange(i)}
              aria-label={`Image ${i + 1}`}
              style={{
                width: 60,
                height: 44,
                padding: 0,
                border: i === safeIndex ? '2px solid white' : '2px solid transparent',
                borderRadius: 6,
                cursor: 'pointer',
                overflow: 'hidden',
                background: 'transparent',
                flexShrink: 0,
                opacity: i === safeIndex ? 1 : 0.6,
                transition: 'opacity 120ms ease',
              }}
            >
              <img
                src={src}
                alt=""
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default Lightbox;
