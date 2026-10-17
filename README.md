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
- **Annual sun, BRE-style.** A 0–100 window score: the share of the year's hours with the sun above the horizon when it shines into the window on the chosen floor and facade, with a verdict against the UK [BRE 209](https://bregroup.com/store/bookshop/site-layout-planning-for-daylight-and-sunlight-a-guide-to-good-practice-br-209-2022-edition) guideline: at least 25% over the year and 5% between 21 September and 21 March (meets / borderline / fails). BRE uses “probable” hours that allow for cloud; there is no open hourly sunshine climatology for these cities, so we count clear-sky hours. The same score fills the floors × facades matrix and the comparison. Details on the [method page](https://yetit.github.io/sun-view/method?lang=en).
- **Sea view.** For each of 8 directions, whether water is visible from the window level and how far away it is.
- **City maps.** On load the whole city is coloured by winter sun; switch to the sea map, or pick the window height: 2, 5 or 10 m above ground. Colours follow the actual spread of hours in the current layer, and the legend shows them. Buildings lower than the chosen height are faded and shown from their top floor.
- **Time slider.** Building shading, ground shadows and the sun marker follow the time of day; ▶ plays a whole day.
- **Reliability label.** Each building gets high, medium or low reliability with the reasons: floor count estimated, steep slope, woods next to it.
- **Compare and share.** Pin up to four flats side by side, download a PNG card, or share the URL. The URL keeps the city, building, floor, side, season and time.
- **Keyboard.** Tab to the map. Enter selects the building in the centre, arrow keys move to the nearest building in that direction on screen, Esc clears the selection. The selection and its summary are announced to screen readers.
- **Embed.** Add `embed=1` to any link to get only the map, the building and a compact panel for an `<iframe>`. The iframe can size itself through `postMessage`. Ready-made code is on the [embed page](https://yetit.github.io/sun-view/embed/?lang=en) and below.

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

Code: `src/scripts/grid.ts` (rasters, rays), `analysis.ts` (seasons, annual BRE score, sea rose, city maps), `worker.ts`, `map/` (MapLibre layers, shadows), `ui/` (panel, timebar, mobile sheet). More detail with diagrams is on the [How it works](https://yetit.github.io/sun-view/method?lang=en) page.

## Validation

The terrain horizon was checked against [PVGIS](https://re.jrc.ec.europa.eu/pvg_tools/en/) from the European Commission JRC. The check covered 16 points in Tivat and Kotor, 48 azimuths each. North of 60° N, PVGIS terrain turns out to be a 30″ grid (about 0.9 × 0.5 km), not 3″: it puts Bergen's Fløyen funicular top station (320 m) at 140 m. So 8 points in Bergen were checked against a horizon built from the Norwegian Mapping Authority's 1 m lidar terrain model ([Kartverket](https://hoydedata.no) DTM). The full report is in Russian: [docs/horizon-check.md](docs/horizon-check.md).

| Where | Mean horizon difference | 21 December sunrise |
| --- | --- | --- |
| Flat ground by the sea, Tivat | 0.2° | same minute as PVGIS (±1) |
| All 8 points, Tivat | 1.5° (was 2.1°) | — |
| All 8 points, Kotor | 1.3° (was 1.7°) | — |
| Steep slope, Vrmac | 5.5° (was 8.3°) | 99 min later than PVGIS; sunset now matches (was 39 min early) |
| 7 hillside points vs the source Copernicus 1″ | 0.4° (was 2.2°) | — |
| All 8 points, Bergen, vs Kartverket DTM | 0.8° (was 1.0°) | — |
| Flat ground, Bergen: Bryggen, Festplassen, foot of Ulriken | 0.3–0.4° | within 1 min at Bryggen and Festplassen, 8 min early at Ulriken |
| Bergen against PVGIS, for reference | 5.0° | off by one to two hours: PVGIS's coarse terrain |

Terrain height is interpolated bilinearly, both at the observer and along the ray. Before, the nearest 60 m cell was used: on a slope the eye sat 20–30 m below the surface the ray sees, and the hill looked steeper. What remains on slopes against PVGIS is mostly PVGIS's own ground elevation: 339 m on the Vrmac slope against 312–317 m in three Copernicus samples. For buildings on steep slopes, uphill results are an estimate good to tens of minutes. Bergen showed one more error, now fixed. North of 50° N the Copernicus tiles have a coarser longitude step, and Bergen's cell centres fell exactly between two tile pixels. The nearest-pixel lookup took the one 15 m to the east, uphill, and slope points came out 12–17 m too high. Tiles are now sampled bilinearly. What remains in Bergen is the observer's height on forested slopes: Copernicus is a surface model and sits about 20 m above the bare ground there. On top of that, the noon sun is only 6° high on 21 December, so a one-degree error decides whether a hillside flat gets winter sun at all. The ray core is covered by synthetic tests (`npm test`): scenes with a hill, a neighbouring wall and the sea. `npm test` also checks the committed data. The building count in the precompute must match `buildings.json`, the example buildings must exist, and `dem.bin` must match the size in `dem.json`.

## Performance

Measured on an Apple M2 Pro with the production build (`astro preview`), Tivat, 3,625 buildings.

| | |
| --- | --- |
| JavaScript, gzip | 300 KB, mostly MapLibre |
| City data, gzip | 111 KB in Tivat, 112 KB in Kotor and 229 KB in Bergen for buildings, greenery and precomputed maps, plus a terrain grid of 420–490 KB |
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

What remains in TBT is the first MapLibre frames on SwiftShader. Shader compilation and terrain render-to-texture run on the CPU, and the main thread waits for them in synchronous GL calls. Without terrain the observed blocking drops from 2.7 s to 1.2–1.5 s, but terrain is part of the product. On a device with a GPU the same frames take tens of milliseconds.

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
