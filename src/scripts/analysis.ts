// Расчёт для здания, этажа и стороны: траектория солнца за сутки, часы по сезонам,
// лента года (день × час), годовая оценка окна по BRE, видимость моря по 8 румбам, вид из окна,
// матрица «этажи × фасады», массовые расчёты для карты.
import SunCalc from 'suncalc';
import { BCELL, blocked, DECID, demAt, facades, HIT, horizonTan, rayHit, seaVisible, TREE, wallPoint, type Bld, type City, type Facade, type World } from './grid.ts';

export const STEP_MIN = 10;
export const N = (24 * 60) / STEP_MIN; // отсчётов в сутках
export const YEAR = new Date().getUTCFullYear();
export const SEASONS = [
  { name: 'Весеннее равноденствие', short: 'Весна', date: new Date(Date.UTC(YEAR, 2, 20)) },
  { name: 'Летнее солнцестояние', short: 'Лето', date: new Date(Date.UTC(YEAR, 5, 21)) },
  { name: 'Осеннее равноденствие', short: 'Осень', date: new Date(Date.UTC(YEAR, 8, 22)) },
  { name: 'Зимнее солнцестояние', short: 'Зима', date: new Date(Date.UTC(YEAR, 11, 21)) },
];
// Вероятность прямого солнца на дату: линейно между серединами месяцев (scripts/fetch-climate.mjs).
export function sunshineAt(months: number[], date: Date) {
  const m = date.getUTCMonth(), dim = new Date(Date.UTC(YEAR, m + 1, 0)).getUTCDate();
  const f = (date.getUTCDate() - 0.5) / dim - 0.5; // −0,5..0,5 от середины месяца
  const n = (m + (f < 0 ? 11 : 1)) % 12, k = Math.abs(f);
  return months[m] * (1 - k) + months[n] * k;
}

// Климат города на дату: дневная температура (между серединами месяцев) и ветер за три месяца вокруг даты —
// чаще всего откуда дует (румб 0 = С … 7 = СЗ), его доля среди часов с ветром и средняя скорость.
export function seasonClimate(c: { tday: number[]; wind: number[][]; windSpeed: number[] }, date: Date) {
  const m = date.getUTCMonth(), ms = [(m + 11) % 12, m, (m + 1) % 12];
  const hist = new Array(8).fill(0);
  for (const k of ms) c.wind[k].forEach((v, i) => (hist[i] += v));
  const dir = hist.indexOf(Math.max(...hist)), total = hist.reduce((a, b) => a + b, 0);
  return { t: sunshineAt(c.tday, date), dir, share: total ? hist[dir] / total : 0, speed: ms.reduce((a, k) => a + c.windSpeed[k], 0) / 3 };
}

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
// Точка на крыше (терраса): 1,5 м над кровлей в центре контура, без фасада — солнце с любой стороны.
export const roofEye = (b: Bld): Eye => ({ x: b.xy[0], y: b.xy[1], z: b.ground + b.h + 1.5, normal: null });
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

// Позднее солнце: часы прямого солнца в окне с fromHour местного времени до заката в день date (сутки UTC).
// tz — смещение местного времени от UTC в часах на эту дату. Для риска перегрева летом.
export function lateSun(w: World, b: Bld, e: Eye, date: Date, fromHour: number, tz: number) {
  return (dayPath(w, b, e, date).filter((s) => s.lit && (s.t.getUTCHours() + s.t.getUTCMinutes() / 60 + tz + 24) % 24 >= fromHour).length * STEP_MIN) / 60;
}
// Риск перегрева по позднему летнему солнцу — наши пороги: от 3 ч — заметный, от 1 ч — умеренный.
export const heatRisk = (lateHours: number) => (lateHours >= 3 ? 'high' : lateHours >= 1 ? 'mid' : 'low');

export type Season = { name: string; short: string; sun: number; daylight: number; sunrise: Date | null; sunset: Date | null };

// Часы солнца в окнах и часы, когда солнце в принципе перед фасадом (для здания целиком — весь день).
// Любой день (сутки UTC): часы солнца в окне, день перед фасадом, восход и закат, первое и последнее солнце в окне.
export type Day = { sun: number; daylight: number; sunrise: Date | null; sunset: Date | null; firstLit: Date | null; lastLit: Date | null };
export function dayCalc(w: World, b: Bld, e: Eye, date: Date): Day {
  const path = dayPath(w, b, e, date), day = path.filter((s) => s.facing), lit = day.filter((s) => s.lit);
  return { sun: (lit.length * STEP_MIN) / 60, daylight: (day.length * STEP_MIN) / 60, sunrise: path[0]?.t ?? null, sunset: path.at(-1)?.t ?? null, firstLit: lit[0]?.t ?? null, lastLit: lit.at(-1)?.t ?? null };
}
export function seasonCalc(w: World, b: Bld, e: Eye, i: number): Season {
  const d = dayCalc(w, b, e, SEASONS[i].date);
  return { ...SEASONS[i], sun: d.sun, daylight: d.daylight, sunrise: d.sunrise, sunset: d.sunset };
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

// --- Годовое солнце окна по BRE 209 ------------------------------------------
// BRE «Site layout planning for daylight and sunlight»: главное окно жилой комнаты, обращённое
// не дальше 90° от юга, должно получать в центре окна ≥ 25 % годовых вероятных часов солнца (APSH),
// из них ≥ 5 % — с 21 сентября по 21 марта. Обе доли — от годовых часов на открытом месте.
// «Вероятные» учитывают облачность: вес каждого часа — вероятность прямого солнца в этот день года
// (data/<id>/climate.json, PVGIS-SARAH3). Без неё — при ясном небе, доля от часов, когда солнце над горизонтом.
export const APSH_DAY_STEP = 10; // дней между отсчётами; середины отрезков, вес — длина отрезка
export const BRE = { year: 25, winter: 5 }; // %
const doy = (m: number, d: number) => (Date.UTC(YEAR, m, d) - Date.UTC(YEAR, 0, 1)) / 864e5;
const WINTER_FROM = doy(8, 21), WINTER_TO = doy(2, 21);

// Солнце над горизонтом за год в точке здания: отсчёты, вес в часах, зимнее ли полугодие.
// Одна таблица на здание — общая для всех его окон.
export type SunYear = { suns: Sun[]; hours: number[]; winter: boolean[]; total: number };
export function sunYear(b: Bld, sunshine: number[] | null = null, step = APSH_DAY_STEP): SunYear {
  const y: SunYear = { suns: [], hours: [], winter: [], total: 0 };
  for (let d0 = 0; d0 < 365; d0 += step) {
    const days = Math.min(step, 365 - d0), d = d0 + Math.floor(days / 2);
    for (let i = 0; i < N; i++) {
      const s = sunAt(new Date(Date.UTC(YEAR, 0, 1 + d) + i * STEP_MIN * 60000), b.center[0], b.center[1]);
      if (s.altitude <= 0) continue;
      const h = ((days * STEP_MIN) / 60) * (sunshine ? sunshineAt(sunshine, new Date(Date.UTC(YEAR, 0, 1 + d))) : 1);
      y.suns.push(s); y.hours.push(h); y.winter.push(d >= WINTER_FROM || d < WINTER_TO); y.total += h;
    }
  }
  return y;
}

// Доли года и зимнего полугодия, целые %: «оценка 0–100» — это доля года.
export type Annual = { year: number; winter: number };
// Горизонт — по азимутам через 1°, каждый считается при первом отсчёте солнца в нём.
export function annualSun(w: World, b: Bld, e: Eye, y = sunYear(b, w.sunshine)): Annual {
  const hor = new Float32Array(360).fill(NaN);
  let year = 0, winter = 0;
  y.suns.forEach((s, i) => {
    if (!facing(e, s.bearing)) return;
    const a = Math.round((s.bearing * 180) / Math.PI) % 360;
    if (Number.isNaN(hor[a])) hor[a] = horizonTan(w, b, e.x, e.y, e.z, (a * Math.PI) / 180);
    if (Math.tan(s.altitude) < hor[a]) return;
    year += y.hours[i];
    if (y.winter[i]) winter += y.hours[i];
  });
  return { year: Math.round((100 * year) / y.total), winter: Math.round((100 * winter) / y.total) };
}

// Вердикт по BRE. «На грани» — наше: не дотягивает, но обе доли не ниже 80 % порога.
export type Verdict = 'pass' | 'edge' | 'fail';
export const verdict = ({ year, winter }: Annual): Verdict =>
  year >= BRE.year && winter >= BRE.winter ? 'pass' : year >= 0.8 * BRE.year && winter >= 0.8 * BRE.winter ? 'edge' : 'fail';

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

// Вид из окна фасада: кадр VIEW_H° по горизонтали (шаг 2°) и ±VIEW_V° по вертикали от горизонта (шаг 1° —
// полоса моря у горизонта узкая). Клетка — что видит луч (HIT), строка 0 — верх кадра, столбец 0 — левый край.
// Доли — от числа лучей (в полосе ±20° это почти доли телесного угла).
export const VIEW_H = 64, VIEW_V = 20; // градусы
export function windowView(w: World, b: Bld, e: Eye) {
  const cols = VIEW_H / 2 + 1, rows = 2 * VIEW_V + 1, rad = Math.PI / 180;
  const data = new Uint8Array(cols * rows);
  let sea = 0, sky = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const v = rayHit(w, b, e.x, e.y, e.z, (e.normal ?? 0) + (c * 2 - VIEW_H / 2) * rad, (VIEW_V - r) * rad);
    data[r * cols + c] = v;
    if (v === HIT.sea) sea++;
    else if (v === HIT.sky) sky++;
  }
  return { cols, rows, data, sea: sea / data.length, sky: sky / data.length };
}

// Матрица «этажи × фасады»: годовая оценка по BRE (доля года и зимнего полугодия, %) и число лучей с морем.
// Клетка k = (этаж − 1) × cols + фасад.
export function facadeMatrix(w: World, b: Bld, floors = b.floors) {
  const fs = facades(w, b), cols = fs.length, y = sunYear(b, w.sunshine);
  const score = new Uint8Array(floors * cols), winter = new Uint8Array(floors * cols), sea = new Uint8Array(floors * cols);
  for (let fl = 1; fl <= floors; fl++) fs.forEach((f, c) => {
    const k = (fl - 1) * cols + c, a = annualSun(w, b, eye(w, b, fl, f), y);
    score[k] = a.year;
    winter[k] = a.winter;
    sea[k] = facadeSea(w, b, f, fl);
  });
  return { floors, cols, score, winter, sea };
}

// Лучшая клетка: максимум годовой оценки, при равенстве — больше моря, затем выше этаж.
// −1, если сравнивать нечего: ни солнца, ни моря ни в одной клетке.
export function bestCell({ cols, score, sea }: { cols: number; score: ArrayLike<number>; sea: ArrayLike<number> }) {
  let best = -1;
  for (let k = 0; k < score.length; k++) {
    if (!score[k] && !sea[k]) continue;
    if (best < 0 || score[k] > score[best] || (score[k] === score[best] && (sea[k] > sea[best] || (sea[k] === sea[best] && Math.floor(k / cols) > Math.floor(best / cols))))) best = k;
  }
  return best;
}

// Годовая оценка окна из матрицы: фасад side на этаже floor; side = null — здание целиком, тогда лучший фасад этажа,
// а среди нормируемых BRE (если такие есть) — лучший из них. BRE нормирует только окна, повёрнутые не дальше 90°
// от юга; для остальных оценка 0–100 остаётся, вердикта нет. null — этажа нет в матрице.
export const breAssessed = (normal: number) => Math.cos(normal) <= 0;
export function breCell(m: { floors: number; cols: number; score: ArrayLike<number>; winter: ArrayLike<number> }, normals: number[], floor: number, side: number | null) {
  if (floor > m.floors) return null;
  const row = (floor - 1) * m.cols;
  let c = side ?? -1;
  if (c < 0) {
    const pool = normals.map((_, i) => i).filter((i) => breAssessed(normals[i]));
    for (const i of pool.length ? pool : normals.map((_, i) => i)) if (c < 0 || m.score[row + i] > m.score[row + c]) c = i;
  }
  const a = { year: m.score[row + c], winter: m.winter[row + c] };
  return { c, a, v: normals[c] != null && breAssessed(normals[c]) ? verdict(a) : ('na' as const) };
}

// --- Надёжность результата для здания ------------------------------------------
// Причины, известные из сверок: этажность предположена; крутой склон — перепад DEM больше 30 м
// в квадрате ±60 м, отметка глаза на сетке 60 м неточна и горизонт вверх по склону завышен
// (docs/horizon-check.md, п. 4); деревья выше крыши в 20 м от описанной окружности — кроны из спутниковой модели
// (ошибка ~3 м, листва по сезонам не учтена), а влияют на все этажи. Деревья ниже крыши у дома почти везде.
// Нет причин — высокая, одна — средняя, две и больше — низкая.
export type Reason = 'assumed' | 'plan' | 'slope' | 'trees';
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
  else if (b.levelsSrc === 'plan') reasons.push('plan'); // съёмка плана старая, надстройки с тех пор не учтены
  if (drop > SLOPE_DROP) reasons.push('slope');
  if (treesNear(w, b, TREES_R)) reasons.push('trees');
  return { level: reasons.length === 0 ? 'high' : reasons.length === 1 ? 'medium' : 'low', reasons, drop };
}

// Есть ли ячейка деревьев выше крыши здания на расстоянии до d от его описанной окружности.
function treesNear(w: World, b: Bld, d: number): boolean {
  const { x0, y0, cols, rows, idx, z } = w.roofs;
  const roof = b.ground + b.h;
  const R = b.radius + d;
  const c0 = Math.max(0, Math.floor((b.xy[0] - R - x0) / BCELL)), c1 = Math.min(cols - 1, Math.floor((b.xy[0] + R - x0) / BCELL));
  const r0 = Math.max(0, Math.floor((b.xy[1] - R - y0) / BCELL)), r1 = Math.min(rows - 1, Math.floor((b.xy[1] + R - y0) / BCELL));
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    if ((idx[r * cols + c] !== TREE && idx[r * cols + c] !== DECID) || z[r * cols + c] <= roof) continue;
    if (Math.hypot(x0 + (c + 0.5) * BCELL - b.xy[0], y0 + (r + 0.5) * BCELL - b.xy[1]) <= R) return true;
  }
  return false;
}

// --- Массовые расчёты для карты (все здания) ---------------------------------
// Высота окна над землёй для карт, м. Этаж — тот, чьё окно ближе всего к высоте; дом ниже — верхний этаж.
export const HEIGHTS = [2, 5, 10];
export const floorAt = (w: { city: City }, h: number) => Math.max(1, Math.round(h / w.city.floorHeight + 0.5));
const floorFor = (w: World, b: Bld, h: number) => Math.min(b.floors, floorAt(w, h));

// Часы солнца в окнах (здание целиком) для зданий from..to в день date.
export function massSun(w: World, date: Date, h: number, from: number, to: number, out: Float32Array) {
  for (let i = from; i < to; i++) {
    const b = w.blds[i];
    out[i] = dayCalc(w, b, eye(w, b, floorFor(w, b, h), null), date).sun;
  }
}
// Сколько румбов с морем.
export function massSea(w: World, h: number, from: number, to: number, out: Uint8Array) {
  for (let i = from; i < to; i++) {
    const b = w.blds[i];
    out[i] = seaRose(w, b, floorFor(w, b, h)).filter((s) => s.dist != null).length;
  }
}
