// Тени зданий на земле: контур, сдвинутый от солнца на h / tg(высоты солнца), — выпуклая оболочка
// контура и его сдвига. Рисуем выбранное здание и соседей в радиусе 300 м (без выбора — вокруг
// центра карты при крупном масштабе). Рельеф под тенью не учитывается — это иллюстрация, расчёт
// часов солнца идёт лучами отдельно.
import type { Sun } from '../analysis.ts';
import { state, world } from '../app.ts';
import { map, setData } from './layers.ts';

const RADIUS = 300; // м
const MAX_LEN = 250; // м — очень низкое солнце даёт бесконечные тени
type P = [number, number];

function hull(pts: P[]): P[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: P, a: P, b: P) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: P[] = [], upper: P[] = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower.at(-2)!, lower.at(-1)!, q) <= 0) lower.pop(); lower.push(q); }
  for (const q of p.reverse()) { while (upper.length >= 2 && cross(upper.at(-2)!, upper.at(-1)!, q) <= 0) upper.pop(); upper.push(q); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

export function drawShadows(s: Sun) {
  if (!world || !map.getSource('shadows')) return;
  const center: P = state.current ? state.current.xy : world.proj.toXY(map.getCenter().lng, map.getCenter().lat);
  if (s.altitude < 0.03 || (!state.current && map.getZoom() < 15.5)) return setData('shadows', []);
  const k = 1 / Math.tan(s.altitude);
  const dx = -Math.sin(s.bearing), dy = -Math.cos(s.bearing); // от солнца
  const features: any[] = [];
  for (const b of world.blds) {
    if (Math.hypot(b.xy[0] - center[0], b.xy[1] - center[1]) > RADIUS + b.radius) continue;
    const len = Math.min(b.h * k, MAX_LEN);
    for (const ring of b.rings) {
      const pts: P[] = ring.flatMap(([x, y]) => [[x, y], [x + dx * len, y + dy * len]] as P[]);
      const h = hull(pts).map(([x, y]) => world.proj.toLonLat(x, y));
      features.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[...h, h[0]]] } });
    }
  }
  setData('shadows', features);
  // Низкое солнце (зима в Бергене — ~6°): длинные тени накладываются и сливаются в тёмное пятно —
  // чем ниже солнце, тем прозрачнее каждая тень.
  const k2 = Math.min(1, Math.max(0.4, Math.sin(s.altitude) / Math.sin((20 * Math.PI) / 180)));
  map.setPaintProperty('shadows', 'fill-opacity', 0.22 * k2);
}
