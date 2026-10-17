// Запуск приложения (после проверки WebGL в main.ts): подписи, город, данные → мир → воркер → карта.
import { cities } from '../../cities.config.mjs';
import { $, $$, ask, BASE, city, num, params, setWorld, startWorker, state, urlDir } from './app.ts';
import { hasData, loadCityData } from './data.ts';
import { hideFallback, showFallback } from './fallback.ts';
import { createWorld } from './grid.ts';
import { cityName, lang, langHref, t } from './i18n.ts';
import { bindBuildings, map, mapReady } from './map/layers.ts';
import { initPanel, select } from './ui/panel.ts';
import { initSheet } from './ui/sheet.ts';
import { applyMode, initTimebar, setPrecomputed, updateLight } from './ui/timebar.ts';

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
initSheet();

// Загрузка по этапам: отмечаем пройденные в списке.
const stages = $('.stages');
stages.innerHTML = t.stages.map((s) => `<li>${s}</li>`).join('');
const stage = (i: number) => [...stages.children].forEach((li, j) => li.className = j < i ? 'done' : j === i ? 'active' : '');
// Этапы отмечаем в Performance API (sv:data, sv:world, …) — видно в DevTools и в продакшен-сборке.
const timing: Record<string, number> = {};
const mark = (k: string) => (timing[k] = Math.round(performance.mark(`sv:${k}`).startTime));

stage(0);
const data = await loadCityData(city.id);
mark('data');
stage(1);
// Растр крыш и деревьев строит воркер (ему он нужен для расчётов) и присылает копию сюда.
const { roofs } = await startWorker({ city, geojson: data.geojson, greenery: data.greenery, demMeta: data.demMeta, demBuf: data.demBuf });
mark('worker');
stage(2);
const world = createWorld(city, data.geojson, data.greenery, data.demMeta, data.demBuf, roofs);
setWorld(world, data.geojson);
setPrecomputed(data.precomputed);
mark('world');
(data.geojson.features as any[]).forEach((f, i) => { f.properties.h = world.blds[i].h; f.properties.assumed = world.blds[i].assumed; });
stage(3);
// Карта не загрузилась за 10 с (сеть, сервер тайлов) — сообщение с кнопкой; если догрузится — убираем.
const slow = setTimeout(() => showFallback(t.mapSlow, true), 10000);
await mapReady;
clearTimeout(slow);
hideFallback();
mark('map');
if (import.meta.env.DEV) Object.assign(window, { map, world, timing, ask }); // для проверки и замеров из консоли

initTimebar();
initPanel();
bindBuildings(select);
const known = world.blds.filter((b) => !b.assumed).length;
$('.hint').textContent = t.count(world.blds.length, known);
$('.accuracy').textContent = t.accuracy(Math.round((100 * known) / world.blds.length));
$('.loading').hidden = true;
$('.empty').hidden = false;
updateLight();
await applyMode();
mark('painted');
map.on('moveend', () => !state.current && updateLight()); // тени вокруг центра карты
const b = world.blds.find((x) => x.id === num(params.get('b'), -1));
if (b) select(b, { floor: num(params.get('f'), 0) || undefined, side: state.side, dir: urlDir, floors: state.floorsOverride });
