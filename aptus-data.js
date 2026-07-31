// ── aptus-data.js ────────────────────────────────────────────────────────────
// Data loading: fetches local Census TopoJSON, merges county → state → region
// geometries, and caches county-backed market-area definitions for drilldown.
//
// Dependencies: aptus-config.js, aptus-state.js (countyTopologyCache)

const COUNTY_TOPOLOGY_URL = 'data/generated/counties-10m.json';
const MARKET_AREAS_URL = 'data/generated/market-areas.json';
const PLACE_BOUNDARIES_BASE_URL = (
  window.APTUS_CONFIG?.PLACE_BOUNDARIES_BASE_URL || 'data/generated/place-boundaries'
).replace(/\/+$/, '');
const NEIGHBORHOOD_BOUNDARIES_BASE_URL = (
  window.APTUS_CONFIG?.NEIGHBORHOOD_BOUNDARIES_BASE_URL || 'data/generated/neighborhood-boundaries'
).replace(/\/+$/, '');
const placeBoundaryCache = new Map();
const neighborhoodBoundaryCache = new Map();
let marketAreasCache = null;

async function buildMapData() {
  // Use counties-10m.json as the single source of truth for ALL borders.
  // State and region geometries are derived via topojson.merge() so they share
  // identical arcs with county borders — no misalignment at any zoom level.
  const response = await fetch(COUNTY_TOPOLOGY_URL);
  if (!response.ok) {
    throw new Error(`Failed to load county topology (${response.status})`);
  }
  const topology = await response.json();

  // Build state features by merging counties that share the same state FIPS prefix
  const stateGeomsByFips = {};
  topology.objects.counties.geometries.forEach(geom => {
    const countyFips = String(geom.id).padStart(5, '0');
    const stateFips  = countyFips.slice(0, 2);
    if (!stateGeomsByFips[stateFips]) stateGeomsByFips[stateFips] = [];
    stateGeomsByFips[stateFips].push(geom);
  });

  const stateFeatures = Object.entries(stateGeomsByFips)
    .map(([stateFips, geoms]) => {
      const stateName = FIPS_TO_STATE[stateFips];
      const region    = Object.entries(REGION_STATES)
        .find(([, states]) => states.includes(stateName))?.[0];
      if (!stateName || !region) return null;
      return {
        type: 'Feature',
        id:   stateFips,
        properties: { name: stateName, region, fips: stateFips },
        geometry: topojson.merge(topology, geoms)
      };
    })
    .filter(Boolean);

  // Build region features by merging all counties in each region
  const regionFeatures = Object.entries(REGION_STATES).map(([region, stateNames]) => {
    const geoms = topology.objects.counties.geometries.filter(geom => {
      const stateFips = String(geom.id).padStart(5, '0').slice(0, 2);
      return stateNames.includes(FIPS_TO_STATE[stateFips]);
    });
    return {
      type: 'Feature',
      properties: { region },
      geometry: topojson.merge(topology, geoms)
    };
  });

  // Cache the topology for market-area drilldown (avoids a second fetch)
  countyTopologyCache = topology;

  // Nation polygon (all counties merged) — used as a clip boundary so that
  // state buffers only expand into the ocean, not into neighbouring states.
  // Interior state borders are dissolved by topojson.merge, so the result is
  // just the outer coastline/international boundary — a compact polygon.
  const nationGeometry = topojson.merge(topology, topology.objects.counties.geometries);
  const nationFeature  = { type: 'Feature', properties: {}, geometry: nationGeometry };

  // Build coast-only expanded state features for the visual hover fill.
  // For each state we:
  //   1. Buffer it by 50 km (steps:2 keeps vertex count minimal).
  //   2. Subtract the nation polygon → isolates the ocean overhang only.
  //   3. Union the original state with the overhang → coast-only expansion.
  // Inland state-state borders are never expanded, so the tint can't bleed
  // across them. The Mapbox water layer (rendered on top) clips the ocean
  // overhang so it's never visible.
  const statesVisual = stateFeatures.map(f => {
    try {
      const buffered       = turf.buffer(f, 50, { units: 'kilometers', steps: 2 });
      const coastalOverhang = turf.difference(buffered, nationFeature);
      if (!coastalOverhang || !coastalOverhang.geometry) return f;
      // turf v7 union accepts a FeatureCollection, not two separate args
      const visual = turf.union(turf.featureCollection([f, coastalOverhang]));
      return { type: 'Feature', id: f.id, properties: f.properties, geometry: visual.geometry };
    } catch (_) {
      return f;
    }
  });

  return {
    regions:      { type: 'FeatureCollection', features: regionFeatures },
    states:       stateFeatures,
    statesVisual
  };
}

// ── County topology (cached) ──────────────────────────────────────────────────
async function fetchCountyTopology() {
  if (countyTopologyCache) return countyTopologyCache;
  const resp = await fetch(COUNTY_TOPOLOGY_URL);
  if (!resp.ok) {
    throw new Error(`Failed to load county topology (${resp.status})`);
  }
  countyTopologyCache = await resp.json();
  return countyTopologyCache;
}

async function fetchMarketAreas(stateFips = null) {
  if (!marketAreasCache) {
    const resp = await fetch(MARKET_AREAS_URL);
    if (!resp.ok) {
      throw new Error(`Failed to load market areas (${resp.status})`);
    }
    marketAreasCache = await resp.json();
  }

  return stateFips ? (marketAreasCache.states?.[stateFips] || []) : marketAreasCache;
}

// ── Legal place boundaries ───────────────────────────────────────────────────
async function fetchPlaceBoundaries(stateFips) {
  if (placeBoundaryCache.has(stateFips)) return placeBoundaryCache.get(stateFips);

  const resp = await fetch(`${PLACE_BOUNDARIES_BASE_URL}/${stateFips}.geojson`);
  if (!resp.ok) {
    placeBoundaryCache.set(stateFips, []);
    return [];
  }

  const collection = await resp.json();
  const features = collection.features || [];
  placeBoundaryCache.set(stateFips, features);
  return features;
}

// ── Neighborhood boundaries ──────────────────────────────────────────────────
// True neighborhood definitions are city-specific rather than nationally
// standardized. Files are loaded by Census place GEOID:
//   {NEIGHBORHOOD_BOUNDARIES_BASE_URL}/{stateFips}/{placeGeoid}.geojson
async function fetchNeighborhoodBoundaries(stateFips, placeGeoid) {
  const key = `${stateFips}:${placeGeoid}`;
  if (neighborhoodBoundaryCache.has(key)) return neighborhoodBoundaryCache.get(key);

  if (!stateFips || !placeGeoid) {
    neighborhoodBoundaryCache.set(key, []);
    return [];
  }

  const url = `${NEIGHBORHOOD_BOUNDARIES_BASE_URL}/${stateFips}/${placeGeoid}.geojson`;
  const resp = await fetch(url);
  if (!resp.ok) {
    neighborhoodBoundaryCache.set(key, []);
    return [];
  }

  const collection = await resp.json();
  const features = collection.features || [];
  neighborhoodBoundaryCache.set(key, features);
  return features;
}
