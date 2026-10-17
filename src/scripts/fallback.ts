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

// Первый WebGL-контекст дорогой: браузер поднимает GPU, а на программном рендере (SwiftShader в CI)
// это ~2 с, всё это время главный поток стоит. Поэтому сначала создаём контекст в воркере на
// OffscreenCanvas — GPU прогревается, не блокируя страницу, — а проверка здесь потом занимает
// десятки миллисекунд. Решает именно она: WebGL в воркере и на странице бывает доступен по-разному.
const warmup = `self.OffscreenCanvas && new OffscreenCanvas(1, 1).getContext('webgl2'); postMessage(0)`;

export async function hasWebGL() {
  await new Promise<void>((resolve) => {
    try {
      const w = new Worker(URL.createObjectURL(new Blob([warmup], { type: 'text/javascript' })));
      w.onmessage = w.onerror = () => { resolve(); w.terminate(); };
    } catch {
      resolve();
    }
  });
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') ?? c.getContext('webgl'));
  } catch {
    return false;
  }
}
