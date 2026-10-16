// Сообщение вместо пустой карты: нет WebGL или карта не загрузилась вовремя.
import { t } from './i18n.ts';

const box = () => document.querySelector<HTMLElement>('.map-fallback')!;

export function showFallback(text: string, retry: boolean) {
  box().querySelector('.map-fallback-text')!.textContent = text;
  const btn = box().querySelector<HTMLButtonElement>('.map-fallback-retry')!;
  btn.hidden = !retry;
  btn.textContent = t.retry;
  btn.onclick = () => location.reload();
  box().hidden = false;
}
export const hideFallback = () => (box().hidden = true);

export function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') ?? c.getContext('webgl'));
  } catch {
    return false;
  }
}
