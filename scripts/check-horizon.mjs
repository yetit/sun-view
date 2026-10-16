// Сверка рельефного горизонта ядра с PVGIS (EU JRC, API printhorizon v5_3, ключ не нужен).
// Для контрольных точек города берём угол горизонта по 48 азимутам (шаг 7,5°) из PVGIS и считаем
// тот же угол нашим ядром: horizonAngle из grid.ts по сетке DEM, без зданий, с высоты земли + 1,5 м.
// Печатаем разницу и что она даёт для восхода и заката 21 декабря.
// Запуск: nvm use && node scripts/check-horizon.mjs <cityId>
import { readFileSync } from 'node:fs';
import SunCalc from 'suncalc';
import { getCity } from '../cities.config.mjs';
import { createWorld, demAt, horizonAngle } from '../src/scripts/grid.ts';

// [название, lat, lon]: центр, набережная, склон, у подножия горы.
const POINTS = {
  tivat: [
    ['Центр', 42.433, 18.696],
    ['Набережная, Пине', 42.43, 18.693],
    ['Селяново', 42.4255, 18.688],
    ['Донья Ластва, берег', 42.444, 18.685],
    ['Подножие Врмаца', 42.43, 18.708],
    ['Склон Врмаца', 42.438, 18.715],
    ['Горня Ластва', 42.447, 18.703],
    ['Аэропорт, Жупа', 42.408, 18.715],
  ],
  kotor: [
    ['Старый город', 42.4247, 18.7712],
    ['Шкаляри', 42.418, 18.77],
    ['Крепость Св. Иоанна', 42.4255, 18.7745],
    ['Доброта, берег', 42.443, 18.762],
    ['Склон над Добротой', 42.452, 18.77],
    ['Муо', 42.43, 18.756],
    ['Прчань', 42.459, 18.743],
    ['Серпантин на Ловчен', 42.417, 18.788],
  ],
};
const EYE = 1.5; // м над землёй
const STEP = 7.5; // шаг азимута PVGIS, °
const FAR = 15000; // предел трассировки ядра, м (как в grid.ts)
const DAY = '2026-12-21';
const deg = Math.PI / 180;

const city = getCity(process.argv[2]);
const points = POINTS[city.id];
if (!points) throw new Error(`нет контрольных точек для ${city.id}`);
const meta = JSON.parse(readFileSync(`data/${city.id}/dem.json`, 'utf8'));
const buf = readFileSync(`data/${city.id}/dem.bin`);
const w = createWorld(city, { type: 'FeatureCollection', features: [] }, null, meta, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

// Профиль PVGIS: A — 0 = юг, 90 = запад, -90 = восток; от -180 до 180 включительно (север дважды).
// Переводим в азимут от севера по часовой: A + 180, последний (360°) отбрасываем.
async function pvgis(lat, lon, tries = 3) {
  const url = `https://re.jrc.ec.europa.eu/api/v5_3/printhorizon?lat=${lat}&lon=${lon}&outputformat=json`;
  const r = await fetch(url).catch((e) => (tries > 1 ? null : Promise.reject(e))); // сервер JRC иногда рвёт соединение
  if (!r) return pvgis(lat, lon, tries - 1);
  const j = await r.json();
  if (!r.ok) throw new Error(`PVGIS ${r.status}: ${j.message}`);
  const prof = j.outputs.horizon_profile.map((p) => [p.A + 180, p.H_hor]).filter(([a]) => a < 360).sort((a, b) => a[0] - b[0]);
  if (prof.length !== 360 / STEP || prof.some(([a], i) => a !== i * STEP)) throw new Error('неожиданная сетка азимутов PVGIS');
  return { elevation: j.inputs.location.elevation, h: prof.map(([, h]) => h) };
}

// Горизонт по азимуту (°) линейной интерполяцией профиля с шагом STEP.
const horAt = (h, a) => {
  const i = Math.floor(a / STEP) % h.length, f = a / STEP - Math.floor(a / STEP);
  return h[i] * (1 - f) + h[(i + 1) % h.length] * f;
};

// Первая и последняя минута 21 декабря, когда солнце выше горизонта; время местное, ЧЧ:ММ.
function sunWindow(h, lat, lon) {
  let first = null, last = null;
  const t0 = Date.parse(`${DAY}T00:00:00Z`);
  for (let m = 0; m < 24 * 60; m++) {
    const p = SunCalc.getPosition(new Date(t0 + m * 60000), lat, lon);
    const a = (p.azimuth / deg + 180 + 360) % 360; // suncalc: от юга к западу → от севера по часовой
    if (p.altitude / deg > horAt(h, a)) { first ??= m; last = m; }
  }
  return { first, last };
}
// Сколько метров луч идёт до края bbox рельефа (не больше FAR).
const [xw, ys] = w.proj.toXY(meta.bbox.west, meta.bbox.south), [xe, yn] = w.proj.toXY(meta.bbox.east, meta.bbox.north);
const toEdge = (x, y, b) => {
  const sx = Math.sin(b), sy = Math.cos(b);
  return Math.min(FAR, sx > 1e-9 ? (xe - x) / sx : sx < -1e-9 ? (xw - x) / sx : Infinity, sy > 1e-9 ? (yn - y) / sy : sy < -1e-9 ? (ys - y) / sy : Infinity);
};

const hhmm = (m) => (m == null ? '—' : new Date(Date.parse(`${DAY}T00:00:00Z`) + m * 60000).toLocaleTimeString('ru', { timeZone: city.timezone, hour: '2-digit', minute: '2-digit' }));
const dmin = (a, b) => (a == null || b == null ? '—' : `${a - b > 0 ? '+' : ''}${a - b}`);
const f1 = (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}`;

console.log(`${city.name}: горизонт ядра (DEM ${meta.cell * 3600}″, bbox рельефа, ≤ ${FAR / 1000} км) против PVGIS v5_3; Δ = наш − PVGIS, °`);
console.log('Наш угол ниже 0 считаем 0: PVGIS отрицательных не отдаёт. «При высоте PVGIS» — тот же расчёт, но глаз на его отметке + 1,5 м.');
console.log('Восход/закат — 21.12 по нашему профилю и по профилю PVGIS, местное время, Δ в минутах.\n');
console.log('| Точка | Земля наша / PVGIS, м | До края bbox, км | Δ средн. | \\|Δ\\| средн. | \\|Δ\\| при высоте PVGIS | Δ макс. (азимут) | \\|Δ\\| > 3°: азимутов, худшие | Восход наш / PVGIS (Δ) | Закат наш / PVGIS (Δ) |');
console.log('|---|---|---|---|---|---|---|---|---|---|');
const all = [], allPv = [];
const meanAbs = (a) => a.reduce((s, d) => s + Math.abs(d), 0) / a.length;
for (const [name, lat, lon] of points) {
  const ground = demAt(w.dem, lon, lat);
  const [x, y] = w.proj.toXY(lon, lat);
  const pv = await pvgis(lat, lon);
  const hor = (z) => pv.h.map((_, i) => Math.max(0, horizonAngle(w, x, y, z, i * STEP * deg) / deg));
  const ours = hor((ground ?? 0) + EYE);
  const diff = ours.map((v, i) => v - pv.h[i]);
  const diffPv = hor(pv.elevation + EYE).map((v, i) => v - pv.h[i]);
  all.push(...diff);
  allPv.push(...diffPv);
  const edge = pv.h.map((_, i) => toEdge(x, y, i * STEP * deg) / 1000);
  const iMax = diff.reduce((m, d, i) => (Math.abs(d) > Math.abs(diff[m]) ? i : m), 0);
  const big = diff.map((d, i) => [d, i]).filter(([d]) => Math.abs(d) > 3).sort((a, b) => Math.abs(b[0]) - Math.abs(a[0]));
  const bigStr = big.length ? `${big.length}: ${big.slice(0, 4).map(([d, i]) => `${i * STEP}° ${f1(d)}`).join(', ')}` : '—';
  const so = sunWindow(ours, lat, lon), sp = sunWindow(pv.h, lat, lon);
  const mean = diff.reduce((s, d) => s + d, 0) / diff.length;
  console.log(`| ${name} | ${ground} / ${pv.elevation} | ${Math.min(...edge).toFixed(1)}–${Math.max(...edge).toFixed(1)} | ${f1(mean)} | ${meanAbs(diff).toFixed(1)} | ${meanAbs(diffPv).toFixed(1)} | ${f1(diff[iMax])} (${iMax * STEP}°) | ${bigStr} | ${hhmm(so.first)} / ${hhmm(sp.first)} (${dmin(so.first, sp.first)}) | ${hhmm(so.last)} / ${hhmm(sp.last)} (${dmin(so.last, sp.last)}) |`);
}
const sum = (a) => `Δ средн. ${f1(a.reduce((s, d) => s + d, 0) / a.length)}°, |Δ| средн. ${meanAbs(a).toFixed(2)}°, |Δ| > 3° — ${a.filter((d) => Math.abs(d) > 3).length} из ${a.length}`;
console.log(`\nВсего: ${sum(all)}. При высоте PVGIS: ${sum(allPv)}.`);
