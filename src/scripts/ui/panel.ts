// Правая панель: выбор здания, этаж и сторона, сезоны, лента года, роза моря, сравнение, PNG, поиск.
import { DIRECTIONS, eye, eyeHeight, N, RIBBON_DAY_STEP, SEASONS, seaRose, seasonCalc, STEP_MIN, YEAR, type SeaDir, type Season } from '../analysis.ts';
import { $, $$, ask, city, fmtH, fmtT, state, syncUrl, tzOffset, world } from '../app.ts';
import type { Bld } from '../grid.ts';
import { applyColors, drawFloor, drawSectors, drawSunPath, map } from '../map/layers.ts';
import { shareCard } from '../share.ts';
import { updateLight } from './timebar.ts';

let lastSeasons: Season[] = [], lastSea: SeaDir[] = [], ribbonSmall: HTMLCanvasElement | null = null;
let ribbonReq = 0;
const sideLabel = () => (state.side == null ? 'здание целиком' : `окна на ${DIRECTIONS[state.side]}`);

export function select(b: Bld, opts: { floor?: number; side?: number | null } = {}) {
  if (state.current) map.setFeatureState({ source: 'buildings', id: state.current.id }, { selected: false });
  state.current = b;
  map.setFeatureState({ source: 'buildings', id: b.id }, { selected: true });
  state.floor = Math.min(b.floors, Math.max(1, opts.floor ?? Math.ceil(b.floors / 2)));
  state.side = opts.side === undefined ? null : opts.side;
  const floorSel = $<HTMLSelectElement>('.floor');
  floorSel.innerHTML = Array.from({ length: b.floors }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('');
  floorSel.value = String(state.floor);
  $('.b-name').textContent = b.name ?? `Здание ${b.id}`;
  const src = b.levels != null ? `${b.levels} эт. по OSM` : b.height != null ? `${b.height} м по OSM, ≈${b.floors} эт.` : `этажность в OSM не указана, взято ${b.floors} эт.`;
  $('.b-meta').innerHTML = `${src} · земля ${Math.round(b.ground)} м · <a href="https://www.openstreetmap.org/${b.id > 1e9 ? 'relation' : 'way'}/${b.id}" target="_blank" rel="noopener">OSM ↗</a>`;
  $('.empty').hidden = true;
  const result = $('.result');
  result.hidden = false;
  result.classList.remove('show');
  void result.offsetWidth; // перезапуск анимации
  result.classList.add('show');
  document.body.classList.add('sheet-open');
  applyColors();
  map.flyTo({ center: b.center, zoom: Math.max(map.getZoom(), 16.3), pitch: 58, duration: 1000 });
  render();
}

// Пересчёт для текущих здания, этажа и стороны.
function render() {
  const b = state.current!;
  $$<HTMLButtonElement>('.side').forEach((btn) => btn.classList.toggle('active', +btn.dataset.side! === (state.side ?? -1)));
  drawFloor(b);
  $('.eye').textContent = `окно на ${fmtH.format(eyeHeight(world, b, state.floor))} м над морем`;
  $('.seasons').innerHTML = seasonsHtml();
  lastSea = seaRose(world, b, state.floor);
  $('.rose').innerHTML = roseSvg(lastSea);
  drawSectors(b, lastSea);
  drawSunPath();
  updateLight();
  syncUrl();
  const my = ++ribbonReq;
  ask({ type: 'ribbon', idx: b.idx, floor: state.floor, side: state.side }).then((r) => my === ribbonReq && drawRibbon(r));
}

// Смена сезона: карточки и солнечная диаграмма.
export function refreshSeason() {
  if (!state.current) return;
  drawSunPath();
  $('.seasons').innerHTML = seasonsHtml();
}

function seasonsHtml() {
  const e = eye(world, state.current!, state.floor, state.side);
  lastSeasons = SEASONS.map((_, i) => seasonCalc(world, state.current!, e, i));
  return lastSeasons.map((s) => {
    const times = s.sunrise && s.sunset ? `${fmtT.format(s.sunrise)}–${fmtT.format(s.sunset)}` : 'полярная ночь';
    const pct = s.daylight ? Math.round((100 * s.sun) / s.daylight) : 0;
    return `<div class="card${s === lastSeasons[state.season] ? ' current' : ''}" style="--pct:${pct}%"><b>${s.short}</b><strong>${fmtH.format(s.sun)} ч</strong><small>из ${fmtH.format(s.daylight)} · ${times}</small><i></i></div>`;
  }).join('');
}

// Роза видимости моря: 8 секторов, снаружи румб, внутри — километры до воды.
function roseSvg(sea: SeaDir[]) {
  const c = 100, r1 = 36, r2 = 72;
  const pt = (r: number, a: number) => [c + r * Math.sin(a), c - r * Math.cos(a)].map((v) => v.toFixed(1));
  const n = sea.filter((s) => s.dist != null).length;
  const parts = sea.map(({ dir, bearing, dist }, i) => {
    const a0 = bearing - Math.PI / 8 + 0.025, a1 = bearing + Math.PI / 8 - 0.025;
    const d = `M${pt(r1, a0)} L${pt(r2, a0)} A${r2},${r2} 0 0 1 ${pt(r2, a1)} L${pt(r1, a1)} A${r1},${r1} 0 0 0 ${pt(r1, a0)} Z`;
    const title = dist != null ? `${dir}: море в ${fmtH.format(dist / 1000)} км` : `${dir}: море не видно`;
    const [kx, ky] = pt(54, bearing), [lx, ly] = pt(86, bearing);
    const km = dist != null ? `<text class="km" x="${kx}" y="${+ky + 3.5}">${fmtH.format(dist / 1000)}</text>` : '';
    return `<path class="${dist != null ? 'yes' : 'no'}${i === state.side ? ' sel' : ''}" d="${d}" data-side="${i}"><title>${title}</title></path><text class="dir" x="${lx}" y="${+ly + 4}">${dir}</text>${km}`;
  });
  return `<svg viewBox="0 0 200 200" role="img" aria-label="Видимость моря: ${n} из 8 румбов">${parts.join('')}<text class="count" x="100" y="97">${n}<tspan>/8</tspan></text><text class="sub" x="100" y="112">румбов</text></svg>`;
}

// Лента года: столбцы — дни, строки — местное время суток (0 сверху).
function drawRibbon({ cols, rows, data }: { cols: number; rows: number; data: Uint8Array }) {
  const cv = $<HTMLCanvasElement>('.ribbon');
  const dpr = devicePixelRatio || 1;
  const W = cv.clientWidth, H = 180, left = 26, top = 6, bottom = 18;
  cv.width = W * dpr; cv.height = H * dpr;
  const ctx = cv.getContext('2d')!;
  ctx.scale(dpr, dpr);
  const pw = W - left - 4, ph = H - top - bottom;
  const small = document.createElement('canvas');
  small.width = cols; small.height = rows;
  const img = small.getContext('2d')!.createImageData(cols, rows);
  const palette = [[31, 42, 68], [167, 174, 187], [255, 194, 51]];
  for (let c = 0; c < cols; c++) {
    const shift = Math.round((tzOffset(new Date(Date.UTC(YEAR, 0, 1 + c * RIBBON_DAY_STEP))) * 60) / STEP_MIN);
    for (let i = 0; i < rows; i++) {
      const row = (((i + shift) % N) + N) % N;
      const [r, g, b] = palette[data[i * cols + c]];
      const k = (row * cols + c) * 4;
      img.data[k] = r; img.data[k + 1] = g; img.data[k + 2] = b; img.data[k + 3] = 255;
    }
  }
  small.getContext('2d')!.putImageData(img, 0, 0);
  ribbonSmall = small;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(small, left, top, pw, ph);
  ctx.fillStyle = '#7a746a';
  ctx.font = '10px "Inter Variable", system-ui, sans-serif';
  ctx.textAlign = 'right';
  for (const h of [0, 6, 12, 18, 24]) ctx.fillText(String(h), left - 5, top + (ph * h) / 24 + 3.5);
  ctx.textAlign = 'center';
  'ЯФМАМИИАСОНД'.split('').forEach((m, i) => ctx.fillText(m, left + (pw * (i + 0.5)) / 12, H - 5));
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.setLineDash([3, 3]);
  for (const s of SEASONS) {
    const x = left + (pw * ((s.date.getTime() - Date.UTC(YEAR, 0, 1)) / 864e5)) / 365;
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, top + ph); ctx.stroke();
  }
}

// --- Сравнение ---------------------------------------------------------------
type Pin = { b: Bld; floor: number; side: number | null; seasons: Season[]; sea: number };
const pins: Pin[] = [];
function renderPins() {
  $('.compare').hidden = !pins.length;
  $('.pin-btn').toggleAttribute('disabled', pins.length >= 4);
  $('.compare-rows').innerHTML = pins.map((p, i) =>
    `<tr><td><button type="button" class="link" data-i="${i}">${p.b.name ?? p.b.id}</button><small>${p.floor} эт. · ${p.side == null ? 'всё здание' : DIRECTIONS[p.side]}</small></td>${p.seasons.map((s) => `<td>${fmtH.format(s.sun)}</td>`).join('')}<td>${p.sea}/8</td><td><button type="button" class="x" data-i="${i}" aria-label="Убрать">×</button></td></tr>`,
  ).join('');
  $$('.compare .link').forEach((el) => el.addEventListener('click', () => { const p = pins[+el.dataset.i!]; select(p.b, { floor: p.floor, side: p.side }); }));
  $$('.compare .x').forEach((el) => el.addEventListener('click', () => { pins.splice(+el.dataset.i!, 1); renderPins(); }));
}

// --- Поиск адреса (Photon, без ключа) -----------------------------------------
function initSearch() {
  const search = $<HTMLInputElement>('.search');
  const results = $('.search-results');
  let timer: ReturnType<typeof setTimeout> | undefined;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    if (search.value.trim().length < 3) { results.hidden = true; return; }
    timer = setTimeout(async () => {
      const { south, west, north, east } = city.bbox;
      const [lon, lat] = city.camera.center;
      const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(search.value.trim())}&lat=${lat}&lon=${lon}&bbox=${west},${south},${east},${north}&limit=6&lang=en`;
      const res = await fetch(url).then((r) => r.json()).catch(() => null);
      const feats: any[] = res?.features ?? [];
      results.innerHTML = feats.length ? feats.map((f, i) => { const p = f.properties; return `<button type="button" data-i="${i}">${[p.name, p.street, p.housenumber].filter(Boolean).join(' ') || p.city}<small>${[p.city ?? p.county, p.country].filter(Boolean).join(', ')}</small></button>`; }).join('') : '<span>Ничего не нашлось</span>';
      results.hidden = false;
      results.querySelectorAll<HTMLButtonElement>('button').forEach((btn) =>
        btn.addEventListener('click', () => {
          const [lon, lat] = feats[+btn.dataset.i!].geometry.coordinates;
          results.hidden = true;
          const [x, y] = world.proj.toXY(lon, lat);
          const near = world.blds.map((b) => ({ b, d: Math.hypot(b.xy[0] - x, b.xy[1] - y) })).sort((a, b) => a.d - b.d)[0];
          if (near && near.d < 150) select(near.b);
          else map.flyTo({ center: [lon, lat], zoom: 16.5, pitch: 55, duration: 1200 });
        }),
      );
    }, 400);
  });
  search.addEventListener('blur', () => setTimeout(() => (results.hidden = true), 200));
}

export function initPanel() {
  initSearch();
  const floorSel = $<HTMLSelectElement>('.floor');
  floorSel.addEventListener('change', () => { state.floor = +floorSel.value; render(); });
  $('.sides').innerHTML = ['Все', ...DIRECTIONS].map((d, i) => `<button type="button" class="side" data-side="${i - 1}" title="${i ? `Окна на ${d}` : 'Здание целиком'}">${d}</button>`).join('');
  $$<HTMLButtonElement>('.side').forEach((btn) => btn.addEventListener('click', () => { state.side = +btn.dataset.side! < 0 ? null : +btn.dataset.side!; render(); }));
  $('.rose').addEventListener('click', (e) => {
    const p = (e.target as Element).closest('path');
    if (p) { state.side = +p.getAttribute('data-side')!; render(); }
  });

  $('.example').addEventListener('click', () => {
    const [cx, cy] = world.proj.toXY(...city.camera.center);
    const d = (b: Bld) => Math.hypot(b.xy[0] - cx, b.xy[1] - cy);
    select(world.blds.filter((b) => b.name && (b.levels ?? 0) >= 4).sort((a, b) => d(a) - d(b))[0] ?? world.blds.reduce((m, b) => (b.floors > m.floors ? b : m)));
  });

  $('.pin-btn').addEventListener('click', () => {
    if (!state.current || pins.length >= 4) return;
    pins.push({ b: state.current, floor: state.floor, side: state.side, seasons: lastSeasons, sea: lastSea.filter((s) => s.dist != null).length });
    renderPins();
  });

  $('.share-btn').addEventListener('click', async () => {
    const b = state.current;
    if (!b) return;
    const blob = await shareCard({ city: city.name, title: b.name ?? `Здание ${b.id}`, subtitle: `${city.name} · ${state.floor} этаж · ${sideLabel()}`, seasons: lastSeasons, sea: lastSea, ribbon: ribbonSmall });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `sun-view-${city.id}-${b.id}-${state.floor}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });

  // Мобильный лист: тап по ручке раскрывает панель.
  $('.sheet-handle').addEventListener('click', () => document.body.classList.toggle('sheet-open'));
}
