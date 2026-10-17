// Синтетический мир для тестов: плоская суша 10 м, море на западе (x < -300 м),
// гора на востоке (x > 1500 м, 400 м), дом-«наблюдатель» в центре и стена-сосед к югу.
import { createWorld, inRing, type City } from '../src/scripts/grid.ts';

export const city: City = {
  id: 'test', name: 'Тест', timezone: 'UTC', floorHeight: 3,
  bbox: { south: 41.99, west: 17.99, north: 42.01, east: 18.01 },
  dem: { bbox: { south: 41.95, west: 17.95, north: 42.05, east: 18.05 }, step: 2 },
  camera: { center: [18, 42], zoom: 14, pitch: 0, bearing: 0 },
};

// Прямоугольник в метрах вокруг (cx, cy) → контур в lon/lat.
const mLat = 111320, mLon = 111320 * Math.cos((42 * Math.PI) / 180);
export const rect = (cx: number, cy: number, w: number, h: number) =>
  [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2], [-w / 2, -h / 2]].map(([dx, dy]) => [18 + (cx + dx) / mLon, 42 + (cy + dy) / mLat]);
// Произвольный контур в метрах → lon/lat, замкнутый.
export const poly = (pts: number[][]) => [...pts, pts[0]].map(([x, y]) => [18 + x / mLon, 42 + y / mLat]);

export function makeWorld(extra: { ring: number[][]; levels: number | null; height?: number | null; building?: string }[] = [], woods: number[][][] = []) {
  const { bbox, step } = city.dem;
  const cell = step / 3600;
  const cols = Math.round((bbox.east - bbox.west) / cell), rows = Math.round((bbox.north - bbox.south) / cell);
  const data = new Int16Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = (bbox.west + (c + 0.5) * cell - 18) * mLon;
    data[r * cols + c] = x < -300 ? 0 : x > 1500 ? 400 : 10;
  }
  const features = [{ ring: rect(0, 0, 20, 20), levels: 5 }, ...extra].map((b, i) => ({
    type: 'Feature', id: i + 1, properties: { id: i + 1, levels: b.levels, height: b.height ?? null, name: null, building: 'building' in b ? b.building : 'yes' }, geometry: { type: 'Polygon', coordinates: [b.ring] },
  }));
  // Кроны 20 м (выше дома-наблюдателя) внутри контуров woods — на сетке ~6 м, как из scripts/fetch-canopy.mjs.
  const dlat = 6 / mLat, dlon = 6 / mLon, cw = Math.ceil((city.bbox.east - city.bbox.west) / dlon), ch = Math.ceil((city.bbox.north - city.bbox.south) / dlat);
  const h = new Uint8Array(cw * ch);
  for (let r = 0; r < ch; r++) for (let c = 0; c < cw; c++) {
    const p: [number, number] = [city.bbox.west + (c + 0.5) * dlon, city.bbox.north - (r + 0.5) * dlat];
    if (woods.some((ring) => inRing(p[0], p[1], ring as [number, number][]))) h[r * cw + c] = 20;
  }
  const canopy = { west: city.bbox.west, north: city.bbox.north, cols: cw, rows: ch, dlon, dlat, h };
  return createWorld(city, { type: 'FeatureCollection', features }, canopy, { bbox, cols, rows, cell, nodata: -32768, min: 0, max: 400 }, data.buffer);
}
