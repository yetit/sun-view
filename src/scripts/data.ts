// Данные города: data/<id>/{buildings,greenery,dem}.json + dem.bin, подхватываются по id.
const jsons = import.meta.glob<any>('../../data/*/*.json', { import: 'default' });
const bins = import.meta.glob<string>('../../data/*/*.bin', { query: '?url', import: 'default' });

// precomputed — карты солнца/моря для всех зданий из scripts/precompute.ts (если есть).
export type CityData = { geojson: any; greenery: any | null; demMeta: any; demBuf: ArrayBuffer; precomputed: Map<string, Uint8Array> | null };

export const hasData = (id: string) => `../../data/${id}/buildings.json` in jsons;

export async function loadCityData(id: string): Promise<CityData> {
  const p = (name: string) => jsons[`../../data/${id}/${name}.json`];
  const bin = (name: string) => bins[`../../data/${id}/${name}.bin`]?.().then((url) => fetch(url)).then((r) => r.arrayBuffer());
  const [geojson, greenery, demMeta, demBuf, preMeta, preBuf] = await Promise.all([
    p('buildings')(), p('greenery')?.() ?? null, p('dem')(), bin('dem'), p('precomputed')?.() ?? null, bin('precomputed') ?? null,
  ]);
  let precomputed: Map<string, Uint8Array> | null = null;
  if (preMeta && preBuf && preMeta.buildings === geojson.features.length) {
    const n = preMeta.buildings;
    precomputed = new Map(preMeta.layers.map((k: string, i: number) => [k, new Uint8Array(preBuf, i * n, n)]));
  } else if (preMeta) console.warn(`${id}: предрасчёт на ${preMeta.buildings} зданий, а в buildings.json ${geojson.features.length} — считаем в воркере`);
  return { geojson, greenery, demMeta, demBuf: demBuf!, precomputed };
}
