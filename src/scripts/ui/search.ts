// Поиск адреса (Photon, без ключа). Только в пределах города: bbox в запросе и повторная проверка
// ответа (Photon bbox мягкий). Найденный дом ближе 150 м — выбираем, иначе просто летим к точке.
import { $, city, world } from '../app.ts';
import type { Bld } from '../grid.ts';
import { lang, t } from '../i18n.ts';
import { map, sheetPadding } from '../map/layers.ts';

export function initSearch(select: (b: Bld) => void) {
  const search = $<HTMLInputElement>('.search');
  const results = $('.search-results');
  const { south, west, north, east } = city.bbox;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let feats: any[] = [];
  let active = -1;
  const pickResult = (i: number) => {
    const [lon, lat] = feats[i].geometry.coordinates;
    results.hidden = true;
    search.setAttribute('aria-expanded', 'false');
    const [x, y] = world.proj.toXY(lon, lat);
    const near = world.blds.map((b) => ({ b, d: Math.hypot(b.xy[0] - x, b.xy[1] - y) })).sort((a, b) => a.d - b.d)[0];
    if (near && near.d < 150) select(near.b);
    else map.flyTo({ center: [lon, lat], zoom: 16.5, pitch: 55, duration: 1200, padding: sheetPadding() });
  };
  const highlight = () => results.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-selected', String(i === active)));
  search.addEventListener('input', () => {
    clearTimeout(timer);
    if (search.value.trim().length < 3) { results.hidden = true; return; }
    timer = setTimeout(async () => {
      const [lon, lat] = city.camera.center;
      const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(search.value.trim())}&lat=${lat}&lon=${lon}&bbox=${west},${south},${east},${north}&limit=8&lang=${lang === 'en' ? 'en' : 'default'}`;
      const res = await fetch(url).then((r) => r.json()).catch(() => null);
      feats = (res?.features ?? []).filter((f: any) => { const [x, y] = f.geometry.coordinates; return x >= west && x <= east && y >= south && y <= north; }).slice(0, 6);
      active = -1;
      results.innerHTML = feats.length
        ? feats.map((f, i) => { const p = f.properties; return `<button type="button" role="option" data-i="${i}">${[p.name, p.street, p.housenumber].filter(Boolean).join(' ') || p.city}<small>${[p.city ?? p.county, p.country].filter(Boolean).join(', ')}</small></button>`; }).join('')
        : `<span>${t.nothing}</span>`;
      results.hidden = false;
      search.setAttribute('aria-expanded', 'true');
      results.querySelectorAll<HTMLButtonElement>('button').forEach((btn) => btn.addEventListener('mousedown', (e) => { e.preventDefault(); pickResult(+btn.dataset.i!); }));
    }, 350);
  });
  search.addEventListener('keydown', (e) => {
    if (results.hidden || !feats.length) return;
    if (e.key === 'ArrowDown') { active = (active + 1) % feats.length; highlight(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { active = (active - 1 + feats.length) % feats.length; highlight(); e.preventDefault(); }
    else if (e.key === 'Enter') { pickResult(Math.max(0, active)); e.preventDefault(); }
    else if (e.key === 'Escape') results.hidden = true;
  });
  search.addEventListener('blur', () => setTimeout(() => (results.hidden = true), 150));
}
