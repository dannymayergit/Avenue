# Avenue

Avenue is an interactive U.S. real-estate market explorer. It provides map-based drilldowns from regions and states to market areas, counties, cities, towns, neighborhoods, and property opportunities.

The application is a static browser experience built with JavaScript, Mapbox GL JS, TopoJSON, Turf, and locally generated Census/geographic datasets.

## Features

- Interactive U.S. map with region, state, county, and place drilldowns
- Market-area exploration derived from CBSA and county data
- City and town search through Mapbox Geocoding
- Local geographic boundary and market-insight assets
- Self-hosted JavaScript libraries and fonts
- Static deployment suitable for Cloudflare Pages
- Explicit data-refresh and validation workflows

## Requirements

- Node.js 18 or newer
- A Mapbox public access token
- Python 3, or another static HTTP server, for local preview

No runtime package installation is currently required because the browser libraries are committed under `vendor/`.

## Local setup

Clone the repository and enter its directory:

```bash
git clone https://github.com/YOUR-USERNAME/avenue.git
cd avenue
```

Set a Mapbox public token and run the build:

```bash
export MAPBOX_TOKEN="pk.your-public-token"
npm run build
```

PowerShell:

```powershell
$env:MAPBOX_TOKEN = "pk.your-public-token"
npm run build
```

The build writes `config.js` and validates the required topology, market-area, and place-boundary assets.

Serve the project over HTTP:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.

Do not open `index.html` directly with a `file://` URL; browser security rules can prevent geographic assets from loading correctly.

## Configuration

The build reads these environment variables:

| Variable | Required | Purpose |
| --- | --- | --- |
| `MAPBOX_TOKEN` | Yes | Public Mapbox browser token |
| `PLACE_BOUNDARIES_BASE_URL` | No | External base URL for place-boundary files |
| `NEIGHBORHOOD_BOUNDARIES_BASE_URL` | No | External base URL for neighborhood-boundary files |

`config.js` is generated at build time and should not be committed. Mapbox browser tokens are visible to site visitors by design, so use a public `pk.*` token with minimal scopes and URL restrictions. Never use a secret `sk.*` token in this project.

## Data workflows

Normal builds use committed local data and do not download external datasets:

```bash
npm run build
```

Refresh the geographic source data intentionally:

```bash
npm run refresh:data
npm run build
```

Other available workflows:

```bash
npm run build:markets
npm run refresh:regions
npm run prepare:neighborhood
```

`refresh:data` retrieves county topology, Census county reference data, the CBSA-to-county crosswalk, and legal place boundaries. Review upstream terms and data provenance before redistributing generated datasets.

To refresh only selected states, provide comma-separated state FIPS codes:

```bash
STATES=06,12,36 npm run refresh:data
```

PowerShell:

```powershell
$env:STATES = "06,12,36"
npm run refresh:data
```

Set `FORCE_REFRESH=1` when existing state boundary files should be replaced.

## Project structure

| Path | Purpose |
| --- | --- |
| `index.html` | Application shell and landing experience |
| `aptus-map.js` | Map initialization and interaction |
| `aptus-data.js` | Geographic data loading and lookup |
| `aptus-geometry.js` | Geometry and boundary operations |
| `aptus-labels.js` | Map labeling |
| `aptus-panel.js` | Information-panel behavior |
| `aptus-state.js` | Shared application state |
| `aptus-config.js` | Mapbox and asset configuration boundary |
| `build.js` | Build-time config generation and asset validation |
| `scripts/` | Data refresh and generation tools |
| `data/source/` | Upstream source datasets |
| `data/generated/` | Generated browser-ready geographic assets |
| `vendor/` | Self-hosted browser libraries and fonts |
| `images/` | Logos, social image, and favicons |
| `docs/` | Architecture notes |

## Deployment

For Cloudflare Pages:

1. Connect the repository to a Pages project.
2. Set the build command to `npm run build`.
3. Set the output directory to the repository root.
4. Add `MAPBOX_TOKEN` under the project environment variables.
5. Optionally configure external boundary base URLs.
6. Deploy and verify search, labels, and every drilldown level.

The included `wrangler.jsonc` also serves the repository root as static assets.

## Security

Do not commit credentials or local tool configuration. At minimum, keep these patterns in `.gitignore`:

```gitignore
.wrangler/
.dev.vars*
.env*
config.js
.kangentic/
.DS_Store
```

## External services and data

The application self-hosts its runtime libraries, fonts, and several geographic assets. It still relies on Mapbox for the streets style, vector tiles, sprites, glyphs, place labels, and geocoding. Data refreshes also access U.S. Census, NBER, and `us-atlas` sources.

See `docs/dependency-architecture.md` for the dependency boundary and possible future migration paths.

## License

No license is included by default. Add an appropriate license before accepting outside contributions or inviting reuse.
