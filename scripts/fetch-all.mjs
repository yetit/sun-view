// npm run fetch -- <id>: здания и зелень, затем рельеф (ему нужны здания для сглаживания DSM).
import { execFileSync } from 'node:child_process';
const id = process.argv[2] ?? '';
for (const s of ['fetch-buildings', 'fetch-dem']) execFileSync('node', [`scripts/${s}.mjs`, id], { stdio: 'inherit' });
