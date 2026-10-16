import { Map, NavigationControl, setWorkerUrl } from 'maplibre-gl';
import { cities, getCity } from '../../cities.config.mjs';
import { dayPath, DIRECTIONS, dirBearing, eye, eyeHeight, facing, N, RIBBON_DAY_STEP, SEASONS, seaRose, seasonCalc, STEP_MIN, sunAt, YEAR, type FloorMode, type SeaDir, type Season } from './analysis.ts';
import { hasData, loadCityData } from './data.ts';
import { blocked, createWorld, type Bld, type City } from './grid.ts';
import { shareCard } from './share.ts';
import { buildingColor, SEA_RAMP, SUN_RAMP, style, type Mode } from './style.ts';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const $$ = <T extends HTMLElement>(sel: string) => [...document.querySelectorAll<T>(sel)];
const BASE = import.meta.env.BASE_URL;
const DEG = 180 / Math.PI;
const R_PATH = 220; // м, радиус солнечной диаграммы вокруг здания

// --- Город и состояние из URL -------------------------------------------------
const q = new URL(location.href).searchParams;
const city = getCity(q.get('c') ?? '') as City;
document.title = `Sun & View — ${city.name}`;
$('.brand span').textContent = city.name;
const citySel = $<HTMLSelectElement>('.city');
citySel.innerHTML = cities.filter((c) => hasData(c.id)).map((c) => `<option value="${c.id}"${c.id === city.id ? ' selected' : ''}>${c.name}</option>`).join('');
citySel.addEventListener('change', () => (location.search = `?c=${citySel.value}`));

const fmtH = new Intl.NumberFormat('ru', { maximumFractionDigits: 1 });
const fmtT = new Intl.DateTimeFormat('ru', { hour: '2-digit', minute: '2-digit', timeZone: city.timezone });
const num = (v: string | null, d: number) => (v != null && Number.isFinite(+v) ? +v : d);

let current: Bld | null = null;
let floor = 1;
let side: number | null = q.get('d') != null ? num(q.get('d'), 0) : null; // румб фасада или всё здание
let season = Math.min(3, Math.max(0, num(q.get('s'), 1)));
let hour = Math.min(22, Math.max(4, num(q.get('t'), 10))); // местное время, ч
let mode: Mode = (['sun', 'sea'].includes(q.get('m') ?? '') ? q.get('m') : 'normal') as Mode;
let floorMode: FloorMode = (['1', 'mid', 'top'].includes(q.get('fm') ?? '') ? q.get('fm') : 'mid') as FloorMode;

function syncUrl() {
  const p = new URLSearchParams({ c: city.id, s: String(season), t: hour.toFixed(2) });
  if (current) { p.set('b', String(current.id)); p.set('f', String(floor)); if (side != null) p.set('d', String(side)); }
  if (mode !== 'normal') { p.set('m', mode); p.set('fm', floorMode); }
  history.replaceState(null, '', `?${p}`);
}

// Смещение часового пояса города от UTC на дату, ч.
function tzOffset(d: Date) {
  const at = (tz: string) => new Date(d.toLocaleString('en-US', { timeZone: tz })).getTime();
  return (at(city.timezone) - at('UTC')) / 36e5;
}
const sliderTime = () => new Date(SEASONS[season].date.getTime() + (hour - tzOffset(SEASONS[season].date)) * 36e5);
// Точка на расстоянии dist (м) по азимуту bearing (рад) от lngLat.
function offset([lon, lat]: [number, number], bearing: number, dist: number): [number, number] {
  return [lon + (dist * Math.sin(bearing)) / (111320 * Math.cos(lat / DEG)), lat + (dist * Math.cos(bearing)) / 111320];
}
// Положение солнца на наземной диаграмме: зенит — центр, горизонт — кольцо.
const pathPoint = (b: Bld, altitude: number, bearing: number) => offset(b.center, bearing, R_PATH * (1 - altitude / (Math.PI / 2)));
const setData = (id: string, features: any[]) => (map.getSource(id) as any).setData({ type: 'FeatureCollection', features });

// --- Карта и данные -----------------------------------------------------------
setWorkerUrl(`${BASE}maplibre/maplibre-gl-worker.mjs`);
const map = new Map({ container: 'map', style, ...city.camera, maxPitch: 75, attributionControl: { compact: true } });
map.addControl(new NavigationControl({ visualizePitch: true }), 'top-left');

const data = await loadCityData(city.id);
const world = createWorld(city, data.geojson, data.greenery, data.demMeta, data.demBuf);
const { blds, proj } = world;
if (import.meta.env.DEV) Object.assign(window, { map, world }); // для проверки из консоли
(data.geojson.features as any[]).forEach((f, i) => { f.properties.h = blds[i].h; f.properties.assumed = blds[i].assumed; });

// Тяжёлые расчёты — в воркере со своей копией мира.
const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
worker.postMessage({ type: 'init', city, geojson: data.geojson, greenery: data.greenery, demMeta: data.demMeta, demBuf: data.demBuf });
let reqId = 0;
const pending = new globalThis.Map<number, { resolve: (v: any) => void; onProgress?: (p: number, t: number) => void }>();
worker.onmessage = ({ data: m }) => {
  const p = pending.get(m.id);
  if (!p) return;
  if (m.done) { pending.delete(m.id); p.resolve(m); } else p.onProgress?.(m.progress, m.total);
};
const ask = (msg: object, onProgress?: (p: number, t: number) => void) =>
  new Promise<any>((resolve) => { const id = ++reqId; pending.set(id, { resolve, onProgress }); worker.postMessage({ ...msg, id }); });

map.once('load', () => {
  (map.getSource('buildings') as any).setData(data.geojson);
  map.on('click', 'buildings', (e) => { const b = blds.find((x) => x.id === e.features![0].id); if (b) select(b); });
  let hovered: number | null = null;
  const unhover = () => hovered != null && map.setFeatureState({ source: 'buildings', id: hovered }, { hover: false });
  map.on('mousemove', 'buildings', (e) => {
    const id = e.features![0].id as number;
    if (id === hovered) return;
    unhover(); hovered = id;
    map.setFeatureState({ source: 'buildings', id }, { hover: true });
    map.getCanvas().style.cursor = 'pointer';
  });
  map.on('mouseleave', 'buildings', () => { unhover(); hovered = null; map.getCanvas().style.cursor = ''; });
  $('.hint').textContent = `${blds.length} зданий, у ${blds.filter((b) => !b.assumed).length} известна этажность`;
  $<HTMLButtonElement>('.example').disabled = false;
  updateLight();
  applyMode();
  const b = blds.find((x) => x.id === num(q.get('b'), -1));
  if (b) select(b, { floor: num(q.get('f'), 0) || undefined, side });
});

// --- Свет, время, воспроизведение --------------------------------------------
function updateLight() {
  const t = sliderTime();
  const s = sunAt(t, ...(current?.center ?? city.camera.center));
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
  const e = eye(world, current, floor, side);
  const front = facing(e, s.bearing);
  const lit = up && front && !blocked(world, current, e.x, e.y, e.z, s.bearing, s.altitude);
  const now = $('.now');
  now.className = `now ${!up ? 'night' : lit ? 'lit' : 'shade'}`;
  now.textContent = `${fmtT.format(t)} — ${!up ? 'солнце за горизонтом' : lit ? 'солнце в окнах' : front ? 'окна в тени' : 'солнце с другой стороны дома'}`;
  setData('sunnow', up ? [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: pathPoint(current, s.altitude, s.bearing) } }] : []);
}

const hourInput = $<HTMLInputElement>('.hour');
hourInput.value = String(hour);
const setHour = (h: number) => { hour = Math.min(22, Math.max(4, h)); hourInput.value = String(hour); updateLight(); syncUrl(); };
hourInput.addEventListener('input', () => setHour(+hourInput.value));

$$('.chip').forEach((chip, i) => {
  chip.classList.toggle('active', i === season);
  chip.addEventListener('click', () => {
    season = i;
    $$('.chip').forEach((c, j) => c.classList.toggle('active', j === i));
    if (current) { drawSunPath(); $('.seasons').innerHTML = seasonsHtml(); }
    updateLight(); syncUrl();
    if (mode === 'sun') applyMode();
  });
});

// Сутки за ~12 секунд, по кругу.
let playing = false, lastTs = 0;
function frame(ts: number) {
  if (!playing) return;
  if (lastTs) setHour(hour + 1.5 * (ts - lastTs) / 1000 > 22 ? 4 : hour + 1.5 * (ts - lastTs) / 1000);
  lastTs = ts;
  requestAnimationFrame(frame);
}
const play = $<HTMLButtonElement>('.play');
function togglePlay() {
  playing = !playing; lastTs = 0;
  play.textContent = playing ? '❚❚' : '▶';
  play.setAttribute('aria-pressed', String(playing));
  if (playing) requestAnimationFrame(frame);
}
play.addEventListener('click', togglePlay);
addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).matches('input, select, textarea')) return;
  if (e.key === 'ArrowLeft') setHour(hour - 0.25);
  else if (e.key === 'ArrowRight') setHour(hour + 0.25);
  else if (e.key === ' ') { e.preventDefault(); togglePlay(); }
  else return;
});

// --- Режимы карты: солнце / море для всех зданий ------------------------------
const modeSel = $<HTMLSelectElement>('.mode');
const floorModeSel = $<HTMLSelectElement>('.floor-mode');
modeSel.value = mode;
floorModeSel.value = floorMode;
modeSel.addEventListener('change', () => { mode = modeSel.value as Mode; applyMode(); });
floorModeSel.addEventListener('change', () => { floorMode = floorModeSel.value as FloorMode; applyMode(); });
const cache = new globalThis.Map<string, Float32Array | Uint8Array>();
let modeReq = 0;
const applyColors = () => map.setPaintProperty('buildings', 'fill-extrusion-color', buildingColor(mode, !!current) as any);
const FLOOR_LABEL: Record<FloorMode, string> = { '1': '1-й этаж', mid: 'средний этаж', top: 'верхний этаж' };

async function applyMode() {
  document.body.dataset.mode = mode;
  applyColors();
  syncUrl();
  const legend = $('.legend-box');
  legend.hidden = mode === 'normal';
  const progress = $('.progress');
  if (mode === 'normal') { progress.textContent = ''; return; }
  const sun = mode === 'sun';
  $('.legend-title').textContent = sun ? `Солнце в окнах, ${SEASONS[season].short.toLowerCase()}, ${FLOOR_LABEL[floorMode]}` : `Море из окон, ${FLOOR_LABEL[floorMode]}`;
  $('.legend-bar').style.background = `linear-gradient(90deg, ${(sun ? SUN_RAMP : SEA_RAMP).join(',')})`;
  $('.legend-min').textContent = sun ? '≤ 30 % дня' : '0 румбов';
  $('.legend-max').textContent = sun ? '≥ 95 % дня' : '8 румбов';
  const key = sun ? `sun:${season}:${floorMode}` : `sea:${floorMode}`;
  const my = ++modeReq;
  let arr = cache.get(key);
  if (!arr) {
    const res = await ask(sun ? { type: 'sun', season, mode: floorMode } : { type: 'sea', mode: floorMode }, (p, t) => (progress.textContent = `${p} / ${t}`));
    if (my !== modeReq) return;
    arr = res.data; cache.set(key, arr!); progress.textContent = '';
  }
  blds.forEach((b, i) => map.setFeatureState({ source: 'buildings', id: b.id }, { v: arr![i] }));
}

// --- Поиск адреса (Photon, без ключа) -----------------------------------------
const search = $<HTMLInputElement>('.search');
const results = $('.search-results');
let searchTimer = 0;
search.addEventListener('input', () => {
  clearTimeout(searchTimer);
  if (search.value.trim().length < 3) { results.hidden = true; return; }
  searchTimer = setTimeout(async () => {
    const { south, west, north, east } = city.bbox;
    const [lon, lat] = city.camera.center;
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(search.value.trim())}&lat=${lat}&lon=${lon}&bbox=${west},${south},${east},${north}&limit=6&lang=en`;
    const res = await fetch(url).then((r) => r.json()).catch(() => null);
    const feats: any[] = res?.features ?? [];
    results.innerHTML = feats.length ? feats.map((f, i) => { const p = f.properties; return `<button type="button" data-i="${i}">${[p.name, p.street, p.housenumber].filter(Boolean).join(' ') || p.city}<small>${[p.city ?? p.county, p.country].filter(Boolean).join(', ')}</small></button>`; }).join('') : '<span>Ничего не нашлось</span>';
    results.hidden = false;
    results.querySelectorAll<HTMLButtonElement>('button').forEach((btn) =>
      btn.addEventListener('click', () => {
        const [lon, lat] = feats[+btn.dataset.i!].geometry.coordinates;
        results.hidden = true;
        const [x, y] = proj.toXY(lon, lat);
        const near = blds.map((b) => ({ b, d: Math.hypot(b.xy[0] - x, b.xy[1] - y) })).sort((a, b) => a.d - b.d)[0];
        if (near && near.d < 150) select(near.b);
        else map.flyTo({ center: [lon, lat], zoom: 16.5, pitch: 55, duration: 1200 });
      }),
    );
  }, 400);
});
search.addEventListener('blur', () => setTimeout(() => (results.hidden = true), 200));

// --- Выбор здания и панель ----------------------------------------------------
const floorSel = $<HTMLSelectElement>('.floor');
floorSel.addEventListener('change', () => { floor = +floorSel.value; render(); });
const sidesBox = $('.sides');
sidesBox.innerHTML = ['Все', ...DIRECTIONS].map((d, i) => `<button type="button" class="side" data-side="${i - 1}" title="${i ? `Окна на ${d}` : 'Здание целиком'}">${d}</button>`).join('');
const sideBtns = $$<HTMLButtonElement>('.side');
sideBtns.forEach((btn) => btn.addEventListener('click', () => { side = +btn.dataset.side! < 0 ? null : +btn.dataset.side!; render(); }));

$('.example').addEventListener('click', () => {
  const [cx, cy] = proj.toXY(...city.camera.center);
  const d = (b: Bld) => Math.hypot(b.xy[0] - cx, b.xy[1] - cy);
  select(blds.filter((b) => b.name && (b.levels ?? 0) >= 4).sort((a, b) => d(a) - d(b))[0] ?? blds.reduce((m, b) => (b.floors > m.floors ? b : m)));
});

function select(b: Bld, opts: { floor?: number; side?: number | null } = {}) {
  if (current) map.setFeatureState({ source: 'buildings', id: current.id }, { selected: false });
  current = b;
  map.setFeatureState({ source: 'buildings', id: b.id }, { selected: true });
  floor = Math.min(b.floors, Math.max(1, opts.floor ?? Math.ceil(b.floors / 2)));
  side = opts.side === undefined ? null : opts.side;
  floorSel.innerHTML = Array.from({ length: b.floors }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('');
  floorSel.value = String(floor);
  $('.b-name').textContent = b.name ?? `Здание ${b.id}`;
  const src = b.levels != null ? `${b.levels} эт. по OSM` : b.height != null ? `${b.height} м по OSM, ≈${b.floors} эт.` : `этажность в OSM не указана, взято ${b.floors} эт.`;
  $('.b-meta').innerHTML = `${src} · земля ${Math.round(b.ground)} м · <a href="https://www.openstreetmap.org/${b.id > 1e9 ? 'relation' : 'way'}/${b.id}" target="_blank" rel="noopener">OSM ↗</a>`;
  $('.empty').hidden = true;
  const result = $('.result');
  result.hidden = false;
  result.classList.remove('show');
  void result.offsetWidth; // перезапуск анимации
  result.classList.add('show');
  document.body.classList.add('sheet-open');
  applyColors();
  map.flyTo({ center: b.center, zoom: Math.max(map.getZoom(), 16.3), pitch: 58, duration: 1000 });
  render();
}

let lastSeasons: Season[] = [], lastSea: SeaDir[] = [], ribbonSmall: HTMLCanvasElement | null = null;
const sideLabel = () => (side == null ? 'здание целиком' : `окна на ${DIRECTIONS[side]}`);

// Пересчёт для текущих здания, этажа и стороны.
function render() {
  const b = current!;
  sideBtns.forEach((btn) => btn.classList.toggle('active', +btn.dataset.side! === (side ?? -1)));
  setData('floor', [{ type: 'Feature', properties: { base: (floor - 1) * city.floorHeight, top: floor * city.floorHeight }, geometry: data.geojson.features[b.idx].geometry }]);
  $('.eye').textContent = `окно на ${fmtH.format(eyeHeight(world, b, floor))} м над морем`;
  $('.seasons').innerHTML = seasonsHtml();
  lastSea = seaRose(world, b, floor);
  $('.rose').innerHTML = roseSvg(lastSea);
  drawSectors(b, lastSea);
  drawSunPath();
  updateLight();
  syncUrl();
  const my = ++ribbonReq;
  ask({ type: 'ribbon', idx: b.idx, floor, side }).then((r) => my === ribbonReq && drawRibbon(r));
}
let ribbonReq = 0;

function seasonsHtml() {
  const e = eye(world, current!, floor, side);
  lastSeasons = SEASONS.map((_, i) => seasonCalc(world, current!, e, i));
  return lastSeasons.map((s) => {
    const times = s.sunrise && s.sunset ? `${fmtT.format(s.sunrise)}–${fmtT.format(s.sunset)}` : 'полярная ночь';
    const pct = s.daylight ? Math.round((100 * s.sun) / s.daylight) : 0;
    return `<div class="card${s === lastSeasons[season] ? ' current' : ''}" style="--pct:${pct}%"><b>${s.short}</b><strong>${fmtH.format(s.sun)} ч</strong><small>из ${fmtH.format(s.daylight)} · ${times}</small><i></i></div>`;
  }).join('');
}

// Роза видимости моря: 8 секторов, снаружи румб, внутри — километры до воды.
function roseSvg(sea: SeaDir[]) {
  const c = 100, r1 = 36, r2 = 72;
  const pt = (r: number, a: number) => [c + r * Math.sin(a), c - r * Math.cos(a)].map((v) => v.toFixed(1));
  const n = sea.filter((s) => s.dist != null).length;
  const parts = sea.map(({ dir, bearing, dist }, i) => {
    const a0 = bearing - Math.PI / 8 + 0.025, a1 = bearing + Math.PI / 8 - 0.025;
    const d = `M${pt(r1, a0)} L${pt(r2, a0)} A${r2},${r2} 0 0 1 ${pt(r2, a1)} L${pt(r1, a1)} A${r1},${r1} 0 0 0 ${pt(r1, a0)} Z`;
    const title = dist != null ? `${dir}: море в ${fmtH.format(dist / 1000)} км` : `${dir}: море не видно`;
    const [kx, ky] = pt(54, bearing), [lx, ly] = pt(86, bearing);
    const km = dist != null ? `<text class="km" x="${kx}" y="${+ky + 3.5}">${fmtH.format(dist / 1000)}</text>` : '';
    return `<path class="${dist != null ? 'yes' : 'no'}${i === side ? ' sel' : ''}" d="${d}" data-side="${i}"><title>${title}</title></path><text class="dir" x="${lx}" y="${+ly + 4}">${dir}</text>${km}`;
  });
  return `<svg viewBox="0 0 200 200" role="img" aria-label="Видимость моря: ${n} из 8 румбов">${parts.join('')}<text class="count" x="100" y="97">${n}<tspan>/8</tspan></text><text class="sub" x="100" y="112">румбов</text></svg>`;
}
$('.rose').addEventListener('click', (e) => {
  const p = (e.target as Element).closest('path');
  if (p) { side = +p.getAttribute('data-side')!; render(); }
});

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

// Солнечная диаграмма на земле: кольцо — горизонт, дуга — путь солнца в сезон (светит / тень / за домом).
function drawSunPath() {
  if (!current) return;
  const b = current;
  const ring: [number, number][] = [];
  for (let i = 0; i <= 72; i++) ring.push(offset(b.center, (i * Math.PI) / 36, R_PATH));
  const features: any[] = [{ type: 'Feature', properties: { kind: 'ring' }, geometry: { type: 'LineString', coordinates: ring } }];
  const path = dayPath(world, b, eye(world, b, floor, side), SEASONS[season].date);
  for (let i = 0; i + 1 < path.length; i++) {
    if (path[i + 1].t.getTime() - path[i].t.getTime() > STEP_MIN * 60000 * 1.5) continue;
    const state = path[i].lit ? 'lit' : path[i].facing ? 'shade' : 'back';
    features.push({ type: 'Feature', properties: { kind: 'path', state }, geometry: { type: 'LineString', coordinates: [pathPoint(b, path[i].altitude, path[i].bearing), pathPoint(b, path[i + 1].altitude, path[i + 1].bearing)] } });
  }
  setData('sunpath', features);
}

// Лента года: столбцы — дни, строки — местное время суток (0 сверху).
function drawRibbon({ cols, rows, data }: { cols: number; rows: number; data: Uint8Array }) {
  const cv = $<HTMLCanvasElement>('.ribbon');
  const dpr = devicePixelRatio || 1;
  const W = cv.clientWidth, H = 180, left = 26, top = 6, bottom = 18;
  cv.width = W * dpr; cv.height = H * dpr;
  const ctx = cv.getContext('2d')!;
  ctx.scale(dpr, dpr);
  const pw = W - left - 4, ph = H - top - bottom;
  const small = document.createElement('canvas');
  small.width = cols; small.height = rows;
  const img = small.getContext('2d')!.createImageData(cols, rows);
  const palette = [[31, 42, 68], [167, 174, 187], [255, 194, 51]];
  for (let c = 0; c < cols; c++) {
    const shift = Math.round((tzOffset(new Date(Date.UTC(YEAR, 0, 1 + c * RIBBON_DAY_STEP))) * 60) / STEP_MIN);
    for (let i = 0; i < rows; i++) {
      const row = (((i + shift) % N) + N) % N;
      const [r, g, b] = palette[data[i * cols + c]];
      const k = (row * cols + c) * 4;
      img.data[k] = r; img.data[k + 1] = g; img.data[k + 2] = b; img.data[k + 3] = 255;
    }
  }
  small.getContext('2d')!.putImageData(img, 0, 0);
  ribbonSmall = small;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(small, left, top, pw, ph);
  ctx.fillStyle = '#7a746a';
  ctx.font = '10px "Inter Variable", system-ui, sans-serif';
  ctx.textAlign = 'right';
  for (const h of [0, 6, 12, 18, 24]) ctx.fillText(String(h), left - 5, top + (ph * h) / 24 + 3.5);
  ctx.textAlign = 'center';
  'ЯФМАМИИАСОНД'.split('').forEach((m, i) => ctx.fillText(m, left + (pw * (i + 0.5)) / 12, H - 5));
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.setLineDash([3, 3]);
  for (const s of SEASONS) {
    const x = left + (pw * ((s.date.getTime() - Date.UTC(YEAR, 0, 1)) / 864e5)) / 365;
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, top + ph); ctx.stroke();
  }
}

// --- Сравнение --------------------------------------------------------------
type Pin = { b: Bld; floor: number; side: number | null; seasons: Season[]; sea: number };
const pins: Pin[] = [];
$('.pin-btn').addEventListener('click', () => {
  if (!current || pins.length >= 4) return;
  pins.push({ b: current, floor, side, seasons: lastSeasons, sea: lastSea.filter((s) => s.dist != null).length });
  renderPins();
});
function renderPins() {
  const box = $('.compare');
  box.hidden = !pins.length;
  $('.pin-btn').toggleAttribute('disabled', pins.length >= 4);
  $('.compare-rows').innerHTML = pins.map((p, i) =>
    `<tr><td><button type="button" class="link" data-i="${i}">${p.b.name ?? p.b.id}</button><small>${p.floor} эт. · ${p.side == null ? 'всё здание' : DIRECTIONS[p.side]}</small></td>${p.seasons.map((s) => `<td>${fmtH.format(s.sun)}</td>`).join('')}<td>${p.sea}/8</td><td><button type="button" class="x" data-i="${i}" aria-label="Убрать">×</button></td></tr>`,
  ).join('');
  $$('.compare .link').forEach((el) => el.addEventListener('click', () => { const p = pins[+(el as HTMLElement).dataset.i!]; select(p.b, { floor: p.floor, side: p.side }); }));
  $$('.compare .x').forEach((el) => el.addEventListener('click', () => { pins.splice(+(el as HTMLElement).dataset.i!, 1); renderPins(); }));
}

// --- PNG-карточка -------------------------------------------------------------
$('.share-btn').addEventListener('click', async () => {
  if (!current) return;
  const blob = await shareCard({ city: city.name, title: current.name ?? `Здание ${current.id}`, subtitle: `${city.name} · ${floor} этаж · ${sideLabel()}`, seasons: lastSeasons, sea: lastSea, ribbon: ribbonSmall });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `sun-view-${city.id}-${current.id}-${floor}.png`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
});

// Мобильный лист: тап по ручке раскрывает панель.
$('.sheet-handle').addEventListener('click', () => document.body.classList.toggle('sheet-open'));
