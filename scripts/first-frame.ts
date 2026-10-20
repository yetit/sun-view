// Статичный первый кадр карты для каждого города: снимок вида по умолчанию без интерфейса → public/first/<id>.jpg.
// Страница показывает его под картой, пока грузится WebGL, и плавно убирает, когда карта готова (ui/start.ts).
// Запуск при поднятом сайте: node scripts/first-frame.ts http://localhost:4326/sun-view/
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { cities } from '../cities.config.mjs';

const base = process.argv[2] ?? 'http://localhost:4326/sun-view/';
mkdirSync('public/first', { recursive: true });
const b = await chromium.launch({ args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'] });
for (const c of cities) {
  const p = await b.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  await p.goto(`${base}?c=${c.id}&lang=ru`);
  await p.waitForFunction(() => performance.getEntriesByName('sv:painted').length > 0, null, { timeout: 90_000 });
  // Без интерфейса поверх карты: легенда, подсказка, таймбар, кнопки, атрибуция.
  await p.addStyleTag({ content: '.legend-box, .rotate-hint, .timebar, .maplibregl-control-container { display: none !important; }' });
  await p.waitForTimeout(4000); // рельеф и тайлы
  await p.locator('#map').screenshot({ path: `public/first/${c.id}.jpg`, type: 'jpeg', quality: 70 });
  console.log(`public/first/${c.id}.jpg`);
  await p.close();
}
await b.close();
