// Подсказка о повороте карты — один раз: при первом заходе, до первого поворота рукой или клика по ней.
// Запоминается в localStorage (может быть недоступен — тогда просто покажется снова). В embed не показываем.
import { $, embed } from '../app.ts';
import { t } from '../i18n.ts';
import { map } from '../map/layers.ts';

const KEY = 'sv:rotate-hint';

export function initRotateHint() {
  if (embed) return;
  try { if (localStorage.getItem(KEY)) return; } catch { /* без хранилища — покажем */ }
  const el = $<HTMLButtonElement>('.rotate-hint');
  el.textContent = matchMedia('(pointer: coarse)').matches ? t.rotateTouch : t.rotateMouse;
  el.title = t.rotateHide;
  el.hidden = false;
  const done = () => {
    el.hidden = true;
    map.off('rotatestart', onRotate);
    try { localStorage.setItem(KEY, '1'); } catch { /* не запомнили — не страшно */ }
  };
  // Поворот камерой к фасаду — программный, у него нет originalEvent: подсказку он не снимает.
  const onRotate = (e: { originalEvent?: Event }) => e.originalEvent && done();
  map.on('rotatestart', onRotate);
  el.addEventListener('click', done);
}
