import { useCallback, useEffect, useMemo, useState } from 'react';
import { parseCsvRows } from '../utils/csvParse.js';
import { cancelStalePendingAllocations, createEstablishmentManualBooking, importEstablishmentBookingsBatch } from '../utils/bookingService.js';
import { toast } from '../utils/toast.js';
import supabase from '../utils/supabase.js';

function parseDateCell(raw) {
  const s = String(raw ?? '').trim();
  if (!s) throw new Error('Date vide');
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (m) {
    const a = +m[1];
    const b = +m[2];
    const y = m[3];
    if (a > 12) return `${y}-${String(b).padStart(2, '0')}-${String(a).padStart(2, '0')}`;
    if (b > 12) return `${y}-${String(a).padStart(2, '0')}-${String(b).padStart(2, '0')}`;
    return `${y}-${String(b).padStart(2, '0')}-${String(a).padStart(2, '0')}`;
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new Error(`Date non reconnue : ${raw}`);
  return d.toISOString().slice(0, 10);
}

const fmtCAD = (n) =>
  n == null ? '' : new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' }).format(n);

const toYmd = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const WEEK_DAYS = ['Lu', 'Ma', 'Me', 'Je', 'Ve', 'Sa', 'Di'];

function MiniBookingCalendar({ bookedDayStrings, startYmd, endYmd, onRangeChange }) {
  const todayYmd = useMemo(() => toYmd(new Date()), []);
  const [vy, setVy] = useState(() => startYmd ? +startYmd.slice(0, 4) : new Date().getFullYear());
  const [vm, setVm] = useState(() => startYmd ? +startYmd.slice(5, 7) - 1 : new Date().getMonth());
  const [hover, setHover] = useState(null);

  const prevMonth = () => { if (vm === 0) { setVy((y) => y - 1); setVm(11); } else setVm((m) => m - 1); };
  const nextMonth = () => { if (vm === 11) { setVy((y) => y + 1); setVm(0); } else setVm((m) => m + 1); };

  const daysInMonth = new Date(vy, vm + 1, 0).getDate();
  const firstDay = (new Date(vy, vm, 1).getDay() + 6) % 7;
  const monthLabel = new Date(vy, vm, 1).toLocaleDateString('fr-CA', { month: 'long', year: 'numeric' });

  const cells = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) =>
      `${vy}-${String(vm + 1).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`),
  ];

  // Effective range including hover preview
  const selecting = !!(startYmd && !endYmd);
  const effEnd = endYmd || (selecting && hover ? hover : null);
  const [rA, rB] = startYmd && effEnd
    ? (startYmd <= effEnd ? [startYmd, effEnd] : [effEnd, startYmd])
    : [startYmd, null];
  const isPreviewing = !!(selecting && hover);

  const handleClick = (ymd) => {
    if (!startYmd || endYmd) { onRangeChange(ymd, null); }
    else if (ymd === startYmd) { onRangeChange(null, null); }
    else {
      const [s, e] = ymd < startYmd ? [ymd, startYmd] : [startYmd, ymd];
      onRangeChange(s, e);
    }
  };

  const navBtn = {
    background: 'none', border: '1px solid #e2e8f0', borderRadius: 6,
    width: 28, height: 28, cursor: 'pointer', fontSize: '1rem', color: '#64748b',
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
  };

  return (
    <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden', maxWidth: 312, userSelect: 'none' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '10px 12px', borderBottom: '1px solid #f1f5f9' }}>
        <button type="button" onClick={prevMonth} style={navBtn}>‹</button>
        <span style={{ flex: 1, textAlign: 'center', fontSize: '0.88rem', fontWeight: 700, color: '#0f172a', textTransform: 'capitalize' }}>
          {monthLabel}
        </span>
        <button type="button" onClick={nextMonth} style={navBtn}>›</button>
      </div>

      {/* Day-of-week labels */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', padding: '8px 8px 2px' }}>
        {WEEK_DAYS.map((d) => (
          <div key={d} style={{ textAlign: 'center', fontSize: '0.66rem', fontWeight: 700, color: '#94a3b8' }}>{d}</div>
        ))}
      </div>

      {/* Day grid — no gap so the range stripe is seamless */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', padding: '2px 8px 10px' }}>
        {cells.map((ymd, idx) => {
          if (!ymd) return <div key={`e${idx}`} style={{ height: 36 }} />;

          const isStart = ymd === rA;
          const isEnd = !!(rB && ymd === rB);
          const inRange = !!(rA && rB && ymd > rA && ymd < rB);
          const isBooked = bookedDayStrings.has(ymd);
          const isToday = ymd === todayYmd;
          const isEndpoint = isStart || isEnd;

          // Seamless stripe behind the circle — left/right clipped at endpoints
          const showStrip = (isEndpoint || inRange) && !isBooked;
          const stripLeft = isStart ? '50%' : '0';
          const stripRight = isEnd ? '50%' : '0';
          const stripBg = isPreviewing ? '#e0f2fe' : '#dbeafe';

          // Circle style
          let circleBg = 'transparent';
          let circleColor = '#1e293b';
          let circleFw = 400;
          if (isEndpoint) { circleBg = '#2563eb'; circleColor = 'white'; circleFw = 700; }
          else if (isBooked) { circleBg = '#fed7aa'; circleColor = '#9a3412'; circleFw = 600; }
          else if (inRange) circleColor = '#1d4ed8';
          else if (isToday) { circleColor = '#2563eb'; circleFw = 700; }

          return (
            <div
              key={ymd}
              onClick={() => handleClick(ymd)}
              onMouseEnter={() => setHover(ymd)}
              onMouseLeave={() => setHover(null)}
              title={isBooked ? 'Déjà réservé' : undefined}
              style={{ height: 36, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
            >
              {/* Continuous range stripe */}
              {showStrip && (
                <div style={{ position: 'absolute', top: 3, bottom: 3, left: stripLeft, right: stripRight, background: stripBg, pointerEvents: 'none' }} />
              )}
              {/* Day circle */}
              <div style={{
                position: 'relative', zIndex: 1,
                width: 30, height: 30, borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: circleBg, color: circleColor, fontWeight: circleFw, fontSize: '0.82rem',
                ...(isToday && !isEndpoint ? { outline: '2px solid #bfdbfe', outlineOffset: -2 } : {}),
                transition: 'background 0.1s',
              }}>
                {+ymd.slice(8)}
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div style={{ borderTop: '1px solid #f8fafc', padding: '6px 12px', display: 'flex', gap: 12 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.7rem', color: '#64748b' }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#fed7aa', border: '1px solid #fb923c', display: 'inline-block' }} />
          Déjà réservé
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.7rem', color: '#64748b' }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#2563eb', display: 'inline-block' }} />
          Sélectionné
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.7rem', color: '#64748b' }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', border: '2px solid #bfdbfe', display: 'inline-block' }} />
          Aujourd'hui
        </span>
      </div>
    </div>
  );
}

export default function EstablishmentBookingsPanel({ establishmentId, chalets }) {
  const chaletIds = useMemo(() => chalets.map((c) => c.key ?? c.id).filter(Boolean), [chalets]);
  const chaletByKey = useMemo(() => {
    const m = new Map();
    for (const c of chalets) {
      const k = c.key ?? c.id;
      if (k) m.set(String(k), c);
    }
    return m;
  }, [chalets]);

  const resolveChaletFromLabel = useCallback(
    (label) => {
      const t = String(label ?? '').trim();
      if (!t) return null;
      for (const c of chalets) {
        const k = c.key ?? c.id;
        const name = (c.Name || c.name || '').trim();
        if (k && String(k).toLowerCase() === t.toLowerCase()) return String(k);
        if (name && name.toLowerCase() === t.toLowerCase()) return String(k);
      }
      return null;
    },
    [chalets],
  );

  // ── Bookings list ────────────────────────────────────────────────────────────
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // ── Manual booking form ──────────────────────────────────────────────────────
  const [chaletId, setChaletId] = useState('');
  const [startYmd, setStartYmd] = useState('');
  const [endYmd, setEndYmd] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [skipOverlap, setSkipOverlap] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState('paid');
  const [saving, setSaving] = useState(false);

  // ── Bookings for calendar view (toutes origines, chalet sélectionné) ────────
  const [allBookingsForChalet, setAllBookingsForChalet] = useState([]);

  useEffect(() => {
    if (!chaletId) { setAllBookingsForChalet([]); return; }
    supabase
      .from('bookings')
      .select('start_date, end_date, customer_name, status')
      .eq('chalet_id', chaletId)
      .in('status', ['confirmed', 'pending', 'blocked'])
      .then(({ data }) => setAllBookingsForChalet(data || []));
  }, [chaletId]);

  // ── Inventory ────────────────────────────────────────────────────────────────
  const [equipmentKinds, setEquipmentKinds] = useState([]);
  const [inventoryUnits, setInventoryUnits] = useState([]);
  const [loadingInventory, setLoadingInventory] = useState(false);
  const [poolAvailability, setPoolAvailability] = useState({});
  const [checkingAvail, setCheckingAvail] = useState(false);
  const [selectedExtras, setSelectedExtras] = useState({});

  // ── CSV import ───────────────────────────────────────────────────────────────
  const [importOpen, setImportOpen] = useState(false);
  const [csvRows, setCsvRows] = useState([]);
  const [headerRowIsLabels, setHeaderRowIsLabels] = useState(true);
  const [mapChalet, setMapChalet] = useState('');
  const [mapStart, setMapStart] = useState('');
  const [mapEnd, setMapEnd] = useState('');
  const [mapName, setMapName] = useState('');
  const [mapEmail, setMapEmail] = useState('');
  const [mapNotes, setMapNotes] = useState('');
  const [importing, setImporting] = useState(false);
  const [importErrors, setImportErrors] = useState([]);
  const [syncGoogleOnImport, setSyncGoogleOnImport] = useState(false);
  // Mapping CSV chalet name → Supabase chalet UUID (étape de migration Manisoft)
  const [chaletMapping, setChaletMapping] = useState({});

  // ── Load bookings ────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!establishmentId || chaletIds.length === 0) {
      setBookings([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    // Libérer l'inventaire gelé par des paiements expirés (silencieux)
    cancelStalePendingAllocations(chaletIds).catch(() => {});
    try {
      const { data, error: qErr } = await supabase
        .from('bookings')
        .select('*')
        .in('chalet_id', chaletIds)
        .eq('booking_origin', 'establishment_manual')
        .order('start_date', { ascending: false })
        .limit(250);
      if (qErr) throw qErr;
      setBookings(data || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [establishmentId, chaletIds]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (chalets.length && !chaletId) {
      setChaletId(String(chalets[0].key ?? chalets[0].id));
    }
  }, [chalets, chaletId]);

  // ── Load inventory (equipment kinds + units) ─────────────────────────────────
  useEffect(() => {
    if (!establishmentId) {
      setEquipmentKinds([]);
      setInventoryUnits([]);
      return;
    }
    setLoadingInventory(true);
    Promise.all([
      supabase
        .from('equipment_kind')
        .select('*')
        .eq('establishment_id', establishmentId)
        .eq('is_active', true)
        .order('label'),
      supabase
        .from('inventory_unit')
        .select('*')
        .eq('establishment_id', establishmentId)
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('sort_order', { ascending: true }),
    ])
      .then(([kindsRes, unitsRes]) => {
        if (kindsRes.error) throw kindsRes.error;
        if (unitsRes.error) throw unitsRes.error;
        setEquipmentKinds(kindsRes.data || []);
        setInventoryUnits(unitsRes.data || []);
      })
      .catch((e) => console.error('inventory load:', e))
      .finally(() => setLoadingInventory(false));
  }, [establishmentId]);

  // ── Derived inventory state ──────────────────────────────────────────────────

  // Units physically assigned to the selected chalet (always included with booking)
  const chaletIncludedUnits = useMemo(
    () => inventoryUnits.filter((u) => u.chalet_id && String(u.chalet_id) === String(chaletId)),
    [inventoryUnits, chaletId],
  );

  // Equipment kinds that have at least one pool unit (chalet_id = null)
  const poolKinds = useMemo(() => {
    const kindsWithPool = new Set(
      inventoryUnits.filter((u) => !u.chalet_id).map((u) => u.equipment_kind_id),
    );
    return equipmentKinds.filter((k) => kindsWithPool.has(k.id));
  }, [equipmentKinds, inventoryUnits]);

  // Pool unit IDs grouped by kind id
  const poolUnitsByKind = useMemo(() => {
    const map = {};
    for (const u of inventoryUnits) {
      if (!u.chalet_id) {
        if (!map[u.equipment_kind_id]) map[u.equipment_kind_id] = [];
        map[u.equipment_kind_id].push(u.id);
      }
    }
    return map;
  }, [inventoryUnits]);

  // Number of nights between selected dates
  const nights = useMemo(() => {
    if (!startYmd || !endYmd) return 0;
    const diff = (new Date(endYmd) - new Date(startYmd)) / 86400000;
    return diff > 0 ? Math.round(diff) : 0;
  }, [startYmd, endYmd]);

  // Selected chalet object (for price_per_night)
  const selectedChalet = useMemo(
    () => chalets.find((c) => String(c.key ?? c.id) === chaletId),
    [chalets, chaletId],
  );

  // Total price: chalet base + extras
  const totalPrice = useMemo(() => {
    const base = (selectedChalet?.price_per_night || 0) * nights;
    let extras = 0;
    for (const [kindId, qty] of Object.entries(selectedExtras)) {
      if (!qty || qty < 1) continue;
      const kind = equipmentKinds.find((k) => k.id === kindId);
      if (!kind) continue;
      const meta = kind.metadata || {};
      if (meta.addon_price_per_stay) extras += meta.addon_price_per_stay * qty;
      else if (meta.addon_price_per_night) extras += meta.addon_price_per_night * nights * qty;
    }
    return base + extras;
  }, [selectedChalet, nights, selectedExtras, equipmentKinds]);

  // Jours réservés (string YYYY-MM-DD) pour le chalet sélectionné
  const bookedDayStrings = useMemo(() => {
    const days = new Set();
    for (const b of allBookingsForChalet) {
      const startStr = String(b.start_date).slice(0, 10);
      const endStr = String(b.end_date).slice(0, 10);
      let cur = new Date(startStr + 'T12:00:00');
      const end = new Date(endStr + 'T12:00:00');
      while (cur < end) {
        const y = cur.getFullYear();
        const m = String(cur.getMonth() + 1).padStart(2, '0');
        const d = String(cur.getDate()).padStart(2, '0');
        days.add(`${y}-${m}-${d}`);
        cur = new Date(cur.getTime() + 86400000);
      }
    }
    return days;
  }, [allBookingsForChalet]);

  // Chevauchement entre la sélection actuelle et les réservations existantes
  const selectionOverlaps = useMemo(() => {
    if (!startYmd || !endYmd) return false;
    const s = new Date(startYmd + 'T12:00:00');
    const e = new Date(endYmd + 'T12:00:00');
    return allBookingsForChalet.some((b) => {
      const bs = new Date(String(b.start_date).slice(0, 10) + 'T12:00:00');
      const be = new Date(String(b.end_date).slice(0, 10) + 'T12:00:00');
      return bs < e && be > s;
    });
  }, [startYmd, endYmd, allBookingsForChalet]);

  // ── Check pool availability when chalet or dates change ──────────────────────
  useEffect(() => {
    // Reset extras when chalet changes
    setSelectedExtras({});
  }, [chaletId]);

  useEffect(() => {
    const allPoolIds = Object.values(poolUnitsByKind).flat();
    if (!startYmd || !endYmd || nights <= 0 || allPoolIds.length === 0) {
      setPoolAvailability({});
      return;
    }
    setCheckingAvail(true);
    const startIso = `${startYmd}T00:00:00.000Z`;
    const endIso = `${endYmd}T00:00:00.000Z`;
    supabase
      .from('booking_inventory_allocation')
      .select('inventory_unit_id')
      .in('inventory_unit_id', allPoolIds)
      .in('status', ['pending', 'pending_payment', 'confirmed', 'blocked'])
      .lt('start_at', endIso)
      .gt('end_at', startIso)
      .then(({ data, error: qErr }) => {
        if (qErr) { console.error('pool avail check:', qErr); return; }
        const takenIds = new Set((data || []).map((r) => r.inventory_unit_id));
        const avail = {};
        for (const [kindId, unitIds] of Object.entries(poolUnitsByKind)) {
          avail[kindId] = unitIds.filter((id) => !takenIds.has(id)).length;
        }
        setPoolAvailability(avail);
        // Clamp existing selections to new availability
        setSelectedExtras((prev) => {
          const clamped = { ...prev };
          let changed = false;
          for (const [kindId, qty] of Object.entries(clamped)) {
            const max = avail[kindId] ?? 0;
            if (qty > max) { clamped[kindId] = max; changed = true; }
          }
          return changed ? clamped : prev;
        });
      })
      .finally(() => setCheckingAvail(false));
  }, [startYmd, endYmd, nights, poolUnitsByKind]);

  // ── CSV import helpers ────────────────────────────────────────────────────────
  const headers = useMemo(() => {
    if (csvRows.length === 0) return [];
    return csvRows[0].map((c, i) => String(c || '').trim() || `Colonne ${i + 1}`);
  }, [csvRows]);

  const dataRows = useMemo(() => {
    if (csvRows.length <= 1) return [];
    return headerRowIsLabels ? csvRows.slice(1) : csvRows;
  }, [csvRows, headerRowIsLabels]);

  // Noms de chalets uniques trouvés dans le CSV (dès que la colonne est mappée)
  const uniqueCsvChaletNames = useMemo(() => {
    if (mapChalet === '' || dataRows.length === 0) return [];
    const ic = Number.parseInt(mapChalet, 10);
    const names = new Set();
    for (const row of dataRows) {
      const name = String(row[ic] ?? '').trim();
      if (name) names.add(name);
    }
    return [...names].sort();
  }, [mapChalet, dataRows]);

  // Auto-remplir le mapping dès que les noms uniques changent (fuzzy match existant)
  useEffect(() => {
    if (uniqueCsvChaletNames.length === 0) {
      setChaletMapping({});
      return;
    }
    setChaletMapping((prev) => {
      const next = {};
      for (const name of uniqueCsvChaletNames) {
        if (prev[name]) {
          next[name] = prev[name];
        } else {
          next[name] = resolveChaletFromLabel(name) || '';
        }
      }
      return next;
    });
  }, [uniqueCsvChaletNames, resolveChaletFromLabel]);

  const allChaletsMapped =
    uniqueCsvChaletNames.length === 0 ||
    uniqueCsvChaletNames.every((name) => !!chaletMapping[name]);

  const colOptions = useMemo(() => {
    if (csvRows.length === 0) return [];
    const maxCols = Math.max(...csvRows.map((r) => r.length));
    return Array.from({ length: maxCols }, (_, i) => ({
      value: String(i),
      label: headers[i] || `Colonne ${i + 1}`,
    }));
  }, [csvRows, headers]);

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const rows = parseCsvRows(String(reader.result || ''));
      setCsvRows(rows);
      setHeaderRowIsLabels(true);
      setImportErrors([]);
      setChaletMapping({});
      if (rows.length > 0) {
        const r0 = rows[0].map((x) => String(x || '').toLowerCase());
        const idx = (subs) =>
          r0.findIndex((h) => subs.some((s) => h.includes(s)));
        const iCh = idx(['chalet', 'nom du chalet', 'unit']);
        const iSt = idx(['arriv', 'debut', 'start', 'check']);
        const iEn = idx(['depart', 'fin', 'end']);
        const iNm = idx(['nom', 'client', 'name']);
        const iEm = idx(['email', 'courriel', 'mail']);
        const iNo = idx(['note', 'comment']);
        setMapChalet(iCh >= 0 ? String(iCh) : '');
        setMapStart(iSt >= 0 ? String(iSt) : '');
        setMapEnd(iEn >= 0 ? String(iEn) : '');
        setMapName(iNm >= 0 ? String(iNm) : '');
        setMapEmail(iEm >= 0 ? String(iEm) : '');
        setMapNotes(iNo >= 0 ? String(iNo) : '');
      }
    };
    reader.readAsText(file, 'UTF-8');
    e.target.value = '';
  };

  const downloadTemplate = () => {
    const bom = '﻿';
    const line =
      'chalet_nom,date_arrivee,date_depart,nom_client,courriel,notes\n' +
      'Mon chalet (nom affiché),2026-06-01,2026-06-08,Jean Tremblay,jean@exemple.com,Ancien logiciel\n';
    const blob = new Blob([bom + line], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = globalThis.document.createElement('a');
    a.href = url;
    a.download = 'modele-reservations-pourvoirie.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const buildImportRows = () => {
    const ic = mapChalet === '' ? -1 : Number.parseInt(mapChalet, 10);
    const is = mapStart === '' ? -1 : Number.parseInt(mapStart, 10);
    const ie = mapEnd === '' ? -1 : Number.parseInt(mapEnd, 10);
    const inm = mapName === '' ? -1 : Number.parseInt(mapName, 10);
    const iem = mapEmail === '' ? -1 : Number.parseInt(mapEmail, 10);
    const ino = mapNotes === '' ? -1 : Number.parseInt(mapNotes, 10);

    if (Number.isNaN(ic) || ic < 0) throw new Error('Choisissez la colonne du chalet.');
    if (Number.isNaN(is) || is < 0) throw new Error("Choisissez la colonne de la date d'arrivée.");
    if (Number.isNaN(ie) || ie < 0) throw new Error('Choisissez la colonne de la date de départ.');
    if (Number.isNaN(inm) || inm < 0) throw new Error('Choisissez la colonne du nom du client.');

    const out = [];
    for (let r = 0; r < dataRows.length; r += 1) {
      const row = dataRows[r];
      const chLabel = row[ic] != null ? String(row[ic]).trim() : '';
      let startY;
      let endY;
      try {
        startY = parseDateCell(row[is]);
        endY = parseDateCell(row[ie]);
      } catch (err) {
        throw new Error(`Ligne ${r + 1}: ${err.message}`);
      }
      const nm = row[inm] != null ? String(row[inm]).trim() : '';
      const em = iem >= 0 && row[iem] != null ? String(row[iem]).trim() : '';
      const no = ino >= 0 && row[ino] != null ? String(row[ino]).trim() : '';
      out.push({
        chaletLabel: chLabel,
        startDateYmd: startY,
        endDateYmd: endY,
        customerName: nm,
        customerEmail: em,
        notes: no,
      });
    }
    return out;
  };

  const handleImport = async () => {
    if (!allChaletsMapped) {
      toast.error('Assignez tous les chalets dans le tableau de correspondance avant d\'importer.');
      return;
    }
    let parsed;
    try {
      parsed = buildImportRows();
    } catch (err) {
      toast.error(err.message);
      return;
    }
    setImporting(true);
    setImportErrors([]);
    try {
      const resolver = uniqueCsvChaletNames.length > 0
        ? (row) => chaletMapping[row.chaletLabel] || null
        : (row) => resolveChaletFromLabel(row.chaletLabel);
      const { inserted, errors } = await importEstablishmentBookingsBatch(
        parsed,
        resolver,
        { syncToGoogle: syncGoogleOnImport },
      );
      setImportErrors(errors);
      toast.success(`${inserted} réservation(s) importée(s).`);
      await load();
      if (errors.length === 0) {
        setCsvRows([]);
        setImportOpen(false);
      }
    } catch (err) {
      toast.error(err.message || 'Import impossible');
    } finally {
      setImporting(false);
    }
  };

  // ── Submit manual booking ────────────────────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!chaletId) {
      toast.error('Choisissez un chalet.');
      return;
    }
    setSaving(true);
    try {
      const chaletUnitIds = chaletIncludedUnits.map((u) => u.id);
      const poolLines = Object.entries(selectedExtras)
        .filter(([, qty]) => qty > 0)
        .map(([kindId, quantity]) => ({ equipment_kind_id: kindId, quantity }));

      const { googleSync } = await createEstablishmentManualBooking({
        chaletId,
        startDateYmd: startYmd,
        endDateYmd: endYmd,
        customerName,
        customerEmail,
        notes,
        skipOverlapCheck: skipOverlap,
        syncToGoogle: true,
        source: skipOverlap ? 'migration' : 'manual',
        chaletUnitIds,
        poolLines,
        totalPrice: totalPrice > 0 ? totalPrice : undefined,
        nights: nights > 0 ? nights : undefined,
        paymentStatus,
      });

      if (googleSync?.ok) {
        toast.success('Réservation enregistrée et visible dans Google Agenda (sous-agenda du chalet).');
      } else {
        toast.success('Réservation enregistrée dans Monde Sauvage.');
        if (googleSync?.skipped === 'no_chalet_calendar') {
          toast.show(
            "Aucun agenda Google n'est lié à ce chalet : l'événement n'apparaît pas dans Google. Connectez Google (onglet Calendrier) puis créez l'agenda du chalet dans l'onglet Chalets.",
            { type: 'info', duration: 10000 },
          );
        } else if (googleSync && !googleSync.ok && googleSync.error) {
          toast.show(
            `Google Agenda : ${googleSync.error}${googleSync.requiresAuth ? " — reconnectez Google dans l'onglet Calendrier." : ''}`,
            { type: 'info', duration: 9000 },
          );
        }
      }
      setCustomerName('');
      setCustomerEmail('');
      setNotes('');
      setSelectedExtras({});
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleCancelBooking = async (id) => {
    if (!globalThis.confirm('Annuler cette réservation ?')) return;
    try {
      const { error } = await supabase.from('bookings').update({ status: 'cancelled' }).eq('id', id);
      if (error) throw error;
      toast.success('Réservation annulée.');
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const previewRows = dataRows.slice(0, 8);

  const inputStyle = {
    padding: '10px 12px',
    borderRadius: 10,
    border: '1px solid #d1d5db',
    fontSize: '0.9rem',
    background: '#ffffff',
    color: '#0f172a',
    width: '100%',
    boxSizing: 'border-box',
  };
  const cardStyle = {
    background: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: 16,
    padding: 22,
    boxShadow: '0 4px 14px rgba(15, 23, 42, 0.07), 0 1px 3px rgba(15, 23, 42, 0.05)',
  };
  const datesReady = startYmd && endYmd && nights > 0;

  return (
    <div
      className="guide-section guide-card"
      style={{
        border: '1px solid #e2e8f0',
        borderRadius: 16,
        background: '#f7f5f0',
        padding: 24,
      }}
    >
      <h2 className="guide-section-title" style={{ padding: 0, marginBottom: 8, background: 'transparent', borderBottom: 'none', color: '#1c2b20' }}>
        Réservations (migration)
      </h2>
      <p style={{ color: '#64748b', fontSize: '0.92rem', margin: '0 0 16px' }}>
        Créez des séjours venant de votre ancien système ou saisissez-les une par une. Aucune commission Monde Sauvage sur ces entrées. Les dates evitent les
        doublons avec les réservations déjà confirmées ; cochez « Ignorer les conflits » seulement pour un import de masse ou si vous assumez le chevauchement.
        Pour voir le séjour dans <strong>Google Agenda</strong>, le chalet doit avoir un sous-agenda créé (connexion Google dans l'onglet Calendrier / création de
        chalet).
      </p>

      {error && (
        <div
          style={{
            padding: 12,
            background: '#fee2e2',
            color: '#991b1b',
            borderRadius: 8,
            marginBottom: 12,
            fontSize: '0.9rem',
          }}
        >
          {error}
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        style={{
          marginBottom: 22,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700, color: '#1c2b20', letterSpacing: '-0.01em' }}>Nouvelle réservation</h3>

        {/* ── Chalet + client ── */}
        <div style={cardStyle}>
          <div style={{ marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid #f1f5f9' }}>
            <p style={{ margin: 0, fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.1em', color: '#94a3b8', textTransform: 'uppercase' }}>
              Informations client
            </p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.82rem', color: '#475569' }}>
              Chalet
              <select value={chaletId} onChange={(e) => setChaletId(e.target.value)} style={inputStyle}>
                {chalets.map((c) => (
                  <option key={c.key ?? c.id} value={String(c.key ?? c.id)}>
                    {c.Name || c.name || 'Chalet'}
                  </option>
                ))}
              </select>
            </label>
            <input
              placeholder="Nom du client *"
              required
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              style={inputStyle}
            />
            <input
              type="email"
              placeholder="Courriel"
              value={customerEmail}
              onChange={(e) => setCustomerEmail(e.target.value)}
              style={inputStyle}
            />
            <input
              placeholder="Notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              style={{ ...inputStyle, gridColumn: '1 / -1' }}
            />
          </div>

          {/* ── Paiement ── */}
          <div style={{ marginTop: 14, display: 'flex', gap: 0, borderRadius: 10, overflow: 'hidden', border: '1px solid #e2e8f0', alignSelf: 'flex-start' }}>
            {[
              { value: 'paid', label: 'Déjà payé', color: '#15803d', bg: '#f0fdf4', activeBg: '#dcfce7' },
              { value: 'unpaid', label: 'À percevoir', color: '#92400e', bg: '#fffbeb', activeBg: '#fde68a' },
            ].map(({ value, label, color, bg, activeBg }) => {
              const active = paymentStatus === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setPaymentStatus(value)}
                  style={{
                    padding: '7px 16px',
                    border: 'none',
                    borderRight: value === 'paid' ? '1px solid #e2e8f0' : 'none',
                    background: active ? activeBg : bg,
                    color: active ? color : '#94a3b8',
                    fontWeight: active ? 700 : 400,
                    fontSize: '0.82rem',
                    cursor: 'pointer',
                    transition: 'all 0.1s',
                  }}
                >
                  {value === 'paid' ? '✓ ' : '○ '}{label}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Dates + extras ── */}
        <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ marginBottom: 4, paddingBottom: 12, borderBottom: '1px solid #f1f5f9' }}>
            <p style={{ margin: 0, fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.1em', color: '#94a3b8', textTransform: 'uppercase' }}>
              Dates du séjour &amp; Extras
            </p>
          </div>
          {/* ── Calendrier de sélection des dates ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.82rem', fontWeight: 600, color: '#475569' }}>Dates du séjour</span>
              {startYmd && endYmd ? (
                <span style={{ fontSize: '0.85rem', color: '#2563eb', fontWeight: 700 }}>
                  {new Date(startYmd + 'T12:00:00').toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' })}
                  {' → '}
                  {new Date(endYmd + 'T12:00:00').toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' })}
                  {nights > 0 && ` · ${nights} nuit${nights > 1 ? 's' : ''}`}
                </span>
              ) : (
                <span style={{ fontSize: '0.82rem', color: '#94a3b8' }}>
                  {startYmd ? 'Cliquez sur la date de départ…' : "Cliquez sur la date d'arrivée…"}
                </span>
              )}
              {(startYmd || endYmd) && (
                <button
                  type="button"
                  onClick={() => { setStartYmd(''); setEndYmd(''); }}
                  style={{ marginLeft: 4, fontSize: '0.75rem', color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px' }}
                >
                  ✕ effacer
                </button>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginLeft: 'auto' }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: '#fed7aa', display: 'inline-block', border: '1px solid #fb923c' }} />
                <span style={{ fontSize: '0.72rem', color: '#78716c' }}>Déjà réservé</span>
              </div>
            </div>

            <MiniBookingCalendar
              bookedDayStrings={bookedDayStrings}
              startYmd={startYmd}
              endYmd={endYmd}
              onRangeChange={(s, e) => { setStartYmd(s || ''); setEndYmd(e || ''); }}
            />

            {selectionOverlaps && !skipOverlap && (
              <div style={{ padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, fontSize: '0.82rem', color: '#b91c1c', fontWeight: 500 }}>
                Chevauchement détecté avec une réservation existante. Cochez « Ignorer les conflits » ci-dessous si intentionnel.
              </div>
            )}
          </div>

          {/* ── Équipements inclus avec le chalet ── */}
          {!loadingInventory && chaletIncludedUnits.length > 0 && (
            <div
              style={{
                padding: '10px 12px',
                background: '#f0fdf4',
                border: '1px solid #bbf7d0',
                borderRadius: 8,
              }}
            >
              <p style={{ margin: '0 0 6px', fontSize: '0.8rem', fontWeight: 600, color: '#15803d' }}>
                Équipements inclus avec ce chalet
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {chaletIncludedUnits.map((u) => (
                  <span
                    key={u.id}
                    style={{
                      padding: '3px 10px',
                      borderRadius: 20,
                      background: '#dcfce7',
                      color: '#166534',
                      fontSize: '0.78rem',
                      fontWeight: 500,
                    }}
                  >
                    {u.display_name}
                  </span>
                ))}
              </div>
              <p style={{ margin: '6px 0 0', fontSize: '0.75rem', color: '#4ade80' /* dark */ }}>
                Ces unités seront automatiquement allouées à la réservation.
              </p>
            </div>
          )}

          {/* ── Extras — réserve globale ── */}
          {!loadingInventory && poolKinds.length > 0 && (
            <div
              style={{
                padding: '10px 12px',
                background: '#fffbeb',
                border: '1px solid #fde68a',
                borderRadius: 8,
              }}
            >
              <p style={{ margin: '0 0 8px', fontSize: '0.8rem', fontWeight: 600, color: '#92400e' }}>
                Extras — réserve globale
                {checkingAvail && (
                  <span style={{ marginLeft: 8, fontWeight: 400, color: '#b45309', fontSize: '0.75rem' }}>
                    Vérification dispo…
                  </span>
                )}
              </p>
              {!datesReady && (
                <p style={{ margin: 0, fontSize: '0.78rem', color: '#78716c' }}>
                  Sélectionnez les dates pour voir la disponibilité.
                </p>
              )}
              {datesReady && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {poolKinds.map((kind) => {
                    const meta = kind.metadata || {};
                    const priceLabel = meta.addon_price_per_stay
                      ? `${fmtCAD(meta.addon_price_per_stay)} / séjour`
                      : meta.addon_price_per_night
                        ? `${fmtCAD(meta.addon_price_per_night)} / nuit`
                        : null;
                    const maxAvail = poolAvailability[kind.id] ?? 0;
                    const qty = selectedExtras[kind.id] || 0;

                    return (
                      <div
                        key={kind.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          flexWrap: 'wrap',
                          gap: 8,
                        }}
                      >
                        <div>
                          <span style={{ fontSize: '0.85rem', fontWeight: 500, color: '#1c1917' }}>
                            {kind.label}
                          </span>
                          {priceLabel && (
                            <span style={{ marginLeft: 8, fontSize: '0.78rem', color: '#78716c' }}>
                              {priceLabel}
                            </span>
                          )}
                          <span
                            style={{
                              marginLeft: 8,
                              fontSize: '0.75rem',
                              color: maxAvail > 0 ? '#15803d' : '#dc2626',
                              fontWeight: 500,
                            }}
                          >
                            {maxAvail > 0 ? `${maxAvail} dispo` : 'Épuisé'}
                          </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <button
                            type="button"
                            disabled={qty <= 0}
                            onClick={() =>
                              setSelectedExtras((prev) => ({
                                ...prev,
                                [kind.id]: Math.max(0, (prev[kind.id] || 0) - 1),
                              }))
                            }
                            style={{
                              width: 28,
                              height: 28,
                              borderRadius: 6,
                              border: '1px solid #d97706',
                              background: qty <= 0 ? '#f5f5f4' : '#fef3c7',
                              color: '#92400e',
                              fontWeight: 700,
                              cursor: qty <= 0 ? 'not-allowed' : 'pointer',
                              fontSize: '1rem',
                              lineHeight: 1,
                            }}
                          >
                            −
                          </button>
                          <span style={{ minWidth: 20, textAlign: 'center', fontWeight: 600, fontSize: '0.9rem' }}>
                            {qty}
                          </span>
                          <button
                            type="button"
                            disabled={qty >= maxAvail}
                            onClick={() =>
                              setSelectedExtras((prev) => ({
                                ...prev,
                                [kind.id]: Math.min(maxAvail, (prev[kind.id] || 0) + 1),
                              }))
                            }
                            style={{
                              width: 28,
                              height: 28,
                              borderRadius: 6,
                              border: '1px solid #d97706',
                              background: qty >= maxAvail ? '#f5f5f4' : '#fef3c7',
                              color: '#92400e',
                              fontWeight: 700,
                              cursor: qty >= maxAvail ? 'not-allowed' : 'pointer',
                              fontSize: '1rem',
                              lineHeight: 1,
                            }}
                          >
                            +
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── Récapitulatif du prix ── */}
          {datesReady && (selectedChalet?.price_per_night || Object.values(selectedExtras).some((q) => q > 0)) && (
            <div
              style={{
                padding: '10px 12px',
                background: '#f1f5f9',
                border: '1px solid #e2e8f0',
                borderRadius: 8,
                fontSize: '0.85rem',
                color: '#334155',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {selectedChalet?.price_per_night > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>
                      {selectedChalet.Name || selectedChalet.name} — {nights} nuit{nights > 1 ? 's' : ''} ×{' '}
                      {fmtCAD(selectedChalet.price_per_night)}
                    </span>
                    <span style={{ fontWeight: 600 }}>{fmtCAD(selectedChalet.price_per_night * nights)}</span>
                  </div>
                )}
                {Object.entries(selectedExtras).map(([kindId, qty]) => {
                  if (!qty) return null;
                  const kind = equipmentKinds.find((k) => k.id === kindId);
                  if (!kind) return null;
                  const meta = kind.metadata || {};
                  const linePrice = meta.addon_price_per_stay
                    ? meta.addon_price_per_stay * qty
                    : meta.addon_price_per_night
                      ? meta.addon_price_per_night * nights * qty
                      : 0;
                  if (!linePrice) return null;
                  return (
                    <div key={kindId} style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>
                        {kind.label} × {qty}
                      </span>
                      <span>{fmtCAD(linePrice)}</span>
                    </div>
                  );
                })}
                {totalPrice > 0 && (
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontWeight: 700,
                      fontSize: '0.9rem',
                      borderTop: '1px solid #cbd5e1',
                      paddingTop: 6,
                      marginTop: 2,
                    }}
                  >
                    <span>Total</span>
                    <span>{fmtCAD(totalPrice)}</span>
                  </div>
                )}
              </div>
            </div>
          )}

        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', cursor: 'pointer' }}>
          <input type="checkbox" checked={skipOverlap} onChange={(e) => setSkipOverlap(e.target.checked)} />
          Ignorer la vérification de disponibilité (import / chevauchement assumé)
        </label>
        <button
          type="submit"
          disabled={saving || chalets.length === 0}
          style={{
            alignSelf: 'flex-start',
            padding: '10px 18px',
            borderRadius: 8,
            border: 'none',
            background: '#059669',
            color: 'white',
            fontWeight: 600,
            cursor: saving ? 'not-allowed' : 'pointer',
          }}
        >
          {saving ? '…' : 'Créer la réservation'}
        </button>
      </form>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 14, alignItems: 'center' }}>
        <button
          type="button"
          onClick={() => setImportOpen((v) => !v)}
          style={{
            padding: '8px 14px',
            borderRadius: 8,
            border: '1px solid #6366f1',
            background: importOpen ? '#e0e7ff' : 'white',
            color: '#4338ca',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {importOpen ? 'Fermer import CSV' : 'Importer un fichier CSV'}
        </button>
      </div>

      {importOpen && (
        <div
          style={{
            marginBottom: 20,
            padding: 16,
            borderRadius: 10,
            border: '1px dashed #a5b4fc',
            background: '#f5f3ff',
          }}
        >
          <p style={{ fontSize: '0.85rem', color: '#4338ca', margin: '0 0 12px' }}>
            Colonne chalet : utilisez le <strong>même nom</strong> que dans l'onglet Chalets (ou l'identifiant UUID du chalet).
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            <button
              type="button"
              onClick={downloadTemplate}
              style={{
                padding: '6px 12px',
                borderRadius: 6,
                border: '1px solid #6366f1',
                background: 'white',
                cursor: 'pointer',
              }}
            >
              Télécharger le modèle CSV
            </button>
            <label
              style={{
                padding: '6px 12px',
                borderRadius: 6,
                background: '#4f46e5',
                color: 'white',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Choisir un fichier…
              <input type="file" accept=".csv,.txt" style={{ display: 'none' }} onChange={handleFile} />
            </label>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.82rem', marginBottom: 10 }}>
            <input
              type="checkbox"
              checked={syncGoogleOnImport}
              onChange={(e) => setSyncGoogleOnImport(e.target.checked)}
            />
            Après import, créer aussi les événements Google Agenda (plus lent, centaines de lignes déconseillé)
          </label>

          {csvRows.length > 0 && (
            <>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', marginBottom: 10 }}>
                <input
                  type="checkbox"
                  checked={headerRowIsLabels}
                  onChange={(e) => setHeaderRowIsLabels(e.target.checked)}
                />
                Première ligne = titres des colonnes
              </label>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                  gap: 10,
                  marginBottom: 12,
                }}
              >
                {[
                  ['Chalet', mapChalet, setMapChalet],
                  ['Date arrivée', mapStart, setMapStart],
                  ['Date départ', mapEnd, setMapEnd],
                  ['Nom client', mapName, setMapName],
                  ['Courriel', mapEmail, setMapEmail],
                  ['Notes', mapNotes, setMapNotes],
                ].map(([label, val, setVal]) => (
                  <label
                    key={label}
                    style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.78rem', color: '#475569' }}
                  >
                    {label}
                    <select
                      value={val}
                      onChange={(e) => setVal(e.target.value)}
                      style={{ padding: 6, borderRadius: 6, border: '1px solid #cbd5e1' }}
                    >
                      <option value="">—</option>
                      {colOptions.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              {/* ── Étape de mapping Manisoft → Monde Sauvage ── */}
              {uniqueCsvChaletNames.length > 0 && (
                <div
                  style={{
                    marginBottom: 14,
                    padding: '12px 14px',
                    borderRadius: 8,
                    border: allChaletsMapped ? '1px solid #86efac' : '1px solid #fca5a5',
                    background: allChaletsMapped ? '#f0fdf4' : '#fff1f2',
                  }}
                >
                  <p
                    style={{
                      margin: '0 0 10px',
                      fontSize: '0.85rem',
                      fontWeight: 700,
                      color: allChaletsMapped ? '#15803d' : '#b91c1c',
                    }}
                  >
                    Correspondance des chalets — {uniqueCsvChaletNames.length} nom(s) trouvé(s) dans le fichier
                  </p>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                    <thead>
                      <tr style={{ background: '#eff6ff' }}>
                        <th
                          style={{
                            padding: '6px 10px',
                            textAlign: 'left',
                            fontWeight: 600,
                            color: '#1e40af',
                            border: '1px solid #bfdbfe',
                            width: '45%',
                          }}
                        >
                          Dans le fichier CSV
                        </th>
                        <th
                          style={{
                            padding: '6px 10px',
                            textAlign: 'left',
                            fontWeight: 600,
                            color: '#1e40af',
                            border: '1px solid #bfdbfe',
                          }}
                        >
                          Chalet dans Monde Sauvage
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {uniqueCsvChaletNames.map((csvName) => {
                        const isMapped = !!chaletMapping[csvName];
                        return (
                          <tr key={csvName} style={{ background: isMapped ? 'transparent' : '#fff5f5' }}>
                            <td
                              style={{
                                padding: '6px 10px',
                                border: '1px solid #bfdbfe',
                                fontFamily: 'monospace',
                                fontSize: '0.78rem',
                                color: '#1e293b',
                              }}
                            >
                              {csvName}
                            </td>
                            <td style={{ padding: '4px 8px', border: '1px solid #bfdbfe' }}>
                              <select
                                value={chaletMapping[csvName] || ''}
                                onChange={(e) =>
                                  setChaletMapping((prev) => ({ ...prev, [csvName]: e.target.value }))
                                }
                                style={{
                                  width: '100%',
                                  padding: '4px 8px',
                                  borderRadius: 6,
                                  border: isMapped ? '1px solid #86efac' : '2px solid #fca5a5',
                                  background: isMapped ? '#f0fdf4' : '#fff1f2',
                                  fontSize: '0.8rem',
                                }}
                              >
                                <option value="">— Sélectionner un chalet —</option>
                                {chalets.map((c) => (
                                  <option key={c.key ?? c.id} value={String(c.key ?? c.id)}>
                                    {c.Name || c.name || 'Chalet'}
                                  </option>
                                ))}
                              </select>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {!allChaletsMapped && (
                    <p style={{ margin: '8px 0 0', fontSize: '0.78rem', color: '#b91c1c', fontWeight: 500 }}>
                      Assignez tous les chalets ci-dessus avant de pouvoir importer.
                    </p>
                  )}
                </div>
              )}

              <p style={{ fontSize: '0.78rem', color: '#64748b' }}>Aperçu ({dataRows.length} lignes)</p>
              <div style={{ overflowX: 'auto', border: '1px solid #e9d5ff', borderRadius: 8, marginBottom: 10 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
                  <tbody>
                    {previewRows.map((row, ri) => (
                      <tr key={ri}>
                        {row.map((cell, ci) => (
                          <td key={ci} style={{ borderBottom: '1px solid #f3e8ff', padding: '4px 6px' }}>
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                type="button"
                disabled={importing || dataRows.length === 0 || !allChaletsMapped}
                onClick={handleImport}
                style={{
                  padding: '8px 16px',
                  borderRadius: 8,
                  border: 'none',
                  background: !allChaletsMapped ? '#a5b4fc' : '#4f46e5',
                  color: 'white',
                  fontWeight: 600,
                  cursor: importing || !allChaletsMapped ? 'not-allowed' : 'pointer',
                }}
              >
                {importing ? 'Import…' : 'Importer'}
              </button>
              {importErrors.length > 0 && (
                <div style={{ marginTop: 12, fontSize: '0.8rem', color: '#9a3412' }}>
                  <strong>Lignes en erreur :</strong>
                  <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                    {importErrors.slice(0, 20).map((er) => (
                      <li key={`${er.row}-${er.message}`}>
                        Ligne {er.row}: {er.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      )}

      <h3 style={{ fontSize: '1rem', margin: '16px 0 10px' }}>Réservations saisies pour ce lieu</h3>
      {loading ? (
        <p style={{ color: '#64748b' }}>Chargement…</p>
      ) : bookings.length === 0 ? (
        <p style={{ color: '#64748b', fontSize: '0.9rem' }}>Aucune réservation « pourvoyeur » pour l'instant.</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {bookings.map((b) => {
            const ch = chaletByKey.get(String(b.chalet_id));
            const chName = ch?.Name || ch?.name || 'Chalet';
            const start = b.start_date ? new Date(b.start_date).toLocaleDateString('fr-CA') : '';
            const end = b.end_date ? new Date(b.end_date).toLocaleDateString('fr-CA') : '';
            const unpaid = b.payment_status && b.payment_status !== 'paid';
            return (
              <li
                key={b.id}
                style={{
                  padding: '10px 12px',
                  border: unpaid ? '1px solid #fde68a' : '1px solid #e5e7eb',
                  borderRadius: 8,
                  background: unpaid ? '#fffbeb' : 'white',
                  display: 'flex',
                  flexWrap: 'wrap',
                  justifyContent: 'space-between',
                  gap: 8,
                  alignItems: 'center',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                    {chName} — {b.customer_name || 'Client'}
                    {unpaid && (
                      <span style={{ fontSize: '0.72rem', fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: '#fde68a', color: '#92400e' }}>
                        À percevoir
                      </span>
                    )}
                    {!unpaid && b.status !== 'cancelled' && (
                      <span style={{ fontSize: '0.72rem', fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: '#dcfce7', color: '#15803d' }}>
                        Payé
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '0.82rem', color: '#64748b' }}>
                    {start} → {end}
                    {b.nights ? ` · ${b.nights} nuit${b.nights > 1 ? 's' : ''}` : ''}
                    {b.total_price ? ` · ${fmtCAD(b.total_price)}` : ''}
                    {b.customer_email ? ` · ${b.customer_email}` : ''}
                    {b.status === 'cancelled' ? ' · annulée' : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {unpaid && b.status !== 'cancelled' && (
                    <button
                      type="button"
                      onClick={async () => {
                        const { error } = await supabase.from('bookings').update({ payment_status: 'paid' }).eq('id', b.id);
                        if (error) { toast.error(error.message); return; }
                        toast.success('Paiement enregistré.');
                        load();
                      }}
                      style={{ fontSize: '0.8rem', padding: '4px 10px', borderRadius: 6, border: '1px solid #86efac', background: '#f0fdf4', color: '#15803d', cursor: 'pointer', fontWeight: 600 }}
                    >
                      ✓ Marquer payé
                    </button>
                  )}
                  {b.status !== 'cancelled' && (
                    <button
                      type="button"
                      onClick={() => handleCancelBooking(b.id)}
                      style={{ fontSize: '0.8rem', padding: '4px 10px', borderRadius: 6, border: '1px solid #fecaca', background: '#fef2f2', color: '#b91c1c', cursor: 'pointer' }}
                    >
                      Annuler
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
