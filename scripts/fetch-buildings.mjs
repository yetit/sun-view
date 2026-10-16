// Здания и зелень города из OSM (Overpass) → data/<id>/buildings.json и greenery.json (GeoJSON).
// Запуск: node scripts/fetch-buildings.mjs <id>. Данные коммитятся, сайт в рантайме Overpass не дёргает.
import { mkdirSync, writeFileSync } from 'node:fs';
import { getCity } from '../cities.config.mjs';
import { bboxStr, overpass, ring } from './overpass.mjs';

const city = getCity(process.argv[2]);
const bb = bboxStr(city.bbox);
const num = (v) => (v != null && /^\d+([.,]\d+)?/.test(v.trim()) ? parseFloat(v.replace(',', '.')) : null);

// Полигоны из way и мультиполигонов (внешние кольца; дыры для прототипа не нужны).
function polygons(elements, props) {
  const features = [];
  for (const e of elements) {
    if (e.type === 'way' && e.geometry?.length > 3) {
      features.push({ type: 'Feature', id: e.id, properties: props(e), geometry: { type: 'Polygon', coordinates: [ring(e.geometry)] } });
    } else if (e.type === 'relation') {
      const outers = (e.members ?? []).filter((m) => m.role === 'outer' && m.geometry?.length > 3).map((m) => ring(m.geometry));
      if (outers.length) features.push({ type: 'Feature', id: e.id, properties: props(e), geometry: { type: 'MultiPolygon', coordinates: outers.map((r) => [r]) } });
    }
  }
  return features;
}
const fc = (features, extra) => JSON.stringify({ type: 'FeatureCollection', source: 'OpenStreetMap, Overpass API, ODbL', fetched: new Date().toISOString().slice(0, 10), ...extra, features });

mkdirSync(`data/${city.id}`, { recursive: true });

const addr = (t) => (t['addr:street'] ? [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(' ') : null);
const buildings = polygons(
  await overpass(`[out:json][timeout:180];(way["building"](${bb});relation["building"]["type"="multipolygon"](${bb}););out geom tags;`),
  (e) => ({ id: e.id, levels: num(e.tags['building:levels']), height: num(e.tags.height), name: e.tags.name ?? null, addr: addr(e.tags), building: e.tags.building }),
);

// Здания без адреса подписываем ближайшей улицей (не дальше 120 м от центра контура).
const streets = await overpass(`[out:json][timeout:180];way["highway"]["name"](${bb});out geom tags;`);
const kx = Math.cos((((city.bbox.south + city.bbox.north) / 2) * Math.PI) / 180) * 111320, ky = 111320;
const segs = streets.flatMap((w) => w.geometry.slice(1).map((p, i) => [w.geometry[i].lon * kx, w.geometry[i].lat * ky, p.lon * kx, p.lat * ky, w.tags.name]));
const dist2 = (x, y, [ax, ay, bx, by]) => {
  const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
  return (ax + t * dx - x) ** 2 + (ay + t * dy - y) ** 2;
};
let named = 0;
for (const f of buildings) {
  if (f.properties.addr) continue;
  const pts = f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : f.geometry.coordinates.flatMap((p) => p[0]);
  const x = (pts.reduce((s, p) => s + p[0], 0) / pts.length) * kx, y = (pts.reduce((s, p) => s + p[1], 0) / pts.length) * ky;
  let best = 120 ** 2, name = null;
  for (const sg of segs) { if (Math.abs(sg[0] - x) > 400 || Math.abs(sg[1] - y) > 400) continue; const d = dist2(x, y, sg); if (d < best) { best = d; name = sg[4]; } }
  f.properties.street = name;
  if (name) named++;
}
writeFileSync(`data/${city.id}/buildings.json`, fc(buildings, { bbox: city.bbox }));
console.log(`${city.id}: ${buildings.length} зданий, с этажностью или высотой: ${buildings.filter((f) => f.properties.levels ?? f.properties.height).length}, с адресом: ${buildings.filter((f) => f.properties.addr).length}, у улицы: ${named}`);

// Деревья: леса и парки как препятствия высотой city.treeHeight (в DSM они уже есть, но сетка там грубая).
const green = polygons(
  await overpass(`[out:json][timeout:180];(way["natural"="wood"](${bb});way["landuse"="forest"](${bb});way["leisure"="park"](${bb});relation["natural"="wood"](${bb});relation["landuse"="forest"](${bb});relation["leisure"="park"](${bb}););out geom tags;`),
  (e) => ({ id: e.id, kind: e.tags.natural ?? e.tags.landuse ?? e.tags.leisure }),
);
writeFileSync(`data/${city.id}/greenery.json`, fc(green, {}));
console.log(`${city.id}: ${green.length} зелёных массивов`);
