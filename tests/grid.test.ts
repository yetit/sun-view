import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blocked, defaultFloors, demAt, facades, groundAt, HIT, horizonAngle, makeDem, nearestFacade, rayHit, seaVisible, wallPoint } from '../src/scripts/grid.ts';
import { bilinear } from '../scripts/resample.mjs';
import { makeWorld, poly, rect } from './world.ts';

const deg = (d: number) => (d * Math.PI) / 180;
const DIR = { N: 0, E: deg(90), S: deg(180), W: deg(270) };

test('земля и высота здания из DEM и этажей', () => {
  const w = makeWorld();
  const b = w.blds[0];
  assert.equal(b.ground, 10);
  assert.equal(b.h, 15);
  assert.equal(b.floors, 5);
});

test('этажность по умолчанию: хозпостройки, руины и маленькие контуры — 1 этаж, остальное — 2', () => {
  assert.equal(defaultFloors('yes', 120), 2);
  assert.equal(defaultFloors(null, 120), 2);
  assert.equal(defaultFloors('yes', 30), 1);
  for (const type of ['shed', 'garage', 'garages', 'carport', 'container', 'roof', 'ruins', 'construction']) assert.equal(defaultFloors(type, 200), 1, type);
  const w = makeWorld([
    { ring: rect(200, 0, 10, 10), levels: null }, // 100 м², yes
    { ring: rect(250, 0, 5, 6), levels: null }, // 30 м²
    { ring: rect(300, 0, 10, 10), levels: null, building: 'garage' },
    { ring: rect(350, 0, 10, 10), levels: 0 }, // 0 этажей в OSM — нет данных
    { ring: rect(400, 0, 10, 10), levels: null, height: 9 },
  ]);
  assert.deepEqual(w.blds.slice(1).map((b) => [b.floors, b.h, b.assumed]), [[2, 6, true], [1, 3, true], [1, 3, true], [2, 6, true], [3, 9, false]]);
  assert.equal(w.blds[4].levels, null);
});

test('точка на стене лежит на 1 м снаружи прямоугольника 20×20', () => {
  const b = makeWorld().blds[0];
  const [x, y] = wallPoint(b, DIR.E);
  assert.ok(Math.abs(x - 11) < 0.01 && Math.abs(y) < 0.01, `${x},${y}`);
});

const degs = (fs: { normal: number }[]) => fs.map((f) => Math.round((f.normal * 180) / Math.PI));
const near = (a: number, b: number, eps = 0.05) => Math.abs(a - b) < eps;

test('фасады прямоугольника 20×20: четыре стены, нормали наружу, окно в 1 м от середины', () => {
  const w = makeWorld();
  const fs = facades(w, w.blds[0]);
  assert.deepEqual(degs(fs), [0, 90, 180, 270]);
  assert.ok(fs.every((f) => near(f.len, 20)));
  assert.deepEqual(fs.map((f) => [Math.round(f.x), Math.round(f.y)]), [[0, 11], [11, 0], [0, -11], [-11, 0]]);
});

test('фасады повёрнутого дома при обходе по часовой: нормали наружу, порядок от севера', () => {
  const a = (30 * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const pts = [[-15, -5], [-15, 5], [15, 5], [15, -5]].map(([x, y]) => [300 + x * c + y * s, -x * s + y * c]); // по часовой, повёрнут на 30°
  const w = makeWorld([{ ring: poly(pts), levels: 3 }]);
  const b = w.blds[1];
  const fs = facades(w, b);
  assert.deepEqual(degs(fs), [30, 120, 210, 300]);
  for (const f of fs) assert.ok((f.x - b.xy[0]) * Math.sin(f.normal) + (f.y - b.xy[1]) * Math.cos(f.normal) > 0, 'окно снаружи по нормали');
  assert.deepEqual(fs.map((f) => Math.round(f.len)), [30, 10, 30, 10]);
});

test('стена из нескольких рёбер почти на одной прямой — один фасад; стена короче 4 м — не фасад', () => {
  // южная стена 30 м разбита двумя точками с изломом 3°, торцы 3 м
  const w = makeWorld([{ ring: poly([[300, 0], [310, -0.5], [320, -0.5], [330, 0], [330, 3], [300, 3]]), levels: 3 }]);
  const fs = facades(w, w.blds[1]);
  assert.deepEqual(degs(fs), [0, 180]);
  assert.ok(near(fs[1].len, 30) && near(fs[1].x, 315, 0.1) && fs[1].y < -0.5, `${fs[1].len} ${fs[1].x},${fs[1].y}`);
});

test('общая стена с соседом — не фасад', () => {
  const w = makeWorld([{ ring: rect(300, 0, 20, 10), levels: 3 }, { ring: rect(320, 0, 20, 10), levels: 3 }]); // общая стена x = 310
  assert.deepEqual(degs(facades(w, w.blds[1])), [0, 180, 270]);
  assert.deepEqual(degs(facades(w, w.blds[2])), [0, 90, 180]);
  // сосед закрывает 4 м из 10 восточной стены — фасадом остаются открытые 6 м, окно посередине них
  const half = makeWorld([{ ring: rect(300, 0, 20, 10), levels: 3 }, { ring: rect(315, 3, 10, 4), levels: 3 }]);
  const east = facades(half, half.blds[1]).find((f) => near(f.normal, Math.PI / 2))!;
  assert.ok(near(east.len, 6, 0.2) && near(east.y, -2, 0.2), `${east.len} ${east.y}`);
});

test('ступенька в 1,5 м — один фасад из двух стен; крыло в 10 м впереди — отдельный фасад', () => {
  // южная сторона: стена 0..10 на y=0, ступенька, стена 10..30 на y=-1.5 (один фасад); затем L-крыло
  const step = makeWorld([{ ring: poly([[300, 0], [310, 0], [310, -1.5], [330, -1.5], [330, 10], [300, 10]]), levels: 3 }]);
  const south = facades(step, step.blds[1]).filter((f) => near(f.normal, Math.PI));
  assert.equal(south.length, 1);
  assert.equal(south[0].segs.length, 2);
  assert.ok(near(south[0].len, 30) && near(south[0].x, 320, 0.1), 'окно — на самой длинной стене');
  const ell = makeWorld([{ ring: poly([[300, 0], [310, 0], [310, -10], [330, -10], [330, 10], [300, 10]]), levels: 3 }]);
  assert.equal(facades(ell, ell.blds[1]).filter((f) => near(f.normal, Math.PI)).length, 2);
});

test('ближайший фасад к румбу — для старых ссылок d=0..7', () => {
  const w = makeWorld();
  const fs = facades(w, w.blds[0]);
  assert.equal(nearestFacade(fs, DIR.S), 2);
  assert.equal(nearestFacade(fs, (200 * Math.PI) / 180), 2);
  assert.equal(nearestFacade(fs, (350 * Math.PI) / 180), 0);
  assert.equal(nearestFacade([], DIR.N), -1);
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

test('луч из окна: небо, море за берегом, суша под окном, гора и стена', () => {
  const open = makeWorld();
  const b = open.blds[0];
  const z = b.ground + 25;
  assert.equal(rayHit(open, b, -11, 0, z, DIR.W, deg(5)), HIT.sky);
  assert.equal(rayHit(open, b, -11, 0, z, DIR.W, deg(-0.5)), HIT.sea); // уходит под воду в ~4 км, берег в 300 м
  assert.equal(rayHit(open, b, -11, 0, z, DIR.W, deg(-10)), HIT.obstacle); // суша 10 м в ~140 м
  assert.equal(rayHit(open, b, 11, 0, z, DIR.E, 0), HIT.obstacle); // гора 400 м
  assert.equal(rayHit(open, b, 11, 0, z, DIR.E, deg(20)), HIT.sky);
  const w = makeWorld([{ ring: rect(-100, 0, 20, 200), levels: 20 }]);
  assert.equal(rayHit(w, w.blds[0], -11, 0, z, DIR.W, deg(-0.5)), HIT.obstacle); // стена 60 м
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

test('выборка тайла Copernicus: центр ячейки между пикселями — среднее, а не сосед с востока', () => {
  // склон на восток 200, 230, 260 м, два ряда; как в Бергене: шаг тайла 2″, центр нашей ячейки на x = 0.5
  const band = [200, 230, 260, 200, 230, 260];
  assert.equal(bilinear(band, 3, 2, 0.5, 0), 215); // ближайший (Math.round) дал бы 230
  assert.equal(bilinear(band, 3, 2, 1, 1), 230); // в центре пикселя — сам пиксель
  assert.equal(bilinear(band, 3, 2, 2.5, 0.5), 260); // за краем окна — крайний пиксель
});
