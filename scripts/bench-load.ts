// Замер загрузки по городам: Playwright без кэша, N прогонов, медиана этапов sv:* (мс от начала навигации)
// Сайт должен быть поднят (astro preview, base /sun-view/). Объём данных считайте по файлам dist/_astro.
//   node scripts/bench-load.ts http://localhost:4326/sun-view/ 3 [замедление CPU, например 4]
import { chromium } from '@playwright/test';
import { cities } from '../cities.config.mjs';

const [base = 'http://localhost:4326/sun-view/', runs = '3', cpu = '1'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
for (const c of cities) {
  const rows: Record<string, number[]> = {};
  for (let i = 0; i < +runs; i++) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); // новый контекст — пустой кэш
    const page = await ctx.newPage();
    if (+cpu > 1) await (await ctx.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: +cpu }); // как мобильный профиль Lighthouse
    await page.goto(`${base}?c=${c.id}&lang=en&bench=${Date.now()}`);
    await page.waitForFunction(() => performance.getEntriesByName('sv:painted').length > 0, null, { timeout: 90_000 });
    const r = await page.evaluate(() => {
      return Object.fromEntries(performance.getEntriesByType('mark').filter((x) => x.name.startsWith('sv:')).map((x) => [x.name.slice(3), x.startTime]));
    });
    for (const [k, v] of Object.entries(r)) (rows[k] ??= []).push(v);
    await ctx.close();
  }
  console.log(c.id.padEnd(7), Object.entries(rows).map(([k, v]) => `${k}=${Math.round(med(v))}`).join(' '));
}
await browser.close();
