// Вид из окна: камера в точке окна выбранного фасада смотрит наружу по нормали, горизонт посередине кадра.
// Горизонтальный угол обзора — как у кадра windowView(), вертикальный — по пропорциям карты.
import { LngLat, type CameraOptions, type PaddingOptions } from 'maplibre-gl';
import { eye } from '../analysis.ts';
import { world } from '../app.ts';
import type { Bld, Facade } from '../grid.ts';
import { map, offset } from './layers.ts';

const HFOV = 64; // °, = VIEW_H
const AHEAD = 400; // м — точка, на которую смотрит камера, на той же высоте: наклон ровно 90°
// Из окна мешают: подсветка этажа и фасада (камера — внутри синей стенки), секторы, диаграмма и плоские тени на земле.
const HIDE = ['floor', 'facade', 'sectors', 'sectors-line', 'sectors-line-no', 'sector-labels', 'sunpath-ring', 'sunpath', 'sunnow', 'shadows'];

let saved: { camera: CameraOptions; padding: PaddingOptions; fov: number; maxPitch: number } | null = null;
let last: [Bld, number, Facade] | null = null;
export const viewing = () => saved != null;

export function enterView(b: Bld, floor: number, f: Facade) {
  if (!saved) {
    saved = { camera: { center: map.getCenter(), zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch(), roll: map.getRoll() }, padding: map.getPadding(), fov: map.getVerticalFieldOfView(), maxPitch: map.getMaxPitch() };
    for (const id of HIDE) map.setLayoutProperty(id, 'visibility', 'none');
    map.setMaxPitch(90);
    // Иначе центр (он на высоте окна в 400 м впереди) каждый кадр опускается на рельеф и камера уезжает.
    map.setCenterClampedToGround(false);
  }
  last = [b, floor, f];
  const e = eye(world, b, floor, f);
  const at = world.proj.toLonLat(e.x, e.y);
  // Дома на карте стоят на рисованном рельефе (Terrain Tiles), а расчёт — на Copernicus: они расходятся на метры.
  // Камера — на высоте окна над рисованной землёй, чтобы оказаться на своём этаже нарисованного дома.
  const z = (map.queryTerrainElevation(at) ?? b.ground) + e.z - b.ground;
  const c = map.getCanvas();
  map.setVerticalFieldOfView((2 * Math.atan((Math.tan((HFOV * Math.PI) / 360) * c.clientHeight) / c.clientWidth) * 180) / Math.PI);
  const cam = map.calculateCameraOptionsFromTo(new LngLat(...at), z, new LngLat(...offset(at, f.normal, AHEAD)), z);
  map.jumpTo({ ...cam, padding: { top: 0, bottom: 0, left: 0, right: 0 } });
  markCamera();
}

export function exitView() {
  if (!saved) return;
  for (const id of HIDE) map.setLayoutProperty(id, 'visibility', 'visible');
  map.setCenterClampedToGround(true);
  map.setVerticalFieldOfView(saved.fov);
  map.jumpTo({ ...saved.camera, padding: saved.padding });
  map.setMaxPitch(saved.maxPitch);
  saved = last = null;
  markCamera();
}

// Камера после входа и выхода — для e2e, как метка sv:painted.
const markCamera = () => performance.mark('sv:view', { detail: { on: viewing(), pitch: map.getPitch(), bearing: map.getBearing(), zoom: map.getZoom() } });

// Окно карты изменилось — угол обзора и камеру заново.
map.on('resize', () => last && enterView(...last));

// Кадр для PNG-карточки. Буфер WebGL без preserveDrawingBuffer (он включён только в dev) читается
// только внутри кадра, поэтому копируем его в событии render разовой перерисовки.
export async function grabFrame(): Promise<HTMLCanvasElement> {
  if (!map.areTilesLoaded()) await new Promise((r) => map.once('idle', r));
  return new Promise((res) => {
    map.once('render', () => {
      const src = map.getCanvas(), cv = document.createElement('canvas');
      cv.width = src.width; cv.height = src.height;
      cv.getContext('2d')!.drawImage(src, 0, 0);
      res(cv);
    });
    map.triggerRepaint();
  });
}
