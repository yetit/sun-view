// Сценарии интерфейса: матрица «этажи × фасады», солнце за год, вид из окна, сравнение, PNG, состояние в ссылке, язык,
// встраивание и клавиатура. Локально — против astro preview, в CI — против опубликованного демо.
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const B = 193467133; // Тиват, 10 этажей, этажность из OSM (пример «Солнце весь зимний день»)
const painted = (page: Page) => page.waitForFunction(() => performance.getEntriesByName('sv:painted').length > 0, null, { timeout: 60_000 });
const open = async (page: Page, q: string) => { await page.goto(`${q}&v=${Date.now()}`); await painted(page); };

test('матрица этажи × фасады: клик по клетке выбирает этаж и фасад', async ({ page }) => {
  await open(page, `?c=tivat&b=${B}&f=10&lang=en`);
  const cells = page.locator('.matrix .cell');
  await expect(cells.first()).toBeVisible({ timeout: 30_000 });
  const cell = page.locator('.matrix .cell[data-f="3"]').nth(1);
  const [f, c] = [await cell.getAttribute('data-f'), await cell.getAttribute('data-c')];
  await cell.click();
  await expect(page.locator('.floor')).toHaveValue(f!);
  await expect(page.locator(`.side[data-c="${c}"]`)).toHaveAttribute('aria-pressed', 'true');
  await expect(cell).toHaveAttribute('aria-pressed', 'true');
  expect(page.url()).toContain(`f=${f}`);
});

test('солнце за год: оценка BRE для здания — лучший фасад этажа, для окна — как в клетке матрицы', async ({ page }) => {
  await open(page, `?c=tivat&b=${B}&f=10&lang=en`);
  const bre = page.locator('.bre');
  await expect(bre).toBeVisible({ timeout: 30_000 });
  await expect(bre).toHaveAttribute('data-v', /^(pass|edge|fail|na)$/);
  await expect(bre).toContainText('best facade on this floor');
  const cell = page.locator('.matrix .cell[data-f="10"]').first();
  const score = (await cell.textContent())!.replace('∿', '');
  await cell.click();
  await expect(page.locator('.bre strong')).toHaveText(`${score}of 100`);
  await expect(bre).not.toContainText('best facade');
  await expect(page.locator('.summary')).toContainText(`Annual sun ${score} of 100`);
});

test('вид из окна: камера у окна по нормали фасада, доли моря и неба, выход возвращает камеру', async ({ page }) => {
  await open(page, `?c=tivat&b=${B}&f=10&d=f3&lang=en`); // западный фасад, 272°: залив
  const stat = page.locator('.view-stat');
  await expect(stat).toContainText(/Sea \d+% .* sky \d+%/, { timeout: 30_000 });
  const camera = () => page.evaluate(() => (performance.getEntriesByName('sv:view').at(-1) as PerformanceMark | undefined)?.detail);
  expect(await camera()).toBeUndefined();
  await page.locator('.view-btn').click();
  await expect(page.locator('.view-btn')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.view-badge')).toBeVisible();
  const view = await camera();
  expect(view.on).toBe(true);
  expect(view.pitch).toBeCloseTo(90, 0);
  expect(((view.bearing + 360) % 360)).toBeCloseTo(272, -1);
  expect(Number(/Sea (\d+)%/.exec((await stat.textContent())!)![1])).toBeGreaterThan(0);
  // PNG-карточка с кадром вида: буфер карты в проде не сохраняется, кадр снимается разовой перерисовкой
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('.share-btn').click()]);
  expect(readFileSync((await download.path())!).length).toBeGreaterThan(20_000);
  if (process.env.VIEW_PNG) await download.saveAs(process.env.VIEW_PNG);
  await page.locator('.view-exit').click();
  await expect(page.locator('.view-badge')).toBeHidden();
  const back = await camera();
  expect(back.on).toBe(false);
  expect(back.pitch).toBeLessThan(76);
});

test('сравнение двух квартир', async ({ page }) => {
  await open(page, `?c=tivat&b=${B}&f=10&lang=en`);
  await expect(page.locator('.summary')).not.toBeEmpty();
  await page.locator('.pin-btn').click();
  await page.locator('.floor').selectOption('2'); // вторая квартира — второй этаж того же дома
  await page.locator('.pin-btn').click();
  const rows = page.locator('.compare-rows tr');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('10');
  await expect(rows.nth(1)).toContainText('2');
  await rows.nth(0).locator('.x').click(); // убрать первую
  await expect(rows).toHaveCount(1);
});

test('PNG-карточка скачивается и не пустая', async ({ page }) => {
  await open(page, `?c=tivat&b=${B}&f=10&lang=en`);
  await expect(page.locator('.summary')).not.toBeEmpty();
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('.share-btn').click()]);
  expect(download.suggestedFilename()).toMatch(/\.png$/);
  const png = readFileSync((await download.path())!);
  expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  expect(png.length).toBeGreaterThan(20_000);
});

test('состояние восстанавливается по ссылке', async ({ page }) => {
  await open(page, `?c=tivat&b=${B}&f=7&d=f1&s=0&t=14&m=sea&fm=10&lang=en`);
  await expect(page.locator('.b-name')).not.toBeEmpty();
  await expect(page.locator('.floor')).toHaveValue('7');
  await expect(page.locator('.side[data-c="1"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.chip.active')).toHaveText('Spring');
  await expect(page.locator('.clock')).toHaveText('14:00');
  await expect(page.locator('.mode-chip[data-mode="sea"]')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.floor-mode')).toHaveValue('10');
});

test('переключение языка', async ({ page }) => {
  await open(page, '?c=tivat&lang=ru');
  await expect(page.locator('.tagline')).toHaveText('Солнце и вид на море из окон');
  await page.locator('.lang').click();
  await painted(page);
  expect(page.url()).toContain('lang=en');
  await expect(page.locator('.tagline')).toHaveText('Sunlight and sea views from every window');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});

test('встраивание: компактная страница и iframe с автоматической высотой', async ({ page }) => {
  await open(page, `?embed=1&c=tivat&b=${B}&f=10&lang=en`);
  await expect(page.locator('.brand')).toBeHidden();
  await expect(page.locator('.search-wrap')).toBeHidden();
  await expect(page.locator('.summary')).not.toBeEmpty();
  const full = page.locator('.open-full');
  await expect(full).toBeVisible();
  expect(await full.getAttribute('href')).not.toContain('embed');
  expect((await page.locator('#map').boundingBox())!.height).toBeGreaterThan(300);
  await expect(page.locator('.rotate-hint')).toBeHidden(); // подсказка о повороте — не во встраивании

  await page.goto(`embed?lang=en&v=${Date.now()}`);
  const frame = page.locator('#sun-view');
  await expect(frame).toHaveAttribute('data-sized', '1', { timeout: 60_000 });
  expect((await frame.boundingBox())!.height).toBeGreaterThan(600);
});

test('клавиатура: Enter, стрелки, Esc', async ({ page }) => {
  await open(page, '?c=bergen&lang=en');
  const canvas = page.locator('.maplibregl-canvas');
  await canvas.focus();
  const clock = await page.locator('.clock').textContent();
  await page.keyboard.press('Enter');
  const name = page.locator('.b-name');
  await expect(name).not.toBeEmpty();
  const first = await name.textContent();
  await expect(page.locator('.sr-live')).toContainText(first!);
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.sr-live')).not.toContainText(first!);
  await expect(page.locator('.clock')).toHaveText(clock!); // стрелки на карте не двигают время
  await page.keyboard.press('Escape');
  await expect(page.locator('.result')).toBeHidden();
  await expect(page.locator('.empty')).toBeVisible();
  expect(page.url()).not.toContain('b=');
});

test('режим «Этажность»: дома без этажности окрашены по влиянию, в карточке — сколько соседей зависят', async ({ page }) => {
  await open(page, '?c=tivat&m=levels&lang=en');
  await expect(page.locator('.mode-chip[data-mode="levels"]')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.legend-title')).toContainText('floor counts are missing');
  await expect(page.locator('.legend-ticks')).toContainText('≥ 6');
  await page.goto(`?c=tivat&m=levels&b=193683085&lang=en&v=${Date.now()}`); // первый в списке для обхода по Тивату
  await painted(page);
  await expect(page.locator('.assumed')).toBeVisible();
  await expect(page.locator('.levels-impact')).toContainText(/of \d+ neighbours depend/);
  await expect(page.locator('.levels-help')).toHaveAttribute('href', /help-fill-in-floor-counts/);
});

test('сезоны: среднее с облаками на каждой карточке, зимой — граница без листвы; «Солнечнее рядом»', async ({ page }) => {
  await open(page, '?c=tivat&b=193467074&f=1&lang=en'); // лиственные деревья рядом: зимой 0,7 ч, без листвы 2,8
  await expect(page.locator('.seasons .card .cloud')).toHaveCount(4);
  await expect(page.locator('.seasons .card[data-s="3"] .bare')).toContainText('with bare trees');
  await expect(page.locator('.seasons .card[data-s="1"] .bare')).toHaveCount(0); // летом листва
  await expect(page.locator('.seasons-note')).toBeVisible();
  await page.locator('.better-btn').click();
  await expect(page.locator('.better-out')).toHaveText(/floor 1|No building/, { timeout: 30_000 });
  const link = page.locator('.better-out .link');
  if (await link.count()) {
    await link.click();
    await expect(page).not.toHaveURL(/b=193467074/);
  }
});

test('лента года: «С облаками» бледнит солнце в окнах, состояние в ссылке (cl=1) и восстанавливается по ней', async ({ page }) => {
  // Доля «солнечных» пикселей ленты: насыщенно-жёлтые клетки.
  const yellow = () => page.locator('.ribbon').evaluate((cv: HTMLCanvasElement) => {
    const d = cv.getContext('2d')!.getImageData(0, 0, cv.width, cv.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 230 && d[i + 1] > 170 && d[i + 2] < 90) n++;
    return n;
  });
  const drawn = () => expect.poll(() => page.locator('.ribbon').evaluate((cv: HTMLCanvasElement) => cv.width), { timeout: 30_000 }).toBeGreaterThan(300);
  await open(page, `?c=bergen&b=289528809&f=13&s=1&lang=en`);
  await drawn();
  const chips = page.locator('.sky-chip');
  await expect(chips).toHaveText(['Clear sky', 'With clouds']);
  await expect(chips.first()).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.ribbon-cloud')).toBeHidden();
  const clear = await yellow();
  expect(clear).toBeGreaterThan(1000);
  await chips.nth(1).click();
  await expect(chips.nth(1)).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.ribbon-cloud')).toContainText('not a forecast');
  expect(page.url()).toContain('cl=1');
  expect(await yellow()).toBeLessThan(clear / 4); // в Бергене прямое солнце бывает в 16–49 % дней месяца
  // По ссылке — сразу с облаками.
  await open(page, `?c=bergen&b=289528809&f=13&s=1&cl=1&lang=en`);
  await drawn();
  await expect(chips.nth(1)).toHaveAttribute('aria-checked', 'true');
  expect(await yellow()).toBeLessThan(clear / 4);
  await chips.first().click();
  await expect.poll(() => page.url()).not.toContain('cl=1');
  expect(await yellow()).toBe(clear);
});

// Азимут карты из data-bearing (#map) и ожидаемый — камера снаружи смотрит на стену: нормаль фасада + 180°.
const bearing = (page: Page) => page.locator('#map').evaluate((el) => +(el as HTMLElement).dataset.bearing!);
const near = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180) <= 2;
const facing = async (page: Page, c: number) => (+(await page.locator(`.side[data-c="${c}"] small`).textContent())!.replace(/\D/g, '') + 180) % 360;

test('камера к фасаду: выбор фасада разворачивает карту к стене, «Все» не крутит, ссылка с фасадом открывается развёрнутой', async ({ page }) => {
  await open(page, `?c=tivat&b=${B}&f=10&lang=en`);
  await expect(page.locator('.side')).not.toHaveCount(0);
  const want = await facing(page, 2);
  await page.locator('.side[data-c="2"]').click();
  await expect.poll(async () => near(await bearing(page), want), { timeout: 10_000 }).toBe(true);
  await page.locator('.side[data-c="-1"]').click(); // «Все»
  await page.waitForTimeout(1500);
  expect(near(await bearing(page), want)).toBe(true);
  // Клетка матрицы — тоже выбор фасада.
  const cell = page.locator('.matrix .cell[data-c="0"]').first();
  await cell.click();
  const want0 = await facing(page, 0);
  await expect.poll(async () => near(await bearing(page), want0), { timeout: 10_000 }).toBe(true);

  await open(page, `?c=tivat&b=${B}&f=10&d=f3&lang=en`);
  const want3 = await facing(page, 3);
  await expect.poll(async () => near(await bearing(page), want3), { timeout: 10_000 }).toBe(true);
});

test('подсказка о повороте: видна при первом заходе, скрывается после поворота или клика и больше не показывается', async ({ page }) => {
  await open(page, '?c=tivat&lang=en');
  const hint = page.locator('.rotate-hint');
  await expect(hint).toBeVisible();
  await expect(hint).toContainText('Rotate the map');
  // Поворот правой кнопкой мыши.
  const box = (await page.locator('#map').boundingBox())!;
  const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
  await page.mouse.move(x, y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(x + 160, y, { steps: 12 });
  await page.mouse.up({ button: 'right' });
  await expect(hint).toBeHidden();
  await open(page, '?c=tivat&lang=en');
  await expect(hint).toBeHidden();
  // Сброс — и скрытие кликом.
  await page.evaluate(() => localStorage.clear());
  await open(page, '?c=tivat&lang=en');
  await expect(hint).toBeVisible();
  await hint.click();
  await expect(hint).toBeHidden();
  await open(page, '?c=tivat&lang=en');
  await expect(hint).toBeHidden();
});

test('климат города у выбранного фасада: температура и ветер, без фасада строки нет', async ({ page }) => {
  await open(page, `?c=tivat&b=${B}&f=10&s=1&lang=en`);
  await expect(page.locator('.climate-line')).toBeHidden();
  await page.locator('.side[data-c="2"]').click();
  await expect(page.locator('.climate-line')).toContainText(/City climate around the June solstice: \+\d+° .* wind mostly from the [NESW]{1,2}, [\d.]+ m\/s/);
  await expect(page.locator('.climate-line')).toContainText('Not the microclimate');
});

test('после застройки (пилот, ДУП Мрчевац): переключатель у соседнего дома, зимой солнца меньше, источник и дата плана', async ({ page }) => {
  await open(page, '?c=tivat&b=1422729342&f=1&s=3&lang=en'); // к северу от планируемых домов P+4+Pk
  const box = page.locator('.plan-box');
  await expect(box).toBeVisible();
  await expect(page.locator('.plan-diff')).toContainText('may go up nearby');
  await expect(page.locator('.plan-source')).toContainText('DUP Mrčevac');
  await expect(page.locator('.plan-source')).toContainText('2013-06-20');
  const winter = () => page.locator('.seasons .card[data-s="3"] strong').textContent().then((s) => parseFloat(s!.replace(',', '.')));
  const before = await winter();
  await page.locator('.plan-chip[data-pl="1"]').click();
  await expect(page.locator('.plan-diff')).toContainText(/After planned building: .*winter −[\d.]+ h/);
  expect(await winter()).toBeLessThan(before);
  await page.locator('.plan-chip[data-pl="0"]').click();
  expect(await winter()).toBe(before);
  // Дом далеко от участков плана — переключателя нет.
  await open(page, `?c=tivat&b=${B}&f=10&lang=en`);
  await expect(box).toBeHidden();
});

test('панель: после примера выбран лучший фасад, действия сразу под сводкой, пояснения свёрнуты', async ({ page }) => {
  await open(page, '?c=tivat&lang=en');
  await page.locator('.example').first().click();
  await expect(page.locator('.side[aria-pressed="true"]')).not.toHaveText('All', { timeout: 30_000 });
  await expect(page).toHaveURL(/d=f\d/);
  await expect(page.locator('.bre')).not.toContainText('best facade'); // выбран конкретный фасад
  await expect(page.locator('.view-btn')).toBeEnabled();
  // Кнопки — сразу за сводкой, до матрицы.
  const order = await page.evaluate(() => ['.summary', '.actions', '.matrix'].map((s) => document.querySelector(s)!.getBoundingClientRect().top));
  expect(order[0] < order[1] && order[1] < order[2]).toBe(true);
  await expect(page.locator('details.more').first()).not.toHaveAttribute('open', '');
  await expect(page.locator('details.more').first()).toContainText('How to read');
  // Ссылка без фасада остаётся «здание целиком».
  await open(page, `?c=tivat&b=${B}&f=10&lang=en`);
  await expect(page.locator('.bre')).toContainText('best facade', { timeout: 30_000 });
  await expect(page.locator('.side[aria-pressed="true"]')).toHaveText('All');
});
