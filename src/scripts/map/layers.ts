// Карта MapLibre и всё, что рисуется на ней: здания, этаж, фасад, секторы моря, солнечная диаграмма.
import { Map, NavigationControl, setWorkerUrl, type FilterSpecification } from 'maplibre-gl';
import { dayPath, dirIndex, eye, SEASONS, STEP_MIN, type SeaDir } from '../analysis.ts';
import { BASE, city, embed, facadeOf, fmtH, geojson, state, world } from '../app.ts';
import { t } from '../i18n.ts';
import type { Bld, Facade } from '../grid.ts';
import { buildingColor, style } from '../style.ts';

const DEG = 180 / Math.PI;
const R_PATH = 220; // м, радиус солнечной диаграммы вокруг здания

setWorkerUrl(`${BASE}maplibre/maplibre-gl-worker.mjs`);
// В dev буфер сохраняется, чтобы снимать картинки (OG, README) из canvas.
export const map = new Map({ container: 'map', style, ...city.camera, maxPitch: 75, attributionControl: { compact: true }, canvasContextAttributes: { preserveDrawingBuffer: import.meta.env.DEV } });
map.addControl(new NavigationControl({ visualizePitch: true }), 'top-left');
// Событие load может прийти раньше, чем загрузятся данные, — ловим его сразу.
export const mapReady = new Promise<void>((r) => map.once('load', () => r()));
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

export function drawFloor(b: Bld) {
  setData('floor', [{ type: 'Feature', properties: { base: (state.floor - 1) * city.floorHeight, top: state.floor * city.floorHeight }, geometry: geojson.features[b.idx].geometry }]);
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
  const path = dayPath(world, b, eye(world, b, state.floor, facadeOf()), SEASONS[state.season].date);
  for (let i = 0; i + 1 < path.length; i++) {
    if (path[i + 1].t.getTime() - path[i].t.getTime() > STEP_MIN * 60000 * 1.5) continue;
    const s = path[i].lit ? 'lit' : path[i].facing ? 'shade' : 'back';
    features.push({ type: 'Feature', properties: { kind: 'path', state: s }, geometry: { type: 'LineString', coordinates: [pathPoint(b, path[i].altitude, path[i].bearing), pathPoint(b, path[i + 1].altitude, path[i + 1].bearing)] } });
  }
  setData('sunpath', features);
}
