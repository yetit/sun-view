// Карта MapLibre и всё, что рисуется на ней: здания, этаж, секторы моря, солнечная диаграмма.
import { Map, NavigationControl, setWorkerUrl } from 'maplibre-gl';
import { dayPath, eye, SEASONS, STEP_MIN, type SeaDir } from '../analysis.ts';
import { BASE, city, fmtH, geojson, state, world } from '../app.ts';
import type { Bld } from '../grid.ts';
import { buildingColor, style } from '../style.ts';

const DEG = 180 / Math.PI;
const R_PATH = 220; // м, радиус солнечной диаграммы вокруг здания

setWorkerUrl(`${BASE}maplibre/maplibre-gl-worker.mjs`);
export const map = new Map({ container: 'map', style, ...city.camera, maxPitch: 75, attributionControl: { compact: true } });
map.addControl(new NavigationControl({ visualizePitch: true }), 'top-left');

// Точка на расстоянии dist (м) по азимуту bearing (рад) от lngLat.
export function offset([lon, lat]: [number, number], bearing: number, dist: number): [number, number] {
  return [lon + (dist * Math.sin(bearing)) / (111320 * Math.cos(lat / DEG)), lat + (dist * Math.cos(bearing)) / 111320];
}
// Положение солнца на наземной диаграмме: зенит — центр, горизонт — кольцо.
export const pathPoint = (b: Bld, altitude: number, bearing: number) => offset(b.center, bearing, R_PATH * (1 - altitude / (Math.PI / 2)));
export const setData = (id: string, features: any[]) => (map.getSource(id) as any).setData({ type: 'FeatureCollection', features });
export const applyColors = () => map.setPaintProperty('buildings', 'fill-extrusion-color', buildingColor(state.mode, !!state.current) as any);

// Здания: данные, клик и подсветка при наведении.
export function bindBuildings(onSelect: (b: Bld) => void) {
  (map.getSource('buildings') as any).setData(geojson);
  map.on('click', 'buildings', (e) => { const b = world.blds.find((x) => x.id === e.features![0].id); if (b) onSelect(b); });
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
}

export function drawFloor(b: Bld) {
  setData('floor', [{ type: 'Feature', properties: { base: (state.floor - 1) * city.floorHeight, top: state.floor * city.floorHeight }, geometry: geojson.features[b.idx].geometry }]);
}

// Секторы на карте: зелёный тянется до воды (не дальше 1,2 км), красный — короткий.
export function drawSectors(b: Bld, sea: SeaDir[]) {
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
export function drawSunPath() {
  const b = state.current;
  if (!b) return;
  const ring: [number, number][] = [];
  for (let i = 0; i <= 72; i++) ring.push(offset(b.center, (i * Math.PI) / 36, R_PATH));
  const features: any[] = [{ type: 'Feature', properties: { kind: 'ring' }, geometry: { type: 'LineString', coordinates: ring } }];
  const path = dayPath(world, b, eye(world, b, state.floor, state.side), SEASONS[state.season].date);
  for (let i = 0; i + 1 < path.length; i++) {
    if (path[i + 1].t.getTime() - path[i].t.getTime() > STEP_MIN * 60000 * 1.5) continue;
    const s = path[i].lit ? 'lit' : path[i].facing ? 'shade' : 'back';
    features.push({ type: 'Feature', properties: { kind: 'path', state: s }, geometry: { type: 'LineString', coordinates: [pathPoint(b, path[i].altitude, path[i].bearing), pathPoint(b, path[i + 1].altitude, path[i + 1].bearing)] } });
  }
  setData('sunpath', features);
}
