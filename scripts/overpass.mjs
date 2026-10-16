// Запрос к Overpass с повтором по зеркалам: публичные серверы часто отвечают 5xx.
const MIRRORS = [process.env.OVERPASS, 'https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'].filter(Boolean);

export async function overpass(query) {
  let err;
  for (const url of MIRRORS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch(url, { method: 'POST', headers: { 'User-Agent': 'sun-view/0.1', Accept: 'application/json' }, body: new URLSearchParams({ data: query }) });
      if (res.ok) return (await res.json()).elements;
      err = new Error(`Overpass ${res.status} (${url}): ${(await res.text()).slice(0, 200)}`);
      console.warn(err.message);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  throw err;
}

export const bboxStr = ({ south, west, north, east }) => `${south},${west},${north},${east}`;
export const ring = (geom) => geom.map((p) => [+p.lon.toFixed(6), +p.lat.toFixed(6)]);
