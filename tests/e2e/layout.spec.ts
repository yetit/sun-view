// Вёрстка: плавающие блоки над картой не перекрывают друг друга, атрибуция видна, выбор этажа в кадре,
// страница не шире окна — на пяти ширинах (десктоп, узкий десктоп, телефон). Это ловит то, что раньше
// находилось только глазами: атрибуцию под таймбаром и листом, подсказку поверх легенды.
// Снимки панели — только локально на macOS: на другой ОС другие шрифты и сглаживание.
import { expect, test, type Page } from '@playwright/test';

const painted = (page: Page) => page.waitForFunction(() => performance.getEntriesByName('sv:painted').length > 0, null, { timeout: 60_000 });

const VIEWPORTS = [
  { name: '1440', width: 1440, height: 900, mobile: false },
  { name: '1024', width: 1024, height: 768, mobile: false },
  { name: '800', width: 800, height: 700, mobile: false },
  { name: '390', width: 390, height: 844, mobile: true },
  { name: '320', width: 320, height: 640, mobile: true },
];
const PAGES = [
  { name: 'город', q: '?c=tivat&lang=ru' },
  { name: 'дом (en)', q: '?c=bergen&b=289528809&f=13&d=f2&s=1&lang=en' },
];

// Что не так с вёрсткой: список названий нарушений, пустой — всё в порядке.
const problems = (page: Page) => page.evaluate(() => {
  const vis = (el: Element | null) => !!el && !el.closest('[hidden]') && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0;
  const R = (s: string) => { const e = document.querySelector(s); return vis(e) ? e!.getBoundingClientRect() : null; };
  const over = (a: DOMRect | null, b: DOMRect | null) => !!a && !!b && Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2;
  const att = R('.maplibregl-ctrl-bottom-right'), tb = R('.timebar'), pn = R('.panel'), lg = R('.legend-box'), hint = R('.rotate-hint'), sel = R('.floor-mode'), nav = R('.maplibregl-ctrl-top-left');
  const mobile = innerWidth <= 720, out: string[] = [];
  if (!att || att.bottom > innerHeight || (mobile && att.bottom > pn!.top + 1)) out.push('атрибуция не видна');
  if (over(att, tb)) out.push('атрибуция × таймбар');
  if (mobile && over(att, pn)) out.push('атрибуция × панель');
  if (over(hint, lg)) out.push('подсказка × легенда');
  if (over(hint, att)) out.push('подсказка × атрибуция');
  if (over(hint, tb)) out.push('подсказка × таймбар');
  if (over(hint, nav)) out.push('подсказка × кнопки карты');
  // Ряд режимов в развёрнутом листе с открытым домом скрыт намеренно (компактный таймбар) — тогда не проверяем.
  if (R('.modes') && (!sel || sel.right > innerWidth + 1 || (mobile && sel.bottom > pn!.bottom))) out.push('выбор этажа за краем');
  if (document.documentElement.scrollWidth > innerWidth) out.push('горизонтальный скролл');
  return out;
});

for (const vp of VIEWPORTS) {
  test.describe(`вёрстка ${vp.name}px`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.mobile, hasTouch: vp.mobile });
    for (const pg of PAGES) {
      test(pg.name, async ({ page }) => {
        await page.goto(`${pg.q}&v=${Date.now()}`);
        await painted(page);
        await page.waitForTimeout(1500); // легенда, подсказка и таймбар встают на место
        expect(await problems(page)).toEqual([]);
        if (vp.mobile) {
          // Свёрнутый лист (как в «Виде из окна»): таймбар целиком, выбор этажа в кадре.
          await page.evaluate(() => (document.body.dataset.sheet = 'peek'));
          await page.waitForTimeout(500);
          expect(await problems(page)).toEqual([]);
        }
      });
    }
  });
}

test.describe('снимки панели', () => {
  test.skip(process.platform !== 'darwin' || !!process.env.CI, 'снимки — только локально на macOS');
  for (const vp of [VIEWPORTS[0], VIEWPORTS[3]]) {
    test(`дом ${vp.name}px`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(`?c=bergen&b=289528809&f=13&d=f2&s=1&lang=en&v=${Date.now()}`);
      await painted(page);
      await expect(page.locator('.bre')).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(1500);
      // Структура и вёрстка панели; числа и рисунки зависят от данных и обновляются раз в месяц — под маской.
      await expect(page.locator('.panel')).toHaveScreenshot(`panel-${vp.name}.png`, {
        mask: [page.locator('.panel').locator('.matrix, .seasons, .bre-box, .summary, .ribbon, .rose, .climate-line, .heat-line, .roof-line, .now, .eye, .b-meta, .trust, canvas')],
        maxDiffPixelRatio: 0.01,
      });
    });
  }
});
