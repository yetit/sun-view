// Smoke-тест живой страницы. SMOKE_URL — опубликованное демо (CI после деплоя);
// без него Playwright сам собирает проект и поднимает astro preview с тем же базовым путём, что на Pages.
import { defineConfig } from '@playwright/test';

const url = process.env.SMOKE_URL;
const local = 'http://localhost:4326/sun-view/';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: url ?? local,
    viewport: { width: 1280, height: 800 },
    // WebGL в headless-браузере без GPU — через SwiftShader.
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
  },
  webServer: url ? undefined : {
    // --ignore-lock: Astro 7 под ИИ-агентом сам уводит preview в фон (демон с --json), и Playwright
    // считал бы, что сервер «вышел раньше времени», а демон оставался висеть. С флагом — обычный процесс,
    // который Playwright запускает и гасит сам.
    command: 'BASE_PATH=/sun-view/ npm run build && BASE_PATH=/sun-view/ npx astro preview --port 4326 --ignore-lock',
    url: local,
    reuseExistingServer: true,
    timeout: 240_000,
  },
});
