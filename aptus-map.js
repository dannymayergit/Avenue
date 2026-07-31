// ── aptus-map.js ─────────────────────────────────────────────────────────────
// Mapbox map initialisation, all layer setup, hover/click interactions,
// market-area level, place level, search, and top-level event wiring.
//
// Dependencies (must be loaded before this file):
//   aptus-config.js · aptus-state.js · aptus-geometry.js
//   aptus-data.js   · aptus-labels.js · aptus-panel.js

// ── Active-region orchestrator ────────────────────────────────────────────────
function setActiveRegion(map, regionId) {
  activeRegionId = regionId;

  regionFeaturesById.forEach((_, featureId) => {
    map.setFeatureState(
      { source: 'aptus-regions', id: featureId },
      { active: featureId === regionId, hover: false }
    );
  });

  // Clear hover fills and world dim — focus mask handles visual dimming
  // once a region is active, so hover state must not linger.
  if (map.getLayer('aptus-region-hover-fill')) {
    map.setPaintProperty('aptus-region-hover-fill', 'fill-opacity', 0);
  }
  if (map.getLayer('aptus-state-hover-fill')) {
    map.setPaintProperty('aptus-state-hover-fill', 'fill-opacity', 0);
  }
  if (map.getLayer('aptus-state-border')) {
    map.setPaintProperty('aptus-state-border', 'line-opacity', 0);
  }
  if (map.getLayer('aptus-region-border')) {
    map.setPaintProperty('aptus-region-border', 'line-width', 0.75);
    map.setPaintProperty('aptus-region-border', 'line-opacity',
      ['interpolate', ['linear'], ['zoom'], 5, 0.20, 7.5, 0]);
  }
  if (map.getLayer('aptus-world-dim-fill')) {
    map.setPaintProperty('aptus-world-dim-fill', 'fill-opacity', 0);
  }

  if (regionId !== null) {
    const feature = regionFeaturesById.get(regionId);
    activeRegionName = feature ? feature.properties.region : null;
    if (navStack.length === 0) {
      navStack.push({ label: activeRegionName, cleanup: null });
    }
    updatePanelForRegion(activeRegionName);
  } else {
    activeRegionName = null;
    navStack.length  = 0;
    setStateLabelFilter(null);
    resetPanelToPrompt();
  }
  renderBreadcrumb();
}

function clearDrilldownBeforeRegionSwitch(map) {
  while (navStack.length) {
    const top = navStack.pop();
    if (top.cleanup) top.cleanup();
  }
  if (cleanupMarketLevel) {
    cleanupMarketLevel();
    cleanupMarketLevel = null;
  }
  clearNeighborhoodLevel(map);
  if (map.getSource('aptus-place-boundaries') || map.getSource('aptus-place-hit-targets')) {
    enterPlaceLevel_cleanup(map);
  }
  setActiveState(map, null);
  activeMarketId = null;
  activePlaceId = null;
  activeNeighborhoodId = null;
}

function focusRegionFromFeature(map, clickedRegionId, regionFeature) {
  const regionBounds = getFeatureBounds(regionFeature);
  const mapWidth     = map.getContainer().clientWidth;
  const leftPadding  = Math.max(140, Math.round(mapWidth * 0.48));

  map.stop();
  clearDrilldownBeforeRegionSwitch(map);
  setActiveRegion(map, clickedRegionId);
  setStateLabelFilter(activeRegionName);
  setFocusMask(map, regionFeature);
  regionZoomInProgress = true;
  map.fitBounds(regionBounds, {
    padding:   { top: 64, right: 48, bottom: 64, left: leftPadding },
    duration:  1100, essential: true, maxZoom: 6.8
  });
  map.once('moveend', () => { regionZoomInProgress = false; });
}

let activePlaceId = null;
let activePlaceMarketFeature = null;
let currentPlaceBoundaryFeatures = [];
let activeNeighborhoodId = null;
let currentNeighborhoodBoundaryFeatures = [];
let currentNeighborhoodLoadKey = null;
let _neighborhoodMoveHandler = null;
let _neighborhoodLeaveHandler = null;
let _neighborhoodClickHandler = null;

function setActivePlace(map, placeId) {
  activePlaceId = placeId;
  currentPlaceBoundaryFeatures.forEach((feature) => {
    map.setFeatureState(
      { source: 'aptus-place-boundaries', id: feature.id },
      { active: feature.id === placeId }
    );
  });
}

function setActiveNeighborhood(map, neighborhoodId) {
  activeNeighborhoodId = neighborhoodId;
  currentNeighborhoodBoundaryFeatures.forEach((feature) => {
    map.setFeatureState(
      { source: 'aptus-neighborhood-boundaries', id: feature.id },
      { active: feature.id === neighborhoodId }
    );
  });
}

function normalizePlaceName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\b(city|town|village)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function clipPlaceBoundaryToCounty(boundaryFeature, countyFeature) {
  if (typeof turf === 'undefined' || typeof turf.intersect !== 'function') {
    return boundaryFeature;
  }

  try {
    const clipped = turf.intersect(boundaryFeature, countyFeature);
    if (clipped?.geometry) {
      return {
        type: 'Feature',
        id: boundaryFeature.id,
        geometry: clipped.geometry,
        properties: { ...boundaryFeature.properties }
      };
    }
  } catch (_) {}

  try {
    const clipped = turf.intersect(turf.featureCollection([boundaryFeature, countyFeature]));
    if (clipped?.geometry) {
      return {
        type: 'Feature',
        id: boundaryFeature.id,
        geometry: clipped.geometry,
        properties: { ...boundaryFeature.properties }
      };
    }
  } catch (_) {}

  return boundaryFeature;
}

function getPlaceBoundaryName(boundary) {
  return boundary?.properties?.BASENAME || boundary?.properties?.NAME || boundary?.properties?.NAMELSAD || 'Community';
}

function boundsIntersect(a, b) {
  return a.minLng <= b.maxLng && a.maxLng >= b.minLng &&
    a.minLat <= b.maxLat && a.maxLat >= b.minLat;
}

function getFeatureAnchorPoint(feature) {
  if (!feature?.geometry) return null;
  if (feature.geometry.type === 'Point') return feature.geometry.coordinates;

  if (typeof turf !== 'undefined' && typeof turf.pointOnFeature === 'function') {
    try {
      const point = turf.pointOnFeature(feature);
      if (point?.geometry?.coordinates) return point.geometry.coordinates;
    } catch (_) {}
  }

  return getGeometryCenter(feature.geometry);
}

function clipFeatureToContainer(feature, containerFeature) {
  if (typeof turf === 'undefined' || typeof turf.intersect !== 'function') {
    const point = getFeatureAnchorPoint(feature);
    return point && pointInGeometry(point, containerFeature.geometry) ? feature : null;
  }

  try {
    const clipped = turf.intersect(feature, containerFeature);
    if (clipped?.geometry) {
      return {
        type: 'Feature',
        id: feature.id,
        geometry: clipped.geometry,
        properties: { ...feature.properties }
      };
    }
  } catch (_) {}

  try {
    const clipped = turf.intersect(turf.featureCollection([feature, containerFeature]));
    if (clipped?.geometry) {
      return {
        type: 'Feature',
        id: feature.id,
        geometry: clipped.geometry,
        properties: { ...feature.properties }
      };
    }
  } catch (_) {}

  return null;
}

function buildApproximateCommunityBoundary(place, marketFeature, placeId) {
  if (typeof turf === 'undefined' || typeof turf.buffer !== 'function') return null;

  try {
    const buffered = turf.buffer(place, 5, { units: 'kilometers', steps: 16 });
    const clipped = clipFeatureToContainer({
      type: 'Feature',
      id: placeId,
      geometry: buffered.geometry,
      properties: {
        ...place.properties,
        placeId,
        legalName: place.properties.name,
        boundaryType: 'community-search-area',
        boundarySource: 'approximate'
      }
    }, marketFeature);
    return clipped?.geometry ? clipped : null;
  } catch (_) {
    return null;
  }
}

function buildPlaceLevelFeatures(places, placeBoundaries, marketFeature) {
  const marketBounds = getGeometryBounds(marketFeature.geometry);
  const features = [];
  const seenGeoids = new Set();

  const orderedBoundaries = placeBoundaries
    .filter(boundary => boundary?.geometry)
    .filter(boundary => boundsIntersect(getGeometryBounds(boundary.geometry), marketBounds))
    .sort((a, b) => {
      const priority = {
        'county-subdivision': 0,
        cdp: 1,
        incorporated: 2,
        consolidated: 3
      };
      return (priority[a.properties.boundaryType] ?? 9) -
        (priority[b.properties.boundaryType] ?? 9);
    });

  orderedBoundaries.forEach((boundary) => {
    const geoid = String(boundary.properties.GEOID || '');
    if (geoid && seenGeoids.has(geoid)) return;

    const clipped = clipFeatureToContainer({
      type: 'Feature',
      geometry: boundary.geometry,
      properties: {
        name: getPlaceBoundaryName(boundary),
        geoid,
        legalName: boundary.properties.NAME,
        boundaryType: boundary.properties.boundaryType,
        boundarySource: 'legal'
      }
    }, marketFeature);
    if (!clipped?.geometry) return;

    const placeId = features.length + 1;
    clipped.id = placeId;
    clipped.properties = { ...clipped.properties, placeId };
    features.push(clipped);
    if (geoid) seenGeoids.add(geoid);
  });

  places.forEach((place) => {
    const existing = features.find((feature) => {
      const sameName = normalizePlaceName(feature.properties.name) === normalizePlaceName(place.properties.name);
      return sameName && pointInGeometry(place.geometry.coordinates, feature.geometry);
    });
    if (existing) return;

    const placeId = features.length + 1;
    const fallback = buildApproximateCommunityBoundary(place, marketFeature, placeId);
    if (fallback?.geometry) features.push(fallback);
  });

  const hitTargets = features.map((feature) => {
    const point = getFeatureAnchorPoint(feature);
    if (!point) return null;
    return {
      type: 'Feature',
      id: feature.id,
      geometry: { type: 'Point', coordinates: point },
      properties: {
        name: feature.properties.name,
        placeId: feature.id,
        boundaryType: feature.properties.boundaryType,
        boundarySource: feature.properties.boundarySource
      }
    };
  }).filter(Boolean);

  return { boundaryFeatures: features, hitTargets };
}

function buildVoronoiBoundaries(points, containerFeature, idPropertyName) {
  const ownerPoints = points.map((point, index) => ({
    ...point,
    id: index + 1,
    properties: { ...point.properties, [idPropertyName]: index + 1 }
  }));

  if (!ownerPoints.length || typeof turf === 'undefined' || typeof turf.voronoi !== 'function') {
    return [];
  }

  if (ownerPoints.length === 1) {
    return [{
      type: 'Feature',
      id: ownerPoints[0].properties[idPropertyName],
      geometry: containerFeature.geometry,
      properties: { ...ownerPoints[0].properties, approximate: true }
    }];
  }

  const bounds = getGeometryBounds(containerFeature.geometry);
  const bbox = [bounds.minLng, bounds.minLat, bounds.maxLng, bounds.maxLat];
  let voronoi = null;

  try {
    voronoi = turf.voronoi(
      { type: 'FeatureCollection', features: ownerPoints },
      { bbox }
    );
  } catch (_) {
    return [];
  }
  if (!voronoi?.features?.length) return [];

  const boundariesById = new Map();
  voronoi.features.forEach((cell, index) => {
    if (!cell?.geometry) return;

    const owner = ownerPoints.find((point) =>
      pointInGeometry(point.geometry.coordinates, cell.geometry)
    ) || ownerPoints[index];
    if (!owner) return;

    const clipped = clipPlaceBoundaryToCounty({
      type: 'Feature',
      id: owner.properties[idPropertyName],
      geometry: cell.geometry,
      properties: { ...owner.properties, approximate: true }
    }, containerFeature);

    if (clipped?.geometry) boundariesById.set(owner.properties[idPropertyName], clipped);
  });

  return ownerPoints
    .map((point) => boundariesById.get(point.properties[idPropertyName]))
    .filter(Boolean);
}

function getNeighborhoodName(feature) {
  const props = feature?.properties || {};
  return props.name || props.NAME || props.NAMELSAD || props.neighborhood ||
    props.NEIGHBORHOOD || props.label || props.LABEL || 'Neighborhood';
}

function getCityBoundaryGeoid(cityFeature) {
  return String(cityFeature?.properties?.geoid || cityFeature?.properties?.GEOID || '').trim();
}

function buildLegalNeighborhoodBoundaries(neighborhoods, cityFeature) {
  return neighborhoods.map((feature, index) => {
    if (!feature?.geometry) return null;
    const neighborhoodId = index + 1;
    const clipped = clipPlaceBoundaryToCounty({
      type: 'Feature',
      id: neighborhoodId,
      geometry: feature.geometry,
      properties: {
        ...feature.properties,
        name: getNeighborhoodName(feature),
        neighborhoodId,
        boundarySource: 'true'
      }
    }, cityFeature);

    if (!clipped?.geometry) return null;
    return {
      ...clipped,
      id: neighborhoodId,
      properties: {
        ...clipped.properties,
        name: getNeighborhoodName(clipped),
        neighborhoodId,
        boundarySource: 'true'
      }
    };
  }).filter(Boolean);
}

function buildGeneratedNeighborhoodBoundaries(map, cityFeature) {
  const seen = new Set();
  const neighborhoodPoints = map.querySourceFeatures(MAPBOX_PLACE_LABEL_SOURCE, {
    sourceLayer: MAPBOX_PLACE_LABEL_LAYER
  })
    .filter(f => f.geometry && f.geometry.type === 'Point' && f.properties.name)
    .filter(f => ['neighborhood', 'locality'].includes(f.properties.type))
    .filter(f => {
      const name = f.properties.name;
      const key = normalizePlaceName(name);
      if (!key || seen.has(key)) return false;
      if (!pointInGeometry(f.geometry.coordinates, cityFeature.geometry)) return false;
      seen.add(key);
      return true;
    })
    .map(f => ({
      type: 'Feature',
      geometry: f.geometry,
      properties: { name: f.properties.name, symbolrank: f.properties.symbolrank || 12 }
    }));

  return buildVoronoiBoundaries(neighborhoodPoints, cityFeature, 'neighborhoodId')
    .map(feature => ({
      ...feature,
      properties: { ...feature.properties, boundarySource: 'generated' }
    }));
}

function clearPlaceSelection(map, marketFeature = activePlaceMarketFeature) {
  clearNeighborhoodLevel(map);
  if (map.getSource('aptus-place-boundaries')) setActivePlace(map, null);
  if (marketFeature) setFocusMask(map, marketFeature, 0.66);
}

function buildMarketFeatures(topology, stateFips, marketDefs) {
  const countiesByFips = new Map();
  topology.objects.counties.geometries.forEach((geom) => {
    const fips = String(geom.id).padStart(5, '0');
    if (fips.startsWith(stateFips)) countiesByFips.set(fips, geom);
  });

  return marketDefs.map((market, index) => {
    const geoms = market.countyFips
      .map(fips => countiesByFips.get(fips))
      .filter(Boolean);
    if (!geoms.length) return null;

    const countyList = market.counties?.length
      ? market.counties
      : market.countyFips;

    return {
      type: 'Feature',
      id: index + 1,
      properties: {
        marketId: index + 1,
        key: market.key,
        name: market.name,
        title: market.title,
        type: market.type,
        cbsaCode: market.cbsaCode,
        stateFips,
        countyFips: market.countyFips.join(','),
        counties: countyList.join(', ')
      },
      geometry: topojson.merge(topology, geoms)
    };
  }).filter(Boolean);
}

// ── Market-area level ────────────────────────────────────────────────────────
async function enterMarketLevel(map, stateFips, stateName, stateBounds,
                                targetPoint = null, targetMarketKey = null) {
  // Guard against double-call.
  if (map.getLayer('aptus-market-hover-fill')) map.removeLayer('aptus-market-hover-fill');
  if (map.getLayer('aptus-market-border'))     map.removeLayer('aptus-market-border');
  if (map.getLayer('aptus-market-fills'))      map.removeLayer('aptus-market-fills');
  if (map.getSource('aptus-markets'))          map.removeSource('aptus-markets');

  const topology = await fetchCountyTopology();
  const marketDefs = await fetchMarketAreas(stateFips);
  const marketFeatures = buildMarketFeatures(topology, stateFips, marketDefs);

  map.addSource('aptus-markets', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: marketFeatures }
  });

  const _mBeforeWater = map.getLayer('water') ? 'water' : undefined;

  map.addLayer({
    id: 'aptus-market-hover-fill',
    type: 'fill',
    source: 'aptus-markets',
    filter: ['==', ['get', 'key'], ''],
    paint: {
      'fill-color': '#8b7355',
      'fill-opacity': 0,
      'fill-opacity-transition': { duration: 120, delay: 0 }
    }
  }, _mBeforeWater);

  map.addLayer({
    id: 'aptus-market-fills',
    type: 'fill',
    source: 'aptus-markets',
    paint: { 'fill-color': 'rgba(0,0,0,0)', 'fill-opacity': 1 }
  });

  map.addLayer({
    id: 'aptus-market-border',
    type: 'line',
    source: 'aptus-markets',
    paint: {
      'line-color': '#1f1b18',
      'line-width': [
        'case',
        ['==', ['get', 'type'], 'metro'], 0.85,
        ['==', ['get', 'type'], 'micro'], 0.62,
        0.42
      ],
      'line-opacity': [
        'case',
        ['==', ['get', 'type'], 'county'], 0.16,
        0.34
      ],
    }
  });

  currentMarketFeatureIds = marketFeatures.map(f => f.id);
  setActiveMarket(map, null);

  let hoveredMarketKey = null;

  function applyMarketHoverState(key) {
    map.setPaintProperty('aptus-world-dim-fill', 'fill-opacity', key ? 0.42 : 0);
    if (key) map.setFilter('aptus-market-hover-fill', ['==', ['get', 'key'], key]);
    map.setPaintProperty('aptus-market-hover-fill', 'fill-opacity', key ? 0.15 : 0);
  }

  function clearMarketHover() {
    if (hoveredMarketKey) applyMarketHoverState(null);
    hoveredMarketKey = null;
    map.getCanvas().style.cursor = '';
  }

  function onMarketMove(e) {
    if (!e.features || !e.features.length) return;
    if (getCurrentDepth() !== 2) { clearMarketHover(); return; }
    const key = e.features[0].properties.key;
    if (key === hoveredMarketKey) return;
    hoveredMarketKey = key;
    map.getCanvas().style.cursor = 'pointer';
    applyMarketHoverState(key);
  }

  function onMarketLeave() { clearMarketHover(); }

  function onMarketClick(e) {
    if (!e.features || !e.features.length) return;
    if (getCurrentDepth() !== 2) return;

    const feature = marketFeatures.find(f => f.id === e.features[0].id);
    if (!feature) return;

    const bounds = getFeatureBounds(feature);
    const mapWidth    = map.getContainer().clientWidth;
    const leftPadding = Math.max(140, Math.round(mapWidth * 0.48));

    while (navStack.length > 2) {
      const top = navStack[navStack.length - 1];
      if (top.cleanup) top.cleanup();
      navStack.pop();
    }
    navStack.push({
      label: feature.properties.name,
      key: feature.properties.key,
      bounds,
      feature,
      cleanup: () => enterPlaceLevel_cleanup(map)
    });

    clearMarketHover();
    setFocusMask(map, feature, 0.66);
    renderBreadcrumb();
    updatePanelForMarket(feature.properties, activeRegionName);

    map.stop();
    regionZoomInProgress = true;
    map.fitBounds(bounds, {
      padding:   { top: 80, right: 60, bottom: 80, left: leftPadding },
      duration:  1100,
      essential: true,
      maxZoom:   11.3,
    });
    map.once('moveend', () => {
      regionZoomInProgress = false;
      enterPlaceLevel(map, stateFips, feature);
    });
  }

  _marketClickHandler = onMarketClick;

  if (targetMarketKey) {
    const matched = marketFeatures.find(f => f.properties.key === targetMarketKey);
    if (matched) onMarketClick({ features: [matched] });
  } else if (targetPoint) {
    const matched = marketFeatures.find(f => pointInGeometry(targetPoint, f.geometry));
    if (matched) onMarketClick({ features: [matched] });
  }

  map.on('mousemove',  'aptus-market-fills', onMarketMove);
  map.on('mouseleave', 'aptus-market-fills', onMarketLeave);

  return function () {
    _marketClickHandler = null;
    map.off('mousemove',  'aptus-market-fills', onMarketMove);
    map.off('mouseleave', 'aptus-market-fills', onMarketLeave);
    clearMarketHover();
    setActiveMarket(map, null);
    currentMarketFeatureIds = [];
    if (map.getLayer('aptus-market-hover-fill')) map.removeLayer('aptus-market-hover-fill');
    if (map.getLayer('aptus-market-border'))     map.removeLayer('aptus-market-border');
    if (map.getLayer('aptus-market-fills'))      map.removeLayer('aptus-market-fills');
    if (map.getSource('aptus-markets'))          map.removeSource('aptus-markets');
  };
}

// ── Place level ───────────────────────────────────────────────────────────────
async function enterPlaceLevel(map, stateFips, marketFeature) {
  setActiveMarket(map, marketFeature.id);
  activePlaceMarketFeature = marketFeature;

  // Query Mapbox place_label source for named places and communities inside
  // this market area. Legal boundary files below add CDPs/townships even when
  // Mapbox does not expose a prominent city/town label.
  const seen   = new Set();
  const places = map.querySourceFeatures(MAPBOX_PLACE_LABEL_SOURCE, {
    sourceLayer: MAPBOX_PLACE_LABEL_LAYER
  })
    .filter(f => f.geometry && f.geometry.type === 'Point' && f.properties.name)
    .filter(f => ['city', 'town', 'village', 'locality', 'hamlet'].includes(f.properties.type))
    .filter(f => {
      const rank = Number(f.properties.filterrank || f.properties.symbolrank || 9);
      return ['city', 'town'].includes(f.properties.type) ? rank <= 5 : rank <= 8;
    })
    .filter(f => {
      const key = normalizePlaceName(f.properties.name);
      if (!key || seen.has(key)) return false;
      if (!pointInGeometry(f.geometry.coordinates, marketFeature.geometry)) return false;
      seen.add(key);
      return true;
    })
    .map(f => ({
      type: 'Feature',
      geometry: f.geometry,
      properties: {
        name: f.properties.name,
        mapboxType: f.properties.type,
        symbolrank: f.properties.symbolrank || 12
      }
    }));

  const placeBoundaries = await fetchPlaceBoundaries(stateFips);
  const { boundaryFeatures: placeBoundaryFeatures, hitTargets: placeLabelFeatures } =
    buildPlaceLevelFeatures(places, placeBoundaries, marketFeature);

  if (map.getLayer('aptus-place-dots')) map.removeLayer('aptus-place-dots');
  if (map.getLayer('aptus-place-boundary-hit-fills')) map.removeLayer('aptus-place-boundary-hit-fills');
  if (map.getSource('aptus-place-hit-targets')) map.removeSource('aptus-place-hit-targets');
  if (map.getLayer('aptus-place-selection-border')) map.removeLayer('aptus-place-selection-border');
  if (map.getLayer('aptus-place-selection-fill')) map.removeLayer('aptus-place-selection-fill');
  if (map.getSource('aptus-place-boundaries')) map.removeSource('aptus-place-boundaries');

  map.addSource('aptus-place-hit-targets', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: placeLabelFeatures }
  });

  map.addSource('aptus-place-boundaries', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: placeBoundaryFeatures }
  });
  currentPlaceBoundaryFeatures = placeBoundaryFeatures;
  setActivePlace(map, null);

  const _pBeforeWater = map.getLayer('water') ? 'water' : undefined;

  map.addLayer({
    id: 'aptus-place-selection-fill',
    type: 'fill',
    source: 'aptus-place-boundaries',
    paint: {
      'fill-color': '#8b7355',
      'fill-opacity': 0,
      'fill-opacity-transition': { duration: 180, delay: 0 }
    }
  }, _pBeforeWater);

  map.addLayer({
    id: 'aptus-place-selection-border',
    type: 'line',
    source: 'aptus-place-boundaries',
    paint: {
      'line-color': '#1f1b18',
      'line-width': 1.6,
      'line-opacity': [
        'case',
        ['boolean', ['feature-state', 'active'], false],
        0.7,
        0
      ],
      'line-opacity-transition': { duration: 180, delay: 0 }
    }
  });

  map.addLayer({
    id: 'aptus-place-boundary-hit-fills',
    type: 'fill',
    source: 'aptus-place-boundaries',
    paint: { 'fill-color': 'rgba(0,0,0,0)', 'fill-opacity': 1 }
  });

  map.addLayer({
    id: 'aptus-place-dots',
    type: 'circle',
    source: 'aptus-place-hit-targets',
    paint: {
      'circle-radius':  18,
      'circle-color':   '#000000',
      'circle-opacity': 0,
    }
  });

  map.on('click',      'aptus-place-boundary-hit-fills', onPlaceClick);
  map.on('mousemove',  'aptus-place-boundary-hit-fills', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'aptus-place-boundary-hit-fills', () => { map.getCanvas().style.cursor = ''; });
  map.on('click',      'aptus-place-dots',   onPlaceClick);
  map.on('mousemove',  'aptus-place-dots',   () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'aptus-place-dots',   () => { map.getCanvas().style.cursor = ''; });
}

function onPlaceClick(e) {
  if (!e.features || !e.features.length) return;
  if (getCurrentDepth() < 3) return;

  const feature  = e.features[0];
  const cityName = feature.properties.name;
  const placeId  = Number(feature.properties.placeId) || null;
  const point = e.lngLat
    ? [e.lngLat.lng, e.lngLat.lat]
    : (feature.geometry.type === 'Point' ? feature.geometry.coordinates : getFeatureAnchorPoint(feature));
  if (!point) return;
  const [lng, lat] = point;
  const mapWidth = _map.getContainer().clientWidth;
  const leftPad  = Math.max(140, Math.round(mapWidth * 0.48));
  const selectedBoundary = currentPlaceBoundaryFeatures.find((placeFeature) =>
    (placeId && placeFeature.id === placeId) ||
    normalizePlaceName(placeFeature.properties.name) === normalizePlaceName(cityName)
  ) || null;

  if (navStack.length > 3 && navStack[navStack.length - 1].label === cityName) return;

  while (navStack.length > 3) {
    const top = navStack[navStack.length - 1];
    if (top.cleanup) top.cleanup();
    navStack.pop();
  }
  navStack.push({
    label: cityName,
    bounds: selectedBoundary ? getFeatureBounds(selectedBoundary) : null,
    feature: selectedBoundary,
    cleanup: () => {
      clearNeighborhoodLevel(_map);
      clearPlaceSelection(_map);
    }
  });
  renderBreadcrumb();
  updatePanelForCity(cityName, activeRegionName, selectedBoundary?.properties?.boundaryType);

  setActivePlace(_map, selectedBoundary?.id ?? null);
  if (selectedBoundary) setFocusMask(_map, selectedBoundary, 0.70);

  const degsPerPx = 360 / (256 * Math.pow(2, 11));
  const lngShift  = (leftPad * 0.3) * degsPerPx;
  _map.flyTo({ center: [lng - lngShift, lat], zoom: 11, duration: 900, essential: true });
  _map.once('moveend', () => {
    if (selectedBoundary && selectedBoundary.properties.boundarySource !== 'approximate' && getCurrentDepth() >= 4) {
      enterNeighborhoodLevel(_map, selectedBoundary, cityName);
    }
  });
}

function clearNeighborhoodLevel(map) {
  if (!map) return;
  setActiveNeighborhood(map, null);
  if (map.getLayer('aptus-neighborhood-fills')) {
    if (_neighborhoodMoveHandler) map.off('mousemove', 'aptus-neighborhood-fills', _neighborhoodMoveHandler);
    if (_neighborhoodLeaveHandler) map.off('mouseleave', 'aptus-neighborhood-fills', _neighborhoodLeaveHandler);
    if (_neighborhoodClickHandler) map.off('click', 'aptus-neighborhood-fills', _neighborhoodClickHandler);
  }
  _neighborhoodMoveHandler = null;
  _neighborhoodLeaveHandler = null;
  _neighborhoodClickHandler = null;
  if (map.getLayer('aptus-neighborhood-hover-fill')) map.removeLayer('aptus-neighborhood-hover-fill');
  if (map.getLayer('aptus-neighborhood-active-border')) map.removeLayer('aptus-neighborhood-active-border');
  if (map.getLayer('aptus-neighborhood-border')) map.removeLayer('aptus-neighborhood-border');
  if (map.getLayer('aptus-neighborhood-fills')) map.removeLayer('aptus-neighborhood-fills');
  if (map.getSource('aptus-neighborhood-boundaries')) map.removeSource('aptus-neighborhood-boundaries');
  currentNeighborhoodBoundaryFeatures = [];
  currentNeighborhoodLoadKey = null;
}

async function enterNeighborhoodLevel(map, cityFeature, cityName) {
  clearNeighborhoodLevel(map);

  const placeGeoid = getCityBoundaryGeoid(cityFeature);
  const stateFips = placeGeoid.slice(0, 2);
  const loadKey = `${stateFips}:${placeGeoid}:${Date.now()}`;
  currentNeighborhoodLoadKey = loadKey;

  let legalNeighborhoods = [];
  try {
    legalNeighborhoods = await fetchNeighborhoodBoundaries(stateFips, placeGeoid);
  } catch (_) {
    legalNeighborhoods = [];
  }
  if (currentNeighborhoodLoadKey !== loadKey || getCurrentDepth() < 4) return;

  const legalNeighborhoodFeatures = buildLegalNeighborhoodBoundaries(legalNeighborhoods, cityFeature);
  const neighborhoodFeatures = legalNeighborhoodFeatures.length
    ? legalNeighborhoodFeatures
    : buildGeneratedNeighborhoodBoundaries(map, cityFeature);

  if (!neighborhoodFeatures.length) return;

  map.addSource('aptus-neighborhood-boundaries', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: neighborhoodFeatures }
  });
  currentNeighborhoodBoundaryFeatures = neighborhoodFeatures;
  setActiveNeighborhood(map, null);

  const _beforeWater = map.getLayer('water') ? 'water' : undefined;
  map.addLayer({
    id: 'aptus-neighborhood-hover-fill',
    type: 'fill',
    source: 'aptus-neighborhood-boundaries',
    paint: {
      'fill-color': '#8b7355',
      'fill-opacity': [
        'case',
        ['boolean', ['feature-state', 'active'], false],
        0.12,
        ['boolean', ['feature-state', 'hover'], false],
        0.10,
        0
      ],
      'fill-opacity-transition': { duration: 140, delay: 0 }
    }
  }, _beforeWater);

  map.addLayer({
    id: 'aptus-neighborhood-fills',
    type: 'fill',
    source: 'aptus-neighborhood-boundaries',
    paint: { 'fill-color': 'rgba(0,0,0,0)', 'fill-opacity': 1 }
  });

  map.addLayer({
    id: 'aptus-neighborhood-border',
    type: 'line',
    source: 'aptus-neighborhood-boundaries',
    paint: {
      'line-color': '#1f1b18',
      'line-width': 0.7,
      'line-opacity': 0.26
    }
  });

  map.addLayer({
    id: 'aptus-neighborhood-active-border',
    type: 'line',
    source: 'aptus-neighborhood-boundaries',
    paint: {
      'line-color': '#1f1b18',
      'line-width': [
        'case',
        ['boolean', ['feature-state', 'active'], false],
        1.8,
        ['boolean', ['feature-state', 'hover'], false],
        1.3,
        0
      ],
      'line-opacity': [
        'case',
        ['any',
          ['boolean', ['feature-state', 'active'], false],
          ['boolean', ['feature-state', 'hover'], false]
        ],
        0.72,
        0
      ],
      'line-opacity-transition': { duration: 140, delay: 0 }
    }
  });

  let hoveredNeighborhoodId = null;
  function setNeighborhoodHover(id) {
    if (hoveredNeighborhoodId === id) return;
    if (hoveredNeighborhoodId !== null) {
      map.setFeatureState(
        { source: 'aptus-neighborhood-boundaries', id: hoveredNeighborhoodId },
        { hover: false }
      );
    }
    hoveredNeighborhoodId = id;
    if (id !== null) {
      map.setFeatureState(
        { source: 'aptus-neighborhood-boundaries', id },
        { hover: true }
      );
    }
  }

  _neighborhoodMoveHandler = (e) => {
    if (!e.features || !e.features.length || getCurrentDepth() < 4) return;
    map.getCanvas().style.cursor = 'pointer';
    setNeighborhoodHover(e.features[0].id);
  };

  _neighborhoodLeaveHandler = () => {
    map.getCanvas().style.cursor = '';
    setNeighborhoodHover(null);
  };

  _neighborhoodClickHandler = (e) => {
    if (!e.features || !e.features.length || getCurrentDepth() < 4) return;
    const feature = neighborhoodFeatures.find(f => f.id === e.features[0].id);
    if (!feature) return;

    while (navStack.length > 4) {
      const top = navStack.pop();
      if (top.cleanup) top.cleanup();
    }

    setActiveNeighborhood(map, feature.id);
    setFocusMask(map, feature, 0.72);
    const bounds = getFeatureBounds(feature);
    navStack.push({
      label: feature.properties.name,
      bounds,
      feature,
      parentCity: cityName,
      cleanup: () => {
        setActiveNeighborhood(map, null);
        setFocusMask(map, cityFeature, 0.70);
      }
    });
    renderBreadcrumb();
    updatePanelForNeighborhood(
      feature.properties.name,
      cityName,
      activeRegionName,
      feature.properties.boundarySource
    );

    const mapWidth = map.getContainer().clientWidth;
    const leftPadding = Math.max(140, Math.round(mapWidth * 0.48));
    map.fitBounds(bounds, {
      padding: { top: 80, right: 60, bottom: 80, left: leftPadding },
      duration: 900,
      essential: true,
      maxZoom: 14
    });
  };

  map.on('mousemove', 'aptus-neighborhood-fills', _neighborhoodMoveHandler);
  map.on('mouseleave', 'aptus-neighborhood-fills', _neighborhoodLeaveHandler);
  map.on('click', 'aptus-neighborhood-fills', _neighborhoodClickHandler);
}

function enterPlaceLevel_cleanup(map) {
  clearPlaceSelection(map, null);
  if (map.getLayer('aptus-place-dots')) map.off('click', 'aptus-place-dots', onPlaceClick);
  if (map.getLayer('aptus-place-boundary-hit-fills')) map.off('click', 'aptus-place-boundary-hit-fills', onPlaceClick);
  if (map.getLayer('aptus-place-selection-border')) map.removeLayer('aptus-place-selection-border');
  if (map.getLayer('aptus-place-selection-fill')) map.removeLayer('aptus-place-selection-fill');
  if (map.getLayer('aptus-place-boundary-hit-fills')) map.removeLayer('aptus-place-boundary-hit-fills');
  if (map.getLayer('aptus-place-dots'))    map.removeLayer('aptus-place-dots');
  if (map.getSource('aptus-place-boundaries')) map.removeSource('aptus-place-boundaries');
  if (map.getSource('aptus-place-hit-targets')) map.removeSource('aptus-place-hit-targets');
  currentPlaceBoundaryFeatures = [];
  activePlaceMarketFeature = null;
  if (map.getLayer('aptus-market-fills')) setActiveMarket(map, null);
}

// ── Search ────────────────────────────────────────────────────────────────────
async function geocodeAndNavigate(query) {
  if (!query.trim()) return;
  const url = `${MAPBOX_GEOCODING_ENDPOINT}/${encodeURIComponent(query)}.json` +
    `?country=US&access_token=${mapboxgl.accessToken}` +
    `&types=place,locality,district,region,neighborhood&limit=1`;
  const resp = await fetch(url);
  const data = await resp.json();
  if (!data.features || !data.features.length) return null;
  return data.features[0];
}

async function navigateToSearchResult(map, result) {
  if (!result) return;

  const [lng, lat]  = result.center;
  const placeType   = result.place_type[0];
  const context     = result.context || [];
  const stateCtx    = context.find(c => c.id.startsWith('region.'));
  const stateName   = placeType === 'region'
    ? result.text
    : (stateCtx ? stateCtx.text : null);

  const regionEntry = stateName
    ? Object.entries(REGION_STATES).find(([, states]) => states.includes(stateName))
    : null;
  const regionName      = regionEntry ? regionEntry[0] : null;
  const regionFeatureId = regionName
    ? [...regionFeaturesById.entries()].find(([, f]) => f.properties.region === regionName)?.[0]
    : null;

  if (placeType === 'region' && stateName && regionFeatureId) {
    setActiveRegion(map, regionFeatureId);
    setStateLabelFilter(regionName);
    setFocusMask(map, regionFeaturesById.get(regionFeatureId));

    const stateFeature = stateFeaturesMap.get(stateName);
    if (!stateFeature) return;
    const bounds    = getFeatureBounds(stateFeature);
    const mapWidth  = map.getContainer().clientWidth;
    const leftPad   = Math.max(140, Math.round(mapWidth * 0.48));
    const stateFips = stateFeature.properties.fips;

    while (navStack.length > 1) { const t = navStack.pop(); if (t.cleanup) t.cleanup(); }
    navStack.push({
      label: stateName,
      cleanup: () => { if (cleanupMarketLevel) { cleanupMarketLevel(); cleanupMarketLevel = null; } }
    });

    setActiveState(map, stateFeatureIdsByName.get(stateName));
    setStateLabelFilter(regionName, stateName);
    setFocusMask(map, stateFeature);
    renderBreadcrumb();
    updatePanelForState(stateName, regionName);

    regionZoomInProgress = true;
    map.fitBounds(bounds, {
      padding: { top: 80, right: 60, bottom: 80, left: leftPad },
      duration: 1100, essential: true, maxZoom: 9
    });
    map.once('moveend', async () => {
      regionZoomInProgress = false;
      cleanupMarketLevel = await enterMarketLevel(map, stateFips, stateName, bounds);
    });

  } else if (['district', 'place', 'locality', 'neighborhood'].includes(placeType) && regionFeatureId) {
    setActiveRegion(map, regionFeatureId);
    setFocusMask(map, regionFeaturesById.get(regionFeatureId));

    const stateFeature = stateName ? stateFeaturesMap.get(stateName) : null;
    if (stateFeature) {
      const stateFips   = stateFeature.properties.fips;
      const stateBounds = getFeatureBounds(stateFeature);
      const mapWidth    = map.getContainer().clientWidth;
      const leftPad     = Math.max(140, Math.round(mapWidth * 0.48));

      while (navStack.length > 1) { const t = navStack.pop(); if (t.cleanup) t.cleanup(); }
      navStack.push({
        label: stateName,
        cleanup: () => { if (cleanupMarketLevel) { cleanupMarketLevel(); cleanupMarketLevel = null; } }
      });

      setActiveState(map, stateFeatureIdsByName.get(stateName));
      setStateLabelFilter(regionName, stateName);
      setFocusMask(map, stateFeature);
      renderBreadcrumb();
      updatePanelForState(stateName, regionName);

      regionZoomInProgress = true;

      const degsPerPx = 360 / (256 * Math.pow(2, 9));
      const lngShift  = (leftPad / 2) * degsPerPx;
      map.flyTo({ center: [lng - lngShift, lat], zoom: 9, duration: 1300, essential: true });
      map.once('moveend', async () => {
        regionZoomInProgress = false;
        cleanupMarketLevel = await enterMarketLevel(map, stateFips, stateName, stateBounds, [lng, lat]);
      });
    }
  }
}

// ── Map initialisation ────────────────────────────────────────────────────────
function initMap(onReady = null) {
  if (mapHasBeenInitialized) {
    if (onReady && _map) onReady(_map);
    return;
  }
  mapHasBeenInitialized = true;

  document.getElementById('hero-ui').classList.add('hidden');

  window.setTimeout(() => {
    const panel = document.getElementById('market-panel');
    const inner = document.getElementById('panel-inner');
    if (panel) {
      panel.classList.add('visible');
      window.setTimeout(() => {
        if (inner) inner.classList.add('fade-in');
      }, 250);
    }
  }, 300);

  const mapElement = document.getElementById('map');
  const revealMap  = () => {
    window.setTimeout(() => { mapElement.classList.add('visible'); }, 180);
  };

  const map = new mapboxgl.Map({
    container:  'map',
    style:      MAPBOX_STREETS_STYLE,
    center:     DEFAULT_VIEW.center,
    zoom:       DEFAULT_VIEW.zoom,
    minZoom:    3.25,
    maxZoom:    18,
    projection: 'mercator'
  });

  map.on('load', async () => {
    try {

      // ── Region + state sources ────────────────────────────────────────────
      const mapData = await buildMapData();

      const regionsGeoJson = mapData.regions;
      regionsGeoJson.features = regionsGeoJson.features.map((feature, index) => ({
        ...feature, id: index + 1
      }));
      regionFeaturesById.clear();
      regionsGeoJson.features.forEach(feature => regionFeaturesById.set(feature.id, feature));
      map.addSource('aptus-regions', { type: 'geojson', data: regionsGeoJson });

      const statesGeoJson = {
        type: 'FeatureCollection',
        features: mapData.states.map((f, i) => ({ ...f, id: i + 1 }))
      };
      stateFeatureIdsByName.clear();
      statesGeoJson.features.forEach(feature =>
        stateFeatureIdsByName.set(feature.properties.name, feature.id));
      map.addSource('aptus-states', { type: 'geojson', data: statesGeoJson });

      // Populate stateFeaturesMap so state click → bounds lookup works.
      buildStateLabels(map, mapData.states);

      // Buffered state geometries used only for the visual hover fill.
      // Hit-detection and feature-state lookups remain on aptus-states so that
      // pointer events don't fire over ocean areas.
      const statesVisualGeoJson = {
        type: 'FeatureCollection',
        features: mapData.statesVisual.map((f, i) => ({ ...f, id: i + 1 }))
      };
      map.addSource('aptus-states-visual', { type: 'geojson', data: statesVisualGeoJson });

      // ── Transparent hit-target fills ──────────────────────────────────────
      map.addLayer({
        id: 'aptus-region-fills',
        type: 'fill',
        source: 'aptus-regions',
        paint: { 'fill-color': 'rgba(0,0,0,0)', 'fill-opacity': 1 }
      });

      // ── Region hover / dim / border layers ───────────────────────────────
      // All fill layers are inserted BEFORE the Mapbox 'water' layer so that
      // water paints over every coastal edge — eliminating geometry mismatch.
      const _beforeWater = map.getLayer('water') ? 'water' : undefined;

      // World-covering dim fill — a single rectangle with no GeoJSON coastal
      // boundary. Water sits on top and defines every shoreline perfectly.
      // Opacity is driven by setPaintProperty (not feature-state) since it
      // applies globally whenever any region is hovered.
      map.addSource('aptus-world-dim', {
        type: 'geojson',
        data: {
          type: 'Feature', properties: {},
          geometry: { type: 'Polygon', coordinates: [FOCUS_MASK_WORLD_RING] }
        }
      });
      map.addLayer({
        id: 'aptus-world-dim-fill',
        type: 'fill',
        source: 'aptus-world-dim',
        paint: {
          'fill-color': '#f0ede8',
          'fill-opacity': 0,
          'fill-opacity-transition': { duration: 150, delay: 0 }
        }
      }, _beforeWater);

      // Dark dim applied to non-hovered states on hover. Uses the buffered
      // visual source so the fill always reaches the real coastline — water
      // paints on top and clips the ocean portion perfectly.
      map.addLayer({
        id: 'aptus-region-hover-fill',
        type: 'fill',
        source: 'aptus-states-visual',
        filter: ['==', ['get', 'name'], ''],   // nothing visible until hover
        paint: {
          'fill-color': '#8b7355',
          'fill-opacity': 0,
          'fill-opacity-transition': { duration: 150, delay: 0 }
        }
      }, _beforeWater);

      // Region boundary lines drawn from the region polygon outlines.
      // Rendered ABOVE the water layer so the line is always fully visible —
      // no gaps, no uneven weight — regardless of how the simplified polygon
      // edge aligns with Mapbox's precise coastline tiles.
      // Width and opacity are driven by setPaintProperty for reliable transitions.
      map.addLayer({
        id: 'aptus-region-border',
        type: 'line',
        source: 'aptus-regions',
        paint: {
          'line-color': '#1f1b18',
          'line-width': 0.75,
          'line-width-transition':   { duration: 150, delay: 0 },
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.20, 7.5, 0],
          'line-opacity-transition': { duration: 150, delay: 0 }
        }
      });

      map.addLayer({
        id: 'aptus-state-fills',
        type: 'fill',
        source: 'aptus-states',
        paint: { 'fill-color': 'rgba(0,0,0,0)', 'fill-opacity': 1 }
      });

      // ── State hover layers ────────────────────────────────────────────────
      // Mirrors the region hover pattern but one level deeper.

      // Dim overlay on every state in the active region EXCEPT the hovered one.
      // Uses the buffered visual source so the fill reaches every coastline.
      // Filter and opacity are driven by setPaintProperty / setFilter.
      map.addLayer({
        id: 'aptus-state-hover-fill',
        type: 'fill',
        source: 'aptus-states-visual',
        filter: ['==', ['get', 'name'], ''],   // hidden until a state is hovered
        paint: {
          'fill-color': '#8b7355',
          'fill-opacity': 0,
          'fill-opacity-transition': { duration: 150, delay: 0 }
        }
      }, _beforeWater);

      // Hovered state border — rendered above water so it is always fully
      // visible regardless of the simplified polygon's coastal alignment.
      map.addLayer({
        id: 'aptus-state-border',
        type: 'line',
        source: 'aptus-states',
        filter: ['==', ['get', 'name'], ''],   // hidden until a state is hovered
        paint: {
          'line-color': '#1f1b18',
          'line-width': 1.5,
          'line-opacity': 0,
          'line-opacity-transition': { duration: 150, delay: 0 }
        }
      });

      // ── Focus mask — dual-slot crossfade system ───────────────────────────
      // Also inserted before water so coastal edges are clean.
      map.addSource('aptus-focus-mask-a', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: 'aptus-focus-mask-a', type: 'fill', source: 'aptus-focus-mask-a',
        paint: {
          'fill-color': 'rgba(255,255,255,0.55)',
          'fill-opacity': 0,
          'fill-opacity-transition': { duration: 350, delay: 0 }
        }
      }, _beforeWater);
      map.addSource('aptus-focus-mask-b', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: 'aptus-focus-mask-b', type: 'fill', source: 'aptus-focus-mask-b',
        paint: {
          'fill-color': 'rgba(255,255,255,0.55)',
          'fill-opacity': 0,
          'fill-opacity-transition': { duration: 350, delay: 0 }
        }
      }, _beforeWater);

      // ── Interaction helpers ───────────────────────────────────────────────
      function inStateMode() { return activeRegionId !== null; }

      let hoveredRegionId  = null;
      let hoveredStateId   = null;
      let hoveredStateName = null;

      // ── State hover helpers ───────────────────────────────────────────────
      function applyStateHoverState(stateName) {
        // World dim adds the same ocean tint as region hover.
        map.setPaintProperty('aptus-world-dim-fill', 'fill-opacity', stateName ? 0.42 : 0);

        // Warm tint applied to the HOVERED state only (positive filter).
        if (stateName) {
          map.setFilter('aptus-state-hover-fill', ['==', ['get', 'name'], stateName]);
        }
        map.setPaintProperty('aptus-state-hover-fill', 'fill-opacity', stateName ? 0.10 : 0);

        // Highlight the hovered state's border.
        if (stateName) {
          map.setFilter('aptus-state-border', ['==', ['get', 'name'], stateName]);
        }
        map.setPaintProperty('aptus-state-border', 'line-opacity', stateName ? 0.55 : 0);
      }

      function clearStateHover() {
        if (hoveredStateName !== null) applyStateHoverState(null);
        hoveredStateId   = null;
        hoveredStateName = null;
        map.getCanvas().style.cursor = '';
      }

      // ── Region hover helpers ──────────────────────────────────────────────
      function applyRegionHoverState(activeId) {
        // World dim adds a subtle ocean tint (rectangle = no coastal polygon issues).
        map.setPaintProperty('aptus-world-dim-fill', 'fill-opacity', activeId !== null ? 0.42 : 0);

        // Region feature-states drive border width/opacity only.
        regionFeaturesById.forEach((_, featureId) => {
          map.setFeatureState(
            { source: 'aptus-regions', id: featureId },
            { hover: featureId === activeId }
          );
        });

        // Warm tint applied to the HOVERED region's states — positive filter,
        // low opacity so the map detail shows through.
        const regionName   = activeId !== null ? regionFeaturesById.get(activeId)?.properties?.region : null;
        const hoveredNames = regionName ? (REGION_STATES[regionName] || []) : [];
        if (activeId !== null && hoveredNames.length) {
          map.setFilter('aptus-region-hover-fill',
            ['in', ['get', 'name'], ['literal', hoveredNames]]);
        }
        map.setPaintProperty('aptus-region-hover-fill', 'fill-opacity', activeId !== null ? 0.10 : 0);

        // Border: thicken and brighten on hover via setPaintProperty.
        const hovered = activeId !== null;
        map.setPaintProperty('aptus-region-border', 'line-width', hovered ? 1.5 : 0.75);
        map.setPaintProperty('aptus-region-border', 'line-opacity',
          ['interpolate', ['linear'], ['zoom'], 5, hovered ? 0.45 : 0.20, 7.5, 0]);
      }

      // ── Mouse events ──────────────────────────────────────────────────────
      map.on('mousemove', 'aptus-region-fills', (event) => {
        if (!event.features || !event.features.length) return;
        if (inStateMode()) return;
        const newId = event.features[0].id;
        if (newId === hoveredRegionId) return;   // no change, skip the work
        hoveredRegionId = newId;
        map.getCanvas().style.cursor = 'pointer';
        applyRegionHoverState(newId);
      });

      map.on('mouseleave', 'aptus-region-fills', () => {
        if (inStateMode()) return;
        if (hoveredRegionId === null) return;
        map.getCanvas().style.cursor = '';
        hoveredRegionId = null;
        applyRegionHoverState(null);
      });

      map.on('mousemove', 'aptus-state-fills', (event) => {
        if (!event.features || !event.features.length) return;
        if (!inStateMode()) return;
        if (getCurrentDepth() !== 1) { clearStateHover(); return; }
        const feature  = event.features[0];
        if (activeRegionName && feature.properties.region !== activeRegionName) {
          clearStateHover(); return;
        }
        const newName = feature.properties.name;
        if (newName === hoveredStateName) return;   // no change, skip the work
        hoveredStateId   = feature.id;
        hoveredStateName = newName;
        map.getCanvas().style.cursor = 'pointer';
        applyStateHoverState(newName);
      });

      map.on('mouseleave', 'aptus-state-fills', () => {
        if (!inStateMode()) return;
        clearStateHover();
      });

      // ── Unified click handler ─────────────────────────────────────────────
      map.on('click', 'aptus-region-fills', async (event) => {
        if (!event.features || !event.features.length) return;
        const currentDepth = getCurrentDepth();

        if (currentDepth === 2 && map.getLayer('aptus-market-fills')) {
          const marketHits = map.queryRenderedFeatures(event.point, { layers: ['aptus-market-fills'] });
          if (marketHits.length) {
            if (typeof _marketClickHandler === 'function')
              _marketClickHandler({ features: marketHits, point: event.point });
            return;
          }
        }

        if (currentDepth === 1 && inStateMode()) {
          const stateHits = map.queryRenderedFeatures(event.point, { layers: ['aptus-state-fills'] });
          const stateFeature = stateHits[0];
          if (stateFeature && (!activeRegionName || stateFeature.properties.region === activeRegionName)) {

            const stateFips        = stateFeature.properties.fips;
            const stateName        = stateFeature.properties.name;
            const fullStateFeature = stateFeaturesMap.get(stateName);
            if (!fullStateFeature) return;
            const bounds = getFeatureBounds(fullStateFeature);

            while (navStack.length > 1) {
              const top = navStack[navStack.length - 1];
              if (top.cleanup) top.cleanup();
              navStack.pop();
            }
            navStack.push({
              label:   stateName,
              key:     stateFips,
              cleanup: () => { if (cleanupMarketLevel) { cleanupMarketLevel(); cleanupMarketLevel = null; } }
            });

            setActiveState(map, stateFeature.id);
            setStateLabelFilter(activeRegionName, stateName);
            setFocusMask(map, fullStateFeature);
            clearStateHover();
            renderBreadcrumb();
            updatePanelForState(stateName, activeRegionName);

            const mapWidth  = map.getContainer().clientWidth;
            const leftPadPx = Math.max(140, Math.round(mapWidth * 0.48));
            map.stop();
            regionZoomInProgress = true;
            map.fitBounds(bounds, {
              padding:   { top: 80, right: 60, bottom: 80, left: leftPadPx },
              duration:  1100, essential: true, maxZoom: 9,
            });
            map.once('moveend', async () => {
              regionZoomInProgress = false;
              cleanupMarketLevel = await enterMarketLevel(map, stateFips, stateName, bounds);
            });
            return;
          }
        }

        // Region click / region switch
        const clickedRegionId = event.features[0].id;
        const regionFeature   = regionFeaturesById.get(clickedRegionId);
        if (!regionFeature) return;
        if (currentDepth >= 3 && regionFeature.properties.region === activeRegionName) return;
        focusRegionFromFeature(map, clickedRegionId, regionFeature);
      });

      _map = map;
      addRegionLabels(map);

      revealMap();
      if (onReady) onReady(map);

    } catch (error) {
      console.error('Failed to build Avenue region overlays.', error);
      revealMap();
    }
  });
}

// ── Top-level event wiring ────────────────────────────────────────────────────
document.getElementById('help-btn').addEventListener('click', () => initMap());

const searchInput = document.querySelector('.search-input');

async function handleSearch() {
  const query = searchInput.value.trim();
  if (!query) return;
  const result = await geocodeAndNavigate(query);
  initMap(async (map) => {
    await navigateToSearchResult(map, result);
  });
}

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleSearch();
});

document.getElementById('search-btn')?.addEventListener('click', handleSearch);

const searchBtn = document.getElementById('search-btn');
if (searchBtn) {
  searchInput.addEventListener('input', () => {
    searchBtn.style.opacity = searchInput.value.trim() ? '1' : '0.5';
  });
}
