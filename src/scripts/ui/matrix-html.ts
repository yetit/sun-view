// Таблица «этажи × фасады»: столбцы — фасады, строки — этажи сверху вниз, в клетке — годовая оценка и волна,
// если видно море; лучшая клетка подсвечена. Без страницы — проверяется тестом в Node.
import { bestCell, dirIndex } from '../analysis.ts';
import type { Facade } from '../grid.ts';
import { t } from '../i18n.ts';
import { deg, fName, fTitle } from './format.ts';

export type Matrix = { floors: number; cols: number; score: Uint8Array; winter: Uint8Array; sea: Uint8Array };

export function matrixHtml(fs: Facade[], m: Matrix) {
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
