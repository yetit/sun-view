// Согласованность закоммиченных данных data/<id>/ между собой и с cities.config.mjs.
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { test } from 'node:test';
import { cities } from '../cities.config.mjs';

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

    const dem = json(city.id, 'dem');
    assert.equal(size(city.id, 'dem'), dem.cols * dem.rows * 2, 'dem.bin: размер не равен cols × rows × 2 (Int16)');
  });
}
