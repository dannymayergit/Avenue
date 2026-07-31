// ── aptus-labels.js ──────────────────────────────────────────────────────────
// Map overlays: region labels, state labels, focus mask (crossfade system),
// and breadcrumb navigation.
//
// Dependencies: aptus-config.js, aptus-state.js, aptus-geometry.js

// ── State feature map (name → full GeoJSON feature) ───────────────────────────
// Populated by buildStateFeatureMap(); consumed by click handlers and search.
// No map layer is created — streets-v12 provides state/county labels natively.
const stateFeaturesMap = new Map();

// ── Region labels ─────────────────────────────────────────────────────────────
function addRegionLabels(map) {
  const points = Object.entries(REGION_LABEL_POSITIONS).map(([region, coords]) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: coords },
    properties: { region }
  }));

  map.addSource('aptus-region-labels', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: points }
  });

  map.addLayer({
    id: 'aptus-region-labels',
    type: 'symbol',
    source: 'aptus-region-labels',
    maxzoom: 5.3,
    layout: {
      'text-field':            ['get', 'region'],
      'text-font':             ['Playfair Display Italic', 'Arial Unicode MS Regular'],
      'text-size':             26,
      'text-allow-overlap':    true,
      'text-ignore-placement': true,
    },
    paint: {
      'text-color':      '#1f1b18',
      'text-opacity':    ['interpolate', ['linear'], ['zoom'], 4.8, 1, 5.3, 0],
      'text-halo-color': 'rgba(240,237,232,0.9)',
      'text-halo-width': 3,
    }
  });
}

// ── State feature map population ──────────────────────────────────────────────
// Replaces buildStateLabels — keeps stateFeaturesMap populated for navigation
// without adding any label layer to the map.
function buildStateLabels(map, stateFeatures) {
  stateFeatures.forEach(feature => {
    stateFeaturesMap.set(feature.properties.name, feature);
  });
}

// setStateLabelFilter is a no-op now that streets-v12 handles all state/county
// labels. Call sites are preserved for compatibility.
function setStateLabelFilter() {}
function showRegionStateLabels() {}
function hideRegionStateLabels() {}

// ── Focus mask (crossfade dual-slot system) ───────────────────────────────────
function buildFocusMaskFeature(feature) {
  if (!feature?.geometry) return null;

  const holes = feature.geometry.type === 'Polygon'
    ? [feature.geometry.coordinates[0]]
    : (feature.geometry.type === 'MultiPolygon'
        ? feature.geometry.coordinates.map((polygon) => polygon[0])
        : []);

  if (!holes.length) return null;

  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'Polygon',
      coordinates: [FOCUS_MASK_WORLD_RING, ...holes]
    }
  };
}

function setFocusMask(map, feature = null) {
  const sourceA = map.getSource('aptus-focus-mask-a');
  const sourceB = map.getSource('aptus-focus-mask-b');
  if (!sourceA || !sourceB) return;

  const maskFeature   = feature ? buildFocusMaskFeature(feature) : null;
  const targetOpacity = maskFeature ? 0.58 : 0;

  // The mask layers have fill-opacity-transition: { duration: 350 } defined on
  // them, so setPaintProperty calls animate automatically — no custom loop needed.

  if (maskFeature) {
    const nextSlot    = activeFocusMaskSlot === 'a' ? 'b' : 'a';
    const currentSlot = activeFocusMaskSlot;
    const nextSource  = nextSlot    === 'a' ? sourceA : sourceB;

    // Load new mask geometry into the idle slot, then fade it in.
    nextSource.setData({ type: 'FeatureCollection', features: [maskFeature] });
    map.setPaintProperty(`aptus-focus-mask-${nextSlot}`, 'fill-opacity', targetOpacity);
    focusMaskOpacityBySlot[nextSlot] = targetOpacity;

    // Fade the outgoing slot to zero, then clear its geometry once invisible.
    map.setPaintProperty(`aptus-focus-mask-${currentSlot}`, 'fill-opacity', 0);
    focusMaskOpacityBySlot[currentSlot] = 0;
    setTimeout(() => {
      const src = map.getSource(`aptus-focus-mask-${currentSlot}`);
      if (src) src.setData({ type: 'FeatureCollection', features: [] });
    }, 420);

    activeFocusMaskSlot = nextSlot;
    return;
  }

  // No feature — clear both slots (e.g. returning to overview).
  ['a', 'b'].forEach(slot => {
    map.setPaintProperty(`aptus-focus-mask-${slot}`, 'fill-opacity', 0);
    focusMaskOpacityBySlot[slot] = 0;
    setTimeout(() => {
      const src = map.getSource(`aptus-focus-mask-${slot}`);
      if (src) src.setData({ type: 'FeatureCollection', features: [] });
    }, 420);
  });
}

// ── Breadcrumb navigation ─────────────────────────────────────────────────────
function renderBreadcrumb() {
  const el = document.getElementById('map-breadcrumb');
  if (navStack.length === 0) {
    el.classList.remove('visible');
    el.innerHTML = '';
    return;
  }
  el.classList.add('visible');
  const items = [
    { label: 'Overview', idx: -1 },
    ...navStack.map((e, i) => ({ label: e.label, idx: i }))
  ];
  el.innerHTML = items.map((item, i) => {
    const isLast = i === items.length - 1;
    const btn = `<button class="breadcrumb-item${isLast ? ' active' : ''}" data-idx="${item.idx}">${item.label}</button>`;
    return i < items.length - 1 ? btn + '<span class="breadcrumb-sep">›</span>' : btn;
  }).join('');
  el.querySelectorAll('.breadcrumb-item:not(.active)').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetIdx = parseInt(btn.dataset.idx);
      if (_map) navigateTo(_map, targetIdx);
    });
  });
}

function navigateTo(map, targetIdx) {
  const currentDepth = navStack.length - 1;
  if (targetIdx === currentDepth) return;

  // Unwind stack to targetIdx + 1
  while (navStack.length > targetIdx + 1) {
    const top = navStack[navStack.length - 1];
    if (top.cleanup) top.cleanup();
    navStack.pop();
  }

  map.getCanvas().style.cursor = '';

  if (targetIdx === -1) {
    setActiveState(map, null);
    setActiveRegion(map, null);
    setFocusMask(map, null);
    regionZoomInProgress = true;
    map.flyTo({ center: DEFAULT_VIEW.center, zoom: DEFAULT_VIEW.zoom, duration: 950, essential: true });
    map.once('moveend', () => {
      regionZoomInProgress = false;
      setStateLabelFilter(null);
    });

  } else if (targetIdx === 0 && activeRegionId !== null) {
    setActiveState(map, null);
    const regionFeature = regionFeaturesById.get(activeRegionId);
    if (regionFeature) {
      setFocusMask(map, regionFeature);
      const mapWidth     = map.getContainer().clientWidth;
      const leftPadding  = Math.max(140, Math.round(mapWidth * 0.48));
      regionZoomInProgress = true;
      map.fitBounds(getFeatureBounds(regionFeature), {
        padding: { top: 64, right: 48, bottom: 64, left: leftPadding },
        duration: 950, essential: true, maxZoom: 6.8
      });
      map.once('moveend', () => {
        regionZoomInProgress = false;
        setStateLabelFilter(activeRegionName);
      });
      updatePanelForRegion(activeRegionName);
    }

  } else if (targetIdx === 4) {
    const entry = navStack[4];
    if (entry && entry.bounds) {
      const mapWidth    = map.getContainer().clientWidth;
      const leftPadding = Math.max(140, Math.round(mapWidth * 0.48));
      if (entry.feature) {
        setActiveNeighborhood(map, entry.feature.id);
        setFocusMask(map, entry.feature);
      }
      updatePanelForNeighborhood(
        entry.label,
        entry.parentCity || navStack[3]?.label || '',
        activeRegionName,
        entry.feature?.properties?.boundarySource
      );
      map.fitBounds(entry.bounds, {
        padding: { top: 80, right: 60, bottom: 80, left: leftPadding },
        duration: 950, essential: true, maxZoom: 15
      });
    }

  } else if (targetIdx === 3) {
    // Back to city from neighbourhood
    const cityEntry = navStack[3];
    if (cityEntry) {
      updatePanelForCity(cityEntry.label, activeRegionName, cityEntry.feature?.properties?.boundaryType);
      if (cityEntry.bounds) {
        const mapWidth    = map.getContainer().clientWidth;
        const leftPadding = Math.max(140, Math.round(mapWidth * 0.48));
        setActiveNeighborhood(map, null);
        if (cityEntry.feature) setFocusMask(map, cityEntry.feature);
        regionZoomInProgress = true;
        map.fitBounds(cityEntry.bounds, {
          padding: { top: 80, right: 60, bottom: 80, left: leftPadding },
          duration: 950, essential: true, maxZoom: 13
        });
        map.once('moveend', () => { regionZoomInProgress = false; });
      }
    }

  } else if (targetIdx === 2) {
    const marketEntry = navStack[2];
    if (marketEntry) {
      updatePanelForMarket(marketEntry.feature?.properties || marketEntry, activeRegionName);
      if (marketEntry.bounds) {
        const mapWidth    = map.getContainer().clientWidth;
        const leftPadding = Math.max(140, Math.round(mapWidth * 0.48));
        if (marketEntry.feature) {
          setActiveMarket(map, marketEntry.feature.id);
          setFocusMask(map, marketEntry.feature);
        }
        map.fitBounds(marketEntry.bounds, {
          padding: { top: 80, right: 60, bottom: 80, left: leftPadding },
          duration: 950, essential: true, maxZoom: 11.3
        });
      }
    }

  } else if (targetIdx === 1) {
    const stateName    = navStack[1].label;
    const stateFeature = stateFeaturesMap.get(stateName);
    if (stateFeature) {
      setActiveState(map, stateFeatureIdsByName.get(stateName) ?? null);
      setStateLabelFilter(activeRegionName, stateName);
      setFocusMask(map, stateFeature);
      updatePanelForState(stateName, activeRegionName);
      const mapWidth    = map.getContainer().clientWidth;
      const leftPadding = Math.max(140, Math.round(mapWidth * 0.48));
      regionZoomInProgress = true;
      map.fitBounds(getFeatureBounds(stateFeature), {
        padding: { top: 80, right: 60, bottom: 80, left: leftPadding },
        duration: 950, essential: true, maxZoom: 9
      });
      map.once('moveend', async () => {
        regionZoomInProgress = false;
        if (!map.getLayer('aptus-market-fills')) {
          const stateFips = stateFeature.properties.fips;
          cleanupMarketLevel = await enterMarketLevel(
            map, stateFips, stateName, getFeatureBounds(stateFeature)
          );
        }
      });
    }
  }

  renderBreadcrumb();
}
