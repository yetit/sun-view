// Метрика «где не хватает этажности» (src/scripts/levels.ts) на синтетической сцене tests/world.ts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { levelsImpact, levelsTodo, winterSuns } from '../src/scripts/levels.ts';
import { makeWorld, rect } from './world.ts';

test('дом без этажности к югу от соседа меняет ему зимнее солнце, дальний — нет', () => {
  // Наблюдатель — 2 этажа (окно среднего этажа на 1,5 м); в 20 м к югу дом без этажности: при 4 этажах
  // (12 м) он закрывает зимнее полуденное солнце (~24,5° на 42° с. ш.), при 1 этаже — нет. Второй — в 600 м.
  const w = makeWorld([{ ring: rect(0, -60, 20, 20), levels: 2 }, { ring: rect(0, -85, 20, 10), levels: null }, { ring: rect(600, 0, 10, 10), levels: null }]);
  const [near, far] = [w.blds[2], w.blds[3]];
  assert.ok(near.assumed && far.assumed);
  const suns = winterSuns(w);
  const a = levelsImpact(w, near, suns);
  assert.ok(a.windows >= 1, `соседей с изменившимся ответом: ${a.windows}`);
  assert.ok(a.sunH >= 0.5, `часов солнца зависит: ${a.sunH}`);
  const b = levelsImpact(w, far, suns);
  assert.equal(b.neighbours, 0);
  assert.equal(b.windows, 0);
  // Растр крыш после расчёта восстановлен: повторный расчёт даёт то же.
  assert.deepEqual(levelsImpact(w, near, suns), a);
  // Список — только дома без этажности, ближний впереди.
  const todo = levelsTodo(w);
  assert.deepEqual(todo.map((r) => r.idx), [near.idx, far.idx]);
});
