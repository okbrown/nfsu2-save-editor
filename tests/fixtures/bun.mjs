// Synthetic GLOBALB.BUN for tests: the real file is game data and is not in the repository.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../js/visual-editor.js');
const V = globalThis.NFSU2Visual;

export const CAR = V.gameHash('240SX');
const PAINT_GLOSS = 0x2daab07, PAINT_RIM = 0xda27;

/** Minimal GLOBALB.BUN: car table plus the visual database chunks the reader needs. */
export function buildBun(parts, cars = ['240SX', '350Z']) {
  const chunk = (id, payload) => {
    const out = new Uint8Array(8 + payload.length), dv = new DataView(out.buffer);
    dv.setUint32(0, id >>> 0, true);
    dv.setUint32(4, payload.length, true);
    out.set(payload, 8);
    return out;
  };
  const concat = (arrays) => {
    const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
    let o = 0;
    for (const a of arrays) { out.set(a, o); o += a.length; }
    return out;
  };
  const carTable = new Uint8Array(cars.length * 0x890);
  cars.forEach((name, i) => {
    for (let k = 0; k < name.length; k++) carTable[i * 0x890 + k] = name.charCodeAt(k);
    new DataView(carTable.buffer).setUint32(i * 0x890 + 0xd0, V.gameHash(name), true);
  });
  const groups = [...new Set(parts.map((p) => p.group))];
  let strings = [], stringLen = 0;
  const attrRecords = [], lists = [0];
  const descriptors = new Uint8Array(parts.length * 14), dd = new DataView(descriptors.buffer);
  parts.forEach((p, i) => {
    const nameIndex = stringLen / 4;
    const bytes = new Uint8Array(Math.ceil((p.name.length + 1) / 4) * 4);
    for (let k = 0; k < p.name.length; k++) bytes[k] = p.name.charCodeAt(k);
    strings.push(bytes);
    stringLen += bytes.length;
    let list = 0xffff;
    const attrs = Object.entries(p.attrs || {});
    if (attrs.length) {
      list = lists.length;
      lists.push(attrs.length);
      for (const [key, value] of attrs) {
        lists.push(attrRecords.length);
        attrRecords.push([/^\d+$/.test(key) ? Number(key) : V.gameHash(key), value]);
      }
    }
    dd.setUint32(i * 14, V.gameHash(p.name), true);
    descriptors[i * 14 + 4] = p.type;
    descriptors[i * 14 + 5] = ((p.level || 0) << 5) | (p.variant || 0);
    descriptors[i * 14 + 7] = groups.indexOf(p.group);
    dd.setUint16(i * 14 + 8, nameIndex, true);
    dd.setUint16(i * 14 + 10, list, true);
  });
  const header = new Uint8Array(60);
  new DataView(header.buffer).setUint32(56, parts.length, true);
  const attrBytes = new Uint8Array(attrRecords.length * 8);
  attrRecords.forEach(([k, v], i) => {
    new DataView(attrBytes.buffer).setUint32(i * 8, k >>> 0, true);
    new DataView(attrBytes.buffer).setUint32(i * 8 + 4, v >>> 0, true);
  });
  const listBytes = new Uint8Array(lists.length * 2);
  lists.forEach((v, i) => new DataView(listBytes.buffer).setUint16(i * 2, v, true));
  const groupBytes = new Uint8Array(groups.length * 4);
  groups.forEach((g, i) => new DataView(groupBytes.buffer).setUint32(i * 4, g >>> 0, true));
  // Every slot searches the car's own group first, then the shared PAINT group.
  const tables = new Uint8Array(170 * 8), td = new DataView(tables.buffer);
  for (let s = 0; s < 170; s++) {
    td.setUint32(s * 8, 0xffffffff, true);
    td.setUint32(s * 8 + 4, V.gameHash('PAINT'), true);
  }
  const visualDb = concat([
    chunk(0x34603, header), chunk(0x34604, descriptors), chunk(0x34605, attrBytes),
    chunk(0x34606, concat(strings)), chunk(0x34607, tables), chunk(0x3460b, groupBytes), chunk(0x3460c, listBytes),
  ]);
  return concat([chunk(0x34600, carTable), chunk(0x80034602, visualDb)]);
}


/** Parts whose names hash to the values installed in assets/JANE garage slot 1 (a 240SX), plus alternatives. */
export const PARTS = [
  { name: '240SX_KIT00_FRONT_BUMPER', type: 1, level: 0, group: CAR },
  { name: '240SX_KIT09_FRONT_BUMPER', type: 1, level: 2, group: CAR },
  { name: '240SX_KIT10_REAR_BUMPER', type: 2, level: 2, group: CAR },
  { name: '240SX_KIT13_SKIRT', type: 11, level: 3, group: CAR },
  { name: '240SX_STYLE01_SPOILER', type: 12, level: 1, group: CAR },
  { name: '240SX_STYLE02_SPOILER', type: 12, level: 3, group: CAR },
  { name: '240SX_KITW01_BODY', type: 6, level: 1, variant: 1, group: CAR },
  { name: '240SX_STYLE18_HOOD', type: 9, level: 1, group: CAR },
  { name: 'WHEEL_STYLE01', type: 28, level: 0, group: CAR },
  { name: 'WHEEL_STYLE02', type: 28, level: 1, group: CAR },
  { name: 'GLOSS_L2_COLOR17', type: 48, group: V.gameHash('PAINT'), attrs: { 3954196070: PAINT_GLOSS, RED: 200, GREEN: 10, BLUE: 10 } },
  { name: 'PEARL1_PAINT', type: 48, group: V.gameHash('PAINT'), attrs: { 3954196070: PAINT_GLOSS, RED: 240, GREEN: 240, BLUE: 255 } },
  { name: 'RIM_L1_COLOR01', type: 48, group: V.gameHash('PAINT'), attrs: { 3954196070: PAINT_RIM, RED: 20, GREEN: 20, BLUE: 20 } },
];

