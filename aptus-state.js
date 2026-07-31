// ── aptus-state.js ───────────────────────────────────────────────────────────
// Shared mutable state (runtime variables) and the low-level functions that
// mutate feature-state on the Mapbox map.
//
// Dependencies: aptus-config.js (FOCUS_MASK_WORLD_RING)



// ── Map-indexed lookup caches ────────────────────────────────────────────────
const regionFeaturesById    = new Map();   // featureId → GeoJSON feature
const stateFeatureIdsByName = new Map();   // stateName → featureId

// ── Navigation & drill-down state ────────────────────────────────────────────
// Each entry: { label, key?, bounds?, cleanup? }
// Depth 0 = region, 1 = state, 2 = market area, 3 = city
const navStack = [];

// ── Active selection IDs ─────────────────────────────────────────────────────
let activeRegionId   = null;
let activeRegionName = null;
let activeStateId    = null;
let activeMarketId   = null;
let currentMarketFeatureIds = [];

// ── Map lifecycle flags ───────────────────────────────────────────────────────
let mapHasBeenInitialized = false;
let regionZoomInProgress  = false;
let _map = null;   // set after map loads; used by breadcrumb & label helpers

// ── County-backed market data cache & cleanup handles ────────────────────────
let countyTopologyCache   = null;
let cleanupMarketLevel    = null;
let _marketClickHandler   = null;

// ── Focus-mask slot tracking ─────────────────────────────────────────────────
let activeFocusMaskSlot = 'a';
const focusMaskOpacityBySlot = { a: 0, b: 0 };

// ── Helpers ───────────────────────────────────────────────────────────────────
function getCurrentDepth() {
  return navStack.length;
}

// ── Active-region setter ──────────────────────────────────────────────────────
function setActiveState(map, stateId) {
  activeStateId = stateId;
  stateFeatureIdsByName.forEach((featureId) => {
    map.setFeatureState(
      { source: 'aptus-states', id: featureId },
      { active: featureId === stateId }
    );
  });
}

function setActiveMarket(map, marketId) {
  activeMarketId = marketId;
  currentMarketFeatureIds.forEach((featureId) => {
    map.setFeatureState(
      { source: 'aptus-markets', id: featureId },
      { active: featureId === marketId }
    );
  });
}
