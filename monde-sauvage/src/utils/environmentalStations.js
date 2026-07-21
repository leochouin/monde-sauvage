// Environmental monitoring stations around Sainte-Anne-des-Monts (Gaspésie).
//
// Two independent, additive map layers consume this registry:
//   • RIVER_STATIONS — river flow (débit), rendered as blue circular nodes inland.
//     `stationNumber` is the real hydrometric station id. Gaspésie rivers are
//     monitored by CEHQ (province of Québec); Environment Canada's federal
//     real-time datamart does NOT cover them, so `fetchRiverDetail` will fall
//     back to a clearly-badged estimation when the federal API returns nothing
//     for a given station. Swap `RIVER_API_BASE` for a CEHQ proxy to go fully
//     live (see GO_LIVE notes / tile-cache doc for the proxy sketch).
//   • TIDE_STATIONS — tides (marées), rendered as teal wave nodes along the
//     St. Lawrence coast. `iwlsId` is the DFO IWLS station id and this feed is
//     fully live + CORS-clean, no proxy required.
//
// Coordinates are [lng, lat] to match GeoJSON / Mapbox ordering.

export const SAINTE_ANNE_DES_MONTS = [-66.49, 49.13];

/** @typedef {{ id: string, name: string, coordinates: [number, number] }} EnvStationBase */

/** @typedef {EnvStationBase & { stationNumber: string, river: string }} RiverStation */
/** Real CEHQ station numbers, placed on the rivers that matter to the outfitter. */
export const RIVER_STATIONS = /** @type {RiverStation[]} */ ([
  {
    id: 'river-sainte-anne',
    name: 'Rivière Sainte-Anne',
    river: 'Sainte-Anne',
    stationNumber: '02QC009',
    coordinates: [-66.4867, 49.0589],
  },
  {
    id: 'river-cap-chat',
    name: 'Rivière Cap-Chat',
    river: 'Cap-Chat',
    stationNumber: '02QB011',
    coordinates: [-66.6722, 49.0564],
  },
  {
    id: 'river-sainte-anne-ne',
    name: 'Rivière Sainte-Anne Nord-Est',
    river: 'Sainte-Anne Nord-Est',
    stationNumber: '02QC010',
    coordinates: [-66.1272, 48.9464],
  },
  {
    id: 'river-mont-louis',
    name: 'Rivière de Mont-Louis',
    river: 'Mont-Louis',
    stationNumber: '02QC003',
    coordinates: [-65.7286, 49.2067],
  },
  {
    id: 'river-madeleine',
    name: 'Rivière Madeleine',
    river: 'Madeleine',
    stationNumber: '02QC001',
    coordinates: [-65.2956, 49.2028],
  },
]);

/** @typedef {EnvStationBase & { iwlsId: string, code: string }} TideStation */
/** Real DFO IWLS station ids (fully live feed). */
export const TIDE_STATIONS = /** @type {TideStation[]} */ ([
  {
    id: 'tide-sainte-anne-des-monts',
    name: 'Sainte-Anne-des-Monts',
    code: '02935',
    iwlsId: '5cebf1e43d0f4a073c4bc35a',
    coordinates: [-66.4858, 49.134],
  },
  {
    id: 'tide-cap-chat',
    name: 'Cap-Chat',
    code: '02940',
    iwlsId: '5cebf1e43d0f4a073c4bc35e',
    coordinates: [-66.6815, 49.0983],
  },
  {
    id: 'tide-petite-tourelle',
    name: 'Petite-Tourelle',
    code: '02933',
    iwlsId: '5dd30650e0fdc4b9b4be6c00',
    coordinates: [-66.3728, 49.1678],
  },
  {
    id: 'tide-mont-louis',
    name: 'Mont-Louis',
    code: '02920',
    iwlsId: '5cebf1e43d0f4a073c4bc356',
    coordinates: [-65.7375, 49.2352],
  },
  {
    id: 'tide-grande-vallee',
    name: 'Grande-Vallée',
    code: '02350',
    iwlsId: '5cebf1e33d0f4a073c4bc2e1',
    coordinates: [-65.1345, 49.2298],
  },
]);

// --- API endpoints -------------------------------------------------------
// Env Canada OGC-API (GeoJSON, CORS-clean). To serve true CEHQ real-time data
// for the Gaspésie rivers, point RIVER_API_BASE at a Supabase edge function
// that proxies https://www.cehq.gouv.qc.ca and normalizes to the same shape.
export const RIVER_API_BASE = 'https://api.weather.gc.ca/collections/hydrometric-realtime/items';
export const TIDE_API_BASE = 'https://api-iwls.dfo-mpo.gc.ca/api/v1/stations';
