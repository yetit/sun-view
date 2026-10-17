// Клавиатура на карте: фокус на карте → Enter выбирает здание в центре, стрелки — ближайшее здание
// в эту сторону экрана (с учётом поворота карты), Esc снимает выбор. Стрелки MapLibre (сдвиг карты)
// отключены: карта и так перелетает к выбранному зданию.
import { $, state, world } from '../app.ts';
import type { Bld } from '../grid.ts';
import { t } from '../i18n.ts';
import { map } from '../map/layers.ts';
import { deselect, select } from './panel.ts';

const SCREEN: Record<string, number> = { ArrowUp: 0, ArrowRight: 90, ArrowDown: 180, ArrowLeft: 270 };
const CONE = Math.PI / 3; // ±60° от направления

function nearestToCenter(): Bld | null {
  const c = map.getCenter();
  const [x, y] = world.proj.toXY(c.lng, c.lat);
  let best: Bld | null = null, bd = Infinity;
  for (const b of world.blds) { const d = Math.hypot(b.xy[0] - x, b.xy[1] - y); if (d < bd) { bd = d; best = b; } }
  return best;
}

// Ближайшее здание в секторе направления; дальше по углу — дороже.
function step(from: Bld, screenDeg: number): Bld | null {
  const a = ((map.getBearing() + screenDeg) * Math.PI) / 180;
  const dx = Math.sin(a), dy = Math.cos(a);
  let best: Bld | null = null, bs = Infinity;
  for (const b of world.blds) {
    if (b === from) continue;
    const vx = b.xy[0] - from.xy[0], vy = b.xy[1] - from.xy[1];
    const d = Math.hypot(vx, vy), along = vx * dx + vy * dy;
    if (d < 1 || along <= 0) continue;
    const ang = Math.acos(Math.min(1, along / d));
    if (ang > CONE) continue;
    const score = d * (1 + 2 * ang);
    if (score < bs) { bs = score; best = b; }
  }
  return best;
}

export function initKeys() {
  map.keyboard.disable();
  const canvas = map.getCanvas();
  canvas.setAttribute('aria-label', t.mapKeys);
  canvas.setAttribute('aria-keyshortcuts', 'Enter ArrowUp ArrowRight ArrowDown ArrowLeft Escape');
  const hint = $('.map-keys');
  hint.textContent = t.mapKeysShort;
  canvas.addEventListener('focus', () => (hint.hidden = !canvas.matches(':focus-visible')));
  canvas.addEventListener('blur', () => (hint.hidden = true));
  canvas.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const b = nearestToCenter(); if (b) select(b); }
    else if (e.key === 'Escape') deselect();
    else if (e.key in SCREEN) {
      const from = state.current;
      const b = from ? step(from, SCREEN[e.key]) : nearestToCenter();
      if (b) select(b);
    } else return;
    e.preventDefault();
    e.stopPropagation(); // иначе глобальные стрелки таймбара сдвинули бы время
  });
}
