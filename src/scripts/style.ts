import type { StyleSpecification } from 'maplibre-gl';

// Тёплая «бумажная» карта: подложка OpenFreeMap, рельеф Terrain Tiles (только для показа — расчёт идёт
// по Copernicus DEM из data/), здания — наш GeoJSON из OSM; стандартные здания OpenMapTiles не рисуем.
const terrarium = {
  type: 'raster-dem' as const,
  tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
  encoding: 'terrarium' as const,
  tileSize: 256,
  maxzoom: 15,
  attribution: '<a href="https://registry.opendata.aws/terrain-tiles/">Terrain Tiles</a>',
};
const empty = () => ({ type: 'geojson' as const, data: { type: 'FeatureCollection' as const, features: [] } });

export const COLORS = { known: '#b7ab97', assumed: '#d3cbbd', hover: '#9c8f78', selected: '#efe2cd', floor: '#ff7a1a', sea: '#1a9c6b', noSea: '#d9534f', lit: '#ffb703', shade: '#8c8c8c' };

export type Mode = 'normal' | 'sun' | 'sea';
export const SUN_RAMP = ['#3b4a6b', '#d8c9a3', '#ffd23f'];
export const SEA_RAMP = ['#e2ddd2', '#bfe4d4', '#6cc4a1', '#2aa377', '#0b6b47'];

// Цвет зданий: обычный режим, «карта солнца» (доля светового дня с солнцем в окнах)
// или «карта моря» (сколько румбов с водой). Значение — feature-state v.
export function buildingColor(mode: Mode, dim: boolean) {
  const sel = ['boolean', ['feature-state', 'selected'], false];
  const hov = ['boolean', ['feature-state', 'hover'], false];
  const v = ['coalesce', ['feature-state', 'v'], 0];
  const base =
    mode === 'sun' ? ['interpolate', ['linear'], v, 0.3, SUN_RAMP[0], 0.65, SUN_RAMP[1], 0.95, SUN_RAMP[2]]
    : mode === 'sea' ? ['step', v, SEA_RAMP[0], 1, SEA_RAMP[1], 3, SEA_RAMP[2], 5, SEA_RAMP[3], 7, SEA_RAMP[4]]
    : dim ? ['case', ['get', 'assumed'], '#e4dfd5', '#d9d2c5']
    : ['case', ['get', 'assumed'], COLORS.assumed, COLORS.known];
  return ['case', sel, COLORS.selected, hov, COLORS.hover, base];
}

export const style: StyleSpecification = {
  version: 8,
  sources: {
    omt: {
      type: 'vector',
      url: 'https://tiles.openfreemap.org/planet',
      attribution: '<a href="https://openfreemap.org">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/">OpenMapTiles</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    },
    dem: terrarium,
    hillshade: terrarium, // отдельный источник: делить raster-dem между terrain и hillshade не рекомендуется
    buildings: empty(),
    floor: empty(), // подсветка выбранного этажа
    sectors: empty(), // секторы видимости моря
    sunpath: empty(), // солнечная диаграмма вокруг здания
    sunnow: empty(), // солнце в момент ползунка
    shadows: empty(), // тени выбранного здания и соседей на земле
  },
  terrain: { source: 'dem', exaggeration: 1 },
  light: { anchor: 'map', position: [1.5, 180, 40], intensity: 0.45 },
  sky: { 'sky-color': '#a7c8e8', 'horizon-color': '#f3e9d8', 'fog-color': '#f1ece2', 'sky-horizon-blend': 0.7, 'horizon-fog-blend': 0.7, 'fog-ground-blend': 0.7, 'atmosphere-blend': 0 },
  layers: [
    { id: 'land', type: 'background', paint: { 'background-color': '#ede6d8' } },
    { id: 'landcover', type: 'fill', source: 'omt', 'source-layer': 'landcover', paint: { 'fill-color': ['match', ['get', 'class'], 'wood', '#cdd5b6', 'grass', '#dbe0c4', '#e2ddcc'], 'fill-opacity': 0.8 } },
    { id: 'shade', type: 'hillshade', source: 'hillshade', paint: { 'hillshade-shadow-color': '#7a6a52', 'hillshade-highlight-color': '#fffaf0', 'hillshade-accent-color': '#b9a98c', 'hillshade-exaggeration': 0.5 } },
    { id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water', paint: { 'fill-color': '#7fb0d2' } },
    { id: 'water-edge', type: 'line', source: 'omt', 'source-layer': 'water', paint: { 'line-color': '#5f93b8', 'line-width': 1, 'line-opacity': 0.6 } },
    {
      id: 'roads', type: 'line', source: 'omt', 'source-layer': 'transportation',
      filter: ['match', ['get', 'class'], ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service'], true, false],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#fffdf8', 'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 11, 0.5, 16, 5] },
    },
    { id: 'sectors', type: 'fill', source: 'sectors', paint: { 'fill-color': ['case', ['get', 'sea'], COLORS.sea, COLORS.noSea], 'fill-opacity': ['case', ['get', 'sea'], 0.28, 0.22] } },
    { id: 'shadows', type: 'fill', source: 'shadows', paint: { 'fill-color': '#2b2a3a', 'fill-opacity': 0.22, 'fill-antialias': false } },
    { id: 'sectors-line', type: 'line', source: 'sectors', filter: ['==', ['get', 'sea'], true], paint: { 'line-color': COLORS.sea, 'line-width': 1.4, 'line-opacity': 0.85 } },
    // Без моря — пунктир: различимо и без цвета.
    { id: 'sectors-line-no', type: 'line', source: 'sectors', filter: ['==', ['get', 'sea'], false], paint: { 'line-color': COLORS.noSea, 'line-width': 1.2, 'line-opacity': 0.8, 'line-dasharray': [2, 2] } },
    { id: 'sunpath-ring', type: 'line', source: 'sunpath', filter: ['==', ['get', 'kind'], 'ring'], paint: { 'line-color': '#7a6a52', 'line-width': 1, 'line-dasharray': [2, 2], 'line-opacity': 0.6 } },
    {
      id: 'sunpath', type: 'line', source: 'sunpath', filter: ['==', ['get', 'kind'], 'path'], layout: { 'line-cap': 'round' },
      paint: { 'line-color': ['match', ['get', 'state'], 'lit', COLORS.lit, 'shade', COLORS.shade, '#cfc7ba'], 'line-width': ['match', ['get', 'state'], 'back', 2, 4] },
    },
    // Этажность известна — плотные объёмы; предположена — полупрозрачные (opacity не зависит от данных,
    // поэтому два слоя с фильтром).
    {
      id: 'buildings', type: 'fill-extrusion', source: 'buildings', filter: ['!=', ['get', 'assumed'], true],
      paint: { 'fill-extrusion-color': buildingColor('normal', false) as any, 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-opacity': 0.95 },
    },
    {
      id: 'buildings-assumed', type: 'fill-extrusion', source: 'buildings', filter: ['==', ['get', 'assumed'], true],
      paint: { 'fill-extrusion-color': buildingColor('normal', false) as any, 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-opacity': 0.55 },
    },
    {
      id: 'floor', type: 'fill-extrusion', source: 'floor',
      paint: { 'fill-extrusion-color': COLORS.floor, 'fill-extrusion-base': ['get', 'base'], 'fill-extrusion-height': ['get', 'top'], 'fill-extrusion-opacity': 1 },
    },
    { id: 'sunnow', type: 'circle', source: 'sunnow', paint: { 'circle-radius': 7, 'circle-color': COLORS.lit, 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } },
    {
      id: 'sector-labels', type: 'symbol', source: 'sectors', filter: ['==', ['geometry-type'], 'Point'],
      layout: { 'text-field': ['get', 'label'], 'text-size': 12, 'text-font': ['Noto Sans Bold'], 'text-allow-overlap': true },
      paint: { 'text-color': ['case', ['get', 'sea'], COLORS.sea, COLORS.noSea], 'text-halo-color': '#fff', 'text-halo-width': 1.5 },
    },
  ],
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
};
