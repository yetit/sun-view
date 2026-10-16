// Здания города из OSM (Overpass) → data/<id>/buildings.json (GeoJSON).
// Запускать вручную: данные коммитятся, сайт в рантайме Overpass не дёргает.
import { mkdirSync, writeFileSync } from 'node:fs';
import city from '../city.config.mjs';

const { south, west, north, east } = city.bbox;
const query = `[out:json][timeout:180];(way["building"](${south},${west},${north},${east});relation["building"]["type"="multipolygon"](${south},${west},${north},${east}););out geom tags;`;
const num = (v) => (v != null && /^\d+([.,]\d+)?/.test(v.trim()) ? parseFloat(v.replace(',', '.')) : null);

const res = await fetch(process.env.OVERPASS ?? 'https://overpass-api.de/api/interpreter', {
  method: 'POST',
  headers: { 'User-Agent': 'sun-view/0.1', Accept: 'application/json' },
  body: new URLSearchParams({ data: query }),
});
if (!res.ok) throw new Error(`Overpass ${res.status}: ${(await res.text()).slice(0, 300)}`);
const { elements } = await res.json();

const ring = (geom) => geom.map((p) => [+p.lon.toFixed(6), +p.lat.toFixed(6)]);
const features = [];
for (const e of elements) {
  const levels = num(e.tags['building:levels']);
  const height = num(e.tags.height);
  const props = { id: e.id, levels, height, name: e.tags.name ?? null, building: e.tags.building };
  if (e.type === 'way' && e.geometry?.length > 3) {
    features.push({ type: 'Feature', id: e.id, properties: props, geometry: { type: 'Polygon', coordinates: [ring(e.geometry)] } });
  } else if (e.type === 'relation') {
    // Мультиполигон: внешние кольца с замкнутой геометрией; дыры для прототипа не нужны.
    const outers = (e.members ?? []).filter((m) => m.role === 'outer' && m.geometry?.length > 3).map((m) => ring(m.geometry));
    if (outers.length) features.push({ type: 'Feature', id: e.id, properties: props, geometry: { type: 'MultiPolygon', coordinates: outers.map((r) => [r]) } });
  }
}

mkdirSync(`data/${city.id}`, { recursive: true });
writeFileSync(
  `data/${city.id}/buildings.json`,
  JSON.stringify({ type: 'FeatureCollection', source: 'OpenStreetMap, Overpass API, ODbL', fetched: new Date().toISOString().slice(0, 10), bbox: city.bbox, features }),
);
console.log(`${features.length} зданий, с этажностью или высотой: ${features.filter((f) => f.properties.levels ?? f.properties.height).length}`);
