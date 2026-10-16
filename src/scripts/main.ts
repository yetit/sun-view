// Точка входа: без WebGL карта не создастся — показываем понятное сообщение и дальше не идём.
import { hasWebGL, showFallback } from './fallback.ts';
import { t } from './i18n.ts';

if (hasWebGL()) await import('./boot.ts');
else {
  document.querySelector<HTMLElement>('.loading')!.hidden = true;
  showFallback(t.noWebgl, false);
}
