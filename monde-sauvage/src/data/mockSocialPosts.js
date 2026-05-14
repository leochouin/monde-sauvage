// Seed posts displayed when the live feed is empty.
// Marked with isMock: true so the UI can disable interactions (likes, comments)
// and so they can be filtered out before launch.

const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();
const daysAgo = (d) => new Date(Date.now() - d * 24 * 3600 * 1000).toISOString();

const buildAuthor = ({ id, name, initials, avatar }) => ({
  userId: id,
  name,
  initials,
  avatarSrc: avatar || '',
  hasGuideProfile: true,
});

export const MOCK_SOCIAL_POSTS = [
  {
    id: 'mock-1',
    isMock: true,
    content:
      "Belle matinée sur la Bonaventure 🎣 Eau cristalline et trois saumons relâchés. " +
      "Mes clients du Nouveau-Brunswick repartent le sourire jusqu'aux oreilles.",
    createdAt: hoursAgo(3),
    updatedAt: hoursAgo(3),
    authorType: 'guide',
    commentCount: 4,
    images: [
      { id: 'mock-1-i1', url: 'https://images.unsplash.com/photo-1542810634-71277d95dcbb?w=1200&q=80' },
    ],
    author: buildAuthor({
      id: 'mock-author-1',
      name: 'Antoine Pelletier',
      initials: 'AP',
    }),
    isFollowingAuthor: false,
  },
  {
    id: 'mock-2',
    isMock: true,
    content:
      "Première sortie de la saison sur la York. Le brouillard se levait au-dessus de la rivière, " +
      "moment magique. La nature est généreuse cette année 🌲",
    createdAt: hoursAgo(8),
    updatedAt: hoursAgo(8),
    authorType: 'guide',
    commentCount: 12,
    images: [
      { id: 'mock-2-i1', url: 'https://images.unsplash.com/photo-1516279805673-9869c2c5ea30?w=1200&q=80' },
      { id: 'mock-2-i2', url: 'https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=1200&q=80' },
    ],
    author: buildAuthor({
      id: 'mock-author-2',
      name: 'Marie-Claude Tremblay',
      initials: 'MT',
    }),
    isFollowingAuthor: false,
  },
  {
    id: 'mock-3',
    isMock: true,
    content:
      "Conseil du jour 💡 Pour le saumon en juin, privilégiez les mouches sombres en début de matinée. " +
      "Black Bear Hair Wing et Bomber rouge — valeurs sûres sur la Cascapédia.",
    createdAt: daysAgo(1),
    updatedAt: daysAgo(1),
    authorType: 'guide',
    commentCount: 7,
    images: [],
    author: buildAuthor({
      id: 'mock-author-3',
      name: 'Jean-François Côté',
      initials: 'JC',
    }),
    isFollowingAuthor: false,
  },
  {
    id: 'mock-4',
    isMock: true,
    content:
      "Soirée parfaite au chalet : feu de camp, truite fraîchement pêchée et coucher de soleil sur la Matapédia. " +
      "C'est exactement pour ces moments-là qu'on fait ce métier 🔥",
    createdAt: daysAgo(2),
    updatedAt: daysAgo(2),
    authorType: 'guide',
    commentCount: 18,
    images: [
      { id: 'mock-4-i1', url: 'https://images.unsplash.com/photo-1504280390367-361c6d9f38f4?w=1200&q=80' },
      { id: 'mock-4-i2', url: 'https://images.unsplash.com/photo-1499363536502-87642509e31b?w=1200&q=80' },
      { id: 'mock-4-i3', url: 'https://images.unsplash.com/photo-1444930694458-01babe71870c?w=1200&q=80' },
    ],
    author: buildAuthor({
      id: 'mock-author-4',
      name: 'Sophie Bélanger',
      initials: 'SB',
    }),
    isFollowingAuthor: false,
  },
  {
    id: 'mock-5',
    isMock: true,
    content:
      "Trois places encore disponibles pour la fin juin sur la Petite-Cascapédia. " +
      "Parfait pour les pêcheurs intermédiaires qui veulent travailler leur lancer en deux mains.",
    createdAt: daysAgo(3),
    updatedAt: daysAgo(3),
    authorType: 'guide',
    commentCount: 2,
    images: [
      { id: 'mock-5-i1', url: 'https://images.unsplash.com/photo-1455729552865-3658a5d39692?w=1200&q=80' },
    ],
    author: buildAuthor({
      id: 'mock-author-5',
      name: 'Étienne Roy',
      initials: 'ER',
    }),
    isFollowingAuthor: false,
  },
  {
    id: 'mock-6',
    isMock: true,
    content:
      "Petit récap de la semaine : 14 sorties, 9 saumons relâchés, 0 blessure. " +
      "Bravo à toute l'équipe et merci aux clients pour la confiance 🙏",
    createdAt: daysAgo(4),
    updatedAt: daysAgo(4),
    authorType: 'guide',
    commentCount: 23,
    images: [],
    author: buildAuthor({
      id: 'mock-author-6',
      name: 'Antoine Pelletier',
      initials: 'AP',
    }),
    isFollowingAuthor: false,
  },
  {
    id: 'mock-7',
    isMock: true,
    content:
      "Nouvelle aventure pour la rentrée d'automne — sortie spéciale truite mouchetée " +
      "sur les lacs intérieurs des Chic-Chocs. Inscriptions ouvertes 🍁",
    createdAt: daysAgo(6),
    updatedAt: daysAgo(6),
    authorType: 'guide',
    commentCount: 11,
    images: [
      { id: 'mock-7-i1', url: 'https://images.unsplash.com/photo-1502082553048-f009c37129b9?w=1200&q=80' },
      { id: 'mock-7-i2', url: 'https://images.unsplash.com/photo-1418065460487-3e41a6c84dc5?w=1200&q=80' },
    ],
    author: buildAuthor({
      id: 'mock-author-7',
      name: 'Marie-Claude Tremblay',
      initials: 'MT',
    }),
    isFollowingAuthor: false,
  },
  {
    id: 'mock-8',
    isMock: true,
    content:
      "Question pour la communauté 🤔 Quelle est votre rivière préférée pour initier un débutant ? " +
      "Je penche pour la Bonaventure mais curieux d'avoir d'autres avis.",
    createdAt: daysAgo(8),
    updatedAt: daysAgo(8),
    authorType: 'guide',
    commentCount: 31,
    images: [],
    author: buildAuthor({
      id: 'mock-author-8',
      name: 'Jean-François Côté',
      initials: 'JC',
    }),
    isFollowingAuthor: false,
  },
];
