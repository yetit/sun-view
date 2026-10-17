// Сценарии интерфейса: матрица «этажи × фасады», солнце за год, сравнение, PNG, состояние в ссылке, язык,
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
  await expect(bre).toHaveAttribute('data-v', /^(pass|edge|fail)$/);
  await expect(bre).toContainText('best facade on this floor');
  const cell = page.locator('.matrix .cell[data-f="10"]').first();
  const score = (await cell.textContent())!.replace('∿', '');
  await cell.click();
  await expect(page.locator('.bre strong')).toHaveText(`${score}of 100`);
  await expect(bre).not.toContainText('best facade');
  await expect(page.locator('.summary')).toContainText(`Annual sun ${score} of 100`);
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
