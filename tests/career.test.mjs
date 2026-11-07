// Run with: NFSU2_GAMEDATA=/path/to/GLOBAL/GlobalB.lzc node --test tests/*.test.mjs
// The career tests need the real game data (not in the repository) and are skipped without it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../js/visual-editor.js');
require('../js/career.js');
const V = globalThis.NFSU2Visual, C = globalThis.NFSU2Career;
const save = (name) => new Uint8Array(readFileSync(new URL(`../assets/${name}`, import.meta.url)));
const gameData = process.env.NFSU2_GAMEDATA;
const skip = !gameData || !existsSync(gameData) ? 'set NFSU2_GAMEDATA to GLOBAL/GlobalB.lzc or GLOBALB.BUN' : false;
const db = () => {
  let bytes = new Uint8Array(readFileSync(gameData));
  if (bytes[0] === 0x4a && bytes[1] === 0x44) bytes = V.decompressJdlz(bytes);
  return C.parseCareerDatabase(bytes);
};
const locked = (report) => [...report.shops, ...report.parts, ...report.cars].filter((x) => x.reason);

test('career database has the main career goals', { skip }, () => {
  const d = db();
  assert.equal(d.events.size, 224);
  assert.equal(d.photos.length, 30);
  assert.equal(d.stages.length, 6);
  assert.equal(d.shops.length, 22);
  assert.equal(d.parts.length, 258);
});

test('completing a 0% save reaches 100% with nothing left locked', { skip }, () => {
  const d = db(), before = save('DEMO');
  const start = C.careerReport(before, d);
  assert.ok(start.percent < 5 && locked(start).length > 0 && start.lockedSlots.length === 4);
  const after = C.completeGame(before, d);
  const report = C.careerReport(after, d);
  assert.equal(report.percent, 100);
  assert.equal(report.photos, 30);
  assert.equal(report.stages, 6);
  assert.equal(report.stage, 6);
  assert.deepEqual(locked(report), []);
  assert.deepEqual(report.lockedSlots, []);
  // Only career records, the stage, the event table and the four slot lock bytes change.
  const allowed = [[0x9962, 0xa16a], [0xa175, 0xa179], [0xa179, 0xad7d]];
  const locks = [1, 2, 3, 4].map((i) => 0x5870 + i * 0x7f2 + C.SLOT_LOCK_REL);
  for (let i = 0; i < before.length; i++) {
    if (before[i] === after[i]) continue;
    assert.ok(allowed.some(([a, b]) => i >= a && i < b) || locks.includes(i), `unexpected change at 0x${i.toString(16)}`);
  }
  assert.deepEqual(C.completeGame(after, d), after, 'idempotent');
});

test('an already complete save is left byte-identical', { skip }, () => {
  const d = db(), jane = save('JANE');
  assert.equal(C.careerReport(jane, d).percent, 100);
  assert.deepEqual(C.completeGame(jane, d), jane);
});

test('after owning every part, each bought-part index the game uses is set', { skip }, () => {
  let bytes = new Uint8Array(readFileSync(gameData));
  if (bytes[0] === 0x4a && bytes[1] === 0x44) bytes = V.decompressJdlz(bytes);
  const cat = V.parseGameData(bytes), demo = save('DEMO'), base = 0x5870, sub = base + V.PURCHASED_REL, dv = new DataView(demo.buffer);
  V.ownAllParts(demo, base);
  const car = V.readCarHash(demo, base);
  // Slot -> ownership field (serialized offset, bits): the special bitsets, else the career item's mask.
  const special = { 7: 0x26c, 9: 0x298, 12: 0x27c, 29: 0x16c, 32: 0x28c, 162: 0x3b0 };
  const item = { 1: 18, 2: 17, 6: 22, 11: 16, 14: 15, 15: 14, 16: 21, 34: 30, 153: 32, 154: 25, 155: 26, 156: 27, 157: 28, 159: 24, 160: 35, 161: 36, 163: 23 };
  for (const slot of [...Object.keys(special), ...Object.keys(item)].map(Number)) {
    const area = sub + (special[slot] ?? item[slot] * 4);
    for (const part of cat.options(car, slot)) {
      if (part.level === 0) continue;
      const n = cat.options(car, slot).filter((p) => p.group === part.group).indexOf(part);
      assert.ok((dv.getUint32(area + (n >> 5) * 4, true) >>> (n & 31)) & 1, `slot ${slot} ${part.name}`);
    }
  }
});

test('the bundle carries the save-safety patches', () => {
  const bundle = readFileSync(new URL('../js/app.bundle.min.js', import.meta.url), 'utf8');
  assert.match(bundle, /'STAGE':0xa175,/, 'stage display reads the real career stage');
  assert.match(bundle, /\(_0x569c05=0x1\)\{return;/, 'slot edits never raise the career stage');
  assert.doesNotMatch(bundle, /<0x5&&\(this\['workingBytes'\]\[_0x376147/, '"Enable All 5 Slots" does not set stage 5');
  assert.match(bundle, /'DEFAULT_USED_SLOT_HEADER_HEX':'38 39 26 3D 3E 96 AC A5/, 'stock tint/neon defaults');
  assert.match(bundle, /globalThis\.NFSU2Bridge=/, 'bridge for js/visual-editor.js and js/career.js');
});
