// Геометрия и высотные сетки: рельеф (DEM), растр крыш зданий, трассировка луча.
// Локальная система — метры от центра города: x на восток, y на север, z — высота над морем.
import city from '../../city.config.mjs';

const [LON0, LAT0] = city.camera.center as [number, number];
const M_LAT = 111320;
const M_LON = 111320 * Math.cos((LAT0 * Math.PI) / 180);
export const toXY = (lon: number, lat: number): [number, number] => [(lon - LON0) * M_LON, (lat - LAT0) * M_LAT];
const toLonLat = (x: number, y: number): [number, number] => [x / M_LON + LON0, y / M_LAT + LAT0];

export type Dem = { west: number; north: number; cols: number; rows: number; cell: number; nodata: number; max: number; data: Int16Array };

export function decodeDem(json: any): Dem {
  const bin = atob(json.data);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return { west: json.bbox.west, north: json.bbox.north, cols: json.cols, rows: json.rows, cell: json.cell, nodata: json.nodata, max: json.max, data: new Int16Array(u8.buffer) };
}

// Высота рельефа в точке; null — за пределами сетки или нет данных.
export function demAt(dem: Dem, lon: number, lat: number): number | null {
  const c = Math.floor((lon - dem.west) / dem.cell);
  const r = Math.floor((dem.north - lat) / dem.cell);
  if (c < 0 || r < 0 || c >= dem.cols || r >= dem.rows) return null;
  const v = dem.data[r * dem.cols + c];
  return v === dem.nodata ? null : v;
}

// Земля под зданием. DEM — модель поверхности (DSM): в ячейку попадает и крыша, поэтому берём минимум
// по четырём ближайшим ячейкам — грубо, но без этого первый этаж оказывается на уровне кровли.
function groundAt(dem: Dem, lon: number, lat: number): number {
  let min = Infinity;
  for (const dl of [-0.5, 0.5]) for (const dp of [-0.5, 0.5]) {
    const v = demAt(dem, lon + dl * dem.cell, lat + dp * dem.cell);
    if (v != null && v < min) min = v;
  }
  return min === Infinity ? 0 : Math.max(0, min);
}

export type Bld = {
  idx: number;
  id: number;
  name: string | null;
  levels: number | null;
  height: number | null;
  floors: number; // этажей (из OSM или оценка)
  assumed: boolean; // этажность неизвестна, взято по умолчанию
  h: number; // высота здания, м
  ground: number; // отметка земли, м
  center: [number, number]; // lon, lat
  radius: number; // м, от центра до дальней вершины контура
  rings: [number, number][][];
};

const DEFAULT_FLOORS = 2;

export function prepareBuildings(geojson: any, dem: Dem): Bld[] {
  return geojson.features.map((f: any, idx: number): Bld => {
    const rings: [number, number][][] = f.geometry.type === 'Polygon' ? [f.geometry.coordinates[0]] : f.geometry.coordinates.map((p: any) => p[0]);
    const pts = rings.flat();
    const center: [number, number] = [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
    const [cx, cy] = toXY(...center);
    const radius = Math.max(...pts.map((p) => Math.hypot(...(([a, b]) => [a - cx, b - cy])(toXY(p[0], p[1])))));
    const { levels, height } = f.properties;
    const floors = levels ?? (height ? Math.max(1, Math.round(height / city.floorHeight)) : DEFAULT_FLOORS);
    return {
      idx, id: f.properties.id, name: f.properties.name, levels, height, floors, assumed: levels == null && height == null,
      h: height ?? floors * city.floorHeight, ground: groundAt(dem, center[0], center[1]), center, radius, rings,
    };
  });
}

// Растр крыш: абсолютная отметка кровли и индекс здания (+1) в каждой ячейке.
const BCELL = 6; // м
export type Roofs = { x0: number; y0: number; cols: number; rows: number; z: Float32Array; idx: Uint16Array };

function inRing(x: number, y: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function rasterizeRoofs(blds: Bld[]): Roofs {
  const { south, west, north, east } = city.bbox;
  const [x0, y0] = toXY(west, south);
  const [x1, y1] = toXY(east, north);
  const cols = Math.ceil((x1 - x0) / BCELL);
  const rows = Math.ceil((y1 - y0) / BCELL);
  const z = new Float32Array(cols * rows);
  const idx = new Uint16Array(cols * rows);
  for (const b of blds) {
    const top = b.ground + b.h;
    for (const ring of b.rings) {
      const xy = ring.map((p) => toXY(p[0], p[1]));
      const xs = xy.map((p) => p[0]);
      const ys = xy.map((p) => p[1]);
      const c0 = Math.max(0, Math.floor((Math.min(...xs) - x0) / BCELL));
      const c1 = Math.min(cols - 1, Math.floor((Math.max(...xs) - x0) / BCELL));
      const r0 = Math.max(0, Math.floor((Math.min(...ys) - y0) / BCELL));
      const r1 = Math.min(rows - 1, Math.floor((Math.max(...ys) - y0) / BCELL));
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
        if (!inRing(x0 + (c + 0.5) * BCELL, y0 + (r + 0.5) * BCELL, xy)) continue;
        const k = r * cols + c;
        if (top > z[k]) { z[k] = top; idx[k] = b.idx + 1; }
      }
    }
  }
  return { x0, y0, cols, rows, z, idx };
}

function roofAt(roofs: Roofs, x: number, y: number): [number, number] {
  const c = Math.floor((x - roofs.x0) / BCELL);
  const r = Math.floor((y - roofs.y0) / BCELL);
  if (c < 0 || r < 0 || c >= roofs.cols || r >= roofs.rows) return [0, 0];
  const k = r * roofs.cols + c;
  return [roofs.z[k], roofs.idx[k] - 1];
}

export type World = { dem: Dem; roofs: Roofs };
const NEAR = 1000; // м — дальше здания не проверяем, только рельеф
const FAR = 15000; // м — предел трассировки

// Луч из окна здания b (точка x,y,z) по азимуту bearing (рад, от севера по часовой) и углу места elev.
// Возвращает true, если упёрся в рельеф или чужое здание. Свои контур и ячейка DSM пропускаются.
export function blocked(w: World, b: Bld, x: number, y: number, z: number, bearing: number, elev: number): boolean {
  const sx = Math.sin(bearing), sy = Math.cos(bearing), tz = Math.tan(elev);
  const skipDem = b.radius + w.dem.cell * M_LAT; // своё здание в DSM — одна ячейка вокруг
  for (let d = 3; d < FAR; d += d < NEAR ? 3 : 30) {
    const zr = z + d * tz;
    if (zr > w.dem.max) return false;
    const px = x + d * sx, py = y + d * sy;
    if (d < NEAR) {
      const [roof, i] = roofAt(w.roofs, px, py);
      if (i !== b.idx && roof > zr) return true;
    }
    if (d < skipDem) continue;
    const t = demAt(w.dem, ...toLonLat(px, py));
    if (t == null) return false; // вышли за сетку — считаем открытым
    if (t > zr) return true;
  }
  return false;
}

// Видно ли море по азимуту: идём вдоль луча, держим максимальный угол места препятствий;
// ячейка моря (DSM ≤ 0) видна, если угол на неё выше всех препятствий до неё.
export function seaVisible(w: World, b: Bld, x: number, y: number, z: number, bearing: number): number | null {
  const sx = Math.sin(bearing), sy = Math.cos(bearing);
  const skipDem = b.radius + w.dem.cell * M_LAT;
  let maxAng = -Infinity;
  for (let d = 3; d < FAR; d += d < NEAR ? 3 : 30) {
    const px = x + d * sx, py = y + d * sy;
    let obstacle = -Infinity;
    if (d < NEAR) {
      const [roof, i] = roofAt(w.roofs, px, py);
      if (i !== b.idx && i >= 0) obstacle = roof;
    }
    if (d >= skipDem) {
      const t = demAt(w.dem, ...toLonLat(px, py));
      if (t == null) return null;
      if (t <= 0 && Math.atan2(-z, d) > maxAng) return d;
      obstacle = Math.max(obstacle, t);
    }
    if (obstacle > -Infinity) maxAng = Math.max(maxAng, Math.atan2(obstacle - z, d));
  }
  return null;
}
