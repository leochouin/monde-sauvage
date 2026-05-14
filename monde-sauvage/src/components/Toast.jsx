import { useEffect, useState, useCallback } from 'react';
import { subscribeToast } from '../utils/toast.js';

const COLORS = {
  success: { bg: '#1F3A2E', border: '#2D5F4C', icon: '✓' },
  error: { bg: '#7A2D1F', border: '#A93B28', icon: '!' },
  info: { bg: '#214537', border: '#3A6B58', icon: 'i' },
};

export default function ToastContainer() {
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    const unsub = subscribeToast(({ id, message, type, duration, action }) => {
      if (action === 'add') {
        setToasts((prev) => [...prev, { id, message, type, duration }]);
        if (duration > 0) {
          setTimeout(() => {
            setToasts((prev) => prev.filter((t) => t.id !== id));
          }, duration);
        }
      } else if (action === 'remove') {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }
    });
    return unsub;
  }, []);

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: '20px',
        right: '20px',
        zIndex: 99999,
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        maxWidth: 'calc(100vw - 40px)',
        width: '360px',
        pointerEvents: 'none',
      }}
    >
      {toasts.map((t) => {
        const palette = COLORS[t.type] || COLORS.info;
        return (
          <div
            key={t.id}
            role="alert"
            style={{
              pointerEvents: 'auto',
              backgroundColor: palette.bg,
              border: `1px solid ${palette.border}`,
              color: '#FFFCF7',
              borderRadius: '12px',
              padding: '12px 14px',
              boxShadow: '0 8px 24px rgba(0, 0, 0, 0.18)',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '10px',
              fontSize: '14px',
              lineHeight: 1.45,
              fontFamily: 'Cabin, system-ui, -apple-system, sans-serif',
              animation: 'ms-toast-slide-in 220ms cubic-bezier(0.22, 1, 0.36, 1)',
            }}
          >
            <span
              aria-hidden="true"
              style={{
                flexShrink: 0,
                width: '22px',
                height: '22px',
                borderRadius: '50%',
                backgroundColor: 'rgba(255, 252, 247, 0.18)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 700,
                fontSize: '13px',
              }}
            >
              {palette.icon}
            </span>
            <div style={{ flex: 1, paddingTop: '1px' }}>{t.message}</div>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="Fermer"
              style={{
                background: 'transparent',
                border: 'none',
                color: 'inherit',
                cursor: 'pointer',
                opacity: 0.7,
                fontSize: '18px',
                lineHeight: 1,
                padding: '0 2px',
                marginTop: '-2px',
              }}
            >
              ×
            </button>
          </div>
        );
      })}
      <style>{`
        @keyframes ms-toast-slide-in {
          from { opacity: 0; transform: translateY(-8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
