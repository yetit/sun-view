// Где не хватает этажности: насколько от неизвестной этажности дома зависят ответы у соседей.
// Дом без building:levels/height в OSM поднимаем с 1 до 4 этажей и смотрим, у скольких соседей
// в радиусе 100 м меняется ответ на их среднем этаже:
//  - часы солнца в день зимнего солнцестояния (окна всего здания), если разница ≥ 0,5 ч;
//  - число направлений (из 8) с видом на море.
// Пересчитываются только лучи, которые смотрят на этот дом (по азимуту в пределах его углового
// размера), — остальные от его высоты не зависят. Дёшево: тысячи домов за секунды.
import { dirBearing, eye, SEASONS, STEP_MIN, N, sunAt, type Sun } from './analysis.ts';
import { BCELL, blocked, seaVisible, type Bld, type World } from './grid.ts';

export const LOW = 1, HIGH = 4; // этажей
export const RADIUS = 100; // м
const MIN_DH = 0.5; // ч — меньше считаем шумом

export type Impact = { idx: number; windows: number; sunH: number; sea: number; neighbours: number };

// Солнце в день зимнего солнцестояния над горизонтом — одно на город (размер города ≪ широты).
export function winterSuns(w: World): Sun[] {
  const [lon, lat] = w.city.camera.center, d = SEASONS[3].date.getTime(), out: Sun[] = [];
  for (let i = 0; i < N; i++) { const s = sunAt(new Date(d + i * STEP_MIN * 60000), lon, lat); if (s.altitude > 0) out.push(s); }
  return out;
}

// Ячейки растра крыш, где верх — этот дом.
function cellsOf(w: World, a: Bld): number[] {
  const { x0, y0, cols, rows, idx } = w.roofs, out: number[] = [];
  const xs = a.rings.flat().map((p) => p[0]), ys = a.rings.flat().map((p) => p[1]);
  const c0 = Math.max(0, Math.floor((Math.min(...xs) - x0) / BCELL)), c1 = Math.min(cols - 1, Math.floor((Math.max(...xs) - x0) / BCELL));
  const r0 = Math.max(0, Math.floor((Math.min(...ys) - y0) / BCELL)), r1 = Math.min(rows - 1, Math.floor((Math.max(...ys) - y0) / BCELL));
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (idx[r * cols + c] === a.idx + 1) out.push(r * cols + c);
  return out;
}

const near = (bearing: number, phi: number, half: number) => Math.abs(Math.atan2(Math.sin(bearing - phi), Math.cos(bearing - phi))) <= half;

export function levelsImpact(w: World, a: Bld, suns: Sun[]): Impact {
  const res: Impact = { idx: a.idx, windows: 0, sunH: 0, sea: 0, neighbours: 0 };
  const cells = cellsOf(w, a);
  if (!cells.length) return res;
  const saved = cells.map((k) => w.roofs.z[k]);
  const setH = (floors: number) => cells.forEach((k) => (w.roofs.z[k] = a.ground + floors * w.city.floorHeight));
  for (const b of w.blds) {
    if (b === a) continue;
    const dx = a.xy[0] - b.xy[0], dy = a.xy[1] - b.xy[1], d = Math.hypot(dx, dy);
    if (d > RADIUS + a.radius) continue;
    res.neighbours++;
    const phi = Math.atan2(dx, dy), half = Math.atan2(a.radius + BCELL, Math.max(1, d - a.radius)) + 0.02;
    const e = eye(w, b, Math.ceil(b.floors / 2), null);
    const sunTo = suns.filter((s) => near(s.bearing, phi, half));
    const seaTo = [0, 1, 2, 3, 4, 5, 6, 7].filter((i) => near(dirBearing(i), phi, half));
    if (!sunTo.length && !seaTo.length) continue;
    const count = (floors: number) => {
      setH(floors);
      const lit = sunTo.filter((s) => !blocked(w, b, e.x, e.y, e.z, s.bearing, s.altitude)).length;
      const sea = seaTo.filter((i) => seaVisible(w, b, e.x, e.y, e.z, dirBearing(i)) != null).length;
      return { lit, sea };
    };
    const lo = count(LOW), hi = count(HIGH);
    const dh = ((lo.lit - hi.lit) * STEP_MIN) / 60, ds = lo.sea - hi.sea;
    res.sunH += dh;
    res.sea += ds;
    if (dh >= MIN_DH || ds > 0) res.windows++;
  }
  cells.forEach((k, i) => (w.roofs.z[k] = saved[i]));
  return res;
}

// Все дома без этажности — по убыванию влияния: сначала число соседей с изменившимся ответом,
// потом часы солнца, потом море.
export function levelsTodo(w: World): Impact[] {
  const suns = winterSuns(w);
  return w.blds.filter((b) => b.assumed).map((b) => levelsImpact(w, b, suns))
    .sort((x, y) => y.windows - x.windows || y.sunH - x.sunH || y.sea - x.sea);
}
