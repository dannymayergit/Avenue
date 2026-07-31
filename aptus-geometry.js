// ── aptus-geometry.js ────────────────────────────────────────────────────────
// Pure geometry helpers — no Mapbox or DOM dependencies.

// ── Point-in-polygon ──────────────────────────────────────────────────────────
function pointInRing(pt, ring) {
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInGeometry(pt, geometry) {
  if (geometry.type === 'Polygon')
    return pointInRing(pt, geometry.coordinates[0]);
  if (geometry.type === 'MultiPolygon')
    return geometry.coordinates.some(poly => pointInRing(pt, poly[0]));
  return false;
}

// ── Bounding box helpers ──────────────────────────────────────────────────────
function getGeometryBounds(geometry) {
  const bounds = {
    minLng:  Infinity,
    minLat:  Infinity,
    maxLng: -Infinity,
    maxLat: -Infinity
  };

  const visit = (coordinates) => {
    if (typeof coordinates[0] === 'number' && typeof coordinates[1] === 'number') {
      bounds.minLng = Math.min(bounds.minLng, coordinates[0]);
      bounds.minLat = Math.min(bounds.minLat, coordinates[1]);
      bounds.maxLng = Math.max(bounds.maxLng, coordinates[0]);
      bounds.maxLat = Math.max(bounds.maxLat, coordinates[1]);
      return;
    }
    coordinates.forEach(visit);
  };

  visit(geometry.coordinates);
  return bounds;
}

function getGeometryCenter(geometry) {
  const bounds = getGeometryBounds(geometry);
  return [
    (bounds.minLng + bounds.maxLng) / 2,
    (bounds.minLat + bounds.maxLat) / 2
  ];
}

// ── Mapbox LngLatBounds helper ────────────────────────────────────────────────
function extendBounds(bounds, coordinates) {
  if (typeof coordinates[0] === 'number' && typeof coordinates[1] === 'number') {
    bounds.extend(coordinates);
    return bounds;
  }
  coordinates.forEach((coordinate) => extendBounds(bounds, coordinate));
  return bounds;
}

function getFeatureBounds(feature) {
  return extendBounds(new mapboxgl.LngLatBounds(), feature.geometry.coordinates);
}
