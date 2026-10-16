import { Map, NavigationControl, setWorkerUrl, type MapGeoJSONFeature } from 'maplibre-gl';
import city from '../../city.config.mjs';
import { analyze, type Result } from './analysis';
import { decodeDem, prepareBuildings, rasterizeRoofs, toXY, type Bld, type World } from './grid';
import { style } from './style';

// Данные города подхватываются по id из конфига: data/<id>/{buildings,dem}.json.
const files = import.meta.glob<any>('../../data/*/*.json', { import: 'default' });
const load = (name: string) => files[`../../data/${city.id}/${name}.json`]();

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const fmtH = new Intl.NumberFormat('ru', { maximumFractionDigits: 1 });
const fmtT = new Intl.DateTimeFormat('ru', { hour: '2-digit', minute: '2-digit', timeZone: city.timezone });

setWorkerUrl('/maplibre/maplibre-gl-worker.mjs');
const map = new Map({ container: 'map', style, ...city.camera, maxPitch: 75, attributionControl: { compact: true } });
map.addControl(new NavigationControl({ visualizePitch: true }), 'top-left');

const [geojson, demJson] = await Promise.all([load('buildings'), load('dem')]);
const dem = decodeDem(demJson);
const blds = prepareBuildings(geojson, dem);
const world: World = { dem, roofs: rasterizeRoofs(blds) };
if (import.meta.env.DEV) Object.assign(window, { map, blds, world, analyze }); // для проверки из консоли
// Высоту для fill-extrusion и признак «этажность неизвестна» подмешиваем в свойства.
(geojson.features as any[]).forEach((f, i) => {
  f.properties.h = blds[i].h;
  f.properties.assumed = blds[i].assumed;
});

map.once('load', () => {
  (map.getSource('buildings') as any).setData(geojson);
  map.on('click', 'buildings', (e) => select(e.features![0]));
  map.on('mouseenter', 'buildings', () => (map.getCanvas().style.cursor = 'pointer'));
  map.on('mouseleave', 'buildings', () => (map.getCanvas().style.cursor = ''));
  $('.hint').textContent = `Кликните здание — ${blds.length} зданий, у ${blds.filter((b) => !b.assumed).length} известна этажность`;
});

let current: Bld | null = null;
const floorSel = $<HTMLSelectElement>('.floor');
floorSel.addEventListener('change', () => current && render(current, +floorSel.value));

function select(f: MapGeoJSONFeature) {
  const b = blds.find((x) => x.id === f.id);
  if (!b) return;
  if (current) map.setFeatureState({ source: 'buildings', id: current.id }, { selected: false });
  map.setFeatureState({ source: 'buildings', id: b.id }, { selected: true });
  current = b;
  floorSel.innerHTML = Array.from({ length: b.floors }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('');
  floorSel.value = String(Math.min(b.floors, Math.max(1, Math.ceil(b.floors / 2))));
  $('.b-name').textContent = b.name ?? `Здание ${b.id}`;
  const src = b.levels != null ? `${b.levels} эт. по OSM` : b.height != null ? `${b.height} м по OSM, ≈${b.floors} эт.` : `этажность в OSM не указана, взято ${b.floors} эт.`;
  $('.b-meta').innerHTML = `${src} · земля ${Math.round(b.ground)} м · <a href="https://www.openstreetmap.org/way/${b.id}" target="_blank" rel="noopener">OSM</a>`;
  $('.result').hidden = false;
  render(b, +floorSel.value);
}

function render(b: Bld, floor: number) {
  const r = analyze(world, b, floor);
  $('.eye').textContent = `окно на ${fmtH.format(r.eyeZ)} м над морем`;
  $('.seasons').innerHTML = r.seasons.map(seasonRow).join('');
  $('.rose').innerHTML = rose(r);
  drawRays(b, r);
}

function seasonRow(s: Result['seasons'][number]) {
  // Полоса 24 часа: доля освещённых отсчётов в каждом часе → прозрачность.
  const perHour = 6;
  const cells = Array.from({ length: 24 }, (_, h) => {
    let sun = 0, day = 0;
    for (let i = h * perHour; i < (h + 1) * perHour; i++) { if (s.samples[i]) day++; if (s.samples[i] === 2) sun++; }
    return `<i class="${day ? 'day' : ''}" style="--sun:${sun / perHour}"></i>`;
  }).join('');
  const times = s.sunrise && s.sunset ? `${fmtT.format(s.sunrise)}–${fmtT.format(s.sunset)}` : '';
  return `<li><b>${s.name}</b><span class="hours">${fmtH.format(s.sun)} ч <small>из ${fmtH.format(s.daylight)} · ${times}</small></span><div class="bar">${cells}</div></li>`;
}

function rose(r: Result) {
  // Сетка 3×3: румбы по кругу, в центре счёт.
  const order = [7, 0, 1, 6, -1, 2, 5, 4, 3];
  const n = r.sea.filter((s) => s.dist != null).length;
  return order.map((i) => {
    if (i < 0) return `<span class="center">${n}/8</span>`;
    const { dir, dist } = r.sea[i];
    return `<span class="${dist != null ? 'yes' : 'no'}" title="${dist != null ? `море в ${fmtH.format(dist / 1000)} км` : 'море не видно'}">${dir}<small>${dist != null ? `${fmtH.format(dist / 1000)} км` : '—'}</small></span>`;
  }).join('');
}

function drawRays(b: Bld, r: Result) {
  const [x0, y0] = toXY(...b.center);
  const mLat = 111320, mLon = 111320 * Math.cos((b.center[1] * Math.PI) / 180);
  const features = r.sea.map(({ dir, dist }, i) => {
    const a = (i * Math.PI) / 4;
    const len = dist != null ? Math.min(dist, 1500) : 150;
    const x = x0 + len * Math.sin(a), y = y0 + len * Math.cos(a);
    const end = [b.center[0] + (x - x0) / mLon, b.center[1] + (y - y0) / mLat];
    return { type: 'Feature', properties: { dir, sea: dist != null }, geometry: { type: 'LineString', coordinates: [b.center, end] } };
  });
  (map.getSource('rays') as any).setData({ type: 'FeatureCollection', features });
}
