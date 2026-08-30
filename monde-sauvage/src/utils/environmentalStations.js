// Environmental monitoring stations around Sainte-Anne-des-Monts (Gaspésie).
//
// Two independent, additive map layers consume this registry:
//   • RIVER_STATIONS — river flow (débit), rendered as blue circular nodes inland.
//     `stationNumber` is the real 6-digit CEHQ noStation. Live débit is fetched
//     through our `cehq-river-flow` Supabase edge function (which proxies the
//     CORS-less CEHQ suivi-hydrologique JSON). A river with `stationNumber: null`
//     has NO active CEHQ gauge — `fetchRiverDetail` shows a clearly-badged
//     estimation for it instead. Verified 2026-07-21: only the Sainte-Anne
//     (021407) gauge covers the outfitter's immediate footprint; Cap-Chat,
//     Sainte-Anne Nord-Est, Mont-Louis and Madeleine have no open station.
//   • TIDE_STATIONS — tides (marées), rendered as teal wave nodes along the
//     St. Lawrence coast. `iwlsId` is the DFO IWLS station id and this feed is
//     fully live + CORS-clean, no proxy required.
//
// IMPORTANT — coordinates are ARTISTIC, not real-world. The map is a decorative
// illustrated overlay (public/NewMap.png) where rivers are drawn stylized and do
// NOT sit at their true lat/lng. So each node's [lng, lat] is hand-tuned to land
// on the *drawn* river, computed from the overlay's corner bounds by snapping to
// the illustration's blue river line. The real CEHQ gauge id lives in
// `stationNumber` (used only for the live débit fetch) and is fully decoupled
// from where the dot renders. Coordinates are [lng, lat] (GeoJSON/Mapbox order).

export const SAINTE_ANNE_DES_MONTS = [-66.49, 49.13];

/** @typedef {{ id: string, name: string, coordinates: [number, number] }} EnvStationBase */

/** @typedef {EnvStationBase & { stationNumber: string|null, river: string }} RiverStation */
/**
 * Rivers shown on the map. `stationNumber` = active CEHQ noStation (live débit),
 * or null when there is no open gauge (→ badged estimate). All ids verified
 * against the CEHQ station directory + live JSON feed on 2026-07-21.
 */
export const RIVER_STATIONS = /** @type {RiverStation[]} */ ([
  {
    id: 'river-sainte-anne',
    name: 'Rivière Sainte-Anne',
    river: 'Sainte-Anne',
    stationNumber: '021407', // LIVE — CEHQ Sainte-Anne (Gaspésie)
    coordinates: [-66.5266, 49.0042], // on drawn "Sainte-Anne" river
  },
  {
    id: 'river-cap-chat',
    name: 'Rivière Cap-Chat',
    river: 'Cap-Chat',
    stationNumber: null, // no open CEHQ gauge (021502 closed 1996) → estimate
    coordinates: [-66.7371, 48.9752], // on drawn "Cap-Chat" river
  },
  // NOTE: Mont-Louis and Sainte-Anne Nord-Est were dropped — neither is drawn on
  // the illustrated map and neither has an active CEHQ gauge (nowhere correct to
  // place them, no data to show).
  {
    id: 'river-madeleine',
    name: 'Rivière Madeleine',
    river: 'Madeleine',
    stationNumber: null, // no open CEHQ gauge (020802 closed 2003) → estimate
    coordinates: [-65.6844, 49.0042], // on drawn "Madeleine" river
  },
  {
    id: 'river-matane',
    name: 'Rivière Matane',
    river: 'Matane',
    stationNumber: '021601', // LIVE — CEHQ Matane
    coordinates: [-67.4835, 48.7126], // on drawn "Matane" river
  },
  {
    id: 'river-cascapedia',
    name: 'Rivière Cascapédia',
    river: 'Cascapédia',
    stationNumber: '011003', // LIVE — CEHQ Cascapédia
    coordinates: [-66.1017, 48.4906], // on drawn "Cascapédia" river
  },
  {
    id: 'river-york',
    name: 'Rivière York',
    river: 'York',
    stationNumber: '020404', // LIVE — CEHQ York
    coordinates: [-64.9763, 48.7261], // on drawn "York" river
  },
  {
    id: 'river-dartmouth',
    name: 'Rivière Dartmouth',
    river: 'Dartmouth',
    stationNumber: '020602', // LIVE — CEHQ Dartmouth
    coordinates: [-64.9935, 49.0061], // on drawn "Dartmouth" river
  },

  // --- More verified active gauges, off-footprint. Uncomment if you guide there.
  // { id: 'river-p-cascapedia', name: 'Petite rivière Cascapédia', river: 'Petite Cascapédia', stationNumber: '010902', coordinates: [-65.8643, 48.4577] },
  // { id: 'river-bonaventure',  name: 'Rivière Bonaventure',  river: 'Bonaventure',  stationNumber: '010802', coordinates: [-65.5351, 48.3457] },
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
