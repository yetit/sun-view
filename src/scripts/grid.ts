// Геометрия и высотные сетки: рельеф (DEM), растр крыш и деревьев, трассировка луча.
// Локальная система — метры от центра города: x на восток, y на север, z — высота над морем.

export type City = {
  id: string;
  name: string;
  nameEn?: string;
  bbox: { south: number; west: number; north: number; east: number };
  dem: { bbox: { south: number; west: number; north: number; east: number }; step: number };
  camera: { center: [number, number]; zoom: number; pitch: number; bearing: number };
  timezone: string;
  floorHeight: number;
  treeHeight: number;
  examples?: { b: number; f: number; d: number | null; s: number; ru: string; en: string }[];
};

export type Proj = { toXY: (lon: number, lat: number) => [number, number]; toLonLat: (x: number, y: number) => [number, number]; mLat: number; mLon: number };
export function makeProj([lon0, lat0]: [number, number]): Proj {
  const mLat = 111320, mLon = 111320 * Math.cos((lat0 * Math.PI) / 180);
  return { mLat, mLon, toXY: (lon, lat) => [(lon - lon0) * mLon, (lat - lat0) * mLat], toLonLat: (x, y) => [x / mLon + lon0, y / mLat + lat0] };
}

export type Dem = { west: number; north: number; cols: number; rows: number; cell: number; nodata: number; max: number; data: Int16Array };
export const makeDem = (meta: any, buf: ArrayBuffer): Dem => ({ west: meta.bbox.west, north: meta.bbox.north, cols: meta.cols, rows: meta.rows, cell: meta.cell, nodata: meta.nodata, max: meta.max, data: new Int16Array(buf) });

// Высота рельефа в точке; null — за пределами сетки или нет данных. Море — 0.
// Билинейно по четырём центрам ячеек вокруг точки: на склоне отметка меняется плавно, а не
// ступенькой в ячейку (60 м по сетке — это 20–30 м по высоте). Ячейки без данных (и моря, если land)
// пропускаются, веса остальных нормируются.
export function demAt(dem: Dem, lon: number, lat: number, land = false): number | null {
  const fx = (lon - dem.west) / dem.cell - 0.5, fy = (dem.north - lat) / dem.cell - 0.5;
  if (fx < -0.5 || fy < -0.5 || fx >= dem.cols - 0.5 || fy >= dem.rows - 0.5) return null;
  const c = Math.floor(fx), r = Math.floor(fy), tx = fx - c, ty = fy - r;
  if (!land && c >= 0 && r >= 0 && c + 1 < dem.cols && r + 1 < dem.rows) {
    // обычный случай — все четыре ячейки есть: без общего цикла заметно быстрее, лучи зовут demAt сотни раз
    const k = r * dem.cols + c, a = dem.data[k], b = dem.data[k + 1], d = dem.data[k + dem.cols], e = dem.data[k + dem.cols + 1];
    if (a !== dem.nodata && b !== dem.nodata && d !== dem.nodata && e !== dem.nodata) return (a + (b - a) * tx) * (1 - ty) + (d + (e - d) * tx) * ty;
  }
  let sum = 0, wsum = 0;
  for (let i = 0; i < 4; i++) {
    const cc = c + (i & 1), rr = r + (i >> 1);
    const w = (i & 1 ? tx : 1 - tx) * (i >> 1 ? ty : 1 - ty);
    if (!w || cc < 0 || rr < 0 || cc >= dem.cols || rr >= dem.rows) continue;
    const v = dem.data[rr * dem.cols + cc];
    if (v === dem.nodata || (land && v <= 0)) continue;
    sum += v * w;
    wsum += w;
  }
  return wsum ? sum / wsum : null;
}

// Земля под зданием: рельеф в центре, только по ячейкам суши — иначе дом на набережной «тонет»
// к 0. Крыши из DSM убирает fetch-dem.mjs, не опуская ячейки на склоне (см. там).
export const groundAt = (dem: Dem, lon: number, lat: number): number => demAt(dem, lon, lat, true) ?? 0;

export type Bld = {
  idx: number;
  id: number;
  osmType: 'way' | 'relation'; // мультиполигоны в buildings.json — из relation
  name: string | null;
  addr: string | null; // addr:street + addr:housenumber
  street: string | null; // ближайшая улица, если адреса нет
  kind: string | null; // тег building
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

// Этажность, когда в OSM нет ни building:levels, ни height (86 % зданий Тивата, 97 % Котора).
// По разбору data/*/buildings.json (2026-10-17): 85 % зданий — building=yes, их оставляем на 2 этажах;
// хозпостройки (тип из списка или контур меньше 40 м² — сараи, гаражи), руины и стройки — 1 этаж.
const LOW_TYPES = new Set(['shed', 'garage', 'garages', 'carport', 'container', 'roof', 'ruins', 'construction']);
const SMALL_AREA = 40; // м²
export const defaultFloors = (type: string | null, area: number) => (LOW_TYPES.has(type ?? '') || area < SMALL_AREA ? 1 : 2);

const polyRings = (g: any): [number, number][][] => (g.type === 'Polygon' ? [g.coordinates[0]] : g.coordinates.map((p: any) => p[0]));
const ringArea = (r: [number, number][]) => Math.abs(r.reduce((s, [x, y], i) => { const [x2, y2] = r[(i + 1) % r.length]; return s + x * y2 - x2 * y; }, 0)) / 2;

export function prepareBuildings(city: City, geojson: any, dem: Dem, proj: Proj): Bld[] {
  return geojson.features.map((f: any, idx: number): Bld => {
    const rings = polyRings(f.geometry).map((r) => r.map((p) => proj.toXY(p[0], p[1])));
    // Кольца замкнуты (первая точка повторена) — для центроида повтор убираем, иначе он смещается.
    const pts = rings.flatMap((r) => (r[0][0] === r.at(-1)![0] && r[0][1] === r.at(-1)![1] ? r.slice(0, -1) : r));
    const xy: [number, number] = [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
    const center = proj.toLonLat(...xy);
    // 0 этажей или 0 м в OSM — это «нет данных», а не здание без высоты.
    const levels = f.properties.levels || null, height = f.properties.height || null;
    const area = rings.reduce((s, r) => s + ringArea(r), 0);
    const floors = levels ?? (height ? Math.max(1, Math.round(height / city.floorHeight)) : defaultFloors(f.properties.building ?? null, area));
    return {
      idx, id: f.properties.id, osmType: f.geometry.type === 'MultiPolygon' ? 'relation' : 'way', name: f.properties.name, addr: f.properties.addr ?? null, street: f.properties.street ?? null, kind: f.properties.building ?? null, levels, height, floors, assumed: levels == null && height == null,
      h: height ?? floors * city.floorHeight, ground: groundAt(dem, center[0], center[1]), center, xy,
      radius: Math.max(...pts.map((p) => Math.hypot(p[0] - xy[0], p[1] - xy[1]))), rings,
    };
  });
}

// Растр препятствий: абсолютная отметка верха и индекс здания (+1) в каждой ячейке; деревья — TREE.
export const BCELL = 6; // м
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

// roofs — готовый растр (страница берёт его у воркера, чтобы не строить второй раз на главном потоке).
export function createWorld(city: City, geojson: any, greenery: any | null, demMeta: any, demBuf: ArrayBuffer, roofs?: Roofs): World {
  const proj = makeProj(city.camera.center);
  const dem = makeDem(demMeta, demBuf);
  const blds = prepareBuildings(city, geojson, dem, proj);
  return { city, proj, dem, roofs: roofs ?? rasterizeRoofs(city, proj, dem, blds, greenery), blds };
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
