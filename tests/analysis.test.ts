import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eye, seaRose, seasonCalc, floorAt, yearRibbon } from '../src/scripts/analysis.ts';
import { makeWorld } from './world.ts';

test('здание целиком: летом на плоской суше солнце весь день, кроме утра за горой', () => {
  const w = makeWorld();
  const b = w.blds[0];
  const s = seasonCalc(w, b, eye(w, b, 3, null), 1);
  assert.ok(s.daylight > 14 && s.daylight < 16, `день ${s.daylight}`);
  assert.ok(s.sun > s.daylight - 2.5 && s.sun < s.daylight, `солнце ${s.sun} из ${s.daylight}`);
});

test('северный фасад летом видит солнце только утром и вечером, зимой — никогда', () => {
  const w = makeWorld();
  const b = w.blds[0];
  const summer = seasonCalc(w, b, eye(w, b, 3, 0), 1);
  const winter = seasonCalc(w, b, eye(w, b, 3, 0), 3);
  assert.ok(summer.sun > 1 && summer.sun < 6, `лето ${summer.sun}`);
  assert.equal(winter.daylight, 0);
  assert.equal(winter.sun, 0);
});

test('южный фасад зимой: весь день перед фасадом, утро съедает гора на востоке', () => {
  const w = makeWorld();
  const b = w.blds[0];
  const s = seasonCalc(w, b, eye(w, b, 3, 4), 3);
  assert.ok(Math.abs(s.daylight - 9) < 1, `день ${s.daylight}`);
  assert.ok(s.sun > s.daylight - 2 && s.sun < s.daylight, `солнце ${s.sun} из ${s.daylight}`);
});

test('роза моря: только западные румбы', () => {
  const w = makeWorld();
  const rose = seaRose(w, w.blds[0], 2);
  const yes = rose.filter((d) => d.dist != null).map((d) => d.dir);
  assert.deepEqual(yes, ['ЮЗ', 'З', 'СЗ']);
});

test('лента года: 73 столбца × 144 строки, ночь сверху и снизу', () => {
  const w = makeWorld();
  const r = yearRibbon(w, w.blds[0], eye(w, w.blds[0], 1, null));
  assert.equal(r.cols, 73);
  assert.equal(r.rows, 144);
  assert.equal(r.data[0], 0); // полночь UTC, 1 января
  assert.equal(r.data[72 * 73 + 36], 2); // полдень UTC, июль
});

test('этаж для высоты окна на карте', () => {
  const w = makeWorld(); // этаж 3 м: окна на 1,5 / 4,5 / 10,5 м
  assert.equal(floorAt(w, 2), 1);
  assert.equal(floorAt(w, 5), 2);
  assert.equal(floorAt(w, 10), 4);
});
