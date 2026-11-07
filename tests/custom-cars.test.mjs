// Run with: node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../js/rim-data.js');
require('../js/visual-editor.js');
require('../js/custom-cars.js');
const V = globalThis.NFSU2Visual, CC = globalThis.NFSU2CustomCars;
const save = (name) => new Uint8Array(readFileSync(new URL(`../assets/${name}`, import.meta.url)));
const u32 = (b, o) => new DataView(b.buffer, b.byteOffset).getUint32(o, true);
const changedOutside = (a, b, start, end) => Array.from(a.keys()).filter((i) => a[i] !== b[i] && (i < start || i >= end));

test('custom car IDs are the game\'s TUNED_CAR_<index>', () => {
  const jane = save('JANE');
  const listed = CC.records(jane).filter((r) => r.listed);
  assert.equal(listed.length, 6);
  for (const r of listed) assert.equal(u32(jane, 0x4a8 + r.index * 0x430 + 4), CC.gameHash(`TUNED_CAR_${r.index}`));
});

test('copying a garage car into a custom car writes what the game does, inside that record only', () => {
  const before = save('JANE'), after = before.slice(), index = 6, rec = 0x4a8 + index * 0x430;
  const garage = 0x5870; // JANE slot 1, a 240SX
  CC.copyGarageCar(after, index, after, garage);
  assert.deepEqual(changedOutside(before, after, rec, rec + 0x430), []);
  assert.equal(u32(after, rec + 4), CC.gameHash('TUNED_CAR_6'));
  assert.deepEqual([u32(after, rec + 0xc), u32(after, rec + 0x10), after[rec + 0x14]], [1, 2, 1]);
  assert.deepEqual(after.subarray(rec + 0x15, rec + 0x14 + 0x418), before.subarray(garage + 0x0d, garage + 0x0c + 0x418));
  assert.equal(V.readCarHash(after, rec + 8), V.gameHash('240SX'));
  assert.ok(CC.records(after)[index].listed);
});

test('deleting a custom car clears it the way the game does', () => {
  const s = save('JANE'), rec = 0x4a8;
  CC.deleteCar(s, 0);
  assert.deepEqual([u32(s, rec), u32(s, rec + 4), u32(s, rec + 8), u32(s, rec + 0xc), u32(s, rec + 0x10)], [0, 0, 0, 0, 2]);
  assert.ok(s.subarray(rec + 0x14, rec + 0x14 + 0x418).every((b) => b === 0));
  assert.ok(!CC.records(s)[0].listed);
});

test('a preset becomes a custom car: car, look, header type 2, Extreme parts and uniques', () => {
  const before = save('JANE'), s = before.slice(), index = 0, rec = 0x4a8, base = rec + 8;
  const preset = { id: 't', name: 'Test 350Z', category: 'story', blocks: [
    { off: 0x5870, hex: Array.from({ length: 0xe0 }, (_, i) => (i === 0x04 || i === 0x0c ? '01' : i === 0x08 ? '04' : i >= 0x14 && i < 0x18 ? ['D1', 'C6', '0A', '00'][i - 0x14] : '00')).join(' ') },
    { off: 0xad80, hex: 'FF FF FF FF' }, // a world block: never written into the car
  ] };
  const tiers = { STOCK: { id: 'stock', partIds: [] }, STREET: { id: 'street', partIds: [0] }, PRO: { id: 'pro', partIds: [0, 1] }, EXTREME: { id: 'extreme', partIds: Array.from({ length: 40 }, (_, i) => i) } };
  CC.applyPreset(s, index, preset, { tiers });
  assert.equal(V.readCarHash(s, base), V.gameHash('350Z'));
  assert.equal(u32(s, rec + 0x10), 2, 'type stays custom, not the garage\'s 4');
  assert.equal(u32(s, rec + 4), CC.gameHash('TUNED_CAR_0'));
  assert.equal(CC.perfTierId(s, base, tiers), 'extreme');
  assert.ok(CC.uniques(s, base).every(Boolean));
  assert.deepEqual(changedOutside(before, s, rec, rec + 0x430), []);
});

test('perf tier, uniques and dyno presets edit only the custom record', () => {
  const before = save('JANE'), s = before.slice(), rec = 0x4a8 + 0x430 * 2, base = rec + 8;
  CC.setPerfTier(s, base, { partIds: [1, 2, 3] });
  CC.setUnique(s, base, 4, false);
  CC.applyDyno(s, base, { ecu: Array(9).fill(0x64), turbo: Array(9).fill(0x64) });
  assert.deepEqual(changedOutside(before, s, rec, rec + 0x430), []);
  assert.equal(CC.uniques(s, base)[4], false);
  assert.deepEqual(Array.from(s.subarray(base + 0x354 + 0x17, base + 0x354 + 0x17 + 9)), Array(9).fill(0x64));
});
