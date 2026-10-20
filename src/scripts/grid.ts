// Геометрия и высотные сетки: рельеф (DEM), растр крыш и деревьев, трассировка луча.
// Локальная система — метры от центра города: x на восток, y на север, z — высота над морем.

export type City = {
  id: string;
  name: string;
  nameEn?: string;
  bbox: { south: number; west: number; north: number; east: number };
  dem: { bbox: { south: number; west: number; north: number; east: number }; step: number; dtm?: 'kartverket' };
  camera: { center: [number, number]; zoom: number; pitch: number; bearing: number };
  timezone: string;
  floorHeight: number;
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

// Высота крон (scripts/fetch-canopy.mjs): сетка ~6 м в градусах от северо-западного угла, метры над землёй, 0 — нет дерева.
// Старший бит — лиственная крона (Copernicus Dominant Leaf Type). В файле — RLE: пары (нулей перед значением, значение).
export type Canopy = { west: number; north: number; cols: number; rows: number; dlon: number; dlat: number; h: Uint8Array };
export function makeCanopy(meta: any, buf: ArrayBuffer): Canopy {
  const rle = new Uint8Array(buf), h = new Uint8Array(meta.cols * meta.rows);
  for (let i = 0, k = 0; i < rle.length; i += 2) { k += rle[i]; h[k++] = rle[i + 1]; }
  return { west: meta.west, north: meta.north, cols: meta.cols, rows: meta.rows, dlon: meta.dlon, dlat: meta.dlat, h };
}
const canopyAt = (t: Canopy, lon: number, lat: number) => {
  const c = Math.floor((lon - t.west) / t.dlon), r = Math.floor((t.north - lat) / t.dlat);
  return c < 0 || r < 0 || c >= t.cols || r >= t.rows ? 0 : t.h[r * t.cols + c];
};

// Растр препятствий: абсолютная отметка верха и индекс здания (+1) в каждой ячейке; деревья — TREE, лиственные — BROAD.
export const BCELL = 6; // м
export const TREE = 0xffff, BROAD = 0xfffe, PLANNED = 0xfffd;
export type Roofs = { x0: number; y0: number; cols: number; rows: number; z: Float32Array; idx: Uint16Array };

export function inRing(x: number, y: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function rasterizeRoofs(city: City, proj: Proj, dem: Dem, blds: Bld[], canopy: Canopy | null): Roofs {
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
  // Деревья первыми: здание перекроет их своей ячейкой.
  if (canopy) for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const [lon, lat] = proj.toLonLat(x0 + (c + 0.5) * BCELL, y0 + (r + 0.5) * BCELL);
    const v = canopyAt(canopy, lon, lat);
    if (v) { z[r * cols + c] = (demAt(dem, lon, lat) ?? 0) + (v & 127); idx[r * cols + c] = v & 128 ? BROAD : TREE; }
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

// sunshine — вероятность прямого солнца по месяцам (data/<id>/climate.json), если есть: с ней годовая оценка — по вероятным часам.
// climate — дневная температура и ветер по месяцам (тот же файл), для строки климата в панели.
export type Climate = { tday: number[]; wind: number[][]; windSpeed: number[] };
export type World = { city: City; proj: Proj; dem: Dem; roofs: Roofs; blds: Bld[]; sunshine?: number[] | null; climate?: Climate | null; planned?: { features: any[] } | null };

// Тот же мир плюс планируемые объёмы (data/<id>/planned.geojson): контур × высота над землёй, PLANNED в растре.
// Деревья под ними уходят, существующий дом остаётся, если он выше.
export function plannedWorld(w: World, planned: { features: any[] }): World {
  const z = w.roofs.z.slice(), idx = w.roofs.idx.slice(), { x0, y0, cols, rows } = w.roofs;
  for (const f of planned.features) for (const ring of polyRings(f.geometry)) {
    const r = ring.map((p) => w.proj.toXY(p[0], p[1]));
    const xs = r.map((p) => p[0]), ys = r.map((p) => p[1]);
    const c0 = Math.max(0, Math.floor((Math.min(...xs) - x0) / BCELL)), c1 = Math.min(cols - 1, Math.floor((Math.max(...xs) - x0) / BCELL));
    const r0 = Math.max(0, Math.floor((Math.min(...ys) - y0) / BCELL)), r1 = Math.min(rows - 1, Math.floor((Math.max(...ys) - y0) / BCELL));
    for (let rr = r0; rr <= r1; rr++) for (let c = c0; c <= c1; c++) {
      const x = x0 + (c + 0.5) * BCELL, y = y0 + (rr + 0.5) * BCELL;
      if (!inRing(x, y, r)) continue;
      const k = rr * cols + c, top = (demAt(w.dem, ...w.proj.toLonLat(x, y)) ?? 0) + f.properties.height;
      if (top > z[k] || idx[k] === TREE || idx[k] === BROAD) { z[k] = top; idx[k] = PLANNED; } // деревья на участке под стройку уходят
    }
  }
  return { ...w, roofs: { ...w.roofs, z, idx } };
}

// Тот же мир, но лиственные деревья без листвы — для верхней оценки солнца весной и зимой.
// Голые ветви тоже дают тень, поэтому это граница сверху, а не прогноз. Пустая ячейка — z = 0.
export function bareWorld(w: World): World {
  const z = w.roofs.z.slice(), idx = w.roofs.idx.slice();
  for (let k = 0; k < idx.length; k++) if (idx[k] === BROAD) { z[k] = 0; idx[k] = 0; }
  return { ...w, roofs: { ...w.roofs, z, idx } };
}

// roofs — готовый растр (страница берёт его у воркера, чтобы не строить второй раз на главном потоке).
export function createWorld(city: City, geojson: any, canopy: Canopy | null, demMeta: any, demBuf: ArrayBuffer, roofs?: Roofs): World {
  const proj = makeProj(city.camera.center);
  const dem = makeDem(demMeta, demBuf);
  const blds = prepareBuildings(city, geojson, dem, proj);
  return { city, proj, dem, roofs: roofs ?? rasterizeRoofs(city, proj, dem, blds, canopy), blds };
}

// Фасады — реальные стены контура. Соседние рёбра, почти лежащие на одной прямой (OSM дробит стену
// точками, скругления), склеиваются в одну стену, пока отклонение от её хорды не больше BEND.
// Куски стены, у которых точка в 1 м снаружи попадает в соседнее здание, — глухие общие, не фасад
// (проверка через каждый метр, остаются открытые участки).
// Параллельные стены одной плоскости (ступеньки, лоджии — сдвиг до STEP) — один фасад: для покупателя
// это одна сторона дома. Фасад короче MIN_WALL отбрасывается. Нормаль — наружу (азимут, рад), окно —
// у середины самой длинной стены, на 1 м снаружи. Порядок — по азимуту нормали от севера по часовой,
// номер фасада идёт в ссылку.
export const MIN_WALL = 4; // м
const BEND = (15 * Math.PI) / 180, STEP = 3; // м
type XY = [number, number];
export type Facade = { segs: [XY, XY][]; len: number; normal: number; x: number; y: number };

const angDiff = (a: number, b: number) => Math.abs((((b - a) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI);

export function facades(w: World, b: Bld): Facade[] {
  const near = w.blds.filter((o) => o !== b && Math.hypot(o.xy[0] - b.xy[0], o.xy[1] - b.xy[1]) < o.radius + b.radius + 2);
  const walls: (Facade & { nx: number; ny: number })[] = [];
  for (const raw of b.rings) {
    const ring = raw.filter((p, i) => Math.hypot(p[0] - raw.at(i - 1)![0], p[1] - raw.at(i - 1)![1]) > 0.05); // без повторов и замыкающей точки
    const n = ring.length;
    if (n < 3) continue;
    const ccw = ring.reduce((s, [x, y], i) => s + x * ring[(i + 1) % n][1] - ring[(i + 1) % n][0] * y, 0) > 0;
    const dir = (i: number, j: number) => Math.atan2(ring[j % n][1] - ring[i % n][1], ring[j % n][0] - ring[i % n][0]);
    // Начинаем с угла, чтобы стена не разрезалась на стыке начала и конца кольца.
    const s = Math.max(0, ring.findIndex((_, i) => angDiff(dir(i + n - 1, i + n), dir(i, i + 1)) > BEND));
    let i0 = s;
    for (let k = 1; k <= n; k++) {
      const i = s + k;
      if (k < n && angDiff(dir(i0, i), dir(i, i + 1)) <= BEND) continue;
      const a = ring[i0 % n], e = ring[i % n];
      const len = Math.hypot(e[0] - a[0], e[1] - a[1]), m = Math.ceil(len);
      const nx = ((ccw ? 1 : -1) * (e[1] - a[1])) / len, ny = ((ccw ? -1 : 1) * (e[0] - a[0])) / len;
      const at = (t: number): XY => [a[0] + (e[0] - a[0]) * t, a[1] + (e[1] - a[1]) * t];
      const open = (j: number) => { const [x, y] = at((j + 0.5) / m); return !near.some((o) => o.rings.some((r) => inRing(x + nx, y + ny, r))); };
      for (let j = 0, j0 = -1; j <= m; j++) {
        if (j < m && open(j)) { if (j0 < 0) j0 = j; continue; }
        if (j0 < 0) continue;
        const p = at(j0 / m), q = at(j / m), [x, y] = at((j0 + j) / 2 / m);
        walls.push({ segs: [[p, q]], len: (len * (j - j0)) / m, normal: (Math.atan2(nx, ny) + 2 * Math.PI) % (2 * Math.PI), x: x + nx, y: y + ny, nx, ny });
        j0 = -1;
      }
      i0 = i;
    }
  }
  const out: typeof walls = [];
  for (const wl of walls.sort((p, q) => q.len - p.len)) {
    const f = out.find((f) => angDiff(f.normal, wl.normal) <= BEND && Math.abs((wl.x - f.x) * f.nx + (wl.y - f.y) * f.ny) <= STEP);
    if (f) { f.segs.push(...wl.segs); f.len += wl.len; } else out.push(wl);
  }
  return out.filter((f) => f.len >= MIN_WALL).sort((p, q) => p.normal - q.normal).map(({ segs, len, normal, x, y }) => ({ segs, len, normal, x, y }));
}

// Фасад, нормаль которого ближе всего к азимуту (старые ссылки d=0..7, клик по розе).
export const nearestFacade = (fs: Facade[], bearing: number) =>
  fs.reduce((best, f, i) => (best < 0 || angDiff(f.normal, bearing) < angDiff(fs[best].normal, bearing) ? i : best), -1);

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

// Горизонт из окна по азимуту с домами и деревьями: максимум (препятствие − z) / расстояние по тем же
// точкам луча, что в blocked(). Солнце закрыто ⟺ tg высоты солнца меньше — так годовой расчёт
// трассирует один луч на азимут, а не на каждый отсчёт солнца.
export function horizonTan(w: World, b: Bld, x: number, y: number, z: number, bearing: number): number {
  const sx = Math.sin(bearing), sy = Math.cos(bearing);
  const skipDem = b.radius + w.dem.cell * w.proj.mLat;
  let max = -Infinity;
  for (let d = 2; d < FAR; d += d < NEAR ? 3 : 30) {
    if (d >= NEAR && (w.dem.max - z) / d <= max) break; // дальше рельеф не поднимется выше
    const px = x + d * sx, py = y + d * sy;
    if (d < NEAR) {
      const [roof, i] = roofAt(w.roofs, px, py);
      if (i !== b.idx) max = Math.max(max, (roof - z) / d);
    }
    if (d < skipDem) continue;
    const t = demAt(w.dem, ...w.proj.toLonLat(px, py));
    if (t == null) break;
    max = Math.max(max, (t - z) / d);
  }
  return max;
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

// Что видно по лучу с азимутом bearing и углом места elev: препятствие (рельеф, дерево, чужое здание),
// море (луч ушёл под воду над ячейкой моря) или небо. Шаг и пропуск своего здания — как в blocked().
// За краем сетки не знаем: вверх — небо, вниз — не море (как seaVisible()).
export const HIT = { obstacle: 0, sea: 1, sky: 2 } as const;
export function rayHit(w: World, b: Bld, x: number, y: number, z: number, bearing: number, elev: number): number {
  const sx = Math.sin(bearing), sy = Math.cos(bearing), tz = Math.tan(elev);
  const skipDem = b.radius + w.dem.cell * w.proj.mLat;
  for (let d = 2; d < FAR; d += d < NEAR ? 3 : 30) {
    const zr = z + d * tz;
    if (tz >= 0 && zr > w.dem.max) return HIT.sky;
    const px = x + d * sx, py = y + d * sy;
    if (d < NEAR) {
      const [roof, i] = roofAt(w.roofs, px, py);
      if (i !== b.idx && i >= 0 && roof > zr) return HIT.obstacle;
    }
    if (d < skipDem) continue;
    const t = demAt(w.dem, ...w.proj.toLonLat(px, py));
    if (t == null) break;
    if (t <= 0 && zr <= 0) return HIT.sea;
    if (t > zr) return HIT.obstacle;
  }
  return tz >= 0 ? HIT.sky : HIT.obstacle;
}
