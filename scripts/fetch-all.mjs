// npm run fetch -- <id>: здания, упаковка зданий в buildings.bin, рельеф (ему нужны здания для сглаживания DSM),
// высота крон и облачность, затем предрасчёт карт солнца и моря и список домов без этажности.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { getCity } from '../cities.config.mjs';
const id = process.argv[2] ?? '';
// Высота крон и облачность — неизменные наборы: качаем, только если их ещё нет.
const once = (f, s) => (existsSync(`data/${getCity(id).id}/${f}`) ? [] : [s]);
for (const s of ['fetch-buildings.mjs', 'pack-buildings.ts', 'fetch-dem.mjs', ...once('canopy.json', 'fetch-canopy.mjs'), ...once('climate.json', 'fetch-climate.mjs'), 'precompute.ts', 'levels-todo.mjs']) execFileSync('node', [`scripts/${s}`, id], { stdio: 'inherit' });
