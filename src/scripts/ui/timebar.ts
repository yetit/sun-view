// Таймбар: сезон, время суток, воспроизведение, режимы карты (солнце/море) и легенда.
import { eye, facing, floorAt, HEIGHTS, STEP_MIN, sunAt } from '../analysis.ts';
import { $, $$, ask, city, facadeOf, fmtH, fmtT, sliderTime, state, syncUrl, world } from '../app.ts';
import { loadLevels } from '../data.ts';
import { blocked } from '../grid.ts';
import { t } from '../i18n.ts';
import { applyColors, map, pathPoint, setData } from '../map/layers.ts';
import { drawShadows } from '../map/shadows.ts';
import type { Mode } from '../style.ts';
import { showLegend } from './legend.ts';
import { refreshSeason } from './panel.ts';

const DEG = 180 / Math.PI;

export function updateLight() {
  const time = sliderTime();
  const { current, floor } = state;
  const s = sunAt(time, ...(current?.center ?? city.camera.center));
  const up = s.altitude > 0;
  // На картах солнца и моря цвет домов — данные: низкое или ночное солнце не должно уводить их в чёрный,
  // поэтому свет не тусклее нейтрального и без оттенка. В обычном режиме — как у настоящего солнца.
  const data = state.mode !== 'normal';
  map.setLight({
    anchor: 'map',
    position: [1.5, s.bearing * DEG, up ? 90 - s.altitude * DEG : 88],
    intensity: Math.max(up ? 0.3 + 0.4 * Math.sin(s.altitude) : 0.12, data ? 0.5 : 0),
    color: data ? '#ffffff' : !up ? '#9fb0d0' : s.altitude < 0.2 ? '#ffd3a0' : '#ffffff',
  });
  $('.clock').textContent = fmtT.format(time);
  $('.timebar').classList.toggle('night', !up);
  drawShadows(s);
  if (!current) return;
  const e = eye(world, current, floor, facadeOf());
  const front = facing(e, s.bearing);
  const lit = up && front && !blocked(world, current, e.x, e.y, e.z, s.bearing, s.altitude);
  const now = $('.now');
  now.className = `now ${!up ? 'night' : lit ? 'lit' : 'shade'}`;
  now.textContent = `${fmtT.format(time)} — ${!up ? t.now.night : lit ? t.now.lit : front ? t.now.shade : t.now.back}`;
  setData('sunnow', up ? [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: pathPoint(current, s.altitude, s.bearing) } }] : []);
}

// Карты солнца/моря: сначала предрасчёт из data/<id>/precomputed.*, иначе воркер (с кэшем).
let precomputed: Map<string, Uint8Array> | null = null;
export const setPrecomputed = (p: Map<string, Uint8Array> | null) => (precomputed = p);
const cache = new Map<string, ArrayLike<number>>();
let modeReq = 0;

async function layerValues(key: string, progress: HTMLElement): Promise<ArrayLike<number> | null> {
  const pre = precomputed?.get(key);
  if (pre) return key.startsWith('sun') ? Float32Array.from(pre, (v) => (v * STEP_MIN) / 60) : pre;
  if (cache.has(key)) return cache.get(key)!;
  const [type, a, b] = key.split(':');
  const my = modeReq;
  const res = await ask(type === 'sun' ? { type, season: +a, h: +b } : { type, h: +a }, (p, n) => (progress.textContent = `${p} / ${n}`));
  progress.textContent = '';
  cache.set(key, res.data);
  return my === modeReq ? res.data : null;
}

export async function applyMode() {
  const { mode, height, season } = state;
  showLegend();
  $$('.mode-chip').forEach((c) => c.setAttribute('aria-checked', String(c.dataset.mode === mode)));
  applyColors();
  updateLight(); // свет зависит от режима (см. updateLight)
  syncUrl();
  if (mode === 'normal') { $('.progress').textContent = ''; return; }
  if (mode === 'levels') {
    $('.legend-note').textContent = t.legendLevelsNote;
    ['0', '3', '≥ 6'].forEach((v, i) => ($(['.legend-min', '.legend-mid', '.legend-max'][i]).textContent = v));
    const my = ++modeReq;
    const lv = await loadLevels(city.id);
    if (my !== modeReq) return;
    world.blds.forEach((b) => map.setFeatureState({ source: 'buildings', id: b.id }, { v: lv.get(b.id)?.[0] ?? 0, low: false }));
    return;
  }
  const sun = mode === 'sun';
  const low = world.blds.map((b) => b.floors < floorAt(world, height));
  const floor = floorAt(world, height);
  // Пояснения — в подсказке за значком «i», на виду только шкала.
  $('.legend-note').textContent = [sun ? t.legendQuantiles : '', low.some(Boolean) ? t.legendLow(floor) : ''].filter(Boolean).join('. ');
  if (!sun) ['0', '2', '≥ 4'].forEach((s, i) => ($(['.legend-min', '.legend-mid', '.legend-max'][i]).textContent = s));
  ++modeReq;
  const arr = await layerValues(sun ? `sun:${season}:${height}` : `sea:${height}`, $('.progress'));
  if (!arr) return;
  world.blds.forEach((b, i) => map.setFeatureState({ source: 'buildings', id: b.id }, { v: arr[i], low: low[i] }));
  if (!sun) return;
  // Шкала по распределению слоя: цвета на 10, 50 и 90 % зданий, достающих до высоты окна (если их мало — всех).
  const all = Array.from(arr), reach = all.filter((_, i) => !low[i]);
  const vals = (reach.length >= 20 ? reach : all).sort((a, b) => a - b);
  const scale = [0.1, 0.5, 0.9].map((p) => vals[Math.floor(p * (vals.length - 1))]);
  scale[1] = Math.max(scale[1], scale[0] + 0.1); scale[2] = Math.max(scale[2], scale[1] + 0.1); // interpolate требует возрастания
  ['≤ ', '', '≥ '].forEach((pre, i) => ($(['.legend-min', '.legend-mid', '.legend-max'][i]).textContent = `${pre}${fmtH.format(scale[i])} ${t.h}`));
  applyColors(scale);
}

export function initTimebar() {
  const hourInput = $<HTMLInputElement>('.hour');
  hourInput.value = String(state.hour);
  const setHour = (h: number) => { state.hour = Math.min(22, Math.max(4, h)); hourInput.value = String(state.hour); updateLight(); syncUrl(); };
  hourInput.addEventListener('input', () => setHour(+hourInput.value));

  const chips = $$('.chip');
  chips.forEach((chip, i) => {
    chip.textContent = t.seasons[i];
    chip.title = t.seasonsFull[i];
    chip.classList.toggle('active', i === state.season);
    chip.addEventListener('click', () => setSeason(i));
  });

  // Сутки за ~12 секунд, по кругу.
  let playing = false, lastTs = 0;
  const frame = (ts: number) => {
    if (!playing) return;
    if (lastTs) { const h = state.hour + (1.5 * (ts - lastTs)) / 1000; setHour(h > 22 ? 4 : h); }
    lastTs = ts;
    requestAnimationFrame(frame);
  };
  const play = $<HTMLButtonElement>('.play');
  const togglePlay = () => {
    playing = !playing; lastTs = 0;
    play.textContent = playing ? '❚❚' : '▶';
    play.setAttribute('aria-pressed', String(playing));
    if (playing) requestAnimationFrame(frame);
  };
  play.addEventListener('click', togglePlay);
  addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).matches('input, select, textarea, button, .maplibregl-canvas')) return;
    if (e.key === 'ArrowLeft') setHour(state.hour - 0.25);
    else if (e.key === 'ArrowRight') setHour(state.hour + 0.25);
    else if (e.key === ' ') { e.preventDefault(); togglePlay(); }
  });

  $$<HTMLButtonElement>('.mode-chip').forEach((c) => {
    c.textContent = t.modes[c.dataset.mode as Mode];
    c.addEventListener('click', () => { state.mode = c.dataset.mode as Mode; applyMode(); });
  });
  const floorModeSel = $<HTMLSelectElement>('.floor-mode');
  // В списке — этаж, метры над землёй — в подсказке.
  floorModeSel.innerHTML = HEIGHTS.map((h) => `<option value="${h}" title="${t.heightTitle(h)}">${t.floorOption(floorAt(world, h))}</option>`).join('');
  const syncTitle = () => (floorModeSel.title = t.heightTitle(+floorModeSel.value));
  floorModeSel.value = String(state.height);
  syncTitle();
  floorModeSel.addEventListener('change', () => { state.height = +floorModeSel.value; syncTitle(); applyMode(); });
  // Подсказка легенды: наведение и фокус — через CSS, тап на телефоне — переключением класса.
  const info = $('.legend-info');
  info.setAttribute('aria-label', t.legendInfo);
  info.addEventListener('click', () => $('.legend-box').classList.toggle('tip-open'));
  $('.legend-assumed').textContent = t.legendAssumed;
}

export function setSeason(i: number) {
  state.season = i;
  $$('.chip').forEach((c, j) => c.classList.toggle('active', j === i));
  refreshSeason();
  updateLight(); syncUrl();
  if (state.mode === 'sun') applyMode();
}
