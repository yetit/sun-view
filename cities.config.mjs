// Все города — здесь. Добавить город: описать его, запустить `npm run fetch -- <id>` —
// данные лягут в data/<id>/, приложение подхватит их по ?c=<id>.
const common = { timezone: 'Europe/Podgorica', floorHeight: 3, treeHeight: 10 };

export const cities = [
  {
    ...common,
    id: 'tivat',
    name: 'Тиват',
    // Где лежат здания (bbox для Overpass). Небольшой: расчёт теней идёт по этой сетке.
    bbox: { south: 42.395, west: 18.66, north: 42.455, east: 18.725 },
    // Рельеф берём шире зданий: горы вокруг бухты закрывают низкое солнце за километры.
    dem: { bbox: { south: 42.35, west: 18.58, north: 42.5, east: 18.8 }, step: 2 }, // угл. секунд на ячейку (2" ≈ 60 м)
    camera: { center: [18.695, 42.43], zoom: 14.5, pitch: 60, bearing: -20 },
  },
  {
    ...common,
    id: 'kotor',
    name: 'Котор',
    bbox: { south: 42.4, west: 18.74, north: 42.47, east: 18.8 },
    dem: { bbox: { south: 42.36, west: 18.68, north: 42.52, east: 18.9 }, step: 2 },
    camera: { center: [18.768, 42.43], zoom: 14.3, pitch: 60, bearing: -35 },
  },
];

export const getCity = (id) => cities.find((c) => c.id === id) ?? cities[0];
export default cities;
