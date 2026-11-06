# Airport OLS v OFS/OES Visualiser

**Live:** https://therunwaycentreline.github.io/ols-visualiser/

A 3D comparison, at a real airport, of the legacy ICAO Annex 14 Volume I obstacle limitation surfaces (OLS) with the obstacle free surfaces (OFS) and obstacle evaluation surfaces (OES) introduced by Amendment 18 (applicable 21 November 2030).

**Educational tool, not for aerodrome safeguarding decisions.** Runway data comes from open sources and is not surveyed. Check values against the State's AIP and the aerodrome's published OLS.

By [The Runway Centreline](https://therunwaycentreline.com).

## What it does

- Pick an airport (ICAO code or name) and a runway.
- Enter the critical aeroplane (ARFL, wingspan, Vat) or choose a preset. The tool derives code number, code letter and aeroplane design group (ADG), and shows the band each came from.
- Set the approach type and runway use flags; override runway values (threshold positions and elevations, displaced thresholds, clearways, strip extension, aerodrome elevation) from the AIP.
- View legacy surfaces, new surfaces, both together, or a plan of where the new surfaces are lower or higher than the legacy ones.
- Open any surface for its dimensions, clause, obligation, obstacle rule and key heights.

The whole configuration is kept in the URL, so a view can be bookmarked or shared.

## Scope and limits (v1)

- One runway and one critical aeroplane at a time; both runway ends share one approach type.
- No obstacle penetration checking.
- Not modelled: mixed ADG stacking of horizontal surfaces, OCA/H and approach angle overrides, take-off slope reductions (e.g. 1.6 %), curved runway profiles, specific OES (curved approaches, VFR circuits), State variations such as an outer horizontal surface.
- Runway profile is straight between thresholds. Defaults: strip 60 m beyond each runway end (30 m for code 1 non-instrument, 3.4.2); aerodrome elevation from OurAirports.

## Verification

- 69 unit tests (`npm test`, Node built-in runner, no dependencies) covering derivation, every modifier and footnote rule in scope, hand-checked heights, georeferencing against an independent Vincenty solution, and the difference grid.
- An independent check (a separate model built from the standards data alone) compared about 5.7 million points across six configurations; the findings were fixed.
- Legacy output was compared with the Brisbane City Council published OLS for YBBN. With matching inputs the surfaces agree; the remaining differences are local choices (1.6 % take-off slope, outer horizontal surface, a protected decommissioned runway, published datum).

## Structure

- `index.html`, `app/`: the page (MapLibre GL 4.7.1 with deck.gl 9.0.38).
- `engine/`: pure functions: `derive.js` (codes, ADG, columns), `resolve.js` (dimensions and modifiers), `geometry.js` (surfaces in a runway frame), `georef.js` (runway frame to WGS84), `compare.js` (difference grid).
- `data/ols_standards.json`: every dimension, footnote rule, modifier and decision, distilled from Annex 14. `data/runways_paved.json`: open, paved runways from OurAirports.

## Data sources and credits

- Imagery: Powered by Esri. Source: Esri, Vantor, GeoEye, Earthstar Geographics, CNES/Airbus DS, USDA, USGS, AeroGRID, IGN, and the GIS User Community. Accessed with an ArcGIS Location Platform API key restricted to this site (`app/config.js`; expires about November 2027).
- Terrain: Mapzen terrain tiles on AWS Open Data (full source credits on the page, under Data sources and credits).
- Buildings: OpenFreeMap; © OpenMapTiles; © OpenStreetMap contributors. Indicative only, not obstacle data.
- Runways and airports: OurAirports (public domain).
