// Точка входа: без WebGL карта не создастся — показываем понятное сообщение и дальше не идём.
// Легенду показываем сразу: она лёгкая, а приложение с MapLibre (~1 МБ) ещё грузится.
import { hasWebGL, showFallback } from './fallback.ts';
import { t } from './i18n.ts';
import { showLegend } from './ui/legend.ts';

showLegend();
if (await hasWebGL()) await import('./boot.ts');
else {
  document.querySelector<HTMLElement>('.loading')!.hidden = true;
  document.querySelector<HTMLElement>('.legend-box')!.hidden = true;
  showFallback(t.noWebgl, false);
}
