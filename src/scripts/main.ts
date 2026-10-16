// Точка входа: город, данные, мир, воркер, затем панель и таймбар.
import { cities } from '../../cities.config.mjs';
import { $, city, num, params, setWorld, startWorker, state } from './app.ts';
import { hasData, loadCityData } from './data.ts';
import { createWorld } from './grid.ts';
import { bindBuildings, map } from './map/layers.ts';
import { initPanel, select } from './ui/panel.ts';
import { applyMode, initTimebar, updateLight } from './ui/timebar.ts';

document.title = `Sun & View — ${city.name}`;
$('.brand span').textContent = city.name;
const citySel = $<HTMLSelectElement>('.city');
citySel.innerHTML = cities.filter((c) => hasData(c.id)).map((c) => `<option value="${c.id}"${c.id === city.id ? ' selected' : ''}>${c.name}</option>`).join('');
citySel.addEventListener('change', () => (location.search = `?c=${citySel.value}`));

const data = await loadCityData(city.id);
const world = createWorld(city, data.geojson, data.greenery, data.demMeta, data.demBuf);
setWorld(world, data.geojson);
if (import.meta.env.DEV) Object.assign(window, { map, world }); // для проверки из консоли
(data.geojson.features as any[]).forEach((f, i) => { f.properties.h = world.blds[i].h; f.properties.assumed = world.blds[i].assumed; });
startWorker({ city, geojson: data.geojson, greenery: data.greenery, demMeta: data.demMeta, demBuf: data.demBuf });

initTimebar();
initPanel();

map.once('load', () => {
  bindBuildings(select);
  $('.hint').textContent = `${world.blds.length} зданий, у ${world.blds.filter((b) => !b.assumed).length} известна этажность`;
  $<HTMLButtonElement>('.example').disabled = false;
  updateLight();
  applyMode();
  const b = world.blds.find((x) => x.id === num(params.get('b'), -1));
  if (b) select(b, { floor: num(params.get('f'), 0) || undefined, side: state.side });
});
