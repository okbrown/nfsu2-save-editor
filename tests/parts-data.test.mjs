// Run with: node --test tests/*.test.mjs   (the comparison with the game also needs NFSU2_GAMEDATA)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../js/rim-data.js');
require('../js/visual-editor.js');
require('../js/parts-data.js');
const V = globalThis.NFSU2Visual;
const builtin = V.builtinCatalog(globalThis.NFSU2PartsData);
const gameData = process.env.NFSU2_GAMEDATA;
const skip = !gameData || !existsSync(gameData) ? 'set NFSU2_GAMEDATA to GLOBAL/GlobalB.lzc or GLOBALB.BUN' : false;

test('the built-in parts list works without any game file', () => {
  assert.equal(builtin.parts.length, 12167);
  const civic = V.gameHash('CIVIC'), corolla = V.gameHash('COROLLA');
  const rims = V.menuChoices(civic, 29, 0, builtin).filter((e) => e.part.level > 0);
  assert.equal(rims.length, 324);
  assert.ok(rims.some((e) => e.group === '5ZIGEN' && e.label === 'GRAVIS I — 18"'));
  assert.equal(builtin.stockValue(corolla, 63), V.gameHash('GLOSS_L3_TEST10'), 'factory paint');
  // A car the game set up itself resets to stock with no change at all.
  const demo = new Uint8Array(readFileSync(new URL('../assets/DEMO', import.meta.url))), before = demo.slice();
  builtin.resetToStock(demo, 0x5870);
  assert.deepEqual(demo, before);
});

test('the built-in parts list gives exactly the game file\'s menus and stock values', { skip }, () => {
  const game = V.parseGameData(new Uint8Array(readFileSync(gameData)));
  for (const car of game.cars) {
    for (const slot of V.VISUAL_SLOTS) {
      const a = game.selectableOptions(car.hash, slot.id).map((p) => p.hash);
      const b = builtin.selectableOptions(car.hash, slot.id).map((p) => p.hash);
      assert.deepEqual(b, a, `${car.name} slot ${slot.id}`);
      assert.equal(builtin.stockValue(car.hash, slot.id), game.stockValue(car.hash, slot.id), `${car.name} slot ${slot.id} stock`);
    }
    for (const slot of [12, 29, 64, 105]) {
      const label = (cat) => V.menuChoices(car.hash, slot, 0, cat).map((e) => `${e.group}|${e.label}`);
      assert.deepEqual(label(builtin), label(game), `${car.name} slot ${slot} labels`);
    }
  }
});
