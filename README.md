# Sun & View

[![Build and deploy](https://github.com/yetit/sun-view/actions/workflows/deploy.yml/badge.svg)](https://github.com/yetit/sun-view/actions/workflows/deploy.yml)
[![Tests: node --test](https://img.shields.io/badge/tests-node%20--test-3c873a)](tests/)
[Русская версия](README.ru.md)

![Sun & View: a building in Tivat with sea-view sectors, the sun path and a result card](docs/screenshot.png)

**Click any building, pick a floor, and see how many hours of direct sun reach its windows in each season, and in which directions the sea is visible. Everything is computed in your browser from open data.**

**Demo: [yetit.github.io/sun-view](https://yetit.github.io/sun-view/)** · Tivat and Kotor, Montenegro · English and Russian (`?lang=en|ru`)

## What it does

- **Sun in the windows.** Hours of direct sun for the March equinox, June solstice, September equinox and December solstice, plus a year ribbon (day × hour). Pick the whole building or one facing (N … NW).
- **Sea view.** For each of 8 directions, whether water is visible from the window level and how far away it is.
- **City maps.** On load the whole city is coloured by winter sun; switch to the sea map, or pick the window height: 2, 5 or 10 m above ground. Colours follow the actual spread of hours in the current layer, and the legend shows them. Buildings lower than the chosen height are faded and shown from their top floor.
- **Time slider.** Building shading, ground shadows and the sun marker follow the time of day; ▶ plays a whole day.
- **Reliability label.** Each building gets high, medium or low reliability with the reasons: floor count estimated, steep slope, woods next to it.
- **Compare and share.** Pin up to four flats side by side, download a PNG card, or share the URL. The URL keeps the city, building, floor, side, season and time.

## How it works

1. **A world in metres.** Footprints from OpenStreetMap become a 6 m roof raster holding the absolute height of every roof and tree canopy. Copernicus DEM GLO-30 becomes a 60 m terrain grid that reaches about 15 km around the city.
2. **Ray-marching in the browser.** For every 10 minutes of the day the sun position comes from [suncalc](https://github.com/mourner/suncalc). A ray from the window steps 3 m up to 1 km, checking roofs, trees and terrain, then 30 m up to 15 km, checking terrain only. A hit means shade.
3. **Sea view** uses the same march. It keeps the highest elevation angle of anything in the way, and a sea cell counts as visible if its angle beats every obstacle before it.
4. **Web Worker and precompute.** City-wide sun and sea maps are 15 layers per city, 54 KB. `scripts/precompute.ts` builds them when the data is fetched, so the map is coloured instantly. Without them, and for the year ribbon, a Web Worker computes in the background. Results are cached per layer.

Code: `src/scripts/grid.ts` (rasters, rays), `analysis.ts` (seasons, sea rose, city maps), `worker.ts`, `map/` (MapLibre layers, shadows), `ui/` (panel, timebar, mobile sheet). More detail with diagrams is on the [How it works](https://yetit.github.io/sun-view/method?lang=en) page.

## Validation

The terrain horizon was checked against [PVGIS](https://re.jrc.ec.europa.eu/pvg_tools/en/) from the European Commission JRC. The check covered 16 points in Tivat and Kotor, 48 azimuths each. The full report is in Russian: [docs/horizon-check.md](docs/horizon-check.md).

| Where | Mean horizon difference | 21 December sunrise |
| --- | --- | --- |
| Flat ground by the sea, Tivat | 0.2–0.3° | same minute as PVGIS |
| All 8 points, Tivat | 2.1° | — |
| All 8 points, Kotor | 1.7° | — |
| Steep slope, Vrmac | 8.3° | 84 min later than PVGIS |

On steep slopes the error comes from the observer's own ground elevation. On a 60 m grid it differs between sources by 20–70 m. Results for hillside buildings on the uphill side are therefore unreliable. The ray core is covered by synthetic tests (`npm test`): scenes with a hill, a neighbouring wall and the sea.

## Performance

Measured on an Apple M2 Pro with the production build (`astro preview`), Tivat, 3,625 buildings.

| | |
| --- | --- |
| JavaScript, gzip | 300 KB, mostly MapLibre |
| City data, gzip | 190 KB of buildings, greenery and precomputed maps, plus a 0.9 MB terrain grid |
| First load until the coloured map | 1.9 s: data 0.44 s, world 0.17 s, worker 0.23 s, then about 1 s waiting for basemap tiles |
| Repeat load with HTTP cache | 0.55 s |
| Click a building, 4 seasons + sea rose | 26 ms |
| Year ribbon, 73 days × 144 samples, Web Worker | 60 ms |
| City sun map without precompute, Web Worker | 2.3 s |
| Switching a city map, precomputed or cached | 25 ms |

## Data and licences

| What | Source | Licence |
| --- | --- | --- |
| Buildings, floors, heights, woods and parks, coastline | [OpenStreetMap](https://www.openstreetmap.org/copyright) via Overpass API | ODbL, © OpenStreetMap contributors |
| Terrain for the computation | [Copernicus DEM GLO-30](https://registry.opendata.aws/copernicus-dem/), AWS Open Data | © DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018, provided under COPERNICUS by the EU and ESA |
| Basemap and display terrain | [OpenFreeMap](https://openfreemap.org) / © OpenMapTiles, [Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) | open |
| Address search | [Photon](https://photon.komoot.io) by Komoot | OSM data, ODbL |

The data lives in `data/<city>/` and is committed. The site calls no APIs at runtime except address search.

## Limitations

- **Floor counts are known for only 14% of buildings in Tivat and 3% in Kotor.** The rest get a default by OSM tag and footprint: sheds, garages, carports, containers, roofs, ruins, construction sites and footprints under 40 m² get 1 floor, everything else 2. They are drawn semi-transparent, and the panel lets you correct the count. Open height layers do not help here: [GHS-BUILT-H](https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/GHSL/GHS_BUILT_H_GLOBE_R2023A/) (JRC, 100 m, CC BY 4.0) correlates weakly with known OSM heights in these towns (r = 0.22 in Tivat, 0.30 in Kotor) and errs more than the 2-floor constant (mean error 3.8 vs 2.9 m in Tivat, 5.3 vs 3.6 m in Kotor). In [Overture Maps](https://overturemaps.org/) (release 2026-09-23) heights and floor counts here come only from OSM, and its Microsoft ML footprints carry none.
- **Copernicus is a surface model**, so its cells include roofs and canopies. It is flattened under buildings. An exact ground needs a DTM.
- **Trees are OSM woods and parks** at a single height of 10 m.
- **"Sun in the window" means a direct line of sight** from the window point. Glazing, balconies and reflections are not modelled.
- **Ground shadows on the map are an illustration** on flat ground. Sun hours come from the rays.

## Run locally

```bash
nvm use            # Node ≥ 22.22 (.nvmrc → 24)
npm install
npm run dev        # http://localhost:4325
npm test           # ray-core tests
npm run check      # types
```

**Adding a city.** Describe it in `cities.config.mjs` and run `npm run fetch -- <id>`. That runs buildings, terrain with coastline, and the precompute. The city then appears in the switcher as `?c=<id>`.

**Deploy.** `.github/workflows/deploy.yml` runs type check, tests and build, then publishes to GitHub Pages on push to `main`. It only publishes while the repository is public. For Cloudflare Pages, use build `npm run build`, output `dist`, and env `NODE_VERSION=24`.
