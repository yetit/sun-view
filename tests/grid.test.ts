import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blocked, demAt, groundAt, horizonAngle, makeDem, seaVisible, wallPoint } from '../src/scripts/grid.ts';
import { makeWorld, rect } from './world.ts';

const deg = (d: number) => (d * Math.PI) / 180;
const DIR = { N: 0, E: deg(90), S: deg(180), W: deg(270) };

test('земля и высота здания из DEM и этажей', () => {
  const w = makeWorld();
  const b = w.blds[0];
  assert.equal(b.ground, 10);
  assert.equal(b.h, 15);
  assert.equal(b.floors, 5);
});

test('точка на стене лежит на 1 м снаружи прямоугольника 20×20', () => {
  const b = makeWorld().blds[0];
  const [x, y] = wallPoint(b, DIR.E);
  assert.ok(Math.abs(x - 11) < 0.01 && Math.abs(y) < 0.01, `${x},${y}`);
});

test('гора на востоке закрывает низкое солнце, высокое — нет', () => {
  const w = makeWorld();
  const b = w.blds[0];
  // гора 400 м на 1500 м → угол ≈ 14.6°
  assert.equal(blocked(w, b, 11, 0, 14.5, DIR.E, deg(10)), true);
  assert.equal(blocked(w, b, 11, 0, 14.5, DIR.E, deg(20)), false);
  // на запад и север — свободно
  assert.equal(blocked(w, b, -11, 0, 14.5, DIR.W, deg(10)), false);
  assert.equal(blocked(w, b, 0, 11, 14.5, DIR.N, deg(5)), false);
});

test('соседний дом к югу закрывает солнце нижним этажам, но не верхним', () => {
  const w = makeWorld([{ ring: rect(0, -60, 40, 20), levels: 10 }]); // сосед 30 м в 60 м к югу
  const b = w.blds[0];
  const floor1 = b.ground + 1.5, floor5 = b.ground + 13.5;
  // с 1-го этажа при высоте солнца 20°: на 50 м луч поднялся на 18 м < 30 м → тень
  assert.equal(blocked(w, b, 0, -11, floor1, DIR.S, deg(20)), true);
  // при 40°: 50 м × tan 40° = 42 м > 30 м → свет
  assert.equal(blocked(w, b, 0, -11, floor1, DIR.S, deg(40)), false);
  assert.equal(blocked(w, b, 0, -11, floor5, DIR.S, deg(20)), true); // 13.5 + 18 = 31.5 ≈ край; проверим ниже
  assert.equal(blocked(w, b, 0, -11, floor5, DIR.S, deg(25)), false);
});

test('море видно на запад, не видно на восток и за высокой стеной', () => {
  const w = makeWorld([{ ring: rect(-100, 0, 20, 200), levels: 20 }]); // стена 60 м в 100 м к западу
  const b = w.blds[0];
  const z = b.ground + 1.5;
  assert.equal(seaVisible(w, b, -11, 0, z, DIR.W), null); // стена закрывает
  assert.equal(seaVisible(w, b, 11, 0, z, DIR.E), null); // на востоке моря нет
  // Суша 10 м обрывается в море на 300 м: с высоты 11,5 м линия взгляда через кромку
  // достигает воды на 300 × 11,5 / 1,5 ≈ 2300 м — ближе вода скрыта обрывом.
  const open = makeWorld();
  const d = seaVisible(open, open.blds[0], -11, 0, z, DIR.W);
  assert.ok(d != null && Math.abs(d - 2300) < 150, `дальность ${d}`);
});

test('дальняя вода видна поверх низкого берега с верхнего этажа', () => {
  const w = makeWorld([{ ring: rect(-100, 0, 20, 200), levels: 2 }]); // забор 6 м
  const b = w.blds[0];
  assert.equal(seaVisible(w, b, -11, 0, b.ground + 1.5, DIR.W), null); // с 1-го этажа — нет
  assert.ok(seaVisible(w, b, -11, 0, b.ground + 25, DIR.W) != null); // с высоты 25 м — да
});

test('горизонт рельефа: гора на востоке ≈ 14,4°, на западе — чуть ниже нуля, сходится с blocked()', () => {
  const w = makeWorld();
  const b = w.blds[0];
  const east = horizonAngle(w, 11, 0, 14.5, DIR.E) / deg(1);
  assert.ok(Math.abs(east - 14.4) < 0.5, `восток ${east}`);
  const west = horizonAngle(w, -11, 0, 14.5, DIR.W) / deg(1);
  assert.ok(west < 0 && west > -1, `запад ${west}`); // вода 0 м на краю сетки, глаз на 14,5 м
  assert.equal(blocked(w, b, 11, 0, 14.5, DIR.E, deg(east - 0.3)), true);
  assert.equal(blocked(w, b, 11, 0, 14.5, DIR.E, deg(east + 0.3)), false);
  // from: ближе этого расстояния DEM не читаем — край плато в 1500 м пропущен, угол на него с 2 км
  const far = horizonAngle(w, 11, 0, 14.5, DIR.E, 2000) / deg(1);
  assert.ok(Math.abs(far - (Math.atan2(400 - 14.5, 2000) * 180) / Math.PI) < 0.3, `с 2 км ${far}`);
});

test('рельеф билинейно: на склоне отметка плавная, а не ступенька ячейки; дом не тонет к морю', () => {
  // 4×3 ячейки по 1°: столбец 0 — море (0), дальше склон 100, 130, 160 м на восток; ряды одинаковые
  const data = Int16Array.from({ length: 12 }, (_, i) => [0, 100, 130, 160][i % 4]);
  const dem = makeDem({ bbox: { west: 0, north: 3 }, cols: 4, rows: 3, cell: 1, nodata: -32768, max: 160 }, data.buffer);
  assert.equal(demAt(dem, 1.5, 1.5), 100); // центр ячейки
  assert.equal(demAt(dem, 2.25, 1.5), 122.5); // ¾ пути от центра 1.5 (100 м) к центру 2.5 (130 м)
  assert.equal(demAt(dem, 1.0, 1.5), 50); // между морем и сушей — склон к воде
  assert.equal(demAt(dem, 5, 1.5), null); // за сеткой
  assert.equal(groundAt(dem, 2.25, 1.5), 122.5); // дом на склоне — по склону; минимум соседей дал бы 100
  assert.equal(groundAt(dem, 1.0, 1.5), 100); // у воды — по суше, а не 50
});
