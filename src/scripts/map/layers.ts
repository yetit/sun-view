// Карта MapLibre и всё, что рисуется на ней: здания, этаж, фасад, секторы моря, солнечная диаграмма.
import { Map, NavigationControl, setWorkerUrl, type FilterSpecification } from 'maplibre-gl';
import { dayPath, dirIndex, eye, SEASONS, STEP_MIN, type SeaDir } from '../analysis.ts';
import { BASE, city, embed, facadeOf, fmtH, geojson, state, world, dayDate } from '../app.ts';
import { t } from '../i18n.ts';
import type { Bld, Facade } from '../grid.ts';
import { buildingColor, style } from '../style.ts';

const DEG = 180 / Math.PI;
const R_PATH = 220; // м, радиус солнечной диаграммы вокруг здания

setWorkerUrl(`${BASE}maplibre/maplibre-gl-worker.mjs`);
// В dev буфер сохраняется, чтобы снимать картинки (OG, README) из canvas.
export const map = new Map({ container: 'map', style, ...city.camera, maxPitch: 75, attributionControl: { compact: true }, canvasContextAttributes: { preserveDrawingBuffer: import.meta.env.DEV } });
map.addControl(new NavigationControl({ visualizePitch: true }), 'top-left');
// Азимут карты в атрибуте контейнера — для проверок (E2E) без доступа к объекту карты.
const markBearing = () => (map.getContainer().dataset.bearing = map.getBearing().toFixed(1));
map.on('moveend', markBearing);
markBearing();
// Событие load может прийти раньше, чем загрузятся данные, — ловим его сразу.
export const mapReady = new Promise<void>((r) => map.once('load', () => r()));
// 3D-рельеф. С GPU — после первого простоя карты. На программном WebGL (SwiftShader, llvmpipe — нет GPU или
// он в чёрном списке браузера) перестройка сцены под рельеф держит главный поток по 3–4 с, поэтому там рельеф
// включается по первому действию: клик, жест, колесо, клавиша или выбор дома (enableTerrain из панели).
export const enableTerrain = () => { if (!map.getTerrain()) map.setTerrain({ source: 'dem', exaggeration: 1 }); };
const software = (() => {
  const gl = map.getCanvas().getContext('webgl2'), ext = gl?.getExtension('WEBGL_debug_renderer_info');
  return /swiftshader|llvmpipe|software|basic render/i.test(ext ? String(gl!.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '');
})();
if (software) for (const ev of ['mousedown', 'touchstart', 'wheel', 'keydown']) map.getCanvasContainer().addEventListener(ev, enableTerrain, { once: true, passive: true });
else map.once('idle', () => (globalThis.requestIdleCallback ?? setTimeout)(enableTerrain));
const BUILDING_LAYERS = ['buildings', 'buildings-assumed'];

// Точка на расстоянии dist (м) по азимуту bearing (рад) от lngLat.
export function offset([lon, lat]: [number, number], bearing: number, dist: number): [number, number] {
  return [lon + (dist * Math.sin(bearing)) / (111320 * Math.cos(lat / DEG)), lat + (dist * Math.cos(bearing)) / 111320];
}
// Положение солнца на наземной диаграмме: зенит — центр, горизонт — кольцо.
export const pathPoint = (b: Bld, altitude: number, bearing: number) => offset(b.center, bearing, R_PATH * (1 - altitude / (Math.PI / 2)));
export const setData = (id: string, features: any[]) => (map.getSource(id) as any).setData({ type: 'FeatureCollection', features });
// scale — часы для трёх цветов карты солнца, запоминается до следующего слоя.
let sunScale = [0, 1, 2];
export function applyColors(scale = sunScale) {
  sunScale = scale;
  BUILDING_LAYERS.forEach((id) => map.setPaintProperty(id, 'fill-extrusion-color', buildingColor(state.mode, !!state.current, scale) as any));
  // В режиме «Этажность» главные — как раз дома без неё: рисуем их плотными, а не полупрозрачными.
  map.setPaintProperty('buildings-assumed', 'fill-extrusion-opacity', state.mode === 'levels' ? 0.95 : 0.55);
}

// На телефоне карта под листом: центрируем выбранное в видимой части.
export const sheetPadding = () => (!embed && matchMedia('(max-width: 720px)').matches ? { top: 40, bottom: document.querySelector<HTMLElement>('.panel')!.offsetHeight, left: 0, right: 0 } : { top: 0, bottom: 0, left: 0, right: 0 });

// Здания: данные, клик и подсветка при наведении.
export function bindBuildings(onSelect: (b: Bld) => void) {
  (map.getSource('buildings') as any).setData(geojson);
  map.on('click', BUILDING_LAYERS, (e) => { const b = world.blds.find((x) => x.id === e.features![0].id); if (b) onSelect(b); });
  let hovered: number | null = null;
  const unhover = () => hovered != null && map.setFeatureState({ source: 'buildings', id: hovered }, { hover: false });
  map.on('mousemove', BUILDING_LAYERS, (e) => {
    const id = e.features![0].id as number;
    if (id === hovered) return;
    unhover(); hovered = id;
    map.setFeatureState({ source: 'buildings', id }, { hover: true });
    map.getCanvas().style.cursor = 'pointer';
  });
  map.on('mouseleave', BUILDING_LAYERS, () => { unhover(); hovered = null; map.getCanvas().style.cursor = ''; });
}

// Полоса этажа — контур дома, раздвинутый на 0,4 м наружу: стены полосы не совпадают со стенами дома,
// иначе они мерцают и рвутся (z-fighting).
// Камера перед фасадом: стоит снаружи по нормали стены и смотрит на неё (азимут — против нормали), наклон 58°,
// зум по размеру дома — чтобы влезли и ближайшие соседи. prefers-reduced-motion — сразу, без анимации.
export function lookAtFacade(b: Bld, f: Facade) {
  const bearing = ((f.normal * 180) / Math.PI + 180) % 360;
  const zoom = Math.min(17.5, Math.max(15.5, 17.3 - Math.log2(Math.max(1, b.radius / 20))));
  const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1000;
  map.easeTo({ center: b.center, bearing, pitch: 58, zoom, duration, padding: sheetPadding() });
}

export function drawFloor(b: Bld) {
  const coordinates = b.rings.map((r) => [inflate(r, 0.4).map((p) => world.proj.toLonLat(p[0], p[1]))]);
  // Верх полосы на высоте крыши (верхний этаж) — то же мерцание уже на крыше: поднимаем его на 0,2 м над ней.
  const top = state.floor * city.floorHeight;
  setData('floor', [{ type: 'Feature', properties: { base: (state.floor - 1) * city.floorHeight, top: Math.abs(top - b.h) < 0.3 ? b.h + 0.2 : top }, geometry: { type: 'MultiPolygon', coordinates } }]);
}

// Кольцо (замкнутое, в метрах), сдвинутое наружу на d: вершина уходит на d·(n1+n2)/(1+n1·n2) —
// так обе соседние стены сдвигаются ровно на d; на острых углах сдвиг ограничен 3d.
function inflate(ring: [number, number][], d: number): [number, number][] {
  const pts = ring.slice(0, -1), n = pts.length;
  let area = 0;
  for (let i = 0; i < n; i++) { const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % n]; area += x1 * y2 - x2 * y1; }
  const s = area > 0 ? 1 : -1; // против часовой стрелки наружу — справа от ребра
  const norm = (a: [number, number], c: [number, number]) => { const dx = c[0] - a[0], dy = c[1] - a[1], l = Math.hypot(dx, dy) || 1; return [(s * dy) / l, (-s * dx) / l]; };
  const out = pts.map((p, i) => {
    const [ax, ay] = norm(pts[(i - 1 + n) % n], p), [bx, by] = norm(p, pts[(i + 1) % n]);
    let ox = (d * (ax + bx)) / Math.max(0.05, 1 + ax * bx + ay * by), oy = (d * (ay + by)) / Math.max(0.05, 1 + ax * bx + ay * by);
    const l = Math.hypot(ox, oy);
    if (l > 3 * d) { ox *= (3 * d) / l; oy *= (3 * d) / l; }
    return [p[0] + ox, p[1] + oy] as [number, number];
  });
  return [...out, out[0]];
}

// Фасад: по полоске на каждую стену фасада, от 0,3 до 1,3 м снаружи; null — убрать.
export function drawFacade(b: Bld, f: Facade | null) {
  const n: [number, number] = [Math.sin(f?.normal ?? 0), Math.cos(f?.normal ?? 0)];
  const out = (p: [number, number], d: number) => world.proj.toLonLat(p[0] + n[0] * d, p[1] + n[1] * d);
  setData('facade', (f?.segs ?? []).map(([a, e]) => ({
    type: 'Feature', properties: { top: b.h + 0.5 },
    geometry: { type: 'Polygon', coordinates: [[out(a, 0.3), out(e, 0.3), out(e, 1.3), out(a, 1.3), out(a, 0.3)]] },
  })));
}

// Секторы на карте: зелёный тянется до воды (не дальше 1,2 км), красный — короткий.
export function drawSectors(b: Bld, sea: SeaDir[]) {
  const features: any[] = [];
  for (const [i, { bearing, dist }] of sea.entries()) {
    const dir = t.dirs[i];
    const r = dist != null ? Math.min(dist, 1200) + 25 : 70;
    const ring: [number, number][] = [b.center];
    for (let a = bearing - Math.PI / 8; a <= bearing + Math.PI / 8 + 1e-9; a += Math.PI / 48) ring.push(offset(b.center, a, r));
    ring.push(b.center);
    const sea = dist != null;
    features.push({ type: 'Feature', properties: { sea }, geometry: { type: 'Polygon', coordinates: [ring] } });
    features.push({ type: 'Feature', properties: { i, sea, label: sea ? `${dir}\n${fmtH.format(dist / 1000)} ${t.km}` : `${dir}\n—` }, geometry: { type: 'Point', coordinates: offset(b.center, bearing, 105) } });
  }
  setData('sectors', features);
  updateSectorLabels();
}

// Подписи направлений в 3D налезают на дома: при наклоне камеры больше 45° оставляем только
// подпись румба, ближайшего к выбранному фасаду (а если выбрано всё здание — ни одной; сектора и роза в панели остаются).
const LABEL_PITCH = 45;
export function updateSectorLabels() {
  const point = ['==', ['geometry-type'], 'Point'];
  const flat = map.getPitch() <= LABEL_PITCH;
  map.setFilter('sector-labels', (flat ? point : ['all', point, ['==', ['get', 'i'], facadeOf() ? dirIndex(facadeOf()!.normal) : -1]]) as FilterSpecification);
}
map.on('pitchend', () => map.getLayer('sector-labels') && updateSectorLabels());

// Солнечная диаграмма на земле: кольцо — горизонт, дуга — путь солнца в сезон (светит / тень / за домом).
export function drawSunPath() {
  const b = state.current;
  if (!b) return;
  const ring: [number, number][] = [];
  for (let i = 0; i <= 72; i++) ring.push(offset(b.center, (i * Math.PI) / 36, R_PATH));
  const features: any[] = [{ type: 'Feature', properties: { kind: 'ring' }, geometry: { type: 'LineString', coordinates: ring } }];
  const path = dayPath(world, b, eye(world, b, state.floor, facadeOf()), dayDate());
  for (let i = 0; i + 1 < path.length; i++) {
    if (path[i + 1].t.getTime() - path[i].t.getTime() > STEP_MIN * 60000 * 1.5) continue;
    const s = path[i].lit ? 'lit' : path[i].facing ? 'shade' : 'back';
    features.push({ type: 'Feature', properties: { kind: 'path', state: s }, geometry: { type: 'LineString', coordinates: [pathPoint(b, path[i].altitude, path[i].bearing), pathPoint(b, path[i + 1].altitude, path[i + 1].bearing)] } });
  }
  setData('sunpath', features);
}
