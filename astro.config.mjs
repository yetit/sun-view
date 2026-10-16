import { defineConfig } from 'astro/config';

// BASE_PATH задаёт CI для GitHub Pages (/<repo>); локально и на Cloudflare Pages — корень.
// SITE — origin для абсолютных ссылок в og:image (CI задаёт https://<owner>.github.io).
export default defineConfig({
  site: process.env.SITE,
  base: (process.env.BASE_PATH ?? '/').replace(/\/?$/, '/'), // со слешем в конце: BASE_URL + 'file'
  server: { port: 4325 },
  vite: { optimizeDeps: { include: ['maplibre-gl', 'suncalc'] } },
});
