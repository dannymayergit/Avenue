#!/usr/bin/env node
// Build investor-facing market areas from CBSA county memberships.

const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const cbsaPath = path.join(rootDir, 'data/source/cbsa2fipsxw_2023.csv');
const countyPath = path.join(rootDir, 'data/source/national_county2020.txt');
const outPath = path.join(rootDir, 'data/generated/market-areas.json');

const MARKET_ALIASES = {
  '12060': 'Atlanta Metro'
};

const APP_STATE_FIPS = new Set([
  '01', '02', '04', '05', '06', '08', '09', '10', '11', '12', '13', '15',
  '16', '17', '18', '19', '20', '21', '22', '23', '24', '25', '26', '27',
  '28', '29', '30', '31', '32', '33', '34', '35', '36', '37', '38', '39',
  '40', '41', '42', '44', '45', '46', '47', '48', '49', '50', '51', '53',
  '54', '55', '56'
]);

function fail(message) {
  console.error(`[market-areas] ${message}`);
  process.exit(1);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (quoted && ch === '"' && next === '"') {
      value += '"';
      i += 1;
    } else if (ch === '"') {
      quoted = !quoted;
    } else if (!quoted && ch === ',') {
      row.push(value);
      value = '';
    } else if (!quoted && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && next === '\n') i += 1;
      row.push(value);
      if (row.some(cell => cell !== '')) rows.push(row);
      row = [];
      value = '';
    } else {
      value += ch;
    }
  }

  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }
  return rows;
}

function countyNameWithoutSuffix(name) {
  return String(name || '')
    .replace(/\s+(County|Parish|Borough|Municipality|Census Area)$/i, '')
    .trim();
}

function marketName(row) {
  const cbsaCode = row.cbsacode;
  if (MARKET_ALIASES[cbsaCode]) return MARKET_ALIASES[cbsaCode];

  const title = row.cbsatitle.replace(/,?\s+[A-Z]{2}(?:-[A-Z]{2})*$/, '').trim();
  const suffix = row.metropolitanmicropolitanstatis === 'Metropolitan Statistical Area'
    ? 'Metro'
    : 'Market';
  return `${title} ${suffix}`;
}

function readCountyNames() {
  if (!fs.existsSync(countyPath)) fail(`Missing ${countyPath}`);
  const names = new Map();
  const lines = fs.readFileSync(countyPath, 'utf8').trim().split('\n').slice(1);
  for (const line of lines) {
    const parts = line.split('|');
    if (parts.length < 5) continue;
    const fips = parts[1].padStart(2, '0') + parts[2].padStart(3, '0');
    names.set(fips, parts[4]);
  }
  return names;
}

function build() {
  if (!fs.existsSync(cbsaPath)) fail(`Missing ${cbsaPath}`);
  const rows = parseCsv(fs.readFileSync(cbsaPath, 'utf8'));
  const header = rows.shift().map(cell => cell.trim().toLowerCase());
  const countyNames = readCountyNames();

  const cbsaByState = new Map();
  const assignedFips = new Set();

  for (const values of rows) {
    const row = Object.fromEntries(header.map((key, index) => [key, values[index] || '']));
    const stateFips = row.fipsstatecode;
    const countyFips = stateFips + row.fipscountycode;
    if (!APP_STATE_FIPS.has(stateFips)) continue;
    if (!stateFips || !row.cbsacode || !countyNames.has(countyFips)) continue;

    const key = `${stateFips}:${row.cbsacode}`;
    if (!cbsaByState.has(key)) {
      cbsaByState.set(key, {
        key: `cbsa-${row.cbsacode}-${stateFips}`,
        cbsaCode: row.cbsacode,
        name: marketName(row),
        title: row.cbsatitle,
        type: row.metropolitanmicropolitanstatis === 'Metropolitan Statistical Area' ? 'metro' : 'micro',
        countyFips: [],
        counties: []
      });
    }

    const market = cbsaByState.get(key);
    market.countyFips.push(countyFips);
    market.counties.push(countyNames.get(countyFips));
    assignedFips.add(countyFips);
  }

  const states = {};
  for (const market of cbsaByState.values()) {
    const stateFips = market.countyFips[0].slice(0, 2);
    if (!states[stateFips]) states[stateFips] = [];
    market.countyFips.sort();
    market.counties = market.counties
      .map(countyNameWithoutSuffix)
      .sort((a, b) => a.localeCompare(b));
    states[stateFips].push(market);
  }

  for (const [fips, countyName] of countyNames.entries()) {
    if (assignedFips.has(fips)) continue;
    const stateFips = fips.slice(0, 2);
    if (!APP_STATE_FIPS.has(stateFips)) continue;
    if (!states[stateFips]) states[stateFips] = [];
    states[stateFips].push({
      key: `county-${fips}`,
      cbsaCode: null,
      name: `${countyNameWithoutSuffix(countyName)} Market`,
      title: countyName,
      type: 'county',
      countyFips: [fips],
      counties: [countyNameWithoutSuffix(countyName)]
    });
  }

  Object.values(states).forEach(markets => {
    markets.sort((a, b) => {
      const rank = { metro: 0, micro: 1, county: 2 };
      return (rank[a.type] - rank[b.type]) || a.name.localeCompare(b.name);
    });
  });

  const output = {
    source: 'Census Bureau / OMB July 2023 CBSA county delineations via NBER cbsa2fipsxw_2023.csv',
    generatedAt: new Date().toISOString(),
    states
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(output), 'utf8');
  console.log(`[market-areas] wrote ${outPath}`);
}

build();
