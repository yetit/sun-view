// Запуск приложения (после проверки WebGL в main.ts): подписи, город, данные → воркер → мир, затем карта.
// MapLibre (~1 МБ) и интерфейс карты — в ui/start.ts: импорт начинается после запроса данных,
// чтобы сеть за данными не ждала разбора большого бандла.
import { cities } from '../../cities.config.mjs';
import { $, $$, BASE, city, embed, params, setWorld, startWorker } from './app.ts';
import { hasData, loadCityData } from './data.ts';
import { createWorld } from './grid.ts';
import { cityName, lang, langHref, t } from './i18n.ts';
import { initSheet } from './ui/sheet.ts';

// Статические подписи: data-i — текст, data-i-ph / -title / -aria — атрибуты.
for (const el of $$('[data-i]')) el.textContent = (t as any)[el.dataset.i!];
for (const el of $$('[data-i-ph]')) el.setAttribute('placeholder', (t as any)[el.dataset.iPh!]);
for (const el of $$('[data-i-title]')) el.title = (t as any)[el.dataset.iTitle!];
for (const el of $$('[data-i-aria]')) el.setAttribute('aria-label', (t as any)[el.dataset.iAria!]);
$('.about2').innerHTML = t.about2(`${BASE}method${lang === 'en' ? '?lang=en' : ''}`);
$('.compare thead tr').innerHTML = t.compareHead.map((h) => `<th>${h}</th>`).join('');
const langLink = $<HTMLAnchorElement>('.lang');
langLink.textContent = t.langSwitch;
langLink.title = t.langSwitchTitle;
langLink.href = langHref(lang === 'en' ? 'ru' : 'en');

document.title = `Sun & View — ${cityName(city)}`;
const citySel = $<HTMLSelectElement>('.city');
citySel.innerHTML = cities.filter((c) => hasData(c.id)).map((c) => `<option value="${c.id}"${c.id === city.id ? ' selected' : ''}>${cityName(c)}</option>`).join('');
citySel.addEventListener('change', () => { const u = new URL(location.href); u.search = `?c=${citySel.value}${params.get('lang') ? `&lang=${lang}` : ''}`; location.href = u.href; });
// Встраивание: только карта и компактная панель, высоту документа сообщаем родительской странице.
if (embed) {
  document.body.classList.add('embed');
  document.body.dataset.sheet = 'embed';
  $('.lead').textContent = t.embedLead;
  if (parent !== window) {
    const post = () => parent.postMessage({ type: 'sun-view:height', height: document.documentElement.scrollHeight }, '*');
    new ResizeObserver(post).observe(document.body);
  }
} else initSheet();

// Загрузка по этапам: отмечаем пройденные в списке.
const stages = $('.stages');
stages.innerHTML = t.stages.map((s) => `<li>${s}</li>`).join('');
const stage = (i: number) => [...stages.children].forEach((li, j) => li.className = j < i ? 'done' : j === i ? 'active' : '');
// Этапы отмечаем в Performance API (sv:data, sv:world, …) — видно в DevTools и в продакшен-сборке.
const timing: Record<string, number> = {};
const mark = (k: string) => (timing[k] = Math.round(performance.mark(`sv:${k}`).startTime));

stage(0);
const dataP = loadCityData(city.id);
const uiP = import('./ui/start.ts'); // MapLibre и интерфейс — параллельно с данными
const data = await dataP;
mark('data');
stage(1);
// Растр крыш и деревьев строит воркер (ему он нужен для расчётов) и присылает копию сюда.
const { roofs } = await startWorker({ city, bldMeta: data.bldMeta, bldBuf: data.bldBuf, canopy: data.canopy, demMeta: data.demMeta, demBuf: data.demBuf });
mark('worker');
stage(2);
const world = createWorld(city, data.geojson, data.canopy, data.demMeta, data.demBuf, roofs);
setWorld(world, data.geojson, data.sunshine);
mark('world');
(data.geojson.features as any[]).forEach((f, i) => { f.properties.h = world.blds[i].h; f.properties.assumed = world.blds[i].assumed; });
stage(3);
await (await uiP).start(world, data, mark, timing);
