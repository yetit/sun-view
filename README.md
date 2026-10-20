# Sun & View

[![Build and deploy](https://github.com/yetit/sun-view/actions/workflows/deploy.yml/badge.svg)](https://github.com/yetit/sun-view/actions/workflows/deploy.yml)
[![Smoke & Lighthouse](https://github.com/yetit/sun-view/actions/workflows/live.yml/badge.svg)](https://github.com/yetit/sun-view/actions/workflows/live.yml)
[![Tests: node --test](https://img.shields.io/badge/tests-node%20--test-3c873a)](tests/)
[Русская версия](README.ru.md)

![Sun & View: Tivat coloured by winter sun, a click on a building, then the time of day runs from morning to evening](docs/demo.gif)

**Click any building, pick a floor, and see how many hours of direct sun reach its windows in each season, and in which directions the sea is visible. Everything is computed in your browser from open data.**

**Demo: [yetit.github.io/sun-view](https://yetit.github.io/sun-view/)** · Tivat, Kotor and Herceg Novi (Montenegro), Bergen (Norway) · English and Russian (`?lang=en|ru`)

## What it does

- **Sun in the windows.** Hours of direct sun for the March equinox, June solstice, September equinox and December solstice, plus a year ribbon (day × hour). Each season also shows the average with clouds, from PVGIS satellite data. Above the ribbon a “Clear sky / With clouds” switch (`cl=1` in the link) fades the yellow cells toward grey by the chance of direct sun on that day: a climate average for 2014–2023, not a forecast. Pick the whole building or one facing (N … NW).
- **Annual sun, BRE-style.** A 0–100 window score: the share of the year's probable sun hours when the sun shines into the window on the chosen floor and facade, with a verdict against the UK [BRE 209](https://bregroup.com/store/bookshop/site-layout-planning-for-daylight-and-sunlight-a-guide-to-good-practice-br-209-2022-edition) guideline: at least 25% over the year and 5% between 21 September and 21 March (meets / borderline / fails). Hours are “probable”, as in BRE: each is weighted by the chance of direct sun on that day of the year from PVGIS-SARAH3 satellite data. The same score fills the floors × facades matrix and the comparison. Details on the [method page](https://yetit.github.io/sun-view/method?lang=en).
- **Sea view.** For each of 8 directions, whether water is visible from the window level and how far away it is.
- **City maps.** On load the whole city is coloured by winter sun; switch to the sea map, or pick the window height: 2, 5 or 10 m above ground. Colours follow the actual spread of hours in the current layer, and the legend shows them. Buildings lower than the chosen height are faded and shown from their top floor.
- **Time slider.** Building shading, ground shadows and the sun marker follow the time of day; ▶ plays a whole day.
- **Reliability label.** Each building gets high, medium or low reliability with the reasons: floor count estimated, steep slope, trees taller than the building next to it.
- **Compare and share.** Pin up to four flats side by side, download a PNG card, or share the URL. The URL keeps the city, building, floor, side, season and time.
- **Where floor counts are missing.** The "Floors" map mode colours buildings that have no floor count in OSM by how many neighbours' sun or sea view depends on it. The same list is ready to survey: [docs/levels-todo](docs/levels-todo/). See [Help fill in floor counts](#help-fill-in-floor-counts).
- **Camera to the facade.** Picking a facade (chip, matrix cell, rose) smoothly turns the map to face that wall from outside; “All” leaves the map as it is. On the first visit a hint shows how to rotate the map: right-click drag or Ctrl + drag, two fingers on a phone.
- **Keyboard.** Tab to the map. Enter selects the building in the centre, arrow keys move to the nearest building in that direction on screen, Esc clears the selection. The selection and its summary are announced to screen readers.
- **Embed.** Add `embed=1` to any link to get only the map, the building and a compact panel for an `<iframe>`. The iframe can size itself through `postMessage`. Ready-made code is on the [embed page](https://yetit.github.io/sun-view/embed/?lang=en) and below.

## How it compares

Checked on 2026-10-19 against the products' own sites. Most sunlight tools answer "where is the sun" or "how long does the sun hit this address"; none of the ones below answers "can this window see the sea", and only three model the neighbours and terrain for a specific floor.

| Tool | Neighbours and terrain | Floor, facade | Sea view | Score vs a guideline | Price |
| --- | --- | --- | --- | --- | --- |
| **Sun & View** | 6 m roof raster from OSM, trees, terrain up to 15 km | floors × facades matrix | 8 directions and per facade, with distance | BRE 209 annual score | free, open source, no server |
| [Shadowmap](https://shadowmap.org/pricing) | global 3D buildings, terrain, trees; better buildings in DE, NL, CH, Vienna, Tokyo | floors on facades (Home tier), first-person view | — | — | free; Explorer €2.50/mo; Home €10/mo |
| [Sunlight Checker](https://sunlightchecker.remosia.biz/en/) (Remosia) | real heights from PLATEAU, ray casting; Japan only | floor picker; window direction in Pro | — | — | free; Pro ¥300/mo; iOS |
| [Sunworth](https://sunworth.app/) | terrain and footprints for a 20–200 m patch; sources not stated | not stated | — | — | not stated |
| [Coffee in the Sun](https://coffeeinthesun.app/use-cases/real-estate/) | OSM footprints and heights (±1 floor); no trees | side of the building | — | — | free; Pro for the full year |
| [Sunmap](https://sunmap.ru/) (Russia) | obstacles drawn by the agent by hand | windows and facades set by hand | — | — | plans for agents and developers, on request |
| [Will It Be Bright](https://willitbebright.com/) | obstruction and tree level chosen by hand | orientation and floor | — | — | Chrome extension $4.99 |
| [SunCheck](https://suncheckapp.com/) | not stated | window direction, "high floor" modifier | — | — | free |
| [Sun Seeker](https://apps.apple.com/app/id330247123) | — (AR sun path over the camera) | — | — | — | ~$10 one-off, iOS |
| [Google Earth Viewshed](https://support.google.com/earth/answer/3064261) | terrain and 3D buildings | observer height set by hand | viewshed, "not scientific precision" | — | free, manual |
| [UpToWhere](https://uptowhere.com/about) | Copernicus GLO-30 surface; buildings are not obstacles | observer height | lists "sea view" as a use case | — | free |

What this project does that the others don't: the sea view per facade and floor, the annual score against a published guideline, the floors × facades matrix that picks the best flat in a building, and a method that is open and checked against PVGIS and a national terrain model. What the others do better: Shadowmap covers the whole world with a polished 3D view, Sunlight Checker has official building models with real heights, Sunmap and Will It Be Bright produce agent-branded reports. Sun & View covers only the cities in its config, and its floor counts are only as good as OpenStreetMap: known for 14% of buildings in Tivat.

## Cities

| City | Why | Buildings | Floor count in OSM |
| --- | --- | --- | --- |
| Tivat | Bay town on the Adriatic, terrain to the north-east | 3,625 | 14% |
| Kotor | Old town at the foot of a steep mountain, a narrow fjord-like bay | 3,654 | 3% |
| Herceg Novi | South-facing slope at the mouth of the Bay of Kotor, from the waterfront up to Topla and Savina | 4,916 | 3% |
| Bergen | 60° N: in December the sun rises only about 6° at noon; the centre sits between a fjord and the "seven mountains" | 5,030 | 58% |

**Why Bergen.** I wanted a third city that differs in latitude and terrain and has decent floor data. Among Tromsø, Bergen, Trondheim, Ålesund, Bodø, Innsbruck and Lugano, Bergen has the best floor coverage at 54–58% of central buildings. It also has the sea, so the sea view still means something. Innsbruck has similar coverage but no sea. Tromsø is further north, but only 34% of its buildings have floor counts. Buildings in Bergen carry no addresses in OSM, because Norway maps them as separate points. They are labelled with the nearest street instead.

![A house in Tivat on the winter sun map: the annual BRE score, season cards with the average with clouds and the bare-tree bound, and the year ribbon](docs/screenshot.png)

## How it works

1. **A world in metres.** Footprints from OpenStreetMap become a 6 m roof raster holding the absolute height of every roof and tree canopy. Copernicus DEM GLO-30 becomes a 60 m terrain grid that reaches about 15 km around the city.
2. **Ray-marching in the browser.** For every 10 minutes of the day the sun position comes from [suncalc](https://github.com/mourner/suncalc). A ray from the window steps 3 m up to 1 km, checking roofs, trees and terrain, then 30 m up to 15 km, checking terrain only. A hit means shade.
3. **Sea view** uses the same march. It keeps the highest elevation angle of anything in the way, and a sea cell counts as visible if its angle beats every obstacle before it.
4. **Web Worker and precompute.** City-wide sun and sea maps are 15 layers per city, 54 KB. `scripts/precompute.ts` builds them when the data is fetched, so the map is coloured instantly. Without them, and for the year ribbon, a Web Worker computes in the background. Results are cached per layer.

Code: `src/scripts/grid.ts` (rasters, rays), `analysis.ts` (seasons, annual BRE score, sea rose, city maps), `worker.ts`, `map/` (MapLibre layers, shadows), `ui/` (panel, timebar, mobile sheet). More detail with diagrams is on the [How it works](https://yetit.github.io/sun-view/method?lang=en) page.

## Validation

The terrain horizon was checked against [PVGIS](https://re.jrc.ec.europa.eu/pvg_tools/en/) from the European Commission JRC. The check covered 16 points in Tivat and Kotor, 48 azimuths each. North of 60° N, PVGIS terrain turns out to be a 30″ grid (about 0.9 × 0.5 km), not 3″: it puts Bergen's Fløyen funicular top station (320 m) at 140 m. So 8 points in Bergen were checked against a horizon built from the Norwegian Mapping Authority's 1 m lidar terrain model ([Kartverket](https://hoydedata.no) DTM). The full report is in Russian: [docs/horizon-check.md](docs/horizon-check.md).

| Where | Mean horizon difference | 21 December sunrise |
| --- | --- | --- |
| Flat ground by the sea, Tivat | 0.2° | same minute as PVGIS (±1) |
| All 8 points, Tivat | 1.5° (was 2.1°) | — |
| All 8 points, Kotor | 1.3° (was 1.7°) | — |
| All 8 points, Herceg Novi | 1.2° | within 3 min on the shore; 32–47 min earlier than PVGIS on the slope, from the ground elevation |
| Steep slope, Vrmac | 5.5° (was 8.3°) | 99 min later than PVGIS; sunset now matches (was 39 min early) |
| 7 hillside points vs the source Copernicus 1″ | 0.4° (was 2.2°) | — |
| All 8 points, Bergen, vs Kartverket DTM | 0.6° (was 0.8° on Copernicus) | — |
| Flat ground, Bergen: Bryggen, Festplassen, foot of Ulriken | 0.3–0.4° | within 1 min at Bryggen and Festplassen, 8 min early at Ulriken |
| Bergen against PVGIS, for reference | 5.0° | off by one to two hours: PVGIS's coarse terrain |

Terrain height is interpolated bilinearly, both at the observer and along the ray. Before, the nearest 60 m cell was used: on a slope the eye sat 20–30 m below the surface the ray sees, and the hill looked steeper. What remains on slopes against PVGIS is mostly PVGIS's own ground elevation: 339 m on the Vrmac slope against 312–317 m in three Copernicus samples. For buildings on steep slopes, uphill results are an estimate good to tens of minutes. Bergen showed one more error, now fixed. North of 50° N the Copernicus tiles have a coarser longitude step, and Bergen's cell centres fell exactly between two tile pixels. The nearest-pixel lookup took the one 15 m to the east, uphill, and slope points came out 12–17 m too high. Tiles are now sampled bilinearly. Bergen's terrain now comes from Kartverket's 1 m lidar DTM, so forested slopes no longer lift the observer about 20 m above the bare ground, as Copernicus did. On top of that, the noon sun is only 6° high on 21 December, so a one-degree error decides whether a hillside flat gets winter sun at all. The ray core is covered by synthetic tests (`npm test`): scenes with a hill, a neighbouring wall and the sea. `npm test` also checks the committed data. The building count in the precompute must match `buildings.json`, the example buildings must exist, and `dem.bin` must match the size in `dem.json`.

## Performance

Measured on an Apple M2 Pro with the production build (`astro preview`), Tivat, 3,625 buildings.

| | |
| --- | --- |
| JavaScript, gzip | 300 KB, mostly MapLibre |
| City data, gzip | 233 KB in Tivat, 262 KB in Kotor and 248 KB in Bergen for buildings, tree heights and precomputed maps, plus a terrain grid of 420–490 KB |
| First load until the coloured map | 2.0–2.4 s: data 0.15 s, roof raster in the worker 0.22 s, the rest is waiting for basemap and terrain tiles |
| Main-thread long tasks during load | 60–80 ms in total (before the Lighthouse round below: 200–320 ms) |
| Repeat load with HTTP cache | 0.55 s |
| Click a building, 4 seasons + sea rose | 26 ms |
| Year ribbon, 73 days × 144 samples, Web Worker | 80 ms* |
| City sun map without precompute, Web Worker | 3.4 s* |
| Switching a city map, precomputed or cached | 25 ms |

\* Rescaled after the switch to bilinear terrain, which made ray tracing about 1.3–1.5× slower in Node on the same machine (ribbon 47 → 62 ms, city map 2.2 → 3.4 s). A click changed by about 1 ms.

### Lighthouse

Measured the way CI does it (`lighthouserc.json`: mobile profile, simulated 4× CPU slowdown, WebGL on SwiftShader, 3 runs, median), Lighthouse 12.6.1, map page `?lang=en` from a local static server with gzip, 2026-10-17.

| Map page | Before | After |
| --- | --- | --- |
| Performance, median (range) | 33 (30–33) | 64 (64–65) |
| First Contentful Paint | 3.4–4.0 s | 1.4 s |
| Largest Contentful Paint | 16.3–16.8 s | 1.5 s |
| Total Blocking Time | 8.0–9.1 s | 3.2–5.4 s |
| Speed Index | 6.0–7.9 s | 6.2–6.4 s |

On the GitHub runner the map page scored 33–40 before. What changed, each step chosen by the profiler:

1. **WebGL warm-up in a worker.** In Chrome on SwiftShader the first WebGL context takes about 2 s, and the old check held the main thread for all of it. Lighthouse multiplies that by 4. Now a throwaway context is created on an `OffscreenCanvas` in a worker. After that the page's own check and the map's context take tens of milliseconds (`fallback.ts`).
2. **The legend appears at once.** The legend title is the LCP element. Before, it appeared only after the data, the world and the map, with a render delay of 16.8 s. Its title and colours do not depend on the computation, so `main.ts` shows them before the 1 MB MapLibre bundle loads. The hour scale is filled in when the layer is ready.
3. **Roof raster only in the worker.** `createWorld` rasterised roofs and trees on the main thread (0.84 s under the 4× slowdown) and again in the worker. Now the worker sends a copy of its raster to the page.

Checked and left as is: the example calculations at start take 29 ms under the 4× slowdown, `feature-state` for 3.6–5 thousand buildings takes 51 ms, and `buildings.json` as a JS module parsed in milliseconds. The binary format below confirmed that it mostly saves traffic.

What remains in TBT is the first MapLibre frames on SwiftShader: shader compilation and the page's first WebGL context run on the CPU, and the main thread waits for them in synchronous GL calls. Terrain is the most expensive part, so 3D terrain is switched on after the map first goes idle (`map/layers.ts`): the longest task (3.4 s) is gone, and evaluating the map chunk dropped from 6.1 to 1.8 s. Locally, same Lighthouse 12.6.1, two runs each: Performance 60–62 → 62–66, TBT 2.4–5.4 → 1.3–2.5 s, Speed Index 9.0–9.6 → 8.2–8.4 s. The city shows at once and the mountains rise a moment later. On a device with a GPU the same frames take tens of milliseconds.

### Binary building format

Buildings used to ship as GeoJSON inside a JS module. Now each city has `buildings.bin` with `buildings.meta.json`, loaded with `fetch` (`src/scripts/buildings-bin.ts`).
- **Coordinates.** Int16 in metres from the city's origin, in steps of 5–15 cm. Each ring stores its first point absolute and the rest as deltas, which gzip compresses well.
- **Attributes.** Ring and building offsets, floors, heights, and indexes into tables of names, addresses, streets and types.
- **Worker.** It gets the ArrayBuffer instead of a copy of the GeoJSON objects.

`buildings.json` stays in the repository as the source for the scripts. A test checks that `buildings.bin` matches it to within one step.

| Per city, GitHub Pages serves gzip | GeoJSON in JS before | `buildings.bin` + meta after |
| --- | --- | --- |
| Tivat | 1,121 KB, 157 KB gzip | 160 KB, 78 KB gzip |
| Kotor | 1,139 KB, 153 KB gzip | 159 KB, 76 KB gzip |
| Bergen | 2,116 KB, 342 KB gzip | 327 KB, 184 KB gzip |

Load stages from `npm run bench -- <url> 3 4` on the production build. These are 6 runs per city under a 4× CPU slowdown, alternating between the old and new build. The "data loaded" stage got faster: Tivat from 1.66–2.00 s to 0.97–0.99 s, Kotor from 0.99–1.12 s to 0.89–0.96 s, Bergen from 0.91–1.17 s to 0.80–1.00 s. The later stages are dominated by basemap tiles from the network and vary by several seconds between runs.

**Lighthouse did not change.** Locally, 3 runs each: performance median 58 before and 56 after, total blocking time 7.1 s and 6.8 s, within noise. Almost all main-thread time is the MapLibre bundle: 6–7 s of script evaluation under Lighthouse's slowdown, where WebGL runs on SwiftShader on the CPU. Parsing the GeoJSON module was never the bottleneck, as the profile above had already shown. The binary format halves the building data on the wire and takes the GeoJSON copy out of the worker handshake. On the GitHub runner, the map page scored 33, 40 and 65 before (median 40) and 43, 63 and 63 after (median 63), with page weight going from 2,550 to 2,468 KB. The ranges overlap, so I don't count it as a gain from the format.

### Lazy MapLibre

`boot.ts` used to import MapLibre statically, so the browser downloaded and evaluated about 1 MB of JS before it even requested the city data. Now `boot.ts` is 2 KB. It requests the data first and starts a dynamic import of `ui/start.ts` (MapLibre and the map UI) in parallel. The worker builds its world while the map bundle loads.

| Production build, CPU ×4, 6 runs per stage, old and new builds alternating | Before | After |
| --- | --- | --- |
| Data loaded | 0.85–1.68 s | 0.35–0.65 s |
| Worker ready | 1.11–1.78 s | 0.83–1.30 s |
| Map painted | 4.3–5.4 s | 4.1–5.2 s |

Local Lighthouse, 5 runs each: performance median 62 before and 62 after. Total blocking time median went from 9.0 s to 5.6 s, but with a wide spread (2.8–11.2 s before, 2.9–6.0 s after). LCP went from 1.52 s to 1.67 s. The early stages gain beyond noise, while the time to a painted map is set by basemap tiles from the network. On the GitHub runner the map page scored 40, 62 and 66 before (median 62) and 39, 62 and 65 after (median 62). I kept the change because data and the worker are ready half a second sooner, even though the Lighthouse score did not move.

## Data and licences

| What | Source | Licence |
| --- | --- | --- |
| Buildings, floors, heights, coastline | [OpenStreetMap](https://www.openstreetmap.org/copyright) via Overpass API | ODbL, © OpenStreetMap contributors |
| Tree heights | [High Resolution Canopy Height Maps](https://registry.opendata.aws/dataforgood-fb-forests/) by WRI and Meta, AWS Open Data; leaf type from [Copernicus HRL Dominant Leaf Type 2018](https://land.copernicus.eu/en/products/high-resolution-layer-dominant-leaf-type) | CC BY 4.0, © Meta and World Resources Institute; © European Union, Copernicus Land Monitoring Service |
| Terrain for the computation in Bergen | [Kartverket DTM 1 m](https://hoydedata.no), WCS | © Kartverket, CC BY 4.0 |
| Cloud (chance of direct sun by month), daytime temperature and wind | [PVGIS](https://re.jrc.ec.europa.eu/pvg_tools/en/): SARAH3 hourly series 2014–2023 (radiation, ERA5 temperature) and the typical meteorological year (ERA5 wind 2005–2023), JRC | © European Union, reuse with attribution |
| Terrain for the computation | [Copernicus DEM GLO-30](https://registry.opendata.aws/copernicus-dem/), AWS Open Data | © DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018, provided under COPERNICUS by the EU and ESA |
| Basemap and display terrain | [OpenFreeMap](https://openfreemap.org) / © OpenMapTiles, [Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) | open |
| Address search | [Photon](https://photon.komoot.io) by Komoot | OSM data, ODbL |

The data lives in `data/<city>/` and is committed. The site calls no APIs at runtime except address search.

**Licence.** The code is under the [MIT licence](LICENSE). The data keeps its sources' terms: OpenStreetMap-derived files, including the precomputed maps and the survey lists, are under ODbL 1.0, and the terrain is under the Copernicus DEM licence. The details per file are in [DATA-LICENSE.md](DATA-LICENSE.md).

## Limitations

- **Floor counts are known for only 14% of buildings in Tivat and 3% in Kotor.** The rest get a default by OSM tag and footprint: sheds, garages, carports, containers, roofs, ruins, construction sites and footprints under 40 m² get 1 floor, everything else 2. They are drawn semi-transparent, and the panel lets you correct the count. Open height layers do not help here: [GHS-BUILT-H](https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/GHSL/GHS_BUILT_H_GLOBE_R2023A/) (JRC, 100 m, CC BY 4.0) correlates weakly with known OSM heights in these towns (r = 0.22 in Tivat, 0.30 in Kotor) and errs more than the 2-floor constant (mean error 3.8 vs 2.9 m in Tivat, 5.3 vs 3.6 m in Kotor). Overture Maps does not help either ([docs/overture-check.md](docs/overture-check.md)): in release 2026-09-23.1 it has floor counts for 494 buildings in Tivat and 112 in Kotor, all of them from OSM (493 of 493 and 112 of 112 identical, r = 1.0); the 3,130 and 3,542 buildings without floors in OSM have none in Overture either.
- **Copernicus is a surface model**, so its cells include roofs and canopies. It is flattened under buildings. Tivat and Kotor would need a DTM for exact ground; in Bergen the ground already comes from Kartverket's 1 m lidar DTM.
- **Tree heights come from a satellite model** (Meta and WRI, about 1 m per pixel, about 3 m error), reduced to a 6 m grid. Leaves stay on in every count; for spring and winter the panel adds an upper bound with broadleaved trees bare (leaf type from Copernicus HRL Dominant Leaf Type 2018), because the data cannot tell deciduous trees from evergreen olives and holm oaks.
- **"Sun in the window" means a direct line of sight** from the window point. Glazing, balconies and reflections are not modelled.
- **Ground shadows on the map are an illustration** on flat ground. Sun hours come from the rays.

## Help fill in floor counts

Floor counts are missing for most buildings in Tivat and Kotor and for about 40% in Bergen. Where they are missing, the sun and the view are estimates. `npm run levels -- <city>` ranks those buildings by how much their unknown floor count matters to the neighbours. It raises each one from 1 to 4 floors and counts the neighbours within 100 m whose winter sun changes by half an hour or more, or who gain or lose a sea view. The result is in [docs/levels-todo](docs/levels-todo/): `<city>.csv` is the top 100 for a walk, and `<city>.geojson` is ready for MapRoulette. On the map, the "Floors" mode shows the same order.

**This project never edits OpenStreetMap; people do.** Ways to help:
- **StreetComplete** on Android has a quest for building floor counts. Walk past the buildings from the list and answer what you see.
- **MapRoulette**: create a challenge from `<city>.geojson`. Setup and the challenge instruction are in [docs/levels-todo/README.md](docs/levels-todo/README.md).
- **JOSM or iD**: open the building from the `osm` link and add `building:levels`, the number of above-ground floors, and `roof:levels` if the roof has habitable floors.

**OSM rules apply.** Add only what you have seen on site or on street-level imagery with a compatible licence, such as Mapillary or Panoramax. Do not guess from shadows, satellite images, Google Street View or listings. If you can't tell, leave it. Don't import the list as data; it is only a to-do list.

## Embed

```html
<iframe id="sun-view" title="Sun & View"
  src="https://yetit.github.io/sun-view/?embed=1&c=tivat&b=193467133&f=10&s=3&t=11&m=sun&lang=en"
  style="width:100%;height:720px;border:0" loading="lazy"></iframe>
<script>
  // Sun & View reports its page height; the iframe grows to fit.
  addEventListener('message', (e) => {
    if (e.origin !== 'https://yetit.github.io' || e.data?.type !== 'sun-view:height') return;
    document.getElementById('sun-view').style.height = e.data.height + 'px';
  });
</script>
```

The link takes the same parameters as the app's address bar: `c` city, `b` building (OSM id), `f` floor, `s` season, `t` hour, `lang`. Without the script, set the height yourself.

## Run locally

```bash
nvm use            # Node ≥ 22.22 (.nvmrc → 24)
npm install
npm run dev        # http://localhost:4325
npm test           # ray-core tests
npm run check      # types
npm run size       # size budgets after a build: start JS, map chunk, worker, data per city
npm run demo:full  # 2.5-minute walkthrough video with captions, 1920×1080 → docs/demo-full.mp4 (--lang en for English); needs astro preview on 4326
npm run test:e2e   # Playwright against the production build: smoke for every city, matrix, compare, PNG, URL state, language, embed, keyboard
```

**Adding a city.** Describe it in `cities.config.mjs` and run `npm run fetch -- <id>`. That runs buildings, packs them into `buildings.bin`, then terrain with coastline, and the precompute. The city then appears in the switcher as `?c=<id>`.

**Deploy.** `.github/workflows/deploy.yml` runs type check, tests and build, then publishes to GitHub Pages on push to `main`. It only publishes while the repository is public. Once a month, `.github/workflows/data.yml` re-fetches every city and opens a pull request if anything besides the fetch date changed. Overpass often answers 5xx, so each city gets up to three attempts. The PR description lists buildings before and after, the share with floor counts, and whether the example buildings are still there. For the bot to open PRs, enable Settings → Actions → General → "Allow GitHub Actions to create and approve pull requests". After each deploy, `.github/workflows/live.yml` checks the published page:
- **Playwright smoke test** for every city: the map container has height, the map is drawn, and a click on an example fills the panel.
- **Lighthouse**, 3 runs on the mobile profile, median. Thresholds are in `lighthouserc.json` and are set from measurements on the GitHub runner. The map page scored 33–40 for performance before the optimisation round described under Performance, and 64–65 after it in the same measurement on an M2 Pro; its threshold is 55, to be refined after the first runs on the runner. The method page scored 98–99; its threshold is 90. Accessibility, best practices and SEO scored 100 on both pages; their threshold is 95. What holds the map page back is Total Blocking Time: the first WebGL frames with terrain are rendered on the CPU by SwiftShader.

**Moving to Cloudflare Pages.** GitHub Pages serves every file with `max-age=600` and cannot be configured. That means even hashed assets are revalidated every 10 minutes, and a fresh HTML can take up to 10 minutes to appear. Cloudflare Pages lets you set headers. To move:
1. In Cloudflare, go to Workers & Pages → Create → Pages → Connect to Git and pick this repository.
2. Set build command `npm run build`, output `dist`, env `NODE_VERSION=24`. Leave `BASE_PATH` unset: the site is served from the root.
3. Add `public/_headers` with `/_astro/*` → `Cache-Control: public, max-age=31536000, immutable`.
4. Point `SITE` to the new domain for `og:image`, and update the demo link, `homepage` and `DEMO` in `live.yml`.

**A custom domain on GitHub Pages, for later.** Nothing is connected now. To connect one:
1. **DNS.** For a subdomain such as `sun.example.com`, add a `CNAME` record pointing to `yetit.github.io`. For an apex domain, add `A` records `185.199.108.153`, `185.199.109.153`, `185.199.110.153` and `185.199.111.153`, and the matching `AAAA` records `2606:50c0:8000::153` to `2606:50c0:8003::153`.
2. **Pages settings.** In Settings → Pages → Custom domain, enter the domain, wait for the DNS check, then turn on Enforce HTTPS. Verifying the domain in your account settings protects it from takeover.
3. **CNAME file.** Add `public/CNAME` containing the domain on one line. With a workflow deploy the settings field is what counts, but the file keeps the setting in the repository.
4. **Base path.** The site moves from `/sun-view/` to the root. In `.github/workflows/deploy.yml`, set `BASE_PATH: /` and `SITE: https://<domain>`. `astro.config.mjs` reads both, so `site` and `base` follow.
5. **Absolute links.** Update every `https://yetit.github.io/sun-view/`:
   - `DEMO` in `.github/workflows/live.yml`, and the repository homepage;
   - the demo links and the embed code in both READMEs;
   - `demo` in `src/pages/embed.astro`;
   - the origin check `e.origin !== 'https://yetit.github.io'` in the embed code, which becomes `https://<domain>`.

   `og:image` and `og:url` are built from `SITE` and need no edits.
