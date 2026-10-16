// Расчёт для выбранного здания и этажа: часы солнца по сезонам и видимость моря по 8 румбам.
import SunCalc from 'suncalc';
import city from '../../city.config.mjs';
import { blocked, seaVisible, toXY, type Bld, type World } from './grid';

const STEP_MIN = 10;
const year = new Date().getUTCFullYear();
export const SEASONS = [
  { name: 'Весеннее равноденствие', date: new Date(Date.UTC(year, 2, 20)) },
  { name: 'Летнее солнцестояние', date: new Date(Date.UTC(year, 5, 21)) },
  { name: 'Осеннее равноденствие', date: new Date(Date.UTC(year, 8, 22)) },
  { name: 'Зимнее солнцестояние', date: new Date(Date.UTC(year, 11, 21)) },
];
export const DIRECTIONS = ['С', 'СВ', 'В', 'ЮВ', 'Ю', 'ЮЗ', 'З', 'СЗ'];

export type Season = { name: string; sun: number; daylight: number; samples: Uint8Array; sunrise: Date | null; sunset: Date | null };
export type Result = { eyeZ: number; seasons: Season[]; sea: { dir: string; dist: number | null }[] };

// Окно на середине высоты этажа.
export function eyeHeight(b: Bld, floor: number) {
  return b.ground + (floor - 0.5) * city.floorHeight;
}

export function analyze(w: World, b: Bld, floor: number): Result {
  const [x, y] = toXY(...b.center);
  const z = eyeHeight(b, floor);
  const [lon, lat] = b.center;

  const seasons = SEASONS.map(({ name, date }) => {
    const n = (24 * 60) / STEP_MIN;
    const samples = new Uint8Array(n); // 0 ночь, 1 тень, 2 солнце
    let sun = 0, daylight = 0;
    let sunrise: Date | null = null, sunset: Date | null = null;
    for (let i = 0; i < n; i++) {
      const t = new Date(date.getTime() + i * STEP_MIN * 60000);
      const { altitude, azimuth } = SunCalc.getPosition(t, lat, lon);
      if (altitude <= 0) continue;
      daylight++;
      sunrise ??= t;
      sunset = t;
      // suncalc: азимут от юга к западу; нам нужен от севера по часовой.
      samples[i] = blocked(w, b, x, y, z, azimuth + Math.PI, altitude) ? 1 : 2;
      if (samples[i] === 2) sun++;
    }
    return { name, sun: (sun * STEP_MIN) / 60, daylight: (daylight * STEP_MIN) / 60, samples, sunrise, sunset };
  });

  const sea = DIRECTIONS.map((dir, i) => ({ dir, dist: seaVisible(w, b, x, y, z, (i * Math.PI) / 4) }));
  return { eyeZ: z, seasons, sea };
}
