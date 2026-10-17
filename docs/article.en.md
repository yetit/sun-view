<!-- DRAFT for dev.to. Not published. Numbers are from the README and docs/horizon-check.md as of 2026-10-17 (third round: facades, Bergen, performance, binary format). -->

# How much sun reaches a window? Ray-marching open terrain data in the browser

When you look at a flat by the sea, everyone asks the same two questions: will it get sun in winter, and can you see the sea? The developer says yes to both. I wanted to check for myself, with no developer and no server: click a building on a 3D map, pick a floor and a side, and within tens of milliseconds see the hours of direct sun per season and in which directions the water is visible.

The result is [Sun & View](https://yetit.github.io/sun-view/): Tivat and Kotor in Montenegro and Bergen in Norway, built on open data and computed entirely in the browser. Here is how it works, how I checked that it doesn't lie, and what didn't work.

## Data

- **Buildings** come from OpenStreetMap via the Overpass API: footprints, `building:levels`, `height` and addresses. Buildings without an address are labelled with the nearest street.
- **Terrain** is Copernicus DEM GLO-30. It sits on AWS Open Data as cloud-optimised GeoTIFFs, so you can read just the window you need from a 1°×1° tile with HTTP range requests (the `geotiff` library), with no sign-up and no gigabyte downloads. The terrain extends about 15 km around the city, because mountains block the low winter sun from kilometres away.
- **The sea** is not "elevation ≤ 0". It comes from the OSM coastline (`natural=coastline`, land on the left, water on the right). Otherwise low meadows and vacant lots by the waterfront count as sea.
- **Trees** are OSM woods and parks, treated as 10 m obstacles.
- **The sun** comes from `suncalc`.

Everything is fetched once by scripts and committed to the repository. At runtime the site calls no APIs except address search.

## A world in metres

The city is projected to a local frame: metres east and north of the centre, height above sea level. Then two grids:

1. **Terrain** at about 60 m per cell (2″). Heights between nodes are interpolated bilinearly, which turned out to matter (more below).
2. **A roof raster** at 6 m per cell. Each cell holds the absolute top of a building or canopy and the building's index. That turns "does the ray hit a neighbour" from a polygon search into a single array read.

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

Synthetic tests (a hill, a wall, the sea) catch sign and index bugs, but they can't tell you whether the result matches reality. The European Commission has an independent source: [PVGIS](https://re.jrc.ec.europa.eu/pvg_tools/en/) returns the horizon profile for any point through a free API. I compared our horizon with it at 16 points in Tivat and Kotor, 48 azimuths each.

| Where | Mean difference | 21 December sunrise |
| --- | --- | --- |
| Flat ground by the sea, Tivat | 0.2° | same minute (±1) |
| All points, Tivat | 1.5° | — |
| All points, Kotor | 1.3° | — |
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

Facades and floors make a matrix: a row per floor, a column per facade, each cell showing winter sun hours and a mark if the sea is visible. The best cell has the most winter sun; ties go to more sea directions, then the higher floor. The matrix runs in the worker: for a 10-storey building with four facades that's 40 calculations of 4 seasons each.

## Bergen: a different latitude and a different reference

The third city is Bergen: 60° N, a fjord, the "seven mountains", and floor counts in OSM for 58% of buildings. In December the sun rises only about 6° at noon, so any horizon error decides whether a window gets sun at all.

Checking against PVGIS didn't work here, and the fault was the reference, not our core: north of 60° PVGIS elevations are constant over 30″ squares. It puts Fløyen at 140 m instead of 320, and the Bryggen waterfront at 180 m instead of 7. Norway has a better reference: Kartverket's 1 m lidar ground model, open and keyless. Against it the mean difference is 0.82°, 0.3–0.4° on flat points, and the 21 December sunrise and sunset match within 1–2 minutes. Løvstakken, the mountain Bergen's winter sun hides behind, matches within 0.1–0.2°.

It also exposed another Copernicus subtlety: north of 50° the tile's longitude step is coarser (1.5–2″), and our cell centres fell exactly between pixels. Rounding picked the pixel 15 m to the east, and the city sits on a slope that rises to the east. Bilinear sampling of the tile fixed it.

What remains: on the Fløyen slope Copernicus, a radar surface model, sits 20 m above the ground under the forest, so the eye ends up too high. And at Nordnes a knoll 100 m away decides everything: by the DTM the 21 December sun stays behind it all day, while we have it shining from 10:28 to 12:45. For buildings on knolls and slopes the winter result in Bergen is an estimate, and the reliability label in the panel says so.

## Performance: what helped and what didn't

Lighthouse's mobile profile first scored 33 for performance. The profiler found three real causes:

1. **The first WebGL context.** On SwiftShader (how Lighthouse renders WebGL without a GPU) it takes about 2 s to create, and the WebGL support check held the main thread for all of it. The warm-up now happens in a worker on an `OffscreenCanvas`.
2. **LCP was the legend title.** It appeared only after the data, the world and the map, at 16.8 s. Its text doesn't depend on the computation, so it is now drawn before the MapLibre bundle loads.
3. **The roof raster was built twice**, on the main thread and in the worker. Now it's built only in the worker, and the page gets a copy.

Locally that took performance from 33 to 64 and LCP from 16.5 to 1.5 s.

What didn't help was **the binary building format.** GeoJSON inside a JS module weighed 1.1–2.1 MB per city; the binary file (Int16 with per-ring delta coding, ring offsets, string indexes) is 160–330 KB. Over gzip it halves the data on the wire: 157 → 78 KB in Tivat, 342 → 184 KB in Bergen. The "data loaded" stage under a 4× CPU slowdown got faster (in Tivat, 1.7–2.0 → about 1.0 s), but Lighthouse didn't move: 58 and 56 are within noise. The profile had already said that parsing the GeoJSON took milliseconds and the time went to software WebGL. I kept the format anyway: it's half the size on the wire and removes the GeoJSON copy into the worker.

## What didn't work

- **Floor counts.** OSM has them for 14% of buildings in Tivat and 3% in Kotor. The rest are estimated from building type and footprint; they are drawn semi-transparent on the map and flagged in the panel. Bergen has floor counts for 58% of buildings, which is why it became the third city.
- **A surface model instead of ground.** Copernicus is a DSM, so its cells include roofs and canopies. It is flattened under buildings, but exact ground needs a DTM, and the open one with a suitable licence (FABDEM) is non-commercial.
- **Slopes.** For buildings on steep slopes, the uphill result is an estimate good to tens of minutes, and the UI says so.
- **An empty map in production.** Everything worked in dev, but on GitHub Pages the map was blank. In the production build `maplibre-gl.css` loaded after my styles, and `.maplibregl-map { position: relative }` overrode my `.map { position: fixed }`, leaving the container zero pixels tall. After that, CI got a Playwright smoke test against the published page: it checks the container's height, that the map screenshot is colourful, and that clicking an example produces a result.
- **Mobile performance hits the ceiling of software WebGL.** After the fixes it scores 64 locally, while runs on the GitHub runner range from 33 to 65. Almost all the remaining time is MapLibre's first frames with terrain on SwiftShader; on a device with a GPU those frames take tens of milliseconds. Accessibility, best practices and SEO score 100.
- **Overpass** regularly returns 502 under load. The fetch script retries across mirrors.

## Takeaway

Cloud-optimised GeoTIFF plus OSM plus computing in the browser turned out to be a workable combination: no backend, no keys, and an honest check against an independent source. Adding a city is one object in a config and one command.

Code: [github.com/yetit/sun-view](https://github.com/yetit/sun-view). Demo: [yetit.github.io/sun-view](https://yetit.github.io/sun-view/).
