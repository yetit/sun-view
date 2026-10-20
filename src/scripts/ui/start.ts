// Вторая половина запуска: карта MapLibre и интерфейс. Импортируется из boot.ts динамически,
// когда данные уже запрошены, — бандл MapLibre грузится параллельно с ними.
import { $, ask, num, params, state, urlDir } from '../app.ts';
import type { CityData } from '../data.ts';
import { hideFallback, showFallback } from '../fallback.ts';
import type { World } from '../grid.ts';
import { t } from '../i18n.ts';
import { bindBuildings, map, mapReady } from '../map/layers.ts';
import { initRotateHint } from './hint.ts';
import { initKeys } from './keys.ts';
import { initPanel, select } from './panel.ts';
import { applyMode, initTimebar, setPrecomputed, updateLight } from './timebar.ts';

export async function start(world: World, data: CityData, mark: (k: string) => void, timing: Record<string, number>) {
  setPrecomputed(data.precomputed);
  // Карта не загрузилась за 10 с (сеть, сервер тайлов) — сообщение с кнопкой; если догрузится — убираем.
  const slow = setTimeout(() => showFallback(t.mapSlow, true), 10000);
  await mapReady;
  clearTimeout(slow);
  hideFallback();
  mark('map');
  // Карта готова — убрать статичный первый кадр (плавно, затем из DOM).
  const first = document.querySelector<HTMLImageElement>('.first-frame');
  if (first) { first.classList.add('gone'); setTimeout(() => first.remove(), 700); }
  if (import.meta.env.DEV) Object.assign(window, { map, world, timing, ask }); // для проверки и замеров из консоли
  // Двигал ли пользователь карту до восстановления состояния из ссылки: тогда к фасаду её не разворачиваем.
  let moved = false;
  map.once('movestart', (e) => { if ((e as { originalEvent?: Event }).originalEvent) moved = true; });

  initTimebar();
  initPanel();
  bindBuildings(select);
  initKeys();
  initRotateHint();
  const known = world.blds.filter((b) => !b.assumed).length;
  $('.hint').textContent = t.count(world.blds.length, known);
  $('.accuracy').textContent = t.accuracy(Math.round((100 * known) / world.blds.length));
  $('.loading').hidden = true;
  $('.empty').hidden = false;
  updateLight();
  await applyMode();
  mark('painted');
  map.on('moveend', () => !state.current && updateLight()); // тени вокруг центра карты
  const b = world.blds.find((x) => x.id === num(params.get('b'), -1));
  if (b) select(b, { floor: num(params.get('f'), 0) || undefined, side: state.side, dir: urlDir, floors: state.floorsOverride, face: !moved, push: false });
}
