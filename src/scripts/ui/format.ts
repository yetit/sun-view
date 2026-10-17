// Подписи фасадов и ссылки, общие для панели, матрицы и сравнения.
import { dirBearing, dirIndex } from '../analysis.ts';
import { facadeOf, world } from '../app.ts';
import { facades, nearestFacade, type Bld, type Facade } from '../grid.ts';
import { t } from '../i18n.ts';

export const deg = (f: Facade) => Math.round((f.normal * 180) / Math.PI) % 360;
export const fName = (f: Facade) => `${t.dirs[dirIndex(f.normal)]}, ${deg(f)}°`;
export const fTitle = (f: Facade) => t.facade(t.dirs[dirIndex(f.normal)], deg(f), Math.round(f.len));
export const sideLabel = () => t.sideLabel(facadeOf() ? fName(facadeOf()!) : null);
// Фасад по румбу 0..7 (старые ссылки, примеры) — ближайший по нормали; null — здание целиком.
export const facadeByDir = (b: Bld, d: number | null) => (d == null ? null : nearestFacade(facades(world, b), dirBearing(d)));
export const osmUrl = (b: Bld) => `https://www.openstreetmap.org/${b.osmType}/${b.id}`;
