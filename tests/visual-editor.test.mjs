// Run with: node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { buildBun, CAR, PARTS } from './fixtures/bun.mjs';

const require = createRequire(import.meta.url);
require('../js/rim-data.js');
require('../js/visual-editor.js');
const V = globalThis.NFSU2Visual;
const jane = () => new Uint8Array(readFileSync(new URL('../assets/JANE', import.meta.url)));
const demo = () => new Uint8Array(readFileSync(new URL('../assets/DEMO', import.meta.url)));

const GARAGE_BASE = 0x5870, STRIDE = 0x7f2;

function changed(a, b) {
  return Array.from(a.keys()).filter((i) => a[i] !== b[i]);
}

test('gameHash matches the hashes stored in real saves', () => {
  assert.equal(V.gameHash('350Z'), 0x000ac6d1);
  assert.equal(V.gameHash('240SX_KIT09_FRONT_BUMPER'), 0x717374a2);
  assert.equal(V.gameHash('PEARL1_PAINT'), 0x080d805f);
  assert.equal(V.gameHash('WINDOW_TINT_STOCK'), 0x3d263938);
  assert.equal(V.gameHash('NEON_NONE'), 0xa5ac963e);
});

test('JANE garage slot 1 visual hashes resolve to the 240SX parts', () => {
  const refs = V.readVisual(jane(), GARAGE_BASE);
  assert.equal(V.readCarHash(jane(), GARAGE_BASE), CAR);
  assert.equal(refs[1], V.gameHash('240SX_KIT09_FRONT_BUMPER'));
  assert.equal(refs[2], V.gameHash('240SX_KIT10_REAR_BUMPER'));
  assert.equal(refs[9], V.gameHash('240SX_STYLE18_HOOD'));
  assert.equal(refs[11], V.gameHash('240SX_KIT13_SKIRT'));
  assert.equal(refs[63], V.gameHash('PEARL1_PAINT'));
});

test('Quick Race custom cars are found only when listed (handle and enable flag set)', () => {
  const janeCars = V.listCustomCars(jane()).map((c) => c.car);
  assert.deepEqual(janeCars, ['350Z', 'TIBURON', 'CELICA', 'SUPRA', 'G35', 'RX8'].map(V.gameHash));
  // DEMO record 0 carries a car but no handle, so the game does not list it.
  assert.deepEqual(V.listCustomCars(demo()), []);
  assert.equal(V.customCarBase(0), 0x04b0);
  assert.equal(V.customCarBase(19) + V.PERF_REL + 68, 0x04a8 + 20 * 0x430 - 0x430 + 0x35c);
});

test('the reader parses cars, parts, groups, levels, attributes and colours', () => {
  const cat = V.parseGameData(buildBun(PARTS));
  assert.equal(cat.parts.length, PARTS.length);
  assert.equal(cat.carName(CAR), '240SX');
  const spoiler = cat.part(CAR, 12, V.gameHash('240SX_STYLE02_SPOILER'));
  assert.equal(spoiler.level, 3);
  assert.equal(cat.part(CAR, 63, V.gameHash('GLOSS_L2_COLOR17')).color, '#c80a0a');
  assert.throws(() => V.parseGameData(new Uint8Array(64)), /not GLOBAL/);
});

test('paint slots only offer their own paint category', () => {
  const cat = V.parseGameData(buildBun(PARTS));
  const body = cat.selectableOptions(CAR, 63).map((p) => p.name);
  const rims = cat.selectableOptions(CAR, 73).map((p) => p.name);
  assert.deepEqual(body, ['GLOSS_L2_COLOR17', 'PEARL1_PAINT']);
  assert.deepEqual(rims, ['RIM_L1_COLOR01']);
  assert.throws(() => cat.edit(jane(), GARAGE_BASE, 73, V.gameHash('PEARL1_PAINT')), /different paint category/);
});

test('changing the spoiler writes only its hash and the derived aero flags', () => {
  const cat = V.parseGameData(buildBun(PARTS));
  const before = jane(), after = before.slice();
  cat.edit(after, GARAGE_BASE, 12, V.gameHash('240SX_STYLE01_SPOILER'));
  assert.equal(V.readVisual(after, GARAGE_BASE)[12], V.gameHash('240SX_STYLE01_SPOILER'));
  const visual = GARAGE_BASE + V.VISUAL_REL + 12 * 4, flags = GARAGE_BASE + V.PERF_REL + 56;
  for (const i of changed(before, after)) {
    assert.ok((i >= visual && i < visual + 4) || (i >= flags && i < flags + 12), `unexpected byte 0x${i.toString(16)}`);
  }
  // Spoiler level 1 -> flag 65; front bumper level 2 -> 57; skirts level 3 -> 61; rear bumper level 2 -> 63.
  const set = Array.from(after.subarray(flags, flags + 12)).flatMap((v, i) => (v ? [56 + i] : []));
  assert.deepEqual(set, [57, 61, 63, 65]);
});

test('rims set both axles; incompatible parts are rejected; other slots stay untouched', () => {
  const cat = V.parseGameData(buildBun(PARTS));
  const save = jane();
  for (const slot of [0, 1, 2, 3, 4]) {
    const base = GARAGE_BASE + slot * STRIDE;
    if (V.readCarHash(save, base) !== CAR) continue;
    cat.edit(save, base, 29, V.gameHash('WHEEL_STYLE02'));
    const refs = V.readVisual(save, base);
    assert.equal(refs[29], V.gameHash('WHEEL_STYLE02'));
    assert.equal(refs[30], V.gameHash('WHEEL_STYLE02'));
  }
  assert.throws(() => cat.edit(jane(), GARAGE_BASE, 12, V.gameHash('240SX_KIT09_FRONT_BUMPER')), /not compatible/);
  assert.throws(() => cat.edit(jane(), GARAGE_BASE, 25, 0), /not editable/);
});

test('a widebody kit hides the bumpers and sets the level-3 aero flags', () => {
  const cat = V.parseGameData(buildBun(PARTS));
  const save = jane();
  cat.edit(save, GARAGE_BASE, 6, V.gameHash('240SX_KITW01_BODY'));
  const refs = V.readVisual(save, GARAGE_BASE);
  assert.ok(cat.hidden(refs, CAR, 1));
  assert.throws(() => cat.edit(save, GARAGE_BASE, 1, V.gameHash('240SX_KIT00_FRONT_BUMPER')), /hidden/);
  const flags = save.subarray(GARAGE_BASE + V.PERF_REL + 56, GARAGE_BASE + V.PERF_REL + 68);
  assert.deepEqual(Array.from(flags), [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
});

test('custom-car edits stay inside their 0x430-byte record', () => {
  const cat = V.parseGameData(buildBun([...PARTS, { name: '350Z_STYLE01_SPOILER', type: 12, level: 1, group: V.gameHash('350Z') }]));
  const before = jane(), after = before.slice();
  const [first] = V.listCustomCars(after);
  cat.edit(after, first.base, 12, V.gameHash('350Z_STYLE01_SPOILER'));
  const start = 0x04a8 + first.index * 0x430, end = start + 0x430;
  const diff = changed(before, after);
  assert.ok(diff.length > 0);
  assert.ok(diff.every((i) => i >= start && i < end));
});

test('JDLZ (GlobalB.lzc) literals and back-references decompress', () => {
  const payload = [0x08, 0x01, 0x41, 0x42, 0x43, 0x02, 0x03]; // ABC, then copy 6 bytes from 3 back
  const file = new Uint8Array(16 + payload.length), dv = new DataView(file.buffer);
  file.set([0x4a, 0x44, 0x4c, 0x5a, 0x02, 0x10]);
  dv.setUint32(8, 9, true);
  dv.setUint32(12, file.length, true);
  file.set(payload, 16);
  assert.equal(new TextDecoder().decode(V.decompressJdlz(file)), 'ABCABCABC');
  dv.setUint32(8, 20, true);
  assert.throws(() => V.decompressJdlz(file), /Truncated JDLZ/);
});

test('the game\'s empty value is only allowed where the game itself stores 0', () => {
  const cat = V.parseGameData(buildBun(PARTS));
  for (const slot of [31, 64, 67, 68, 73, 76, 105, 152]) assert.ok(V.isNoneSlot(slot), `slot ${slot}`);
  for (const slot of [1, 6, 12, 29, 63, 77, 153, 154, 161, 163, 164]) assert.ok(!V.isNoneSlot(slot), `slot ${slot}`);
  assert.throws(() => cat.edit(jane(), GARAGE_BASE, 12, 0), /no empty value/);
  const save = jane();
  cat.edit(save, GARAGE_BASE, 73, 0);
  assert.equal(V.readVisual(save, GARAGE_BASE)[73], 0);
});

test('stock values follow what the game gives a new car', () => {
  const cat = V.parseGameData(buildBun(PARTS));
  assert.equal(cat.stockValue(CAR, 1), V.gameHash('240SX_KIT00_FRONT_BUMPER'));
  assert.equal(cat.stockValue(CAR, 12), V.gameHash('240SX_STOCK_SPOILER'));
  assert.equal(cat.stockValue(CAR, 29), V.gameHash('WHEEL_STYLE01'));
  assert.equal(cat.stockValue(CAR, 63), V.gameHash('GLOSS_L2_COLOR17'), 'factory paint from the car record');
  assert.equal(cat.stockValue(CAR, 64), 0);
  assert.equal(cat.stockValue(CAR, 73), 0);
  assert.deepEqual([77, 78, 79, 80, 92].map((s) => cat.stockValue(CAR, s)),
    ['VINYL_L1_COLOR09', 'VINYL_L1_COLOR02', 'VINYL_L2_COLOR11', 'VINYL_L1_COLOR01', 'VINYL_L1_COLOR01'].map(V.gameHash));
  assert.equal(cat.stockValue(CAR, 6), null, 'no level-0 widebody in this catalogue');
});

test('reset to stock restores parts, paint and aero flags inside the record only', () => {
  const cat = V.parseGameData(buildBun(PARTS));
  const before = jane(), save = before.slice();
  const skipped = cat.resetToStock(save, GARAGE_BASE);
  const refs = V.readVisual(save, GARAGE_BASE);
  assert.equal(refs[1], V.gameHash('240SX_KIT00_FRONT_BUMPER'));
  assert.equal(refs[12], V.gameHash('240SX_STOCK_SPOILER'));
  assert.equal(refs[29], V.gameHash('WHEEL_STYLE01'));
  assert.equal(refs[30], V.gameHash('WHEEL_STYLE01'));
  assert.equal(refs[63], V.gameHash('GLOSS_L2_COLOR17'));
  assert.deepEqual([64, 65, 66, 67].map((s) => refs[s]), [0, 0, 0, 0]);
  // The synthetic catalogue has no level-0 widebody, rear bumper, hood or skirt.
  assert.deepEqual(skipped.sort((a, b) => a - b), [2, 6, 9, 11]);
  const flags = save.subarray(GARAGE_BASE + V.PERF_REL + 56, GARAGE_BASE + V.PERF_REL + 68);
  // Stock front bumper and spoiler drop their flags; the kept rear bumper (L2) and skirts (L3) keep theirs.
  assert.deepEqual(Array.from(flags).flatMap((v, i) => (v ? [56 + i] : [])), [61, 63]);
  const end = GARAGE_BASE + V.PERF_REL + 68;
  assert.ok(changed(before, save).every((i) => i >= GARAGE_BASE && i < end));
  // Group reset touches only its own slots.
  const partial = before.slice();
  cat.resetToStock(partial, GARAGE_BASE, [29]);
  assert.deepEqual(V.readVisual(partial, GARAGE_BASE).map((v, i) => (i === 29 || i === 30 ? 0 : v)),
    V.readVisual(before, GARAGE_BASE).map((v, i) => (i === 29 || i === 30 ? 0 : v)));
});

test('owning every part fills only the Body Parts Storage ownership fields', () => {
  const before = jane(), save = before.slice(), sub = GARAGE_BASE + V.PURCHASED_REL;
  assert.ok(!V.ownsAllParts(save, GARAGE_BASE));
  V.ownAllParts(save, GARAGE_BASE);
  assert.ok(V.ownsAllParts(save, GARAGE_BASE));
  const fields = [[14 * 4, 87 * 4], [0x16c, 0x16c + 256], [0x26c, 0x294], [0x298, 0x2a0], [0x3b0, 0x3c0]];
  for (const i of changed(before, save)) {
    assert.ok(fields.some(([a, b]) => i >= sub + a && i < sub + b), `unexpected change at 0x${i.toString(16)}`);
  }
  // Already-owned bits stay set; perf ownership (+0x15C) and the companion list are untouched.
  for (let i = 0; i < before.length; i++) assert.equal(save[i] & before[i], before[i]);
  assert.deepEqual(save.subarray(sub + 0x15c, sub + 0x16c), before.subarray(sub + 0x15c, sub + 0x16c));
  const again = save.slice();
  V.ownAllParts(again, GARAGE_BASE);
  assert.deepEqual(again, save);
});
