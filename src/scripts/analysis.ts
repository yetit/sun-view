// Расчёт для здания и этажа: траектория солнца за сутки, часы солнца по сезонам,
// лента года (день × час), видимость моря по 8 румбам.
import SunCalc from 'suncalc';
import city from '../../city.config.mjs';
import { blocked, seaVisible, toXY, type Bld, type World } from './grid';

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

export type Sun = { altitude: number; bearing: number }; // рад; bearing — от севера по часовой

// suncalc считает азимут от юга к западу; переводим в компасный.
export function sunAt(t: Date, lon: number, lat: number): Sun {
  const p = SunCalc.getPosition(t, lat, lon);
  return { altitude: p.altitude, bearing: p.azimuth + Math.PI };
}

// Окно на середине высоты этажа.
export const eyeHeight = (b: Bld, floor: number) => b.ground + (floor - 0.5) * city.floorHeight;

export type Sample = Sun & { t: Date; lit: boolean };

// Солнце над горизонтом за сутки (UTC) с шагом 10 минут и признак «не закрыто».
export function dayPath(w: World, b: Bld, floor: number, date: Date): Sample[] {
  const [x, y] = toXY(...b.center);
  const z = eyeHeight(b, floor);
  const out: Sample[] = [];
  for (let i = 0; i < N; i++) {
    const t = new Date(date.getTime() + i * STEP_MIN * 60000);
    const s = sunAt(t, b.center[0], b.center[1]);
    if (s.altitude <= 0) continue;
    out.push({ ...s, t, lit: !blocked(w, b, x, y, z, s.bearing, s.altitude) });
  }
  return out;
}

export type Season = { name: string; short: string; sun: number; daylight: number; sunrise: Date | null; sunset: Date | null };

export function seasonCalc(w: World, b: Bld, floor: number, i: number): Season {
  const path = dayPath(w, b, floor, SEASONS[i].date);
  const lit = path.filter((s) => s.lit).length;
  return { ...SEASONS[i], sun: (lit * STEP_MIN) / 60, daylight: (path.length * STEP_MIN) / 60, sunrise: path[0]?.t ?? null, sunset: path.at(-1)?.t ?? null };
}

// Лента года: столбец — каждый 5-й день, строка — 10 минут суток (UTC). 0 ночь, 1 тень, 2 солнце.
export const RIBBON_DAY_STEP = 5;
export function yearRibbon(w: World, b: Bld, floor: number) {
  const [x, y] = toXY(...b.center);
  const z = eyeHeight(b, floor);
  const cols = Math.ceil(365 / RIBBON_DAY_STEP);
  const data = new Uint8Array(cols * N);
  for (let c = 0; c < cols; c++) {
    const day = Date.UTC(YEAR, 0, 1 + c * RIBBON_DAY_STEP);
    for (let i = 0; i < N; i++) {
      const s = sunAt(new Date(day + i * STEP_MIN * 60000), b.center[0], b.center[1]);
      if (s.altitude <= 0) continue;
      data[i * cols + c] = blocked(w, b, x, y, z, s.bearing, s.altitude) ? 1 : 2;
    }
  }
  return { cols, rows: N, data };
}

export type SeaDir = { dir: string; bearing: number; dist: number | null };
export function seaRose(w: World, b: Bld, floor: number): SeaDir[] {
  const [x, y] = toXY(...b.center);
  const z = eyeHeight(b, floor);
  return DIRECTIONS.map((dir, i) => ({ dir, bearing: (i * Math.PI) / 4, dist: seaVisible(w, b, x, y, z, (i * Math.PI) / 4) }));
}
