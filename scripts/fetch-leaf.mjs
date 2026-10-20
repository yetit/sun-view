// Листопадные кроны по Sentinel-2: NDVI каждой кроны (ячейка ~6 м из canopy.bin) по месяцам за год,
// листопадная — где зимой зелень заметно пропадает. Снимки L2A — COG на AWS (Element 84 Earth Search),
// облака, тени облаков и снег отсекаем по маске SCL. Пишет старший бит canopy.bin и в canopy.json —
// месяцы без листвы (медиана NDVI листопадных крон ниже середины между зимой и летом).
// Запуск: node scripts/fetch-leaf.mjs <id> [год].
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fromUrl } from 'geotiff';
import { getCity } from '../cities.config.mjs';

const city = getCity(process.argv[2]);
const YEAR = +(process.argv[3] ?? new Date().getUTCFullYear() - 1);
const meta = JSON.parse(readFileSync(`data/${city.id}/canopy.json`, 'utf8'));
const { west, north, cols, rows, dlon, dlat } = meta;
const packed = readFileSync(`data/${city.id}/canopy.bin`), h = new Uint8Array(cols * rows);
for (let i = 0, k = 0; i < packed.length; i += 2) { k += packed[i]; h[k++] = packed[i + 1]; }
const cells = [];
for (let k = 0; k < h.length; k++) if (h[k]) cells.push(k);

// UTM, прямая задача (Snyder 1987, формулы 8-9…8-11), WGS 84.
function utm(lon, lat, zone) {
  const a = 6378137, f = 1 / 298.257223563, k0 = 0.9996, e2 = f * (2 - f), ep2 = e2 / (1 - e2);
  const p = (lat * Math.PI) / 180, l = ((lon - (zone * 6 - 183)) * Math.PI) / 180;
  const s = Math.sin(p), c = Math.cos(p), N = a / Math.sqrt(1 - e2 * s * s), T = (s / c) ** 2, C = ep2 * c * c, A = l * c;
  const M = a * ((1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256) * p - ((3 * e2) / 8 + (3 * e2 ** 2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * p)
    + ((15 * e2 ** 2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * p) - ((35 * e2 ** 3) / 3072) * Math.sin(6 * p));
  return [
    500000 + k0 * N * (A + ((1 - T + C) * A ** 3) / 6 + ((5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5) / 120),
    k0 * (M + N * (s / c) * (A * A / 2 + ((5 - T + 9 * C + 4 * C * C) * A ** 4) / 24 + ((61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6) / 720)),
  ];
}

async function get(url, init) {
  for (let i = 1; ; i++) {
    try { const r = await fetch(url, init); if (r.ok) return r; if (i === 4) throw new Error(`${url}: ${r.status}`); }
    catch (e) { if (i === 4) throw e; }
    await new Promise((r) => setTimeout(r, 3000 * i));
  }
}

// Помесячная медиана NDVI каждой кроны: month[м][крона], NaN — нет ясных снимков.
// LEAF_CACHE=<файл> — сохранить её (или взять готовую), чтобы подбирать порог без новой загрузки.
const CACHE = process.env.LEAF_CACHE;
const month = CACHE && existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')).map((a) => Float32Array.from(a, (v) => v ?? NaN)) : await download();
if (CACHE && !existsSync(CACHE)) writeFileSync(CACHE, JSON.stringify(month.map((a) => Array.from(a, (v) => (Number.isNaN(v) ? null : +v.toFixed(3))))));

async function download() {
  // Снимки за год: облачность тайла до 40 %, по каждому тайлу и месяцу — не больше трёх самых ясных.
  const { south, east } = city.bbox;
  const found = [];
  for (let next = { collections: ['sentinel-2-l2a'], bbox: [west, south, east, north], datetime: `${YEAR}-01-01T00:00:00Z/${YEAR}-12-31T23:59:59Z`, query: { 'eo:cloud_cover': { lt: 40 } }, limit: 200 }; next;) {
    const d = await (await get('https://earth-search.aws.element84.com/v1/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(next) })).json();
    found.push(...d.features);
    const link = d.links?.find((l) => l.rel === 'next');
    next = link?.body ? { ...next, ...link.body } : null;
  }
  const groups = new Map();
  for (const f of found) {
    const key = `${f.properties['grid:code']}:${f.properties.datetime.slice(5, 7)}`;
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }
  const scenes = [...groups.values()].flatMap((g) => g.sort((p, q) => p.properties['eo:cloud_cover'] - q.properties['eo:cloud_cover']).slice(0, 3));
  console.log(`${city.id}: ${found.length} снимков за ${YEAR}, берём ${scenes.length}`);

  // По дате — NDVI каждой кроны; один день с двух тайлов сливается в один слой.
  const byDate = new Map();
  const OK = new Set([4, 5]); // SCL: растительность, открытая поверхность (облака, тени, снег — мимо)
  async function scene(f) {
    const zone = +String(f.properties['proj:epsg'] ?? f.properties['proj:code']).replace(/\D/g, '') - 32600, date = f.properties.datetime.slice(0, 10);
    const read = async (asset, res) => {
      const img = await (await fromUrl(f.assets[asset].href)).getImage();
      const [ox, oy] = img.getOrigin();
      return { img, px: (x) => Math.floor((x - ox) / res), py: (y) => Math.floor((oy - y) / res) };
    };
    const pts = cells.map((k) => utm(west + ((k % cols) + 0.5) * dlon, north - (Math.floor(k / cols) + 0.5) * dlat, zone));
    const win = async ({ img, px, py }) => {
      const xs = pts.map((p) => px(p[0])), ys = pts.map((p) => py(p[1]));
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (let i = 0; i < xs.length; i++) { x0 = Math.min(x0, xs[i]); x1 = Math.max(x1, xs[i] + 1); y0 = Math.min(y0, ys[i]); y1 = Math.max(y1, ys[i] + 1); }
      x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(img.getWidth(), x1); y1 = Math.min(img.getHeight(), y1);
      if (x0 >= x1 || y0 >= y1) return null;
      const [band] = await img.readRasters({ window: [x0, y0, x1, y1] });
      return (i) => { const x = xs[i] - x0, y = ys[i] - y0; return x < 0 || y < 0 || x >= x1 - x0 || y >= y1 - y0 ? 0 : band[y * (x1 - x0) + x]; };
    };
    const t0 = Date.now();
    const scl = await win(await read('scl', 20));
    if (!scl) return;
    const [red, nir] = await Promise.all([read('red', 10).then(win), read('nir', 10).then(win)]);
    // NDVI прямо по отсчётам: у Earth Search в raster:bands указан сдвиг −0,1, но в самих файлах его нет
    // (у воды отсчёты красного ~50, со сдвигом отражение вышло бы отрицательным).
    let a = byDate.get(date), n = 0;
    if (!a) byDate.set(date, (a = new Float32Array(cells.length).fill(NaN)));
    for (let i = 0; i < cells.length; i++) {
      const r = red(i), q = nir(i);
      if (!r || !q || !OK.has(scl(i)) || !Number.isNaN(a[i])) continue;
      a[i] = (q - r) / (q + r); n++;
    }
    console.log(`  ${date} ${f.properties['grid:code']} облачность ${f.properties['eo:cloud_cover'].toFixed(0)} %: ${n} крон за ${((Date.now() - t0) / 1000).toFixed(0)} с`);
  }
  // Четыре снимка параллельно; чтение иногда рвётся по таймауту — до трёх попыток, потом снимок пропускаем.
  const queue = [...scenes];
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (let f; (f = queue.shift());) for (let attempt = 1; attempt <= 3; attempt++) try { await scene(f); break; } catch (e) { console.log(`  ${f.id}: ${e.code ?? e.message}${attempt < 3 ? ', ещё раз' : ', пропуск'}`); }
  }));
  return Array.from({ length: 12 }, (_, m) => {
    const layers = [...byDate].filter(([d]) => +d.slice(5, 7) === m + 1).map(([, a]) => a);
    return Float32Array.from(cells, (_, i) => med(layers.map((a) => a[i]).filter((v) => !Number.isNaN(v))));
  });
}
function med(a) { if (!a.length) return NaN; const s = Float32Array.from(a).sort(); return s[s.length >> 1]; }

// Листопадная крона: летом зелёная (NDVI июня–августа ≥ 0,4) и зимой (январь–март) теряет не меньше четверти
// летнего NDVI. Порог наш: у вечнозелёных крон зима и лето почти равны, у листопадных зимой около 0,5–0,6 против
// 0,85 летом, но в пикселе 10 м есть и трава, и крыши, поэтому чёткой границы нет. Декабрь не берём: низкое солнце.
const pool = (ms, i) => med(ms.map((m) => month[m][i]).filter((v) => !Number.isNaN(v)));
const decid = cells.map((_, i) => { const s = pool([5, 6, 7], i), w = pool([0, 1, 2], i); return s >= 0.4 && (s - w) / s >= 0.25; });
// Месяцы без листвы: медиана NDVI листопадных крон ниже середины между зимним минимумом и летним максимумом.
// Месяц без ясных снимков — без листвы, если без листвы оба соседних месяца с данными.
const curve = month.map((a) => med(cells.flatMap((_, i) => (decid[i] && !Number.isNaN(a[i]) ? [a[i]] : []))));
const known = curve.filter((v) => !Number.isNaN(v)), mid = (Math.min(...known) + Math.max(...known)) / 2;
const bare = curve.map((v) => (Number.isNaN(v) ? null : v < mid));
const near = (m, d) => { for (let k = 1; k < 12; k++) { const b = bare[(m + d * k + 12) % 12]; if (b != null) return b; } return false; };
const leafOff = bare.flatMap((b, m) => ((b ?? (near(m, -1) && near(m, 1))) ? [m + 1] : []));

for (let j = 0; j < cells.length; j++) h[cells[j]] = (h[cells[j]] & 127) | (decid[j] ? 128 : 0);
const rle = [];
let zeros = 0;
for (const v of h) {
  if (!v && zeros < 255) { zeros++; continue; }
  rle.push(zeros, v); zeros = 0;
}
if (zeros) rle.push(zeros - 1, 0);
writeFileSync(`data/${city.id}/canopy.bin`, Uint8Array.from(rle));
const share = decid.filter(Boolean).length / cells.length;
writeFileSync(`data/${city.id}/canopy.json`, JSON.stringify({
  ...meta,
  source: 'High Resolution Canopy Height Maps by WRI and Meta (Tolan et al. 2024), CC BY 4.0; AWS Open Data. Deciduous crowns and leaf-off months: contains modified Copernicus Sentinel data ' + YEAR + ' (Sentinel-2 L2A, Earth Search on AWS)',
  leafOff, leaf: { year: YEAR, deciduous: +share.toFixed(3), ndvi: curve.map((v) => (Number.isNaN(v) ? null : +v.toFixed(2))) },
}));
console.log(`${city.id}: листопадных крон ${(100 * share).toFixed(0)} %, NDVI листопадных по месяцам ${curve.map((v) => v.toFixed(2)).join(' ')}, без листвы — месяцы ${leafOff.join(', ')}`);
