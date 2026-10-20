// Вид из окна в панели: доли моря и неба в кадре выбранного фасада (воркер) и камера на карте (по кнопке).
import { $, ask, facadeOf, state } from '../app.ts';
import type { Bld } from '../grid.ts';
import { t } from '../i18n.ts';
import { enterView, exitView, viewing } from '../map/window.ts';
import { drawPano } from './charts.ts';
import { setSheet } from './sheet.ts';

let viewReq = 0, viewText = '';
export const currentViewText = () => viewText;

export function loadView(b: Bld) {
  const f = facadeOf(), btn = $<HTMLButtonElement>('.view-btn');
  btn.disabled = !f;
  $('.view-pano').hidden = $('.view-legend').hidden = !f;
  $('.view-stat').textContent = f ? t.viewLoading : t.viewNeedFacade;
  viewText = '';
  if (!f) { setView(false); return; }
  if (viewing()) enterView(b, state.floor, f);
  const my = ++viewReq;
  ask({ type: 'view', idx: b.idx, floor: state.floor, side: state.side, after: state.after }).then((v) => {
    if (my !== viewReq) return;
    viewText = t.viewStat(Math.round(100 * v.sea), Math.round(100 * v.sky));
    $('.view-stat').textContent = $('.view-badge-stat').textContent = viewText;
    drawPano($<HTMLCanvasElement>('.view-pano'), v, viewText);
  });
}

export function setView(on: boolean) {
  const f = facadeOf();
  if (on && state.current && f) {
    enterView(state.current, state.floor, f);
    setSheet('peek');
  } else exitView();
  $('.view-btn').setAttribute('aria-pressed', String(viewing()));
  $('.view-btn').textContent = viewing() ? t.viewClose : t.viewOpen;
  $('.view-badge-stat').textContent = viewText || t.viewLoading;
  $('.view-badge').hidden = !viewing();
  document.body.classList.toggle('viewing', viewing()); // легенда цветов домов из окна не нужна
}

export function initView() {
  $('.view-btn').addEventListener('click', () => setView(!viewing()));
  $('.view-exit').addEventListener('click', () => setView(false));
}
