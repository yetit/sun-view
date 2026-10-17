// data/<id>/buildings.json → buildings.bin + buildings.meta.json (формат — src/scripts/buildings-bin.ts).
// Запуск: node scripts/pack-buildings.ts <id>; входит в npm run fetch.
import { readFileSync, writeFileSync } from 'node:fs';
import { getCity } from '../cities.config.mjs';
import { packBuildings } from '../src/scripts/buildings-bin.ts';

const { id } = getCity(process.argv[2]);
const src = readFileSync(`data/${id}/buildings.json`);
const { meta, buf } = packBuildings(JSON.parse(src.toString('utf8')));
writeFileSync(`data/${id}/buildings.bin`, buf);
writeFileSync(`data/${id}/buildings.meta.json`, JSON.stringify(meta));
console.log(`${id}: ${meta.n} зданий, buildings.json ${(src.length / 1024).toFixed(0)} КБ → bin ${(buf.length / 1024).toFixed(0)} КБ + meta ${(JSON.stringify(meta).length / 1024).toFixed(0)} КБ, шаг ${meta.scale} м`);
