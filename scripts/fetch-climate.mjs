// Облачность: вероятность прямого солнца по месяцам → data/<id>/climate.json.
// Почасовая прямая радиация PVGIS-SARAH3 (спутник, JRC) за 2014–2023 на двухосевом трекере — это DNI;
// солнечный час по определению ВМО — DNI не ниже 120 Вт/м². Доля таких часов среди часов, когда солнце
// над горизонтом, без рельефа (рельеф и дома считаем сами) — вероятность, что солнце не за облаками.
// На неё умножаются наши часы при ясном небе. Запуск: node scripts/fetch-climate.mjs <id>.
import { writeFileSync } from 'node:fs';
import { getCity } from '../cities.config.mjs';

const city = getCity(process.argv[2]);
const [lon, lat] = city.camera.center;
const FROM = 2014, TO = 2023, DNI = 120;
const url = `https://re.jrc.ec.europa.eu/api/v5_3/seriescalc?lat=${lat}&lon=${lon}&startyear=${FROM}&endyear=${TO}&trackingtype=2&components=1&usehorizon=0&outputformat=json`;
let res;
for (let i = 1; ; i++) {
  res = await fetch(url);
  if (res.ok || i === 3) break;
  await new Promise((r) => setTimeout(r, 30000 * i));
}
if (!res.ok) throw new Error(`PVGIS: ${res.status} ${await res.text()}`);
const sun = new Array(12).fill(0), day = new Array(12).fill(0);
for (const h of (await res.json()).outputs.hourly) {
  if (h.H_sun <= 0) continue;
  const m = +h.time.slice(4, 6) - 1;
  day[m]++;
  if (h['Gb(i)'] >= DNI) sun[m]++;
}
const sunshine = sun.map((s, m) => Math.round((100 * s) / day[m]) / 100);
writeFileSync(`data/${city.id}/climate.json`, JSON.stringify({
  source: 'PVGIS-SARAH3 hourly radiation © European Union, JRC (reuse with attribution); sunshine = DNI ≥ 120 W/m²',
  fetched: new Date().toISOString().slice(0, 10), years: [FROM, TO], lat, lon, sunshine,
}));
console.log(`${city.id}: вероятность прямого солнца по месяцам ${sunshine.join(' ')}; ≈${Math.round(sun.reduce((a, b) => a + b) / (TO - FROM + 1))} ч в год`);
