// Central river guide data (source of truth: public/gaspesie_river_modal_guide.txt)

export const RIVER_GUIDE = [
  {
    id: 1,
    slug: 'matapedia',
    name: 'Matapedia',
    mapHint: 'far left / southwest edge of the peninsula',
    description: 'Iconic gateway river of Gaspesie, known for Atlantic salmon and dramatic valley scenery.',
    image: 'https://commons.wikimedia.org/wiki/Special:FilePath/PecheurSaumonRiviereMatapedia.JPG',
    confidence: 'high',
  },
  {
    id: 2,
    slug: 'cascapedia',
    name: 'Cascapedia',
    mapHint: 'upper-left of center, left of Bonaventure',
    description: 'Legendary salmon river with clear water and a long fly-fishing reputation.',
    image: 'https://commons.wikimedia.org/wiki/Special:FilePath/Rivi%C3%A8re_Cascap%C3%A9dia.jpg',
    confidence: 'high',
  },
  {
    id: 3,
    slug: 'petite-cascapedia',
    name: 'Petite Cascapedia',
    mapHint: 'south side, west of Bonaventure and east of Matapedia',
    description: 'A smaller but well-known salmon river valued for its quieter, wild watershed.',
    image: '',
    confidence: 'medium',
  },
  {
    id: 4,
    slug: 'bonaventure',
    name: 'Bonaventure',
    mapHint: 'upper-middle broad river through the center',
    description: 'One of Gaspesie\'s most celebrated rivers, admired for exceptionally clear, cold water.',
    image: 'https://commons.wikimedia.org/wiki/Special:FilePath/Rivi%C3%A8re_Bonaventure_02.JPG',
    confidence: 'high',
  },
  {
    id: 5,
    slug: 'nouvelle',
    name: 'Nouvelle',
    mapHint: 'upper-middle-right, near skier label area',
    description: 'South-shore river flowing toward Chaleur Bay in western Gaspesie.',
    image: '',
    confidence: 'high',
  },
  {
    id: 6,
    slug: 'madeleine',
    name: 'Madeleine',
    mapHint: 'north coast east of Sainte-Anne-des-Monts',
    description: 'Major north-coast salmon river known for rugged terrain and clear water.',
    image: '',
    confidence: 'medium',
  },
  {
    id: 7,
    slug: 'mont-louis',
    name: 'Mont-Louis',
    mapHint: 'north coast between Madeleine and Cap-Chat',
    description: 'Compact but scenic north-coast river descending from the Chic-Choc highlands.',
    image: '',
    confidence: 'medium',
  },
  {
    id: 8,
    slug: 'cap-chat',
    name: 'Cap-Chat',
    mapHint: 'north shore near Cap-Chat / Sainte-Anne-des-Monts',
    description: 'North-shore salmon river known for cold, clear water and strong accessibility.',
    image: '',
    confidence: 'medium',
  },
  {
    id: 9,
    slug: 'dartmouth',
    name: 'Dartmouth',
    mapHint: 'upper-right coast near the tip-side coastline',
    description: 'A largely wild northeastern river with memorable mountain scenery.',
    image: '',
    confidence: 'high',
  },
  {
    id: 10,
    slug: 'york',
    name: 'York',
    mapHint: 'right-center, above Saint-Jean',
    description: 'Flagship salmon river near Gaspe, known for emerald-toned water.',
    image: 'https://commons.wikimedia.org/wiki/Special:FilePath/York-gaspe-atlanticsalmon.jpg',
    confidence: 'high',
  },
  {
    id: 11,
    slug: 'saint-jean',
    name: 'Saint-Jean',
    mapHint: 'right-center, large horizontal river below York',
    description: 'Best-known eastern Gaspesie salmon river with strong sporting heritage.',
    image: '',
    confidence: 'high',
  },
  {
    id: 12,
    slug: 'malbaie-perce',
    name: 'Malbaie',
    mapHint: 'inferred east-side / Perce sector river',
    description: 'Smaller eastern Gaspesie river flowing toward La Malbaie Bay.',
    image: '',
    confidence: 'medium',
  },
  {
    id: 13,
    slug: 'grande-riviere',
    name: 'Grande Riviere',
    mapHint: 'lower-right south-shore river near Perce sector',
    description: 'Prominent south-shore river running to Chaleur Bay.',
    image: '',
    confidence: 'high',
  },
  {
    id: 14,
    slug: 'petit-pabos',
    name: 'Petit Pabos',
    mapHint: 'lower-right cluster, smaller branch west of Grande Riviere',
    description: 'One of the three famous Pabos salmon rivers near Chandler.',
    image: 'https://commons.wikimedia.org/wiki/Special:FilePath/Small_pabos_river_salmons.jpg',
    confidence: 'high',
  },
  {
    id: 15,
    slug: 'grand-pabos',
    name: 'Grand Pabos',
    mapHint: 'lower-right cluster, main Pabos river',
    description: 'Major river in the Pabos trio, long associated with Atlantic salmon.',
    image: 'https://commons.wikimedia.org/wiki/Special:FilePath/Riviere_Grand_Pabos.jpg',
    confidence: 'high',
  },
  {
    id: 16,
    slug: 'grand-pabos-ouest',
    name: 'Grand Pabos Ouest',
    mapHint: 'lower-right cluster, western/southern Pabos branch',
    description: 'Completes the Pabos trio in the Chandler area.',
    image: '',
    confidence: 'high',
  },
  {
    id: 17,
    slug: 'sainte-anne',
    name: 'Sainte-Anne',
    mapHint: 'north coast river associated with Sainte-Anne-des-Monts',
    description: 'Signature Haute-Gaspesie river linking mountain headwaters to the coast.',
    image: '',
    confidence: 'medium',
  },
];

export const RIVER_GUIDE_BY_ID = RIVER_GUIDE.reduce((acc, river) => {
  acc[river.id] = river;
  return acc;
}, {});

// Maps the existing traced map path IDs to guide river IDs.
// Unmapped paths are intentionally omitted until manual visual QA confirms them.
export const RIVER_PATH_TO_GUIDE_ID = {
  Matapedia: 1,
  'river-3': 2,
  'river-4': 3,
  Bonaventure: 4,
  'river-2': 5,
  Madeleine: 6,
  'river-6': 7,
  Matane: 8,
  Dartmouth: 9,
  York: 10,
  'Saint-Jean': 11,
  'river-15': 12,
  'river-18': 13,
  'river-21': 14,
  'river-16': 15,
  'river-17': 16,
  'Sainte-Anne': 17,
};

export const RIVER_CENTERS_BY_PATH_ID = {
  Bonaventure: { lng: -65.6289, lat: 48.4211 },
  'river-2': { lng: -65.5524, lat: 48.5794 },
  'river-3': { lng: -65.8012, lat: 48.6006 },
  'river-4': { lng: -65.9007, lat: 48.4693 },
  'river-6': { lng: -66.1629, lat: 48.4983 },
  Matapedia: { lng: -67.0759, lat: 48.4326 },
  Matane: { lng: -67.2787, lat: 48.7223 },
  'Sainte-Anne': { lng: -66.7524, lat: 48.9211 },
  Madeleine: { lng: -66.2663, lat: 49.0119 },
  'river-15': { lng: -65.6098, lat: 49.0408 },
  'river-16': { lng: -65.0165, lat: 48.8420 },
  'river-17': { lng: -64.9016, lat: 48.9559 },
  'river-18': { lng: -65.0107, lat: 48.3380 },
  Dartmouth: { lng: -64.8978, lat: 48.7242 },
  York: { lng: -64.8442, lat: 48.4655 },
  'river-21': { lng: -64.6662, lat: 48.4906 },
  'Saint-Jean': { lng: -65.0184, lat: 48.4500 },
};

export function getKnownRiverPathIds() {
  return Object.keys(RIVER_PATH_TO_GUIDE_ID);
}

export function getRiverGuideByPathId(pathId) {
  const riverId = RIVER_PATH_TO_GUIDE_ID[pathId];
  if (!riverId) return null;
  return RIVER_GUIDE_BY_ID[riverId] || null;
}

export function formatRiverDisplayName(pathId, language = 'fr') {
  if (!pathId) return '';
  const guide = getRiverGuideByPathId(pathId);

  if (!guide) {
    if (pathId.startsWith('river-')) return language === 'en' ? 'River' : 'Riviere';
    return language === 'en' ? `River ${pathId}` : `Riviere ${pathId}`;
  }

  return language === 'en' ? `${guide.name} River` : `Riviere ${guide.name}`;
}
