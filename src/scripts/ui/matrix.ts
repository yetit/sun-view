// Матрица «этажи × фасады» и годовая оценка окна по BRE. Матрица считается в воркере один раз на здание
// (и при уточнении этажности); из неё же — оценка в панели, чтобы числа в матрице и в панели совпадали.
import { breCell } from '../analysis.ts';
import { $, $$, ask, currentFacades, state, world } from '../app.ts';
import type { Bld } from '../grid.ts';
import { t } from '../i18n.ts';
import { fName } from './format.ts';
import { matrixHtml, type Matrix } from './matrix-html.ts';

let matrix: Matrix | null = null;
let matrixReq = 0;

// onReady — когда матрица посчитана (панель перерисует оценку и сводку).
export function loadMatrix(b: Bld, onReady: () => void) {
  const box = $('.matrix');
  const fs = currentFacades();
  matrix = null;
  box.innerHTML = `<p class="legend">${fs.length ? t.matrixLoading : t.matrixNone}</p>`;
  if (!fs.length) return;
  const my = ++matrixReq;
  ask({ type: 'matrix', idx: b.idx, floors: b.floors }).then((m) => {
    if (my !== matrixReq) return;
    box.innerHTML = matrixHtml(fs, m);
    matrix = m;
    markMatrix();
    onReady();
  });
}

// Выбранная клетка в матрице.
export const markMatrix = () => matrix && $$<HTMLButtonElement>('.matrix .cell').forEach((el) => el.setAttribute('aria-pressed', String(+el.dataset.f! === state.floor && +el.dataset.c! === (state.side ?? -1))));

// Годовая оценка текущего окна (см. breCell). null — матрица ещё не посчитана.
export const breNow = () => (matrix ? breCell(matrix, currentFacades().map((f) => f.normal), state.floor, state.side) : null);

export function breHtml() {
  const fs = currentFacades(), r = breNow();
  if (!fs.length) return `<p class="legend">${t.bre.none}</p>`;
  if (!r) return `<p class="legend">${t.bre.loading}</p>`;
  const f = fs[r.c];
  const notes = [t.bre.detail(r.a.year, r.a.winter, !!world.sunshine)];
  if (state.side == null) notes.push(t.bre.best(fName(f)));
  return `<div class="bre" data-v="${r.v}" style="--pct:${r.a.year}%"><strong>${r.a.year}<small>${t.bre.of}</small></strong><b>${t.bre.title}</b><em>${t.bre.verdict[r.v]}</em><small>${notes.join(' · ')}</small><i></i></div><details class="more"><summary>${t.bre.how}</summary><p class="legend">${t.bre.legend}</p></details>`;
}
