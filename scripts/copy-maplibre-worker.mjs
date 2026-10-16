// MapLibre 6 ищет воркер рядом со своим модулем; после бандлинга Vite этот путь теряется,
// поэтому воркер и общий чанк кладём в public/ и указываем через setWorkerUrl.
import { cpSync, mkdirSync } from 'node:fs';

const from = 'node_modules/maplibre-gl/dist';
mkdirSync('public/maplibre', { recursive: true });
for (const f of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) cpSync(`${from}/${f}`, `public/maplibre/${f}`);
