// Рисунки панели без состояния: роза видимости моря (SVG), лента года и панорама вида из окна (canvas).
import { N, RIBBON_DAY_STEP, SEASONS, STEP_MIN, sunshineAt, YEAR, type SeaDir } from '../analysis.ts';
import { fmtH, tzOffset } from '../app.ts';
import { t } from '../i18n.ts';

// Роза видимости моря: 8 секторов, снаружи направление, внутри — километры до воды; sel — выделенный румб.
// Видно — штриховка и волна, не видно — светлый сектор с прочерком: читается и без цвета.
export function roseSvg(sea: SeaDir[], sel: number) {
  const c = 100, r1 = 36, r2 = 72;
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

// Лента года: столбцы — дни, строки — местное время суток (0 сверху). Возвращает маленький canvas
// с самими данными — его же кладём в PNG-карточку. sunshine — «с облаками»: клетка «солнце в окне»
// смешивается с серым в пропорции вероятности прямого солнца в этот день (жёлтое при p = 1, серое при 0).
export function drawRibbon(cv: HTMLCanvasElement, { cols, rows, data }: { cols: number; rows: number; data: Uint8Array }, sunshine: number[] | null = null) {
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
    const day = new Date(Date.UTC(YEAR, 0, 1 + c * RIBBON_DAY_STEP));
    const shift = Math.round((tzOffset(day) * 60) / STEP_MIN);
    const p = sunshine ? sunshineAt(sunshine, day) : 1;
    const sun = palette[2].map((v, k) => Math.round(palette[1][k] + (v - palette[1][k]) * p));
    for (let i = 0; i < rows; i++) {
      const row = (((i + shift) % N) + N) % N;
      const [r, g, b] = data[i * cols + c] === 2 ? sun : palette[data[i * cols + c]];
      const k = (row * cols + c) * 4;
      img.data[k] = r; img.data[k + 1] = g; img.data[k + 2] = b; img.data[k + 3] = 255;
    }
  }
  small.getContext('2d')!.putImageData(img, 0, 0);
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
  return small;
}

// Полоса-панорама вида из окна: клетка — луч (небо, море, препятствие), пунктир — горизонт.
export function drawPano(cv: HTMLCanvasElement, { cols, rows, data }: { cols: number; rows: number; data: Uint8Array }, label: string) {
  cv.width = cols; cv.height = rows;
  const ctx = cv.getContext('2d')!, img = ctx.createImageData(cols, rows);
  const palette = [[196, 184, 163], [31, 106, 165], [214, 230, 244]]; // HIT: препятствие, море (синее, как вода на карте), небо
  data.forEach((v, i) => { img.data.set(palette[v], i * 4); img.data[i * 4 + 3] = 255; });
  ctx.putImageData(img, 0, 0);
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  for (let x = 0; x < cols; x += 2) ctx.fillRect(x, (rows - 1) / 2, 1, 1);
  cv.setAttribute('aria-label', label);
}
