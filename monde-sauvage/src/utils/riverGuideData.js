// Central river data — single source of truth for:
// - sidebar river list (rendered through getKnownRiverPathIds)
// - map↔river anchoring (RIVER_CENTERS_BY_PATH_ID + getRiverCenter)
// - bio cards on the homepage (getRiversCatalog)
// - guide↔river association (getRiverGuideByPathId)
//
// Each river is described once, with all the SVG path IDs that draw it on
// the traced Gaspesie map. Adding a new traced path? Append it to the
// `pathIds` of the river it represents — never duplicate the river entry.

const FISH_TYPES = {
  SALMON: 'saumon-atlantique',
  TROUT: 'truite-mouchetee',
  CHAR: 'omble-de-fontaine',
};

const REGIONS = {
  BAIE_DES_CHALEURS: { fr: 'Baie-des-Chaleurs', en: 'Chaleur Bay' },
  HAUTE_GASPESIE: { fr: 'Haute-Gaspésie', en: 'Upper Gaspesie' },
  POINTE_GASPE: { fr: 'Pointe / Gaspé', en: 'Gaspe Peninsula tip' },
  CHANDLER_PABOS: { fr: 'Chandler / Pabos', en: 'Chandler / Pabos' },
  VALLEE_MATAPEDIA: { fr: 'Vallée de la Matapédia', en: 'Matapedia Valley' },
};

// Single source of truth. Add a river here, and it appears everywhere.
export const RIVERS = [
  {
    id: 1,
    slug: 'matapedia',
    name: { fr: 'Matapédia', en: 'Matapedia' },
    pathIds: ['Matapedia', 'river-11'],
    center: { lng: -67.0759, lat: 48.4326 },
    region: REGIONS.VALLEE_MATAPEDIA,
    fishTypes: [FISH_TYPES.SALMON],
    difficulty: 'intermediate',
    highlights: [
      { icon: '🐟', label: { fr: 'Saumon Atlantique', en: 'Atlantic salmon' } },
      { icon: '🏞️', label: { fr: 'Vallée spectaculaire', en: 'Stunning valley' } },
      { icon: '🛖', label: { fr: 'Pourvoiries historiques', en: 'Historic outfitters' } },
    ],
    shortDescription: {
      fr: 'Rivière mythique du sud-ouest, réputée pour ses gros saumons.',
      en: 'Iconic southwestern river, famed for its large salmon.',
    },
    description: 'Iconic gateway river of Gaspesie, known for Atlantic salmon and dramatic valley scenery.',
    image: 'https://commons.wikimedia.org/wiki/Special:FilePath/PecheurSaumonRiviereMatapedia.JPG',
  },
  {
    id: 2,
    slug: 'cascapedia',
    name: { fr: 'Cascapédia', en: 'Cascapedia' },
    // Kept as informational legacy entry; dropdown/map now uses Petite Cascapedia as canonical.
    pathIds: [],
    center: { lng: -65.8012, lat: 48.6006 },
    region: REGIONS.BAIE_DES_CHALEURS,
    fishTypes: [FISH_TYPES.SALMON],
    difficulty: 'advanced',
    highlights: [
      { icon: '💎', label: { fr: 'Eau cristalline', en: 'Crystal-clear water' } },
      { icon: '🐟', label: { fr: 'Saumon de classe mondiale', en: 'World-class salmon' } },
      { icon: '🎣', label: { fr: 'Pêche à la mouche traditionnelle', en: 'Traditional fly fishing' } },
    ],
    shortDescription: {
      fr: 'Rivière légendaire à saumon, réputation mondiale pour la pêche à la mouche.',
      en: 'Legendary salmon river with a world-class fly-fishing reputation.',
    },
    description: 'Legendary salmon river with clear water and a long fly-fishing reputation.',
    image: 'https://commons.wikimedia.org/wiki/Special:FilePath/Rivi%C3%A8re_Cascap%C3%A9dia.jpg',
  },
  {
    id: 3,
    slug: 'petite-cascapedia',
    name: { fr: 'Petite Cascapédia', en: 'Petite Cascapedia' },
    // Canonical Cascapedia family path IDs (dedupe in dropdown via first canonical id).
    pathIds: ['river-4', 'river-3'],
    center: { lng: -65.9007, lat: 48.4693 },
    region: REGIONS.BAIE_DES_CHALEURS,
    fishTypes: [FISH_TYPES.SALMON, FISH_TYPES.TROUT],
    difficulty: 'intermediate',
    highlights: [
      { icon: '🌲', label: { fr: 'Forêt sauvage', en: 'Wild forest' } },
      { icon: '🐟', label: { fr: 'Saumon et truite', en: 'Salmon and trout' } },
      { icon: '🤫', label: { fr: 'Coin tranquille', en: 'Quiet spot' } },
    ],
    shortDescription: {
      fr: 'Plus petite mais très réputée, idéale pour une expérience plus intime.',
      en: 'Smaller but well-known, ideal for a more intimate experience.',
    },
    description: 'A smaller but well-known salmon river valued for its quieter, wild watershed.',
    image: '',
  },
  {
    id: 4,
    slug: 'bonaventure',
    name: { fr: 'Bonaventure', en: 'Bonaventure' },
    pathIds: ['Bonaventure', 'river-2'],
    center: { lng: -65.6289, lat: 48.4211 },
    region: REGIONS.BAIE_DES_CHALEURS,
    fishTypes: [FISH_TYPES.SALMON],
    difficulty: 'beginner',
    highlights: [
      { icon: '💎', label: { fr: 'Eau exceptionnellement claire', en: 'Exceptionally clear water' } },
      { icon: '🛶', label: { fr: 'Pêche en canoë possible', en: 'Canoe fishing possible' } },
      { icon: '👶', label: { fr: 'Accessible débutants', en: 'Beginner-friendly' } },
    ],
    shortDescription: {
      fr: 'Eau cristalline et saumons abondants — un classique pour débuter ou se perfectionner.',
      en: 'Crystal water and plentiful salmon — a classic for beginners and pros alike.',
    },
    description: "One of Gaspesie's most celebrated rivers, admired for exceptionally clear, cold water.",
    image: 'https://commons.wikimedia.org/wiki/Special:FilePath/Rivi%C3%A8re_Bonaventure_02.JPG',
  },
  {
    id: 5,
    slug: 'nouvelle',
    name: { fr: 'Nouvelle', en: 'Nouvelle' },
    pathIds: ['river-7'],
    center: { lng: -66.5, lat: 48.15 }, // approx — south-shore towards Chaleur Bay
    region: REGIONS.BAIE_DES_CHALEURS,
    fishTypes: [FISH_TYPES.SALMON],
    difficulty: 'intermediate',
    highlights: [
      { icon: '🌊', label: { fr: 'Vers la baie des Chaleurs', en: 'Flows to Chaleur Bay' } },
      { icon: '🐟', label: { fr: 'Saumon Atlantique', en: 'Atlantic salmon' } },
    ],
    shortDescription: {
      fr: 'Rivière du versant sud, ambiance authentique.',
      en: 'South-shore river with an authentic feel.',
    },
    description: 'South-shore river flowing toward Chaleur Bay in western Gaspesie.',
    image: '',
  },
  {
    id: 6,
    slug: 'madeleine',
    name: { fr: 'Madeleine', en: 'Madeleine' },
    pathIds: ['river-15'],
    center: { lng: -65.6098, lat: 49.0408 },
    region: REGIONS.HAUTE_GASPESIE,
    fishTypes: [FISH_TYPES.SALMON],
    difficulty: 'advanced',
    highlights: [
      { icon: '🏔️', label: { fr: 'Terrain accidenté', en: 'Rugged terrain' } },
      { icon: '💎', label: { fr: 'Eau claire et froide', en: 'Cold, clear water' } },
    ],
    shortDescription: {
      fr: 'Grande rivière de la côte nord, réputée pour son saumon.',
      en: 'Major north-coast river, known for its salmon.',
    },
    description: 'Major north-coast salmon river known for rugged terrain and clear water.',
    image: '',
  },
  {
    id: 7,
    slug: 'mont-louis',
    name: { fr: 'Mont-Louis', en: 'Mont-Louis' },
    pathIds: ['Cap-Chat'],
    center: { lng: -66.1629, lat: 48.4983 },
    region: REGIONS.HAUTE_GASPESIE,
    fishTypes: [FISH_TYPES.SALMON],
    difficulty: 'intermediate',
    highlights: [
      { icon: '⛰️', label: { fr: 'Chic-Chocs', en: 'Chic-Choc highlands' } },
      { icon: '🏞️', label: { fr: 'Paysages compacts', en: 'Compact scenery' } },
    ],
    shortDescription: {
      fr: 'Rivière côtière de la Haute-Gaspésie.',
      en: 'Coastal Upper-Gaspesie river.',
    },
    description: 'Compact but scenic north-coast river descending from the Chic-Choc highlands.',
    image: '',
  },
  {
    id: 9,
    slug: 'dartmouth',
    name: { fr: 'Dartmouth', en: 'Dartmouth' },
    pathIds: ['Saint-Jean'],
    center: { lng: -64.8978, lat: 48.7242 },
    region: REGIONS.POINTE_GASPE,
    fishTypes: [FISH_TYPES.SALMON],
    difficulty: 'advanced',
    highlights: [
      { icon: '🏞️', label: { fr: 'Caractère sauvage', en: 'Wild character' } },
      { icon: '⛰️', label: { fr: 'Décor montagneux', en: 'Mountain backdrop' } },
    ],
    shortDescription: {
      fr: 'Rivière du nord-est largement sauvage, paysages mémorables.',
      en: 'A largely wild northeastern river with memorable mountain scenery.',
    },
    description: 'A largely wild northeastern river with memorable mountain scenery.',
    image: '',
  },
  {
    id: 10,
    slug: 'york',
    name: { fr: 'York', en: 'York' },
    pathIds: ['river-16'],
    center: { lng: -64.8442, lat: 48.4655 },
    region: REGIONS.POINTE_GASPE,
    fishTypes: [FISH_TYPES.SALMON],
    difficulty: 'intermediate',
    highlights: [
      { icon: '💚', label: { fr: 'Eau aux teintes émeraude', en: 'Emerald-toned water' } },
      { icon: '🐟', label: { fr: 'Saumon de Gaspé', en: 'Gaspe salmon' } },
    ],
    shortDescription: {
      fr: 'Rivière phare près de Gaspé, eau aux reflets émeraude.',
      en: 'Flagship river near Gaspe with emerald-toned water.',
    },
    description: 'Flagship salmon river near Gaspe, known for emerald-toned water.',
    image: 'https://commons.wikimedia.org/wiki/Special:FilePath/York-gaspe-atlanticsalmon.jpg',
  },
  {
    id: 11,
    slug: 'saint-jean',
    name: { fr: 'Saint-Jean', en: 'Saint-Jean' },
    pathIds: ['Dartmouth'],
    center: { lng: -65.0184, lat: 48.45 },
    region: REGIONS.POINTE_GASPE,
    fishTypes: [FISH_TYPES.SALMON],
    difficulty: 'intermediate',
    highlights: [
      { icon: '🎣', label: { fr: 'Patrimoine sportif fort', en: 'Strong sporting heritage' } },
      { icon: '🐟', label: { fr: 'Saumon de l\'est', en: 'Eastern salmon' } },
    ],
    shortDescription: {
      fr: 'La référence de la pêche au saumon en Gaspésie de l\'est.',
      en: "Eastern Gaspesie's reference salmon river.",
    },
    description: 'Best-known eastern Gaspesie salmon river with strong sporting heritage.',
    image: '',
  },
  {
    id: 12,
    slug: 'malbaie',
    name: { fr: 'Malbaie', en: 'Malbaie' },
    pathIds: [],
    center: null,
    region: REGIONS.POINTE_GASPE,
    fishTypes: [FISH_TYPES.SALMON],
    difficulty: 'intermediate',
    highlights: [
      { icon: '🌅', label: { fr: 'Côte est', en: 'Eastern shore' } },
    ],
    shortDescription: {
      fr: 'Petite rivière de l\'est, vers la baie de la Malbaie.',
      en: 'Smaller eastern river, flowing to Malbaie Bay.',
    },
    description: 'Smaller eastern Gaspesie river flowing toward La Malbaie Bay.',
    image: '',
  },
  {
    id: 13,
    slug: 'grande-riviere',
    name: { fr: 'Grande Rivière', en: 'Grande Riviere' },
    pathIds: ['r', 'river', 'river-21'],
    center: { lng: -64.6662, lat: 48.4906 },
    region: REGIONS.CHANDLER_PABOS,
    fishTypes: [FISH_TYPES.SALMON],
    difficulty: 'intermediate',
    highlights: [
      { icon: '🌊', label: { fr: 'Vers la baie des Chaleurs', en: 'Flows to Chaleur Bay' } },
      { icon: '🐟', label: { fr: 'Saumon Atlantique', en: 'Atlantic salmon' } },
    ],
    shortDescription: {
      fr: 'Grande rivière du sud, prisée des pêcheurs.',
      en: 'Prominent south-shore river loved by anglers.',
    },
    description: 'Prominent south-shore river running to Chaleur Bay.',
    image: '',
  },
  {
    id: 14,
    slug: 'petit-pabos',
    name: { fr: 'Petit Pabos', en: 'Petit Pabos' },
    pathIds: ['York'],
    center: null,
    region: REGIONS.CHANDLER_PABOS,
    fishTypes: [FISH_TYPES.SALMON],
    difficulty: 'intermediate',
    highlights: [
      { icon: '🐟', label: { fr: 'Trio des Pabos', en: 'Pabos trio' } },
    ],
    shortDescription: {
      fr: 'Plus petit des Pabos, près de Chandler.',
      en: 'Smallest of the Pabos rivers, near Chandler.',
    },
    description: 'One of the three famous Pabos salmon rivers near Chandler.',
    image: 'https://commons.wikimedia.org/wiki/Special:FilePath/Small_pabos_river_salmons.jpg',
  },
  {
    id: 15,
    slug: 'grand-pabos',
    name: { fr: 'Grand Pabos', en: 'Grand Pabos' },
    pathIds: ['river-17'],
    center: { lng: -65.0165, lat: 48.842 },
    region: REGIONS.CHANDLER_PABOS,
    fishTypes: [FISH_TYPES.SALMON],
    difficulty: 'intermediate',
    highlights: [
      { icon: '🐟', label: { fr: 'Saumon Atlantique', en: 'Atlantic salmon' } },
      { icon: '⚓', label: { fr: 'Près de Chandler', en: 'Near Chandler' } },
    ],
    shortDescription: {
      fr: 'Pilier du trio des Pabos.',
      en: 'Anchor of the Pabos trio.',
    },
    description: 'Major river in the Pabos trio, long associated with Atlantic salmon.',
    image: 'https://commons.wikimedia.org/wiki/Special:FilePath/Riviere_Grand_Pabos.jpg',
  },
  {
    id: 16,
    slug: 'grand-pabos-ouest',
    name: { fr: 'Grand Pabos Ouest', en: 'Grand Pabos Ouest' },
    pathIds: ['river-18'],
    center: { lng: -64.9016, lat: 48.9559 },
    region: REGIONS.CHANDLER_PABOS,
    fishTypes: [FISH_TYPES.SALMON],
    difficulty: 'intermediate',
    highlights: [
      { icon: '🌲', label: { fr: 'Branche ouest des Pabos', en: 'Western Pabos branch' } },
    ],
    shortDescription: {
      fr: 'Complète le trio des Pabos.',
      en: 'Completes the Pabos trio.',
    },
    description: 'Completes the Pabos trio in the Chandler area.',
    image: '',
  },
  {
    id: 17,
    slug: 'sainte-anne',
    name: { fr: 'Sainte-Anne', en: 'Sainte-Anne' },
    pathIds: ['Sainte-Anne', 'Madeleine'],
    center: { lng: -66.7524, lat: 48.9211 },
    region: REGIONS.HAUTE_GASPESIE,
    fishTypes: [FISH_TYPES.SALMON, FISH_TYPES.TROUT],
    difficulty: 'intermediate',
    highlights: [
      { icon: '⛰️', label: { fr: 'Des Chic-Chocs à la mer', en: 'Chic-Chocs to sea' } },
      { icon: '🐟', label: { fr: 'Saumon et truite', en: 'Salmon and trout' } },
    ],
    shortDescription: {
      fr: 'Rivière signature de la Haute-Gaspésie.',
      en: 'Signature Upper-Gaspesie river.',
    },
    description: 'Signature Haute-Gaspesie river linking mountain headwaters to the coast.',
    image: '',
  },
];

// ─── Derived indexes ──────────────────────────────────────────────────────
// All legacy exports below are computed from RIVERS so adding a river in
// ONE place flows through to the entire app.

export const RIVERS_BY_SLUG = Object.fromEntries(RIVERS.map((r) => [r.slug, r]));

// Legacy: { id → { id, name, slug, image, description, ... } } — kept so
// riverPaths.js and any older code keeps working.
export const RIVER_GUIDE = RIVERS.map((r) => ({
  id: r.id,
  slug: r.slug,
  name: r.name.en, // legacy callers expected a string
  description: r.description,
  image: r.image,
  confidence: 'high',
}));

export const RIVER_GUIDE_BY_ID = Object.fromEntries(RIVER_GUIDE.map((r) => [r.id, r]));

// Legacy: pathId → river.id
export const RIVER_PATH_TO_GUIDE_ID = (() => {
  const out = {};
  for (const r of RIVERS) {
    for (const pathId of r.pathIds) out[pathId] = r.id;
  }
  return out;
})();

// Legacy: pathId → {lng, lat}. Every traced path now resolves to its
// river's center, so MapApp anchoring never silently fails.
export const RIVER_CENTERS_BY_PATH_ID = (() => {
  const out = {};
  for (const r of RIVERS) {
    if (!r.center) continue;
    for (const pathId of r.pathIds) out[pathId] = r.center;
  }
  return out;
})();

const PATH_ID_TO_RIVER = (() => {
  const out = {};
  for (const r of RIVERS) {
    for (const pathId of r.pathIds) out[pathId] = r;
  }
  return out;
})();

// Legacy: surface a canonical id (the FIRST pathId of the owning river).
// This lets de-dup callers collapse all aliases of a river to one key.
export const RIVER_PATH_CANONICAL_ID = (() => {
  const out = {};
  for (const r of RIVERS) {
    const canonical = r.pathIds[0];
    if (!canonical) continue;
    for (const pathId of r.pathIds) {
      if (pathId !== canonical) out[pathId] = canonical;
    }
  }
  return out;
})();

export function normalizeRiverPathId(pathId) {
  if (!pathId) return pathId;
  return RIVER_PATH_CANONICAL_ID[pathId] || pathId;
}

// One entry per LOGICAL river (deduplicated by slug). Returns the
// canonical pathId used as a stable key in the rest of the app.
export function getKnownRiverPathIds() {
  const out = [];
  for (const r of RIVERS) {
    if (r.pathIds.length > 0) out.push(r.pathIds[0]);
  }
  return out;
}

export function getRiverGuideByPathId(pathId) {
  if (!pathId) return null;
  const direct = PATH_ID_TO_RIVER[pathId];
  if (direct) {
    return {
      id: direct.id,
      slug: direct.slug,
      name: direct.name.en,
      description: direct.description,
      image: direct.image,
      confidence: 'high',
    };
  }
  const canonical = normalizeRiverPathId(pathId);
  if (canonical !== pathId) return getRiverGuideByPathId(canonical);
  return null;
}

export function getRiverBySlug(slug) {
  return RIVERS_BY_SLUG[slug] || null;
}

export function getRiverByPathId(pathId) {
  if (!pathId) return null;
  return PATH_ID_TO_RIVER[pathId]
    || PATH_ID_TO_RIVER[normalizeRiverPathId(pathId)]
    || null;
}

// Centralised center lookup — falls back to the river's center if the
// specific path was not given a coord directly.
export function getRiverCenter(pathId) {
  const r = getRiverByPathId(pathId);
  return r?.center || null;
}

export function formatRiverDisplayName(pathId, language = 'fr') {
  if (!pathId) return '';
  const river = getRiverByPathId(pathId);
  if (river) {
    const name = language === 'en' ? river.name.en : river.name.fr;
    return language === 'en' ? `${name} River` : `Rivière ${name}`;
  }
  // Fallback for unmapped paths (defensive, should not happen)
  if (typeof pathId === 'string' && pathId.startsWith('river-')) {
    const m = pathId.match(/^river-(\d+)$/i);
    const n = m ? m[1] : '';
    return language === 'en' ? `River ${n}`.trim() : `Rivière ${n}`.trim();
  }
  return language === 'en' ? `${pathId} River` : `Rivière ${pathId}`;
}

// Localized region name helper for cards / filters.
export function getRegionLabel(region, language = 'fr') {
  if (!region) return '';
  return language === 'en' ? region.en : region.fr;
}

// Catalog used by homepage bio cards / filters.
export function getRiversCatalog(language = 'fr') {
  return RIVERS
    .filter((r) => r.pathIds.length > 0) // only show rivers we can actually anchor on the map
    .map((r) => ({
      id: r.id,
      slug: r.slug,
      pathId: r.pathIds[0],
      displayName: language === 'en' ? `${r.name.en} River` : `Rivière ${r.name.fr}`,
      shortName: language === 'en' ? r.name.en : r.name.fr,
      region: getRegionLabel(r.region, language),
      fishTypes: r.fishTypes,
      difficulty: r.difficulty,
      highlights: r.highlights.map((h) => ({
        icon: h.icon,
        label: language === 'en' ? h.label.en : h.label.fr,
      })),
      shortDescription: language === 'en' ? r.shortDescription.en : r.shortDescription.fr,
      description: r.description,
      image: r.image,
      center: r.center,
    }));
}

// ─── Boot-time validation (dev only) ──────────────────────────────────────
if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV) {
  const seenPathIds = new Set();
  for (const r of RIVERS) {
    for (const pathId of r.pathIds) {
      if (seenPathIds.has(pathId)) {
        console.warn(`[rivers] duplicate pathId "${pathId}" — appears on multiple rivers`);
      }
      seenPathIds.add(pathId);
    }
    if (r.pathIds.length > 0 && !r.center) {
      console.warn(`[rivers] ${r.slug} has paths but no center — selection will fail to anchor`);
    }
  }
}
