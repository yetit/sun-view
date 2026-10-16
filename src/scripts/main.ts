import { Map, NavigationControl, setWorkerUrl } from 'maplibre-gl';
import city from '../../city.config.mjs';
import { dayPath, eyeHeight, N, RIBBON_DAY_STEP, SEASONS, seaRose, seasonCalc, STEP_MIN, sunAt, YEAR, yearRibbon, type SeaDir, type Season } from './analysis';
import { blocked, decodeDem, prepareBuildings, rasterizeRoofs, toXY, type Bld, type World } from './grid';
import { buildingColor, style } from './style';

// Данные города подхватываются по id из конфига: data/<id>/{buildings,dem}.json.
const files = import.meta.glob<any>('../../data/*/*.json', { import: 'default' });
const load = (name: string) => files[`../../data/${city.id}/${name}.json`]();

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const fmtH = new Intl.NumberFormat('ru', { maximumFractionDigits: 1 });
const fmtT = new Intl.DateTimeFormat('ru', { hour: '2-digit', minute: '2-digit', timeZone: city.timezone });
const DEG = 180 / Math.PI;
const R_PATH = 220; // м, радиус солнечной диаграммы вокруг здания

// Смещение часового пояса города от UTC на дату, ч.
function tzOffset(d: Date) {
  const at = (tz: string) => new Date(d.toLocaleString('en-US', { timeZone: tz })).getTime();
  return (at(city.timezone) - at('UTC')) / 36e5;
}
// Точка на расстоянии dist (м) по азимуту bearing (рад) от lngLat.
function offset([lon, lat]: [number, number], bearing: number, dist: number): [number, number] {
  return [lon + (dist * Math.sin(bearing)) / (111320 * Math.cos(lat / DEG)), lat + (dist * Math.cos(bearing)) / 111320];
}
const setData = (id: string, features: any[]) => (map.getSource(id) as any).setData({ type: 'FeatureCollection', features });

setWorkerUrl('/maplibre/maplibre-gl-worker.mjs');
const map = new Map({ container: 'map', style, ...city.camera, maxPitch: 75, attributionControl: { compact: true } });
map.addControl(new NavigationControl({ visualizePitch: true }), 'top-left');

const [geojson, demJson] = await Promise.all([load('buildings'), load('dem')]);
const dem = decodeDem(demJson);
const blds = prepareBuildings(geojson, dem);
const world: World = { dem, roofs: rasterizeRoofs(blds) };
if (import.meta.env.DEV) Object.assign(window, { map, blds, world }); // для проверки из консоли
(geojson.features as any[]).forEach((f, i) => {
  f.properties.h = blds[i].h;
  f.properties.assumed = blds[i].assumed;
});

// Состояние
let current: Bld | null = null;
let floor = 1;
let season = 1; // лето
let hour = 10; // местное время, ч
let sunMap = false;
const sunCache: (Float32Array | null)[] = SEASONS.map(() => null); // доля светового дня с солнцем, по зданиям

// Момент ползунка: дата сезона + местный час.
const sliderTime = () => new Date(SEASONS[season].date.getTime() + (hour - tzOffset(SEASONS[season].date)) * 36e5);
// Положение солнца на наземной диаграмме: зенит — центр, горизонт — кольцо.
const pathPoint = (b: Bld, altitude: number, bearing: number) => offset(b.center, bearing, R_PATH * (1 - altitude / (Math.PI / 2)));

map.once('load', () => {
  (map.getSource('buildings') as any).setData(geojson);
  map.on('click', 'buildings', (e) => {
    const b = blds.find((x) => x.id === e.features![0].id);
    if (b) select(b);
  });
  let hovered: number | null = null;
  const unhover = () => hovered != null && map.setFeatureState({ source: 'buildings', id: hovered }, { hover: false });
  map.on('mousemove', 'buildings', (e) => {
    const id = e.features![0].id as number;
    if (id === hovered) return;
    unhover();
    hovered = id;
    map.setFeatureState({ source: 'buildings', id }, { hover: true });
    map.getCanvas().style.cursor = 'pointer';
  });
  map.on('mouseleave', 'buildings', () => { unhover(); hovered = null; map.getCanvas().style.cursor = ''; });
  $('.hint').textContent = `${blds.length} зданий, у ${blds.filter((b) => !b.assumed).length} известна этажность`;
  $<HTMLButtonElement>('.example').disabled = false;
  updateLight();
});

// --- Свет и время ---------------------------------------------------------

function updateLight() {
  const t = sliderTime();
  const s = sunAt(t, ...((current?.center ?? city.camera.center) as [number, number]));
  const up = s.altitude > 0;
  map.setLight({
    anchor: 'map',
    position: [1.5, s.bearing * DEG, up ? 90 - s.altitude * DEG : 88],
    intensity: up ? 0.3 + 0.4 * Math.sin(s.altitude) : 0.12,
    color: !up ? '#9fb0d0' : s.altitude < 0.2 ? '#ffd3a0' : '#ffffff',
  });
  $('.clock').textContent = fmtT.format(t);
  $('.timebar').classList.toggle('night', !up);
  if (!current) return;
  const [x, y] = toXY(...current.center);
  const lit = up && !blocked(world, current, x, y, eyeHeight(current, floor), s.bearing, s.altitude);
  const now = $('.now');
  now.className = `now ${!up ? 'night' : lit ? 'lit' : 'shade'}`;
  now.textContent = !up ? `${fmtT.format(t)} — солнце за горизонтом` : lit ? `${fmtT.format(t)} — солнце в окнах` : `${fmtT.format(t)} — окна в тени`;
  setData('sunnow', up ? [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: pathPoint(current, s.altitude, s.bearing) } }] : []);
}

$<HTMLInputElement>('.hour').addEventListener('input', (e) => { hour = +(e.target as HTMLInputElement).value; updateLight(); });
document.querySelectorAll<HTMLButtonElement>('.chip').forEach((chip, i) =>
  chip.addEventListener('click', () => {
    season = i;
    document.querySelectorAll('.chip').forEach((c, j) => c.classList.toggle('active', j === i));
    drawSunPath();
    updateLight();
    if (sunMap) computeSunMap(season);
  }),
);

// --- Карта солнца для всех зданий -----------------------------------------

const applyColors = () => map.setPaintProperty('buildings', 'fill-extrusion-color', buildingColor(sunMap, !!current) as any);

async function computeSunMap(s: number) {
  if (!sunCache[s]) {
    const arr = new Float32Array(blds.length);
    const progress = $('.progress');
    for (let i = 0; i < blds.length; i += 100) {
      for (let j = i; j < Math.min(i + 100, blds.length); j++) {
        const b = blds[j];
        const r = seasonCalc(world, b, Math.ceil(b.floors / 2), s);
        arr[j] = r.daylight ? r.sun / r.daylight : 0;
      }
      progress.textContent = `${Math.min(i + 100, blds.length)} / ${blds.length}`;
      await new Promise((r) => setTimeout(r));
      if (season !== s || !sunMap) return; // переключили — бросаем
    }
    sunCache[s] = arr;
    progress.textContent = '';
  }
  blds.forEach((b, i) => map.setFeatureState({ source: 'buildings', id: b.id }, { sun: sunCache[s]![i] }));
}

$('.sunmap-btn').addEventListener('click', (e) => {
  sunMap = !sunMap;
  (e.currentTarget as HTMLElement).setAttribute('aria-pressed', String(sunMap));
  document.body.classList.toggle('is-sunmap', sunMap);
  applyColors();
  if (sunMap) computeSunMap(season);
  else $('.progress').textContent = '';
});

// --- Выбор здания и панель ------------------------------------------------

const floorSel = $<HTMLSelectElement>('.floor');
floorSel.addEventListener('change', () => { floor = +floorSel.value; render(); });

$('.example').addEventListener('click', () => {
  const [cx, cy] = toXY(...(city.camera.center as [number, number]));
  const d = (b: Bld) => { const [x, y] = toXY(...b.center); return Math.hypot(x - cx, y - cy); };
  const pick = blds.filter((b) => b.name && (b.levels ?? 0) >= 4).sort((a, b) => d(a) - d(b))[0] ?? blds.reduce((m, b) => (b.floors > m.floors ? b : m));
  select(pick);
});

function select(b: Bld) {
  if (current) map.setFeatureState({ source: 'buildings', id: current.id }, { selected: false });
  current = b;
  map.setFeatureState({ source: 'buildings', id: b.id }, { selected: true });
  floor = Math.min(b.floors, Math.max(1, Math.ceil(b.floors / 2)));
  floorSel.innerHTML = Array.from({ length: b.floors }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('');
  floorSel.value = String(floor);
  $('.b-name').textContent = b.name ?? `Здание ${b.id}`;
  const src = b.levels != null ? `${b.levels} эт. по OSM` : b.height != null ? `${b.height} м по OSM, ≈${b.floors} эт.` : `этажность в OSM не указана, взято ${b.floors} эт.`;
  $('.b-meta').innerHTML = `${src} · земля ${Math.round(b.ground)} м · <a href="https://www.openstreetmap.org/way/${b.id}" target="_blank" rel="noopener">OSM ↗</a>`;
  $('.empty').hidden = true;
  const result = $('.result');
  result.hidden = false;
  result.classList.remove('show');
  void result.offsetWidth; // перезапуск анимации
  result.classList.add('show');
  applyColors();
  map.flyTo({ center: b.center, zoom: Math.max(map.getZoom(), 16.3), pitch: 58, duration: 1000 });
  render();
}

// Пересчёт для текущих здания и этажа.
function render() {
  const b = current!;
  const geometry = geojson.features[b.idx].geometry;
  setData('floor', [{ type: 'Feature', properties: { base: (floor - 1) * city.floorHeight, top: floor * city.floorHeight }, geometry }]);
  $('.eye').textContent = `окно на ${fmtH.format(eyeHeight(b, floor))} м над морем`;
  $('.seasons').innerHTML = SEASONS.map((_, i) => seasonCard(seasonCalc(world, b, floor, i))).join('');
  const sea = seaRose(world, b, floor);
  $('.rose').innerHTML = roseSvg(sea);
  drawSectors(b, sea);
  drawSunPath();
  updateLight();
  requestAnimationFrame(() => drawRibbon(yearRibbon(world, b, floor)));
}

function seasonCard(s: Season) {
  const times = s.sunrise && s.sunset ? `${fmtT.format(s.sunrise)}–${fmtT.format(s.sunset)}` : 'полярная ночь';
  const pct = s.daylight ? Math.round((100 * s.sun) / s.daylight) : 0;
  return `<div class="card" style="--pct:${pct}%"><b>${s.short}</b><strong>${fmtH.format(s.sun)} ч</strong><small>из ${fmtH.format(s.daylight)} · ${times}</small><i></i></div>`;
}

// Роза видимости моря: 8 секторов, снаружи румб, внутри — километры до воды.
function roseSvg(sea: SeaDir[]) {
  const c = 100, r1 = 36, r2 = 72;
  const pt = (r: number, a: number) => `${(c + r * Math.sin(a)).toFixed(1)},${(c - r * Math.cos(a)).toFixed(1)}`;
  const n = sea.filter((s) => s.dist != null).length;
  const parts = sea.map(({ dir, bearing, dist }) => {
    const a0 = bearing - Math.PI / 8 + 0.025, a1 = bearing + Math.PI / 8 - 0.025;
    const d = `M${pt(r1, a0)} L${pt(r2, a0)} A${r2},${r2} 0 0 1 ${pt(r2, a1)} L${pt(r1, a1)} A${r1},${r1} 0 0 0 ${pt(r1, a0)} Z`;
    const title = dist != null ? `${dir}: море в ${fmtH.format(dist / 1000)} км` : `${dir}: море не видно`;
    const km = dist != null ? `<text class="km" x="${pt(54, bearing).split(',')[0]}" y="${+pt(54, bearing).split(',')[1] + 3.5}">${fmtH.format(dist / 1000)}</text>` : '';
    const [lx, ly] = pt(86, bearing).split(',');
    return `<path class="${dist != null ? 'yes' : 'no'}" d="${d}"><title>${title}</title></path><text class="dir" x="${lx}" y="${+ly + 4}">${dir}</text>${km}`;
  });
  return `<svg viewBox="0 0 200 200" role="img" aria-label="Видимость моря: ${n} из 8 румбов">${parts.join('')}<text class="count" x="100" y="97">${n}<tspan>/8</tspan></text><text class="sub" x="100" y="112">румбов</text></svg>`;
}

// Секторы на карте: зелёный тянется до воды (не дальше 1,2 км), красный — короткий.
function drawSectors(b: Bld, sea: SeaDir[]) {
  const features: any[] = [];
  for (const { dir, bearing, dist } of sea) {
    const r = dist != null ? Math.min(dist, 1200) + 25 : 70;
    const ring: [number, number][] = [b.center];
    for (let a = bearing - Math.PI / 8; a <= bearing + Math.PI / 8 + 1e-9; a += Math.PI / 48) ring.push(offset(b.center, a, r));
    ring.push(b.center);
    const sea = dist != null;
    features.push({ type: 'Feature', properties: { sea }, geometry: { type: 'Polygon', coordinates: [ring] } });
    features.push({ type: 'Feature', properties: { sea, label: sea ? `${dir}\n${fmtH.format(dist / 1000)} км` : dir }, geometry: { type: 'Point', coordinates: offset(b.center, bearing, 105) } });
  }
  setData('sectors', features);
}

// Солнечная диаграмма на земле вокруг здания: кольцо — горизонт, дуга — путь солнца в выбранный сезон.
function drawSunPath() {
  if (!current) return;
  const b = current;
  const ring: [number, number][] = [];
  for (let i = 0; i <= 72; i++) ring.push(offset(b.center, (i * Math.PI) / 36, R_PATH));
  const features: any[] = [{ type: 'Feature', properties: { kind: 'ring' }, geometry: { type: 'LineString', coordinates: ring } }];
  const path = dayPath(world, b, floor, SEASONS[season].date);
  for (let i = 0; i + 1 < path.length; i++) {
    if (path[i + 1].t.getTime() - path[i].t.getTime() > STEP_MIN * 60000 * 1.5) continue;
    features.push({
      type: 'Feature',
      properties: { kind: 'path', lit: path[i].lit },
      geometry: { type: 'LineString', coordinates: [pathPoint(b, path[i].altitude, path[i].bearing), pathPoint(b, path[i + 1].altitude, path[i + 1].bearing)] },
    });
  }
  setData('sunpath', features);
}

// Лента года: столбцы — дни, строки — местное время суток (0 сверху).
function drawRibbon({ cols, rows, data }: ReturnType<typeof yearRibbon>) {
  const cv = $<HTMLCanvasElement>('.ribbon');
  const dpr = devicePixelRatio || 1;
  const W = cv.clientWidth, H = 180, left = 26, top = 6, bottom = 18;
  cv.width = W * dpr;
  cv.height = H * dpr;
  const ctx = cv.getContext('2d')!;
  ctx.scale(dpr, dpr);
  const pw = W - left - 4, ph = H - top - bottom;

  const small = document.createElement('canvas');
  small.width = cols;
  small.height = rows;
  const img = small.getContext('2d')!.createImageData(cols, rows);
  const palette = [[31, 42, 68], [167, 174, 187], [255, 194, 51]];
  for (let c = 0; c < cols; c++) {
    const shift = Math.round((tzOffset(new Date(Date.UTC(YEAR, 0, 1 + c * RIBBON_DAY_STEP))) * 60) / STEP_MIN);
    for (let i = 0; i < rows; i++) {
      const row = (((i + shift) % N) + N) % N; // строка по местному времени
      const [r, g, b] = palette[data[i * cols + c]];
      const k = (row * cols + c) * 4;
      img.data[k] = r; img.data[k + 1] = g; img.data[k + 2] = b; img.data[k + 3] = 255;
    }
  }
  small.getContext('2d')!.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(small, left, top, pw, ph);

  ctx.fillStyle = '#7a746a';
  ctx.font = '10px Inter, system-ui, sans-serif';
  ctx.textAlign = 'right';
  for (const h of [0, 6, 12, 18, 24]) ctx.fillText(String(h), left - 5, top + (ph * h) / 24 + 3.5);
  ctx.textAlign = 'center';
  'ЯФМАМИИАСОНД'.split('').forEach((m, i) => ctx.fillText(m, left + (pw * (i + 0.5)) / 12, H - 5));
  // Отметки четырёх сезонов
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.setLineDash([3, 3]);
  for (const s of SEASONS) {
    const x = left + (pw * ((s.date.getTime() - Date.UTC(YEAR, 0, 1)) / 864e5)) / 365;
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, top + ph); ctx.stroke();
  }
}
