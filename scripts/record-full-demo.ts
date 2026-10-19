// Демо-видео всех возможностей для показа: 14 шагов по ~10 с, подпись на плашке внизу кадра, 1920×1080, 30 fps, без звука.
// Пишет Playwright (recordVideo, webm), в MP4 перегоняет ffmpeg из ffmpeg-static. Сайт должен быть поднят:
//   BASE_PATH=/sun-view/ npm run build && BASE_PATH=/sun-view/ npx astro preview --port 4326 --ignore-lock
//   npm run demo:full                    # → docs/demo-full.mp4, подписи по-русски
//   npm run demo:full -- --lang en       # → docs/demo-full.en.mp4
// WebGL — через Metal (headless Chromium на macOS): на SwiftShader карта даёт 4 кадра/с вместо ~50.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Page } from '@playwright/test';
import ffmpeg from 'ffmpeg-static';

const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const lang = arg('lang', 'ru') as 'ru' | 'en';
const base = arg('url', 'http://localhost:4326/sun-view/');
const out = arg('out', lang === 'ru' ? 'docs/demo-full.mp4' : 'docs/demo-full.en.mp4');

// Подписи шагов. {bre} — оценка окна из панели, подставляется во время записи.
const CAPTIONS = {
  ru: {
    open: 'Тиват: каждый дом окрашен по часам зимнего солнца в окнах. Под шкалой — сколько этих часов в среднем остаётся с облаками',
    modes: 'Режимы карты: «Море» — сколько направлений с видом на воду, «Этажность» — где в OSM не хватает данных. Высота окна — 2, 5 или 10 м',
    example: 'Пример «Верхний этаж у моря»: пролёт к дому, карточка здания, надёжность данных и сводка одной фразой',
    facade: 'Этаж и фасад: камера разворачивается к выбранной стене. Матрица «этажи × фасады» — клик по лучшей клетке',
    seasons: 'Солнце в окнах по сезонам: при ясном небе и ☁ в среднем с облаками. Лента года — переключатель «Ясное небо / С облаками»',
    bre: 'Годовая оценка окна по британскому нормативу BRE: {bre} — и вердикт с пояснением, как она считается',
    sea: 'Вид на море: 8 направлений и расстояние до воды. Те же лучи — секторами на карте',
    view: 'Вид из окна: камера на высоте этажа у выбранного фасада, доли моря и неба в кадре',
    time: 'Ползунок времени: ▶ прокручивает сутки — свет на фасадах, тени, солнце на диаграмме. Зима → лето',
    compare: 'Сравнение до четырёх квартир в одной таблице и PNG-карточка, чтобы отправить',
    png: 'PNG-карточка: сезоны, лента года, вид на море',
    search: 'Поиск адреса в пределах города и переключение городов: Котор, затем Берген',
    keys: 'Клавиатура: Tab — на карту, Enter выбирает дом в центре, стрелки — соседний дом в эту сторону',
    embed: 'Встраивание: карта с одним домом в iframe на любом сайте, высота подстраивается сама',
    final: 'Открытые данные · расчёт в браузере · без сервера',
  },
  en: {
    open: 'Tivat: every building is coloured by hours of winter sun in its windows. Under the scale: how much of it remains with clouds on average',
    modes: 'Map modes: Sea counts directions with a water view, Floors shows where OSM lacks data. Window height: 2, 5 or 10 m',
    example: 'Example “Top floor by the sea”: fly to the building, the building card, data reliability and a one-line summary',
    facade: 'Floor and facade: the camera turns to face the chosen wall. The floors × facades matrix: click the best cell',
    seasons: 'Sun in the windows by season: clear sky and ☁ the average with clouds. The year ribbon has a “Clear sky / With clouds” switch',
    bre: 'Annual window score against the UK BRE guideline: {bre}, with a verdict and how it is computed',
    sea: 'Sea view: 8 directions and the distance to the water. The same rays as sectors on the map',
    view: 'Window view: the camera at floor height by the chosen facade, with the shares of sea and sky in the frame',
    time: 'Time slider: ▶ runs through the day, with light on the facades, shadows and the sun on the diagram. Winter → summer',
    compare: 'Compare up to four flats in one table, and a PNG card to send',
    png: 'The PNG card: seasons, the year ribbon, the sea view',
    search: 'Address search within the city, and switching cities: Kotor, then Bergen',
    keys: 'Keyboard: Tab to the map, Enter selects the building in the centre, arrows move to the next one that way',
    embed: 'Embedding: a map with one building in an iframe on any site, sizing itself',
    final: 'Open data · computed in the browser · no server',
  },
}[lang];

const dir = mkdtempSync(join(tmpdir(), 'sv-demo-'));
const browser = await chromium.launch({ args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'] });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, recordVideo: { dir, size: { width: 1920, height: 1080 } }, acceptDownloads: true });
const t0 = Date.now();
// Плашка подписи и полноэкранный слой (картинка PNG, финал) — на каждой загруженной странице.
await context.addInitScript(() => {
  addEventListener('DOMContentLoaded', () => {
    const st = document.createElement('style');
    st.textContent = `#demo-cap{position:fixed;left:50%;bottom:36px;transform:translateX(-50%);z-index:9999;max-width:1500px;padding:18px 30px;border-radius:16px;background:rgba(24,22,20,.86);color:#fff;font:500 30px/1.3 'Inter Variable',system-ui,sans-serif;text-align:center;box-shadow:0 10px 40px rgba(0,0,0,.3);transition:opacity .35s;pointer-events:none}
#demo-cap:empty{opacity:0}#demo-full{position:fixed;inset:0;z-index:9998;display:none;align-items:center;justify-content:center;flex-direction:column;gap:28px;background:#fcfaf6;font:600 64px/1.2 'Inter Variable',system-ui,sans-serif;color:#1f1d1a}
#demo-full img{max-width:86vw;max-height:78vh;border-radius:16px;box-shadow:0 20px 60px rgba(60,40,10,.25)}#demo-full small{font-size:34px;font-weight:500;color:#6f695f}`;
    document.head.append(st);
    const cap = document.createElement('div'); cap.id = 'demo-cap'; document.body.append(cap);
    const full = document.createElement('div'); full.id = 'demo-full'; document.body.append(full);
  });
});

const page = await context.newPage();
const wait = (s: number) => page.waitForTimeout(s * 1000);
const painted = (p: Page = page) => p.waitForFunction(() => performance.getEntriesByName('sv:painted').length > 0, null, { timeout: 90_000 });
const caption = (text: string) => page.evaluate((s) => { document.getElementById('demo-cap')!.textContent = s; }, text);
const scrollTo = (sel: string) => page.locator(sel).first().evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
const url = (q: string) => `${base}${q}&lang=${lang}`;
let start = 0; // момент первой подписи — до него в ролике загрузка, её отрезаем

// 1. Открытие Тивата.
await page.goto(url('?c=tivat&s=3&t=11&m=sun&fm=5'));
await painted();
await wait(3);
start = Date.now();
await caption(CAPTIONS.open);
await wait(8);

// 2. Режимы карты и высота окна.
await page.locator('.rotate-hint').click().catch(() => {});
await caption(CAPTIONS.modes);
for (const m of ['sea', 'levels', 'sun']) { await page.locator(`.mode-chip[data-mode="${m}"]`).click(); await wait(2.6); }
await page.locator('.floor-mode').selectOption('10');
await wait(2.6);

// 3. Пример «Верхний этаж у моря».
await caption(CAPTIONS.example);
await page.locator('.example').first().click();
await wait(4);
await scrollTo('.trust');
await wait(4);

// 4. Фасад (южный — ближайший к 180°) и лучшая клетка матрицы.
await caption(CAPTIONS.facade);
const south = await page.locator('.side').evaluateAll((els) => {
  const deg = (el: Element) => +(el.querySelector('small')?.textContent ?? '').replace(/\D/g, '');
  const fs = els.filter((el) => el.querySelector('small'));
  return fs.reduce((a, el) => (Math.abs(deg(el) - 180) < Math.abs(deg(a) - 180) ? el : a)).getAttribute('data-c');
});
await scrollTo('.sides');
await page.locator(`.side[data-c="${south}"]`).click();
await wait(4);
await scrollTo('.matrix');
await wait(1.5);
await page.locator('.matrix .cell.best').click();
await wait(4);

// 5. Сезоны с облаками, лента года, переключатель неба.
await caption(CAPTIONS.seasons);
await scrollTo('.seasons');
await wait(3.5);
await scrollTo('.ribbon');
await wait(2);
await page.locator('.sky-chip[data-cl="1"]').click();
await wait(3);
await page.locator('.sky-chip[data-cl="0"]').click();
await wait(1.5);

// 6. Оценка по BRE.
const bre = await page.locator('.bre strong').innerText().then((s) => s.replace(/\s+/g, ' ').replace(/(\d+)\s*/, '$1 ')).catch(() => '');
await caption(CAPTIONS.bre.replace('{bre}', bre.trim()));
await scrollTo('.bre-box');
await wait(3);
await page.locator('.bre-box details summary').click().catch(() => {});
await wait(5);
await page.locator('.bre-box details summary').click().catch(() => {});

// 7. Вид на море.
await caption(CAPTIONS.sea);
await scrollTo('.rose');
await wait(7);

// 8. Вид из окна.
await caption(CAPTIONS.view);
await scrollTo('.view-row');
await wait(1);
await page.locator('.view-btn').click();
await wait(7);
await page.locator('.view-exit').click();
await wait(2.5);

// 9. Ползунок времени: сутки зимой, затем лето.
await caption(CAPTIONS.time);
await page.locator('.play').click();
await wait(5);
await page.locator('.chip').nth(1).click();
await wait(5);
await page.locator('.play').click();

// 10. Сравнение и PNG.
await caption(CAPTIONS.compare);
await scrollTo('.actions');
await page.locator('.pin-btn').click();
await page.locator('.floor').selectOption('2');
await wait(2);
await page.locator('.pin-btn').click();
await page.locator('.side[data-c="-1"]').click();
await wait(1.5);
await page.locator('.pin-btn').click();
await scrollTo('.compare');
await wait(4);
const [download] = await Promise.all([page.waitForEvent('download'), page.locator('.share-btn').click()]);
const png = readFileSync(await download.path());
await caption(CAPTIONS.png);
await page.evaluate((src) => { const f = document.getElementById('demo-full')!; f.innerHTML = `<img src="${src}">`; f.style.display = 'flex'; }, `data:image/png;base64,${png.toString('base64')}`);
await wait(4);
await page.evaluate(() => { document.getElementById('demo-full')!.style.display = 'none'; });

// 11. Поиск адреса и смена города.
await caption(CAPTIONS.search);
await page.locator('.search').evaluate((el) => el.scrollIntoView({ block: 'center' }));
await page.locator('.search').pressSequentially(lang === 'ru' ? 'Pine' : 'Pine', { delay: 120 });
await page.locator('.search-results button').first().waitFor({ timeout: 10_000 }).catch(() => {});
await wait(2);
await page.locator('.search').press('Enter');
await wait(3);
for (const c of ['kotor', 'bergen']) {
  await page.locator('.city').selectOption(c);
  await page.waitForURL(new RegExp(`c=${c}`));
  await page.waitForLoadState('domcontentloaded');
  await caption(CAPTIONS.search); // подпись — сразу, пока город грузится
  await painted();
  await wait(4.5);
}

// 12. Клавиатура.
await caption(CAPTIONS.keys);
await page.locator('.maplibregl-canvas').focus();
await wait(1);
for (const k of ['Enter', 'ArrowRight', 'ArrowRight', 'ArrowUp']) { await page.keyboard.press(k); await wait(2.2); }

// 13. Встраивание.
await page.goto(`${base}embed?lang=${lang}`);
await page.locator('#sun-view').evaluate((el) => el.scrollIntoView({ block: 'start' })).catch(() => {});
await caption(CAPTIONS.embed);
await wait(9);

// 14. Финал.
await caption('');
await page.evaluate((s) => { const f = document.getElementById('demo-full')!; f.innerHTML = `<div>yetit.github.io/sun-view</div><small>${s}</small>`; f.style.display = 'flex'; }, CAPTIONS.final);
await wait(5);

const video = page.video()!;
await context.close();
await browser.close();
const webm = await video.path();
const ss = Math.max(0, (start - t0) / 1000 - 0.5);
execFileSync(ffmpeg as unknown as string, ['-y', '-loglevel', 'error', '-ss', ss.toFixed(2), '-i', webm, '-r', '30', '-c:v', 'libx264', '-preset', 'slow', '-crf', '24', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', out]);
const dur = spawnSync(ffmpeg as unknown as string, ['-i', out], { encoding: 'utf8' }).stderr; // без выхода ffmpeg печатает сведения и выходит с 1
rmSync(dir, { recursive: true, force: true });
console.log(`${out}: ${(statSync(out).size / 1e6).toFixed(1)} МБ, обрезано ${ss.toFixed(1)} с загрузки`, dur.match(/Duration: [\d:.]+/)?.[0] ?? '');
