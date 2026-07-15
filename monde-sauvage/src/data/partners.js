/* ── Destinations partenaires (domaines externes) ──
   Partagé entre la homepage (bandeaux immersifs) et la page dédiée /destinations.
   Images téléchargées localement dans /public/partners (pas de hotlink). */

export const PARTNERS = [
  {
    slug: 'falls-gully',
    name: 'Falls Gully',
    kicker: 'Pourvoirie · Pêche sportive',
    short: 'Une pourvoirie de premier plan, entre rivières à saumon et grands espaces sauvages.',
    desc: 'Nichée près du lac Robidoux, Falls Gully allie chalets et auberge pour combiner confort et grands espaces. La pourvoirie propose des forfaits de pêche — saumon, truite, bar rayé — adaptés aux débutants comme aux pêcheurs aguerris, ainsi que des plans repas allant du service en cuisine à la formule autonome.',
    features: ['Chalets & auberge', 'Forfaits de pêche', 'Lac Robidoux', 'Plans repas'],
    href: 'https://fallsgully.com/',
    hero: '/partners/fallsgully-1.jpg',
    gallery: [
      '/partners/fallsgully-3.jpg',
      '/partners/fallsgully-4.jpg',
      '/partners/fallsgully-2.jpg',
    ],
  },
  {
    slug: 'chateau-lamontagne',
    name: 'Auberge Château Lamontagne',
    kicker: 'Auberge patrimoniale · 1873',
    short: 'Une auberge de charme de 1873 perchée sur le cap, face au fleuve Saint-Laurent.',
    desc: 'Perchée au sommet du cap des Groseilliers, face au majestueux fleuve Saint-Laurent et avec accès aux Chic-Chocs, cette auberge patrimoniale datant de 1873 propose sept chambres, trois chalets modernes et un restaurant bistronomique mettant en valeur les produits du terroir.',
    features: ['7 chambres', '3 chalets modernes', 'Restaurant bistronomique', 'Accès aux Chic-Chocs'],
    href: 'https://www.chateaulamontagne.com/accueil-auberge',
    hero: '/partners/chateau-3.jpg',
    gallery: [
      '/partners/chateau-1.jpg',
      '/partners/chateau-5.jpg',
      '/partners/chateau-2.jpg',
      '/partners/chateau-4.jpg',
    ],
  },
]
