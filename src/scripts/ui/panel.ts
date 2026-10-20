// Правая панель (на телефоне — лист): выбор здания, этаж и фасад, сезоны, сводка и связка частей панели.
// Матрица и BRE — matrix.ts, рисунки — charts.ts, вид из окна — view.ts, сравнение, поиск, примеры — отдельные модули.
import { dirBearing, dirIndex, eye, eyeHeight, reliability, SEASONS, seaRose, seasonCalc, seasonClimate, sunshineAt, type SeaDir, type Season } from '../analysis.ts';
import { $, $$, ask, city, currentFacades, embed, facadeOf, fmtH, fmtT, geojson, num, state, syncUrl, world } from '../app.ts';
import { bareWorld, facades, nearestFacade, plannedWorld, type Bld, type World } from '../grid.ts';
import { buildingName, cityName, summaryText, t } from '../i18n.ts';
import { applyColors, drawFacade, drawFloor, drawSectors, drawSunPath, lookAtFacade, map, setData, sheetPadding } from '../map/layers.ts';
import { grabFrame, viewing } from '../map/window.ts';
import { loadLevels } from '../data.ts';
import { shareCard } from '../share.ts';
import { drawRibbon, roseSvg } from './charts.ts';
import { initBetter, resetBetter } from './better.ts';
import { addPin, initCompare } from './compare.ts';
import { renderExamples } from './examples.ts';
import { deg, facadeByDir, fName, fTitle, osmEditUrl, osmUrl } from './format.ts';
import { breHtml, breNow, loadMatrix, markMatrix } from './matrix.ts';
import { initSearch } from './search.ts';
import { setSheet } from './sheet.ts';
import { setSeason, updateLight } from './timebar.ts';
import { currentViewText, initView, loadView, setView } from './view.ts';

let lastSeasons: Season[] = [], lastSea: SeaDir[] = [], ribbonSmall: HTMLCanvasElement | null = null;
let ribbonReq = 0, lastRibbon: { cols: number; rows: number; data: Uint8Array } | null = null;
// Мир без листвы на лиственных деревьях — строится один раз, при первом выбранном здании.
let bare: World | null = null;
// «После застройки»: тот же мир плюс планируемые объёмы (data/<id>/planned.geojson), строится при первом включении.
let after = false, built: World | null = null;
let autoSide = false; // выбрать лучший фасад, когда посчитается матрица
const cur = () => (after && world.planned ? (built ??= plannedWorld(world, world.planned)) : world);

// face: false — не разворачивать карту к фасаду (ссылка открыта, а пользователь уже двигал карту);
// push: false — не добавлять запись в историю (восстановление из ссылки, кнопка «Назад»).
export function select(b: Bld, opts: { floor?: number; side?: number | null; dir?: number | null; floors?: number | null; face?: boolean; push?: boolean } = {}) {
  // Новый дом — новая запись в истории: «Назад» вернёт к прежнему дому или к карте. syncUrl дальше перепишет её адрес.
  if (opts.push !== false && !embed && state.current !== b) history.pushState(null, '', location.href);
  if (state.current) map.setFeatureState({ source: 'buildings', id: state.current.id }, { selected: false });
  setView(false);
  state.current = b;
  state.floorsOverride = null;
  if (opts.floors && b.assumed) overrideFloors(b, opts.floors);
  map.setFeatureState({ source: 'buildings', id: b.id }, { selected: true });
  state.floor = Math.min(b.floors, Math.max(1, opts.floor ?? Math.ceil(b.floors / 2)));
  const side = opts.dir != null ? facadeByDir(world, b, opts.dir) : opts.side;
  state.side = side != null && side >= 0 && side < facades(world, b).length ? side : null;
  fillFloors(b);
  fillSides();
  resetBetter();
  // Фасад не задан ни ссылкой, ни примером — когда посчитается матрица, берём лучший фасад этажа (как в оценке BRE).
  // Если пользователь успел выбрать фасад сам (в том числе «Все»), автоматика не вмешивается.
  autoSide = state.side == null && opts.side === undefined && opts.dir == null;
  loadMatrix(b, () => (autoSide && state.current === b ? pickBest() : renderBre()));
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
  const f = facadeOf();
  if (f && opts.face !== false) lookAtFacade(b, f);
  else map.flyTo({ center: b.center, zoom: Math.max(map.getZoom(), 16.3), pitch: 58, duration: 1000, padding: sheetPadding() });
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
  osmEdit(b);
  // Насколько эта неизвестная этажность важна соседям — из того же слоя, что режим «Этажность».
  const impact = $('.levels-impact');
  impact.hidden = true;
  if (b.assumed) loadLevels(city.id).then((lv) => { const n = lv.get(b.id)?.[0] ?? 0; if (state.current === b && n) { impact.textContent = t.levelsImpact(n); impact.hidden = false; } });
}

// Ссылка «Исправить в OpenStreetMap» с тегом и числом из поля ввода.
function osmEdit(b: Bld) {
  const a = $<HTMLAnchorElement>('.osm-edit'), n = Math.round(+$<HTMLInputElement>('.assumed-input').value) || b.floors;
  a.href = osmEditUrl(b);
  a.textContent = t.osmEdit(n);
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

// Пересчёт для текущих здания, этажа и фасада.
function render() {
  const b = state.current;
  if (!b) return;
  $$<HTMLButtonElement>('.side').forEach((btn) => btn.setAttribute('aria-pressed', String(+btn.dataset.c! === (state.side ?? -1))));
  markMatrix();
  drawFloor(b);
  drawFacade(b, facadeOf());
  $('.eye').textContent = t.eye(fmtH.format(eyeHeight(world, b, state.floor)));
  $('.seasons').innerHTML = seasonsHtml();
  climateLine();
  lastSea = seaRose(cur(), b, state.floor);
  planBox(b);
  renderBre();
  $('.rose').innerHTML = roseSvg(lastSea, facadeOf() ? dirIndex(facadeOf()!.normal) : -1);
  drawSectors(b, lastSea);
  drawSunPath();
  updateLight();
  syncUrl();
  loadView(b);
  const my = ++ribbonReq;
  ask({ type: 'ribbon', idx: b.idx, floor: state.floor, side: state.side }).then((r) => { if (my === ribbonReq) { lastRibbon = r; paintRibbon(); } });
}

// Смена сезона: карточки и солнечная диаграмма.
export function refreshSeason() {
  if (!state.current) return;
  drawSunPath();
  $('.seasons').innerHTML = seasonsHtml();
  climateLine();
}

// Переключатель «Сегодня / После застройки»: только у домов в 500 м от планируемых объёмов (дальше лучи
// их не заденут). Разница — солнце по сезонам и направления с морем: сегодня против мира с планами.
function planBox(b: Bld) {
  const box = $('.plan-box'), pl = world.planned;
  const near = !!pl && pl.features.some((f) => { const [x, y] = world.proj.toXY(...(f.geometry.coordinates[0][0] as [number, number])); return Math.hypot(x - b.xy[0], y - b.xy[1]) < 500; });
  box.hidden = !near;
  if (!near) { if (after) setAfter(false); return; }
  $$('.plan-chip').forEach((el) => el.setAttribute('aria-checked', String((el.dataset.pl === '1') === after)));
  const p = pl!.features[0].properties;
  $('.plan-source').innerHTML = t.planSource(p.plan, p.date, pl!.features.length, p.source);
  if (!after) { $('.plan-diff').textContent = t.planHint; return; }
  const e = eye(world, b, state.floor, facadeOf());
  const diffs = SEASONS.map((_, i) => seasonCalc(cur(), b, e, i).sun - seasonCalc(world, b, e, i).sun);
  const sun = diffs.map((d, i) => (Math.abs(d) >= 0.05 ? `${t.seasons[i].toLowerCase()} ${d < 0 ? '−' : '+'}${fmtH.format(Math.abs(Math.round(d * 10) / 10))} ${t.h}` : '')).filter(Boolean);
  const before = seaRose(world, b, state.floor), lost = lastSea.map((s, i) => (before[i].dist != null && s.dist == null ? t.dirs[i] : '')).filter(Boolean);
  $('.plan-diff').textContent = t.planDiff(sun.length ? sun.join(', ') : t.planSunSame, lost.length ? t.planSeaLost(lost.join(', ')) : t.planSeaSame);
}
function setAfter(on: boolean) {
  after = on && !!world.planned;
  map.setLayoutProperty('planned-volume', 'visibility', after ? 'visible' : 'none');
  render();
}

// Строка климата под фасадами: только для выбранного фасада и если у города есть температура и ветер.
function climateLine() {
  const el = $('.climate-line'), f = facadeOf(), c = world.climate;
  el.hidden = !f || !c;
  if (!f || !c) return;
  const k = seasonClimate(c, SEASONS[state.season].date), t0 = Math.round(k.t);
  const windward = Math.cos(f.normal - dirBearing(k.dir)) >= Math.SQRT1_2; // нормаль фасада в пределах 45° от ветра
  el.textContent = t.climateLine(t.seasonsFull[state.season], `${t0 > 0 ? '+' : ''}${t0}`, t.dirs[k.dir], fmtH.format(Math.round(k.speed * 10) / 10), windward);
}

function summary() {
  const r = breNow();
  return summaryText(lastSeasons, lastSea.filter((s) => s.dist != null).length, (v) => fmtH.format(v), r && { score: r.a.year, verdict: r.v });
}

function seasonsHtml() {
  const e = eye(world, state.current!, state.floor, facadeOf());
  lastSeasons = SEASONS.map((_, i) => seasonCalc(cur(), state.current!, e, i));
  return lastSeasons.map((s, i) => {
    const times = s.sunrise && s.sunset ? `${fmtT.format(s.sunrise)}–${fmtT.format(s.sunset)}` : t.polarNight;
    const pct = s.daylight ? Math.round((100 * s.sun) / s.daylight) : 0;
    // С облаками — часы при ясном небе × вероятность прямого солнца в этот день года.
    const cloud = world.sunshine && s.sun ? `<small class="cloud">${t.cloudy(fmtH.format(s.sun * sunshineAt(world.sunshine, SEASONS[i].date)))}</small>` : '';
    // Весной и зимой лиственные деревья могут стоять голыми — верхняя граница, если она другая.
    const nb = i === 0 || i === 3 ? fmtH.format(seasonCalc((bare ??= bareWorld(world)), state.current!, e, i).sun) : null;
    const leafless = nb && nb !== fmtH.format(s.sun) ? `<small class="bare">${t.bare(nb)}</small>` : '';
    return `<button type="button" class="card${i === state.season ? ' current' : ''}" data-s="${i}" style="--pct:${pct}%" title="${t.seasonsFull[i]}"><b>${t.seasons[i]}</b><strong>${fmtH.format(s.sun)} ${t.h}</strong><small>${t.of} ${fmtH.format(s.daylight)} · ${times}</small>${cloud}${leafless}<i></i></button>`;
  }).join('');
}

// Лента года — ясное небо или с облаками (переключатель над ней, cl=1 в ссылке). Тот же canvas идёт в PNG-карточку.
function paintRibbon() {
  if (lastRibbon) ribbonSmall = drawRibbon($<HTMLCanvasElement>('.ribbon'), lastRibbon, state.cloudy ? world.sunshine ?? null : null);
}
function setSky(cloudy: boolean) {
  state.cloudy = cloudy && !!world.sunshine;
  $$('.sky-chip').forEach((el) => el.setAttribute('aria-checked', String((el.dataset.cl === '1') === state.cloudy)));
  $('.ribbon-cloud').hidden = !state.cloudy;
  paintRibbon();
}

// Выбран фасад — развернуть карту к нему; «Все» и вид из окна (у него своя камера) — не трогать.
function faceSide() {
  const f = facadeOf();
  if (state.current && f && !viewing()) lookAtFacade(state.current, f);
}

// Сводка в панели зависит от годовой оценки — перерисовываются вместе.
// Лучший фасад этажа — тот, что называет оценка BRE для здания целиком; камера не крутится, это не выбор пользователя.
function pickBest() {
  autoSide = false;
  const r = breNow();
  if (r && currentFacades()[r.c]) { state.side = r.c; render(); } else renderBre();
}

function renderBre() {
  $('.bre-box').innerHTML = breHtml();
  $('.summary').textContent = summary();
}

export function initPanel() {
  // «Назад» / «Вперёд»: дом, этаж и фасад — из адреса записи; нет дома — снять выбор.
  addEventListener('popstate', () => {
    const q = new URL(location.href).searchParams, d = q.get('d');
    const b = world.blds.find((x) => x.id === num(q.get('b'), -1));
    if (!b) { if (state.current) deselect(); return; }
    select(b, { floor: num(q.get('f'), 0) || undefined, side: d?.[0] === 'f' ? num(d.slice(1), 0) : null, push: false });
  });
  $('.seasons-note').hidden = !world.sunshine;
  $('.sky-chips').hidden = !world.sunshine; // без климата переключать нечего
  if (world.planned) setData('planned', world.planned.features);
  $('.plan-chips').addEventListener('click', (e) => {
    const el = (e.target as Element).closest<HTMLElement>('.plan-chip');
    if (el) setAfter(el.dataset.pl === '1');
  });
  setSky(state.cloudy);
  $('.sky-chips').addEventListener('click', (e) => {
    const el = (e.target as Element).closest<HTMLElement>('.sky-chip');
    if (el) { setSky(el.dataset.cl === '1'); syncUrl(); }
  });
  initSearch(select);
  renderExamples((ex, b) => {
    if (state.season !== ex.s) setSeason(ex.s);
    select(b, { floor: ex.f, dir: ex.d });
  });
  initCompare((p) => select(p.b, { floor: p.floor, side: p.side }));
  initView();
  initBetter((b, floor) => select(b, { floor }));
  const floorSel = $<HTMLSelectElement>('.floor');
  floorSel.addEventListener('change', () => { state.floor = +floorSel.value; render(); });
  $('.sides').addEventListener('click', (e) => {
    const btn = (e.target as Element).closest<HTMLElement>('.side');
    if (btn) { autoSide = false; state.side = +btn.dataset.c! < 0 ? null : +btn.dataset.c!; render(); faceSide(); }
  });
  $('.matrix').addEventListener('click', (e) => {
    const cell = (e.target as Element).closest<HTMLElement>('.cell');
    if (!cell) return;
    autoSide = false;
    state.floor = +cell.dataset.f!;
    state.side = +cell.dataset.c!;
    floorSel.value = String(state.floor);
    render();
    faceSide();
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
    if (side >= 0) { autoSide = false; state.side = side; render(); faceSide(); }
  };
  $('.rose').addEventListener('click', pickSide);
  $('.rose').addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), pickSide(e)));
  $('.seasons').addEventListener('click', (e) => {
    const c = (e.target as Element).closest<HTMLElement>('.card');
    if (c) setSeason(+c.dataset.s!);
  });

  $('.assumed-input').addEventListener('input', () => state.current && osmEdit(state.current));
  $('.assumed-apply').addEventListener('click', () => {
    const b = state.current;
    const n = Math.round(+$<HTMLInputElement>('.assumed-input').value);
    if (!b || !(n >= 1 && n <= 60)) return;
    overrideFloors(b, n);
    state.floor = Math.min(state.floor, n);
    fillFloors(b);
    loadMatrix(b, renderBre);
    render();
  });

  $('.pin-btn').addEventListener('click', () => {
    if (!state.current) return;
    addPin({ b: state.current, floor: state.floor, side: state.side, label: facadeOf() ? fName(facadeOf()!) : t.whole, seasons: lastSeasons, bre: breNow()?.a.year ?? null, sea: lastSea.filter((s) => s.dist != null).length });
  });

  $('.share-btn').addEventListener('click', async () => {
    const b = state.current;
    if (!b) return;
    const name = cityName(city);
    const viewText = currentViewText();
    const view = viewing() && viewText ? { frame: await grabFrame(), text: viewText } : null;
    const blob = await shareCard({ view, city: name, title: buildingName(b), summary: summary(), subtitle: `${name} · ${t.card.floor(state.floor)} · ${t.sideLabel(facadeOf() ? fName(facadeOf()!) : null)}`, seasons: lastSeasons, sea: lastSea, ribbon: ribbonSmall, cloudy: state.cloudy });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `sun-view-${city.id}-${b.id}-${state.floor}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });
}
