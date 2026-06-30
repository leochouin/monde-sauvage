import { useEffect, useRef, useState } from 'react';

// Custom establishment switcher — replaces the native <select> so we can add a
// non-establishment action ("+ Ajouter un établissement") at the bottom of the
// list, which a browser <select> can't render as a distinct action.
export default function EstablishmentSwitcher({ establishments, selected, onSelect, onAddNew }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  const selectedKey = String(selected?.key ?? selected?.id ?? '');
  const activeName = selected?.Name ?? selected?.name ?? 'Mon établissement';

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const handlePointer = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const handleKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const handleSelect = (estab) => {
    setOpen(false);
    if (String(estab.key ?? estab.id) !== selectedKey) onSelect(estab);
  };

  const handleAdd = () => {
    setOpen(false);
    onAddNew();
  };

  return (
    <div className="esbl-switcher" ref={rootRef}>
      <button
        type="button"
        className="esbl-switcher-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="esbl-switcher-label">{activeName}</span>
        <span className={`esbl-switcher-caret${open ? ' open' : ''}`} aria-hidden="true">▾</span>
      </button>

      {open && (
        <div className="esbl-switcher-menu" role="listbox">
          {establishments.map((estab) => {
            const k = String(estab.key ?? estab.id ?? '');
            const isActive = k === selectedKey;
            return (
              <button
                key={k}
                type="button"
                role="option"
                aria-selected={isActive}
                className={`esbl-switcher-item${isActive ? ' active' : ''}`}
                onClick={() => handleSelect(estab)}
              >
                <span className="esbl-switcher-item-name">
                  {estab.Name ?? estab.name ?? `Établissement ${k}`}
                </span>
                {isActive && <span className="esbl-switcher-check" aria-hidden="true">✓</span>}
              </button>
            );
          })}

          {establishments.length > 0 && <div className="esbl-switcher-divider" />}

          <button
            type="button"
            className="esbl-switcher-item esbl-switcher-add"
            onClick={handleAdd}
          >
            <span className="esbl-switcher-add-icon" aria-hidden="true">＋</span>
            Ajouter un établissement
          </button>
        </div>
      )}
    </div>
  );
}
