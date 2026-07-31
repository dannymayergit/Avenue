# Avenue Dependency Architecture

This app now serves the practical browser dependencies and geographic assets from the project itself. The drilldown UX is unchanged: region, state, and county borders still derive from the same county topology, and city/town labels still come from Mapbox place labels.

## Self-hosted runtime assets

- `vendor/mapbox-gl.js` and `vendor/mapbox-gl.css`: local copies of Mapbox GL JS v3.3.0. The library is self-hosted, but the active style and tiles still come from Mapbox.
- `vendor/topojson-client.min.js`: local copy of `topojson-client` v3.1.0.
- `vendor/turf.min.js`: local copy of Turf v7.
- `vendor/fonts.css` and `vendor/fonts/*`: local Playfair Display and Outfit font files replacing Google Fonts runtime requests.
- `data/generated/counties-10m.json`: local copy of `us-atlas@3/counties-10m.json`, used by `aptus-data.js` at browser runtime.
- `aptus-county-names.js`: generated local FIPS-to-county-name lookup built from `data/source/national_county2020.txt`.

## Removed dependencies and config

- Removed the `mapbox-pmtiles` browser bundle because no protocol/source registration used it.
- Removed `PMTILES_LOW` and `PMTILES_HIGH` from `build.js`, `config.js`, and `aptus-config.js`; those values were required but unused.
- Removed browser runtime requests to jsDelivr/unpkg for `us-atlas`, `topojson-client`, and Turf.
- Removed browser runtime requests to Google Fonts.
- Replaced the inert `gitignore` file with a real `.gitignore`.

## External dependencies that remain

- Mapbox style: `mapbox://styles/mapbox/streets-v12`.
- Mapbox vector tiles, sprites, glyphs, and the `composite` source used for `place_label` city/town label points.
- Mapbox Geocoding API used by `geocodeAndNavigate(...)`.

These remain because replacing them would change the basemap, label density, search semantics, or place-label drilldown behavior. They are isolated in `aptus-config.js` as `MAPBOX_STREETS_STYLE`, `MAPBOX_PLACE_LABEL_SOURCE`, `MAPBOX_PLACE_LABEL_LAYER`, and `MAPBOX_GEOCODING_ENDPOINT` so a later migration has one obvious boundary.

## Data refresh workflow

Normal deploy builds do not fetch network data. They read local files and verify that required data exists:

```sh
npm run build
```

To intentionally refresh external source data:

```sh
npm run refresh:data
npm run build
```

`refresh:data` downloads:

- `us-atlas@3/counties-10m.json` into `data/generated/counties-10m.json`
- Census `national_county2020.txt` into `data/source/national_county2020.txt`

## Future recommendations

- Replace Mapbox Geocoding with a local search index generated from Census places/counties/states if search independence becomes a priority.
- Replace Mapbox `place_label` usage with local Census place points or polygons if city/town drilldown should work without Mapbox vector tile internals.
- Consider a local MapLibre-compatible style and tile stack only when the team is ready to own basemap tiles, glyphs, sprites, and attribution end to end.
