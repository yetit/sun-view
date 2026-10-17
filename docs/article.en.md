<!-- DRAFT for dev.to. Not published. Numbers are from the README, docs/horizon-check.md and my own run of the core on the data in main 63b6d1f, 2026-10-18. Contents: data, rays, horizon validation, facades and the matrix, the BRE annual window score, trees and clouds, the window view, Bergen, performance, what didn't work. -->

# How much sun reaches a window? Ray-marching open terrain data in the browser

When you look at a flat by the sea, everyone asks the same two questions: will it get sun in winter, and can you see the sea? The developer says yes to both. I wanted to check for myself, with no developer and no server: click a building on a 3D map, pick a floor and a side, and within tens of milliseconds see the hours of direct sun per season and in which directions the water is visible.

The result is [Sun & View](https://yetit.github.io/sun-view/): Tivat, Kotor and Herceg Novi in Montenegro and Bergen in Norway, built on open data and computed entirely in the browser. For a window it gives an annual score against the UK BRE guideline and shows the view from it. Here is how it works, how I checked that it doesn't lie, and what didn't work.

## Data

- **Buildings** come from OpenStreetMap via the Overpass API: footprints, `building:levels`, `height` and addresses. Buildings without an address are labelled with the nearest street.
- **Terrain** is Copernicus DEM GLO-30. It sits on AWS Open Data as cloud-optimised GeoTIFFs, so you can read just the window you need from a 1°×1° tile with HTTP range requests (the `geotiff` library), with no sign-up and no gigabyte downloads. The terrain extends about 15 km around the city, because mountains block the low winter sun from kilometres away. In Bergen the ground is Kartverket's 1 m lidar DTM, which its WCS serves straight on our grid.
- **The sea** is not "elevation ≤ 0". It comes from the OSM coastline (`natural=coastline`, land on the left, water on the right). Otherwise low meadows and vacant lots by the waterfront count as sea.
- **Trees** come from the Meta and WRI canopy height map (about 1 m per pixel, CC BY 4.0, also COGs on AWS), reduced to a 6 m grid; leaf type comes from Copernicus HRL Dominant Leaf Type.
- **Cloud** comes from hourly PVGIS-SARAH3 direct irradiance for 2014–2023.
- **The sun** comes from `suncalc`.

Everything is fetched once by scripts and committed to the repository. At runtime the site calls no APIs except address search.

## A world in metres

The city is projected to a local frame: metres east and north of the centre, height above sea level. Then two grids:

1. **Terrain** at about 60 m per cell (2″). Heights between nodes are interpolated bilinearly, which turned out to matter (more below).
2. **A roof raster** at 6 m per cell. Each cell holds the absolute top of a building or canopy and the building's index (trees get separate codes for conifers and broadleaves). That turns "does the ray hit a neighbour" from a polygon search into a single array read.

## A ray toward the sun

For the chosen day, every 10 minutes we take the sun's azimuth and altitude and march a ray from the window:

```ts
for (let d = 2; d < FAR; d += d < NEAR ? 3 : 30) {
  const zr = z + d * tz;                 // ray height at distance d
  if (zr > w.dem.max) return false;      // above the highest peak: clear from here on
  const px = x + d * sx, py = y + d * sy;
  if (d < NEAR) {                        // up to 1 km: roofs and trees
    const [roof, i] = roofAt(w.roofs, px, py);
    if (i !== b.idx && roof > zr) return true;
  }
  if (d < skipDem) continue;             // our own terrain cell is us
  const t = demAt(w.dem, ...w.proj.toLonLat(px, py));
  if (t == null) return false;
  if (t > zr) return true;               // hit a hill
}
```

The step is 3 m up to a kilometre, then 30 m up to 15 km, terrain only. The window sits at mid-floor height. If a side is chosen, it sits on that wall and only sees the sun in front of it. Sun hours are the share of lit samples.

The sea view uses the same march, but instead of "hit or not" it keeps the highest elevation angle of any obstacle. A water cell is visible if its angle beats everything before it. That way distant water shows over a low shore.

## Making it fast

- A click on a building (4 seasons × 144 samples plus the sea rose) takes **26 ms** on an M2 Pro in the production build.
- The year ribbon (73 days × 144 samples) runs in a **Web Worker** in 60 ms, so the UI never stutters.
- A city-wide sun map for all 3,625 buildings of Tivat takes 2.3 s in the worker. That is too slow for the first screen, so the maps are **precomputed** when the data is fetched: 15 layers per city, 54 KB. The city is coloured the moment it loads.

## Validation: is the horizon right?

Synthetic tests (a hill, a wall, the sea) catch sign and index bugs, but they can't tell you whether the result matches reality. The European Commission has an independent source: [PVGIS](https://re.jrc.ec.europa.eu/pvg_tools/en/) returns the horizon profile for any point through a free API. I compared our horizon with it at 24 points in Tivat, Kotor and Herceg Novi, 48 azimuths each.

| Where | Mean difference | 21 December sunrise |
| --- | --- | --- |
| Flat ground by the sea, Tivat | 0.2° | same minute (±1) |
| All points, Tivat | 1.5° | — |
| All points, Kotor | 1.3° | — |
| All points, Herceg Novi | 1.2° | within 3 min on the shore |
| Steep slope, Vrmac | 5.6° | 98 min later than PVGIS |

The check found two real bugs:

1. **The terrain was cropped too close.** Mountains south-east of Tivat fell outside the grid, so the winter sunrise came 10–16 minutes early. The terrain now extends to the ray's limit.
2. **Pixel registration.** Copernicus tiles are tagged `PixelIsPoint`: the coordinate marks the pixel centre, not its corner. The script was picking the neighbouring pixel to the west and north, a shift of up to 30 m, or 10–20 m of height on slopes.

It also exposed one unpleasant property: on slopes, everything depends on the observer's own elevation. A 60 m cell on a 30–50% slope spans 20–30 m of height, and terrain sources disagree by tens of metres. Without interpolation the eye sat below the surface the ray sees, and the nearby slope looked 10–30° steeper. Bilinear interpolation cut the slope error from 8.3° to 5.6°, and to 0.4° against the source Copernicus 1″ tile. The rest is mostly PVGIS's own ground elevation.

## Facades and "the best flat in the building"

The first version put the window on a compass-direction wall: "windows facing SE". But buildings are rotated any which way, and a house may simply not have a south-east wall. Now facades come from the OSM footprint:

- neighbouring edges that nearly lie on one line (up to 15° off the chord) merge into one wall, because OSM splits walls with extra points and rounded corners;
- wall segments whose point one metre outside falls inside a neighbouring building are treated as shared blind walls and dropped;
- parallel pieces of one plane offset by up to 3 m (balconies, steps) count as one facade, and walls shorter than 4 m are ignored.

Facades and floors make a matrix: a row per floor, a column per facade, each cell showing the window's annual score (more on it below) and a mark if the sea is visible. The best cell has the highest score; ties go to more sea directions, then the higher floor. The matrix runs in the worker.

## An annual window score against BRE

Sun hours on four days of the year are hard to compare between flats: is "7 hours in summer and 4 in winter" good or bad? You need one number and a threshold to compare it with. The UK BRE guide "Site layout planning for daylight and sunlight" (BR 209, 2022) has one: the main window of a living room facing within 90° of due south should get at least 25% of annual probable sunlight hours (APSH), including at least 5% between 21 September and 21 March.

How we compute it:

- the year is sampled every 10 days (the middle of each interval, weighted by its length) and each day every 10 minutes; each hour is weighted by the chance of direct sun on that day (more on it below), and the sum of these "probable" hours with the sun above the horizon is the denominator;
- the numerator is the hours when the sun is in front of the facade and the ray from the window clears buildings, trees and terrain;
- to avoid tracing thousands of rays per window, the horizon including buildings and terrain is traced once per degree of azimuth, and the sun is then compared with it by elevation;
- the 0–100 score is the year's share in percent, and the verdict uses BRE's two thresholds.

Where we depart from the guideline, and say so in the UI:

- **a satellite instead of a weather station.** BRE takes probable hours from long-term station records; ours are an estimate from PVGIS satellite data;
- **"borderline"** is our category, not BRE's: the window misses a threshold, but both shares are at least 80% of it;
- **"not assessed".** BRE doesn't assess windows facing more than 90° away from south. The first version gave such a window a verdict and at the same time said it "faces north", which for a west wall at 272° was both wrong and contradictory. Now the 0–100 score stays and the verdict says "not assessed by BRE"; for the whole building the verdict comes from the best facade the guideline applies to.

On examples from the demo (my own run of the core):

| Flat | Facade | Year | Winter half | Verdict |
| --- | --- | --- | --- | --- |
| Tivat, 10-storey block, floor 10 | south, 182° | 76% | 33% | meets |
| same | east, 92° | 43% | 16% | meets |
| same | west, 272° | 47% | 17% | not assessed |
| same, floor 1 | east, 92° | 21% | 8% | borderline |
| Bergen, Mowinckelgårdene, floor 13 | south-west, 214° | 68% | 21% | meets |
| same, floor 2 | south-west, 214° | 18% | 2% | fails |
| Kotor, "no direct winter sun", floor 2 | east, 99° | 28% | 9% | meets |

The last row shows why the guideline needs a careful read: on 21 December this window gets no sun at all, but BRE's "winter half" also covers September, October, February and March, and that is where the 9% comes from.

The facade matrix now shows the same score in each cell, and the best cell is the highest score. For the 10-storey block in Tivat the whole matrix (10 floors × 4 facades) takes about 140 ms in the worker.

Cloud moves the winter shares noticeably: with probable hours, floor 13 in Bergen gets 21% in the winter half, against 27% under a clear sky. Winters there are greyer, so a probable winter hour weighs less than a summer one.

## Trees and clouds

The first version treated OSM woods and parks as 10 m trees. But in Tivat and Kotor the trees are gardens around every house, olives and cypresses that OSM doesn't have. Crown heights now come from the open Meta and WRI map (Tolan et al., 2024): a model trained on satellite imagery, about 1 m per pixel, about 3 m error. The tiles are COGs on AWS but awkward ones: one row per strip, so `geotiff` sends a request per row and runs into timeouts. What worked was reading the needed rows as one range in 8 MB chunks and inflating them with the predictor myself. A 6 m cell gets the median of its pixels, and anything under 3 m counts as nothing.

That changes answers a lot: in Tivat winter sun on low floors changed for 26% of buildings, and the sea view for 19%. The "trees nearby" reliability reason had to be narrowed to trees taller than the roof; otherwise it fired for two thirds of buildings and told you nothing.

In winter broadleaved trees are bare, but open data can't tell a deciduous oak from an evergreen olive. The Copernicus Dominant Leaf Type map only says broadleaved or coniferous, and in Montenegro broadleaved means olives and holm oaks too. So the computation always keeps leaves on, and for spring and winter the panel shows an upper bound: "🍂 up to N h with bare trees".

Cloud is the share of daytime hours when PVGIS-SARAH3 direct normal irradiance reaches 120 W/m², the WMO sunshine threshold. I first tried ERA5 via Open-Meteo, and it overstated the sun badly: 31% in January in Bergen. The satellite gives about 1,500 sunshine hours a year in Bergen and 2,900 in Tivat. The season cards show "☁ ≈ N h on average" next to the clear-sky hours.

## The view from the window

"Sea visible in 4 directions" is an abstraction. I wanted to show what you'd actually see standing at the window. The "View from the window" button places the MapLibre camera at the window on the chosen facade, at floor height, and points it along the facade normal: a 64° horizontal field of view, looking at a point 400 m ahead at the same height, so the pitch is exactly 90° and the horizon sits mid-frame. While in the view, the floor and facade highlights, sectors, sun path and flat shadows are hidden, and buildings turn neutral, because the sun-map colours read as dark blocks in first person.

Next to it are the sea and sky shares. The worker computes them with the same ray march as the sea view: a frame 64° wide in 2° steps and ±20° around the horizon in 1° steps (the band of sea near the horizon is thin), and every ray ends on an obstacle, the sea or the sky. A ray counts as sea when it drops below sea level over a water cell. The view for one facade takes about 15 ms.

Numbers for the same buildings:

| Window | Sea in frame | Sky |
| --- | --- | --- |
| Tivat, floor 10, south | 8% | 47% |
| Tivat, floor 10, west | 7% | 42% |
| Tivat, floor 1, south | 0% | 0% |
| Bergen, floor 13, north-east (over the fjord) | 25% | 30% |
| Bergen, floor 13, south-west | 0% | 39% |

This is what the whole thing was for: on floor 13 in Bergen, the sunniest facade (south-west, 68 out of 100) has no sea in frame, while the facade over the fjord (north-east, sea a quarter of the frame) gets only 18% of the annual sun and isn't assessed by BRE. Choosing a flat here means choosing between sun and view, and the UI shows that on one screen.

Limitations: Earth curvature is ignored. The camera sits at window height above the drawn terrain (Terrain Tiles), while the computation uses Copernicus; they differ by metres, so the frame and the percentages can disagree slightly. The view frame also goes into the PNG card. The WebGL buffer isn't preserved in production, so we grab it from a one-off redraw in the `render` event.

## Bergen: a different latitude and a different reference

The third city is Bergen: 60° N, a fjord, the "seven mountains", and floor counts in OSM for 58% of buildings. In December the sun rises only about 6° at noon, so any horizon error decides whether a window gets sun at all.

Checking against PVGIS didn't work here, and the fault was the reference, not our core: north of 60° PVGIS elevations are constant over 30″ squares. It puts Fløyen at 140 m instead of 320, and the Bryggen waterfront at 180 m instead of 7. Norway has a better reference: Kartverket's 1 m lidar ground model, open and keyless. Against it, on Copernicus terrain, the mean difference is 0.82°, 0.3–0.4° on flat points, and the 21 December sunrise and sunset match within 1–2 minutes. Løvstakken, the mountain Bergen's winter sun hides behind, matches within 0.1–0.2°.

It also exposed another Copernicus subtlety: north of 50° the tile's longitude step is coarser (1.5–2″), and our cell centres fell exactly between pixels. Rounding picked the pixel 15 m to the east, and the city sits on a slope that rises to the east. Bilinear sampling of the tile fixed it.

What remained was the eye height: on the Fløyen slope Copernicus, a surface model, sits 20 m above the ground under the forest. Since the reference was Kartverket's DTM anyway, I made it Bergen's terrain too: 0.82° → 0.59°, and at Nordnes, where a knoll 100 m away decides everything, there is now no sun on 21 December all day, as in the reference. It got worse at the foot of Fløyen: sunrise 30 minutes before the reference instead of 12. For buildings on slopes the winter result in Bergen is still an estimate.

## Performance: what helped and what didn't

Lighthouse's mobile profile first scored 33 for performance. The profiler found three real causes:

1. **The first WebGL context.** On SwiftShader (how Lighthouse renders WebGL without a GPU) it takes about 2 s to create, and the WebGL support check held the main thread for all of it. The warm-up now happens in a worker on an `OffscreenCanvas`.
2. **LCP was the legend title.** It appeared only after the data, the world and the map, at 16.8 s. Its text doesn't depend on the computation, so it is now drawn before the MapLibre bundle loads.
3. **The roof raster was built twice**, on the main thread and in the worker. Now it's built only in the worker, and the page gets a copy.

Locally that took performance from 33 to 64 and LCP from 16.5 to 1.5 s. Later another 3.4 s task turned up: the first frames with 3D terrain. Terrain now switches on after the map first goes idle; the city shows at once and the mountains rise a moment later, 60–62 → 62–66 locally.

What didn't help was **the binary building format.** GeoJSON inside a JS module weighed 1.1–2.1 MB per city; the binary file (Int16 with per-ring delta coding, ring offsets, string indexes) is 160–330 KB. Over gzip it halves the data on the wire: 157 → 78 KB in Tivat, 342 → 184 KB in Bergen. The "data loaded" stage under a 4× CPU slowdown got faster (in Tivat, 1.7–2.0 → about 1.0 s), but Lighthouse didn't move: 58 and 56 are within noise. The profile had already said that parsing the GeoJSON took milliseconds and the time went to software WebGL. I kept the format anyway: it's half the size on the wire and removes the GeoJSON copy into the worker.

## What didn't work

- **Floor counts.** OSM has them for 14% of buildings in Tivat and 3% in Kotor. The rest are estimated from building type and footprint; they are drawn semi-transparent on the map and flagged in the panel. Bergen has floor counts for 58% of buildings, which is why it became the third city.
- **A surface model instead of ground in Montenegro.** Copernicus is a DSM, so its cells include roofs and canopies. It is flattened under buildings, but exact ground needs a DTM, and the open one with a suitable licence (FABDEM) is non-commercial. In Bergen, Kartverket's DTM solved it.
- **Slopes.** For buildings on steep slopes, the uphill result is an estimate good to tens of minutes, and the UI says so.
- **An empty map in production.** Everything worked in dev, but on GitHub Pages the map was blank. In the production build `maplibre-gl.css` loaded after my styles, and `.maplibregl-map { position: relative }` overrode my `.map { position: fixed }`, leaving the container zero pixels tall. After that, CI got a Playwright smoke test against the published page: it checks the container's height, that the map screenshot is colourful, and that clicking an example produces a result.
- **Mobile performance hits the ceiling of software WebGL.** After the fixes it scores 64 locally, while runs on the GitHub runner range from 33 to 65. Almost all the remaining time is MapLibre's first frames with terrain on SwiftShader; on a device with a GPU those frames take tens of milliseconds. Accessibility, best practices and SEO score 100.
- **Leaves in winter.** The data can't tell deciduous trees from evergreen ones, so winter only gets a bare-tree bound, not a forecast.
- **Overpass** regularly returns 502 under load. The fetch script retries across mirrors.

## Takeaway

Cloud-optimised GeoTIFF plus OSM plus computing in the browser turned out to be a workable combination: no backend, no keys, and an honest check against an independent source. What matters most to a buyer turned out not to be sun hours but the comparison: which facade and floor is better, whether a window meets the guideline, and what you give up for the view. Adding a city is one object in a config and one command; that is how Herceg Novi arrived.

Code: [github.com/yetit/sun-view](https://github.com/yetit/sun-view). Demo: [yetit.github.io/sun-view](https://yetit.github.io/sun-view/).
