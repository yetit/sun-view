// Сравнение до четырёх квартир: часы солнца по сезонам, годовая оценка, направления с морем.
import type { Season } from '../analysis.ts';
import { $, $$, fmtH } from '../app.ts';
import type { Bld } from '../grid.ts';
import { buildingName, t } from '../i18n.ts';

export type Pin = { b: Bld; floor: number; side: number | null; label: string; seasons: Season[]; bre: number | null; sea: number };
const pins: Pin[] = [];
let onPick: (p: Pin) => void = () => {};

export function initCompare(pick: (p: Pin) => void) { onPick = pick; }

export function addPin(p: Pin) {
  if (pins.length >= 4) return;
  pins.push(p);
  renderPins();
}

function renderPins() {
  $('.compare').hidden = !pins.length;
  $('.pin-btn').toggleAttribute('disabled', pins.length >= 4);
  $('.compare-rows').innerHTML = pins.map((p, i) =>
    `<tr><td><button type="button" class="link" data-i="${i}">${buildingName(p.b)}</button><small>${p.floor} ${t.fl} · ${p.label}</small></td>${p.seasons.map((s) => `<td>${fmtH.format(s.sun)}</td>`).join('')}<td>${p.bre ?? '—'}</td><td>${p.sea}/8</td><td><button type="button" class="x" data-i="${i}" aria-label="${t.remove}">×</button></td></tr>`,
  ).join('');
  $$('.compare .link').forEach((el) => el.addEventListener('click', () => onPick(pins[+el.dataset.i!])));
  $$('.compare .x').forEach((el) => el.addEventListener('click', () => { pins.splice(+el.dataset.i!, 1); renderPins(); }));
}
