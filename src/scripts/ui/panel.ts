// Правая панель (на телефоне — лист): выбор здания, этаж и фасад, матрица «этажи × фасады», солнце за год, сезоны,
// лента года, роза моря, вид из окна, сравнение, PNG, поиск, примеры.
import { bestCell, dirBearing, dirIndex, eye, eyeHeight, N, reliability, RIBBON_DAY_STEP, SEASONS, seaRose, seasonCalc, STEP_MIN, verdict, YEAR, type SeaDir, type Season } from '../analysis.ts';
import { $, $$, ask, city, currentFacades, facadeOf, fmtH, fmtT, geojson, state, syncUrl, tzOffset, world } from '../app.ts';
import { facades, nearestFacade, type Bld, type Facade } from '../grid.ts';
import { buildingName, cityName, lang, summaryText, t } from '../i18n.ts';
import { applyColors, drawFacade, drawFloor, drawSectors, drawSunPath, map, setData, sheetPadding } from '../map/layers.ts';
import { enterView, exitView, grabFrame, viewing } from '../map/window.ts';
import { shareCard } from '../share.ts';
import { setSheet } from './sheet.ts';
import { setSeason, updateLight } from './timebar.ts';

let lastSeasons: Season[] = [], lastSea: SeaDir[] = [], ribbonSmall: HTMLCanvasElement | null = null;
let ribbonReq = 0, matrixReq = 0, viewReq = 0, viewText = '';
const deg = (f: Facade) => Math.round((f.normal * 180) / Math.PI) % 360;
const fName = (f: Facade) => `${t.dirs[dirIndex(f.normal)]}, ${deg(f)}°`;
const fTitle = (f: Facade) => t.facade(t.dirs[dirIndex(f.normal)], deg(f), Math.round(f.len));
const sideLabel = () => t.sideLabel(facadeOf() ? fName(facadeOf()!) : null);
// Фасад по румбу 0..7 (старые ссылки, примеры) — ближайший по нормали; null — здание целиком.
const facadeByDir = (b: Bld, d: number | null) => (d == null ? null : nearestFacade(facades(world, b), dirBearing(d)));
const osmUrl = (b: Bld) => `https://www.openstreetmap.org/${b.osmType}/${b.id}`;

export function select(b: Bld, opts: { floor?: number; side?: number | null; dir?: number | null; floors?: number | null } = {}) {
  if (state.current) map.setFeatureState({ source: 'buildings', id: state.current.id }, { selected: false });
  setView(false);
  state.current = b;
  state.floorsOverride = null;
  if (opts.floors && b.assumed) overrideFloors(b, opts.floors);
  map.setFeatureState({ source: 'buildings', id: b.id }, { selected: true });
  state.floor = Math.min(b.floors, Math.max(1, opts.floor ?? Math.ceil(b.floors / 2)));
  const side = opts.dir != null ? facadeByDir(b, opts.dir) : opts.side;
  state.side = side != null && side >= 0 && side < facades(world, b).length ? side : null;
  fillFloors(b);
  fillSides();
  loadMatrix(b);
  $('.b-name').textContent = buildingName(b);
  $('.loading').hidden = true;
  $('.empty').hidden = true;
  const result = $('.result');
  result.hidden = false;
  result.classList.remove('show');
  void result.offsetWidth; // перезапуск анимации
  result.classList.add('show');
  setSheet('half', true);
  applyColors();
  map.flyTo({ center: b.center, zoom: Math.max(map.getZoom(), 16.3), pitch: 58, duration: 1000, padding: sheetPadding() });
  render();
  announce(t.announce(buildingName(b), summary()));
}

// Снять выбор (Esc на карте): убрать подсветку, слои здания и вернуть пустую панель.
export function deselect() {
  const b = state.current;
  if (!b) return;
  setView(false);
  map.setFeatureState({ source: 'buildings', id: b.id }, { selected: false });
  state.current = null;
  state.side = null;
  state.floorsOverride = null;
  for (const id of ['floor', 'facade', 'sectors', 'sunpath', 'sunnow']) setData(id, []);
  $('.result').hidden = true;
  $('.empty').hidden = false;
  applyColors();
  updateLight();
  syncUrl();
  announce(t.deselected);
}

// Объявление для скринридеров: выбранное здание и сводка (отдельная aria-live-область).
function announce(text: string) {
  const el = $('.sr-live');
  el.textContent = '';
  requestAnimationFrame(() => (el.textContent = text));
}

function fillFloors(b: Bld) {
  const floorSel = $<HTMLSelectElement>('.floor');
  floorSel.innerHTML = Array.from({ length: b.floors }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('');
  floorSel.value = String(state.floor);
  const src = b.levels != null ? t.srcLevels(b.levels) : b.height != null ? t.srcHeight(b.height, b.floors) : t.srcAssumed(b.floors);
  $('.b-meta').innerHTML = `${src} · ${t.ground(Math.round(b.ground))} · <a href="${osmUrl(b)}" target="_blank" rel="noopener">OSM ↗</a>`;
  // Надёжность: уточнённая пользователем этажность уже не предположение.
  const r = reliability(world, b, b.assumed && state.floorsOverride == null);
  $('.trust').dataset.level = r.level;
  $('.trust-level').textContent = t.trust[r.level];
  $('.trust-reasons').innerHTML = r.reasons.length
    ? r.reasons.map((k) => `<li>${k === 'slope' ? t.reasons.slope(Math.round(r.drop)) : t.reasons[k]}</li>`).join('')
    : `<li>${t.trustOk}</li>`;
  // Этажность предположена — предлагаем уточнить.
  const box = $('.assumed');
  box.hidden = !b.assumed;
  $<HTMLInputElement>('.assumed-input').value = String(b.floors);
}

// Уточнённая пользователем этажность: меняет только это здание (его высоту на карте и список этажей);
// тени, которые оно бросает на соседей, остаются по исходной оценке.
function overrideFloors(b: Bld, n: number) {
  b.floors = n;
  b.h = n * city.floorHeight;
  state.floorsOverride = n;
  geojson.features[b.idx].properties.h = b.h;
  setData('buildings', geojson.features);
}

// Кнопки фасадов текущего здания: «Все» и по одной на фасад.
function fillSides() {
  const btn = (c: number, html: string, title: string) => `<button type="button" class="side" data-c="${c}" aria-pressed="false" title="${title}">${html}</button>`;
  $('.sides').innerHTML = btn(-1, t.all, t.wholeBuilding) + currentFacades().map((f, c) => btn(c, `${t.dirs[dirIndex(f.normal)]}<small> ${deg(f)}°</small>`, fTitle(f))).join('');
}

// Матрица «этажи × фасады» считается в воркере один раз на здание (и при уточнении этажности).
// Из неё же — годовая оценка окна в панели, чтобы числа в матрице и в панели совпадали.
type Matrix = { floors: number; cols: number; score: Uint8Array; winter: Uint8Array; sea: Uint8Array };
let matrix: Matrix | null = null;
function loadMatrix(b: Bld) {
  const box = $('.matrix');
  const fs = currentFacades();
  matrix = null;
  box.innerHTML = `<p class="legend">${fs.length ? t.matrixLoading : t.matrixNone}</p>`;
  if (!fs.length) return;
  const my = ++matrixReq;
  ask({ type: 'matrix', idx: b.idx, floors: b.floors }).then((m) => {
    if (my !== matrixReq) return;
    box.innerHTML = matrixHtml(fs, m);
    matrix = m;
    markMatrix();
    renderBre();
  });
}

function matrixHtml(fs: Facade[], m: Matrix) {
  const best = bestCell(m);
  const max = Math.max(...m.score);
  const head = fs.map((f, c) => `<th data-c="${c}" title="${fTitle(f)}">${t.dirs[dirIndex(f.normal)]}<small>${deg(f)}°</small><small>${Math.round(f.len)} ${t.m}</small></th>`).join('');
  const rows = [];
  for (let fl = m.floors; fl >= 1; fl--) {
    const cells = fs.map((f, c) => {
      const k = (fl - 1) * m.cols + c, score = m.score[k], sea = m.sea[k];
      const label = t.matrixCell(fl, fName(f), score, m.winter[k], sea) + (k === best ? ` (${t.best})` : '');
      return `<td><button type="button" class="cell${k === best ? ' best' : ''}" data-c="${c}" data-f="${fl}" style="--v:${max ? Math.round((100 * score) / max) : 0}%" aria-label="${label}" title="${label}">${score}${sea ? '<i>∿</i>' : ''}</button></td>`;
    });
    rows.push(`<tr><th>${fl}</th>${cells.join('')}</tr>`);
  }
  return `<table><thead><tr><th>${t.fl}</th>${head}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

// Годовая оценка текущего окна из матрицы; для здания целиком — лучший фасад этажа. null — ещё не посчитана.
// BRE нормирует только окна, повёрнутые не дальше 90° от юга; для остальных оценка 0–100 остаётся, вердикта нет.
const breAssessed = (normal: number) => Math.cos(normal) <= 0;

function breNow() {
  if (!matrix || state.floor > matrix.floors) return null;
  const row = (state.floor - 1) * matrix.cols, fs = currentFacades();
  let c = state.side ?? -1;
  if (c < 0) {
    // Здание целиком — лучший фасад этажа, а среди нормируемых BRE (если такие есть) — лучший из них.
    const pool = fs.map((f, i) => i).filter((i) => breAssessed(fs[i].normal));
    for (const i of pool.length ? pool : fs.map((f, i) => i)) if (c < 0 || matrix.score[row + i] > matrix.score[row + c]) c = i;
  }
  const a = { year: matrix.score[row + c], winter: matrix.winter[row + c] };
  return { c, a, v: fs[c] && breAssessed(fs[c].normal) ? verdict(a) : ('na' as const) };
}

function breHtml() {
  const fs = currentFacades(), r = breNow();
  if (!fs.length) return `<p class="legend">${t.bre.none}</p>`;
  if (!r) return `<p class="legend">${t.bre.loading}</p>`;
  const f = fs[r.c];
  const notes = [t.bre.detail(r.a.year, r.a.winter)];
  if (state.side == null) notes.push(t.bre.best(fName(f)));
  return `<div class="bre" data-v="${r.v}" style="--pct:${r.a.year}%"><strong>${r.a.year}<small>${t.bre.of}</small></strong><b>${t.bre.title}</b><em>${t.bre.verdict[r.v]}</em><small>${notes.join(' · ')}</small><i></i></div><details class="more"><summary>${t.bre.how}</summary><p class="legend">${t.bre.legend}</p></details>`;
}

function renderBre() {
  $('.bre-box').innerHTML = breHtml();
  $('.summary').textContent = summary();
}

// Выбранная клетка в матрице.
const markMatrix = () => $$<HTMLButtonElement>('.matrix .cell').forEach((el) => el.setAttribute('aria-pressed', String(+el.dataset.f! === state.floor && +el.dataset.c! === (state.side ?? -1))));

// Пересчёт для текущих здания, этажа и фасада.
function render() {
  const b = state.current;
  if (!b) return;
  $$<HTMLButtonElement>('.side').forEach((btn) => btn.setAttribute('aria-pressed', String(+btn.dataset.c! === (state.side ?? -1))));
  if (matrix) markMatrix();
  drawFloor(b);
  drawFacade(b, facadeOf());
  $('.eye').textContent = t.eye(fmtH.format(eyeHeight(world, b, state.floor)));
  $('.seasons').innerHTML = seasonsHtml();
  lastSea = seaRose(world, b, state.floor);
  renderBre();
  $('.rose').innerHTML = roseSvg(lastSea);
  drawSectors(b, lastSea);
  drawSunPath();
  updateLight();
  syncUrl();
  loadView(b);
  const my = ++ribbonReq;
  ask({ type: 'ribbon', idx: b.idx, floor: state.floor, side: state.side }).then((r) => my === ribbonReq && drawRibbon(r));
}

// Смена сезона: карточки и солнечная диаграмма.
export function refreshSeason() {
  if (!state.current) return;
  drawSunPath();
  $('.seasons').innerHTML = seasonsHtml();
}

function summary() {
  const r = breNow();
  return summaryText(lastSeasons, lastSea.filter((s) => s.dist != null).length, (v) => fmtH.format(v), r && { score: r.a.year, verdict: r.v });
}

function seasonsHtml() {
  const e = eye(world, state.current!, state.floor, facadeOf());
  lastSeasons = SEASONS.map((_, i) => seasonCalc(world, state.current!, e, i));
  return lastSeasons.map((s, i) => {
    const times = s.sunrise && s.sunset ? `${fmtT.format(s.sunrise)}–${fmtT.format(s.sunset)}` : t.polarNight;
    const pct = s.daylight ? Math.round((100 * s.sun) / s.daylight) : 0;
    return `<button type="button" class="card${i === state.season ? ' current' : ''}" data-s="${i}" style="--pct:${pct}%" title="${t.seasonsFull[i]}"><b>${t.seasons[i]}</b><strong>${fmtH.format(s.sun)} ${t.h}</strong><small>${t.of} ${fmtH.format(s.daylight)} · ${times}</small><i></i></button>`;
  }).join('');
}

// Роза видимости моря: 8 секторов, снаружи направление, внутри — километры до воды.
// Видно — штриховка и волна, не видно — светлый сектор с прочерком: читается и без цвета.
function roseSvg(sea: SeaDir[]) {
  const c = 100, r1 = 36, r2 = 72;
  const sel = facadeOf() ? dirIndex(facadeOf()!.normal) : -1;
  const pt = (r: number, a: number) => [c + r * Math.sin(a), c - r * Math.cos(a)].map((v) => v.toFixed(1));
  const n = sea.filter((s) => s.dist != null).length;
  const parts = sea.map(({ bearing, dist }, i) => {
    const dir = t.dirs[i];
    const a0 = bearing - Math.PI / 8 + 0.025, a1 = bearing + Math.PI / 8 - 0.025;
    const d = `M${pt(r1, a0)} L${pt(r2, a0)} A${r2},${r2} 0 0 1 ${pt(r2, a1)} L${pt(r1, a1)} A${r1},${r1} 0 0 0 ${pt(r1, a0)} Z`;
    const title = dist != null ? t.seaAt(dir, fmtH.format(dist / 1000)) : t.noSea(dir);
    const [kx, ky] = pt(54, bearing), [lx, ly] = pt(86, bearing);
    const inner = dist != null ? `<text class="km" x="${kx}" y="${+ky + 3.5}">∿${fmtH.format(dist / 1000)}</text>` : `<text class="nokm" x="${kx}" y="${+ky + 3.5}">—</text>`;
    return `<path class="${dist != null ? 'yes' : 'no'}${i === sel ? ' sel' : ''}" d="${d}" data-side="${i}" tabindex="0" role="button" aria-label="${title}"><title>${title}</title></path><text class="dir" x="${lx}" y="${+ly + 4}">${dir}</text>${inner}`;
  });
  const defs = `<defs><pattern id="hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" class="hatch-bg"/><line x1="0" y1="0" x2="0" y2="5" class="hatch-line"/></pattern></defs>`;
  return `<svg viewBox="0 0 200 200" role="group" aria-label="${t.roseAria(n)}">${defs}${parts.join('')}<text class="count" x="100" y="97">${n}<tspan>/8</tspan></text><text class="sub" x="100" y="112">${t.roseSub}</text></svg>`;
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
  t.months.split('').forEach((m, i) => ctx.fillText(m, left + (pw * (i + 0.5)) / 12, H - 5));
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.setLineDash([3, 3]);
  for (const s of SEASONS) {
    const x = left + (pw * ((s.date.getTime() - Date.UTC(YEAR, 0, 1)) / 864e5)) / 365;
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, top + ph); ctx.stroke();
  }
}

// --- Вид из окна ------------------------------------------------------------
// Доли моря и неба в кадре из окна выбранного фасада — в воркере; камера на карте — по кнопке.
function loadView(b: Bld) {
  const f = facadeOf(), btn = $<HTMLButtonElement>('.view-btn');
  btn.disabled = !f;
  $('.view-pano').hidden = $('.view-legend').hidden = !f;
  $('.view-stat').textContent = f ? t.viewLoading : t.viewNeedFacade;
  viewText = '';
  if (!f) { setView(false); return; }
  if (viewing()) enterView(b, state.floor, f);
  const my = ++viewReq;
  ask({ type: 'view', idx: b.idx, floor: state.floor, side: state.side }).then((v) => {
    if (my !== viewReq) return;
    viewText = t.viewStat(Math.round(100 * v.sea), Math.round(100 * v.sky));
    $('.view-stat').textContent = $('.view-badge-stat').textContent = viewText;
    drawPano(v);
  });
}

// Полоса-панорама: клетка — луч (небо, море, препятствие), пунктир — горизонт.
function drawPano({ cols, rows, data }: { cols: number; rows: number; data: Uint8Array }) {
  const cv = $<HTMLCanvasElement>('.view-pano');
  cv.width = cols; cv.height = rows;
  const ctx = cv.getContext('2d')!, img = ctx.createImageData(cols, rows);
  const palette = [[196, 184, 163], [31, 106, 165], [214, 230, 244]]; // HIT: препятствие, море (синее, как вода на карте), небо
  data.forEach((v, i) => { img.data.set(palette[v], i * 4); img.data[i * 4 + 3] = 255; });
  ctx.putImageData(img, 0, 0);
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  for (let x = 0; x < cols; x += 2) ctx.fillRect(x, (rows - 1) / 2, 1, 1);
  cv.setAttribute('aria-label', viewText);
}

function setView(on: boolean) {
  const f = facadeOf();
  if (on && state.current && f) {
    enterView(state.current, state.floor, f);
    setSheet('peek');
  } else exitView();
  $('.view-btn').setAttribute('aria-pressed', String(viewing()));
  $('.view-btn').textContent = viewing() ? t.viewClose : t.viewOpen;
  $('.view-badge-stat').textContent = viewText || t.viewLoading;
  $('.view-badge').hidden = !viewing();
  document.body.classList.toggle('viewing', viewing()); // легенда цветов домов из окна не нужна
}

// --- Сравнение ---------------------------------------------------------------
type Pin = { b: Bld; floor: number; side: number | null; label: string; seasons: Season[]; bre: number | null; sea: number };
const pins: Pin[] = [];
function renderPins() {
  $('.compare').hidden = !pins.length;
  $('.pin-btn').toggleAttribute('disabled', pins.length >= 4);
  $('.compare-rows').innerHTML = pins.map((p, i) =>
    `<tr><td><button type="button" class="link" data-i="${i}">${buildingName(p.b)}</button><small>${p.floor} ${t.fl} · ${p.label}</small></td>${p.seasons.map((s) => `<td>${fmtH.format(s.sun)}</td>`).join('')}<td>${p.bre ?? '—'}</td><td>${p.sea}/8</td><td><button type="button" class="x" data-i="${i}" aria-label="${t.remove}">×</button></td></tr>`,
  ).join('');
  $$('.compare .link').forEach((el) => el.addEventListener('click', () => { const p = pins[+el.dataset.i!]; select(p.b, { floor: p.floor, side: p.side }); }));
  $$('.compare .x').forEach((el) => el.addEventListener('click', () => { pins.splice(+el.dataset.i!, 1); renderPins(); }));
}

// --- Поиск адреса (Photon, без ключа) -----------------------------------------
// Только в пределах города: bbox в запросе и повторная проверка ответа (Photon bbox мягкий).
function initSearch() {
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

// --- Примеры: подобраны по расчёту, см. cities.config.mjs ------------------------
function renderExamples() {
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
    if (state.season !== ex.s) setSeason(ex.s);
    select(b!, { floor: ex.f, dir: ex.d });
  }));
}

export function initPanel() {
  initSearch();
  renderExamples();
  const floorSel = $<HTMLSelectElement>('.floor');
  floorSel.addEventListener('change', () => { state.floor = +floorSel.value; render(); });
  $('.sides').addEventListener('click', (e) => {
    const btn = (e.target as Element).closest<HTMLElement>('.side');
    if (btn) { state.side = +btn.dataset.c! < 0 ? null : +btn.dataset.c!; render(); }
  });
  $('.matrix').addEventListener('click', (e) => {
    const cell = (e.target as Element).closest<HTMLElement>('.cell');
    if (!cell) return;
    state.floor = +cell.dataset.f!;
    state.side = +cell.dataset.c!;
    floorSel.value = String(state.floor);
    render();
  });
  // Наведение на фасад в матрице или в ряду кнопок — подсветить его стену на карте.
  for (const box of [$('.matrix'), $('.sides')]) {
    box.addEventListener('mouseover', (e) => {
      const el = (e.target as Element).closest<HTMLElement>('[data-c]');
      if (state.current && el) drawFacade(state.current, currentFacades()[+el.dataset.c!] ?? null);
    });
    box.addEventListener('mouseleave', () => state.current && drawFacade(state.current, facadeOf()));
  }
  const pickSide = (e: Event) => {
    const p = (e.target as Element).closest('path');
    const side = state.current && p ? nearestFacade(currentFacades(), dirBearing(+p.getAttribute('data-side')!)) : -1;
    if (side >= 0) { state.side = side; render(); }
  };
  $('.rose').addEventListener('click', pickSide);
  $('.rose').addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), pickSide(e)));
  $('.seasons').addEventListener('click', (e) => {
    const c = (e.target as Element).closest<HTMLElement>('.card');
    if (c) setSeason(+c.dataset.s!);
  });

  $('.view-btn').addEventListener('click', () => setView(!viewing()));
  $('.view-exit').addEventListener('click', () => setView(false));

  $('.assumed-apply').addEventListener('click', () => {
    const b = state.current;
    const n = Math.round(+$<HTMLInputElement>('.assumed-input').value);
    if (!b || !(n >= 1 && n <= 60)) return;
    overrideFloors(b, n);
    state.floor = Math.min(state.floor, n);
    fillFloors(b);
    loadMatrix(b);
    render();
  });

  $('.pin-btn').addEventListener('click', () => {
    if (!state.current || pins.length >= 4) return;
    pins.push({ b: state.current, floor: state.floor, side: state.side, label: facadeOf() ? fName(facadeOf()!) : t.whole, seasons: lastSeasons, bre: breNow()?.a.year ?? null, sea: lastSea.filter((s) => s.dist != null).length });
    renderPins();
  });

  $('.share-btn').addEventListener('click', async () => {
    const b = state.current;
    if (!b) return;
    const name = cityName(city);
    const view = viewing() && viewText ? { frame: await grabFrame(), text: viewText } : null;
    const blob = await shareCard({ view, city: name, title: buildingName(b), summary: summary(), subtitle: `${name} · ${t.card.floor(state.floor)} · ${sideLabel()}`, seasons: lastSeasons, sea: lastSea, ribbon: ribbonSmall });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `sun-view-${city.id}-${b.id}-${state.floor}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });
}
