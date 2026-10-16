// Данные города: data/<id>/{buildings,greenery,dem}.json + dem.bin, подхватываются по id.
const jsons = import.meta.glob<any>('../../data/*/*.json', { import: 'default' });
const bins = import.meta.glob<string>('../../data/*/*.bin', { query: '?url', import: 'default' });

export type CityData = { geojson: any; greenery: any | null; demMeta: any; demBuf: ArrayBuffer };

export const hasData = (id: string) => `../../data/${id}/buildings.json` in jsons;

export async function loadCityData(id: string): Promise<CityData> {
  const p = (name: string) => jsons[`../../data/${id}/${name}.json`];
  const [geojson, greenery, demMeta, binUrl] = await Promise.all([p('buildings')(), p('greenery')?.() ?? null, p('dem')(), bins[`../../data/${id}/dem.bin`]()]);
  const demBuf = await (await fetch(binUrl)).arrayBuffer();
  return { geojson, greenery, demMeta, demBuf };
}
