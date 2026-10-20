// Тяжёлые расчёты вне главного потока: карта солнца/моря для всех зданий, лента года, вид из окна
// и матрица «этажи × фасады» с годовой оценкой окон по BRE.
import { unpackBuildings, type BuildingsMeta } from './buildings-bin.ts';
import { createWorld, facades, plannedWorld, type Canopy, type World } from './grid.ts';
import { eye, facadeMatrix, massSea, massSun, SEASONS, windowView, yearRibbon } from './analysis.ts';

let w: World, wp: World | null = null; // wp — мир с планируемыми объёмами, строится по первому запросу «после застройки»
const pick = (after?: boolean) => (after && w.planned ? (wp ??= plannedWorld(w, w.planned)) : w);
const CHUNK = 150;

export type Req =
  | { type: 'init'; id: number; city: any; bldMeta: BuildingsMeta; bldBuf: ArrayBuffer; canopy: Canopy | null; demMeta: any; demBuf: ArrayBuffer; sunshine: number[] | null; planned: { features: any[] } | null }
  | { type: 'sun'; id: number; season?: number; day?: number; h: number } // day — свой день (мс UTC) вместо сезона
  | { type: 'sea'; id: number; h: number }
  | { type: 'ribbon'; id: number; idx: number; floor: number; side: number | null; after?: boolean } // side — номер фасада
  | { type: 'view'; id: number; idx: number; floor: number; side: number; after?: boolean }
  | { type: 'matrix'; id: number; idx: number; floors: number; after?: boolean }; // floors — с учётом уточнения пользователем; after — «после застройки»

self.onmessage = async ({ data: m }: MessageEvent<Req>) => {
  if (m.type === 'init') { w = createWorld(m.city, unpackBuildings(m.bldMeta, m.bldBuf), m.canopy, m.demMeta, m.demBuf); w.sunshine = m.sunshine; w.planned = m.planned; self.postMessage({ id: m.id, done: true, roofs: w.roofs }); return; } // копия растра — странице
  if (m.type === 'ribbon') {
    const b = w.blds[m.idx], v = pick(m.after);
    const r = yearRibbon(v, b, eye(w, b, m.floor, m.side == null ? null : facades(w, b)[m.side] ?? null));
    self.postMessage({ id: m.id, done: true, ...r }, { transfer: [r.data.buffer] });
    return;
  }
  if (m.type === 'view') {
    const b = w.blds[m.idx];
    const r = windowView(pick(m.after), b, eye(w, b, m.floor, facades(w, b)[m.side]));
    self.postMessage({ id: m.id, done: true, ...r }, { transfer: [r.data.buffer] });
    return;
  }
  if (m.type === 'matrix') {
    const r = facadeMatrix(pick(m.after), w.blds[m.idx], m.floors);
    self.postMessage({ id: m.id, done: true, ...r }, { transfer: [r.score.buffer, r.winter.buffer, r.sea.buffer] });
    return;
  }
  const n = w.blds.length;
  const out = m.type === 'sun' ? new Float32Array(n) : new Uint8Array(n);
  for (let i = 0; i < n; i += CHUNK) {
    if (m.type === 'sun') massSun(w, m.day != null ? new Date(m.day) : SEASONS[m.season!].date, m.h, i, Math.min(i + CHUNK, n), out as Float32Array);
    else massSea(w, m.h, i, Math.min(i + CHUNK, n), out as Uint8Array);
    self.postMessage({ id: m.id, progress: Math.min(i + CHUNK, n), total: n });
    await new Promise((r) => setTimeout(r)); // дать очереди сообщений продвинуться
  }
  self.postMessage({ id: m.id, done: true, data: out }, { transfer: [out.buffer] });
};
