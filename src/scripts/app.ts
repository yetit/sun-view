// Общее состояние приложения: город и параметры из URL, мир, воркер, форматтеры.
import { getCity } from '../../cities.config.mjs';
import { SEASONS, type FloorMode } from './analysis.ts';
import type { Bld, City, World } from './grid.ts';
import type { Mode } from './style.ts';
import { t } from './i18n.ts';

export const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
export const $$ = <T extends HTMLElement>(sel: string) => [...document.querySelectorAll<T>(sel)];
export const BASE = import.meta.env.BASE_URL;

export const params = new URL(location.href).searchParams;
export const num = (v: string | null, d: number) => (v != null && Number.isFinite(+v) ? +v : d);
export const city = getCity(params.get('c') ?? '') as City;

export const fmtH = new Intl.NumberFormat(t.locale, { maximumFractionDigits: 1 });
export const fmtT = new Intl.DateTimeFormat(t.locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: city.timezone });

const pick = <T extends string>(v: string | null, ok: readonly T[], d: T) => (ok.includes(v as T) ? (v as T) : d);
export const state = {
  current: null as Bld | null,
  floor: 1,
  side: (params.get('d') != null ? num(params.get('d'), 0) : null) as number | null, // румб фасада или всё здание
  season: Math.min(3, Math.max(0, num(params.get('s'), 3))),
  hour: Math.min(22, Math.max(4, num(params.get('t'), 11))), // местное время, ч
  mode: pick<Mode>(params.get('m'), ['normal', 'sea'], 'sun'), // на входе город сразу окрашен
  floorMode: pick<FloorMode>(params.get('fm'), ['1', 'mid', 'top'], 'mid'),
  floorsOverride: params.get('n') != null ? num(params.get('n'), 0) || null : null, // этажность, уточнённая пользователем
};

export function syncUrl() {
  const { current, floor, side, season, hour, mode, floorMode, floorsOverride } = state;
  const p = new URLSearchParams({ c: city.id, s: String(season), t: hour.toFixed(2), m: mode });
  if (mode !== 'normal') p.set('fm', floorMode);
  if (current) { p.set('b', String(current.id)); p.set('f', String(floor)); if (side != null) p.set('d', String(side)); if (floorsOverride) p.set('n', String(floorsOverride)); }
  if (params.get('lang')) p.set('lang', params.get('lang')!);
  history.replaceState(null, '', `?${p}`);
}

// Смещение часового пояса города от UTC на дату, ч.
export function tzOffset(d: Date) {
  const at = (tz: string) => new Date(d.toLocaleString('en-US', { timeZone: tz })).getTime();
  return (at(city.timezone) - at('UTC')) / 36e5;
}
export const sliderTime = () => new Date(SEASONS[state.season].date.getTime() + (state.hour - tzOffset(SEASONS[state.season].date)) * 36e5);

// Мир и исходный GeoJSON зданий — после загрузки данных.
export let world: World;
export let geojson: any;
export function setWorld(w: World, g: any) { world = w; geojson = g; }

// Тяжёлые расчёты — в воркере со своей копией мира.
let worker: Worker;
let reqId = 0;
const pending = new Map<number, { resolve: (v: any) => void; onProgress?: (p: number, t: number) => void }>();
export function startWorker(init: object) {
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data: m }) => {
    const p = pending.get(m.id);
    if (!p) return;
    if (m.done) { pending.delete(m.id); p.resolve(m); } else p.onProgress?.(m.progress, m.total);
  };
  return ask({ type: 'init', ...init }); // ждёт, пока воркер построит свой мир
}
export const ask = (msg: object, onProgress?: (p: number, t: number) => void) =>
  new Promise<any>((resolve) => { const id = ++reqId; pending.set(id, { resolve, onProgress }); worker.postMessage({ ...msg, id }); });
