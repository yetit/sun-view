import { defineConfig } from 'astro/config';

export default defineConfig({
  server: { port: 4325 },
  vite: { optimizeDeps: { include: ['maplibre-gl', 'suncalc'] } },
});
