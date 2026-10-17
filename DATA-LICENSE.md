# Data licences / Лицензии данных

The code in this repository is under the MIT licence ([LICENSE](LICENSE)). The data is not: it comes from third parties and keeps their terms.

Код в репозитории — под лицензией MIT ([LICENSE](LICENSE)). Данные — нет: они взяты у третьих сторон и остаются под их условиями.

| Path | Derived from | Licence and attribution |
| --- | --- | --- |
| `data/<city>/buildings.json`, `buildings.bin`, `buildings.meta.json` | OpenStreetMap via Overpass API | [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/), © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) |
| `data/<city>/precomputed.*`, `data/<city>/levels.json`, `docs/levels-todo/*` | computed from the OSM buildings above and the terrain and tree heights below | ODbL 1.0 (a derivative database of OpenStreetMap), © OpenStreetMap contributors; terrain and tree heights as below |
| `data/<city>/dem.bin`, `dem.json` | Copernicus DEM GLO-30, resampled to 2″; sea cells set from the OSM coastline | Produced using Copernicus WorldDEM-30 © DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018, provided under COPERNICUS by the European Union and ESA; all rights reserved. Used under the [Copernicus DEM licence](https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM) (GLO-30 Public, accessed from the [AWS Open Data registry](https://registry.opendata.aws/copernicus-dem/)). Sea mask: ODbL 1.0, © OpenStreetMap contributors |
| `data/<city>/canopy.bin`, `canopy.json` | High Resolution Canopy Height Maps by WRI and Meta (Tolan et al., 2024), median per ~6 m cell; leaf type from Copernicus HRL Dominant Leaf Type 2018 | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), © Meta and World Resources Institute; [AWS Open Data registry](https://registry.opendata.aws/dataforgood-fb-forests/). Leaf type © European Union, Copernicus Land Monitoring Service, free and open with attribution |
| `data/<city>/climate.json` | share of daytime hours with direct normal irradiance ≥ 120 W/m², PVGIS-SARAH3 hourly series 2014–2023 | PVGIS © European Union, JRC, reuse with attribution |
| `docs/horizon-check.md` | comparison with PVGIS and Kartverket DTM | PVGIS © European Union, JRC, reuse with attribution; Kartverket DTM 1 m © Kartverket, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `public/og.png`, `public/og-method.png`, `docs/screenshot.png`, `docs/demo.gif` | screenshots of the map | map data © OpenStreetMap contributors (ODbL), basemap © [OpenMapTiles](https://www.openmaptiles.org/) via [OpenFreeMap](https://openfreemap.org), display terrain [Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) |

At runtime the site also uses the OpenFreeMap basemap, AWS Terrain Tiles and Photon address search; their attribution is shown on the map.

Under ODbL, if you publish a database derived from these files, you must offer it under ODbL too and keep the OpenStreetMap attribution. Images and other "produced works" only need the attribution.

По ODbL производную базу данных из этих файлов нужно публиковать тоже под ODbL и с атрибуцией OpenStreetMap. Для картинок и других «созданных произведений» достаточно атрибуции.
