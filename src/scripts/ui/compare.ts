// Сравнение до четырёх квартир, в том числе из разных городов: часы солнца по сезонам, годовая оценка,
// направления с морем. Пины — готовые цифры с городом и домом, в localStorage (без него — только на этой странице).
import { $, $$, city, fmtH, params } from '../app.ts';
import { t } from '../i18n.ts';

export type Pin = { city: string; cityName: string; id: number; name: string; floor: number; side: number | null; label: string; sun: number[]; bre: number | null; sea: number };
const KEY = 'sv:pins';
let pins: Pin[] = [];
let onPick: (p: Pin) => void = () => {};

const save = () => { try { localStorage.setItem(KEY, JSON.stringify(pins)); } catch { /* без хранилища — только в этой вкладке */ } };

export function initCompare(pick: (p: Pin) => void) {
  onPick = pick;
  try { pins = JSON.parse(localStorage.getItem(KEY) ?? '[]').filter((p: Pin) => p && Array.isArray(p.sun)).slice(0, 4); } catch { pins = []; }
  renderPins();
}

export function addPin(p: Pin) {
  pins = pins.filter((x) => !(x.city === p.city && x.id === p.id && x.floor === p.floor && x.side === p.side)); // тот же этаж и фасад — обновить
  if (pins.length >= 4) return;
  pins.push(p);
  save();
  renderPins();
}

// Ссылка на квартиру из другого города: дом, этаж и фасад — как в ссылке «поделиться».
const href = (p: Pin) => `?c=${p.city}&b=${p.id}&f=${p.floor}${p.side != null ? `&d=f${p.side}` : ''}${params.get('lang') ? `&lang=${params.get('lang')}` : ''}`;

function renderPins() {
  $('.compare').hidden = !pins.length;
  $('.pin-btn').toggleAttribute('disabled', pins.length >= 4);
  const multi = new Set(pins.map((p) => p.city)).size > 1;
  $('.compare-rows').innerHTML = pins.map((p, i) => {
    const name = p.city === city.id ? `<button type="button" class="link" data-i="${i}">${p.name}</button>` : `<a class="link" href="${href(p)}">${p.name}</a>`;
    return `<tr><td>${name}<small>${multi ? `${p.cityName} · ` : ''}${p.floor} ${t.fl} · ${p.label}</small></td>${p.sun.map((s) => `<td>${fmtH.format(s)}</td>`).join('')}<td>${p.bre ?? '—'}</td><td>${p.sea}/8</td><td><button type="button" class="x" data-i="${i}" aria-label="${t.remove}">×</button></td></tr>`;
  }).join('');
  $$<HTMLButtonElement>('.compare button.link').forEach((el) => el.addEventListener('click', () => onPick(pins[+el.dataset.i!])));
  $$('.compare .x').forEach((el) => el.addEventListener('click', () => { pins.splice(+el.dataset.i!, 1); save(); renderPins(); }));
}
