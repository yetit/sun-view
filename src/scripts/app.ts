// Общее состояние приложения: город и параметры из URL, мир, воркер, форматтеры.
import { getCity } from '../../cities.config.mjs';
import { HEIGHTS, SEASONS } from './analysis.ts';
import { facades, type Bld, type City, type Facade, type World } from './grid.ts';
import type { Mode } from './style.ts';
import { t } from './i18n.ts';

export const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
export const $$ = <T extends HTMLElement>(sel: string) => [...document.querySelectorAll<T>(sel)];
export const BASE = import.meta.env.BASE_URL;

export const params = new URL(location.href).searchParams;
export const num = (v: string | null, d: number) => (v != null && Number.isFinite(+v) ? +v : d);
export const city = getCity(params.get('c') ?? '') as City;
// ?embed=1 — только карта и компактная панель для <iframe> (см. /embed).
export const embed = params.get('embed') === '1';

export const fmtH = new Intl.NumberFormat(t.locale, { maximumFractionDigits: 1 });
export const fmtT = new Intl.DateTimeFormat(t.locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: city.timezone });

// fm — высота окна на картах, м; старые ссылки с этажами 1/mid/top — на ближайшую высоту.
const legacyFm: Record<string, number> = { '1': 2, mid: 2, top: 5 };
const fm = params.get('fm') ?? '';
// d — фасад: f<номер>; старые ссылки d=0..7 — румб, select() переводит его в ближайший фасад.
const d = params.get('d');
export const urlDir = d != null && /^[0-7]$/.test(d) ? +d : null;
const pick = <T extends string>(v: string | null, ok: readonly T[], d: T) => (ok.includes(v as T) ? (v as T) : d);
export const state = {
  current: null as Bld | null,
  floor: 1,
  side: (d?.[0] === 'f' ? num(d.slice(1), 0) : null) as number | null, // номер фасада или всё здание
  season: Math.min(3, Math.max(0, num(params.get('s'), 3))),
  hour: Math.min(22, Math.max(4, num(params.get('t'), 11))), // местное время, ч
  mode: pick<Mode>(params.get('m'), ['normal', 'sea'], 'sun'), // на входе город сразу окрашен
  height: legacyFm[fm] ?? (HEIGHTS.includes(+fm) ? +fm : 5),
  floorsOverride: params.get('n') != null ? num(params.get('n'), 0) || null : null, // этажность, уточнённая пользователем
};

export function syncUrl() {
  const { current, floor, side, season, hour, mode, height, floorsOverride } = state;
  const p = new URLSearchParams({ c: city.id, s: String(season), t: hour.toFixed(2), m: mode });
  if (mode !== 'normal') p.set('fm', String(height));
  if (current) { p.set('b', String(current.id)); p.set('f', String(floor)); if (side != null) p.set('d', `f${side}`); if (floorsOverride) p.set('n', String(floorsOverride)); }
  if (params.get('lang')) p.set('lang', params.get('lang')!);
  // Ссылка «Открыть в Sun & View» — то же состояние без embed.
  document.querySelector('.open-full')?.setAttribute('href', `${location.pathname}?${p}`);
  if (embed) p.set('embed', '1');
  history.replaceState(null, '', `?${p}`);
}

// Фасады текущего здания и выбранный фасад (null — здание целиком).
export const currentFacades = (): Facade[] => (state.current ? facades(world, state.current) : []);
export const facadeOf = () => (state.side == null ? null : currentFacades()[state.side] ?? null);

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
