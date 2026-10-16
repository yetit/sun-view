// Расчёт для здания, этажа и стороны: траектория солнца за сутки, часы по сезонам,
// лента года (день × час), видимость моря по 8 румбам, массовые расчёты для карты.
import SunCalc from 'suncalc';
import { blocked, seaVisible, wallPoint, type Bld, type World } from './grid.ts';

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

export type Sun = { altitude: number; bearing: number }; // рад; bearing — от севера по часовой

// suncalc считает азимут от юга к западу; переводим в компасный.
export function sunAt(t: Date, lon: number, lat: number): Sun {
  const p = SunCalc.getPosition(t, lat, lon);
  return { altitude: p.altitude, bearing: p.azimuth + Math.PI };
}

export const eyeHeight = (w: World, b: Bld, floor: number) => b.ground + (floor - 0.5) * w.city.floorHeight;

// Откуда смотрит окно: side — румб фасада (0..7) или null — здание целиком (из центра).
export type Eye = { x: number; y: number; z: number; side: number | null };
export function eye(w: World, b: Bld, floor: number, side: number | null): Eye {
  const [x, y] = side == null ? b.xy : wallPoint(b, dirBearing(side));
  return { x, y, z: eyeHeight(w, b, floor), side };
}
// Солнце перед фасадом (в полусфере его нормали)?
export const facing = (e: Eye, bearing: number) => e.side == null || Math.cos(bearing - dirBearing(e.side)) > 0;

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

// --- Массовые расчёты для карты (все здания) ---------------------------------
export type FloorMode = '1' | 'mid' | 'top';
export const floorFor = (b: Bld, mode: FloorMode) => (mode === '1' ? 1 : mode === 'top' ? b.floors : Math.ceil(b.floors / 2));

// Доля светового дня с солнцем в окнах (здание целиком) для зданий from..to.
export function massSun(w: World, season: number, mode: FloorMode, from: number, to: number, out: Float32Array) {
  for (let i = from; i < to; i++) {
    const b = w.blds[i];
    const r = seasonCalc(w, b, eye(w, b, floorFor(b, mode), null), season);
    out[i] = r.daylight ? r.sun / r.daylight : 0;
  }
}
// Сколько румбов с морем.
export function massSea(w: World, mode: FloorMode, from: number, to: number, out: Uint8Array) {
  for (let i = from; i < to; i++) {
    const b = w.blds[i];
    out[i] = seaRose(w, b, floorFor(b, mode)).filter((s) => s.dist != null).length;
  }
}
