// Значение растра band (w × h, по строкам) в дробной точке (x, y) в пикселях, 0 — центр первого пикселя:
// билинейно по четырём соседям, за краем — крайний пиксель.
export function bilinear(band, w, h, x, y) {
  const i = Math.floor(x), j = Math.floor(y), tx = x - i, ty = y - j;
  const at = (a, b) => band[Math.min(Math.max(b, 0), h - 1) * w + Math.min(Math.max(a, 0), w - 1)];
  return at(i, j) * (1 - tx) * (1 - ty) + at(i + 1, j) * tx * (1 - ty) + at(i, j + 1) * (1 - tx) * ty + at(i + 1, j + 1) * tx * ty;
}
