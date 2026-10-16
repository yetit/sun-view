// npm run fetch -- <id>: здания и зелень, затем рельеф (ему нужны здания для сглаживания DSM),
// затем предрасчёт карт солнца и моря.
import { execFileSync } from 'node:child_process';
const id = process.argv[2] ?? '';
for (const s of ['fetch-buildings.mjs', 'fetch-dem.mjs', 'precompute.ts']) execFileSync('node', [`scripts/${s}`, id], { stdio: 'inherit' });
