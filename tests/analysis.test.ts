import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bestCell, eye, facadeMatrix, seaRose, seasonCalc, floorAt, reliability, windowView, yearRibbon } from '../src/scripts/analysis.ts';
import { facades } from '../src/scripts/grid.ts';
import { makeWorld, rect } from './world.ts';

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
  const summer = seasonCalc(w, b, eye(w, b, 3, facades(w, b)[0]), 1);
  const winter = seasonCalc(w, b, eye(w, b, 3, facades(w, b)[0]), 3);
  assert.ok(summer.sun > 1 && summer.sun < 6, `лето ${summer.sun}`);
  assert.equal(winter.daylight, 0);
  assert.equal(winter.sun, 0);
});

test('южный фасад зимой: весь день перед фасадом, утро съедает гора на востоке', () => {
  const w = makeWorld();
  const b = w.blds[0];
  const s = seasonCalc(w, b, eye(w, b, 3, facades(w, b)[2]), 3);
  assert.ok(Math.abs(s.daylight - 9) < 1, `день ${s.daylight}`);
  assert.ok(s.sun > s.daylight - 2 && s.sun < s.daylight, `солнце ${s.sun} из ${s.daylight}`);
});

test('роза моря: только западные румбы', () => {
  const w = makeWorld();
  const rose = seaRose(w, w.blds[0], 2);
  const yes = rose.filter((d) => d.dist != null).map((d) => d.dir);
  assert.deepEqual(yes, ['ЮЗ', 'З', 'СЗ']);
});

test('вид из окна: на запад — небо над горизонтом и полоса моря, на восток — гора и никакого моря', () => {
  const w = makeWorld();
  const b = w.blds[0];
  const fs = facades(w, b);
  const west = fs.find((f) => Math.abs(f.normal - (3 * Math.PI) / 2) < 0.1)!, east = fs.find((f) => Math.abs(f.normal - Math.PI / 2) < 0.1)!;
  const v = windowView(w, b, eye(w, b, 5, west));
  assert.equal(v.cols, 33);
  assert.equal(v.rows, 41);
  assert.ok(Math.abs(v.sky - 21 / 41) < 0.01, `небо ${v.sky}`); // всё, что не ниже горизонта
  assert.ok(v.sea > 0.01 && v.sea < 0.1, `море ${v.sea}`); // узкая полоса под горизонтом, ниже — суша
  const e = windowView(w, b, eye(w, b, 5, east));
  assert.equal(e.sea, 0);
  assert.ok(e.sky < v.sky, `небо на восток ${e.sky}`); // гора 400 м закрывает низ неба
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

test('надёжность: ровное место с этажностью — высокая; предположено, склон, лес — ниже', () => {
  const w = makeWorld([
    { ring: rect(300, 0, 10, 10), levels: null }, // этажность предположена
    { ring: rect(1500, 300, 10, 10), levels: 3 }, // на уступе 10 → 400 м
    { ring: rect(1500, -300, 10, 10), levels: null },
  ], [rect(0, 200, 60, 40)]); // лес в 180 м от дома 0 — не в счёт
  assert.deepEqual(reliability(w, w.blds[0]), { level: 'high', reasons: [], drop: 0 });
  assert.deepEqual(reliability(w, w.blds[1]).reasons, ['assumed']);
  assert.equal(reliability(w, w.blds[1]).level, 'medium');
  assert.deepEqual(reliability(w, w.blds[2]).reasons, ['slope']);
  assert.equal(reliability(w, w.blds[3]).level, 'low');
  assert.deepEqual(reliability(w, w.blds[1], false).reasons, []); // этажность уточнил пользователь
  const wood = makeWorld([], [rect(0, 30, 60, 30)]); // лес в 15 м к северу от стены
  assert.deepEqual(reliability(wood, wood.blds[0]).reasons, ['trees']);
});

test('матрица «этажи × фасады»: море с запада и косыми лучами с севера и юга, лучшая клетка — юг наверху', () => {
  const w = makeWorld();
  const m = facadeMatrix(w, w.blds[0]); // 5 этажей × фасады С, В, Ю, З
  assert.equal(m.cols, 4);
  assert.equal(m.sun.length, 20);
  const at = (fl: number, c: number) => (fl - 1) * m.cols + c;
  assert.equal(m.sun[at(3, 0)], 0); // север зимой
  assert.ok(m.sun[at(3, 2)] > m.sun[at(3, 1)] && m.sun[at(3, 2)] > m.sun[at(3, 3)], 'юг солнечнее востока и запада');
  // море на западе: С и Ю видят его лучом в ±45° (на СЗ и ЮЗ), В — нет, З — больше всех
  assert.deepEqual([0, 1, 2].map((c) => m.sea[at(5, c)]), [1, 0, 1]);
  assert.ok(m.sea[at(5, 3)] > 1, `запад ${m.sea[at(5, 3)]}`);
  assert.equal(bestCell(m), at(5, 2));
});

test('лучшая клетка: солнце, затем море, затем выше этаж; пустая матрица — нет лучшей', () => {
  const sea = Uint8Array.from([0, 2, 1, 0]);
  assert.equal(bestCell({ cols: 2, sun: [1, 3, 3, 2], sea }), 1); // 3 ч и море 2 > 3 ч и море 1
  assert.equal(bestCell({ cols: 2, sun: [3, 3, 3, 3], sea: [1, 1, 1, 1] }), 2); // всё равно — верхний этаж
  assert.equal(bestCell({ cols: 2, sun: [0, 0, 0, 0], sea: [0, 0, 0, 0] }), -1);
});
