// Согласованность закоммиченных данных data/<id>/ между собой и с cities.config.mjs.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { test } from 'node:test';
import { cities } from '../cities.config.mjs';
import { packBuildings, unpackBuildings } from '../src/scripts/buildings-bin.ts';

const json = (id: string, name: string) => JSON.parse(readFileSync(`data/${id}/${name}.json`, 'utf8'));
const size = (id: string, name: string) => statSync(`data/${id}/${name}.bin`).size;

for (const city of cities) {
  test(`${city.id}: данные согласованы`, () => {
    const ids = new Set(json(city.id, 'buildings').features.map((f: any) => f.properties.id));
    // При расхождении src/scripts/data.ts отключает предрасчёт — карта считалась бы в воркере.
    const pre = json(city.id, 'precomputed');
    assert.equal(pre.buildings, ids.size, 'precomputed.json: число зданий не совпадает с buildings.json');
    assert.equal(size(city.id, 'precomputed'), pre.layers.length * pre.buildings, 'precomputed.bin: размер не равен слои × здания');

    for (const ex of city.examples) assert.ok(ids.has(ex.b), `пример «${ex.ru}»: здания ${ex.b} нет в buildings.json`);

    // buildings.bin — упакованный buildings.json: те же здания и свойства, координаты с точностью до шага.
    const src = json(city.id, 'buildings');
    const meta = json(city.id, 'buildings.meta');
    const raw = readFileSync(`data/${city.id}/buildings.bin`);
    const got = unpackBuildings(meta, raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
    assert.equal(got.features.length, src.features.length, 'buildings.bin: число зданий не совпадает с buildings.json — запустите npm run pack -- <id>');
    const plan = existsSync(`data/${city.id}/levels-plan.json`) ? json(city.id, 'levels-plan') : null;
    assert.equal(Buffer.compare(Buffer.from(packBuildings(src, plan).buf), raw), 0, 'buildings.bin устарел относительно buildings.json — запустите npm run pack -- <id>');
    const tol = meta.scale; // м
    src.features.forEach((f: any, i: number) => {
      const g = got.features[i];
      // 0 этажей / 0 м в OSM — «нет данных» (так их понимает и grid.ts), в формате это null.
      for (const k of ['id', 'levels', 'height', 'name', 'addr', 'street', 'building']) {
        // Этажность из плана застройки (levels-plan.json) — только у домов без неё в OSM, с пометкой источника.
        const fromPlan = k === 'levels' && g.properties.levelsSrc === 'plan';
        if (fromPlan) { assert.ok(!f.properties.levels && !f.properties.height && plan?.items[f.properties.id], `здание ${f.properties.id}: этажность из плана там, где она есть в OSM`); continue; }
        assert.equal(g.properties[k] ?? null, f.properties[k] || null, `здание ${f.properties.id}: ${k}`);
      }
      if (plan?.items[f.properties.id] && !f.properties.levels && !f.properties.height) assert.equal(g.properties.levels, plan.items[f.properties.id].levels, `здание ${f.properties.id}: этажность из плана не применена`);
      assert.equal(g.geometry.type, f.geometry.type);
      const a = g.geometry.coordinates.flat(2), b = f.geometry.coordinates.flat(2);
      assert.equal(a.length, b.length, `здание ${f.properties.id}: число вершин`);
      for (let j = 0; j < a.length; j += 2) {
        const dx = (a[j] - b[j]) * meta.kx, dy = (a[j + 1] - b[j + 1]) * meta.ky;
        assert.ok(Math.hypot(dx, dy) <= tol, `здание ${f.properties.id}: вершина смещена на ${Math.hypot(dx, dy).toFixed(3)} м`);
      }
    });

    // levels.json — по OSM id; после обновления данных часть id может пропасть, но почти все должны быть.
    const lv = json(city.id, 'levels');
    const known = new Set(src.features.map((f: any) => f.properties.id));
    assert.ok(lv.items.every((r: number[]) => r[1] >= 1), 'levels.json: в списке только дома, влияющие на соседей');
    assert.ok(lv.items.filter((r: number[]) => known.has(r[0])).length >= 0.9 * lv.items.length, 'levels.json устарел — запустите npm run levels -- <id>');

    const dem = json(city.id, 'dem');
    assert.equal(size(city.id, 'dem'), dem.cols * dem.rows * 2, 'dem.bin: размер не равен cols × rows × 2 (Int16)');
  });
}
