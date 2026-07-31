// build.js
// Runs at deploy time via "npm run build".
// 1. Reads environment variables and writes config.js.
// 2. Verifies the local topology, market areas, and boundary assets.

const fs   = require('fs');
const path = require('path');

const required = [
  'MAPBOX_TOKEN',
];

const missing = required.filter(k => !process.env[k]);
if (missing.length) {
  console.error(`[build] ❌ Missing required environment variables: ${missing.join(', ')}`);
  console.error('[build] Make sure these are set in your Cloudflare Pages project settings.');
  process.exit(1);
}

const config = `// config.js — AUTO-GENERATED at build time. Do not edit or commit.
window.APTUS_CONFIG = {
  MAPBOX_TOKEN: ${JSON.stringify(process.env.MAPBOX_TOKEN)}${process.env.PLACE_BOUNDARIES_BASE_URL ? `,
  PLACE_BOUNDARIES_BASE_URL: ${JSON.stringify(process.env.PLACE_BOUNDARIES_BASE_URL)}` : ''}${process.env.NEIGHBORHOOD_BOUNDARIES_BASE_URL ? `,
  NEIGHBORHOOD_BOUNDARIES_BASE_URL: ${JSON.stringify(process.env.NEIGHBORHOOD_BOUNDARIES_BASE_URL)}` : ''}
};
`;

// Write config.js to the same directory as build.js (the project root)
const outPath = path.join(__dirname, 'config.js');
fs.writeFileSync(outPath, config, 'utf8');
console.log(`[build] ✅ config.js written to ${outPath}`);
console.log('[build] Keys configured: ' + required.join(', '));

function verifyCountyTopology() {
  const topologyPath = path.join(__dirname, 'data/generated/counties-10m.json');
  if (!fs.existsSync(topologyPath)) {
    console.error(`[build] ❌ Missing local county topology: ${topologyPath}`);
    console.error('[build] Run "npm run refresh:data" to regenerate local data assets.');
    process.exit(1);
  }

  const topology = JSON.parse(fs.readFileSync(topologyPath, 'utf8'));
  if (topology.type !== 'Topology' || !topology.objects?.counties?.geometries?.length) {
    console.error(`[build] ❌ Invalid county topology: ${topologyPath}`);
    process.exit(1);
  }
  console.log(`[build] ✅ county topology verified — ${topology.objects.counties.geometries.length} geometries`);
}

function verifyPlaceBoundaries() {
  if (process.env.PLACE_BOUNDARIES_BASE_URL) {
    console.log('[build] ✅ place boundaries configured externally: ' + process.env.PLACE_BOUNDARIES_BASE_URL);
    return;
  }

  const boundaryDir = path.join(__dirname, 'data/generated/place-boundaries');
  if (!fs.existsSync(boundaryDir)) {
    console.error(`[build] ❌ Missing local place boundaries: ${boundaryDir}`);
    console.error('[build] Run "npm run refresh:data" to regenerate local data assets.');
    process.exit(1);
  }

  const files = fs.readdirSync(boundaryDir).filter(file => file.endsWith('.geojson'));
  if (!files.length) {
    console.error(`[build] ❌ No local place boundary files found in ${boundaryDir}`);
    process.exit(1);
  }

  console.log(`[build] ✅ place boundaries verified — ${files.length} state files`);
}

function verifyMarketAreas() {
  const marketPath = path.join(__dirname, 'data/generated/market-areas.json');
  if (!fs.existsSync(marketPath)) {
    console.error(`[build] ❌ Missing local market areas: ${marketPath}`);
    console.error('[build] Run "npm run build:markets" or "npm run refresh:data" to regenerate local market assets.');
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(marketPath, 'utf8'));
  const stateCount = Object.keys(data.states || {}).length;
  const marketCount = Object.values(data.states || {})
    .reduce((sum, markets) => sum + markets.length, 0);
  if (!stateCount || !marketCount) {
    console.error(`[build] ❌ Invalid market areas: ${marketPath}`);
    process.exit(1);
  }
  console.log(`[build] ✅ market areas verified — ${marketCount} markets across ${stateCount} states`);
}

function verifyNeighborhoodBoundaries() {
  if (process.env.NEIGHBORHOOD_BOUNDARIES_BASE_URL) {
    console.log('[build] ✅ neighborhood boundaries configured externally: ' + process.env.NEIGHBORHOOD_BOUNDARIES_BASE_URL);
    return;
  }

  const boundaryDir = path.join(__dirname, 'data/generated/neighborhood-boundaries');
  if (!fs.existsSync(boundaryDir)) {
    console.log('[build] ℹ️ neighborhood boundaries not configured; app will use generated neighborhood zones as a fallback');
    return;
  }

  const files = [];
  const stack = [boundaryDir];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(entryPath);
      if (entry.isFile() && entry.name.endsWith('.geojson')) files.push(entryPath);
    }
  }

  console.log(`[build] ✅ neighborhood boundaries verified — ${files.length} city files`);
}

verifyCountyTopology();
verifyMarketAreas();
verifyPlaceBoundaries();
verifyNeighborhoodBoundaries();
