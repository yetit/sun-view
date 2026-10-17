// Расчёт для здания, этажа и стороны: траектория солнца за сутки, часы по сезонам,
// лента года (день × час), видимость моря по 8 румбам, матрица «этажи × фасады», массовые расчёты для карты.
import SunCalc from 'suncalc';
import { BCELL, blocked, demAt, facades, seaVisible, TREE, wallPoint, type Bld, type City, type Facade, type World } from './grid.ts';

export const STEP_MIN = 10;
export const N = (24 * 60) / STEP_MIN; // отсчётов в сутках
export const YEAR = new Date().getUTCFullYear();
export const SEASONS = [
  { name: 'Весеннее равноденствие', short: 'Весна', date: new Date(Date.UTC(YEAR, 2, 20)) },
  { name: 'Летнее солнцестояние', short: 'Лето', date: new Date(Date.UTC(YEAR, 5, 21)) },
  { name: 'Осеннее равноденствие', short: 'Осень', date: new Date(Date.UTC(YEAR, 8, 22)) },
  { name: 'Зимнее солнцестояние', short: 'Зима', date: new Date(Date.UTC(YEAR, 11, 21)) },
];
export const DIRECTIONS = ['С', 'СВ', 'В', 'ЮВ', 'Ю', 'ЮЗ', 'З', 'СЗ'];
export const dirBearing = (i: number) => (i * Math.PI) / 4;
export const dirIndex = (bearing: number) => Math.round(bearing / (Math.PI / 4)) % 8; // ближайший румб, bearing в [0, 2π)

export type Sun = { altitude: number; bearing: number }; // рад; bearing — от севера по часовой

// suncalc считает азимут от юга к западу; переводим в компасный.
export function sunAt(t: Date, lon: number, lat: number): Sun {
  const p = SunCalc.getPosition(t, lat, lon);
  return { altitude: p.altitude, bearing: p.azimuth + Math.PI };
}

export const eyeHeight = (w: World, b: Bld, floor: number) => b.ground + (floor - 0.5) * w.city.floorHeight;

// Откуда смотрит окно: с фасада (normal — азимут его нормали) или null — здание целиком (из центра).
export type Eye = { x: number; y: number; z: number; normal: number | null };
export function eye(w: World, b: Bld, floor: number, f: Facade | null): Eye {
  return { x: f ? f.x : b.xy[0], y: f ? f.y : b.xy[1], z: eyeHeight(w, b, floor), normal: f ? f.normal : null };
}
// Солнце перед фасадом (в полусфере его нормали)?
export const facing = (e: Eye, bearing: number) => e.normal == null || Math.cos(bearing - e.normal) > 0;

export type Sample = Sun & { t: Date; lit: boolean; facing: boolean };

// Солнце над горизонтом за сутки (UTC) с шагом 10 минут: светит ли в окно, перед ли фасадом.
export function dayPath(w: World, b: Bld, e: Eye, date: Date): Sample[] {
  const out: Sample[] = [];
  for (let i = 0; i < N; i++) {
    const t = new Date(date.getTime() + i * STEP_MIN * 60000);
    const s = sunAt(t, b.center[0], b.center[1]);
    if (s.altitude <= 0) continue;
    const f = facing(e, s.bearing);
    out.push({ ...s, t, facing: f, lit: f && !blocked(w, b, e.x, e.y, e.z, s.bearing, s.altitude) });
  }
  return out;
}

export type Season = { name: string; short: string; sun: number; daylight: number; sunrise: Date | null; sunset: Date | null };

// Часы солнца в окнах и часы, когда солнце в принципе перед фасадом (для здания целиком — весь день).
export function seasonCalc(w: World, b: Bld, e: Eye, i: number): Season {
  const path = dayPath(w, b, e, SEASONS[i].date);
  const day = path.filter((s) => s.facing);
  return { ...SEASONS[i], sun: (day.filter((s) => s.lit).length * STEP_MIN) / 60, daylight: (day.length * STEP_MIN) / 60, sunrise: path[0]?.t ?? null, sunset: path.at(-1)?.t ?? null };
}

// Лента года: столбец — каждый 5-й день, строка — 10 минут суток (UTC). 0 ночь, 1 тень/не перед фасадом, 2 солнце.
export const RIBBON_DAY_STEP = 5;
export function yearRibbon(w: World, b: Bld, e: Eye) {
  const cols = Math.ceil(365 / RIBBON_DAY_STEP);
  const data = new Uint8Array(cols * N);
  for (let c = 0; c < cols; c++) {
    const day = Date.UTC(YEAR, 0, 1 + c * RIBBON_DAY_STEP);
    for (let i = 0; i < N; i++) {
      const s = sunAt(new Date(day + i * STEP_MIN * 60000), b.center[0], b.center[1]);
      if (s.altitude <= 0) continue;
      data[i * cols + c] = facing(e, s.bearing) && !blocked(w, b, e.x, e.y, e.z, s.bearing, s.altitude) ? 2 : 1;
    }
  }
  return { cols, rows: N, data };
}

// Море по 8 румбам, каждый — из окна на своей стене.
export type SeaDir = { dir: string; bearing: number; dist: number | null };
export function seaRose(w: World, b: Bld, floor: number): SeaDir[] {
  const z = eyeHeight(w, b, floor);
  return DIRECTIONS.map((dir, i) => {
    const [x, y] = wallPoint(b, dirBearing(i));
    return { dir, bearing: dirBearing(i), dist: seaVisible(w, b, x, y, z, dirBearing(i)) };
  });
}

// Море из окна фасада: лучи по нормали и в ±45° от неё — сколько из трёх видят воду.
export const SEA_FAN = [-Math.PI / 4, 0, Math.PI / 4];
export const facadeSea = (w: World, b: Bld, f: Facade, floor: number) =>
  SEA_FAN.filter((da) => seaVisible(w, b, f.x, f.y, eyeHeight(w, b, floor), f.normal + da) != null).length;

// Матрица «этажи × фасады»: часы солнца в зимнее солнцестояние и число лучей с морем.
// Клетка k = (этаж − 1) × cols + фасад.
export function facadeMatrix(w: World, b: Bld, floors = b.floors) {
  const fs = facades(w, b), cols = fs.length;
  const sun = new Float32Array(floors * cols), sea = new Uint8Array(floors * cols);
  for (let fl = 1; fl <= floors; fl++) fs.forEach((f, c) => {
    const k = (fl - 1) * cols + c;
    sun[k] = seasonCalc(w, b, eye(w, b, fl, f), 3).sun;
    sea[k] = facadeSea(w, b, f, fl);
  });
  return { floors, cols, sun, sea };
}

// Лучшая клетка: максимум зимнего солнца, при равенстве — больше моря, затем выше этаж.
// −1, если сравнивать нечего: ни солнца, ни моря ни в одной клетке.
export function bestCell({ cols, sun, sea }: { cols: number; sun: ArrayLike<number>; sea: ArrayLike<number> }) {
  let best = -1;
  for (let k = 0; k < sun.length; k++) {
    if (!sun[k] && !sea[k]) continue;
    if (best < 0 || sun[k] > sun[best] || (sun[k] === sun[best] && (sea[k] > sea[best] || (sea[k] === sea[best] && Math.floor(k / cols) > Math.floor(best / cols))))) best = k;
  }
  return best;
}

// --- Надёжность результата для здания ------------------------------------------
// Причины, известные из сверок: этажность предположена; крутой склон — перепад DEM больше 30 м
// в квадрате ±60 м, отметка глаза на сетке 60 м неточна и горизонт вверх по склону завышен
// (docs/horizon-check.md, п. 4); деревья растра (лес и парки OSM, 10 м) в 20 м от описанной окружности.
// Нет причин — высокая, одна — средняя, две и больше — низкая.
export type Reason = 'assumed' | 'slope' | 'trees';
export type Reliability = { level: 'high' | 'medium' | 'low'; reasons: Reason[]; drop: number };
const SLOPE_R = 60, SLOPE_DROP = 30, TREES_R = 20; // м

export function reliability(w: World, b: Bld, assumed = b.assumed): Reliability {
  const [lon0, lat0] = b.center;
  let lo = Infinity, hi = -Infinity;
  for (let dx = -SLOPE_R; dx <= SLOPE_R; dx += SLOPE_R / 2) for (let dy = -SLOPE_R; dy <= SLOPE_R; dy += SLOPE_R / 2) {
    const v = demAt(w.dem, lon0 + dx / w.proj.mLon, lat0 + dy / w.proj.mLat);
    if (v != null && v > 0) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  }
  const drop = hi > lo ? hi - lo : 0;
  const reasons: Reason[] = [];
  if (assumed) reasons.push('assumed');
  if (drop > SLOPE_DROP) reasons.push('slope');
  if (treesNear(w, b, TREES_R)) reasons.push('trees');
  return { level: reasons.length === 0 ? 'high' : reasons.length === 1 ? 'medium' : 'low', reasons, drop };
}

// Есть ли ячейка деревьев в растре на расстоянии до d от описанной окружности здания.
function treesNear(w: World, b: Bld, d: number): boolean {
  const { x0, y0, cols, rows, idx } = w.roofs;
  const R = b.radius + d;
  const c0 = Math.max(0, Math.floor((b.xy[0] - R - x0) / BCELL)), c1 = Math.min(cols - 1, Math.floor((b.xy[0] + R - x0) / BCELL));
  const r0 = Math.max(0, Math.floor((b.xy[1] - R - y0) / BCELL)), r1 = Math.min(rows - 1, Math.floor((b.xy[1] + R - y0) / BCELL));
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    if (idx[r * cols + c] !== TREE) continue;
    if (Math.hypot(x0 + (c + 0.5) * BCELL - b.xy[0], y0 + (r + 0.5) * BCELL - b.xy[1]) <= R) return true;
  }
  return false;
}

// --- Массовые расчёты для карты (все здания) ---------------------------------
// Высота окна над землёй для карт, м. Этаж — тот, чьё окно ближе всего к высоте; дом ниже — верхний этаж.
export const HEIGHTS = [2, 5, 10];
export const floorAt = (w: { city: City }, h: number) => Math.max(1, Math.round(h / w.city.floorHeight + 0.5));
const floorFor = (w: World, b: Bld, h: number) => Math.min(b.floors, floorAt(w, h));

// Часы солнца в окнах (здание целиком) для зданий from..to.
export function massSun(w: World, season: number, h: number, from: number, to: number, out: Float32Array) {
  for (let i = from; i < to; i++) {
    const b = w.blds[i];
    out[i] = seasonCalc(w, b, eye(w, b, floorFor(w, b, h), null), season).sun;
  }
}
// Сколько румбов с морем.
export function massSea(w: World, h: number, from: number, to: number, out: Uint8Array) {
  for (let i = from; i < to; i++) {
    const b = w.blds[i];
    out[i] = seaRose(w, b, floorFor(w, b, h)).filter((s) => s.dist != null).length;
  }
}
