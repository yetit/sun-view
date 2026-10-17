// Данные города грузятся fetch'ем по URL ассетов (в бандл JS они не попадают):
// buildings.bin + .meta.json (src/scripts/buildings-bin.ts), canopy.bin + .json, dem.bin + .json, precomputed.bin + .json, climate.json.
import { unpackBuildings, type BuildingsMeta } from './buildings-bin.ts';
import { makeCanopy, type Canopy } from './grid.ts';

const urls = import.meta.glob<string>('../../data/*/{buildings.bin,buildings.meta.json,canopy.bin,canopy.json,dem.bin,dem.json,precomputed.bin,precomputed.json,climate.json,levels.json}', { query: '?url', import: 'default' });

// precomputed — карты солнца/моря для всех зданий из scripts/precompute.ts (если есть);
// sunshine — вероятность прямого солнца по месяцам из scripts/fetch-climate.mjs (если есть).
export type CityData = {
  geojson: any; bldMeta: BuildingsMeta; bldBuf: ArrayBuffer; canopy: Canopy | null; demMeta: any; demBuf: ArrayBuffer; precomputed: Map<string, Uint8Array> | null; sunshine: number[] | null;
};

export const hasData = (id: string) => `../../data/${id}/buildings.bin` in urls;

export async function loadCityData(id: string): Promise<CityData> {
  const get = async (name: string) => { const u = urls[`../../data/${id}/${name}`]; return u ? fetch(await u()) : null; };
  const json = (name: string) => get(name).then((r) => r?.json() ?? null);
  const bin = (name: string) => get(name).then((r) => r?.arrayBuffer() ?? null);
  const [bldMeta, bldBuf, canMeta, canBuf, demMeta, demBuf, preMeta, preBuf, climate] = await Promise.all([
    json('buildings.meta.json'), bin('buildings.bin'), json('canopy.json'), bin('canopy.bin'), json('dem.json'), bin('dem.bin'), json('precomputed.json'), bin('precomputed.bin'), json('climate.json'),
  ]);
  const geojson = unpackBuildings(bldMeta, bldBuf!);
  let precomputed: Map<string, Uint8Array> | null = null;
  if (preMeta && preBuf && preMeta.buildings === bldMeta.n) {
    const n = preMeta.buildings;
    precomputed = new Map(preMeta.layers.map((k: string, i: number) => [k, new Uint8Array(preBuf, i * n, n)]));
  } else if (preMeta) console.warn(`${id}: предрасчёт на ${preMeta.buildings} зданий, а в данных ${bldMeta.n} — считаем в воркере`);
  return { geojson, bldMeta, bldBuf: bldBuf!, canopy: canMeta && canBuf ? makeCanopy(canMeta, canBuf) : null, demMeta, demBuf: demBuf!, precomputed, sunshine: climate?.sunshine ?? null };
}

// Где не хватает этажности (scripts/levels-todo.mjs): OSM id → [соседей с изменившимся ответом,
// часы зимнего солнца × 10, направлений с морем]. По id, а не по номеру — переживает обновление данных.
let levels: Promise<Map<number, number[]>> | null = null;
export function loadLevels(id: string) {
  levels ??= (async () => {
    const u = urls[`../../data/${id}/levels.json`];
    if (!u) return new Map();
    const j = await (await fetch(await u())).json();
    return new Map(j.items.map(([osm, ...rest]: number[]) => [osm, rest]));
  })();
  return levels;
}
