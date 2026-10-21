// data/<id>/buildings.json → buildings.bin + buildings.meta.json (формат — src/scripts/buildings-bin.ts).
// data/<id>/levels-plan.json, если есть, — этажность из плана застройки для домов без неё в OSM.
// Запуск: node scripts/pack-buildings.ts <id>; входит в npm run fetch.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { getCity } from '../cities.config.mjs';
import { packBuildings } from '../src/scripts/buildings-bin.ts';

const { id } = getCity(process.argv[2]);
const src = readFileSync(`data/${id}/buildings.json`);
const planFile = `data/${id}/levels-plan.json`;
const plan = existsSync(planFile) ? JSON.parse(readFileSync(planFile, 'utf8')) : null;
const { meta, buf } = packBuildings(JSON.parse(src.toString('utf8')), plan);
writeFileSync(`data/${id}/buildings.bin`, buf);
writeFileSync(`data/${id}/buildings.meta.json`, JSON.stringify(meta));
if (plan) console.log(`${id}: этажность из плана «${plan.plan}» у ${new Uint8Array(buf.buffer, meta.sections.flags[0], meta.sections.flags[1]).filter((f) => f & 2).length} зданий`);
console.log(`${id}: ${meta.n} зданий, buildings.json ${(src.length / 1024).toFixed(0)} КБ → bin ${(buf.length / 1024).toFixed(0)} КБ + meta ${(JSON.stringify(meta).length / 1024).toFixed(0)} КБ, шаг ${meta.scale} м`);
