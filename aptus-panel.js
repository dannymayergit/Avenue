// ── aptus-panel.js ──────────────────────────────────────────────────────────
// Market panel UI: tooltip system, render helpers, data objects (region /
// state / market area / city), panel update functions, and animation.
//
// Dependencies: aptus-config.js (none directly — data is self-contained)

  
// ── Portal tooltip system ────────────────────────────────────────────────────
(function() {
  const TOOLTIP_W = 320;
  let hideTimer = null;

  function show(badge) {
    const el = document.getElementById('avenue-tooltip');
    if (!el || !badge.dataset.tip) return;
    clearTimeout(hideTimer);
    el.textContent = badge.dataset.tip;
    el.classList.add('visible');
    requestAnimationFrame(() => {
      const r = badge.getBoundingClientRect();
      const h = el.offsetHeight;
      const idealLeft = r.left + r.width / 2 - TOOLTIP_W / 2;
      const left = Math.max(8, Math.min(idealLeft, window.innerWidth - TOOLTIP_W - 8));
      const top = r.top - h - 10;
      el.style.left = left + 'px';
      el.style.top  = (top < 8 ? r.bottom + 10 : top) + 'px';
      el.style.setProperty('--arrow-left', (r.left + r.width / 2 - left) + 'px');
    });
  }

  function hide() {
    const el = document.getElementById('avenue-tooltip');
    if (el) el.classList.remove('visible');
  }

  document.addEventListener('mouseover', e => {
    const b = e.target.closest('.metric-info[data-tip]');
    if (b) show(b); else { clearTimeout(hideTimer); hideTimer = setTimeout(hide, 80); }
  });
  document.addEventListener('mouseout', e => {
    if (e.target.closest('.metric-info[data-tip]')) { clearTimeout(hideTimer); hideTimer = setTimeout(hide, 80); }
  });
  document.addEventListener('scroll', hide, true);
})();

function positionTooltips() {} // no-op — portal system handles positioning

// ── Market Panel ─────────────────────────────────────────────────────────────

// ── Tooltip helper ────────────────────────────────────────────────────────────
function tip(text) {
  const escaped = String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<span class="metric-info" data-tip="${escaped}">i</span>`;
}

function sourceTip(text, metric) {
  return tip(sourceText(text, metric));
}

function sourceText(metricImportance, metric) {
  const source = metric?.source || 'latest cached region data';
  const detail = describeSource(source);
  const sourceDate = extractSourceDate(source);
  if (detail.fallback) {
    return `${metricImportance} Source release details are not available for this cached value.`;
  }
  return `${metricImportance} This data comes from ${detail.name}, which ${detail.why}. The value shown uses the most recent available ${sourceDate}. The next source update is expected ${detail.next}.`;
}

function describeSource(source) {
  const text = String(source || '').toLowerCase();
  if (text.includes('population estimates')) {
    return {
      name: 'US Census Bureau Population Estimates Program',
      why: 'is the official annual state population and migration series and includes net migration components',
      next: 'late in the year when the next annual vintage is released'
    };
  }
  if (text.includes('acs')) {
    return {
      name: 'US Census Bureau American Community Survey 5-year',
      why: 'is an annual Census report that provides the most complete official state-level household, tenure, income, rent-burden, and workforce detail',
      next: 'in December 2026'
    };
  }
  if (text.includes('bls') || text.includes('laus')) {
    return {
      name: 'Bureau of Labor Statistics Local Area Unemployment Statistics',
      why: 'is the official monthly unemployment series for states and local areas',
      next: 'the following month when the next LAUS release is typically published'
    };
  }
  if (text.includes('price parit') || text.includes('rpp')) {
    return {
      name: 'US Bureau of Economic Analysis Regional Price Parities',
      why: 'is the official regional price-level index for comparing local cost levels with the US average',
      next: 'in December 2026'
    };
  }
  if (text.includes('gdp') || text.includes('bea')) {
    return {
      name: 'US Bureau of Economic Analysis Regional GDP',
      why: 'is the official government measure of state and regional economic output',
      next: 'in June 2026'
    };
  }
  return {
    fallback: true,
    name: 'cached source data',
    why: 'has source release details unavailable',
    next: 'at the next source-specific release'
  };
}

function extractSourceDate(source) {
  const text = String(source || '');
  if (text.toLowerCase().includes('price parit') || text.toLowerCase().includes('rpp')) {
    return '2024, released in February 2026';
  }
  if (text.toLowerCase().includes('gdp')) {
    return '2025, released in April 2026';
  }
  if (text.toLowerCase().includes('american community survey') || text.toLowerCase().includes('acs')) {
    const year = text.match(/\b20\d{2}\b/)?.[0] || '2024';
    return `${year} American Community Survey 5-year release, published in December ${Number(year) + 1}`;
  }
  const monthYear = text.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b/i);
  if (monthYear) return monthYear[0];
  const year = text.match(/\b20\d{2}\b/);
  if (year) return year[0];
  return 'source';
}

// ── Expand/collapse toggle ────────────────────────────────────────────────────
let _regionMetricGridAnimating = false;

function animateRegionMetricGrid(mutator, options = {}) {
  const grid = document.getElementById('region-metric-grid');
  const panel = document.getElementById('market-panel');
  if (!grid) {
    mutator();
    return;
  }

  if (_regionMetricGridAnimating) return;
  _regionMetricGridAnimating = true;

  const activeCard = options.activeCard || null;
  const cards = Array.from(grid.querySelectorAll(':scope > .metric-card'));
  const firstRects = new Map(cards.map(card => [card, card.getBoundingClientRect()]));
  const firstPanelHeight = panel ? panel.getBoundingClientRect().height : null;
  const fadeDuration = activeCard ? 130 : 0;
  const duration = 560;
  const easing = 'cubic-bezier(0.22, 1, 0.36, 1)';

  grid.classList.add('metric-grid-animating');
  if (activeCard) activeCard.classList.add('content-hidden');

  window.setTimeout(() => {
    mutator();

    const lastPanelHeight = panel ? panel.getBoundingClientRect().height : null;

    if (panel && firstPanelHeight && lastPanelHeight && Math.abs(firstPanelHeight - lastPanelHeight) > 1) {
      panel.style.height = `${firstPanelHeight}px`;
      panel.style.overflow = 'hidden';
      panel.style.transition = 'none';
      panel.getBoundingClientRect();
      requestAnimationFrame(() => {
        panel.style.transition = `height ${duration}ms ${easing}, transform 0.45s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.35s ease`;
        panel.style.height = `${lastPanelHeight}px`;
      });
    }

    cards.forEach(card => {
      const first = firstRects.get(card);
      if (!first) return;
      const last = card.getBoundingClientRect();
      const dx = first.left - last.left;
      const dy = first.top - last.top;
      const sx = first.width / Math.max(last.width, 1);
      const sy = first.height / Math.max(last.height, 1);
      const needsMove = Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5;
      const needsScale = Math.abs(sx - 1) > 0.002 || Math.abs(sy - 1) > 0.002;
      if (!needsMove && !needsScale) return;

      card.style.transformOrigin = 'top left';
      card.style.transition = 'none';
      card.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
      card.getBoundingClientRect();
      requestAnimationFrame(() => {
        card.style.transition = `transform ${duration}ms ${easing}`;
        card.style.transform = '';
      });
    });

    requestAnimationFrame(() => {
      window.setTimeout(() => {
        cards.forEach(card => {
          card.style.transform = '';
          card.style.transformOrigin = '';
          card.style.transition = '';
        });
        if (panel) {
          panel.style.height = '';
          panel.style.overflow = '';
          panel.style.transition = '';
        }
        if (activeCard) {
          requestAnimationFrame(() => {
            activeCard.classList.remove('content-hidden');
            if (typeof options.afterReveal === 'function') options.afterReveal();
          });
        }
        grid.classList.remove('metric-grid-animating');
        _regionMetricGridAnimating = false;
      }, duration + 40);
    });
  }, fadeDuration);
}

function toggleExpand(id) {
  const detail  = document.getElementById(`expand-${id}`);
  const chevron = document.getElementById(`chevron-${id}`);
  if (!detail) return;
  const open = !detail.classList.contains('open');
  const card = detail.closest('.metric-card');
  animateRegionMetricGrid(() => {
    if (card) card.classList.toggle('expanded', open);
    detail.classList.toggle('open', open);
    detail.style.setProperty('--target-height', open ? `${Math.min(detail.scrollHeight, 360)}px` : '0px');
    if (chevron) chevron.classList.toggle('open', open);
    const hint = card?.querySelector('.tile-expand-hint');
    if (hint) hint.textContent = open ? 'Click to collapse' : 'Click to expand';
  }, { activeCard: card });
}

function stopMetricEvent(event) {
  event.stopPropagation();
}

let _activeDeepDiveSourceCard = null;

function showMetricDeepDive(event, regionName, metricKey) {
  event.stopPropagation();
  const region = getRegionData(regionName);
  if (!region) return;
  const content = buildMetricDeepDive(regionName, region, metricKey);
  const panel = document.getElementById('panel-inner');
  if (!panel) return;
  const sourceCard = event.target.closest('.metric-card');
  const panelRect = panel.getBoundingClientRect();
  const sourceRect = sourceCard?.getBoundingClientRect();
  const startX = sourceRect ? sourceRect.left - panelRect.left : 0;
  const startY = sourceRect ? sourceRect.top - panelRect.top : 0;
  const startWidth = sourceRect ? sourceRect.width : panelRect.width;
  const startHeight = sourceRect ? sourceRect.height : panelRect.height;
  _activeDeepDiveSourceCard = sourceCard || null;
  if (sourceCard) sourceCard.classList.add('deep-source-content-hidden');
  let overlay = document.getElementById('metric-deep-dive');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'metric-deep-dive';
    panel.appendChild(overlay);
  }
  overlay.className = 'metric-deep-dive growing';
  overlay.style.setProperty('--start-x', `${startX}px`);
  overlay.style.setProperty('--start-y', `${startY}px`);
  overlay.style.setProperty('--start-width', `${startWidth}px`);
  overlay.style.setProperty('--start-height', `${startHeight}px`);
  overlay.innerHTML = content;
  overlay.getBoundingClientRect();
  const revealContent = event => {
    if (event && event.propertyName !== 'transform') return;
    overlay.classList.remove('growing');
    overlay.removeEventListener('transitionend', revealContent);
    document.getElementById('market-panel')?.classList.add('deep-dive-active');
    if (sourceCard) sourceCard.classList.remove('deep-source-content-hidden');
  };
  overlay.addEventListener('transitionend', revealContent);
  window.setTimeout(() => {
    requestAnimationFrame(() => overlay.classList.add('open'));
  }, 135);
  window.setTimeout(() => revealContent(), 720);
}

function closeMetricDeepDive(event) {
  if (event) event.stopPropagation();
  const overlay = document.getElementById('metric-deep-dive');
  if (!overlay) return;
  const panel = document.getElementById('panel-inner');
  const sourceCard = _activeDeepDiveSourceCard;
  const panelRect = panel?.getBoundingClientRect();
  const sourceRect = sourceCard?.getBoundingClientRect();
  if (panelRect && sourceRect) {
    overlay.style.setProperty('--start-x', `${sourceRect.left - panelRect.left}px`);
    overlay.style.setProperty('--start-y', `${sourceRect.top - panelRect.top}px`);
    overlay.style.setProperty('--start-width', `${sourceRect.width}px`);
    overlay.style.setProperty('--start-height', `${sourceRect.height}px`);
    sourceCard.classList.add('deep-source-content-hidden');
  }
  overlay.classList.remove('growing');
  overlay.classList.add('closing');
  window.setTimeout(() => overlay.classList.remove('open'), 135);
  window.setTimeout(() => {
    overlay.remove();
    document.getElementById('market-panel')?.classList.remove('deep-dive-active');
    sourceCard?.classList.remove('deep-source-content-hidden');
    _activeDeepDiveSourceCard = null;
  }, 720);
}

function renderMaximizeButton(regionName, metricKey) {
  return `
    <button class="metric-maximize" aria-label="Open metric detail" onclick="showMetricDeepDive(event, '${regionName}', '${metricKey}')">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M15 3h6v6"></path><path d="M9 21H3v-6"></path><path d="M21 3l-7 7"></path><path d="M3 21l7-7"></path>
      </svg>
    </button>`;
}

// Tile-chart-wrap uses max-height:0→Npx CSS approach (no .open class needed,
// toggleExpand handles it via the same .open class on tile-chart-wrap divs)

// ── Spectrum bar helper ───────────────────────────────────────────────────────
// pct: 0–100 position on the bar; leftLabel/rightLabel; currentLabel shown below
function renderSpectrum(pct, leftLabel, rightLabel, currentLabel, midLabel = '') {
  return `
    <div class="spectrum-wrap">
      <div class="spectrum-labels">
        <span>${leftLabel}</span>
        ${midLabel ? `<span>${midLabel}</span>` : ''}
        <span>${rightLabel}</span>
      </div>
      <div class="spectrum-track">
        <div class="spectrum-thumb" style="left:${pct}%"></div>
      </div>
      <div class="spectrum-current">${currentLabel}</div>
    </div>`;
}

function renderThresholdVisual({ pct, leftLabel, rightLabel, markerLabel, note, reverse = false }) {
  const safePct = Math.min(100, Math.max(0, pct));
  const background = reverse
    ? 'linear-gradient(90deg, rgba(160,90,82,0.32), rgba(196,180,154,0.46), rgba(74,124,89,0.32))'
    : '';
  return `
    <div class="learning-visual">
      <div class="threshold-scale">
        <div class="threshold-track" ${background ? `style="background:${background}"` : ''}></div>
        <span class="threshold-tick" style="left:0">${leftLabel}</span>
        <span class="threshold-tick" style="left:50%">US avg</span>
        <span class="threshold-tick" style="left:100%">${rightLabel}</span>
        <div class="threshold-marker" style="left:${safePct}%" data-label="${markerLabel}"></div>
      </div>
      <p class="learning-note">${note}</p>
    </div>`;
}

function renderTeachingScale({ pct, value, leftLabel, midLabel, rightLabel, reverse = false, baselinePct = null, baselineLabel = '', baselineTickLabel = '', compactMarker = false }) {
  const safePct = Math.min(100, Math.max(0, pct));
  const safeBaselinePct = Number.isFinite(baselinePct) ? Math.min(100, Math.max(0, baselinePct)) : null;
  const background = reverse
    ? 'linear-gradient(90deg, rgba(160,90,82,0.36) 0%, rgba(196,180,154,0.48) 50%, rgba(74,124,89,0.34) 100%)'
    : 'linear-gradient(90deg, rgba(74,124,89,0.34) 0%, rgba(196,180,154,0.48) 50%, rgba(160,90,82,0.36) 100%)';
  return `
    <div class="learning-visual teaching-visual">
      <div class="teaching-scale${compactMarker ? ' compact-marker' : ''}" style="--marker:${safePct}%;--scale-bg:${background};">
        <div class="teaching-track"></div>
        ${safeBaselinePct === null ? '' : `<div class="teaching-baseline" style="left:${safeBaselinePct}%"><span>${baselineLabel}</span></div>`}
        <div class="teaching-marker"><span>${value}</span></div>
        <div class="teaching-ticks">
          <span>${leftLabel}</span>${safeBaselinePct === null ? `<span>${midLabel}</span>` : ''}<span>${rightLabel}</span>
        </div>
        ${safeBaselinePct === null || !baselineTickLabel ? '' : `<div class="teaching-baseline-tick" style="left:${safeBaselinePct}%">${baselineTickLabel}</div>`}
      </div>
    </div>`;
}

function renderRentBurdenVisual(rentBurden, nationalRentBurden = null) {
  const burden = parseFloat(rentBurden);
  const pct = Number.isFinite(burden) ? Math.min(100, Math.max(0, burden)) : 0;
  const baseline = parseFloat(nationalRentBurden);
  const baselinePct = Number.isFinite(baseline) ? Math.min(100, Math.max(0, baseline)) : null;
  const visual = renderTeachingScale({
    pct,
    value: rentBurden || 'N/A',
    leftLabel: 'Lower',
    midLabel: 'US baseline',
    rightLabel: 'Higher',
    baselinePct,
    baselineLabel: Number.isFinite(baseline) ? `${baseline.toFixed(1)}%` : '',
    baselineTickLabel: Number.isFinite(baseline) ? 'US baseline' : '',
    compactMarker: true,
  });
  return visual;
}

function renderRenterShareScale({ pct, value, leftLabel, midLabel, rightLabel, baselinePct = null, baselineLabel = '', baselineTickLabel = '' }) {
  const safePct = Math.min(100, Math.max(0, pct));
  const safeBaselinePct = Number.isFinite(baselinePct) ? Math.min(100, Math.max(0, baselinePct)) : null;
  return `
    <div class="learning-visual teaching-visual">
      <div class="teaching-scale" style="--marker:${safePct}%;">
        <div class="teaching-track"></div>
        ${safeBaselinePct === null ? '' : `<div class="teaching-baseline" style="left:${safeBaselinePct}%"><span>${baselineLabel}</span></div>`}
        <div class="teaching-marker"><span>${value}</span></div>
        <div class="teaching-ticks">
          <span>${leftLabel}</span>${safeBaselinePct === null ? `<span>${midLabel}</span>` : ''}<span>${rightLabel}</span>
        </div>
        ${safeBaselinePct === null || !baselineTickLabel ? '' : `<div class="teaching-baseline-tick" style="left:${safeBaselinePct}%">${baselineTickLabel}</div>`}
      </div>
    </div>`;
}

function renderRangeComparisonVisual({ pct, value, lowLabel, midLabel, highLabel }) {
  const safePct = Math.min(100, Math.max(0, pct));
  const markerLeft = `calc(${safePct}% + ${12 - (24 * safePct / 100)}px)`;
  return `
    <div class="learning-visual teaching-visual">
      <div class="range-scale" style="--marker:${markerLeft};">
        <div class="range-track"></div>
        <div class="range-midline"><span>${midLabel}</span></div>
        <div class="teaching-marker"><span>${value}</span></div>
        <div class="teaching-ticks">
          <span>${lowLabel}</span><span>US baseline</span><span>${highLabel}</span>
        </div>
      </div>
    </div>`;
}

function renderComparisonVisual({ primaryLabel, primaryPct, primaryValue, guideLabel, guidePct, guideValue, note, cls = 'good' }) {
  return `
    <div class="learning-visual teaching-visual">
      <div class="comparison-stack">
        <div class="comparison-row">
          <div class="comparison-head"><span>${primaryLabel}</span><strong>${primaryValue}</strong></div>
          <div class="comparison-track"><div class="comparison-fill ${cls}" style="width:${Math.min(100, Math.max(0, primaryPct))}%"></div></div>
        </div>
        <div class="comparison-row">
          <div class="comparison-head muted"><span>${guideLabel}</span><strong>${guideValue}</strong></div>
          <div class="comparison-track"><div class="comparison-fill guide" style="width:${Math.min(100, Math.max(0, guidePct))}%"></div></div>
        </div>
      </div>
      <p class="learning-note">${note}</p>
    </div>`;
}

function renderBenchmarkRows(rows, note) {
  return `
    <div class="learning-visual">
      ${rows.map(row => `
        <div class="benchmark-row">
          <span>${row.label}</span>
          <div class="benchmark-track">
            <div class="benchmark-fill ${row.cls || ''}" style="width:${Math.min(100, Math.max(0, row.pct))}%"></div>
          </div>
          <strong>${row.value}</strong>
        </div>`).join('')}
      <p class="learning-note">${note}</p>
    </div>`;
}

function formatOtherBreakdownTip(items) {
  const rows = (items || [])
    .filter(item => item && item.sector && Number.isFinite(Number(item.pct)) && Number(item.pct) > 0)
    .map(item => `${item.sector} ${Math.round(Number(item.pct))}%`);
  if (!rows.length) {
    return 'Other includes the remaining employment sectors outside the five largest categories. The detailed makeup will populate after the next data refresh includes the full sector breakdown.';
  }
  return `Other includes the remaining employment sectors outside the five largest categories: ${rows.join(', ')}.`;
}

function forecastClass(outlook) {
  const text = String(outlook || '').toLowerCase();
  if (text.includes('positive') || text.includes('improving') || text.includes('tailwind')) return 'positive';
  if (text.includes('caution') || text.includes('softening') || text.includes('pressure')) return 'caution';
  return 'stable';
}

function formatSignedDiff(value) {
  if (!Number.isFinite(value)) return 'near the benchmark';
  if (Math.abs(value) < 0.05) return 'at the benchmark';
  return `${value > 0 ? '+' : ''}${value.toFixed(1)} pts vs US`;
}

function topSectorText(region) {
  const top = region?.econ?.breakdown?.[0];
  return top ? `${top.sector} is the largest sector at ${top.pct}%` : 'sector mix is unavailable';
}

function regionMetricPercentile(metricKey, rawValue) {
  const regions = Object.values(window.APTUS_REGION_INSIGHTS?.regions || REGION_DATA || {});
  const values = regions
    .map(region => {
      if (metricKey === 'rpp') return parseFloat((region.rpp || region.col)?.value);
      if (metricKey === 'renter') return parseFloat((region.renter || region.own)?.value);
      if (metricKey === 'unemp') return parseFloat(region.unemp?.value);
      if (metricKey === 'burden') return parseFloat(region.income?.rentBurden);
      if (metricKey === 'gdp') return parsePercentValue(region.gdp?.value);
      if (metricKey === 'migration') return parseFloat(String(region.migration?.value || '').replace('/1k', ''));
      return null;
    })
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (!values.length || !Number.isFinite(rawValue)) return 'peer position unavailable';
  const rank = values.filter(value => value <= rawValue).length;
  if (rank / values.length >= 0.75) return 'near the high end of peer regions';
  if (rank / values.length <= 0.25) return 'near the low end of peer regions';
  return 'near the middle of peer regions';
}

function getForecastSignal(regionName, region, metricKey) {
  const migrationRate = parseFloat(String(region?.migration?.value || '').replace('/1k', ''));
  const gdp = parsePercentValue(region?.gdp?.value);
  const rpp = parseFloat((region?.rpp || region?.col)?.value);
  const renter = parseFloat((region?.renter || region?.own)?.value);
  const unemp = parseFloat(region?.unemp?.value);
  const nationalUnemp = parseFloat(region?.unemp?.national || 3.9);
  const burden = parseFloat(region?.income?.rentBurden);
  const nationalBurden = parseFloat(region?.income?.nationalRentBurden);
  const history = region?.migration?.history || [];
  const migrationTrend = history.length >= 2 ? history[history.length - 1].val - history[history.length - 2].val : null;

  if (metricKey === 'migration') {
    const outlook = migrationRate >= 10 && (migrationTrend === null || migrationTrend >= -5)
      ? 'Positive demand tailwind'
      : migrationRate < 0 || migrationTrend < -8
        ? 'Caution: softening demand'
        : 'Stable demand signal';
    return {
      outlook,
      confidence: history.length >= 4 ? 'High' : 'Medium',
      drivers: `Modeled from the latest net migration rate, recent migration history, and peer-region position. ${regionMetricPercentile('migration', migrationRate)}.`
    };
  }

  if (metricKey === 'rpp') {
    const outlook = rpp >= 108 ? 'Caution: cost pressure elevated' : rpp <= 95 ? 'Affordability tailwind' : 'Stable cost position';
    return {
      outlook,
      confidence: 'Medium',
      drivers: `Modeled from the current RPP index, the US baseline of 100, and demand pressure from migration. ${Number.isFinite(rpp) ? `This region is ${Math.abs(rpp - 100).toFixed(1)} pts ${rpp >= 100 ? 'above' : 'below'} the US baseline.` : 'RPP is unavailable.'}`
    };
  }

  if (metricKey === 'gdp') {
    const outlook = gdp >= 2.5 ? 'Positive economic momentum' : gdp < 1.5 ? 'Caution: slower growth' : 'Stable growth backdrop';
    return {
      outlook,
      confidence: 'Medium',
      drivers: `Modeled from real GDP growth, the US baseline, and peer-region range. ${regionMetricPercentile('gdp', gdp)}.`
    };
  }

  if (metricKey === 'renter') {
    const outlook = renter >= 38 ? 'Positive rental-demand base' : renter < 32 ? 'Selective rental-demand base' : 'Stable tenure backdrop';
    return {
      outlook,
      confidence: 'Medium',
      drivers: `Modeled from renter household share versus the 35% US baseline and peer regions. ${regionMetricPercentile('renter', renter)}.`
    };
  }

  if (metricKey === 'econ') {
    const topPct = parseFloat(region?.econ?.breakdown?.[0]?.pct);
    const outlook = topPct >= 24 ? 'Caution: concentration risk' : topPct >= 20 ? 'Stable sector mix' : 'Positive resilience signal';
    return {
      outlook,
      confidence: 'Medium',
      drivers: `Modeled from employment concentration and sector breadth. ${topSectorText(region)}.`
    };
  }

  if (metricKey === 'unemp') {
    const diff = unemp - nationalUnemp;
    const outlook = diff <= -0.3 ? 'Positive labor-market signal' : diff >= 0.5 ? 'Caution: labor slack' : 'Stable labor backdrop';
    return {
      outlook,
      confidence: 'High',
      drivers: `Modeled from regional unemployment versus the US baseline. Current spread: ${formatSignedDiff(diff)}.`
    };
  }

  if (metricKey === 'burden') {
    const diff = burden - nationalBurden;
    const outlook = diff <= -2 ? 'Affordability tailwind' : diff >= 2 ? 'Caution: rent capacity pressure' : 'Stable affordability backdrop';
    return {
      outlook,
      confidence: Number.isFinite(nationalBurden) ? 'Medium' : 'Low',
      drivers: `Modeled from rent-burdened renter share versus the US baseline and median-income context. Current spread: ${formatSignedDiff(diff)}.`
    };
  }

  return {
    outlook: 'Stable modeled signal',
    confidence: 'Low',
    drivers: `Modeled from the latest official cache for ${regionName}.`
  };
}

function renderForecastSignal(regionName, region, metricKey) {
  const signal = getForecastSignal(regionName, region, metricKey);
  return `
    <div class="forecast-signal ${forecastClass(signal.outlook)}">
      <div class="forecast-head">
        <span>Avenue Modeled Outlook</span>
        <strong>${signal.outlook}</strong>
      </div>
      <div class="forecast-meta">
        <span>12-month direction</span>
        <span>Confidence: ${signal.confidence}</span>
      </div>
      <p>${signal.drivers}</p>
    </div>`;
}

function buildDeepDiveSection(title, body) {
  return `<section class="deep-section"><h4>${title}</h4>${body}</section>`;
}

const METRIC_DESCRIPTIONS = {
  migration: 'This metric normalizes migration by population size, so large and small regions can be compared more fairly. Positive values indicate net inflow; negative values indicate net outflow.',
  rpp: `Regional Price Parity is a metric that measures the differences in price levels for goods and services relative to the national average. It essentially functions as a cost-of-living index, indicating whether a specific region's purchasing power is higher or lower than the rest of the United States.`,
  gdp: 'Real GDP growth is the primary barometer for the health of an economy. Because it is adjusted for inflation, it represents the actual increase in the volume of goods and services produced.',
  renter: 'Renter Household Share is the percentage of all occupied housing units in a given area that are occupied by tenants rather than owners. Nationally, this figure typically hovers around 35%, though it can be significantly higher in urban cores or emerging markets where high home prices or a mobile workforce drive greater demand for rental housing.'
};

function sourceYear(source) {
  const year = String(source || '').match(/\b(20\d{2})\b/);
  return year ? Number(year[1]) : null;
}

function sourceStamp(metricKey, metric) {
  const source = metric?.source || '';
  const year = sourceYear(source);
  if (/previous cache/i.test(source)) {
    if (metricKey === 'gdp') {
      return `the retained BEA-backed GDP cache. The latest official US Bureau of Economic Analysis GDP by State release is the 2025 annual data, released in April 2026. The next BEA GDP by State release is scheduled for June 2026.`;
    }
    return `the retained BEA-backed cache. The latest official US Bureau of Economic Analysis Regional Price Parities release is the 2024 vintage, published in February 2026. The retained value does not currently include a verified source vintage in the generated data.`;
  }
  if (metricKey === 'migration' && year) return `${source}, ${populationEstimateReleaseText(year)}.`;
  if (metricKey === 'renter' && year) return `${expandSourceLabel(source)}, an annual report. The ${year} American Community Survey 5-year release was published in December ${year + 1}, and the next release is expected in December ${year + 2}.`;
  if (metricKey === 'rpp' && year) return `${expandSourceLabel(source)}, ${rppReleaseText(year)}.`;
  if (metricKey === 'gdp' && year) return `${expandSourceLabel(source)}, ${gdpReleaseText(year)}.`;
  return source || 'Source vintage unavailable in the generated data.';
}

function expandSourceLabel(source) {
  return String(source || '')
    .replace(/^BEA\b/, 'US Bureau of Economic Analysis (BEA)')
    .replace(/^Census ACS\b/, 'US Census Bureau American Community Survey')
    .replace(/^ACS\b/, 'US Census Bureau American Community Survey');
}

function populationEstimateReleaseText(year) {
  const releases = {
    2025: 'the Vintage 2025 national and state release published in January 2026',
    2024: 'the Vintage 2024 national and state release published in December 2024'
  };
  return releases[year] || `the Vintage ${year} national and state release`;
}

function rppReleaseText(year) {
  const releases = {
    2024: 'the current official RPP vintage, released in February 2026. The next BEA RPP release is scheduled for December 2026'
  };
  return releases[year] || `an annual BEA price-level observation for calendar year ${year}`;
}

function gdpReleaseText(year) {
  const releases = {
    2025: 'the current official annual GDP by State data, released in April 2026. The next BEA GDP by State release is scheduled for June 2026'
  };
  return releases[year] || `an annual BEA real GDP growth observation for calendar year ${year}`;
}

function metricPeriod(metricKey, metric) {
  const year = sourceYear(metric?.source);
  if (metricKey === 'migration') {
    const years = (metric?.history || []).map(item => Number(item.year)).filter(Number.isFinite);
    if (years.length) return `${Math.min(...years)} through ${Math.max(...years)}`;
    return year ? `2020 through ${year}` : 'the available Population Estimates history window';
  }
  if (metricKey === 'renter' && year) return `${year - 4} through ${year}, because American Community Survey 5-year estimates pool five survey years`;
  if (metricKey === 'rpp' && year) return `calendar year ${year}`;
  if (metricKey === 'gdp' && year) return `calendar year ${year}, compared with the prior calendar year`;
  return 'the time period identified by the current source vintage';
}

function migrationSpectrumText(value) {
  const rate = parseFloat(String(value || '').replace('/1k', ''));
  if (!Number.isFinite(rate)) return 'This cannot be placed on the spectrum until a numeric rate is available.';
  const extent = getRegionMetricExtent('migration');
  const range = Math.max(0.1, extent.max - extent.min);
  const pct = (rate - extent.min) / range;
  const placement = pct >= 0.75 ? 'near the high end' : pct >= 0.45 ? 'around the middle' : 'near the low end';
  return `There is not a universal industry cutoff for what counts as strong net migration, so this panel uses peer-region context: this value falls ${placement} of the current regional range (${extent.min.toFixed(1)}/1k to ${extent.max.toFixed(1)}/1k).`;
}

function rppSpectrumText(value) {
  const rpp = parseFloat(value);
  if (!Number.isFinite(rpp)) return 'This cannot be placed on the cost spectrum until a numeric RPP value is available.';
  if (rpp >= 108) return 'Because the BEA index sets the US average at 100, this sits in the high-cost range.';
  if (rpp >= 103) return 'Because the BEA index sets the US average at 100, this sits above the national cost baseline.';
  if (rpp <= 92) return 'Because the BEA index sets the US average at 100, this sits in the low-cost range.';
  if (rpp <= 97) return 'Because the BEA index sets the US average at 100, this sits below the national cost baseline.';
  return 'Because the BEA index sets the US average at 100, this sits near the national cost baseline.';
}

function gdpSpectrumText(value) {
  const growth = parsePercentValue(value);
  const extent = getRegionMetricExtent('gdp');
  if (!Number.isFinite(growth)) return 'This cannot be placed on the growth spectrum until a numeric GDP growth value is available.';
  const range = Math.max(0.1, extent.max - extent.min);
  const pct = (growth - extent.min) / range;
  if (pct >= 0.75) return `Among the current displayed regions, this lands near the high end of the range (${formatPctLabel(extent.min)} to ${formatPctLabel(extent.max)}).`;
  if (pct >= 0.45) return `Among the current displayed regions, this lands around the middle of the range (${formatPctLabel(extent.min)} to ${formatPctLabel(extent.max)}).`;
  return `Among the current displayed regions, this lands near the low end of the range (${formatPctLabel(extent.min)} to ${formatPctLabel(extent.max)}).`;
}

function renterSpectrumText(value) {
  const share = parseInt(value, 10);
  if (!Number.isFinite(share)) return 'This cannot be placed on the tenure spectrum until a numeric renter share is available.';
  if (share >= 40) return 'Relative to the national renter share, this is renter-heavy and indicates a comparatively deep rental household base.';
  if (share >= 34) return 'Relative to the national renter share, this reads as broadly balanced.';
  return 'Relative to the national renter share, this is owner-heavy, so rental demand may be more concentrated in specific metros or submarkets.';
}

function buildMetricUsedSection(regionName, region, metricKey) {
  const rpp = region.rpp || region.col;
  const renter = region.renter || region.own;
  const metric = { migration: region.migration, rpp, gdp: region.gdp, renter }[metricKey];
  const source = sourceStamp(metricKey, metric);
  const period = metricPeriod(metricKey, metric);

  if (metricKey === 'migration') {
    return `
      <p>The displayed figure is a regional net migration rate. It uses the Census Population Estimates Program net migration field, which combines domestic and international migration, from ${source}</p>
      <p>The source data is state-level, so Avenue first sums the net migration counts for every state in ${regionName}, then divides that total by the combined regional population and multiplies by 1,000. That creates a per-1,000-residents rate so large and small regions can be compared more fairly.</p>
      <p>The current time period represented is ${period}. For example, a value of ${metric.value} means the region had about ${String(metric.value).replace('/1k', '')} net movers for every 1,000 residents over that period. Positive means more people moved in than out; negative means more moved out than in. ${migrationSpectrumText(metric.value)}</p>`;
  }

  if (metricKey === 'rpp') {
    const rppValue = parseFloat(metric.value);
    const rppExample = Number.isFinite(rppValue)
      ? `a value of ${metric.value} means prices are roughly ${Math.abs(rppValue - 100).toFixed(1)}% ${rppValue >= 100 ? 'above' : 'below'} the national average`
      : `the value should be read relative to the US average of 100`;
    return `
      <p>The displayed figure is the US Bureau of Economic Analysis (BEA) Regional Price Parities index from their 2024 report which is the current official RPP vintage, released in February 2026. The next BEA RPP release is scheduled for December 2026.</p>
      <p>BEA publishes this at the state level, while Avenue regions are multi-state. Avenue calculates the regional value as an occupied-household-weighted average of the state RPP values, using American Community Survey occupied housing units as the weight. That gives more influence to the states where more households actually live, which increases the accuracy of the regional estimate.</p>
      <p>The current time period represented is ${period}. The US average is 100. For example, ${rppExample}. ${rppSpectrumText(metric.value)}</p>`;
  }

  if (metricKey === 'gdp') {
    return `
      <p>The displayed figure is real GDP growth from ${source}</p>
      <p>Real GDP is already adjusted for inflation, so it measures growth in actual economic output rather than price increases. BEA provides the source data at the state level; Avenue sums the state real GDP levels for ${regionName} and calculates the growth rate from the combined current-year and prior-year totals so the tile reflects broad regional economic momentum rather than a single state.</p>
      <p>The current time period represented is ${period}. For example, ${metric.value} means inflation-adjusted output was about ${metric.value.replace('+', '')} higher than the prior year across the region's state-level readings. ${gdpSpectrumText(metric.value)}</p>`;
  }

  return `
    <p>The displayed figure is renter household share from ${source}</p>
    <p>The source data is American Community Survey occupied housing tenure. Avenue sums renter-occupied housing units across the states in ${regionName}, sums total occupied housing units across the same states, then divides renters by total occupied households. That creates one regional share from state-level Census data.</p>
    <p>The current time period represented is ${period}. For example, a value of ${metric.value} means about ${metric.value} of occupied households are renters, or roughly ${parseInt(metric.value, 10) || 0} renter households out of every 100 occupied households. ${renterSpectrumText(metric.value)}</p>`;
}

function buildMetricDeepDive(regionName, region, metricKey) {
  const rpp = region.rpp || region.col;
  const renter = region.renter || region.own;
  const metricMap = {
    migration: {
      title: 'Net Migration Rate',
      value: region.migration.value,
      source: region.migration.source,
      sections: [
        buildDeepDiveSection('Metric Used', buildMetricUsedSection(regionName, region, 'migration')),
        buildDeepDiveSection('How To Use It', `<p>Use it as a demand signal, not a standalone buy signal. Strong inflow can support absorption, rent growth, and household formation, but it can also attract new supply and push entry prices higher.</p>`),
        buildDeepDiveSection('Investor Read', `<p>For growth-oriented investors, migration momentum can support appreciation and lease-up confidence. For cash-flow investors, strong migration is most useful when rents remain affordable and new construction is not overwhelming demand.</p>`)
      ]
    },
    rpp: {
      title: 'Regional Price Parity',
      value: rpp.value,
      source: rpp.source,
      sections: [
        buildDeepDiveSection('Metric Used', buildMetricUsedSection(regionName, region, 'rpp')),
        buildDeepDiveSection('How To Use It', `<p>Lower cost is not inherently better, and higher cost is not inherently worse. Lower-cost regions can be attractive for cash-flow, affordability, and entry price discipline. Higher-cost regions may offer stronger income bases, deeper liquidity, scarcer supply, and appreciation potential.</p>`),
        buildDeepDiveSection('Investor Read', `<p>If your approach is yield-first, below-average RPP can be helpful because tenant incomes may stretch further. If your approach is appreciation or premium asset quality, above-average RPP may be acceptable when job growth, incomes, and supply constraints support pricing.</p>`)
      ]
    },
    gdp: {
      title: 'Real GDP Growth',
      value: region.gdp.value,
      source: region.gdp.source,
      sections: [
        buildDeepDiveSection('Metric Used', buildMetricUsedSection(regionName, region, 'gdp')),
        buildDeepDiveSection('How To Use It', `<p>Use it to understand the economic backdrop behind tenant income, job creation, and business investment. Compare it with unemployment, migration, and affordability before drawing conclusions.</p>`),
        buildDeepDiveSection('Investor Read', `<p>High growth can support demand but can also increase competition and prices. Lower growth can still work for cash-flow strategies when entry prices are disciplined and employment is stable.</p>`)
      ]
    },
    renter: {
      title: 'Renter Household Share',
      value: renter.value,
      source: renter.source,
      sections: [
        buildDeepDiveSection('Metric Used', buildMetricUsedSection(regionName, region, 'renter')),
        buildDeepDiveSection('How To Use It', `<p>A higher renter share usually means a deeper rental demand pool. A lower renter share can still be attractive if ownership is expensive, population is growing, or rental supply is limited.</p>`),
        buildDeepDiveSection('Investor Read', `<p>Use this to size the potential tenant base and calibrate property type. Renter-heavy regions may support more rental product variety, while owner-heavy regions may favor selective submarkets or affordability-driven rental demand.</p>`)
      ]
    }
  };
  const metric = metricMap[metricKey];
  if (!metric) return '';
  return `
    <div class="deep-header">
      <p class="region-tag">${regionName}</p>
      <button class="metric-deep-close" aria-label="Close metric detail" onclick="closeMetricDeepDive(event)">×</button>
      <h3>${metric.title}</h3>
      <div class="deep-value">${metric.value}</div>
    </div>
    <div class="deep-content">
      ${metric.sections.join('')}
      <section class="deep-section source-note"><h4>Source</h4><p>${sourceText(`${metric.title} should be read as one part of the regional investment picture.`, { source: metric.source })}</p></section>
    </div>`;
}

function parsePercentValue(value) {
  return parseFloat(String(value || '').replace(/[+%]/g, ''));
}

function formatPctLabel(value) {
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}%`;
}

function getRegionMetricExtent(metricKey) {
  const regions = Object.values(window.APTUS_REGION_INSIGHTS?.regions || REGION_DATA || {});
  const values = regions
    .map(region => parsePercentValue(region?.[metricKey]?.value))
    .filter(Number.isFinite);
  return {
    min: values.length ? Math.min(...values) : 0,
    max: values.length ? Math.max(...values) : 5
  };
}

function classifyMigrationRate(value, fallbackDelta = 'Cached trend', fallbackDir = 'flat') {
  const rate = parseFloat(String(value || '').replace('/1k', ''));
  if (!Number.isFinite(rate)) return { delta: fallbackDelta, dir: fallbackDir };
  const dir = rate > 0 ? 'up' : rate < 0 ? 'down' : 'flat';
  if (rate >= 20) return { delta: 'Very strong 5yr inflow', dir };
  if (rate >= 10) return { delta: 'Strong 5yr inflow', dir };
  if (rate >= 3) return { delta: 'Modest inflow', dir };
  if (rate > 0) return { delta: 'Slight inflow', dir };
  if (rate <= -10) return { delta: 'Strong 5yr outflow', dir };
  if (rate <= -3) return { delta: 'Modest outflow', dir };
  return { delta: 'Slight outflow', dir };
}

// ── Unemployment benchmark bar ────────────────────────────────────────────────
function renderUnempBar(localPct, nationalPct = 3.9) {
  const local = parseFloat(localPct);
  const national = parseFloat(nationalPct);
  const localScalePct = Number.isFinite(local) ? Math.min(100, Math.max(0, (local / 10) * 100)) : 0;
  const nationalScalePct = Number.isFinite(national) ? Math.min(100, Math.max(0, (national / 10) * 100)) : 0;
  return `
    ${renderTeachingScale({
      pct: localScalePct,
      value: `${localPct}%`,
      leftLabel: 'Lower',
      midLabel: 'US baseline',
      rightLabel: 'Higher',
      baselinePct: nationalScalePct,
      baselineLabel: `${nationalPct}%`,
      baselineTickLabel: 'US baseline',
      compactMarker: true,
    })}`;
}

// ── Mortgage calculator ───────────────────────────────────────────────────────
function calcMortgage(id) {
  const priceEl = document.getElementById(`calc-price-${id}`);
  const dpEl    = document.getElementById(`calc-dp-${id}`);
  const rateEl  = document.getElementById(`calc-rate-${id}`);
  const outEl   = document.getElementById(`calc-out-${id}`);
  if (!priceEl || !outEl) return;
  const price = parseFloat(priceEl.value.replace(/[^0-9.]/g, '')) || 0;
  const dp    = parseFloat(dpEl.value) / 100;
  const rate  = parseFloat(rateEl.value) / 100 / 12;
  const n     = 360;
  const principal = price * (1 - dp);
  if (principal <= 0 || rate <= 0) { outEl.innerHTML = '—'; return; }
  const payment = principal * (rate * Math.pow(1+rate,n)) / (Math.pow(1+rate,n)-1);
  outEl.innerHTML = `<div class="calc-payment">$${Math.round(payment).toLocaleString()}<span style="font-family:sans-serif;font-size:0.75rem;font-weight:400;color:#6b6560">/mo</span></div>
    <div class="calc-note">P&I only · ${(dp*100).toFixed(0)}% down · ${(parseFloat(rateEl.value)).toFixed(2)}% rate</div>`;
}

function renderMortgageCalc(id, defaultPrice, defaultRate = 7.1) {
  return `
    <div class="calc-wrap">
      <div class="calc-row"><span>Home Price</span>
        <input class="calc-input" id="calc-price-${id}" value="${defaultPrice}" oninput="calcMortgage('${id}')">
      </div>
      <div class="calc-row"><span>Down Payment</span>
        <input class="calc-input" id="calc-dp-${id}" value="20" oninput="calcMortgage('${id}')" type="number" min="0" max="100">
        <span style="font-size:0.72rem;color:#9b9189;margin-left:2px">%</span>
      </div>
      <div class="calc-row"><span>Interest Rate</span>
        <input class="calc-input" id="calc-rate-${id}" value="${defaultRate}" oninput="calcMortgage('${id}')" type="number" step="0.1">
        <span style="font-size:0.72rem;color:#9b9189;margin-left:2px">%</span>
      </div>
      <div class="calc-result" id="calc-out-${id}"></div>
    </div>`;
}

// ── Expandable row builder ────────────────────────────────────────────────────
function expandRow(id, label, tipText, value, detailHTML) {
  return `
    <div class="trend-row expand-row" onclick="toggleExpand('${id}')">
      <span class="trend-label">${label}${tipText ? tip(tipText) : ''}
        <span class="expand-chevron" id="chevron-${id}">▾</span>
      </span>
      <span class="trend-value">${value}</span>
    </div>
    <div class="expand-detail" id="expand-${id}">
      <div class="expand-detail-inner">${detailHTML}</div>
    </div>`;
}

// ── Region data ───────────────────────────────────────────────────────────────
const REGION_DATA = {
  Northeast: {
    tag: 'Region Overview', subtitle: 'Dense, supply-constrained markets',
    goal: 'Identify macro-migration and economic stability.',
    migration: { value: '−124K', dir: 'down', delta: 'Outflow',
      detail: `<strong>5-year net migration: −124,000</strong><br>The Northeast has experienced consistent population outflow, primarily driven by high housing costs, state income taxes, and remote work flexibility. New York and New Jersey account for the majority of outflow. <strong>Investor implication:</strong> shrinking tenant pool in declining metros, but supply-constrained gateway cities maintain strong demand.` },
    col: { value: '118.4', dir: 'down', delta: 'Above national avg' },
    gdp: { value: '+2.1%', dir: 'up', delta: 'Moderate' },
    own: { value: '62%', dir: 'up', delta: 'Below avg' },
    econ: { value: 'High',
      breakdown: [ { sector: 'Finance & Insurance', pct: 22 }, { sector: 'Healthcare', pct: 18 }, { sector: 'Professional Services', pct: 16 }, { sector: 'Education', pct: 12 }, { sector: 'Tech', pct: 10 }, { sector: 'Other', pct: 22 } ] },
    unemp: { value: 3.8 },
    income: { value: '$82,300', num: 82300,
      detail: `<strong>30% Rule:</strong> Max sustainable monthly rent ≈ <strong>$2,058</strong><br>At 30% of gross income, a median-income household can afford ~$2,058/mo in rent. This sets the practical ceiling for tenant ability to pay without rent burden.` },
  },
  Southeast: {
    tag: 'Region Overview', subtitle: 'High-growth sunbelt opportunity',
    goal: 'Identify macro-migration and economic stability.',
    migration: { value: '+412K', dir: 'up', delta: 'Very strong 5yr inflow',
      detail: `<strong>5-year net migration: +412,000</strong><br>The Southeast leads the nation in population inflow, driven by lower taxes, affordable housing, and business relocation from coastal metros. Florida, Texas, and North Carolina are primary destinations. <strong>Investor implication:</strong> sustained rental demand growth with favorable supply pipeline still lagging inflow.` },
    col: { value: '93.2', dir: 'up', delta: 'Below national avg' },
    gdp: { value: '+3.4%', dir: 'up', delta: 'Above avg' },
    own: { value: '66%', dir: 'flat', delta: 'Near avg' },
    econ: { value: 'Moderate',
      breakdown: [ { sector: 'Healthcare', pct: 20 }, { sector: 'Retail & Hospitality', pct: 18 }, { sector: 'Logistics', pct: 15 }, { sector: 'Finance', pct: 12 }, { sector: 'Manufacturing', pct: 14 }, { sector: 'Other', pct: 21 } ] },
    unemp: { value: 3.4 },
    income: { value: '$61,400', num: 61400,
      detail: `<strong>30% Rule:</strong> Max sustainable monthly rent ≈ <strong>$1,535</strong><br>At 30% of gross income, a median-income household can afford ~$1,535/mo in rent. Below the national median, which keeps rents competitive but limits premium property yields.` },
  },
  Midwest: {
    tag: 'Region Overview', subtitle: 'Affordable cash-flow markets',
    goal: 'Identify macro-migration and economic stability.',
    migration: { value: '−86K', dir: 'down', delta: 'Slow outflow',
      detail: `<strong>5-year net migration: −86,000</strong><br>The Midwest sees modest population outflow concentrated in legacy industrial metros. Secondary markets like Columbus, Indianapolis, and Des Moines are growing while Detroit and Cleveland continue to decline. <strong>Investor implication:</strong> highly location-dependent — market selection within the region is critical.` },
    col: { value: '89.6', dir: 'up', delta: 'Below national avg' },
    gdp: { value: '+1.8%', dir: 'flat', delta: 'Moderate' },
    own: { value: '69%', dir: 'flat', delta: 'Above avg' },
    econ: { value: 'Moderate',
      breakdown: [ { sector: 'Manufacturing', pct: 24 }, { sector: 'Healthcare', pct: 19 }, { sector: 'Agriculture', pct: 12 }, { sector: 'Retail', pct: 14 }, { sector: 'Professional Services', pct: 11 }, { sector: 'Other', pct: 20 } ] },
    unemp: { value: 3.9 },
    income: { value: '$62,800', num: 62800,
      detail: `<strong>30% Rule:</strong> Max sustainable monthly rent ≈ <strong>$1,570</strong><br>Affordable entry prices paired with this income level produce some of the highest cash-on-cash returns in the country. The income floor is manageable at Midwest price points.` },
  },
  Southwest: {
    tag: 'Region Overview', subtitle: 'Fast-appreciating metro expansion',
    goal: 'Identify macro-migration and economic stability.',
    migration: { value: '+298K', dir: 'up', delta: 'Very strong 5yr inflow',
      detail: `<strong>5-year net migration: +298,000</strong><br>The Southwest benefits from California spillover migration and business relocation. Phoenix, Austin (cross-border), and Las Vegas are absorption centers. <strong>Investor implication:</strong> strong short-term demand but rising prices are compressing yields in tier-1 metros; secondary markets offer better entry points.` },
    col: { value: '97.4', dir: 'flat', delta: 'Near national avg' },
    gdp: { value: '+3.1%', dir: 'up', delta: 'Above avg' },
    own: { value: '64%', dir: 'flat', delta: 'Near avg' },
    econ: { value: 'Moderate',
      breakdown: [ { sector: 'Real Estate', pct: 18 }, { sector: 'Healthcare', pct: 17 }, { sector: 'Tech', pct: 14 }, { sector: 'Hospitality', pct: 13 }, { sector: 'Energy', pct: 12 }, { sector: 'Other', pct: 26 } ] },
    unemp: { value: 3.6 },
    income: { value: '$66,200', num: 66200,
      detail: `<strong>30% Rule:</strong> Max sustainable monthly rent ≈ <strong>$1,655</strong><br>Rising incomes are tracking closely with rising rents in Southwest metros — affordability is maintained but not improving. Watch for income-rent divergence as appreciation continues.` },
  },
  West: {
    tag: 'Region Overview', subtitle: 'Premium assets, compressed yields',
    goal: 'Identify macro-migration and economic stability.',
    migration: { value: '+62K', dir: 'up', delta: 'Slow inflow',
      detail: `<strong>5-year net migration: +62,000</strong><br>The West Coast has dramatically slowed its historically high in-migration as housing costs drive domestic out-migration from California. International immigration partially offsets. <strong>Investor implication:</strong> high prices with compressed yield; best suited for appreciation play rather than cash-flow strategy.` },
    col: { value: '124.8', dir: 'down', delta: 'Well above avg' },
    gdp: { value: '+2.6%', dir: 'up', delta: 'Above avg' },
    own: { value: '58%', dir: 'up', delta: 'Below avg' },
    econ: { value: 'High',
      breakdown: [ { sector: 'Technology', pct: 28 }, { sector: 'Healthcare', pct: 15 }, { sector: 'Finance', pct: 12 }, { sector: 'Media & Entertainment', pct: 10 }, { sector: 'Professional Services', pct: 14 }, { sector: 'Other', pct: 21 } ] },
    unemp: { value: 4.1 },
    income: { value: '$79,600', num: 79600,
      detail: `<strong>30% Rule:</strong> Max sustainable monthly rent ≈ <strong>$1,990</strong><br>Despite high income levels, West Coast rent burdens are extreme — median rents in SF and LA exceed this threshold significantly, meaning most tenants are already rent-burdened. Limits further rent growth.` },
  },
};

function getRegionData(regionName) {
  return window.APTUS_REGION_INSIGHTS?.regions?.[regionName] || REGION_DATA[regionName];
}

function getRegionLastUpdatedMessage() {
  const updated = window.APTUS_REGION_INSIGHTS?.metadata?.lastUpdatedDisplay;
  return updated ? `Data last updated ${updated}.` : 'Region data cache has not been refreshed yet.';
}

// ── State data ────────────────────────────────────────────────────────────────
function getStateData(stateName, regionName) {
  const NATIONAL_AVG_PTR = 17.5;
  const NATIONAL_AVG_TAX = 4.2;
  const bases = {
    Northeast: { migration: '−8,200', miDir: 'down',
      migDetail: 'Primarily driven by housing cost outflow from NY and NJ. MA and CT are holding more stable.',
      llScore: 'C+ / Tenant-Friendly', ptr: 22.4, ptrRaw: '22.4x', propTax: '1.89%',
      propTaxDetail: 'Effective rate = (Annual Tax Bill ÷ Assessed Value). At 1.89%, a $400K home costs ~$7,560/yr in property tax, or ~$630/mo added to operating costs.',
      incomeTax: 5.1, medPrice: '$485K' },
    Southeast:  { migration: '+18,400', miDir: 'up',
      migDetail: 'Florida and NC are primary absorption states. Strong domestic in-migration from Northeast and Midwest.',
      llScore: 'A− / Landlord-Friendly', ptr: 14.2, ptrRaw: '14.2x', propTax: '0.84%',
      propTaxDetail: 'Effective rate = (Annual Tax Bill ÷ Assessed Value). At 0.84%, a $300K home costs ~$2,520/yr in property tax, or ~$210/mo — one of the lowest burdens nationally.',
      incomeTax: 3.2, medPrice: '$312K' },
    Midwest:    { migration: '−4,100', miDir: 'down',
      migDetail: 'Net outflow concentrated in legacy metros. Growing secondary cities like Columbus and Indianapolis partially offset.',
      llScore: 'B / Moderate', ptr: 11.8, ptrRaw: '11.8x', propTax: '1.42%',
      propTaxDetail: 'Effective rate = (Annual Tax Bill ÷ Assessed Value). At 1.42%, a $220K home costs ~$3,124/yr in property tax, or ~$260/mo — moderate burden, manageable at Midwest price points.',
      incomeTax: 4.4, medPrice: '$228K' },
    Southwest:  { migration: '+12,600', miDir: 'up',
      migDetail: 'Texas and Arizona absorbing significant California and Pacific Northwest out-migrants.',
      llScore: 'B+ / Moderate', ptr: 16.1, ptrRaw: '16.1x', propTax: '0.96%',
      propTaxDetail: 'Effective rate = (Annual Tax Bill ÷ Assessed Value). At 0.96%, a $370K home costs ~$3,552/yr in property tax, or ~$296/mo.',
      incomeTax: 2.8, medPrice: '$368K' },
    West:       { migration: '+3,800', miDir: 'up',
      migDetail: 'International immigration offsetting domestic outflow. CA sees net domestic loss but international inflow.',
      llScore: 'D / Tenant-Friendly', ptr: 28.6, ptrRaw: '28.6x', propTax: '0.72%',
      propTaxDetail: 'Effective rate = (Annual Tax Bill ÷ Assessed Value). At 0.72%, a $600K home costs ~$4,320/yr in property tax, or ~$360/mo — low rate but high dollar amount due to asset prices.',
      incomeTax: 6.8, medPrice: '$612K' },
  };
  const d = bases[regionName] || bases.Midwest;
  // P/R spectrum: 10x (buy) → 30x (rent), national avg ~17.5x
  d.ptrPct = Math.min(100, Math.max(0, ((d.ptr - 10) / 20) * 100));
  // Income tax spectrum: 0% → 12%
  d.taxPct = Math.min(100, Math.max(0, (d.incomeTax / 12) * 100));
  return d;
}

// ── Market-area data ─────────────────────────────────────────────────────────
function getMarketData(marketName, regionName) {
  const bases = {
    Northeast: { migration: '−1,200', miDir: 'down',
      migDetail: 'Market-area outflow driven by housing costs. Urban cores often lose households to nearby suburban and exurban markets.',
      schoolRating: 'B+', grossYield: '5.8%', unemployment: 3.9, medPrice: '$428K', medPriceNum: 428000, medIncome: '$76,400', medIncomeNum: 76400,
      vacRate: '4.1%' },
    Southeast: { migration: '+3,800', miDir: 'up',
      migDetail: 'Strong market-area inflow tracking regional trend. Major metros and their suburban growth corridors are seeing the fastest absorption.',
      schoolRating: 'B−', grossYield: '7.4%', unemployment: 3.6, medPrice: '$284K', medPriceNum: 284000, medIncome: '$58,200', medIncomeNum: 58200,
      vacRate: '6.3%' },
    Midwest: { migration: '−600', miDir: 'down',
      migDetail: 'Modest outflow at the market level. Secondary metros are often stable while rural local markets remain more uneven.',
      schoolRating: 'B', grossYield: '8.6%', unemployment: 4.0, medPrice: '$198K', medPriceNum: 198000, medIncome: '$59,800', medIncomeNum: 59800,
      vacRate: '7.8%' },
    Southwest: { migration: '+2,400', miDir: 'up',
      migDetail: 'Market-area inflow consistent with regional trend. Outer suburban corridors are absorbing a large share of new demand.',
      schoolRating: 'B', grossYield: '6.9%', unemployment: 3.7, medPrice: '$336K', medPriceNum: 336000, medIncome: '$62,400', medIncomeNum: 62400,
      vacRate: '5.7%' },
    West: { migration: '+800', miDir: 'up',
      migDetail: 'Modest market-area inflow, largely international. Domestic out-migration from urban cores is partially offset by suburban gains.',
      schoolRating: 'A−', grossYield: '5.2%', unemployment: 4.2, medPrice: '$574K', medPriceNum: 574000, medIncome: '$74,800', medIncomeNum: 74800,
      vacRate: '4.8%' },
  };
  return bases[regionName] || bases.Midwest;
}

// ── Render helpers ────────────────────────────────────────────────────────────
function renderMetricCard(label, tipText, value, delta, dir) {
  return `<div class="metric-card">
    <p class="metric-label">${label}${tipText ? tip(tipText) : ''}</p>
    <p class="metric-value">${value}</p>
    <p class="metric-delta ${dir}">${dir==='up'?'↑':dir==='down'?'↓':'→'} ${delta}</p>
  </div>`;
}

function renderPanelHeader(tag, name, italicPart, subtitle, goal) {
  const body = goal
    ? `<p style="font-family:sans-serif;font-size:0.76rem;color:#9b9189;margin:4px 0 6px 0;">${subtitle}</p>
    <p style="font-family:sans-serif;font-size:0.76rem;color:#6b6560;margin:0;line-height:1.5;"><strong style="color:#1f1b18;">Goal:</strong> ${goal}</p>`
    : `<p style="font-family:sans-serif;font-size:0.76rem;color:#6b6560;margin:4px 0 0 0;line-height:1.5;">${subtitle}</p>`;
  return `<div class="panel-region-header">
    <p class="region-tag">${tag}</p>
    <h2>${name} <em>${italicPart}</em></h2>
    ${body}
  </div>`;
}

// ── Panel update functions ────────────────────────────────────────────────────
const LL_LAW_DETAIL = {
  Northeast: {
    summary: 'The Northeast generally favors tenants with strong protections around eviction timelines and rent stabilization.',
    points: ['Eviction proceedings typically take 3–6 months including mandatory notice periods','Several states (NY, NJ, MA) have active rent control or stabilization ordinances in major cities','Security deposit limits strictly enforced, typically capped at 1–2 months rent','Just Cause eviction requirements in many jurisdictions limit non-renewal flexibility'],
  },
  Southeast: {
    summary: 'The Southeast has some of the most landlord-favorable laws in the country with fast eviction timelines and minimal rent restrictions.',
    points: ['Eviction proceedings often resolved in 3–6 weeks from filing','No statewide rent control — preempted in most Southeast states','Landlords retain broad rights to non-renew without cause in most jurisdictions','Security deposit terms and late fee structures are largely unregulated'],
  },
  Midwest: {
    summary: 'Midwest states are generally balanced with straightforward eviction processes and limited rent restrictions.',
    points: ['Eviction timelines average 4–8 weeks depending on county court load','Rent control is rare and preempted at the state level in most Midwest states','Tenant habitability standards are enforced but practical and well-defined','Self-help eviction prohibited but lockout enforcement is reliable'],
  },
  Southwest: {
    summary: 'Southwest states lean landlord-friendly with efficient court systems and minimal rent regulation.',
    points: ['Eviction proceedings average 3–5 weeks from notice to writ','Texas and Arizona have strong preemption of local rent control','Late fees and lease terms have wide landlord discretion in most states','New Mexico is the notable exception with more tenant-protective statutes'],
  },
  West: {
    summary: 'The West Coast has the most tenant-protective legal environment in the US, with extensive rent control, long eviction timelines, and heavy regulation.',
    points: ['California evictions average 3–6 months including mandatory mediation in many cities','Statewide rent control (AB 1482) caps annual increases at 5% + CPI for most units','Just Cause eviction required after 12 months tenancy in California and Oregon','Tenant relocation assistance required in many jurisdictions for no-fault terminations','Local ordinances in LA, SF, Oakland, Seattle add additional layered protections'],
  },
};

const REGION_MIGRATION_HISTORY = {
  Northeast: [ {year:'2019',val:-18},{year:'2020',val:-24},{year:'2021',val:-32},{year:'2022',val:-28},{year:'2023',val:-22} ],
  Southeast: [ {year:'2019',val:62},{year:'2020',val:78},{year:'2021',val:98},{year:'2022',val:88},{year:'2023',val:86} ],
  Midwest:   [ {year:'2019',val:-10},{year:'2020',val:-14},{year:'2021',val:-22},{year:'2022',val:-18},{year:'2023',val:-22} ],
  Southwest: [ {year:'2019',val:44},{year:'2020',val:52},{year:'2021',val:72},{year:'2022',val:68},{year:'2023',val:62} ],
  West:      [ {year:'2019',val:28},{year:'2020',val:18},{year:'2021',val:8},{year:'2022',val:6},{year:'2023',val:10} ],
};

let _migTileExpanded = false;
function getRegionMigrationHistory(regionName) {
  return getRegionData(regionName)?.migration?.history || REGION_MIGRATION_HISTORY[regionName] || [];
}

function toggleMigrationTile(regionName) {
  if (_regionMetricGridAnimating) return;
  _migTileExpanded = !_migTileExpanded;
  const tile  = document.getElementById('mig-tile');
  const chart = document.getElementById('mig-chart');
  const hint  = document.getElementById('mig-hint');
  if (!tile || !chart) return;

  if (_migTileExpanded) {
    // Build chart content first while hidden
    const history = getRegionMigrationHistory(regionName);
    if (!history.length) {
      chart.innerHTML = `${renderForecastSignal(regionName, getRegionData(regionName), 'migration')}`;
      animateRegionMetricGrid(() => {
        tile.classList.add('expanded');
        chart.classList.add('open');
        chart.style.setProperty('--target-height', `${Math.min(chart.scrollHeight, 220)}px`);
        if (hint) hint.textContent = 'Click to collapse';
      }, { activeCard: tile });
      return;
    }
    const maxAbs = Math.max(...history.map(d => Math.abs(d.val)));
    chart.innerHTML = history.map(d => {
      const pct = maxAbs > 0 ? (Math.abs(d.val) / maxAbs * 100).toFixed(1) : 0;
      const cls = d.val >= 0 ? 'positive' : 'negative';
      const label = (d.val >= 0 ? '+' : '') + d.val + 'K';
      return `<div class="tile-chart-bar-row">
        <span class="tile-chart-bar-label">${d.year}</span>
        <div class="tile-chart-bar-track">
          <div class="tile-chart-bar-fill ${cls}" style="width:0%" data-w="${pct}"></div>
        </div>
        <span class="tile-chart-bar-value">${label}</span>
      </div>`;
    }).join('') + renderForecastSignal(regionName, getRegionData(regionName), 'migration');
    animateRegionMetricGrid(() => {
      tile.classList.add('expanded');
      chart.classList.add('open');
      chart.style.setProperty('--target-height', `${Math.min(chart.scrollHeight, 220)}px`);
      if (hint) hint.textContent = 'Click to collapse';
    }, {
      activeCard: tile,
      afterReveal: () => {
        requestAnimationFrame(() => {
          chart.querySelectorAll('.tile-chart-bar-fill').forEach(b => { b.style.width = b.dataset.w + '%'; });
        });
      }
    });
  } else {
    animateRegionMetricGrid(() => {
      tile.classList.remove('expanded');
      chart.classList.remove('open');
      chart.style.setProperty('--target-height', '0px');
      if (hint) hint.textContent = 'Click to expand';
    }, { activeCard: tile });
  }

  // Tile uses max-height CSS transition — panel is already height:auto, no interference
}

function updatePanelForRegion(regionName) {
  const d = getRegionData(regionName);
  if (!d) return;
  const rpp = d.rpp || d.col;
  const rppNum = parseFloat(rpp.value);
  const rppDisplay = {
    ...rpp,
    dir: Number.isFinite(rppNum) ? (rppNum > 103 ? 'up' : rppNum < 97 ? 'down' : 'flat') : rpp.dir,
    delta: Number.isFinite(rppNum) ? (rppNum > 103 ? 'Above US avg' : rppNum < 97 ? 'Below US avg' : 'Near US avg') : rpp.delta
  };
  const renter = d.renter || d.own;
  const migrationLabel = classifyMigrationRate(d.migration.value, d.migration.delta, d.migration.dir);
  const nationalUnemp = d.unemp.national || 3.9;

  // Regional Price Parity: 70 (cheap) → 140 (expensive), national = 100
  const rppPct = Math.min(100, Math.max(0, ((rppNum - 70) / 70) * 100));

  // GDP: 0% → 5%
  const gdpNum = parseFloat(d.gdp.value);
  const gdpExtent = getRegionMetricExtent('gdp');
  const gdpRange = Math.max(0.1, gdpExtent.max - gdpExtent.min);
  const gdpPct = Math.min(100, Math.max(0, ((gdpNum - gdpExtent.min) / gdpRange) * 100));

  // Renter household share: 20% → 50%
  const renterNum = parseFloat(renter.value);
  const renterPct = Math.min(100, Math.max(0, ((renterNum - 20) / 30) * 100));

  const otherBreakdownTip = formatOtherBreakdownTip(d.econ.otherBreakdown);
  const econBreakdown = d.econ.breakdown.map(s => `
    <div style="margin-bottom:5px;">
      <div style="display:flex;justify-content:space-between;font-size:0.72rem;margin-bottom:2px;">
        <span>${s.sector}${s.sector === 'Other' ? tip(otherBreakdownTip) : ''}</span><span style="color:#1f1b18;font-weight:600;">${s.pct}%</span>
      </div>
      <div style="height:5px;border-radius:2px;background:rgba(31,27,24,0.08);">
        <div style="height:100%;width:${s.pct}%;border-radius:2px;background:#c4b49a;"></div>
      </div>
    </div>`).join('') + renderForecastSignal(regionName, d, 'econ');
  const rppVisual = renderTeachingScale({
    pct: rppPct,
    value: rpp.value,
    leftLabel: 'Lower cost',
    midLabel: 'US baseline',
    rightLabel: 'Higher cost',
    baselinePct: Math.min(100, Math.max(0, ((100 - 70) / 70) * 100)),
    baselineLabel: '100',
    baselineTickLabel: 'US baseline',
  });
  const gdpVisual = renderRangeComparisonVisual({
    pct: gdpPct,
    value: d.gdp.value,
    lowLabel: `Low ${formatPctLabel(gdpExtent.min)}`,
    midLabel: formatPctLabel(2.4),
    highLabel: `High ${formatPctLabel(gdpExtent.max)}`,
  });
  const renterVisual = renderRenterShareScale({
    pct: renterPct,
    value: renter.value,
    leftLabel: 'Owner-heavy',
    midLabel: 'US baseline',
    rightLabel: 'Renter-heavy',
    baselinePct: Math.min(100, Math.max(0, ((35 - 20) / 30) * 100)),
    baselineLabel: '35%',
    baselineTickLabel: 'US baseline',
  });
  const burdenVisual = renderRentBurdenVisual(d.income.rentBurden, d.income.nationalRentBurden);

  _migTileExpanded = false;
  animatePanelContent(`
    ${renderPanelHeader(d.tag, regionName, 'Markets', d.summary || d.subtitle || '')}
    <div class="panel-divider"></div>
    <p class="panel-section-label">Key Indicators</p>
    <div class="metric-grid" id="region-metric-grid">

      <div class="metric-card expandable" id="mig-tile" onclick="toggleMigrationTile('${regionName}')">
        ${renderMaximizeButton(regionName, 'migration')}
        <p class="metric-label">Net Migration Rate${sourceTip(METRIC_DESCRIPTIONS.migration, d.migration)}</p>
        <p class="metric-value">${d.migration.value}</p>
        <p class="metric-delta ${migrationLabel.dir}">${migrationLabel.dir==='up'?'↑':migrationLabel.dir==='down'?'↓':'→'} ${migrationLabel.delta}</p>
        <p class="tile-expand-hint" id="mig-hint">Click to expand</p>
        <div class="tile-chart-wrap" id="mig-chart"></div>
      </div>

      <div class="metric-card expandable" onclick="toggleExpand('col-r')">
        ${renderMaximizeButton(regionName, 'rpp')}
        <p class="metric-label">Regional Price Parity${sourceTip(METRIC_DESCRIPTIONS.rpp, rppDisplay)}</p>
        <p class="metric-value">${rppDisplay.value}</p>
        <p class="metric-delta ${rppDisplay.dir}">${rppDisplay.dir==='up'?'↑':rppDisplay.dir==='down'?'↓':'→'} ${rppDisplay.delta}</p>
        <p class="tile-expand-hint">Click to expand</p>
        <div class="tile-chart-wrap" id="expand-col-r">
          ${rppVisual}
          ${renderForecastSignal(regionName, d, 'rpp')}
        </div>
      </div>

      <div class="metric-card expandable" onclick="toggleExpand('gdp-r')">
        ${renderMaximizeButton(regionName, 'gdp')}
        <p class="metric-label">Real GDP Growth${sourceTip(METRIC_DESCRIPTIONS.gdp, d.gdp)}</p>
        <p class="metric-value">${d.gdp.value}</p>
        <p class="metric-delta ${d.gdp.dir}">${d.gdp.dir==='up'?'↑':d.gdp.dir==='down'?'↓':'→'} ${d.gdp.delta}</p>
        <p class="tile-expand-hint">Click to expand</p>
        <div class="tile-chart-wrap" id="expand-gdp-r">
          ${gdpVisual}
          ${renderForecastSignal(regionName, d, 'gdp')}
        </div>
      </div>

      <div class="metric-card expandable" onclick="toggleExpand('own-r')">
        ${renderMaximizeButton(regionName, 'renter')}
        <p class="metric-label">Renter Household Share${sourceTip(METRIC_DESCRIPTIONS.renter, renter)}</p>
        <p class="metric-value">${renter.value}</p>
        <p class="metric-delta ${renter.dir}">${renter.dir==='up'?'↑':renter.dir==='down'?'↓':'→'} ${renter.delta}</p>
        <p class="tile-expand-hint">Click to expand</p>
        <div class="tile-chart-wrap" id="expand-own-r">
          ${renterVisual}
          ${renderForecastSignal(regionName, d, 'renter')}
        </div>
      </div>

    </div>
    <div class="panel-divider"></div>
    <p class="panel-section-label">Supporting Data</p>
    ${expandRow('econ-r', 'Economic Diversification',
      sourceText('Economic diversification helps show whether a region depends too heavily on one employment sector or has a broader, more resilient tenant base.', d.econ),
      d.econ.value, econBreakdown)}
    <div class="trend-row expand-row" onclick="toggleExpand('unemp-r')">
      <span class="trend-label">Avg Unemployment Rate${sourceTip(`Average unemployment shows how much slack exists in the regional labor market compared with the national rate of ${nationalUnemp}%. Use it to evaluate tenant income stability and near-term leasing risk.`, d.unemp)}
        <span class="expand-chevron" id="chevron-unemp-r">▾</span>
      </span>
      <span class="trend-value">${d.unemp.value}%</span>
    </div>
    <div class="expand-detail" id="expand-unemp-r">
      <div class="expand-detail-inner">${renderUnempBar(d.unemp.value, nationalUnemp)}${renderForecastSignal(regionName, d, 'unemp')}</div>
    </div>
    ${expandRow('burden-r', 'Rent-Burdened Renter Share',
      sourceText('Rent-burdened renter share shows how much of the renter base is already financially stretched, which is more useful at the regional level than a broad rent range.', d.income),
      d.income.rentBurden || 'N/A',
      `${burdenVisual}${renderForecastSignal(regionName, d, 'burden')}`)}
    <p class="panel-disclaimer">${getRegionLastUpdatedMessage()}</p>
  `);
}

function updatePanelForState(stateName, regionName) {
  const d = getStateData(stateName, regionName);
  const ll = LL_LAW_DETAIL[regionName] || { summary: '', points: [] };

  // Median home price spectrum: $100K–$800K
  const priceNum = parseFloat(d.medPrice.replace(/[^0-9.]/g, '')) * (d.medPrice.includes('K') ? 1000 : 1);
  const pricePct = Math.min(100, Math.max(0, ((priceNum - 100000) / 700000) * 100));

  animatePanelContent(`
    ${renderPanelHeader('State Overview', stateName, 'Market', 'Legal, tax & regulatory profile', 'Assess legal, tax, and regulatory risk.')}
    <div class="panel-divider"></div>
    <p class="panel-section-label">Key Indicators</p>
    <div class="metric-grid">

      <div class="metric-card expandable" onclick="toggleExpand('mig-s')">
        <p class="metric-label">Net Migration (1yr)${tip('Annual net population flow into the state. Inflow supports rental demand; outflow signals a declining tenant pool.')}</p>
        <p class="metric-value">${d.migration}</p>
        <p class="metric-delta ${d.miDir}">${d.miDir==='up'?'↑ Inflow':'↓ Outflow'}</p>
        <p class="tile-expand-hint">Click to expand</p>
        <div class="tile-chart-wrap" id="expand-mig-s">
          <div style="padding-top:8px;font-size:0.72rem;color:#6b6560;line-height:1.5;">${d.migDetail}</div>
        </div>
      </div>

      <div class="metric-card expandable" onclick="toggleExpand('price-s')">
        <p class="metric-label">Median Home Price${tip('Statewide median sale price. Context for the P/R ratio and entry cost.')}</p>
        <p class="metric-value">${d.medPrice}</p>
        <p class="metric-delta flat">→ Statewide avg</p>
        <p class="tile-expand-hint">Click to expand</p>
        <div class="tile-chart-wrap" id="expand-price-s">
          ${renderSpectrum(pricePct, '$100K', '$800K+', `${d.medPrice} statewide median · national ~$420K`)}
        </div>
      </div>

      <div class="metric-card expandable" onclick="toggleExpand('ptr-s')">
        <p class="metric-label">Price-to-Rent Ratio${tip('Home price ÷ annual rent. Below 15x favors buying; above 20x favors renting.')}</p>
        <p class="metric-value">${d.ptrRaw}</p>
        <p class="metric-delta flat">→ P/R multiple</p>
        <p class="tile-expand-hint">Click to expand</p>
        <div class="tile-chart-wrap" id="expand-ptr-s">
          ${renderSpectrum(d.ptrPct, 'Buy (10x)', 'Rent (30x)', `${d.ptrRaw} · national avg ~17.5x`, 'Neutral (17.5x)')}
        </div>
      </div>

      <div class="metric-card expandable" onclick="toggleExpand('tax-r')">
        <p class="metric-label">Effective Property Tax${tip('Annual tax ÷ assessed value. Directly reduces net operating income.')}</p>
        <p class="metric-value">${d.propTax}</p>
        <p class="metric-delta flat">→ Avg effective rate</p>
        <p class="tile-expand-hint">Click to expand</p>
        <div class="tile-chart-wrap" id="expand-tax-r">
          <div style="padding-top:8px;font-size:0.72rem;color:#6b6560;line-height:1.5;">${d.propTaxDetail}</div>
        </div>
      </div>

    </div>
    <div class="panel-divider"></div>
    <p class="panel-section-label">Regulatory Environment</p>
    <div class="trend-row expand-row" onclick="toggleExpand('ll-s')">
      <span class="trend-label">Landlord-Tenant Laws${tip('A/B = landlord-friendly; D/F = tenant-friendly. Click to expand.')}
        <span class="expand-chevron" id="chevron-ll-s">▾</span>
      </span>
      <span class="trend-value">${d.llScore}</span>
    </div>
    <div class="expand-detail" id="expand-ll-s">
      <div class="expand-detail-inner">${ll.summary}<ul>${ll.points.map(p=>`<li>${p}</li>`).join('')}</ul></div>
    </div>
    ${expandRow('itax-s', 'State Income Tax',
      'Top marginal state income tax rate. Affects tenant take-home pay and owner profits.',
      `${d.incomeTax}%`,
      renderSpectrum(d.taxPct, '0% (no tax)', '12%+ (highest)', `${d.incomeTax}% marginal rate · national avg ~4.2%`))}
    <p class="panel-disclaimer">* Placeholder data. Connect a data source to populate live metrics.</p>
  `);
}

function updatePanelForMarket(marketInfo, regionName) {
  const market = typeof marketInfo === 'string'
    ? { name: marketInfo, type: 'market', counties: '' }
    : (marketInfo || {});
  const marketName = market.name || market.label || 'Market Area';
  const marketKind = market.type === 'metro'
    ? 'Metro Market'
    : market.type === 'micro'
      ? 'Secondary Market'
      : 'Local Market';
  const countyList = String(market.counties || '')
    .split(',')
    .map(name => name.trim())
    .filter(Boolean);
  const d = getMarketData(marketName, regionName);
  const incAfford = `$${Math.round(d.medIncomeNum/12*0.25).toLocaleString()} – $${Math.round(d.medIncomeNum/12*0.33).toLocaleString()}/mo`;
  const inc30 = Math.round(d.medIncomeNum/12*0.30).toLocaleString();

  // Gross yield: 3%–12%
  const yieldNum = parseFloat(d.grossYield);
  const yieldPct = Math.min(100, Math.max(0, ((yieldNum - 3) / 9) * 100));

  // Vacancy: 2%–12%
  const vacNum = parseFloat(d.vacRate);
  const vacPct = Math.min(100, Math.max(0, ((vacNum - 2) / 10) * 100));
  const vacDir = vacNum < 5 ? 'Tight market' : vacNum > 8 ? 'Oversupplied' : 'Moderate supply';

  // Median home price spectrum: $100K–$800K
  const priceNum = d.medPriceNum;
  const pricePct = Math.min(100, Math.max(0, ((priceNum - 100000) / 700000) * 100));

  animatePanelContent(`
    ${renderPanelHeader('Market Area Overview', marketName, marketKind, 'Investment market demand profile', 'Evaluate the broader investable market before narrowing to cities.')}
    <div class="panel-divider"></div>
    <p class="panel-section-label">Key Indicators</p>
    <div class="metric-grid">

      <div class="metric-card expandable" onclick="toggleExpand('mig-c')">
        <p class="metric-label">Net Migration (1yr)${tip('Annual net population flow into the selected market area. 1–3 year data is most actionable at this level.')}</p>
        <p class="metric-value">${d.migration}</p>
        <p class="metric-delta ${d.miDir}">${d.miDir==='up'?'↑ Inflow':'↓ Outflow'}</p>
        <p class="tile-expand-hint">Click to expand</p>
        <div class="tile-chart-wrap" id="expand-mig-c">
          <div style="padding-top:8px;font-size:0.72rem;color:#6b6560;line-height:1.5;">${d.migDetail}</div>
        </div>
      </div>

      <div class="metric-card expandable" onclick="toggleExpand('yield-c')">
        <p class="metric-label">Gross Rental Yield${tip('Annual gross rent ÷ median home price. Pre-vacancy, pre-expense income indicator.')}</p>
        <p class="metric-value">${d.grossYield}</p>
        <p class="metric-delta flat">→ Pre-vacancy gross</p>
        <p class="tile-expand-hint">Click to expand</p>
        <div class="tile-chart-wrap" id="expand-yield-c">
          ${renderSpectrum(yieldPct, 'Low (3%)', 'High (12%+)', `${d.grossYield} gross yield · national avg ~6%`)}
        </div>
      </div>

      <div class="metric-card expandable" onclick="toggleExpand('vac-c')">
        <p class="metric-label">Rental Vacancy Rate${tip('Share of rental units unoccupied. Below 5% = tight market; above 8% = oversupplied.')}</p>
        <p class="metric-value">${d.vacRate}</p>
        <p class="metric-delta flat">→ ${vacDir}</p>
        <p class="tile-expand-hint">Click to expand</p>
        <div class="tile-chart-wrap" id="expand-vac-c">
          ${renderSpectrum(vacPct, 'Tight (2%)', 'Oversupplied (12%)', `${d.vacRate} vacancy · &lt;5% favors landlords`)}
        </div>
      </div>

      <div class="metric-card expandable" onclick="toggleExpand('unemp-c')">
        <p class="metric-label">Unemployment${tip('Local unemployment vs. national avg. High rates weaken tenant income stability.')}</p>
        <p class="metric-value">${d.unemployment}%</p>
        <p class="metric-delta flat">→ Local rate</p>
        <p class="tile-expand-hint">Click to expand</p>
        <div class="tile-chart-wrap" id="expand-unemp-c">
          ${renderUnempBar(d.unemployment)}
        </div>
      </div>

    </div>
    <div class="panel-divider"></div>
    <p class="panel-section-label">Lifestyle & Demand Drivers</p>
    ${countyList.length ? `
    <div class="trend-row">
      <span class="trend-label">Included Counties${tip('Market areas are county-backed CBSA or local county groupings, but presented as investor markets rather than administrative drilldown gates.')}</span>
      <span class="trend-value">${countyList.slice(0, 3).join(', ')}${countyList.length > 3 ? ` +${countyList.length - 3}` : ''}</span>
    </div>` : ''}
    <div class="trend-row">
      <span class="trend-label">School District Rating${tip('Primary driver of SFH tenant longevity — families relocate for schools and stay long-term.')}</span>
      <span class="trend-value">${d.schoolRating}</span>
    </div>
    ${expandRow('inc-c', 'Median Household Income',
      'Market-area median income proxy. Sets the practical rent ceiling — households should spend ≤30% of gross on rent.',
      d.medIncome,
      `<strong>30% Rule:</strong> Max sustainable rent ≈ <strong>$${inc30}/mo</strong><br>Affordable range: ${incAfford}<br><br>Use this to assess whether your target rent is within reach of the local tenant pool.`)}
    ${expandRow('calc-c', 'Median Home Price',
      'Market-area median sale price proxy. Use the calculator to estimate monthly mortgage payments.',
      d.medPrice,
      renderMortgageCalc('c', d.medPrice))}
    <p class="panel-disclaimer">* Placeholder data. Connect a data source to populate live metrics.</p>
  `);
  setTimeout(() => calcMortgage('c'), 50);
}

// ── City level panel ─────────────────────────────────────────────────────────
function getCityData(cityName, regionName) {
  const bases = {
    Northeast: { migration:'+320',  miDir:'up',   migDetail:'Urban core cities see domestic outflow offset by international immigration. Smaller towns near major metros are gaining.', avgRent:'$1,840', rentPrice:'0.38%', vacancy:'4.2%', crimeIndex:38, dom:18, fmr1br:'$1,420', fmr2br:'$1,680', walkScore:82, medPrice:'$395K', medPriceNum:395000 },
    Southeast:  { migration:'+1,240',miDir:'up',   migDetail:'Suburban and secondary cities absorb domestic migration from coastal metros. Strong job creation driving inflow.',         avgRent:'$1,320', rentPrice:'0.46%', vacancy:'5.8%', crimeIndex:52, dom:28, fmr1br:'$1,080', fmr2br:'$1,290', walkScore:44, medPrice:'$268K', medPriceNum:268000 },
    Midwest:    { migration:'+180',  miDir:'up',   migDetail:'Secondary Midwest cities gaining modestly. Legacy metro cores stable while surrounding suburbs grow.',                     avgRent:'$1,090', rentPrice:'0.55%', vacancy:'7.2%', crimeIndex:48, dom:34, fmr1br:'$880',  fmr2br:'$1,060', walkScore:38, medPrice:'$185K', medPriceNum:185000 },
    Southwest:  { migration:'+2,100',miDir:'up',   migDetail:'Fast-growing cities absorbing California and Pacific Northwest out-migrants. Job market and affordability driving inflow.', avgRent:'$1,480', rentPrice:'0.40%', vacancy:'5.1%', crimeIndex:44, dom:22, fmr1br:'$1,180', fmr2br:'$1,410', walkScore:52, medPrice:'$342K', medPriceNum:342000 },
    West:       { migration:'+420',  miDir:'up',   migDetail:'International immigration offsetting domestic outflow in major cities. Suburban cities gaining from urban exodus.',          avgRent:'$2,180', rentPrice:'0.35%', vacancy:'3.8%', crimeIndex:42, dom:16, fmr1br:'$1,840', fmr2br:'$2,240', walkScore:74, medPrice:'$580K', medPriceNum:580000 },
  };
  return bases[regionName] || bases.Midwest;
}

function updatePanelForCity(cityName, regionName, boundaryType = 'incorporated') {
  const d = getCityData(cityName, regionName);
  const isCommunity = ['cdp', 'county-subdivision', 'community-search-area'].includes(boundaryType);
  const overviewLabel = isCommunity ? 'Community Overview' : 'City Overview';
  const placeKind = boundaryType === 'cdp'
    ? 'Census Designated Place'
    : boundaryType === 'county-subdivision'
      ? 'Unincorporated / Township Area'
      : boundaryType === 'community-search-area'
        ? 'Community Search Area'
        : 'Market';
  const boundaryNote = boundaryType === 'community-search-area'
    ? '<p class="panel-disclaimer">This named community has no local legal polygon in the current dataset, so Avenue uses a small market-clipped search area to keep the path to listings available.</p>'
    : '';
  const rtpNum  = parseFloat(d.rentPrice);
  const rtpPct  = Math.min(100, Math.max(0, ((rtpNum - 0.4) / 0.8) * 100));
  const vacNum  = parseFloat(d.vacancy);
  const vacPct  = Math.min(100, Math.max(0, ((vacNum - 2) / 10) * 100));
  const crimePct = Math.min(100, d.crimeIndex);
  const crimeLabel = d.crimeIndex < 30 ? 'Low' : d.crimeIndex < 55 ? 'Moderate' : 'High';
  const domPct  = Math.min(100, Math.max(0, ((d.dom - 7) / 53) * 100));

  animatePanelContent(`
    ${renderPanelHeader(overviewLabel, cityName, placeKind, 'Deal-specific profitability profile', 'Calculate deal-specific profitability.')}
    <div class="panel-divider"></div>
    <p class="panel-section-label">Key Indicators</p>
    <div class="metric-grid">
      <div class="metric-card expandable" onclick="toggleExpand('mig-city')">
        <p class="metric-label">Net Migration (1yr)${tip('Annual net population flow. Recent inflow signals growing rental demand.')}</p>
        <p class="metric-value">${d.migration}</p>
        <p class="metric-delta ${d.miDir}">${d.miDir==='up'?'↑ Inflow':'↓ Outflow'}</p>
        <p class="tile-expand-hint">Click to expand</p>
        <div class="tile-chart-wrap" id="expand-mig-city">
          <div style="padding-top:8px;font-size:0.72rem;color:#6b6560;line-height:1.5;">${d.migDetail}</div>
        </div>
      </div>
      <div class="metric-card expandable" onclick="toggleExpand('rtp-city')">
        <p class="metric-label">Rent-to-Price Ratio${tip('Monthly rent ÷ purchase price. The 1% rule = ≥1.0%. Higher = better cash flow.')}</p>
        <p class="metric-value">${d.rentPrice}</p>
        <p class="metric-delta ${rtpNum>=0.9?'up':rtpNum>=0.6?'flat':'down'}">${rtpNum>=1.0?'↑ Meets 1% rule':rtpNum>=0.7?'→ Near 1% rule':'↓ Below 1% rule'}</p>
        <p class="tile-expand-hint">Click to expand</p>
        <div class="tile-chart-wrap" id="expand-rtp-city">
          ${renderSpectrum(rtpPct, 'Low (0.4%)', '1%+ rule', `${d.rentPrice} · 1% threshold = 1.0%`)}
        </div>
      </div>
      <div class="metric-card expandable" onclick="toggleExpand('vac-city')">
        <p class="metric-label">Avg Vacancy Rate${tip('Share of rental units unoccupied. Below 5% = strong demand; above 8% = oversupply.')}</p>
        <p class="metric-value">${d.vacancy}</p>
        <p class="metric-delta ${vacNum<5?'up':vacNum>8?'down':'flat'}">${vacNum<5?'↑ Strong demand':vacNum>8?'↓ Oversupplied':'→ Moderate'}</p>
        <p class="tile-expand-hint">Click to expand</p>
        <div class="tile-chart-wrap" id="expand-vac-city">
          ${renderSpectrum(vacPct, 'Tight (2%)', 'Oversupplied (12%)', `${d.vacancy} vacancy · &lt;5% favors landlords`)}
        </div>
      </div>
      <div class="metric-card expandable" onclick="toggleExpand('crime-city')">
        <p class="metric-label">Crime Index${tip('Composite crime score 0–100. Lower = safer. Affects tenant quality and insurance costs.')}</p>
        <p class="metric-value">${d.crimeIndex}</p>
        <p class="metric-delta ${d.crimeIndex<35?'up':d.crimeIndex<60?'flat':'down'}">${d.crimeIndex<35?'↑ Low crime':d.crimeIndex<60?'→ Moderate':'↓ High crime'}</p>
        <p class="tile-expand-hint">Click to expand</p>
        <div class="tile-chart-wrap" id="expand-crime-city">
          ${renderSpectrum(crimePct, 'Safe (0)', 'High risk (100)', `${d.crimeIndex} index · ${crimeLabel} · 55 = national avg`, "55 = nat'l avg")}
        </div>
      </div>
    </div>
    <div class="panel-divider"></div>
    <p class="panel-section-label">Market Intelligence</p>
    ${expandRow('dom-city', 'Avg Days on Market', 'Days from listing to contract. Low DOM = competitive market.', `${d.dom} days`,
      renderSpectrum(domPct, 'Hot (7d)', 'Slow (60d+)', `${d.dom} days · national avg ~38 days`))}
    ${expandRow('fmr-city', 'HUD Fair Market Rent', 'HUD payment standard for Section 8 vouchers. Landlords accepting vouchers cannot exceed FMR.', `${d.fmr2br} (2BR)`,
      `<div class="trend-row"><span class="trend-label">1 Bedroom</span><span class="trend-value">${d.fmr1br}/mo</span></div>
       <div class="trend-row"><span class="trend-label">2 Bedroom</span><span class="trend-value">${d.fmr2br}/mo</span></div>
       <div style="margin-top:8px;font-size:0.72rem;color:#6b6560;line-height:1.5;">Compare to your target rent to assess Section 8 feasibility.</div>`)}
    ${expandRow('walk-city', 'Walk Score', 'Walkability 0–100. Higher scores drive tenant retention and reduce turnover.', `${d.walkScore}/100`,
      renderSpectrum(d.walkScore, 'Car dependent (0)', "Walker's paradise (100)", `${d.walkScore}/100 · ${d.walkScore>=70?'Very walkable':d.walkScore>=50?'Somewhat walkable':'Car dependent'}`))}
    ${expandRow('calc-city', 'Median Home Price', 'Local median sale price. Use the calculator to estimate monthly P&I payments.', d.medPrice,
      renderMortgageCalc('city', d.medPrice))}
    ${boundaryNote}
    <p class="panel-disclaimer">* Placeholder data. Connect a data source to populate live metrics.</p>
  `);
  setTimeout(() => calcMortgage('city'), 50);
}

function updatePanelForNeighborhood(neighborhoodName, cityName, regionName, boundarySource = 'generated') {
  const d = getCityData(cityName, regionName);
  const boundaryNote = boundarySource === 'true'
    ? 'Neighborhood boundary loaded from the configured boundary dataset.'
    : 'Neighborhood area generated from Mapbox neighborhood/locality labels and clipped to the selected city boundary. Add a city-specific boundary file to R2 to replace this fallback.';
  animatePanelContent(`
    ${renderPanelHeader('Neighborhood Overview', neighborhoodName, cityName, 'Block-level acquisition context', 'Compare micro-location quality within the selected city.')}
    <div class="panel-divider"></div>
    <p class="panel-section-label">Micro-Market Signals</p>
    <div class="metric-grid">
      <div class="metric-card">
        <p class="metric-label">Parent Market</p>
        <p class="metric-value" style="font-size:1.05rem">${cityName}</p>
        <p class="metric-delta flat">City context</p>
      </div>
      <div class="metric-card">
        <p class="metric-label">Walk Score Proxy${tip('Placeholder score inherited from city-level profile until parcel/neighborhood data is connected.')}</p>
        <p class="metric-value">${d.walkScore}</p>
        <p class="metric-delta ${d.walkScore>=70?'up':d.walkScore>=50?'flat':'down'}">${d.walkScore>=70?'↑ Very walkable':d.walkScore>=50?'→ Somewhat walkable':'↓ Car dependent'}</p>
      </div>
      <div class="metric-card">
        <p class="metric-label">Median Price Context</p>
        <p class="metric-value">${d.medPrice}</p>
        <p class="metric-delta flat">City baseline</p>
      </div>
      <div class="metric-card">
        <p class="metric-label">Avg Rent Context</p>
        <p class="metric-value">${d.avgRent}</p>
        <p class="metric-delta flat">City baseline</p>
      </div>
    </div>
    <div class="panel-divider"></div>
    <p class="panel-section-label">Boundary Note</p>
    <p class="panel-disclaimer">${boundaryNote}</p>
  `);
}

// ── Panel animation & reset ──────────────────────────────────────────────────
let _panelAnimTimer = null;
function animatePanelContent(newHTML) {
  const panel = document.getElementById('market-panel');
  const inner = document.getElementById('panel-inner');
  if (!panel || !inner) return;

  if (_panelAnimTimer !== null) { clearTimeout(_panelAnimTimer); _panelAnimTimer = null; }

  // Fade out current content
  inner.classList.remove('fade-in');

  _panelAnimTimer = setTimeout(() => {
    _panelAnimTimer = null;

    // Measure current inner height (scroll container)
    const fromH = inner.offsetHeight;

    // Inject new content
    inner.innerHTML = newHTML;
    inner.scrollTop = 0;

    // Temporarily remove max-height constraint to measure natural height
    inner.style.maxHeight = 'none';
    const naturalH = inner.scrollHeight;
    const viewH = window.innerHeight - 120;
    const toH = Math.min(naturalH, viewH);

    // Restore from-height and disable transition momentarily
    inner.style.maxHeight = fromH + 'px';
    inner.style.transition = 'none';

    requestAnimationFrame(() => {
      // Re-enable transition and animate to target height
      inner.style.transition = '';
      requestAnimationFrame(() => {
        inner.style.maxHeight = toH + 'px';

        function onEnd(e) {
          if (e.propertyName !== 'max-height') return;
          inner.removeEventListener('transitionend', onEnd);
          // If content fits, release to auto so tile expansions work freely
          inner.style.maxHeight = naturalH <= viewH ? '' : toH + 'px';
          inner.classList.add('fade-in');
        }
        inner.addEventListener('transitionend', onEnd);

        // Fallback
        _panelAnimTimer = setTimeout(() => {
          _panelAnimTimer = null;
          inner.removeEventListener('transitionend', () => {});
          inner.style.maxHeight = naturalH <= viewH ? '' : toH + 'px';
          inner.classList.add('fade-in');
        }, 550);
      });
    });
  }, 200);
}

function resetPanelToPrompt() {
  animatePanelContent(`
    <div class="market-panel-prompt" id="panel-prompt">
      <h2>Explore <em>market<br>insights</em> by region</h2>
      <p>Click on any region to unlock detailed market metrics — from price trends and cap rates to rental demand and inventory levels.</p>
      <div class="prompt-hint">
        <div class="prompt-hint-icon">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1f1b18" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>
        </div>
        <span>Click a region on the map to get started</span>
      </div>
    </div>`);
}
