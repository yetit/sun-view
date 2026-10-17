// Лимиты размера после сборки (gzip -9): стартовый JS — точка входа со статическими импортами,
// чанк карты (MapLibre и интерфейс, грузится динамически), воркер и данные каждого города.
// Падает, если что-то вышло за бюджет: незаметно вернуть MapLibre в стартовый бандл или раздуть данные.
// Запуск: npm run build && node scripts/check-size.mjs
import { readdirSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { cities } from '../cities.config.mjs';

const KB = 1000;
const BUDGET = { start: 30 * KB, map: 320 * KB, worker: 10 * KB, city: 900 * KB };
const gz = (path) => gzipSync(readFileSync(path), { level: 9 }).length;
const kb = (n) => `${(n / KB).toFixed(0)} КБ`;

const html = readFileSync('dist/index.html', 'utf8');
const entry = html.match(/<script type="module" src="[^"]*\/_astro\/([^"]+)"/)[1];
const seen = new Set(), queue = [entry];
while (queue.length) {
  const f = queue.pop();
  if (seen.has(f)) continue;
  seen.add(f);
  for (const [, dep] of readFileSync(`dist/_astro/${f}`, 'utf8').matchAll(/import\s*(?:[\w*{}\s,$]*from\s*)?["']\.\/([^"']+\.js)["']/g)) queue.push(dep);
}
const files = readdirSync('dist/_astro');
const sum = (list) => list.reduce((a, f) => a + gz(`dist/_astro/${f}`), 0);
const rows = [
  ['стартовый JS', sum([...seen]), BUDGET.start],
  ['чанк карты', sum(files.filter((f) => /^start\.[\w-]+\.js$/.test(f))), BUDGET.map],
  ['воркер', sum(files.filter((f) => /^worker-[\w-]+\.js$/.test(f))), BUDGET.worker],
];
const DATA = ['buildings.bin', 'buildings.meta.json', 'canopy.bin', 'canopy.json', 'dem.bin', 'dem.json', 'precomputed.bin', 'precomputed.json', 'climate.json'];
for (const c of cities) {
  const own = DATA.map((f) => `data/${c.id}/${f}`).filter((p) => { try { readFileSync(p); return true; } catch { return false; } });
  rows.push([`данные ${c.id}`, own.reduce((a, p) => a + gz(p), 0), BUDGET.city]);
}
let bad = 0;
for (const [name, size, max] of rows) {
  const over = size > max;
  bad += over;
  console.log(`${over ? '✗' : '✓'} ${name}: ${kb(size)} из ${kb(max)}`);
}
if (bad) { console.error(`За бюджетом: ${bad}`); process.exit(1); }
