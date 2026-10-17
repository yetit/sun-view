// Рельеф: Copernicus DEM GLO-30 (AWS Open Data, COG-тайлы 1°×1°) → data/<id>/dem.bin + dem.json.
// Читаем только окно bbox через HTTP range-запросы, прореживаем до city.dem.step угловых секунд.
// Затем: 1) море размечаем по береговой линии OSM (natural=coastline: суша слева, вода справа) —
// ячейки моря получают 0, суша ниже 0 поднимается до 1; 2) под зданиями из buildings.json DSM
// опускаем до соседей (крыши в модели поверхности есть), не роняя дома на склоне.
// Запуск: node scripts/fetch-dem.mjs <id>.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fromUrl } from 'geotiff';
import { getCity } from '../cities.config.mjs';
import { bboxStr, overpass } from './overpass.mjs';
import { bilinear } from './resample.mjs';

const city = getCity(process.argv[2]);
const { bbox, step } = city.dem;
const NODATA = -32768;
const tileName = (lat, lon) =>
  `Copernicus_DSM_COG_10_${lat >= 0 ? 'N' : 'S'}${String(Math.abs(lat)).padStart(2, '0')}_00_${lon >= 0 ? 'E' : 'W'}${String(Math.abs(lon)).padStart(3, '0')}_00_DEM`;

const cell = step / 3600;
const cols = Math.round((bbox.east - bbox.west) / cell);
const rows = Math.round((bbox.north - bbox.south) / cell);
const out = new Int16Array(cols * rows).fill(NODATA);
const lonAt = (c) => bbox.west + (c + 0.5) * cell;
const latAt = (r) => bbox.north - (r + 0.5) * cell;

// --- 1. Высоты из COG ---------------------------------------------------------
for (let lat = Math.floor(bbox.south); lat < bbox.north; lat++) {
  for (let lon = Math.floor(bbox.west); lon < bbox.east; lon++) {
    const name = tileName(lat, lon);
    const tiff = await fromUrl(`https://copernicus-dem-30m.s3.amazonaws.com/${name}/${name}.tif`);
    const img = await tiff.getImage();
    // Тайлы помечены PixelIsPoint: точка привязки (getOrigin) — центр первого пикселя, на целом градусе.
    // Высота в центре нашей ячейки — билинейно по четырём пикселям. Раньше брался ближайший, а севернее
    // 50° с. ш. шаг тайла по долготе 1,5–2″, и центр ячейки мог попасть ровно между пикселями: в Бергене
    // брался сосед на 15 м восточнее, на склоне Флёйена это +17 м (docs/horizon-check.md, Берген).
    const [x0, y1] = img.getOrigin();
    const [rx, ry] = img.getResolution();
    const W = img.getWidth(), H = img.getHeight();
    const fx = (lon) => (lon - x0) / rx, fy = (lat) => (y1 - lat) / -ry;
    const own = (f, n) => f >= -0.5 && f < n - 0.5; // ячейка — у тайла, в котором её ближайший пиксель
    const px0 = Math.max(0, Math.floor(fx(bbox.west))), px1 = Math.min(W, Math.ceil(fx(bbox.east)) + 1);
    const py0 = Math.max(0, Math.floor(fy(bbox.north))), py1 = Math.min(H, Math.ceil(fy(bbox.south)) + 1);
    if (px0 >= px1 || py0 >= py1) continue;
    const [band] = await img.readRasters({ window: [px0, py0, px1, py1] });
    const ww = px1 - px0;
    console.log(`${name}: начало ${x0}, ${y1}; шаг ${rx * 3600}″ × ${-ry * 3600}″; окно ${ww}×${py1 - py0} px`);
    for (let r = 0; r < rows; r++) {
      const y = fy(latAt(r));
      if (!own(y, H)) continue;
      for (let c = 0; c < cols; c++) {
        const x = fx(lonAt(c));
        if (!own(x, W)) continue;
        const v = bilinear(band, ww, py1 - py0, x - px0, y - py0);
        out[r * cols + c] = Number.isFinite(v) ? Math.round(v) : NODATA;
      }
    }
  }
}

// --- 2. Море по береговой линии OSM ------------------------------------------
// Для ячейки ищем ближайшее пересечение береговой линии лучом на восток: линия идёт на север —
// суша слева (на западе), т.е. ячейка на суше; на юг — ячейка в воде. Нет пересечений на востоке —
// смотрим на запад с обратным правилом. Нет вовсе — по высоте (≤ 0 — вода).
const coast = await overpass(`[out:json][timeout:180];way["natural"="coastline"](${bboxStr(bbox)});out geom;`);
const segs = [];
for (const w of coast) for (let i = 0; i + 1 < w.geometry.length; i++) segs.push([w.geometry[i].lon, w.geometry[i].lat, w.geometry[i + 1].lon, w.geometry[i + 1].lat]);
console.log(`береговая линия: ${coast.length} линий, ${segs.length} отрезков`);
let sea = 0, lifted = 0;
for (let r = 0; r < rows; r++) {
  const py = latAt(r);
  const rowSegs = segs.filter(([, y1, , y2]) => y1 > py !== y2 > py);
  for (let c = 0; c < cols; c++) {
    const px = lonAt(c);
    let east = Infinity, eastNorth = false, west = -Infinity, westNorth = false;
    for (const [x1, y1, x2, y2] of rowSegs) {
      const xi = x1 + ((py - y1) * (x2 - x1)) / (y2 - y1);
      if (xi > px && xi < east) { east = xi; eastNorth = y2 > y1; }
      if (xi <= px && xi > west) { west = xi; westNorth = y2 > y1; }
    }
    const k = r * cols + c;
    const water = east < Infinity ? !eastNorth : west > -Infinity ? westNorth : out[k] <= 0;
    if (out[k] === NODATA) continue;
    if (water) { out[k] = 0; sea++; } else if (out[k] <= 0) { out[k] = 1; lifted++; }
  }
}
console.log(`ячеек моря: ${sea}, суши ниже уровня моря поднято до 1 м: ${lifted}`);

// --- 3. Сглаживание DSM под зданиями ------------------------------------------
const bPath = `data/${city.id}/buildings.json`;
if (existsSync(bPath)) {
  const src = Int16Array.from(out);
  const inRing = (x, y, ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  let flattened = 0;
  for (const f of JSON.parse(readFileSync(bPath, 'utf8')).features) {
    const rings = f.geometry.type === 'Polygon' ? [f.geometry.coordinates[0]] : f.geometry.coordinates.map((p) => p[0]);
    for (const ring of rings) {
      const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]);
      const c0 = Math.floor((Math.min(...xs) - bbox.west) / cell), c1 = Math.floor((Math.max(...xs) - bbox.west) / cell);
      const r0 = Math.floor((bbox.north - Math.max(...ys)) / cell), r1 = Math.floor((bbox.north - Math.min(...ys)) / cell);
      for (let r = Math.max(0, r0); r <= Math.min(rows - 1, r1); r++) for (let c = Math.max(0, c0); c <= Math.min(cols - 1, c1); c++) {
        if (!inRing(lonAt(c), latAt(r), ring)) continue;
        // Крыша — горб над соседями: опускаем ячейку до самого низкого из восьми соседей суши, но
        // сначала снимаем с них наклон (плоскость по разностям соседей). На ровном месте это просто
        // минимум соседей, а дом на склоне не «съезжает» на ячейку вниз — на 20–30 м.
        const nb = [];
        let gx = 0, gy = 0;
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
          const v = src[(r + dr) * cols + c + dc];
          if ((dr || dc) && r + dr >= 0 && r + dr < rows && c + dc >= 0 && c + dc < cols && v !== NODATA && v > 0) nb.push([dr, dc, v]);
        }
        if (nb.length === 8) for (const [dr, dc, v] of nb) { gx += (v * dc) / 6; gy += (v * dr) / 6; } // у моря и края — без наклона
        let min = src[r * cols + c];
        for (const [dr, dc, v] of nb) min = Math.min(min, Math.round(v - gx * dc - gy * dr));
        if (min < out[r * cols + c]) { out[r * cols + c] = min; flattened++; }
      }
    }
  }
  console.log(`ячеек под зданиями сглажено: ${flattened}`);
} else console.log('buildings.json нет — DSM под зданиями не сглаживаем (запустите fetch-buildings и повторите)');

let min = Infinity, max = -Infinity;
for (const v of out) { if (v === NODATA) continue; if (v < min) min = v; if (v > max) max = v; }
mkdirSync(`data/${city.id}`, { recursive: true });
writeFileSync(`data/${city.id}/dem.bin`, Buffer.from(out.buffer)); // Int16 LE, строки с севера на юг, в строке — с запада на восток
writeFileSync(
  `data/${city.id}/dem.json`,
  JSON.stringify({
    source: 'Copernicus DEM GLO-30 (DSM), © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA; AWS Open Data. Море — OpenStreetMap natural=coastline (ODbL)',
    fetched: new Date().toISOString().slice(0, 10), bbox, cols, rows, cell, nodata: NODATA, min, max,
  }),
);
console.log(`${city.id}: ${cols}×${rows} ячеек по ${step}", высоты ${min}…${max} м`);
