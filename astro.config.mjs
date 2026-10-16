import { defineConfig } from 'astro/config';

// BASE_PATH задаёт CI для GitHub Pages (/<repo>); локально и на Cloudflare Pages — корень.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  server: { port: 4325 },
  vite: { optimizeDeps: { include: ['maplibre-gl', 'suncalc'] } },
});
