// Данные города грузятся fetch'ем по URL ассетов (в бандл JS они не попадают):
// buildings.bin + .meta.json (src/scripts/buildings-bin.ts), greenery.json, dem.bin + .json, precomputed.bin + .json.
import { unpackBuildings, type BuildingsMeta } from './buildings-bin.ts';

const urls = import.meta.glob<string>('../../data/*/{buildings.bin,buildings.meta.json,greenery.json,dem.bin,dem.json,precomputed.bin,precomputed.json}', { query: '?url', import: 'default' });

// precomputed — карты солнца/моря для всех зданий из scripts/precompute.ts (если есть).
export type CityData = {
  geojson: any; bldMeta: BuildingsMeta; bldBuf: ArrayBuffer; greenery: any | null; demMeta: any; demBuf: ArrayBuffer; precomputed: Map<string, Uint8Array> | null;
};

export const hasData = (id: string) => `../../data/${id}/buildings.bin` in urls;

export async function loadCityData(id: string): Promise<CityData> {
  const get = async (name: string) => { const u = urls[`../../data/${id}/${name}`]; return u ? fetch(await u()) : null; };
  const json = (name: string) => get(name).then((r) => r?.json() ?? null);
  const bin = (name: string) => get(name).then((r) => r?.arrayBuffer() ?? null);
  const [bldMeta, bldBuf, greenery, demMeta, demBuf, preMeta, preBuf] = await Promise.all([
    json('buildings.meta.json'), bin('buildings.bin'), json('greenery.json'), json('dem.json'), bin('dem.bin'), json('precomputed.json'), bin('precomputed.bin'),
  ]);
  const geojson = unpackBuildings(bldMeta, bldBuf!);
  let precomputed: Map<string, Uint8Array> | null = null;
  if (preMeta && preBuf && preMeta.buildings === bldMeta.n) {
    const n = preMeta.buildings;
    precomputed = new Map(preMeta.layers.map((k: string, i: number) => [k, new Uint8Array(preBuf, i * n, n)]));
  } else if (preMeta) console.warn(`${id}: предрасчёт на ${preMeta.buildings} зданий, а в данных ${bldMeta.n} — считаем в воркере`);
  return { geojson, bldMeta, bldBuf: bldBuf!, greenery, demMeta, demBuf: demBuf!, precomputed };
}
