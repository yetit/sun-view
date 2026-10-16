// Предрасчёт карт «солнце» и «море» для всех зданий города → data/<id>/precomputed.bin + .json,
// чтобы карта красилась сразу при входе, без 2–3 секунд расчёта в воркере.
// Заодно печатает кандидатов для примеров (cities.config.mjs → examples).
// Запуск: node scripts/precompute.ts <id> (Node ≥ 22.18, типы снимаются сам Node).
import { readFileSync, writeFileSync } from 'node:fs';
import { getCity } from '../cities.config.mjs';
import { eye, massSea, massSun, seaRose, seasonCalc, type FloorMode } from '../src/scripts/analysis.ts';
import { createWorld, type City } from '../src/scripts/grid.ts';

const city = getCity(process.argv[2]) as City;
const dir = `data/${city.id}`;
const json = (name: string) => JSON.parse(readFileSync(`${dir}/${name}.json`, 'utf8'));
const bin = readFileSync(`${dir}/dem.bin`);
const w = createWorld(city, json('buildings'), json('greenery'), json('dem'), bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
const n = w.blds.length;

// Слои: sun:<сезон>:<этаж> — доля светового дня в процентах (0..100), sea:<этаж> — направлений с морем (0..8).
const MODES: FloorMode[] = ['1', 'mid', 'top'];
const layers: string[] = [];
const out: Uint8Array[] = [];
const t0 = Date.now();
for (let s = 0; s < 4; s++) for (const m of MODES) {
  const a = new Float32Array(n);
  massSun(w, s, m, 0, n, a);
  out.push(Uint8Array.from(a, (v) => Math.round(v * 100)));
  layers.push(`sun:${s}:${m}`);
}
for (const m of MODES) {
  const a = new Uint8Array(n);
  massSea(w, m, 0, n, a);
  out.push(a);
  layers.push(`sea:${m}`);
}
const buf = new Uint8Array(out.length * n);
out.forEach((a, i) => buf.set(a, i * n));
writeFileSync(`${dir}/precomputed.bin`, buf);
writeFileSync(`${dir}/precomputed.json`, JSON.stringify({ buildings: n, layers, computed: new Date().toISOString().slice(0, 10) }));
console.log(`${city.id}: ${layers.length} слоёв × ${n} зданий за ${((Date.now() - t0) / 1000).toFixed(1)} с, ${buf.length} байт`);

// --- Кандидаты в примеры ------------------------------------------------------
const known = w.blds.filter((b) => !b.assumed && b.floors >= 3);
const sea = (i: number) => out[layers.indexOf('sea:top')][i];
const sunW = (i: number, m: FloorMode) => out[layers.indexOf(`sun:3:${m}`)][i];
const top = (list: typeof known, key: (b: (typeof known)[0]) => number) => [...list].sort((a, b) => key(b) - key(a)).slice(0, 4);
const describe = (b: (typeof known)[0], floor: number, side: number | null, season: number) => {
  const r = seasonCalc(w, b, eye(w, b, floor, side), season);
  const rose = seaRose(w, b, floor).filter((d) => d.dist != null).map((d) => d.dir).join(' ');
  return `${b.id} «${b.name ?? ''}» ${b.floors} эт., земля ${b.ground} м · этаж ${floor} сторона ${side ?? 'все'} сезон ${season}: ${r.sun.toFixed(1)} ч из ${r.daylight.toFixed(1)}; море: ${rose || '—'}`;
};
console.log('\nВид на море с верхнего этажа:');
for (const b of top(known, (b) => sea(b.idx) * 100 + b.floors)) console.log(' ', describe(b, b.floors, null, 1));
console.log('Зимой в тени (средний этаж):');
for (const b of top(known, (b) => -sunW(b.idx, 'mid'))) console.log(' ', describe(b, Math.ceil(b.floors / 2), null, 3));
console.log('Солнце весь зимний день (верхний этаж):');
for (const b of top(known, (b) => sunW(b.idx, 'top') * 100 + b.floors)) console.log(' ', describe(b, b.floors, null, 3));
