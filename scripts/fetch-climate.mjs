// Облачность: вероятность прямого солнца по месяцам → data/<id>/climate.json.
// Почасовая прямая радиация PVGIS-SARAH3 (спутник, JRC) за 2014–2023 на двухосевом трекере — это DNI;
// солнечный час по определению ВМО — DNI не ниже 120 Вт/м². Доля таких часов среди часов, когда солнце
// над горизонтом, без рельефа (рельеф и дома считаем сами) — вероятность, что солнце не за облаками.
// На неё умножаются наши часы при ясном небе.
// Из того же ряда — средняя дневная температура по месяцам (T2m, ERA5, часы с солнцем над горизонтом), а из
// типичного метеогода PVGIS (TMY, ERA5 2005–2023) — преобладающее днём направление ветра (8 румбов, часы с ветром
// от 1 м/с; в файле — часы по румбам за каждый месяц) и средняя дневная скорость. ERA5 — сетка ~25 км: это климат города, а не микроклимат у окна.
// Запуск: node scripts/fetch-climate.mjs <id>.
import { writeFileSync } from 'node:fs';
import { getCity } from '../cities.config.mjs';

const city = getCity(process.argv[2]);
const [lon, lat] = city.camera.center;
const FROM = 2014, TO = 2023, DNI = 120;
const url = `https://re.jrc.ec.europa.eu/api/v5_3/seriescalc?lat=${lat}&lon=${lon}&startyear=${FROM}&endyear=${TO}&trackingtype=2&components=1&usehorizon=0&outputformat=json`;
async function get(url) {
  let res;
  for (let i = 1; ; i++) {
    res = await fetch(url);
    if (res.ok || i === 3) break;
    await new Promise((r) => setTimeout(r, 30000 * i));
  }
  if (!res.ok) throw new Error(`PVGIS: ${res.status} ${await res.text()}`);
  return res.json();
}
const sun = new Array(12).fill(0), day = new Array(12).fill(0), temp = new Array(12).fill(0);
for (const h of (await get(url)).outputs.hourly) {
  if (h.H_sun <= 0) continue;
  const m = +h.time.slice(4, 6) - 1;
  day[m]++;
  temp[m] += h.T2m;
  if (h['Gb(i)'] >= DNI) sun[m]++;
}
const sunshine = sun.map((s, m) => Math.round((100 * s) / day[m]) / 100);
const tday = temp.map((t, m) => Math.round((10 * t) / day[m]) / 10);
// Ветер днём: TMY без рельефа, часы, когда солнце над горизонтом (по глобальной радиации на горизонтали > 0).
const tmy = (await get(`https://re.jrc.ec.europa.eu/api/v5_3/tmy?lat=${lat}&lon=${lon}&usehorizon=0&outputformat=json`)).outputs.tmy_hourly;
const dirs = Array.from({ length: 12 }, () => new Array(8).fill(0)), ws = new Array(12).fill(0), wn = new Array(12).fill(0);
for (const h of tmy) {
  if (h['G(h)'] <= 0) continue;
  const m = +h['time(UTC)'].slice(4, 6) - 1;
  ws[m] += h.WS10m; wn[m]++;
  if (h.WS10m >= 1) dirs[m][Math.round(h.WD10m / 45) % 8]++;
}
const windSpeed = ws.map((s, m) => Math.round((10 * s) / wn[m]) / 10);
writeFileSync(`data/${city.id}/climate.json`, JSON.stringify({
  source: 'PVGIS-SARAH3 hourly radiation and ERA5 temperature, PVGIS TMY (ERA5 2005–2023) wind; © European Union, JRC (reuse with attribution); sunshine = DNI ≥ 120 W/m², tday = mean T2m while the sun is up, wind = daytime hours by direction the wind blows from (0 = N … 7 = NW, ≥ 1 m/s), windSpeed = daytime mean m/s',
  fetched: new Date().toISOString().slice(0, 10), years: [FROM, TO], lat, lon, sunshine, tday, wind: dirs, windHours: wn, windSpeed,
}));
console.log(`${city.id}: вероятность прямого солнца по месяцам ${sunshine.join(' ')}; ≈${Math.round(sun.reduce((a, b) => a + b) / (TO - FROM + 1))} ч в год`);
console.log(`${city.id}: днём °C ${tday.join(' ')}; ветер чаще с румба ${dirs.map((d) => d.indexOf(Math.max(...d))).join(' ')}, м/с ${windSpeed.join(' ')}`);
