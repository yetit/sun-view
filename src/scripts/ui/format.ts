// Подписи фасадов и ссылки, общие для панели, матрицы и сравнения. Без страницы — годится и для тестов в Node.
import { dirBearing, dirIndex } from '../analysis.ts';
import { facades, nearestFacade, type Bld, type Facade, type World } from '../grid.ts';
import { t } from '../i18n.ts';

export const deg = (f: Facade) => Math.round((f.normal * 180) / Math.PI) % 360;
export const fName = (f: Facade) => `${t.dirs[dirIndex(f.normal)]}, ${deg(f)}°`;
export const fTitle = (f: Facade) => t.facade(t.dirs[dirIndex(f.normal)], deg(f), Math.round(f.len));
// Фасад по румбу 0..7 (старые ссылки, примеры) — ближайший по нормали; null — здание целиком.
export const facadeByDir = (w: World, b: Bld, d: number | null) => (d == null ? null : nearestFacade(facades(w, b), dirBearing(d)));
export const osmUrl = (b: Bld) => `https://www.openstreetmap.org/${b.osmType}/${b.id}`;
// Редактор OSM (iD) сразу на этом доме — исправить этажность может сам пользователь.
export const osmEditUrl = (b: Bld) => `https://www.openstreetmap.org/edit?editor=id&${b.osmType}=${b.id}`;
