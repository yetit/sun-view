// Мобильный лист в трёх состояниях: свёрнут (виден таймбар), половина, весь экран.
// Ручка: тап — следующее состояние, протяжка — ближайшее по высоте. На десктопе не используется.
import { $ } from '../app.ts';

const STATES = ['peek', 'half', 'full'] as const;
type Sheet = (typeof STATES)[number];

// grow: только раскрыть (из peek в half), не сворачивать.
export function setSheet(s: Sheet, grow = false) {
  const cur = document.body.dataset.sheet as Sheet;
  if (grow && STATES.indexOf(cur) >= STATES.indexOf(s)) return;
  document.body.dataset.sheet = s;
  $('.sheet-handle').setAttribute('aria-expanded', String(s !== 'peek'));
}

export function initSheet() {
  document.body.dataset.sheet = 'peek';
  const handle = $('.sheet-handle');
  const panel = $('.panel');
  let startY = 0, startH = 0, moved = false;
  handle.addEventListener('pointerdown', (e) => {
    startY = e.clientY; startH = panel.offsetHeight; moved = false;
    handle.setPointerCapture(e.pointerId);
    panel.style.transition = 'none';
  });
  handle.addEventListener('pointermove', (e) => {
    if (!handle.hasPointerCapture(e.pointerId)) return;
    const dy = startY - e.clientY;
    if (Math.abs(dy) > 6) moved = true;
    if (moved) panel.style.height = `${Math.min(innerHeight * 0.92, Math.max(120, startH + dy))}px`;
  });
  handle.addEventListener('pointerup', (e) => {
    handle.releasePointerCapture(e.pointerId);
    panel.style.transition = '';
    const cur = document.body.dataset.sheet as Sheet;
    if (!moved) { setSheet(STATES[(STATES.indexOf(cur) + 1) % 3]); return; }
    const h = panel.offsetHeight / innerHeight;
    panel.style.height = '';
    setSheet(h < 0.3 ? 'peek' : h < 0.7 ? 'half' : 'full');
  });
}
