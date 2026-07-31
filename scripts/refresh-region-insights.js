// Refreshes cached region-level market insight data.
//
// Toggle AI summary updates independently with:
//   AI_SUMMARY_UPDATES=1 OPENAI_API_KEY=... npm run refresh:regions
//
// Data refreshes always run. When AI_SUMMARY_UPDATES is not enabled, summaries
// are updated with deterministic source-backed text.

const fs = require('fs');
const path = require('path');

const AI_SUMMARY_UPDATES = /^(1|true|yes)$/i.test(process.env.AI_SUMMARY_UPDATES || '');
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
const OUT_PATH = path.join(__dirname, '..', 'data/generated/region-insights.js');
const TIME_ZONE = 'America/New_York';

const REGION_STATES = {
  West:      ['California', 'Oregon', 'Washington', 'Colorado', 'Idaho', 'Montana', 'Nevada', 'Utah', 'Wyoming'],
  Midwest:   ['Illinois', 'Indiana', 'Iowa', 'Kansas', 'Michigan', 'Minnesota', 'Missouri', 'Nebraska', 'North Dakota', 'Ohio', 'South Dakota', 'Wisconsin'],
  Southwest: ['Arizona', 'New Mexico', 'Oklahoma', 'Texas'],
  Southeast: ['Florida', 'Georgia', 'North Carolina', 'South Carolina', 'Virginia', 'West Virginia', 'Alabama', 'Kentucky', 'Mississippi', 'Tennessee', 'Arkansas', 'Louisiana'],
  Northeast: ['Connecticut', 'Maine', 'Massachusetts', 'New Hampshire', 'Rhode Island', 'Vermont', 'New York', 'New Jersey', 'Pennsylvania', 'Delaware', 'Maryland', 'District of Columbia']
};

const STATE_FIPS = {
  Alabama: '01', Alaska: '02', Arizona: '04', Arkansas: '05', California: '06',
  Colorado: '08', Connecticut: '09', Delaware: '10', 'District of Columbia': '11',
  Florida: '12', Georgia: '13', Hawaii: '15', Idaho: '16', Illinois: '17',
  Indiana: '18', Iowa: '19', Kansas: '20', Kentucky: '21', Louisiana: '22',
  Maine: '23', Maryland: '24', Massachusetts: '25', Michigan: '26', Minnesota: '27',
  Mississippi: '28', Missouri: '29', Montana: '30', Nebraska: '31', Nevada: '32',
  'New Hampshire': '33', 'New Jersey': '34', 'New Mexico': '35', 'New York': '36',
  'North Carolina': '37', 'North Dakota': '38', Ohio: '39', Oklahoma: '40',
  Oregon: '41', Pennsylvania: '42', 'Rhode Island': '44', 'South Carolina': '45',
  'South Dakota': '46', Tennessee: '47', Texas: '48', Utah: '49', Vermont: '50',
  Virginia: '51', Washington: '53', 'West Virginia': '54', Wisconsin: '55',
  Wyoming: '56'
};

const FIPS_TO_STATE = Object.fromEntries(Object.entries(STATE_FIPS).map(([name, fips]) => [fips, name]));

const INDUSTRY_FIELDS = [
  ['Agriculture', 'DP03_0033PE'],
  ['Construction', 'DP03_0034PE'],
  ['Manufacturing', 'DP03_0035PE'],
  ['Wholesale', 'DP03_0036PE'],
  ['Retail', 'DP03_0037PE'],
  ['Transport & Utilities', 'DP03_0038PE'],
  ['Information', 'DP03_0039PE'],
  ['Finance & Real Estate', 'DP03_0040PE'],
  ['Professional Services', 'DP03_0041PE'],
  ['Education & Health', 'DP03_0042PE'],
  ['Arts & Food', 'DP03_0043PE'],
  ['Other Services', 'DP03_0044PE'],
  ['Public Admin', 'DP03_0045PE']
];

function readExistingCache() {
  if (!fs.existsSync(OUT_PATH)) return { metadata: {}, regions: {} };
  const text = fs.readFileSync(OUT_PATH, 'utf8');
  const match = text.match(/window\.APTUS_REGION_INSIGHTS\s*=\s*([\s\S]*?);\s*$/);
  if (!match) return { metadata: {}, regions: {} };
  return JSON.parse(match[1]);
}

function fmtDate(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short'
  }).formatToParts(date);
  const get = type => parts.find(part => part.type === type)?.value || '';
  return `${get('month')} ${get('day')}, ${get('year')} at ${get('hour')}:${get('minute')} ${get('dayPeriod')} ${get('timeZoneName')}`;
}

function number(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function formatPct(value, signed = false) {
  if (!Number.isFinite(value)) return 'N/A';
  const prefix = signed && value > 0 ? '+' : '';
  return `${prefix}${round(value, 1).toFixed(1)}%`;
}

function formatCurrency(value) {
  if (!Number.isFinite(value)) return 'N/A';
  return '$' + Math.round(value).toLocaleString('en-US');
}

function formatCount(value) {
  if (!Number.isFinite(value)) return 'N/A';
  const abs = Math.abs(value);
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  if (abs >= 1000000) return `${sign}${round(abs / 1000000, 1)}M`;
  return `${sign}${Math.round(abs / 1000).toLocaleString('en-US')}K`;
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.json();
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && quoted && next === '"') {
      field += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(field);
      field = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(field);
      if (row.some(value => value !== '')) rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  const headers = rows.shift() || [];
  return rows.map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] || ''])));
}

async function fetchCensusTable(pathPart, variables, yearStart, transform) {
  const currentYear = new Date().getFullYear();
  const start = yearStart || currentYear - 1;
  let lastError = null;

  for (let year = start; year >= 2020; year -= 1) {
    const url = `https://api.census.gov/data/${year}/${pathPart}?get=NAME,${variables.join(',')}&for=state:*`;
    try {
      const rows = await fetchJson(url);
      const headers = rows[0];
      const data = rows.slice(1).map(row => {
        const obj = {};
        headers.forEach((header, index) => { obj[header] = row[index]; });
        return obj;
      });
      return { year, data: transform ? transform(data, year) : data };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error(`No Census ${pathPart} data found`);
}

async function fetchAcs() {
  const detailVars = [
    'B19013_001E',
    'B25003_001E',
    'B25003_002E',
    'B25003_003E',
    'B25070_001E',
    'B25070_007E',
    'B25070_008E',
    'B25070_009E',
    'B25070_010E'
  ];
  const profileVars = ['DP03_0004E', ...INDUSTRY_FIELDS.map(([, variable]) => variable)];

  const detail = await fetchCensusTable('acs/acs5', detailVars, undefined, rows => rows.map(row => ({
    state: FIPS_TO_STATE[row.state],
    income: number(row.B19013_001E),
    occupied: number(row.B25003_001E),
    owner: number(row.B25003_002E),
    renter: number(row.B25003_003E),
    rentBase: number(row.B25070_001E),
    rentBurdened: ['B25070_007E', 'B25070_008E', 'B25070_009E', 'B25070_010E']
      .reduce((sum, key) => sum + (number(row[key]) || 0), 0)
  })).filter(row => row.state));

  const profile = await fetchCensusTable('acs/acs5/profile', profileVars, detail.year, rows => rows.map(row => ({
    state: FIPS_TO_STATE[row.state],
    employed: number(row.DP03_0004E),
    industries: Object.fromEntries(INDUSTRY_FIELDS.map(([label, variable]) => [label, number(row[variable])]))
  })).filter(row => row.state));

  const byState = new Map(detail.data.map(row => [row.state, row]));
  for (const row of profile.data) {
    byState.set(row.state, { ...(byState.get(row.state) || {}), ...row });
  }
  const nationalRentBase = [...byState.values()].reduce((sum, row) => sum + (row.rentBase || 0), 0);
  const nationalRentBurdened = [...byState.values()].reduce((sum, row) => sum + (row.rentBurdened || 0), 0);

  return {
    vintage: `American Community Survey ${detail.year} 5-year`,
    source: `US Census Bureau American Community Survey ${detail.year} 5-year`,
    nationalRentBurden: nationalRentBase ? nationalRentBurdened / nationalRentBase * 100 : null,
    byState
  };
}

async function fetchPopulationEstimates() {
  const currentYear = new Date().getFullYear();
  let lastError = null;

  for (let year = currentYear - 1; year >= 2021; year -= 1) {
    const url = `https://www2.census.gov/programs-surveys/popest/datasets/2020-${year}/state/totals/NST-EST${year}-ALLDATA.csv`;
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
      const rows = parseCsv(await response.text());
      const data = rows.filter(row => row.SUMLEV === '040').map(row => {
        const history = Object.keys(row)
          .filter(key => /^NETMIG\d{4}$/.test(key))
          .map(key => ({ year: key.slice(-4), val: number(row[key]) || 0 }))
          .sort((a, b) => a.year.localeCompare(b.year));
        return {
          state: FIPS_TO_STATE[row.STATE],
          population: number(row[`POPESTIMATE${year}`]),
          netMigration: history.reduce((sum, item) => sum + item.val, 0),
          history
        };
      }).filter(row => row.state);

      return {
        vintage: `Census Population Estimates ${year}`,
        source: `Census Population Estimates ${year}`,
        byState: new Map(data.map(row => [row.state, row]))
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('No Census Population Estimates data found');
}

function lausSeriesId(stateName, measure = '3') {
  return `LASST${STATE_FIPS[stateName]}000000000000${measure}`;
}

async function fetchBls() {
  const series = Object.keys(STATE_FIPS)
    .filter(state => REGION_STATES.Northeast.includes(state) || REGION_STATES.Southeast.includes(state) || REGION_STATES.Midwest.includes(state) || REGION_STATES.Southwest.includes(state) || REGION_STATES.West.includes(state))
    .map(state => lausSeriesId(state));
  const nationalSeries = 'LNS14000000';
  const allSeries = [...series, nationalSeries];
  const currentYear = new Date().getFullYear();
  const chunks = [];
  for (let i = 0; i < allSeries.length; i += 25) chunks.push(allSeries.slice(i, i + 25));

  const data = [];
  for (const chunk of chunks) {
    const response = await fetchJson('https://api.bls.gov/publicAPI/v2/timeseries/data/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        seriesid: chunk,
        startyear: String(currentYear - 1),
        endyear: String(currentYear),
        ...(process.env.BLS_API_KEY ? { registrationkey: process.env.BLS_API_KEY } : {})
      })
    });
    if (response.status !== 'REQUEST_SUCCEEDED') {
      throw new Error(response.message?.join('; ') || 'BLS request failed');
    }
    data.push(...response.Results.series);
  }

  const byState = new Map();
  let national = null;
  let period = null;
  for (const seriesData of data) {
    const latest = seriesData.data?.find(item => !item.period.startsWith('M13'));
    if (!latest) continue;
    if (seriesData.seriesID === nationalSeries) {
      national = number(latest.value);
      period = `${latest.periodName} ${latest.year}`;
      continue;
    }
    const fips = seriesData.seriesID.slice(5, 7);
    const state = FIPS_TO_STATE[fips];
    if (state) byState.set(state, number(latest.value));
  }

  return {
    vintage: `BLS LAUS ${period || currentYear}`,
    source: `BLS LAUS ${period || currentYear}`,
    national,
    byState
  };
}

async function fetchBeaRegional() {
  const apiKey = process.env.BEA_API_KEY || process.env.BEA_USER_ID;
  if (!apiKey) {
    throw new Error('BEA_API_KEY is missing; keeping cached BEA GDP/RPP values.');
  }
  const currentYear = new Date().getFullYear();
  const warnings = [];
  const byState = new Map();

  async function getRegionalYear(tableName, lineCode, year) {
    const params = new URLSearchParams({
      UserID: apiKey,
      method: 'GetData',
      datasetname: 'Regional',
      TableName: tableName,
      LineCode: String(lineCode),
      GeoFIPS: 'STATE',
      Year: String(year),
      ResultFormat: 'JSON'
    });
    const json = await fetchJson(`https://apps.bea.gov/api/data/?${params}`);
    const rows = json.BEAAPI?.Results?.Data || [];
    if (!rows.length) throw new Error(`${tableName} returned no rows for ${year}`);
    return rows;
  }

  async function getRegional(tableName, lineCode) {
    let lastError = null;
    for (let year = currentYear - 1; year >= 2020; year -= 1) {
      try {
        return { year, rows: await getRegionalYear(tableName, lineCode, year) };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }

  try {
    const rpp = await getRegional('SARPP', 1);
    for (const row of rpp.rows) {
      const state = row.GeoName?.replace(' *', '');
      if (!STATE_FIPS[state]) continue;
      byState.set(state, { ...(byState.get(state) || {}), rpp: number(String(row.DataValue).replace(/,/g, '')) });
    }
    byState.rppVintage = `US Bureau of Economic Analysis Regional Price Parities ${rpp.year}`;
  } catch (error) {
    warnings.push(`BEA RPP refresh failed: ${error.message}`);
  }

  try {
    let gdpAccepted = 0;
    let lastError = null;
    for (let year = currentYear - 1; year >= 2021; year -= 1) {
      try {
        const currentRows = await getRegionalYear('SAGDP1', 1, year);
        const priorRows = await getRegionalYear('SAGDP1', 1, year - 1);
        const priorByState = new Map();
        for (const row of priorRows) {
          if (!isAnnualBeaRow(row, year - 1)) continue;
          const state = row.GeoName?.replace(' *', '');
          if (!STATE_FIPS[state]) continue;
          priorByState.set(state, number(String(row.DataValue).replace(/,/g, '')));
        }

        const pending = [];
        for (const row of currentRows) {
          if (!isAnnualBeaRow(row, year)) continue;
          const state = row.GeoName?.replace(' *', '');
          if (!STATE_FIPS[state]) continue;
          const current = number(String(row.DataValue).replace(/,/g, ''));
          const prior = priorByState.get(state);
          if (!Number.isFinite(current) || !Number.isFinite(prior) || prior === 0) continue;
          const growth = (current / prior - 1) * 100;
          if (growth < -50 || growth > 50) continue;
          pending.push({ state, current, prior, growth });
        }

        if (!pending.length) {
          lastError = new Error(`BEA real GDP rows for ${year} did not produce sane annual growth rates`);
          continue;
        }

        for (const item of pending) {
          byState.set(item.state, {
            ...(byState.get(item.state) || {}),
            gdpCurrent: item.current,
            gdpPrior: item.prior,
            gdpGrowth: item.growth
          });
        }
        gdpAccepted = pending.length;
        byState.gdpVintage = `US Bureau of Economic Analysis Real GDP Growth ${year}`;
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!gdpAccepted) throw lastError || new Error('BEA real GDP rows unavailable');
  } catch (error) {
    warnings.push(`BEA GDP refresh failed: ${error.message}`);
  }

  return {
    vintage: {
      rpp: byState.rppVintage || 'BEA RPP previous cache',
      gdp: byState.gdpVintage || 'BEA GDP previous cache'
    },
    source: 'BEA Regional API',
    byState,
    warnings
  };
}

function statesFor(regionName) {
  return REGION_STATES[regionName] || [];
}

function aggregateRegion(regionName, sources, previousRegion) {
  const states = statesFor(regionName);
  const acsRows = states.map(state => sources.acs?.byState.get(state)).filter(Boolean);
  const popRows = states.map(state => sources.population?.byState.get(state)).filter(Boolean);
  const beaRows = states.map(state => sources.bea?.byState.get(state)).filter(Boolean);
  const blsRows = states.map(state => ({ state, value: sources.bls?.byState.get(state) })).filter(row => Number.isFinite(row.value));

  const occupied = acsRows.reduce((sum, row) => sum + (row.occupied || 0), 0);
  const renters = acsRows.reduce((sum, row) => sum + (row.renter || 0), 0);
  const rentBase = acsRows.reduce((sum, row) => sum + (row.rentBase || 0), 0);
  const rentBurdened = acsRows.reduce((sum, row) => sum + (row.rentBurdened || 0), 0);
  const incomeWeight = acsRows.reduce((sum, row) => sum + ((row.income || 0) * (row.occupied || 0)), 0);
  const income = occupied ? incomeWeight / occupied : previousRegion?.income?.num;
  const renterShare = occupied ? renters / occupied * 100 : null;
  const rentBurden = rentBase ? rentBurdened / rentBase * 100 : null;

  const population = popRows.reduce((sum, row) => sum + (row.population || 0), 0);
  const netMigration = popRows.reduce((sum, row) => sum + (row.netMigration || 0), 0);
  const migrationRate = population ? netMigration / population * 1000 : null;
  const historyMap = new Map();
  for (const row of popRows) {
    for (const item of row.history || []) {
      historyMap.set(item.year, (historyMap.get(item.year) || 0) + item.val);
    }
  }
  const history = [...historyMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([year, val]) => ({ year, val: Math.round(val / 1000) }));

  const employed = acsRows.reduce((sum, row) => sum + (row.employed || 0), 0);
  const industryTotals = new Map();
  for (const row of acsRows) {
    for (const [sector, pct] of Object.entries(row.industries || {})) {
      if (!Number.isFinite(pct) || !row.employed) continue;
      industryTotals.set(sector, (industryTotals.get(sector) || 0) + pct * row.employed);
    }
  }
  let breakdown = [...industryTotals.entries()]
    .map(([sector, weighted]) => ({ sector, pct: employed ? weighted / employed : 0 }))
    .sort((a, b) => b.pct - a.pct);
  const top = breakdown.slice(0, 5);
  const otherBreakdown = breakdown.slice(5).map(item => ({ sector: item.sector, pct: Math.round(item.pct) }));
  const other = Math.max(0, 100 - top.reduce((sum, item) => sum + item.pct, 0));
  breakdown = [...top, { sector: 'Other', pct: other }].map(item => ({ sector: item.sector, pct: Math.round(item.pct) }));
  const concentration = top[0]?.pct || 0;

  const rpp = weightedAverage(beaRows, 'rpp', acsRows, 'occupied') ?? previousRegion?.rpp?.value;
  const gdpCurrent = beaRows.reduce((sum, row) => sum + (number(row.gdpCurrent) || 0), 0);
  const gdpPrior = beaRows.reduce((sum, row) => sum + (number(row.gdpPrior) || 0), 0);
  const calculatedGdpGrowth = gdpCurrent && gdpPrior
    ? (gdpCurrent / gdpPrior - 1) * 100
    : average(beaRows.map(row => row.gdpGrowth).filter(Number.isFinite)) ?? parseSignedPct(previousRegion?.gdp?.value);
  const gdpGrowth = saneGdpGrowth(calculatedGdpGrowth);
  const unemployment = average(blsRows.map(row => row.value)) ?? previousRegion?.unemp?.value;

  const incMonthly30 = Math.round((income || 0) / 12 * 0.30);
  const migrationDir = migrationDirection(migrationRate, previousRegion?.migration?.dir || 'flat');
  const renterDir = renterShare >= 36 ? 'up' : renterShare >= 32 ? 'flat' : 'down';
  const rppDir = rpp > 103 ? 'up' : rpp < 97 ? 'down' : 'flat';
  const gdpDir = Number.isFinite(gdpGrowth) ? (gdpGrowth > 2.5 ? 'up' : gdpGrowth < 1 ? 'down' : 'flat') : previousRegion?.gdp?.dir || 'flat';

  return {
    tag: 'Region Overview',
    summary: previousRegion?.summary || '',
    migration: {
      value: migrationRate === null ? previousRegion?.migration?.value || 'N/A' : `${migrationRate > 0 ? '+' : ''}${round(migrationRate, 1).toFixed(1)}/1k`,
      rawValue: migrationRate === null ? previousRegion?.migration?.rawValue || 'N/A' : formatCount(netMigration),
      dir: migrationDir,
      delta: migrationRate === null ? previousRegion?.migration?.delta || 'Cached trend' : migrationDelta(migrationRate),
      detail: `<strong>Net migration rate: ${migrationRate === null ? 'N/A' : `${round(migrationRate, 1).toFixed(1)} per 1,000 residents`}</strong><br>${migrationCopy(regionName, migrationRate)}`,
      history: history.length ? history : previousRegion?.migration?.history || [],
      source: sources.population?.source || previousRegion?.migration?.source || 'Census Population Estimates'
    },
    rpp: {
      value: Number.isFinite(Number(rpp)) ? round(Number(rpp), 1).toFixed(1) : previousRegion?.rpp?.value || 'N/A',
      dir: rppDir,
      delta: rpp > 103 ? 'Above US avg' : rpp < 97 ? 'Below US avg' : 'Near US avg',
      source: sources.bea?.vintage?.rpp || previousRegion?.rpp?.source || 'US Bureau of Economic Analysis Regional Price Parities'
    },
    gdp: {
      value: formatPct(gdpGrowth, true),
      dir: gdpDir,
      delta: Number.isFinite(gdpGrowth) ? (gdpGrowth > 2.5 ? 'Above avg' : gdpGrowth < 1 ? 'Soft' : 'Moderate') : 'Unavailable',
      source: sources.bea?.vintage?.gdp || previousRegion?.gdp?.source || 'US Bureau of Economic Analysis Real GDP Growth'
    },
    renter: {
      value: renterShare === null ? previousRegion?.renter?.value || previousRegion?.own?.value || 'N/A' : `${Math.round(renterShare)}%`,
      dir: renterDir,
      delta: renterShare > 36 ? 'High rental base' : renterShare < 32 ? 'Owner-heavy' : 'Near US baseline',
      source: sources.acs?.source || previousRegion?.renter?.source || 'US Census Bureau American Community Survey'
    },
    econ: {
      value: concentration >= 24 ? 'Concentrated' : concentration >= 20 ? 'Moderate' : 'High',
      breakdown: breakdown.length > 1 ? breakdown : previousRegion?.econ?.breakdown || [],
      otherBreakdown: otherBreakdown.length ? otherBreakdown : previousRegion?.econ?.otherBreakdown || [],
      source: sources.acs?.source ? `${sources.acs.source} DP03` : previousRegion?.econ?.source || 'US Census Bureau American Community Survey DP03'
    },
    unemp: {
      value: Number.isFinite(unemployment) ? round(unemployment, 1) : previousRegion?.unemp?.value,
      national: Number.isFinite(sources.bls?.national) ? sources.bls.national : previousRegion?.unemp?.national || 3.9,
      source: sources.bls?.source || previousRegion?.unemp?.source || 'BLS LAUS'
    },
    income: {
      value: formatCurrency(income),
      num: Math.round(income || previousRegion?.income?.num || 0),
      rentBurden: rentBurden === null ? previousRegion?.income?.rentBurden || 'N/A' : `${Math.round(rentBurden)}%`,
      nationalRentBurden: Number.isFinite(sources.acs?.nationalRentBurden) ? round(sources.acs.nationalRentBurden, 1) : previousRegion?.income?.nationalRentBurden,
      detail: `<strong>30% Rule:</strong> Max sustainable monthly rent ≈ <strong>${formatCurrency(incMonthly30)}</strong><br>At 30% of gross income, a median-income household can afford about ${formatCurrency(incMonthly30)}/mo in rent.`,
      source: sources.acs?.source || previousRegion?.income?.source || 'US Census Bureau American Community Survey'
    }
  };
}

function weightedAverage(rows, valueKey, weightRows, weightKey) {
  let numerator = 0;
  let denominator = 0;
  rows.forEach((row, index) => {
    const value = number(row[valueKey]);
    const weight = number(weightRows[index]?.[weightKey]) || 1;
    if (!Number.isFinite(value)) return;
    numerator += value * weight;
    denominator += weight;
  });
  return denominator ? numerator / denominator : null;
}

function average(values) {
  const usable = values.filter(Number.isFinite);
  return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : null;
}

function parseSignedPct(value) {
  if (!value) return null;
  return number(String(value).replace(/[+%]/g, ''));
}

function isAnnualBeaRow(row, year) {
  const period = row.TimePeriod || row.Time || row.Year;
  return !period || String(period) === String(year);
}

function saneGdpGrowth(value) {
  const n = number(value);
  return Number.isFinite(n) && n >= -50 && n <= 50 ? n : null;
}

function migrationCopy(regionName, rate) {
  if (!Number.isFinite(rate)) return 'Migration data was unavailable in the latest refresh; the prior cached trend was retained.';
  if (rate > 2) return `${regionName} is gaining households at a meaningful pace, which supports absorption and rental demand when new supply is controlled.`;
  if (rate > 0) return `${regionName} is posting modest net inflow, enough to support demand but still dependent on local job growth and affordability.`;
  if (rate < -2) return `${regionName} is losing population on net, making market and submarket selection especially important.`;
  return `${regionName} is close to flat on migration, so income growth, employment mix, and housing supply should carry more weight than headline population flow.`;
}

function migrationDelta(rate) {
  if (!Number.isFinite(rate)) return 'Cached trend';
  if (rate >= 20) return 'Very strong 5yr inflow';
  if (rate >= 10) return 'Strong 5yr inflow';
  if (rate >= 3) return 'Modest inflow';
  if (rate > 0) return 'Slight inflow';
  if (rate <= -10) return 'Strong 5yr outflow';
  if (rate <= -3) return 'Modest outflow';
  return 'Slight outflow';
}

function migrationDirection(rate, fallback = 'flat') {
  if (!Number.isFinite(rate)) return fallback;
  if (rate > 0) return 'up';
  if (rate < 0) return 'down';
  return 'flat';
}

function buildRuleSummary(regionName, data) {
  const migration = data.migration.dir === 'up' ? 'positive migration' : 'migration pressure';
  const affordability = data.rpp.dir === 'down' ? 'comparatively affordable pricing' : data.rpp.dir === 'up' ? 'elevated cost pressure' : 'near-average cost levels';
  const labor = (data.unemp.value || 0) <= (data.unemp.national || 0) ? 'a stable labor backdrop' : 'some labor-market softness';
  const renter = data.renter.delta.toLowerCase();
  return `${regionName} shows ${migration}, ${affordability}, and ${labor}. The region's ${renter} makes rental demand sensitive to the balance between household formation, income growth, and new housing supply.`;
}

async function maybeAiSummary(regionName, data, previousSummary, warnings) {
  if (!AI_SUMMARY_UPDATES) return buildRuleSummary(regionName, data);
  if (!process.env.OPENAI_API_KEY) {
    warnings.push('AI_SUMMARY_UPDATES is enabled, but OPENAI_API_KEY is missing. Used deterministic summaries.');
    return buildRuleSummary(regionName, data);
  }

  const facts = {
    region: regionName,
    previousSummary,
    migration: data.migration,
    rpp: data.rpp,
    gdp: data.gdp,
    renter: data.renter,
    unemployment: data.unemp,
    income: data.income,
    industries: data.econ.breakdown
  };

  try {
    const response = await fetchJson('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        input: [
          {
            role: 'system',
            content: 'Write concise, source-grounded real estate market summaries. Use only supplied facts. Avoid hype, predictions beyond the facts, and citations.'
          },
          {
            role: 'user',
            content: `Rewrite the region summary in 2 sentences, investor-facing but neutral. Facts:\n${JSON.stringify(facts, null, 2)}`
          }
        ]
      })
    });

    const text = response.output_text
      || response.output?.flatMap(item => item.content || []).map(item => item.text).filter(Boolean).join(' ')
      || '';
    return text.trim() || buildRuleSummary(regionName, data);
  } catch (error) {
    warnings.push(`AI summary refresh failed for ${regionName}: ${error.message}`);
    return buildRuleSummary(regionName, data);
  }
}

async function main() {
  const previous = readExistingCache();
  const warnings = [];
  const sources = {};

  for (const [key, fetcher] of Object.entries({
    acs: fetchAcs,
    population: fetchPopulationEstimates,
    bls: fetchBls,
    bea: fetchBeaRegional
  })) {
    try {
      console.log(`[regions] Fetching ${key}`);
      sources[key] = await fetcher();
      if (sources[key].warnings) warnings.push(...sources[key].warnings);
    } catch (error) {
      warnings.push(`${key} refresh failed: ${error.message}`);
      console.warn(`[regions] ${key} refresh failed: ${error.message}`);
    }
  }

  const regions = {};
  for (const regionName of Object.keys(REGION_STATES)) {
    const region = aggregateRegion(regionName, sources, previous.regions?.[regionName]);
    region.summary = await maybeAiSummary(regionName, region, previous.regions?.[regionName]?.summary || '', warnings);
    regions[regionName] = region;
  }

  const now = new Date();
  const output = {
    metadata: {
      lastUpdated: now.toISOString(),
      lastUpdatedDisplay: fmtDate(now),
      aiSummaryUpdatesEnabled: AI_SUMMARY_UPDATES,
      sourceVintages: {
        acs: sources.acs?.vintage,
        population: sources.population?.vintage,
        bls: sources.bls?.vintage,
        rpp: sources.bea?.vintage?.rpp,
        gdp: sources.bea?.vintage?.gdp
      },
      warnings
    },
    regions
  };

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(
    OUT_PATH,
    `// AUTO-GENERATED by scripts/refresh-region-insights.js.\nwindow.APTUS_REGION_INSIGHTS = ${JSON.stringify(output, null, 2)};\n`,
    'utf8'
  );
  console.log(`[regions] Wrote ${path.relative(path.join(__dirname, '..'), OUT_PATH)}`);
  if (warnings.length) console.warn(`[regions] Completed with ${warnings.length} warning(s).`);
}

main().catch(error => {
  console.error('[regions] Refresh failed:', error);
  process.exit(1);
});
