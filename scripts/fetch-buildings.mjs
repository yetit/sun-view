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

const buildings = polygons(
  await overpass(`[out:json][timeout:180];(way["building"](${bb});relation["building"]["type"="multipolygon"](${bb}););out geom tags;`),
  (e) => ({ id: e.id, levels: num(e.tags['building:levels']), height: num(e.tags.height), name: e.tags.name ?? null, building: e.tags.building }),
);
writeFileSync(`data/${city.id}/buildings.json`, fc(buildings, { bbox: city.bbox }));
console.log(`${city.id}: ${buildings.length} зданий, с этажностью или высотой: ${buildings.filter((f) => f.properties.levels ?? f.properties.height).length}`);

// Деревья: леса и парки как препятствия высотой city.treeHeight (в DSM они уже есть, но сетка там грубая).
const green = polygons(
  await overpass(`[out:json][timeout:180];(way["natural"="wood"](${bb});way["landuse"="forest"](${bb});way["leisure"="park"](${bb});relation["natural"="wood"](${bb});relation["landuse"="forest"](${bb});relation["leisure"="park"](${bb}););out geom tags;`),
  (e) => ({ id: e.id, kind: e.tags.natural ?? e.tags.landuse ?? e.tags.leisure }),
);
writeFileSync(`data/${city.id}/greenery.json`, fc(green, {}));
console.log(`${city.id}: ${green.length} зелёных массивов`);
