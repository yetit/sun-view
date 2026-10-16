// Тяжёлые расчёты вне главного потока: карта солнца/моря для всех зданий и лента года.
import { createWorld, type World } from './grid.ts';
import { eye, massSea, massSun, yearRibbon, type FloorMode } from './analysis.ts';

let w: World;
const CHUNK = 150;

export type Req =
  | { type: 'init'; city: any; geojson: any; greenery: any; demMeta: any; demBuf: ArrayBuffer }
  | { type: 'sun'; id: number; season: number; mode: FloorMode }
  | { type: 'sea'; id: number; mode: FloorMode }
  | { type: 'ribbon'; id: number; idx: number; floor: number; side: number | null };

self.onmessage = async ({ data: m }: MessageEvent<Req>) => {
  if (m.type === 'init') { w = createWorld(m.city, m.geojson, m.greenery, m.demMeta, m.demBuf); return; }
  if (m.type === 'ribbon') {
    const r = yearRibbon(w, w.blds[m.idx], eye(w, w.blds[m.idx], m.floor, m.side));
    self.postMessage({ id: m.id, done: true, ...r }, { transfer: [r.data.buffer] });
    return;
  }
  const n = w.blds.length;
  const out = m.type === 'sun' ? new Float32Array(n) : new Uint8Array(n);
  for (let i = 0; i < n; i += CHUNK) {
    if (m.type === 'sun') massSun(w, m.season, m.mode, i, Math.min(i + CHUNK, n), out as Float32Array);
    else massSea(w, m.mode, i, Math.min(i + CHUNK, n), out as Uint8Array);
    self.postMessage({ id: m.id, progress: Math.min(i + CHUNK, n), total: n });
    await new Promise((r) => setTimeout(r)); // дать очереди сообщений продвинуться
  }
  self.postMessage({ id: m.id, done: true, data: out }, { transfer: [out.buffer] });
};
