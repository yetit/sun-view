// Где не хватает этажности: дома без building:levels/height, по убыванию влияния на соседей
// (метрика — src/scripts/levels.ts). В OSM скрипт ничего не правит — только готовит список для обхода.
// Запуск: node scripts/levels-todo.mjs <id>; входит в npm run fetch.
//   data/<id>/levels.json            — слой «Этажность» на карте (по OSM id, чтобы обновление данных его не ломало)
//   docs/levels-todo/<id>.geojson    — задачи для MapRoulette: контур, ссылка на объект, приоритет
//                                       (инструкция задачи — одна на челлендж, см. docs/levels-todo/README.md)
//   docs/levels-todo/<id>.csv        — топ-100 для обхода
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { getCity } from '../cities.config.mjs';
import { unpackBuildings } from '../src/scripts/buildings-bin.ts';
import { createWorld } from '../src/scripts/grid.ts';
import { HIGH, levelsTodo, LOW, RADIUS } from '../src/scripts/levels.ts';

const city = getCity(process.argv[2]);
const dir = `data/${city.id}`;
const json = (n) => JSON.parse(readFileSync(`${dir}/${n}.json`, 'utf8'));
const ab = (n) => { const b = readFileSync(`${dir}/${n}.bin`); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const geojson = unpackBuildings(json('buildings.meta'), ab('buildings'));
const w = createWorld(city, geojson, json('greenery'), json('dem'), ab('dem'));
const t0 = Date.now();
const todo = levelsTodo(w).filter((r) => r.windows > 0);
const date = new Date().toISOString().slice(0, 10);

writeFileSync(`${dir}/levels.json`, JSON.stringify({
  computed: date, low: LOW, high: HIGH, radius: RADIUS,
  // [OSM id, соседей с изменившимся ответом, Σ часов зимнего солнца × 10, Σ направлений с морем]
  items: todo.map((r) => [w.blds[r.idx].id, r.windows, Math.round(r.sunH * 10), r.sea]),
}));

const label = (p) => p.name ?? p.addr ?? (p.street ? `${p.building && p.building !== 'yes' ? p.building : 'building'} near ${p.street}` : p.building && p.building !== 'yes' ? p.building : 'building');
const priority = (n) => (n >= 6 ? 'high' : n >= 3 ? 'medium' : 'low');
mkdirSync('docs/levels-todo', { recursive: true });
const features = todo.map((r, i) => {
  const b = w.blds[r.idx], f = geojson.features[r.idx], p = f.properties;
  return {
    type: 'Feature',
    geometry: f.geometry,
    properties: {
      '@id': `${b.osmType}/${b.id}`, osm_url: `https://www.openstreetmap.org/${b.osmType}/${b.id}`, rank: i + 1, priority: priority(r.windows),
      label: label(p), building: p.building ?? null, neighbours_affected: r.windows, winter_sun_hours: +r.sunH.toFixed(1), sea_directions: r.sea, neighbours: r.neighbours,
    },
  };
});
writeFileSync(`docs/levels-todo/${city.id}.geojson`, JSON.stringify({ type: 'FeatureCollection', name: `Sun & View: building:levels in ${city.nameEn ?? city.id}`, computed: date, features }));

const esc = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const rows = features.slice(0, 100).map((f) => {
  const p = f.properties, b = w.blds[todo[p.rank - 1].idx];
  return [p.rank, p.osm_url, p.label, p.building, p.neighbours_affected, p.winter_sun_hours, p.sea_directions, p.neighbours, b.center[0].toFixed(6), b.center[1].toFixed(6)].map(esc).join(',');
});
writeFileSync(`docs/levels-todo/${city.id}.csv`, ['rank,osm,label,building,neighbours_affected,winter_sun_hours,sea_directions,neighbours,lon,lat', ...rows].join('\n') + '\n');
console.log(`${city.id}: без этажности ${w.blds.filter((b) => b.assumed).length}, влияют на соседей ${todo.length} — за ${((Date.now() - t0) / 1000).toFixed(0)} с`);
console.log(rows.slice(0, 5).join('\n'));
