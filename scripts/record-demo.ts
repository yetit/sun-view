// Запись GIF для README: обзор города → клик по примеру → прокрутка времени суток.
// Кадры снимает Playwright, кодирует gifenc (без ffmpeg). Запуск при поднятом сайте:
//   node scripts/record-demo.ts http://localhost:4326/sun-view/ docs/demo.gif
import { writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import gifenc from 'gifenc';
import { PNG } from 'pngjs';

const { applyPalette, GIFEncoder, quantize } = gifenc; // CommonJS-пакет
const [base = 'http://localhost:4326/sun-view/', out = 'docs/demo.gif'] = process.argv.slice(2);
const W = 880, H = 520;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await page.goto(`${base}?c=tivat&lang=en&m=sun&s=3&t=8`);
await page.waitForFunction(() => performance.getEntriesByName('sv:painted').length > 0, null, { timeout: 90_000 });
await page.waitForTimeout(2500);

const gif = GIFEncoder();
let frames = 0;
async function frame(delay: number) {
  const { data } = PNG.sync.read(await page.screenshot());
  const palette = quantize(data, 192, { format: 'rgb565' });
  gif.writeFrame(applyPalette(data, palette, 'rgb565'), W, H, { palette, delay });
  frames++;
}

await frame(1600); // обзор: город окрашен зимним солнцем
await page.locator('.example').nth(2).click(); // «солнце весь зимний день»
for (let i = 0; i < 8; i++) { await page.waitForTimeout(140); await frame(140); } // пролёт к зданию
await page.waitForTimeout(1500); // карта дорисовывает тайлы после пролёта
await frame(1400);
// Прокрутка суток: свет, тени и точка солнца на диаграмме.
for (let h = 8; h <= 17; h += 0.5) {
  await page.evaluate((v) => { const el = document.querySelector<HTMLInputElement>('.hour')!; el.value = String(v); el.dispatchEvent(new Event('input')); }, h);
  await page.waitForTimeout(120);
  await frame(160);
}
await frame(2000);
gif.finish();
writeFileSync(out, gif.bytes());
console.log(`${out}: ${frames} кадров, ${(gif.bytes().length / 1e6).toFixed(2)} МБ`);
await browser.close();
