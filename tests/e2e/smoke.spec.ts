// Карта действительно отрисована (а не пустой белый блок) и клик по примеру даёт результат.
import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';
import { cities } from '../../cities.config.mjs';

for (const city of cities) {
  test(`${city.id}: карта рисуется, пример считается`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`?c=${city.id}&lang=en&v=${Date.now()}`); // v — мимо кэша HTML на Pages

    const map = page.locator('#map');
    await expect.poll(async () => (await map.boundingBox())?.height ?? 0).toBeGreaterThan(300);
    await page.waitForFunction(() => performance.getEntriesByName('sv:painted').length > 0, null, { timeout: 60_000 });
    await expect(page.locator('.map-fallback')).toBeHidden();

    // Отрисованная карта пёстрая: на сетке пикселей скриншота десятки разных цветов.
    await page.waitForTimeout(1500);
    const png = PNG.sync.read(await map.screenshot());
    const colors = new Set<number>();
    for (let i = 0; i < png.data.length; i += 4 * 97) colors.add((png.data[i] << 16) | (png.data[i + 1] << 8) | png.data[i + 2]);
    expect(colors.size).toBeGreaterThan(40);

    const example = page.locator('.example').first();
    if (await example.count()) {
      await example.click();
      await expect(page.locator('.b-name')).not.toBeEmpty();
      await expect(page.locator('.seasons .card')).toHaveCount(4);
      await expect(page.locator('.summary')).not.toBeEmpty();
      await expect(page.locator('.matrix .cell.best')).toHaveCount(1); // матрица «этажи × фасады» посчиталась
    }
    expect(errors).toEqual([]);
  });
}
