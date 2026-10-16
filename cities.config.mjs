// Все города — здесь. Добавить город: описать его, запустить `npm run fetch -- <id>` —
// данные лягут в data/<id>/, приложение подхватит их по ?c=<id>.
const common = { timezone: 'Europe/Podgorica', floorHeight: 3, treeHeight: 10 };

export const cities = [
  {
    ...common,
    id: 'tivat',
    name: 'Тиват',
    nameEn: 'Tivat',
    // Где лежат здания (bbox для Overpass). Небольшой: расчёт теней идёт по этой сетке.
    bbox: { south: 42.395, west: 18.66, north: 42.455, east: 18.725 },
    // Рельеф берём шире зданий, ~15 км во все стороны (±0.135° по широте, ±0.183° по долготе) —
    // до предела трассировки: горы вокруг бухты закрывают низкое солнце за километры.
    dem: { bbox: { south: 42.26, west: 18.477, north: 42.59, east: 18.908 }, step: 2 }, // угл. секунд на ячейку (2" ≈ 60 м)
    camera: { center: [18.695, 42.43], zoom: 14.5, pitch: 60, bearing: -20 },
    // Примеры подобраны по расчёту (scripts/precompute.ts печатает кандидатов): b — OSM id, f — этаж,
    // d — направление окон (0 = С … 7 = СЗ) или null, s — сезон (0 весна … 3 зима).
    examples: [
      { b: 1079696877, f: 6, d: null, s: 1, ru: 'Верхний этаж у моря', en: 'Top floor by the sea' },
      { b: 223248488, f: 2, d: null, s: 3, ru: 'Зимой — час солнца', en: 'One hour of winter sun' },
      { b: 193467133, f: 10, d: null, s: 3, ru: 'Солнце весь зимний день', en: 'Sun all winter day' },
    ],
  },
  {
    ...common,
    id: 'kotor',
    name: 'Котор',
    nameEn: 'Kotor',
    bbox: { south: 42.4, west: 18.74, north: 42.47, east: 18.8 },
    dem: { bbox: { south: 42.265, west: 18.557, north: 42.605, east: 18.983 }, step: 2 },
    camera: { center: [18.768, 42.43], zoom: 14.3, pitch: 60, bearing: -35 },
    examples: [
      { b: 224396499, f: 7, d: null, s: 1, ru: 'Верхний этаж у моря', en: 'Top floor by the sea' },
      { b: 305641952, f: 2, d: null, s: 3, ru: 'Зимой без прямого солнца', en: 'No direct winter sun' },
      { b: 270308497, f: 4, d: null, s: 3, ru: 'Вилла на склоне зимой', en: 'Hillside villa in winter' },
    ],
  },
];

export const getCity = (id) => cities.find((c) => c.id === id) ?? cities[0];
export default cities;
