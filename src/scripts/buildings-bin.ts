// Компактный формат зданий: data/<id>/buildings.bin + buildings.meta.json вместо GeoJSON в бандле.
// Упаковывает scripts/pack-buildings.ts из buildings.json (он остаётся источником для скриптов),
// распаковывают страница и воркер обратно в GeoJSON той же формы — остальной код не меняется.
//
// Координаты — метры от начала (origin) в единицах scale, Int16; в кольце первая точка абсолютная,
// остальные — разности с предыдущей (gzip сжимает их лучше), замыкающая точка не хранится.
// Секции: ring (Uint32, начала колец в вершинах), bld (Uint32, начала зданий в кольцах), id (Uint32),
// height (Uint16, дециметры, 0 — нет), name/addr/street (Uint16, индекс в strings, 0 — нет),
// xy (Int16), levels (Uint8, 0 — нет), kind (Uint8, индекс в kinds, 0 — нет), flags (Uint8, бит 0 — relation).

type Section = [offset: number, count: number];
export type BuildingsMeta = {
  version: 1; n: number; origin: [number, number]; scale: number; kx: number; ky: number;
  strings: (string | null)[]; kinds: (string | null)[]; sections: Record<string, Section>; source?: string; fetched?: string;
};

const TYPES = { ring: Uint32Array, bld: Uint32Array, id: Uint32Array, height: Uint16Array, name: Uint16Array, addr: Uint16Array, street: Uint16Array, xy: Int16Array, levels: Uint8Array, kind: Uint8Array, flags: Uint8Array };
type Name = keyof typeof TYPES;

export function packBuildings(geojson: any): { meta: BuildingsMeta; buf: Uint8Array } {
  const fs = geojson.features as any[];
  const [w, s, e, n] = (() => { let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; for (const f of fs) for (const r of rings(f)) for (const [x, y] of r) { a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x); d = Math.max(d, y); } return [a, b, c, d]; })();
  const origin: [number, number] = [+((w + e) / 2).toFixed(6), +((s + n) / 2).toFixed(6)];
  const ky = 111320, kx = 111320 * Math.cos((origin[1] * Math.PI) / 180);
  const half = Math.max((e - w) * kx, (n - s) * ky) / 2;
  const scale = +Math.max(0.05, Math.ceil(half / 32000 / 0.05) * 0.05).toFixed(2); // шаг кратен 5 см, город влезает в Int16
  const q = ([lon, lat]: number[]) => [Math.round(((lon - origin[0]) * kx) / scale), Math.round(((lat - origin[1]) * ky) / scale)];

  const strings: (string | null)[] = [null], kinds: (string | null)[] = [null];
  const si = new Map<string, number>(), ki = new Map<string, number>();
  const str = (v: string | null | undefined) => { if (!v) return 0; if (!si.has(v)) { si.set(v, strings.length); strings.push(v); } return si.get(v)!; };
  const kind = (v: string | null | undefined) => { if (!v) return 0; if (!ki.has(v)) { ki.set(v, kinds.length); kinds.push(v); } return ki.get(v)!; };

  const ring: number[] = [0], bld: number[] = [0], xy: number[] = [];
  const col: Record<Exclude<Name, 'ring' | 'bld' | 'xy'>, number[]> = { id: [], height: [], name: [], addr: [], street: [], levels: [], kind: [], flags: [] };
  for (const f of fs) {
    for (const r of rings(f)) {
      const pts = r.slice(0, -1).map(q); // без замыкающей точки
      pts.forEach(([x, y], i) => { const [px, py] = i ? pts[i - 1] : [0, 0]; xy.push(x - px, y - py); });
      ring.push(ring.at(-1)! + pts.length);
    }
    bld.push(ring.length - 1);
    const p = f.properties;
    col.id.push(p.id);
    col.height.push(p.height ? Math.min(65535, Math.round(p.height * 10)) : 0);
    col.name.push(str(p.name)); col.addr.push(str(p.addr)); col.street.push(str(p.street));
    col.levels.push(p.levels ? Math.min(255, Math.round(p.levels)) : 0);
    col.kind.push(kind(p.building));
    col.flags.push(f.geometry.type === 'MultiPolygon' ? 1 : 0);
  }
  if (xy.some((v) => v < -32768 || v > 32767)) throw new Error('координата не влезла в Int16 — увеличьте scale');
  if (strings.length > 65535 || kinds.length > 255) throw new Error('слишком много строк или типов');

  const arrays: Record<Name, ArrayLike<number>> = { ring, bld, xy, ...col };
  const sections = {} as Record<string, Section>;
  let size = 0;
  for (const k of Object.keys(TYPES) as Name[]) { size = Math.ceil(size / 4) * 4; sections[k] = [size, arrays[k].length]; size += arrays[k].length * TYPES[k].BYTES_PER_ELEMENT; }
  const buf = new Uint8Array(size);
  for (const k of Object.keys(TYPES) as Name[]) new TYPES[k](buf.buffer, sections[k][0], sections[k][1]).set(arrays[k]);
  return { meta: { version: 1, n: fs.length, origin, scale, kx, ky, strings, kinds, sections, source: geojson.source, fetched: geojson.fetched }, buf };
}

const rings = (f: any): number[][][] => (f.geometry.type === 'Polygon' ? [f.geometry.coordinates[0]] : f.geometry.coordinates.map((p: any) => p[0]));

export function unpackBuildings(meta: BuildingsMeta, buf: ArrayBuffer): any {
  const a = Object.fromEntries((Object.keys(TYPES) as Name[]).map((k) => [k, new TYPES[k](buf, ...meta.sections[k])])) as { [K in Name]: InstanceType<(typeof TYPES)[K]> };
  const { origin: [lon0, lat0], scale, kx, ky, strings, kinds } = meta;
  const features = new Array(meta.n);
  for (let i = 0; i < meta.n; i++) {
    const rs: number[][][] = [];
    for (let r = a.bld[i]; r < a.bld[i + 1]; r++) {
      const pts: number[][] = [];
      let x = 0, y = 0;
      for (let v = a.ring[r]; v < a.ring[r + 1]; v++) {
        x += a.xy[2 * v]; y += a.xy[2 * v + 1];
        pts.push([+(lon0 + (x * scale) / kx).toFixed(7), +(lat0 + (y * scale) / ky).toFixed(7)]);
      }
      pts.push(pts[0]);
      rs.push(pts);
    }
    const id = a.id[i];
    features[i] = {
      type: 'Feature', id,
      properties: { id, levels: a.levels[i] || null, height: a.height[i] ? a.height[i] / 10 : null, name: strings[a.name[i]], addr: strings[a.addr[i]], street: strings[a.street[i]], building: kinds[a.kind[i]] },
      geometry: a.flags[i] & 1 ? { type: 'MultiPolygon', coordinates: rs.map((r) => [r]) } : { type: 'Polygon', coordinates: [rs[0]] },
    };
  }
  return { type: 'FeatureCollection', features };
}
