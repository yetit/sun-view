// Нижняя панель: сезон, время суток, воспроизведение, режимы карты (солнце/море) и легенда.
import { eye, facing, SEASONS, sunAt, type FloorMode } from '../analysis.ts';
import { $, $$, ask, city, fmtT, sliderTime, state, syncUrl, world } from '../app.ts';
import { blocked } from '../grid.ts';
import { applyColors, map, pathPoint, setData } from '../map/layers.ts';
import { SEA_RAMP, SUN_RAMP, type Mode } from '../style.ts';
import { refreshSeason } from './panel.ts';

const DEG = 180 / Math.PI;

export function updateLight() {
  const t = sliderTime();
  const { current, floor, side } = state;
  const s = sunAt(t, ...(current?.center ?? city.camera.center));
  const up = s.altitude > 0;
  map.setLight({
    anchor: 'map',
    position: [1.5, s.bearing * DEG, up ? 90 - s.altitude * DEG : 88],
    intensity: up ? 0.3 + 0.4 * Math.sin(s.altitude) : 0.12,
    color: !up ? '#9fb0d0' : s.altitude < 0.2 ? '#ffd3a0' : '#ffffff',
  });
  $('.clock').textContent = fmtT.format(t);
  $('.timebar').classList.toggle('night', !up);
  if (!current) return;
  const e = eye(world, current, floor, side);
  const front = facing(e, s.bearing);
  const lit = up && front && !blocked(world, current, e.x, e.y, e.z, s.bearing, s.altitude);
  const now = $('.now');
  now.className = `now ${!up ? 'night' : lit ? 'lit' : 'shade'}`;
  now.textContent = `${fmtT.format(t)} — ${!up ? 'солнце за горизонтом' : lit ? 'солнце в окнах' : front ? 'окна в тени' : 'солнце с другой стороны дома'}`;
  setData('sunnow', up ? [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: pathPoint(current, s.altitude, s.bearing) } }] : []);
}

const FLOOR_LABEL: Record<FloorMode, string> = { '1': '1-й этаж', mid: 'средний этаж', top: 'верхний этаж' };
const cache = new Map<string, Float32Array | Uint8Array>();
let modeReq = 0;

export async function applyMode() {
  const { mode, floorMode, season } = state;
  document.body.dataset.mode = mode;
  applyColors();
  syncUrl();
  $('.legend-box').hidden = mode === 'normal';
  const progress = $('.progress');
  if (mode === 'normal') { progress.textContent = ''; return; }
  const sun = mode === 'sun';
  $('.legend-title').textContent = sun ? `Солнце в окнах, ${SEASONS[season].short.toLowerCase()}, ${FLOOR_LABEL[floorMode]}` : `Море из окон, ${FLOOR_LABEL[floorMode]}`;
  $('.legend-bar').style.background = `linear-gradient(90deg, ${(sun ? SUN_RAMP : SEA_RAMP).join(',')})`;
  $('.legend-min').textContent = sun ? '≤ 30 % дня' : '0 румбов';
  $('.legend-max').textContent = sun ? '≥ 95 % дня' : '8 румбов';
  const key = sun ? `sun:${season}:${floorMode}` : `sea:${floorMode}`;
  const my = ++modeReq;
  let arr = cache.get(key);
  if (!arr) {
    const res = await ask(sun ? { type: 'sun', season, mode: floorMode } : { type: 'sea', mode: floorMode }, (p, t) => (progress.textContent = `${p} / ${t}`));
    if (my !== modeReq) return;
    arr = res.data; cache.set(key, arr!); progress.textContent = '';
  }
  world.blds.forEach((b, i) => map.setFeatureState({ source: 'buildings', id: b.id }, { v: arr![i] }));
}

export function initTimebar() {
  const hourInput = $<HTMLInputElement>('.hour');
  hourInput.value = String(state.hour);
  const setHour = (h: number) => { state.hour = Math.min(22, Math.max(4, h)); hourInput.value = String(state.hour); updateLight(); syncUrl(); };
  hourInput.addEventListener('input', () => setHour(+hourInput.value));

  $$('.chip').forEach((chip, i) => {
    chip.classList.toggle('active', i === state.season);
    chip.addEventListener('click', () => {
      state.season = i;
      $$('.chip').forEach((c, j) => c.classList.toggle('active', j === i));
      refreshSeason();
      updateLight(); syncUrl();
      if (state.mode === 'sun') applyMode();
    });
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
    if ((e.target as HTMLElement).matches('input, select, textarea')) return;
    if (e.key === 'ArrowLeft') setHour(state.hour - 0.25);
    else if (e.key === 'ArrowRight') setHour(state.hour + 0.25);
    else if (e.key === ' ') { e.preventDefault(); togglePlay(); }
  });

  const modeSel = $<HTMLSelectElement>('.mode');
  const floorModeSel = $<HTMLSelectElement>('.floor-mode');
  modeSel.value = state.mode;
  floorModeSel.value = state.floorMode;
  modeSel.addEventListener('change', () => { state.mode = modeSel.value as Mode; applyMode(); });
  floorModeSel.addEventListener('change', () => { state.floorMode = floorModeSel.value as FloorMode; applyMode(); });
}
