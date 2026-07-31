#!/usr/bin/env node
// Validate and stage a city-specific neighborhood GeoJSON for R2 upload.

const fs = require('fs');
const path = require('path');

const [, , stateFipsArg, placeGeoidArg, sourceArg] = process.argv;

function fail(message) {
  console.error(`[prepare:neighborhood] ${message}`);
  process.exit(1);
}

const stateFips = String(stateFipsArg || '').padStart(2, '0');
const placeGeoid = String(placeGeoidArg || '').trim();
const sourcePath = sourceArg ? path.resolve(sourceArg) : '';

if (!/^\d{2}$/.test(stateFips)) {
  fail('Usage: node scripts/prepare-neighborhood-boundary.js <stateFips> <placeGeoid> <source.geojson>');
}
if (!/^\d{7}$/.test(placeGeoid)) {
  fail('placeGeoid must be the 7-digit Census place GEOID, for example 0667000.');
}
if (!sourcePath || !fs.existsSync(sourcePath)) {
  fail(`Source GeoJSON not found: ${sourceArg || '(missing)'}`);
}

const input = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
if (input.type !== 'FeatureCollection' || !Array.isArray(input.features)) {
  fail('Source must be a GeoJSON FeatureCollection.');
}

const allowedGeometry = new Set(['Polygon', 'MultiPolygon']);
const features = input.features.map((feature, index) => {
  if (!feature?.geometry || !allowedGeometry.has(feature.geometry.type)) {
    fail(`Feature ${index + 1} must be a Polygon or MultiPolygon.`);
  }

  const props = feature.properties || {};
  const name = props.name || props.NAME || props.NAMELSAD || props.neighborhood ||
    props.NEIGHBORHOOD || props.label || props.LABEL;
  if (!name) {
    fail(`Feature ${index + 1} is missing a neighborhood name property.`);
  }

  return {
    type: 'Feature',
    geometry: feature.geometry,
    properties: {
      ...props,
      name: String(name)
    }
  };
});

const output = {
  type: 'FeatureCollection',
  features
};

const outDir = path.join(__dirname, '..', 'data', 'generated', 'neighborhood-boundaries', stateFips);
const outPath = path.join(outDir, `${placeGeoid}.geojson`);
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(output), 'utf8');

console.log(`[prepare:neighborhood] wrote ${features.length} features to ${outPath}`);
