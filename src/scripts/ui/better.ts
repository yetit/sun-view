// «Солнечнее рядом»: по слою карты «Солнце» выбранного сезона на высоте ближе всего к окну —
// дом в 200 м, где эта высота есть и солнца заметно больше (здание целиком, как на карте).
import { floorAt, HEIGHTS } from '../analysis.ts';
import { $, city, fmtDay, fmtH, state, world } from '../app.ts';
import type { Bld } from '../grid.ts';
import { buildingName, t } from '../i18n.ts';
import { sunLayer } from './timebar.ts';

const R = 200, GAIN = 0.5; // м, ч

export function resetBetter() { $('.better-out').innerHTML = ''; }

export function initBetter(select: (b: Bld, floor: number) => void) {
  const out = $('.better-out');
  $('.better-btn').addEventListener('click', async () => {
    const b = state.current;
    if (!b) return;
    const eyeH = (state.floor - 0.5) * city.floorHeight;
    const h = HEIGHTS.reduce((a, x) => (Math.abs(x - eyeH) < Math.abs(a - eyeH) ? x : a));
    const fl = floorAt(world, h), season = state.season, day = state.day;
    const arr = await sunLayer(h);
    if (!arr || state.current !== b) return;
    let best: Bld | null = null;
    for (const o of world.blds) {
      if (o === b || o.floors < fl || Math.hypot(o.xy[0] - b.xy[0], o.xy[1] - b.xy[1]) > R) continue;
      if (!best || arr[o.idx] > arr[best.idx]) best = o;
    }
    if (!best || arr[best.idx] - arr[b.idx] < GAIN) { out.textContent = t.betterNone(fl); return; }
    const found = best;
    out.innerHTML = `<button type="button" class="link">${buildingName(found)}</button> ${t.betterFound(fl, fmtH.format(arr[found.idx]), fmtH.format(arr[found.idx] - arr[b.idx]), day ? fmtDay.format(day) : t.seasons[season])}`;
    out.querySelector('button')!.addEventListener('click', () => select(found, fl));
  });
}
