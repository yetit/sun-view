// Примеры на пустой панели: подобраны по расчёту (cities.config.mjs → examples), в подписи — свежий расчёт.
import { eye, seaRose, seasonCalc } from '../analysis.ts';
import { $, $$, city, fmtH, world } from '../app.ts';
import { facades, type Bld } from '../grid.ts';
import { lang, t } from '../i18n.ts';
import { facadeByDir } from './format.ts';

type Example = NonNullable<typeof city.examples>[number];

export function renderExamples(pick: (ex: Example, b: Bld) => void) {
  const list = (city.examples ?? []).map((ex) => ({ ex, b: world.blds.find((x) => x.id === ex.b) })).filter((x) => x.b);
  $('.examples-box').hidden = !list.length;
  $('.examples').innerHTML = list.map(({ ex, b }, i) => {
    const side = facadeByDir(b!, ex.d);
    const s = seasonCalc(world, b!, eye(world, b!, ex.f, side == null ? null : facades(world, b!)[side] ?? null), ex.s);
    const sea = seaRose(world, b!, ex.f).filter((d) => d.dist != null).length;
    return `<button type="button" class="example" data-i="${i}"><b>${lang === 'en' ? ex.en : ex.ru}</b><small>${t.seasons[ex.s]} · ${t.floor.toLowerCase()} ${ex.f} · ☀ ${fmtH.format(s.sun)} ${t.h} · ∿ ${sea}/8</small></button>`;
  }).join('');
  $$<HTMLButtonElement>('.example').forEach((btn) => btn.addEventListener('click', () => {
    const { ex, b } = list[+btn.dataset.i!];
    pick(ex, b!);
  }));
}
