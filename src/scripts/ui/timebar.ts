// Таймбар: сезон, время суток, воспроизведение, режимы карты (солнце/море) и легенда.
import { eye, facing, sunAt, type FloorMode } from '../analysis.ts';
import { $, $$, ask, city, fmtT, sliderTime, state, syncUrl, world } from '../app.ts';
import { blocked } from '../grid.ts';
import { t } from '../i18n.ts';
import { applyColors, map, pathPoint, setData } from '../map/layers.ts';
import { drawShadows } from '../map/shadows.ts';
import { SEA_RAMP, SUN_RAMP, type Mode } from '../style.ts';
import { refreshSeason } from './panel.ts';

const DEG = 180 / Math.PI;

export function updateLight() {
  const time = sliderTime();
  const { current, floor, side } = state;
  const s = sunAt(time, ...(current?.center ?? city.camera.center));
  const up = s.altitude > 0;
  map.setLight({
    anchor: 'map',
    position: [1.5, s.bearing * DEG, up ? 90 - s.altitude * DEG : 88],
    intensity: up ? 0.3 + 0.4 * Math.sin(s.altitude) : 0.12,
    color: !up ? '#9fb0d0' : s.altitude < 0.2 ? '#ffd3a0' : '#ffffff',
  });
  $('.clock').textContent = fmtT.format(time);
  $('.timebar').classList.toggle('night', !up);
  drawShadows(s);
  if (!current) return;
  const e = eye(world, current, floor, side);
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
  if (pre) return key.startsWith('sun') ? Float32Array.from(pre, (v) => v / 100) : pre;
  if (cache.has(key)) return cache.get(key)!;
  const [type, a, b] = key.split(':');
  const my = modeReq;
  const res = await ask(type === 'sun' ? { type, season: +a, mode: b } : { type, mode: a }, (p, n) => (progress.textContent = `${p} / ${n}`));
  progress.textContent = '';
  cache.set(key, res.data);
  return my === modeReq ? res.data : null;
}

export async function applyMode() {
  const { mode, floorMode, season } = state;
  document.body.dataset.mode = mode;
  $$('.mode-chip').forEach((c) => c.setAttribute('aria-checked', String(c.dataset.mode === mode)));
  applyColors();
  syncUrl();
  $('.legend-box').hidden = mode === 'normal';
  if (mode === 'normal') { $('.progress').textContent = ''; return; }
  const sun = mode === 'sun';
  const fl = t.floorModes[floorMode];
  $('.legend-title').textContent = sun ? t.legendSun(t.seasons[season], fl) : t.legendSea(fl);
  $('.legend-bar').style.background = `linear-gradient(90deg, ${(sun ? SUN_RAMP : SEA_RAMP).join(',')})`;
  $('.legend-min').textContent = sun ? t.legendSunMin : t.legendSeaMin;
  $('.legend-max').textContent = sun ? t.legendSunMax : t.legendSeaMax;
  ++modeReq;
  const arr = await layerValues(sun ? `sun:${season}:${floorMode}` : `sea:${floorMode}`, $('.progress'));
  if (!arr) return;
  world.blds.forEach((b, i) => map.setFeatureState({ source: 'buildings', id: b.id }, { v: arr[i] }));
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
    if ((e.target as HTMLElement).matches('input, select, textarea, button')) return;
    if (e.key === 'ArrowLeft') setHour(state.hour - 0.25);
    else if (e.key === 'ArrowRight') setHour(state.hour + 0.25);
    else if (e.key === ' ') { e.preventDefault(); togglePlay(); }
  });

  $$<HTMLButtonElement>('.mode-chip').forEach((c) => {
    c.textContent = t.modes[c.dataset.mode as Mode];
    c.addEventListener('click', () => { state.mode = c.dataset.mode as Mode; applyMode(); });
  });
  const floorModeSel = $<HTMLSelectElement>('.floor-mode');
  floorModeSel.innerHTML = (['1', 'mid', 'top'] as FloorMode[]).map((m) => `<option value="${m}">${t.floorModes[m]}</option>`).join('');
  floorModeSel.value = state.floorMode;
  floorModeSel.addEventListener('change', () => { state.floorMode = floorModeSel.value as FloorMode; applyMode(); });
  $('.legend-assumed').textContent = t.legendAssumed;
}

export function setSeason(i: number) {
  state.season = i;
  $$('.chip').forEach((c, j) => c.classList.toggle('active', j === i));
  refreshSeason();
  updateLight(); syncUrl();
  if (state.mode === 'sun') applyMode();
}
