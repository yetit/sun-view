import type { StyleSpecification } from 'maplibre-gl';

// Светлая карта: подложка OpenFreeMap, рельеф Terrain Tiles (только для показа — расчёт идёт по Copernicus DEM
// из data/), здания — наш GeoJSON из OSM, стандартные здания OpenMapTiles не рисуем.
const terrarium = {
  type: 'raster-dem' as const,
  tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
  encoding: 'terrarium' as const,
  tileSize: 256,
  maxzoom: 15,
  attribution: '<a href="https://registry.opendata.aws/terrain-tiles/">Terrain Tiles</a>',
};

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
    buildings: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    rays: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
  },
  terrain: { source: 'dem', exaggeration: 1 },
  sky: { 'sky-color': '#9fc3e6', 'horizon-color': '#e8eef2', 'fog-color': '#eef1f3', 'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.6, 'atmosphere-blend': 0 },
  layers: [
    { id: 'land', type: 'background', paint: { 'background-color': '#e8e3d8' } },
    { id: 'landcover', type: 'fill', source: 'omt', 'source-layer': 'landcover', paint: { 'fill-color': '#d4dcc3', 'fill-opacity': 0.7 } },
    { id: 'shade', type: 'hillshade', source: 'hillshade', paint: { 'hillshade-shadow-color': '#6b6557', 'hillshade-highlight-color': '#ffffff', 'hillshade-exaggeration': 0.35 } },
    { id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water', paint: { 'fill-color': '#8fb9d6' } },
    {
      id: 'roads', type: 'line', source: 'omt', 'source-layer': 'transportation',
      filter: ['match', ['get', 'class'], ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service'], true, false],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 11, 0.5, 16, 5] },
    },
    {
      id: 'buildings', type: 'fill-extrusion', source: 'buildings',
      paint: {
        'fill-extrusion-color': ['case', ['boolean', ['feature-state', 'selected'], false], '#ff7a1a', ['get', 'assumed'], '#c9c2b6', '#a89f90'],
        'fill-extrusion-height': ['get', 'h'],
        'fill-extrusion-opacity': 0.92,
      },
    },
    {
      id: 'rays', type: 'line', source: 'rays',
      layout: { 'line-cap': 'round' },
      paint: { 'line-color': ['case', ['get', 'sea'], '#1a9c6b', '#d9534f'], 'line-width': 3, 'line-opacity': 0.9 },
    },
    {
      id: 'ray-labels', type: 'symbol', source: 'rays',
      layout: { 'symbol-placement': 'line-center', 'text-field': ['get', 'dir'], 'text-size': 12, 'text-font': ['Noto Sans Regular'], 'text-offset': [0, -0.8] },
      paint: { 'text-color': ['case', ['get', 'sea'], '#1a9c6b', '#d9534f'], 'text-halo-color': '#fff', 'text-halo-width': 1.5 },
    },
  ],
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
};
