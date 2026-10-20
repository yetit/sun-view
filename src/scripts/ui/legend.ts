// Заголовок и цвета легенды от расчёта не зависят — main.ts показывает их сразу, до загрузки карты
// и данных (шкалу в часах applyMode допишет, когда готов слой).
import { floorAt } from '../analysis.ts';
import { $, city, fmtDay, state } from '../app.ts';
import { t } from '../i18n.ts';
import { LEVELS_RAMP, SEA_RAMP, SUN_RAMP } from '../style.ts';

export function showLegend() {
  const { mode, height, season, day } = state;
  document.body.dataset.mode = mode;
  $('.legend-box').hidden = mode === 'normal';
  if (mode === 'normal') return;
  if (mode === 'levels') {
    $('.legend-title').textContent = t.legendLevels;
    $('.legend-bar').style.background = `linear-gradient(90deg, ${LEVELS_RAMP.join(',')})`;
    return;
  }
  const sun = mode === 'sun', floor = floorAt({ city }, height);
  $('.legend-title').textContent = sun ? t.legendSun(day ? fmtDay.format(day) : t.seasons[season].toLowerCase(), floor) : t.legendSea(floor);
  $('.legend-bar').style.background = `linear-gradient(90deg, ${(sun ? SUN_RAMP : SEA_RAMP).join(',')})`;
}
