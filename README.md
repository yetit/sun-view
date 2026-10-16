# Sun & View

[![Build and deploy](https://github.com/yetit/sun-view/actions/workflows/deploy.yml/badge.svg)](https://github.com/yetit/sun-view/actions/workflows/deploy.yml)
[![Smoke & Lighthouse](https://github.com/yetit/sun-view/actions/workflows/live.yml/badge.svg)](https://github.com/yetit/sun-view/actions/workflows/live.yml)
[![Tests: node --test](https://img.shields.io/badge/tests-node%20--test-3c873a)](tests/)
[Русская версия](README.ru.md)

![Sun & View: Tivat coloured by winter sun, a click on a building, then the time of day runs from morning to evening](docs/demo.gif)

**Click any building, pick a floor, and see how many hours of direct sun reach its windows in each season, and in which directions the sea is visible. Everything is computed in your browser from open data.**

**Demo: [yetit.github.io/sun-view](https://yetit.github.io/sun-view/)** · Tivat and Kotor (Montenegro), Bergen (Norway) · English and Russian (`?lang=en|ru`)

## What it does

- **Sun in the windows.** Hours of direct sun for the March equinox, June solstice, September equinox and December solstice, plus a year ribbon (day × hour). Pick the whole building or one facing (N … NW).
- **Sea view.** For each of 8 directions, whether water is visible from the window level and how far away it is.
- **City maps.** On load the whole city is coloured by winter sun; switch to the sea map, or pick the window height: 2, 5 or 10 m above ground. Colours follow the actual spread of hours in the current layer, and the legend shows them. Buildings lower than the chosen height are faded and shown from their top floor.
- **Time slider.** Building shading, ground shadows and the sun marker follow the time of day; ▶ plays a whole day.
- **Reliability label.** Each building gets high, medium or low reliability with the reasons: floor count estimated, steep slope, woods next to it.
- **Compare and share.** Pin up to four flats side by side, download a PNG card, or share the URL. The URL keeps the city, building, floor, side, season and time.

## Cities

| City | Why | Buildings | Floor count in OSM |
| --- | --- | --- | --- |
| Tivat | Bay town on the Adriatic, terrain to the north-east | 3,625 | 14% |
| Kotor | Old town at the foot of a steep mountain, a narrow fjord-like bay | 3,654 | 3% |
| Bergen | 60° N: in December the sun rises only about 6° at noon; the centre sits between a fjord and the "seven mountains" | 5,030 | 58% |

**Why Bergen.** I wanted a third city that differs in latitude and terrain and has decent floor data. Among Tromsø, Bergen, Trondheim, Ålesund, Bodø, Innsbruck and Lugano, Bergen has the best floor coverage at 54–58% of central buildings. It also has the sea, so the sea view still means something. Innsbruck has similar coverage but no sea. Tromsø is further north, but only 34% of its buildings have floor counts. Buildings in Bergen carry no addresses in OSM, because Norway maps them as separate points. They are labelled with the nearest street instead.

![A building in Tivat with sea-view sectors, the sun path and a result card](docs/screenshot.png)

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
| Flat ground by the sea, Tivat | 0.2° | same minute as PVGIS (±1) |
| All 8 points, Tivat | 1.5° (was 2.1°) | — |
| All 8 points, Kotor | 1.3° (was 1.7°) | — |
| Steep slope, Vrmac | 5.6° (was 8.3°) | 98 min later than PVGIS; sunset now matches (was 39 min early) |
| 7 hillside points vs the source Copernicus 1″ | 0.4° (was 2.2°) | — |

Terrain height is interpolated bilinearly, both at the observer and along the ray. Before, the nearest 60 m cell was used: on a slope the eye sat 20–30 m below the surface the ray sees, and the hill looked steeper. What remains on slopes against PVGIS is mostly PVGIS's own ground elevation: 339 m on the Vrmac slope against 312–317 m in three Copernicus samples. For buildings on steep slopes, uphill results are an estimate good to tens of minutes. The ray core is covered by synthetic tests (`npm test`): scenes with a hill, a neighbouring wall and the sea.

## Performance

Measured on an Apple M2 Pro with the production build (`astro preview`), Tivat, 3,625 buildings.

| | |
| --- | --- |
| JavaScript, gzip | 300 KB, mostly MapLibre |
| City data, gzip | 190 KB of buildings, greenery and precomputed maps, plus a 0.9 MB terrain grid |
| First load until the coloured map | 1.9 s: data 0.44 s, world 0.17 s, worker 0.23 s, then about 1 s waiting for basemap tiles |
| Repeat load with HTTP cache | 0.55 s |
| Click a building, 4 seasons + sea rose | 26 ms |
| Year ribbon, 73 days × 144 samples, Web Worker | 80 ms* |
| City sun map without precompute, Web Worker | 3.4 s* |
| Switching a city map, precomputed or cached | 25 ms |

\* Rescaled after the switch to bilinear terrain, which made ray tracing about 1.3–1.5× slower in Node on the same machine (ribbon 47 → 62 ms, city map 2.2 → 3.4 s). A click changed by about 1 ms.

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
npm run test:e2e   # Playwright smoke test against the production build
```

**Adding a city.** Describe it in `cities.config.mjs` and run `npm run fetch -- <id>`. That runs buildings, terrain with coastline, and the precompute. The city then appears in the switcher as `?c=<id>`.

**Deploy.** `.github/workflows/deploy.yml` runs type check, tests and build, then publishes to GitHub Pages on push to `main`. It only publishes while the repository is public. After each deploy, `.github/workflows/live.yml` checks the published page:
- **Playwright smoke test** for every city: the map container has height, the map is drawn, and a click on an example fills the panel.
- **Lighthouse**, 3 runs on the mobile profile, median. Thresholds are in `lighthouserc.json` and are set from measurements on the GitHub runner. The map page scored 33–40 for performance; its threshold is 30. The method page scored 98–99; its threshold is 90. Accessibility, best practices and SEO scored 100 on both pages; their threshold is 95. Performance on the map page is low because of the WebGL map with terrain and 3D buildings, plus building the rasters on the main thread under the profile's 4× CPU slowdown.

**Moving to Cloudflare Pages.** GitHub Pages serves every file with `max-age=600` and cannot be configured. That means even hashed assets are revalidated every 10 minutes, and a fresh HTML can take up to 10 minutes to appear. Cloudflare Pages lets you set headers. To move:
1. In Cloudflare, go to Workers & Pages → Create → Pages → Connect to Git and pick this repository.
2. Set build command `npm run build`, output `dist`, env `NODE_VERSION=24`. Leave `BASE_PATH` unset: the site is served from the root.
3. Add `public/_headers` with `/_astro/*` → `Cache-Control: public, max-age=31536000, immutable`.
4. Point `SITE` to the new domain for `og:image`, and update the demo link, `homepage` and `DEMO` in `live.yml`.
