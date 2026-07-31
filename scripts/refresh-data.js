// Refreshes locally hosted geographic source assets.
// Network access is intentionally explicit and outside the normal build path.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const STATE_FIPS = [
  '01', '02', '04', '05', '06', '08', '09', '10', '11', '12', '13', '15',
  '16', '17', '18', '19', '20', '21', '22', '23', '24', '25', '26', '27',
  '28', '29', '30', '31', '32', '33', '34', '35', '36', '37', '38', '39',
  '40', '41', '42', '44', '45', '46', '47', '48', '49', '50', '51', '53',
  '54', '55', '56'
];

const ASSETS = [
  {
    url: 'https://cdn.jsdelivr.net/npm/us-atlas@3/counties-10m.json',
    out: 'data/generated/counties-10m.json',
    validate: data => data.type === 'Topology' && data.objects?.counties?.geometries?.length
  },
  {
    url: 'https://www2.census.gov/geo/docs/reference/codes2020/national_county2020.txt',
    out: 'data/source/national_county2020.txt',
    validate: text => text.startsWith('STATE|STATEFP|COUNTYFP|COUNTYNS|COUNTYNAME')
  },
  {
    url: 'https://data.nber.org/cbsa-csa-fips-county-crosswalk/2023/cbsa2fipsxw_2023.csv',
    out: 'data/source/cbsa2fipsxw_2023.csv',
    validate: text => text.startsWith('cbsacode,metropolitandivisioncode,csacode,cbsatitle')
  }
];

function normalizeFeature(feature, boundaryType) {
  return {
    type: 'Feature',
    geometry: feature.geometry,
    properties: {
      GEOID: feature.properties.GEOID,
      STATE: feature.properties.STATE,
      PLACE: feature.properties.PLACE,
      NAME: feature.properties.NAME,
      BASENAME: feature.properties.BASENAME,
      LSADC: feature.properties.LSADC,
      FUNCSTAT: feature.properties.FUNCSTAT,
      boundaryType
    }
  };
}

async function fetchPlaceLayerPage(stateFips, layerId, boundaryType, offset) {
  const params = new URLSearchParams({
    where: `STATE='${stateFips}'`,
    outFields: '*',
    returnGeometry: 'true',
    outSR: '4326',
    geometryPrecision: '4',
    maxAllowableOffset: '0.0001',
    orderByFields: 'OBJECTID',
    resultOffset: String(offset),
    resultRecordCount: '500',
    f: 'geojson'
  });
  const url = `https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Places_CouSub_ConCity_SubMCD/MapServer/${layerId}/query?${params}`;
  let lastError = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const text = await resp.text();
      const collection = JSON.parse(text);
      if (collection.error) throw new Error(collection.error.message);
      return (collection.features || [])
        .filter(feature => feature.geometry)
        .map(feature => normalizeFeature(feature, boundaryType));
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, attempt * 1000));
    }
  }

  throw new Error(`${url} failed after 3 attempts: ${lastError.message}`);
}

async function fetchPlaceLayer(stateFips, layerId, boundaryType) {
  const features = [];
  let offset = 0;

  while (true) {
    const page = await fetchPlaceLayerPage(stateFips, layerId, boundaryType, offset);
    features.push(...page);
    if (page.length < 500) break;
    offset += 500;
  }

  return features;
}

async function refreshPlaceBoundaries() {
  const outDir = path.join(__dirname, '..', 'data/generated/place-boundaries');
  fs.mkdirSync(outDir, { recursive: true });
  const stateList = process.env.STATES
    ? process.env.STATES.split(',').map(state => state.trim()).filter(Boolean)
    : STATE_FIPS;

  for (const stateFips of stateList) {
    const outPath = path.join(outDir, `${stateFips}.geojson`);
    if (fs.existsSync(outPath) && process.env.FORCE_REFRESH !== '1') {
      console.log(`[data] Keeping existing data/generated/place-boundaries/${stateFips}.geojson`);
      continue;
    }

    console.log(`[data] Fetching legal place boundaries for state ${stateFips}`);
    const countySubdivisions = await fetchPlaceLayer(stateFips, 8, 'county-subdivision');
    const consolidated = await fetchPlaceLayer(stateFips, 10, 'consolidated');
    const incorporated = await fetchPlaceLayer(stateFips, 11, 'incorporated');
    const cdps = await fetchPlaceLayer(stateFips, 12, 'cdp');
    const collection = {
      type: 'FeatureCollection',
      features: [...consolidated, ...incorporated, ...countySubdivisions, ...cdps]
    };
    fs.writeFileSync(outPath, JSON.stringify(collection), 'utf8');
    console.log(`[data] Wrote data/generated/place-boundaries/${stateFips}.geojson (${collection.features.length} features)`);
  }
}

async function refreshAsset(asset) {
  const outPath = path.join(__dirname, '..', asset.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  console.log(`[data] Fetching ${asset.url}`);
  const resp = await fetch(asset.url);
  if (!resp.ok) throw new Error(`${asset.url} returned HTTP ${resp.status}`);

  const body = await resp.text();
  const parsed = asset.out.endsWith('.json') ? JSON.parse(body) : body;
  if (!asset.validate(parsed)) throw new Error(`${asset.out} failed validation`);

  fs.writeFileSync(outPath, body, 'utf8');
  console.log(`[data] Wrote ${asset.out}`);
}

(async () => {
  for (const asset of ASSETS) {
    await refreshAsset(asset);
  }
  const marketBuild = spawnSync(process.execPath, [path.join(__dirname, 'build-market-areas.js')], {
    stdio: 'inherit'
  });
  if (marketBuild.status !== 0) {
    throw new Error('market area generation failed');
  }
  await refreshPlaceBoundaries();
})().catch(error => {
  console.error('[data] Refresh failed:', error.message);
  process.exit(1);
});
