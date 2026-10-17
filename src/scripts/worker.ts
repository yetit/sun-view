// Тяжёлые расчёты вне главного потока: карта солнца/моря для всех зданий, лента года, вид из окна и матрица «этажи × фасады».
import { unpackBuildings, type BuildingsMeta } from './buildings-bin.ts';
import { createWorld, facades, type World } from './grid.ts';
import { eye, facadeMatrix, massSea, massSun, windowView, yearRibbon } from './analysis.ts';

let w: World;
const CHUNK = 150;

export type Req =
  | { type: 'init'; id: number; city: any; bldMeta: BuildingsMeta; bldBuf: ArrayBuffer; greenery: any; demMeta: any; demBuf: ArrayBuffer }
  | { type: 'sun'; id: number; season: number; h: number }
  | { type: 'sea'; id: number; h: number }
  | { type: 'ribbon'; id: number; idx: number; floor: number; side: number | null } // side — номер фасада
  | { type: 'view'; id: number; idx: number; floor: number; side: number }
  | { type: 'matrix'; id: number; idx: number; floors: number }; // floors — с учётом уточнения пользователем

self.onmessage = async ({ data: m }: MessageEvent<Req>) => {
  if (m.type === 'init') { w = createWorld(m.city, unpackBuildings(m.bldMeta, m.bldBuf), m.greenery, m.demMeta, m.demBuf); self.postMessage({ id: m.id, done: true, roofs: w.roofs }); return; } // копия растра — странице
  if (m.type === 'ribbon') {
    const b = w.blds[m.idx];
    const r = yearRibbon(w, b, eye(w, b, m.floor, m.side == null ? null : facades(w, b)[m.side] ?? null));
    self.postMessage({ id: m.id, done: true, ...r }, { transfer: [r.data.buffer] });
    return;
  }
  if (m.type === 'view') {
    const b = w.blds[m.idx];
    const r = windowView(w, b, eye(w, b, m.floor, facades(w, b)[m.side]));
    self.postMessage({ id: m.id, done: true, ...r }, { transfer: [r.data.buffer] });
    return;
  }
  if (m.type === 'matrix') {
    const r = facadeMatrix(w, w.blds[m.idx], m.floors);
    self.postMessage({ id: m.id, done: true, ...r }, { transfer: [r.sun.buffer, r.sea.buffer] });
    return;
  }
  const n = w.blds.length;
  const out = m.type === 'sun' ? new Float32Array(n) : new Uint8Array(n);
  for (let i = 0; i < n; i += CHUNK) {
    if (m.type === 'sun') massSun(w, m.season, m.h, i, Math.min(i + CHUNK, n), out as Float32Array);
    else massSea(w, m.h, i, Math.min(i + CHUNK, n), out as Uint8Array);
    self.postMessage({ id: m.id, progress: Math.min(i + CHUNK, n), total: n });
    await new Promise((r) => setTimeout(r)); // дать очереди сообщений продвинуться
  }
  self.postMessage({ id: m.id, done: true, data: out }, { transfer: [out.buffer] });
};
