// Карточка результата в PNG 1200×630: заголовок, четыре сезона, лента года, роза моря.
import type { SeaDir, Season } from './analysis.ts';

const fmt = new Intl.NumberFormat('ru', { maximumFractionDigits: 1 });
export type CardData = { city: string; title: string; subtitle: string; seasons: Season[]; sea: SeaDir[]; ribbon: HTMLCanvasElement | null };

export async function shareCard(o: CardData): Promise<Blob> {
  const W = 1200, H = 630;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d')!;
  await document.fonts.ready;
  const font = (w: number, px: number) => (ctx.font = `${w} ${px}px "Inter Variable", Inter, system-ui, sans-serif`);
  const text = (s: string, x: number, y: number, color: string, align: CanvasTextAlign = 'left') => { ctx.fillStyle = color; ctx.textAlign = align; ctx.fillText(s, x, y); };

  ctx.fillStyle = '#fcfaf6'; ctx.fillRect(0, 0, W, H);
  font(650, 44); text(o.title, 56, 92, '#1f1d1a');
  font(400, 20); text(o.subtitle, 56, 126, '#7a746a');
  font(600, 13); text('СОЛНЦЕ В ОКНАХ', 56, 178, '#7a746a');

  o.seasons.forEach((s, i) => {
    const x = 56 + i * 156, y = 192;
    ctx.fillStyle = '#f3efe6'; ctx.beginPath(); ctx.roundRect(x, y, 142, 104, 12); ctx.fill();
    font(500, 15); text(s.short, x + 14, y + 30, '#7a746a');
    font(650, 32); text(`${fmt.format(s.sun)} ч`, x + 14, y + 68, '#1f1d1a');
    font(400, 13); text(`из ${fmt.format(s.daylight)}`, x + 14, y + 90, '#7a746a');
    ctx.fillStyle = '#ffb703'; ctx.fillRect(x, y + 101, s.daylight ? (142 * s.sun) / s.daylight : 0, 3);
  });

  if (o.ribbon) {
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(o.ribbon, 56, 324, 660, 232);
    font(400, 12); text('год →', 56 + 660, 574, '#7a746a', 'right'); text('↓ сутки', 56, 574, '#7a746a');
  }

  // Роза
  const cx = 965, cy = 380, r1 = 56, r2 = 128;
  const pt = (r: number, a: number): [number, number] => [cx + r * Math.sin(a), cy - r * Math.cos(a)];
  font(600, 13); text('ВИД НА МОРЕ', cx, 178, '#7a746a', 'center');
  for (const { dir, bearing, dist } of o.sea) {
    const a0 = bearing - Math.PI / 8 + 0.03, a1 = bearing + Math.PI / 8 - 0.03;
    ctx.beginPath(); ctx.moveTo(...pt(r1, a0)); ctx.lineTo(...pt(r2, a0));
    ctx.arc(cx, cy, r2, a1 - Math.PI / 2, a0 - Math.PI / 2, true); // рисуем по часовой от a0 к a1
    ctx.lineTo(...pt(r1, a1)); ctx.arc(cx, cy, r1, a0 - Math.PI / 2, a1 - Math.PI / 2, false);
    ctx.closePath();
    ctx.fillStyle = dist != null ? '#53b58f' : '#f4d5d3'; ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
    font(600, 16); text(dir, ...pt(r2 + 22, bearing).map((v, i) => (i ? v + 6 : v)) as [number, number], '#7a746a', 'center');
    if (dist != null) { font(600, 13); text(fmt.format(dist / 1000), ...pt((r1 + r2) / 2, bearing).map((v, i) => (i ? v + 5 : v)) as [number, number], '#fff', 'center'); }
  }
  const n = o.sea.filter((s) => s.dist != null).length;
  font(650, 40); text(`${n}/8`, cx, cy + 12, '#1f1d1a', 'center');
  font(400, 14); text(`Sun & View · ${o.city} · данные: OpenStreetMap (ODbL), Copernicus DEM GLO-30, suncalc`, 56, 608, '#7a746a');
  return new Promise((res) => cv.toBlob((b) => res(b!), 'image/png'));
}
