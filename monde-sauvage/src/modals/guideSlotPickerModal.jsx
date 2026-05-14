import { useEffect, useMemo, useState } from 'react';

const formatDate = (isoDate, locale) =>
  new Date(isoDate + 'T00:00:00').toLocaleDateString(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

const formatTime = (iso, locale) =>
  iso ? new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) : '';

export default function GuideSlotPickerModal({
  open,
  onClose,
  onConfirm,
  guide,
  events = [],
  loading = false,
  selectedSlots = [],
  onToggleSlot,
  language = 'fr',
  dateRange,
  hourlyRate,
}) {
  const t = (fr, en) => (language === 'en' ? en : fr);
  const locale = language === 'en' ? 'en-CA' : 'fr-CA';

  const [activeDate, setActiveDate] = useState(null);

  const eventsByDate = useMemo(() => {
    const map = new Map();
    events.forEach((event) => {
      const date = event.date || (event.start ? event.start.split('T')[0] : 'unknown');
      if (!map.has(date)) map.set(date, []);
      map.get(date).push(event);
    });
    return map;
  }, [events]);

  const sortedDates = useMemo(
    () => [...eventsByDate.keys()].sort(),
    [eventsByDate],
  );

  useEffect(() => {
    if (open && sortedDates.length > 0 && !activeDate) {
      setActiveDate(sortedDates[0]);
    }
  }, [open, sortedDates, activeDate]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  const slotsForActiveDate = activeDate ? eventsByDate.get(activeDate) || [] : [];

  const totalHours = selectedSlots.reduce((sum, slot) => {
    if (typeof slot.durationHours === 'number') return sum + slot.durationHours;
    if (slot.start && slot.end) {
      return sum + (new Date(slot.end) - new Date(slot.start)) / 3_600_000;
    }
    return sum;
  }, 0);

  const totalPrice = hourlyRate ? Math.round(hourlyRate * totalHours) : null;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.55)',
        zIndex: 9500,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(960px, 100%)',
          maxHeight: '90vh',
          background: '#FFFCF7',
          borderRadius: 16,
          boxShadow: '0 30px 80px rgba(0,0,0,0.35)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '18px 22px',
            borderBottom: '1px solid #E5E7EB',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, color: '#5A7766', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              {t('Choisir vos créneaux', 'Pick your time slots')}
            </div>
            <h2 style={{ margin: '4px 0 0', fontSize: 18, color: '#1F3A2E', fontWeight: 700 }}>
              {guide?.name || t('Guide', 'Guide')}
            </h2>
            {dateRange?.start && dateRange?.end && (
              <p style={{ margin: '2px 0 0', fontSize: 12, color: '#6B7280' }}>
                {new Date(dateRange.start + 'T00:00:00').toLocaleDateString(locale, { day: 'numeric', month: 'short' })}
                {' → '}
                {new Date(dateRange.end + 'T00:00:00').toLocaleDateString(locale, { day: 'numeric', month: 'short' })}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('Fermer', 'Close')}
            style={{
              background: '#F1F5F9',
              border: 'none',
              width: 36,
              height: 36,
              borderRadius: '50%',
              cursor: 'pointer',
              fontSize: 18,
              color: '#0f172a',
              flexShrink: 0,
            }}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div
          style={{
            display: 'flex',
            flex: 1,
            minHeight: 0,
            flexDirection: 'row',
          }}
        >
          {/* Left column: dates */}
          <div
            style={{
              width: 230,
              borderRight: '1px solid #E5E7EB',
              overflowY: 'auto',
              padding: 12,
              background: '#FAFBFA',
            }}
          >
            {loading ? (
              <p style={{ fontSize: 13, color: '#5A7766', margin: 0, padding: 12 }}>
                {t('Chargement...', 'Loading...')}
              </p>
            ) : sortedDates.length === 0 ? (
              <p style={{ fontSize: 13, color: '#5A7766', margin: 0, padding: 12 }}>
                {t('Aucun créneau pour cette période.', 'No slots in this date range.')}
              </p>
            ) : (
              sortedDates.map((date) => {
                const isActive = date === activeDate;
                const slotCount = (eventsByDate.get(date) || []).length;
                const selectedCount = (eventsByDate.get(date) || []).filter((s) =>
                  selectedSlots.some((sel) => sel.id === s.id),
                ).length;
                return (
                  <button
                    key={date}
                    type="button"
                    onClick={() => setActiveDate(date)}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '10px 12px',
                      marginBottom: 4,
                      borderRadius: 8,
                      border: isActive ? '1.5px solid #2D5F4C' : '1px solid transparent',
                      background: isActive ? 'rgba(45, 95, 76, 0.08)' : 'transparent',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 2,
                    }}
                  >
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#1F3A2E', textTransform: 'capitalize' }}>
                      {formatDate(date, locale)}
                    </span>
                    <span style={{ fontSize: 11, color: '#5A7766' }}>
                      {slotCount} {t('créneau(x)', 'slot(s)')}
                      {selectedCount > 0 && (
                        <span style={{ color: '#22C55E', fontWeight: 600, marginLeft: 6 }}>
                          • {selectedCount} ✓
                        </span>
                      )}
                    </span>
                  </button>
                );
              })
            )}
          </div>

          {/* Right column: slots */}
          <div style={{ flex: 1, overflowY: 'auto', padding: 18 }}>
            {!activeDate ? (
              <div style={{ textAlign: 'center', padding: 40, color: '#5A7766' }}>
                {t('Sélectionnez une date pour voir les créneaux.', 'Select a date to view slots.')}
              </div>
            ) : (
              <>
                <h3 style={{ margin: '0 0 14px', fontSize: 16, color: '#1F3A2E', fontWeight: 600, textTransform: 'capitalize' }}>
                  {formatDate(activeDate, locale)}
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
                  {slotsForActiveDate.map((slot) => {
                    const isSelected = selectedSlots.some((s) => s.id === slot.id);
                    const startTime = formatTime(slot.start, locale);
                    const endTime = formatTime(slot.end, locale);
                    const hours = typeof slot.durationHours === 'number'
                      ? slot.durationHours
                      : (slot.start && slot.end ? (new Date(slot.end) - new Date(slot.start)) / 3_600_000 : null);

                    return (
                      <button
                        key={slot.id}
                        type="button"
                        onClick={() => onToggleSlot && onToggleSlot(slot)}
                        style={{
                          padding: '12px 14px',
                          borderRadius: 10,
                          border: isSelected ? '2px solid #22C55E' : '1.5px solid #E5E7EB',
                          background: isSelected ? 'rgba(34, 197, 94, 0.10)' : '#fff',
                          cursor: 'pointer',
                          textAlign: 'left',
                          transition: 'all 120ms ease',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 4,
                        }}
                      >
                        <span style={{ fontSize: 13, fontWeight: 700, color: '#1F3A2E' }}>
                          {startTime} – {endTime}
                        </span>
                        {hours != null && (
                          <span style={{ fontSize: 11, color: '#5A7766' }}>
                            {hours}h {slot.sessionLabel ? `• ${slot.sessionLabel}` : ''}
                          </span>
                        )}
                        {isSelected && (
                          <span style={{ fontSize: 11, color: '#16A34A', fontWeight: 600 }}>✓ {t('Sélectionné', 'Selected')}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            borderTop: '1px solid #E5E7EB',
            padding: '14px 22px',
            background: '#FFFCF7',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ fontSize: 13, color: '#1F3A2E' }}>
            <strong>{selectedSlots.length}</strong> {t('créneau(x)', 'slot(s)')}
            {totalHours > 0 && (
              <>
                {' • '}
                <strong>{totalHours}h</strong> {t('total', 'total')}
              </>
            )}
            {totalPrice != null && totalPrice > 0 && (
              <>
                {' • '}
                <strong>{totalPrice} $</strong>
              </>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '10px 18px',
                borderRadius: 8,
                border: '1px solid #E5E7EB',
                background: '#fff',
                color: '#0f172a',
                cursor: 'pointer',
                fontSize: 14,
                fontWeight: 500,
              }}
            >
              {t('Annuler', 'Cancel')}
            </button>
            <button
              type="button"
              onClick={() => onConfirm && onConfirm(selectedSlots)}
              disabled={selectedSlots.length === 0}
              style={{
                padding: '10px 22px',
                borderRadius: 8,
                border: 'none',
                background: selectedSlots.length === 0 ? '#A1A1AA' : '#2D5F4C',
                color: '#fff',
                cursor: selectedSlots.length === 0 ? 'not-allowed' : 'pointer',
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              {t('Confirmer', 'Confirm')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
