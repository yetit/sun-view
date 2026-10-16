// Рельеф: Copernicus DEM GLO-30 (AWS Open Data, COG-тайлы 1°×1°) → data/<id>/dem.json.
// Читаем только окно bbox через HTTP range-запросы, прореживаем до city.dem.step угловых секунд,
// высоты округляем до метра и кладём как Int16 в base64.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fromUrl } from 'geotiff';
import city from '../city.config.mjs';

const { bbox, step } = city.dem;
const tileName = (lat, lon) => {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `Copernicus_DSM_COG_10_${ns}${String(Math.abs(lat)).padStart(2, '0')}_00_${ew}${String(Math.abs(lon)).padStart(3, '0')}_00_DEM`;
};

const cell = step / 3600;
const cols = Math.round((bbox.east - bbox.west) / cell);
const rows = Math.round((bbox.north - bbox.south) / cell);
const out = new Int16Array(cols * rows).fill(-32768);

// Все 1°-тайлы, которые пересекает bbox (обычно один).
for (let lat = Math.floor(bbox.south); lat < bbox.north; lat++) {
  for (let lon = Math.floor(bbox.west); lon < bbox.east; lon++) {
    const name = tileName(lat, lon);
    const url = `https://copernicus-dem-30m.s3.amazonaws.com/${name}/${name}.tif`;
    const tiff = await fromUrl(url);
    const img = await tiff.getImage();
    const [x0, y0, x1, y1] = img.getBoundingBox();
    const [rx, ry] = img.getResolution();
    const W = img.getWidth();
    const H = img.getHeight();
    // Окно пересечения bbox с тайлом, в пикселях тайла.
    const w = Math.max(bbox.west, x0);
    const e = Math.min(bbox.east, x1);
    const s = Math.max(bbox.south, y0);
    const n = Math.min(bbox.north, y1);
    const px0 = Math.max(0, Math.floor((w - x0) / rx));
    const px1 = Math.min(W, Math.ceil((e - x0) / rx));
    const py0 = Math.max(0, Math.floor((y1 - n) / -ry));
    const py1 = Math.min(H, Math.ceil((y1 - s) / -ry));
    const [band] = await img.readRasters({ window: [px0, py0, px1, py1] });
    const ww = px1 - px0;
    console.log(`${name}: окно ${ww}×${py1 - py0} px`);
    // Пишем в выходную сетку: для каждой выходной ячейки — ближайший пиксель исходника.
    for (let r = 0; r < rows; r++) {
      const latC = bbox.north - (r + 0.5) * cell;
      if (latC < s || latC > n) continue;
      const py = Math.floor((y1 - latC) / -ry) - py0;
      for (let c = 0; c < cols; c++) {
        const lonC = bbox.west + (c + 0.5) * cell;
        if (lonC < w || lonC > e) continue;
        const px = Math.floor((lonC - x0) / rx) - px0;
        const v = band[py * ww + px];
        out[r * cols + c] = Number.isFinite(v) ? Math.round(v) : -32768;
      }
    }
  }
}

let min = Infinity, max = -Infinity, zeros = 0;
for (const v of out) { if (v === -32768) continue; if (v < min) min = v; if (v > max) max = v; if (v <= 0) zeros++; }
mkdirSync(`data/${city.id}`, { recursive: true });
writeFileSync(
  `data/${city.id}/dem.json`,
  JSON.stringify({
    source: 'Copernicus DEM GLO-30 (DSM), © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA; AWS Open Data',
    fetched: new Date().toISOString().slice(0, 10),
    bbox, cols, rows, cell, nodata: -32768, min, max,
    // Int16 little-endian, по строкам с севера на юг, в строке — с запада на восток.
    data: Buffer.from(out.buffer).toString('base64'),
  }),
);
console.log(`${cols}×${rows} ячеек по ${step}", высоты ${min}…${max} м, ячеек ≤0 (море): ${zeros}`);
