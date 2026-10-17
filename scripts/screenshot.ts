// Скриншот для README: карта с выбранным домом и панель с сезонами (облака, граница без листвы) и матрицей.
// Запуск при поднятом сайте: node scripts/screenshot.ts http://localhost:4326/sun-view/ docs/screenshot.png
import { chromium } from '@playwright/test';

const [base = 'http://localhost:4326/sun-view/', out = 'docs/screenshot.png', q = 'c=tivat&b=193467074&f=2&s=3&t=10&lang=en'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 760 }, deviceScaleFactor: 1 });
await page.goto(`${base}?${q}`);
await page.waitForFunction(() => performance.getEntriesByName('sv:painted').length > 0, null, { timeout: 90_000 });
await page.locator('.matrix .cell').first().waitFor({ timeout: 60_000 });
await page.locator('.bre').waitFor({ timeout: 60_000 });
await page.waitForTimeout(4000); // пролёт к дому, тайлы и рельеф
await page.evaluate(() => document.querySelector('.bre-box')?.scrollIntoView({ block: 'start' }));
await page.waitForTimeout(500);
await page.screenshot({ path: out });
console.log(out);
await browser.close();
