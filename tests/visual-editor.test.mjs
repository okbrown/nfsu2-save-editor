// Run with: node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { buildBun, CAR, PARTS } from './fixtures/bun.mjs';

const require = createRequire(import.meta.url);
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

test('unlocking rims sets one owned bit per aftermarket rim and nothing else', () => {
  const cat = V.parseGameData(buildBun(PARTS));
  // Compatible rims: WHEEL_STYLE01 (stock, never purchased) then WHEEL_STYLE02 -> bit 0.
  assert.deepEqual(V.rimBits(cat, CAR).map((r) => [r.bit, r.part.name]), [[0, 'WHEEL_STYLE02']]);
  const save = jane(), base = GARAGE_BASE;
  assert.equal(V.ownedRimCount(cat, save, base), 0);
  const untouched = save.slice();
  V.unlockAllRims(cat, save, base);
  assert.equal(V.ownedRimCount(cat, save, base), 1);
  const diff = changed(untouched, save);
  assert.ok(diff.every((i) => i >= base + V.OWNED_RIMS_REL && i < base + V.OWNED_RIMS_REL + 256));
  V.unlockAllRims(cat, save, base);
  assert.deepEqual(changed(untouched, save), diff, 'idempotent');
});
