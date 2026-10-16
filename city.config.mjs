// Единственное место, где описан город. Чтобы сменить Тиват на другой город:
// поправить этот файл, запустить `npm run fetch` — данные лягут в data/<id>/.
export default {
  id: 'tivat',
  name: 'Тиват',
  // Где лежат здания (bbox для Overpass). Небольшой: расчёт теней идёт по этой сетке.
  bbox: { south: 42.395, west: 18.66, north: 42.455, east: 18.725 },
  // Рельеф берём шире зданий: горы вокруг бухты закрывают низкое солнце за километры.
  dem: {
    source: 'copernicus-glo30', // Copernicus DEM GLO-30, AWS Open Data (без регистрации)
    bbox: { south: 42.35, west: 18.58, north: 42.5, east: 18.8 },
    step: 2, // угловых секунд на ячейку (2" ≈ 60 м); исходник — 1"
  },
  timezone: 'Europe/Podgorica',
  camera: { center: [18.695, 42.43], zoom: 14.5, pitch: 60, bearing: -20 },
  floorHeight: 3, // м на этаж
};
