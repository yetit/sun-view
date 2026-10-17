// Матрица «этажи × фасады» и годовая оценка окна по BRE. Матрица считается в воркере один раз на здание
// (и при уточнении этажности); из неё же — оценка в панели, чтобы числа в матрице и в панели совпадали.
import { bestCell, breCell, dirIndex } from '../analysis.ts';
import { $, $$, ask, currentFacades, state } from '../app.ts';
import type { Bld, Facade } from '../grid.ts';
import { t } from '../i18n.ts';
import { deg, fName, fTitle } from './format.ts';

type Matrix = { floors: number; cols: number; score: Uint8Array; winter: Uint8Array; sea: Uint8Array };
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

function matrixHtml(fs: Facade[], m: Matrix) {
  const best = bestCell(m);
  const max = Math.max(...m.score);
  const head = fs.map((f, c) => `<th data-c="${c}" title="${fTitle(f)}">${t.dirs[dirIndex(f.normal)]}<small>${deg(f)}°</small><small>${Math.round(f.len)} ${t.m}</small></th>`).join('');
  const rows = [];
  for (let fl = m.floors; fl >= 1; fl--) {
    const cells = fs.map((f, c) => {
      const k = (fl - 1) * m.cols + c, score = m.score[k], sea = m.sea[k];
      const label = t.matrixCell(fl, fName(f), score, m.winter[k], sea) + (k === best ? ` (${t.best})` : '');
      return `<td><button type="button" class="cell${k === best ? ' best' : ''}" data-c="${c}" data-f="${fl}" style="--v:${max ? Math.round((100 * score) / max) : 0}%" aria-label="${label}" title="${label}">${score}${sea ? '<i>∿</i>' : ''}</button></td>`;
    });
    rows.push(`<tr><th>${fl}</th>${cells.join('')}</tr>`);
  }
  return `<table><thead><tr><th>${t.fl}</th>${head}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
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
  const notes = [t.bre.detail(r.a.year, r.a.winter)];
  if (state.side == null) notes.push(t.bre.best(fName(f)));
  return `<div class="bre" data-v="${r.v}" style="--pct:${r.a.year}%"><strong>${r.a.year}<small>${t.bre.of}</small></strong><b>${t.bre.title}</b><em>${t.bre.verdict[r.v]}</em><small>${notes.join(' · ')}</small><i></i></div><details class="more"><summary>${t.bre.how}</summary><p class="legend">${t.bre.legend}</p></details>`;
}
