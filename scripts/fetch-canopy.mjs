// Высота крон: Meta & WRI High Resolution Canopy Height (Tolan et al. 2024, CC BY 4.0, AWS Open Data) →
// data/<id>/canopy.bin + canopy.json. Тайлы — COG по квадкею z9 в Web Mercator, пиксель ~1,2 м, Uint8 в метрах.
// Читаем только окно bbox города и сводим в сетку ~6 м (как растр крыш): высота ячейки — медиана пикселей,
// ниже 3 м — 0 (кусты, шум). Старший бит — лиственная крона по Copernicus HRL Dominant Leaf Type 2018 (10 м):
// зимой такие деревья могут стоять голыми. Запись — RLE: пары (нулей перед значением 0..255, значение).
// Запуск: node scripts/fetch-canopy.mjs <id>.
import { writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { fromArrayBuffer, fromUrl } from 'geotiff';
import { getCity } from '../cities.config.mjs';

const city = getCity(process.argv[2]);
const { south, west, north, east } = city.bbox;
const CELL = 6, MIN = 3, Z = 9, R = 6378137;
const BASE = 'https://dataforgood-fb-data.s3.amazonaws.com/forests/v1/alsgedi_global_v6_float/chm';

// Сети рвутся на десятках мегабайт — повторяем запрос до 4 раз.
async function get(url, init) {
  for (let i = 1; ; i++) {
    try { const r = await fetch(url, init); if (r.ok) return r; if (i === 4) throw new Error(`${url}: ${r.status}`); }
    catch (e) { if (i === 4) throw e; }
    await new Promise((r) => setTimeout(r, 3000 * i));
  }
}

const lat0 = (south + north) / 2;
const dlat = CELL / 111320, dlon = CELL / (111320 * Math.cos((lat0 * Math.PI) / 180));
const cols = Math.ceil((east - west) / dlon), rows = Math.ceil((north - south) / dlat);
const out = new Uint8Array(cols * rows);

const mx = (lon) => (R * lon * Math.PI) / 180;
const my = (lat) => R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const tileXY = (lat, lon) => {
  const n = 2 ** Z, s = Math.sin((lat * Math.PI) / 180);
  return [Math.floor(((lon + 180) / 360) * n), Math.floor((0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n)];
};
const quadkey = (x, y) => Array.from({ length: Z }, (_, i) => { const m = 1 << (Z - 1 - i); return (x & m ? 1 : 0) + (y & m ? 2 : 0); }).join('');

const [tx0, ty0] = tileXY(north, west), [tx1, ty1] = tileXY(south, east);
for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
  const name = quadkey(tx, ty);
  const img = await (await fromUrl(`${BASE}/${name}.tif`)).getImage();
  const [ox, oy] = img.getOrigin(), [rx, ry] = img.getResolution(), W = img.getWidth(), H = img.getHeight();
  const px = (lon) => (mx(lon) - ox) / rx, py = (lat) => (my(lat) - oy) / ry;
  const x0 = Math.max(0, Math.floor(px(west))), x1 = Math.min(W, Math.ceil(px(east)));
  const y0 = Math.max(0, Math.floor(py(north))), y1 = Math.min(H, Math.ceil(py(south)));
  if (x0 >= x1 || y0 >= y1) continue;
  const t0 = Date.now();
  // Тайл — полосы по одной строке (deflate, предиктор 2) подряд в файле. geotiff.js шлёт по запросу на полосу
  // и упирается в таймауты, поэтому строки окна берём одним диапазоном кусками по 8 МБ и распаковываем сами.
  const d = img.fileDirectory;
  const offs = await d.loadValue('StripOffsets'), lens = await d.loadValue('StripByteCounts');
  const ww = x1 - x0, band = new Uint8Array(ww * (y1 - y0));
  for (let y = y0; y < y1;) {
    let e = y + 1;
    while (e < y1 && offs[e] + lens[e] - offs[y] < 8 << 20) e++;
    const res = await get(`${BASE}/${name}.tif`, { headers: { Range: `bytes=${offs[y]}-${offs[e - 1] + lens[e - 1] - 1}` } });
    const buf = Buffer.from(await res.arrayBuffer());
    for (let k = y; k < e; k++) {
      const row = inflateSync(buf.subarray(offs[k] - offs[y], offs[k] - offs[y] + lens[k]));
      for (let x = 1; x < x1; x++) row[x] += row[x - 1]; // предиктор 2: разности по строке
      band.set(row.subarray(x0, x1), (k - y0) * ww);
    }
    y = e;
  }
  console.log(`${city.id}: тайл ${name}, окно ${ww}×${y1 - y0} px за ${((Date.now() - t0) / 1000).toFixed(0)} с`);
  const vals = [];
  for (let r = 0; r < rows; r++) {
    const la1 = north - r * dlat, la0 = la1 - dlat;
    const a = Math.floor(py(la1)) - y0, b = Math.ceil(py(la0)) - y0;
    if (b <= 0 || a >= y1 - y0) continue;
    for (let c = 0; c < cols; c++) {
      const lo0 = west + c * dlon, lo1 = lo0 + dlon;
      const l = Math.floor(px(lo0)) - x0, rr = Math.ceil(px(lo1)) - x0;
      if (rr <= 0 || l >= ww) continue;
      vals.length = 0;
      for (let y = Math.max(0, a); y < Math.min(y1 - y0, b); y++) for (let x = Math.max(0, l); x < Math.min(ww, rr); x++) vals.push(band[y * ww + x]);
      if (!vals.length) continue;
      vals.sort((p, q) => p - q);
      const m = vals[vals.length >> 1];
      out[r * cols + c] = m >= MIN ? m : 0;
    }
  }
}

// Тип листвы: экспорт растра EEA (ImageServer) в WGS 84, ~10 м; 1 — лиственные, 2 — хвойные.
const DLT = 'https://image.discomap.eea.europa.eu/arcgis/rest/services/GioLandPublic/HRL_DominantLeafType2018/ImageServer/exportImage';
const lw = Math.ceil(cols * CELL / 10), lh = Math.ceil(rows * CELL / 10);
const res = await get(`${DLT}?bbox=${west},${south},${east},${north}&bboxSR=4326&imageSR=4326&size=${lw},${lh}&format=tiff&pixelType=U8&interpolation=RSP_NearestNeighbor&f=image`);
const leaf = await (await fromArrayBuffer(await res.arrayBuffer())).getImage();
const [lt] = await leaf.readRasters();
const [bx0, by0, bx1, by1] = leaf.getBoundingBox(); // сервер подгоняет bbox под пропорции картинки
const LW = leaf.getWidth(), LH = leaf.getHeight();
let broad = 0;
for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
  const k = r * cols + c;
  if (!out[k]) continue;
  out[k] = Math.min(out[k], 127);
  const x = Math.floor(((west + (c + 0.5) * dlon - bx0) / (bx1 - bx0)) * LW), y = Math.floor(((by1 - (north - (r + 0.5) * dlat)) / (by1 - by0)) * LH);
  if (x >= 0 && y >= 0 && x < LW && y < LH && lt[y * LW + x] === 1) { out[k] |= 128; broad++; }
}

const rle = [];
let zeros = 0;
for (const v of out) {
  if (!v && zeros < 255) { zeros++; continue; }
  rle.push(zeros, v); zeros = 0;
}
if (zeros) rle.push(zeros - 1, 0);
writeFileSync(`data/${city.id}/canopy.bin`, Uint8Array.from(rle));
const trees = Array.from(out.filter(Boolean), (v) => v & 127);
writeFileSync(`data/${city.id}/canopy.json`, JSON.stringify({
  source: 'High Resolution Canopy Height Maps by WRI and Meta (Tolan et al. 2024), CC BY 4.0; AWS Open Data. Leaf type: Copernicus HRL Dominant Leaf Type 2018, © European Union, Copernicus Land Monitoring Service',
  fetched: new Date().toISOString().slice(0, 10), west, north, cols, rows, dlon, dlat, min: MIN,
}));
const sorted = Float32Array.from(trees).sort();
console.log(`${city.id}: сетка ${cols}×${rows}, деревья в ${((100 * trees.length) / out.length).toFixed(1)} % ячеек, высота медиана ${sorted[sorted.length >> 1]} м, 90 % — ${sorted[Math.floor(0.9 * sorted.length)]} м, лиственных ${Math.round((100 * broad) / trees.length)} %; RLE ${rle.length} Б`);
