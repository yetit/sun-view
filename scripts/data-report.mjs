// Сводка свежей выгрузки против закоммиченной (HEAD) для описания PR: здания, этажность, примеры.
// Если у города поменялись только даты выгрузки — откатываем его файлы, чтобы не было пустого PR.
// Запуск после `npm run fetch -- <id>`: node scripts/data-report.mjs <id> [<id> …] > report.md
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { getCity } from '../cities.config.mjs';

const FILES = ['buildings.json', 'buildings.bin', 'buildings.meta.json', 'canopy.json', 'canopy.bin', 'dem.json', 'dem.bin', 'precomputed.json', 'precomputed.bin'];
const old = (path) => { try { return execFileSync('git', ['show', `HEAD:${path}`], { maxBuffer: 1 << 28 }); } catch { return null; } };
// Даты выгрузки и расчёта меняются каждый раз — сравниваем без них.
const strip = (buf) => buf && JSON.stringify({ ...JSON.parse(buf), fetched: null, computed: null });
const same = (a, b, f) => (f.endsWith('.json') ? strip(a) === strip(b) : a != null && a.equals(b));

const stats = (buf) => {
  const fs = buf ? JSON.parse(buf).features : [];
  return { n: fs.length, ids: new Set(fs.map((f) => f.properties.id)), known: fs.filter((f) => f.properties.levels ?? f.properties.height).length };
};
const pct = (s) => (s.n ? `${((s.known / s.n) * 100).toFixed(1)} %` : '—');
const delta = (a, b) => `${a} → ${b}${b === a ? '' : ` (${b > a ? '+' : ''}${b - a})`}`;

const rows = [];
for (const id of process.argv.slice(2)) {
  const city = getCity(id), dir = `data/${id}`;
  const changed = FILES.filter((f) => !same(old(`${dir}/${f}`), readFileSync(`${dir}/${f}`), f));
  if (!changed.length) {
    execFileSync('git', ['checkout', 'HEAD', '--', dir]);
    rows.push(`| ${city.nameEn} | без изменений | | | |`);
    continue;
  }
  const a = stats(old(`${dir}/buildings.json`)), b = stats(readFileSync(`${dir}/buildings.json`));
  const gone = [...a.ids].filter((x) => !b.ids.has(x)).length, added = [...b.ids].filter((x) => !a.ids.has(x)).length;
  const lost = city.examples.filter((e) => !b.ids.has(e.b)).map((e) => `**${e.b}** (${e.en})`);
  rows.push(`| ${city.nameEn} | ${delta(a.n, b.n)}, −${gone} / +${added} | ${pct(a)} → ${pct(b)} | ${lost.length ? `пропали: ${lost.join(', ')}` : `все ${city.examples.length} на месте`} | ${changed.join(', ')} |`);
}
console.log('| Город | Зданий было → стало, ушло / пришло | С этажностью или высотой | Примеры | Изменились файлы |');
console.log('|---|---|---|---|---|');
console.log(rows.join('\n'));
