import assert from 'node:assert/strict';
import { test } from 'node:test';
import { facades } from '../src/scripts/grid.ts';
import { matrixHtml } from '../src/scripts/ui/matrix-html.ts';
import { makeWorld } from './world.ts';

test('matrixHtml: этажи сверху вниз, лучшая клетка подсвечена, волна — где видно море', () => {
  const w = makeWorld();
  const fs = facades(w, w.blds[0]); // С, В, Ю, З
  // 2 этажа × 4 фасада, ряд этажа 1 — индексы 0..3; лучшая — Ю на 2-м этаже.
  const m = { floors: 2, cols: 4, score: Uint8Array.from([5, 10, 30, 12, 6, 11, 40, 14]), winter: new Uint8Array(8), sea: Uint8Array.from([0, 0, 0, 1, 0, 0, 0, 1]) };
  const html = matrixHtml(fs, m);
  const cells = [...html.matchAll(/data-c="(\d)" data-f="(\d)"[^>]*>(\d+)(<i>∿<\/i>)?</g)].map(([, c, f, v, sea]) => [+f, +c, +v, !!sea]);
  assert.deepEqual(cells.map(([f]) => f), [2, 2, 2, 2, 1, 1, 1, 1]);
  assert.deepEqual(cells.slice(0, 4).map(([, , v]) => v), [6, 11, 40, 14]);
  assert.deepEqual(cells.filter(([, , , sea]) => sea).map(([f, c]) => [f, c]), [[2, 3], [1, 3]]);
  assert.equal(html.match(/class="cell best"/g)?.length, 1);
  assert.match(html, /class="cell best" data-c="2" data-f="2"/);
  assert.equal(html.match(/<th data-c=/g)?.length, 4);
});
