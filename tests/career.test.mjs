// Run with: NFSU2_GAMEDATA=/path/to/GLOBAL/GlobalB.lzc node --test tests/*.test.mjs
// The career tests need the real game data (not in the repository) and are skipped without it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../js/rim-data.js');
require('../js/visual-editor.js');
require('../js/career-data.js');
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
      if (part.level === 0 || part.name === 'DUMMY') continue;
      if (slot === 29 && part.attributes.get(0xce7d8db5)?.[0] !== globalThis.NFSU2RimData.carClass[car]) continue;
      if (slot === 29 && cat.options(car, slot).filter((p) => p.group === part.group).indexOf(part) < 32) continue;
      const n = cat.options(car, slot).filter((p) => p.group === part.group).indexOf(part);
      assert.ok((dv.getUint32(area + (n >> 5) * 4, true) >>> (n & 31)) & 1, `slot ${slot} ${part.name}`);
    }
  }
});

test('Unlock Everything works from the built-in goals, without game files', () => {
  const builtin = C.builtinDatabase();
  const career = save('DEMO'), garage = new Uint8Array(10202);
  garage.set([0x4e, 0x32, 0x47, 0x41]);
  for (let i = 0; i < 5; i++) garage[0x28 + i * 0x7f2 + 0x429] = i === 0 ? 1 : 0; // one bought car in slot 6
  const fake = { isGarageDatFile: false, workingBytes: career, garageDatWorking: garage, hasGarageDatLoaded: () => true };
  const result = C.unlockEverything(fake, builtin);
  assert.deepEqual(result, { career: true, slots: 10, cars: [1, 6] });
  const report = C.careerReport(career, builtin);
  assert.equal(report.percent, 100);
  assert.deepEqual(locked(report), []);
  assert.deepEqual(report.lockedSlots, []);
  for (const [bytes, base] of [[career, 0x5870], [garage, 0x28]]) {
    assert.ok(V.ownsAllParts(bytes, base));
    assert.deepEqual(Array.from({ length: 9 }, (_, i) => new DataView(bytes.buffer).getUint32(base + 0x2e8 + i * 4, true)), Array(9).fill(1));
  }
  for (let i = 0; i < 5; i++) assert.equal(garage[0x28 + i * 0x7f2 + 0x428], 0, `slot ${i + 6} open`);
  // An empty slot is opened but not given parts.
  assert.ok(!V.ownsAllParts(career, 0x5870 + 0x7f2));
});

test('the built-in goals match the game data', { skip }, () => {
  const fromGame = db(), builtin = C.builtinDatabase();
  const strip = (d) => JSON.stringify({
    events: [...d.events.values()].map((e) => [e.hash, e.stage, e.kind, e.special]),
    photos: d.photos, stages: d.stages, parts: d.parts, carGates: d.carGates,
    shops: d.shops.map((s) => [s.hash, s.stage, s.gate, s.requirement, s.discovery]), cars: d.cars.map((c) => c.hash),
  });
  assert.equal(strip(builtin), strip(fromGame));
});

test('the GARAGE.DAT fingerprint follows the edited career (nfsu2-web FNV-1a 64)', () => {
  const career = save('JANE'), garage = new Uint8Array(10202);
  C.syncGarageFingerprint(career, garage);
  let h = 0xcbf29ce484222325n;
  for (let i = 36; i < 36 + 39230; i++) h = BigInt.asUintN(64, (h ^ BigInt(career[i])) * 0x100000001b3n);
  assert.equal(new DataView(garage.buffer).getBigUint64(8, true), h);
  career[0x5870 + 0x42a] ^= 1;
  C.syncGarageFingerprint(career, garage);
  assert.notEqual(new DataView(garage.buffer).getBigUint64(8, true), h, 'a car edit changes the fingerprint');
});

test('owned rims: the car\'s wheel sizes, minus the first 32 the PC garage cannot cope with', () => {
  const demo = save('DEMO'), base = 0x5870, sub = base + V.PURCHASED_REL, rims = sub + 0x16c;
  // DEMO slot 1 is a Corolla, wheel class 24 (16-18"), the same as the Civic that bought GRAVIS I.
  demo.fill(0xff, rims, rims + 256); // what the earlier editor wrote
  V.ownAllParts(demo, base);
  const bit = (n) => (demo[rims + (n >> 3)] >> (n & 7)) & 1;
  const owned = Array.from({ length: 2048 }, (_, n) => n).filter(bit);
  assert.deepEqual(owned, globalThis.NFSU2RimData.bits[24].filter((n) => n >= 32));
  // SPEED2.EXE 0x539C20 padlocks the garage's Rims when the first owned-rims dword is non-zero.
  assert.equal(new DataView(demo.buffer).getUint32(rims, true), 0);
  assert.equal(bit(1327), 1, 'GRAVIS I: the bit the PC game set when it was bought (purchased +0x211, 0x80)');
  assert.equal(globalThis.NFSU2RimData.carClass[V.gameHash('CIVIC')], 24);
});

test('the bundle carries the save-safety patches', () => {
  const bundle = readFileSync(new URL('../js/app.bundle.min.js', import.meta.url), 'utf8');
  assert.match(bundle, /'STAGE':0xa175,/, 'stage display reads the real career stage');
  assert.match(bundle, /\(_0x569c05=0x1\)\{return;/, 'slot edits never raise the career stage');
  assert.doesNotMatch(bundle, /<0x5&&\(this\['workingBytes'\]\[_0x376147/, '"Enable All 5 Slots" does not set stage 5');
  assert.match(bundle, /'DEFAULT_USED_SLOT_HEADER_HEX':'38 39 26 3D 3E 96 AC A5/, 'stock tint/neon defaults');
  assert.match(bundle, /globalThis\.NFSU2Bridge=\{[^}]*presets:_0x253ee1,perfTiers:_0x176344,dynoPresets:_0x40d7f4,uniques:_0x3ede76\}/, 'bridge for js/visual-editor.js, js/career.js and js/custom-cars.js');
  assert.match(bundle, /globalThis\.NFSU2SyncGarageFingerprint\(this\['workingBytes'\]/, 'GARAGE.DAT fingerprint refreshed on export');
});

test('the page loads one version of every editor script and stylesheet (no stale cached mix)', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  const version = /ASSET_VERSION = '([^']+)'/.exec(sw)[1];
  const assets = [...html.matchAll(/(?:src|href)="((?:js|css)\/[^"]+)"/g)].map((m) => m[1]).filter((a) => !a.includes('landing'));
  assert.ok(assets.length >= 8);
  for (const a of assets) {
    assert.ok(a.endsWith(`?v=${version}`), `${a} must carry ?v=${version}`);
    assert.ok(sw.includes(`'/${a.split('?')[0]}?v=' + ASSET_VERSION`), `${a} must be precached with the same version`);
  }
  assert.doesNotMatch(sw, /caches\.match\(req\)\.then\(\(cached\) => \{[^}]*return cached \|\| network/, 'scripts are not served cache-first');
});
