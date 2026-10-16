// Геометрия и высотные сетки: рельеф (DEM), растр крыш и деревьев, трассировка луча.
// Локальная система — метры от центра города: x на восток, y на север, z — высота над морем.

export type City = {
  id: string;
  name: string;
  bbox: { south: number; west: number; north: number; east: number };
  dem: { bbox: { south: number; west: number; north: number; east: number }; step: number };
  camera: { center: [number, number]; zoom: number; pitch: number; bearing: number };
  timezone: string;
  floorHeight: number;
  treeHeight: number;
};

export type Proj = { toXY: (lon: number, lat: number) => [number, number]; toLonLat: (x: number, y: number) => [number, number]; mLat: number; mLon: number };
export function makeProj([lon0, lat0]: [number, number]): Proj {
  const mLat = 111320, mLon = 111320 * Math.cos((lat0 * Math.PI) / 180);
  return { mLat, mLon, toXY: (lon, lat) => [(lon - lon0) * mLon, (lat - lat0) * mLat], toLonLat: (x, y) => [x / mLon + lon0, y / mLat + lat0] };
}

export type Dem = { west: number; north: number; cols: number; rows: number; cell: number; nodata: number; max: number; data: Int16Array };
export const makeDem = (meta: any, buf: ArrayBuffer): Dem => ({ west: meta.bbox.west, north: meta.bbox.north, cols: meta.cols, rows: meta.rows, cell: meta.cell, nodata: meta.nodata, max: meta.max, data: new Int16Array(buf) });

// Высота рельефа в точке; null — за пределами сетки или нет данных. Море — 0.
export function demAt(dem: Dem, lon: number, lat: number): number | null {
  const c = Math.floor((lon - dem.west) / dem.cell);
  const r = Math.floor((dem.north - lat) / dem.cell);
  if (c < 0 || r < 0 || c >= dem.cols || r >= dem.rows) return null;
  const v = dem.data[r * dem.cols + c];
  return v === dem.nodata ? null : v;
}

// Земля под зданием: минимум по четырём ближайшим ячейкам суши (DSM включает крышу; ячейки моря
// не берём, иначе дом на набережной «падает» на 0).
export function groundAt(dem: Dem, lon: number, lat: number): number {
  let min = Infinity;
  for (const dl of [-0.5, 0.5]) for (const dp of [-0.5, 0.5]) {
    const v = demAt(dem, lon + dl * dem.cell, lat + dp * dem.cell);
    if (v != null && v > 0 && v < min) min = v;
  }
  return min === Infinity ? 0 : min;
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
  xy: [number, number]; // центр в локальных метрах
  radius: number; // м, от центра до дальней вершины контура
  rings: [number, number][][]; // контуры в локальных метрах
};

const DEFAULT_FLOORS = 2;
const polyRings = (g: any): [number, number][][] => (g.type === 'Polygon' ? [g.coordinates[0]] : g.coordinates.map((p: any) => p[0]));

export function prepareBuildings(city: City, geojson: any, dem: Dem, proj: Proj): Bld[] {
  return geojson.features.map((f: any, idx: number): Bld => {
    const rings = polyRings(f.geometry).map((r) => r.map((p) => proj.toXY(p[0], p[1])));
    // Кольца замкнуты (первая точка повторена) — для центроида повтор убираем, иначе он смещается.
    const pts = rings.flatMap((r) => (r[0][0] === r.at(-1)![0] && r[0][1] === r.at(-1)![1] ? r.slice(0, -1) : r));
    const xy: [number, number] = [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
    const center = proj.toLonLat(...xy);
    const { levels, height } = f.properties;
    const floors = levels ?? (height ? Math.max(1, Math.round(height / city.floorHeight)) : DEFAULT_FLOORS);
    return {
      idx, id: f.properties.id, name: f.properties.name, levels, height, floors, assumed: levels == null && height == null,
      h: height ?? floors * city.floorHeight, ground: groundAt(dem, center[0], center[1]), center, xy,
      radius: Math.max(...pts.map((p) => Math.hypot(p[0] - xy[0], p[1] - xy[1]))), rings,
    };
  });
}

// Растр препятствий: абсолютная отметка верха и индекс здания (+1) в каждой ячейке; деревья — TREE.
const BCELL = 6; // м
export const TREE = 0xffff;
export type Roofs = { x0: number; y0: number; cols: number; rows: number; z: Float32Array; idx: Uint16Array };

export function inRing(x: number, y: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function rasterizeRoofs(city: City, proj: Proj, dem: Dem, blds: Bld[], greenery: any | null): Roofs {
  const { south, west, north, east } = city.bbox;
  const [x0, y0] = proj.toXY(west, south);
  const [x1, y1] = proj.toXY(east, north);
  const cols = Math.ceil((x1 - x0) / BCELL), rows = Math.ceil((y1 - y0) / BCELL);
  const z = new Float32Array(cols * rows);
  const idx = new Uint16Array(cols * rows);
  const paint = (ring: [number, number][], top: (x: number, y: number) => number, id: number) => {
    const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]);
    const c0 = Math.max(0, Math.floor((Math.min(...xs) - x0) / BCELL)), c1 = Math.min(cols - 1, Math.floor((Math.max(...xs) - x0) / BCELL));
    const r0 = Math.max(0, Math.floor((Math.min(...ys) - y0) / BCELL)), r1 = Math.min(rows - 1, Math.floor((Math.max(...ys) - y0) / BCELL));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const x = x0 + (c + 0.5) * BCELL, y = y0 + (r + 0.5) * BCELL;
      if (!inRing(x, y, ring)) continue;
      const k = r * cols + c, t = top(x, y);
      if (t > z[k]) { z[k] = t; idx[k] = id; }
    }
  };
  // Деревья первыми: здание внутри парка перекроет их своей ячейкой.
  for (const f of greenery?.features ?? []) for (const ring of polyRings(f.geometry)) {
    paint(ring.map((p) => proj.toXY(p[0], p[1])), (x, y) => (demAt(dem, ...proj.toLonLat(x, y)) ?? 0) + city.treeHeight, TREE);
  }
  for (const b of blds) for (const ring of b.rings) paint(ring, () => b.ground + b.h, b.idx + 1);
  return { x0, y0, cols, rows, z, idx };
}

function roofAt(roofs: Roofs, x: number, y: number): [number, number] {
  const c = Math.floor((x - roofs.x0) / BCELL), r = Math.floor((y - roofs.y0) / BCELL);
  if (c < 0 || r < 0 || c >= roofs.cols || r >= roofs.rows) return [0, -1];
  const k = r * roofs.cols + c;
  return [roofs.z[k], roofs.idx[k] - 1];
}

export type World = { city: City; proj: Proj; dem: Dem; roofs: Roofs; blds: Bld[] };

export function createWorld(city: City, geojson: any, greenery: any | null, demMeta: any, demBuf: ArrayBuffer): World {
  const proj = makeProj(city.camera.center);
  const dem = makeDem(demMeta, demBuf);
  const blds = prepareBuildings(city, geojson, dem, proj);
  return { city, proj, dem, roofs: rasterizeRoofs(city, proj, dem, blds, greenery), blds };
}

// Точка на стене здания по азимуту от центра, на 1 м снаружи: отсюда «смотрит окно» этой стороны.
export function wallPoint(b: Bld, bearing: number): [number, number] {
  const dx = Math.sin(bearing), dy = Math.cos(bearing);
  const [cx, cy] = b.xy;
  let far = 0;
  for (const ring of b.rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[j], [bx, by] = ring[i];
    const ex = bx - ax, ey = by - ay;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((ax - cx) * ey - (ay - cy) * ex) / den; // вдоль луча
    const u = ((ax - cx) * dy - (ay - cy) * dx) / den; // вдоль ребра
    if (t > far && u >= 0 && u <= 1) far = t;
  }
  if (!far) far = b.radius;
  return [cx + dx * (far + 1), cy + dy * (far + 1)];
}

const NEAR = 1000; // м — дальше здания и деревья не проверяем, только рельеф
const FAR = 15000; // м — предел трассировки

// Луч из точки (x,y,z) здания b по азимуту bearing (рад, от севера по часовой) и углу места elev.
// true — упёрся в рельеф, дерево или чужое здание. Свой контур и своя ячейка DSM пропускаются.
export function blocked(w: World, b: Bld, x: number, y: number, z: number, bearing: number, elev: number): boolean {
  const sx = Math.sin(bearing), sy = Math.cos(bearing), tz = Math.tan(elev);
  const skipDem = b.radius + w.dem.cell * w.proj.mLat;
  for (let d = 2; d < FAR; d += d < NEAR ? 3 : 30) {
    const zr = z + d * tz;
    if (zr > w.dem.max) return false;
    const px = x + d * sx, py = y + d * sy;
    if (d < NEAR) {
      const [roof, i] = roofAt(w.roofs, px, py);
      if (i !== b.idx && roof > zr) return true;
    }
    if (d < skipDem) continue;
    const t = demAt(w.dem, ...w.proj.toLonLat(px, py));
    if (t == null) return false; // вышли за сетку — считаем открытым
    if (t > zr) return true;
  }
  return false;
}

// Угол места рельефного горизонта (рад) из точки (x,y,z) по азимуту bearing: максимум по лучу
// с тем же шагом, что в blocked(), только DEM, без зданий и деревьев. Ближе from DEM не читаем —
// по умолчанию одна ячейка, как blocked() для точки без своего здания. Для сверки с PVGIS.
export function horizonAngle(w: World, x: number, y: number, z: number, bearing: number, from = w.dem.cell * w.proj.mLat): number {
  const sx = Math.sin(bearing), sy = Math.cos(bearing);
  let max = -Math.PI / 2;
  for (let d = 2; d < FAR; d += d < NEAR ? 3 : 30) {
    if (d < from) continue;
    const t = demAt(w.dem, ...w.proj.toLonLat(x + d * sx, y + d * sy));
    if (t == null) break;
    max = Math.max(max, Math.atan2(t - z, d));
  }
  return max;
}

// Видно ли море по азимуту: идём вдоль луча, держим максимальный угол места препятствий;
// ячейка моря (0 м) видна, если угол на неё выше всех препятствий до неё. Возвращает расстояние.
export function seaVisible(w: World, b: Bld, x: number, y: number, z: number, bearing: number): number | null {
  const sx = Math.sin(bearing), sy = Math.cos(bearing);
  const skipDem = b.radius + w.dem.cell * w.proj.mLat;
  let maxAng = -Infinity;
  for (let d = 2; d < FAR; d += d < NEAR ? 3 : 30) {
    const px = x + d * sx, py = y + d * sy;
    let obstacle = -Infinity;
    if (d < NEAR) {
      const [roof, i] = roofAt(w.roofs, px, py);
      if (i !== b.idx && i >= 0) obstacle = roof;
    }
    if (d >= skipDem) {
      const t = demAt(w.dem, ...w.proj.toLonLat(px, py));
      if (t == null) return null;
      if (t <= 0 && Math.atan2(-z, d) > maxAng) return d;
      obstacle = Math.max(obstacle, t);
    }
    if (obstacle > -Infinity) maxAng = Math.max(maxAng, Math.atan2(obstacle - z, d));
  }
  return null;
}
