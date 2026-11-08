/*
 * NFSU2 Save Editor — Quick Race custom cars (Quick Race → Customize).
 *
 * The career save holds 20 custom-car records of 0x430 bytes from 0x04A8 (the editor's base is the
 * record + 8, as for garage cars). Record layout, as SPEED2.EXE v1.2 writes it (0x52A710 creates,
 * 0x52A6C0 deletes; the save omits each record's vtable dword):
 *   +0x00 0   +0x04 handle, the game's hash of "TUNED_CAR_<index>"   +0x08 score (float)
 *   +0x0C 1 when listed   +0x10 2 (custom car)   +0x14 the car's configuration, 0x418 bytes:
 * the same layout as a garage car's (init flag, car, 170 visual parts, uniques, performance parts,
 * five dyno setups). Custom cars have no purchased parts, lock or bought flags: those exist only
 * on garage records, so the garage card's controls cannot be pointed at them.
 */
(function (root) {
  'use strict';

  const RECORD_START = 0x04a8;
  const RECORD_STRIDE = 0x430;
  const RECORD_COUNT = 20;
  const BASE_REL = 8;               // editor base = record + 8 (record +0x14 = base +0x0C)
  const CONFIG_REL = 0x0c;          // the 0x418-byte configuration starts here
  const CONFIG_LEN = 0x418;
  const TYPE_CUSTOM = 2;
  const CAR_REL = 0x14;
  const VISUAL_REL = 0x18;
  const WHEEL_FLOATS_REL = 0x2c0;
  const UNIQUES_REL = 0x2e8;
  const PERF_REL = 0x310;
  const PERF_LEN = 0x38;
  const DYNO_REL = 0x354;
  const DYNO_STRIDE = 0x29;
  const GARAGE_BASE = 0x5870;
  const GARAGE_STRIDE = 0x7f2;
  const PRESET_BASE = 0x5870;       // presets are written as garage slot 1 blocks

  /** What the editor gives an injected car (the game's values for a car fresh from the shop). */
  const WHEEL_FLOATS = '67 66 66 3F A4 70 7D 3F 00 00 80 3F A3 70 7D 3F A4 70 7D 3F 1F 85 2B 3F A4 70 7D 3F 85 EB F1 3F A4 70 7D 3F 64 3B 3F 3F';

  function view(bytes) {
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  function hexBytes(hex) {
    return String(hex).trim().split(/\s+/).filter(Boolean).map((h) => parseInt(h, 16));
  }

  function gameHash(name) {
    let hash = 0xffffffff;
    for (const c of String(name).toUpperCase()) hash = (Math.imul(hash, 33) + c.charCodeAt(0)) >>> 0;
    return hash;
  }

  function recordOf(index) {
    return RECORD_START + index * RECORD_STRIDE;
  }

  function baseOf(index) {
    return recordOf(index) + BASE_REL;
  }

  /** All 20 records, with whether the game lists them (handle set and listed flag on). */
  function records(bytes) {
    const dv = view(bytes);
    return Array.from({ length: RECORD_COUNT }, (_, index) => {
      const rec = recordOf(index);
      const listed = dv.getUint32(rec + 4, true) !== 0 && dv.getUint32(rec + 0xc, true) !== 0;
      return { index, base: rec + BASE_REL, listed, car: dv.getUint32(rec + BASE_REL + CAR_REL, true) };
    });
  }

  /** Writes the header the game gives a new custom car at this index. */
  function writeHeader(bytes, index, score) {
    const rec = recordOf(index), dv = view(bytes);
    dv.setUint32(rec, 0, true);
    dv.setUint32(rec + 4, gameHash(`TUNED_CAR_${index}`), true);
    dv.setFloat32(rec + 8, score, true);
    dv.setUint32(rec + 0xc, 1, true);
    dv.setUint32(rec + 0x10, TYPE_CUSTOM, true);
  }

  /** As the game's "copy this car into a custom car": the configuration copied, score 0. */
  function copyGarageCar(bytes, index, garageBytes, garageBase) {
    writeHeader(bytes, index, 0);
    const base = baseOf(index);
    bytes.set(garageBytes.subarray(garageBase + CONFIG_REL, garageBase + CONFIG_REL + CONFIG_LEN), base + CONFIG_REL);
    bytes[base + CONFIG_REL] = 1;
  }

  /** As the game's delete: header cleared (type kept), configuration zeroed. */
  function deleteCar(bytes, index) {
    const rec = recordOf(index);
    bytes.fill(0, rec, rec + 0x10);
    view(bytes).setUint32(rec + 0x10, TYPE_CUSTOM, true);
    bytes.fill(0, rec + 0x14, rec + 0x14 + CONFIG_LEN);
  }

  function setPerfTier(bytes, base, tier) {
    bytes.fill(0, base + PERF_REL, base + PERF_REL + PERF_LEN);
    for (const id of tier.partIds) bytes[base + PERF_REL + id] = 1;
  }

  /** The same thresholds the garage card uses to name a car's tuning level. */
  function perfTierId(bytes, base, tiers) {
    const n = bytes.subarray(base + PERF_REL, base + PERF_REL + PERF_LEN).filter((b) => b !== 0).length;
    return n >= 0x20 ? tiers.EXTREME.id : n >= 0x18 ? tiers.PRO.id : n > 0 ? tiers.STREET.id : tiers.STOCK.id;
  }

  function uniques(bytes, base) {
    const dv = view(bytes);
    return Array.from({ length: 9 }, (_, i) => dv.getUint32(base + UNIQUES_REL + i * 4, true) !== 0);
  }

  function setUnique(bytes, base, i, on) {
    view(bytes).setUint32(base + UNIQUES_REL + i * 4, on ? 1 : 0, true);
  }

  function applyDyno(bytes, base, preset) {
    for (let s = 0; s < 5; s++) {
      const setup = base + DYNO_REL + s * DYNO_STRIDE;
      for (let k = 0; k < 9; k++) {
        bytes[setup + 0x17 + k] = preset.ecu[k];
        bytes[setup + 0x20 + k] = preset.turbo[k];
      }
    }
  }

  /**
   * Puts a built-in car preset into a custom car. Presets carry the car and its look (the garage
   * slot-1 blocks); the rest of the configuration (dyno setups, unknown fields) is kept from the
   * record, which must already hold a valid car. Story and tuned builds get Extreme parts and the
   * nine uniques, as the garage does.
   */
  function applyPreset(bytes, index, preset, ctx) {
    const base = baseOf(index), dv = view(bytes);
    bytes.fill(0, base + VISUAL_REL, base + WHEEL_FLOATS_REL);
    for (const block of preset.blocks) {
      const off = typeof block.off === 'string' ? parseInt(block.off, 16) : Number(block.off);
      const rel = off - PRESET_BASE;
      if (!block.hex || rel < 0 || rel >= CONFIG_REL + CONFIG_LEN) continue; // world/career blocks are not the car's
      const hex = rel === 0 && ctx.normalize ? ctx.normalize(block.hex) : block.hex;
      const data = hexBytes(hex).slice(0, CONFIG_REL + CONFIG_LEN - rel);
      bytes.set(data, base + rel);
    }
    writeHeader(bytes, index, dv.getFloat32(base, true)); // the preset's first dword is the score
    bytes[base + CONFIG_REL] = 1;
    bytes.set(hexBytes(WHEEL_FLOATS), base + WHEEL_FLOATS_REL);
    const colours = root.NFSU2Visual?.DEFAULT_VINYL_COLOURS;
    if (colours) for (let s = 77; s <= 92; s++) {
      const at = base + VISUAL_REL + s * 4;
      if (dv.getUint32(at, true) === 0) dv.setUint32(at, colours[(s - 77) % 4], true);
    }
    if (!preset.category || ['story', 'custom', 'player'].includes(preset.category)) {
      setPerfTier(bytes, base, ctx.tiers.EXTREME);
      for (let i = 0; i < 9; i++) setUnique(bytes, base, i, true);
    }
  }

  // ---------------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------------

  const CATEGORY_LABELS = { story: 'Story & Sponsor Cars', custom: 'Rivals & Magazine Builds', player: 'Player Builds', stock: 'Stock Career Cars' };
  let card = null;

  function bridge() {
    return root.NFSU2Bridge || null;
  }

  function save() {
    return bridge()?.getSave() || null;
  }

  function toast(message) {
    bridge()?.toast(message);
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  }

  function garageCars(s) {
    return Array.from({ length: 5 }, (_, i) => ({ slot: i, base: GARAGE_BASE + i * GARAGE_STRIDE }))
      .filter(({ base }) => s.workingBytes[base + 0x429] === 1 && view(s.workingBytes).getUint32(base + CAR_REL, true) !== 0);
  }

  /** "Car" choices: copy a garage car, or any built-in preset (grouped like the garage card's list). */
  function carOptions(s, placeholder) {
    const label = (car) => root.NFSU2Visual?.carLabel(car) || '0x' + car.toString(16);
    const garage = garageCars(s).map(({ slot, base }) =>
      `<option value="garage:${slot}">Slot ${slot + 1}: ${escapeHtml(label(view(s.workingBytes).getUint32(base + CAR_REL, true)))}</option>`).join('');
    const presets = bridge()?.presets || [];
    const groups = [...new Set(presets.map((p) => p.category || 'other'))].map((cat) =>
      `<optgroup label="${escapeHtml(CATEGORY_LABELS[cat] || cat)}">${presets.filter((p) => (p.category || 'other') === cat)
        .map((p) => `<option value="preset:${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join('')}</optgroup>`).join('');
    return `<option value="">${placeholder}</option>` +
      (garage ? `<optgroup label="Copy from my garage">${garage}</optgroup>` : '') + groups;
  }

  function ensureCard() {
    if (card) return card;
    const garageCard = document.getElementById('garageSlotsContainer')?.closest('.card');
    if (!garageCard) return null;
    card = document.createElement('div');
    card.className = 'card ve-custom-card';
    card.innerHTML = `
      <div class="card-header">
        <div class="header-title-row">
          <div>
            <h2>Quick Race Custom Cars</h2>
            <span class="subtitle-inline">The cars from Quick Race → Customize (up to 20), stored separately from your career garage</span>
          </div>
        </div>
        <div class="garage-global-actions">
          <select class="cc-add" aria-label="Add a custom car"></select>
          <button type="button" class="btn btn-secondary btn-sm" data-cc-load>Load game data</button>
        </div>
      </div>
      <div class="garage-slots-list cc-list"></div>`;
    card.querySelector('[data-cc-load]').addEventListener('click', () => root.NFSU2Visual?.pickGameData());
    card.addEventListener('change', onChange);
    card.addEventListener('click', onClick);
    garageCard.after(card);
    return card;
  }

  function render() {
    const s = save(), c = ensureCard();
    if (!c) return;
    const visual = root.NFSU2Visual;
    c.querySelector('[data-cc-load]').textContent = visual?.hasGameData() ? `✓ ${visual.gameDataName()}` : 'Load game data';
    const list = c.querySelector('.cc-list'), add = c.querySelector('.cc-add');
    if (!s || s.isGarageDatFile) {
      c.hidden = !s;
      list.innerHTML = s ? '<p class="ve-empty">Custom cars live in the career save, not in GARAGE.DAT.</p>' : '';
      return;
    }
    c.hidden = false;
    const b = bridge();
    if (!b.presets || !b.perfTiers || !b.dynoPresets || !b.uniques) {
      // Scripts from two editor versions (an old cached bundle): nothing here can work until a reload.
      add.innerHTML = '<option value="">Reload the page to use custom cars</option>';
      add.disabled = true;
      list.innerHTML = '<p class="ve-empty">The editor was updated while this page was open. Reload the page (Ctrl+Shift+R) to edit custom cars.</p>';
      return;
    }
    const recs = records(s.workingBytes), listed = recs.filter((r) => r.listed);
    const free = recs.find((r) => !r.listed);
    add.innerHTML = carOptions(s, free ? '+ Add a custom car…' : 'All 20 custom car slots are used');
    add.disabled = !free;
    const tiers = Object.values(b.perfTiers), dynos = Object.values(b.dynoPresets);
    list.innerHTML = listed.length ? listed.map((r) => {
      const name = visual?.carLabel(r.car) || '0x' + r.car.toString(16);
      const tier = perfTierId(s.workingBytes, r.base, b.perfTiers), u = uniques(s.workingBytes, r.base), all = u.every(Boolean);
      return `
      <div class="slot-card status-in_use" data-cc="${r.index}">
        <div class="slot-top-row">
          <div class="slot-title-group">
            <span class="slot-num">CUSTOM ${r.index + 1}</span>
            <span class="slot-car-name">${escapeHtml(name)}</span>
          </div>
          <div class="slot-badges-right"><span class="status-badge in_use">IN USE</span></div>
        </div>
        <div class="slot-controls-row">
          <div class="slot-control-item">
            <select data-cc-perf title="Performance tuning level">
              ${tiers.map((t) => `<option value="${t.id}" ${t.id === tier ? 'selected' : ''}>Perf: ${escapeHtml(t.label)}</option>`).join('')}
            </select>
          </div>
          <div class="slot-control-item">
            <select data-cc-car title="Replace this custom car with a garage car or a built-in preset">${carOptions(s, '-- Change Car --')}</select>
          </div>
          <div class="slot-patch-actions">
            <button type="button" class="btn btn-xs btn-secondary" data-cc-visuals>Visuals</button>
            <button type="button" class="btn btn-xs btn-ghost" data-cc-delete title="Delete this custom car">Delete</button>
          </div>
        </div>
        <div class="slot-v11-row">
          <div class="slot-uniques-group">
            <span class="slot-v11-label">&#127942; UNIQUES:</span>
            ${b.uniques.map((x) => `<span class="u-pill ${u[x.index] ? 'on' : ''}" data-cc-unique="${x.index}" data-tip="${escapeHtml(x.label)}">${escapeHtml(x.code)}</span>`).join('')}
            <span class="u-pill ${all ? 'u-pill-clear' : 'u-pill-all'}" data-cc-unique-all="${all ? 0 : 1}">${all ? 'Clear 9' : '+All 9'}</span>
          </div>
          <div class="slot-dyno-group">
            <select data-cc-dyno title="Apply ECU &amp; Turbo curves to all 5 Dyno setups">
              <option value="">Dyno ECU/Turbo Preset…</option>
              ${dynos.map((d) => `<option value="${d.id}">${escapeHtml(d.label)}</option>`).join('')}
            </select>
          </div>
        </div>
      </div>`;
    }).join('') : '<p class="ve-empty">No Quick Race custom cars yet. Add one above from your garage or the built-in cars.</p>';
  }

  /** Copies a garage car or applies a preset into custom record `index`. */
  function putCar(index, value) {
    const s = save(), b = bridge(), [kind, id] = value.split(':');
    if (kind === 'garage') {
      copyGarageCar(s.workingBytes, index, s.workingBytes, GARAGE_BASE + Number(id) * GARAGE_STRIDE);
      return `Slot ${Number(id) + 1}'s car`;
    }
    const preset = b.presets.find((p) => p.id === id);
    if (!preset) throw new Error('Unknown preset.');
    if (!records(s.workingBytes)[index].listed) {
      // A new record needs a valid configuration (dyno setups etc.) to build on: start from a garage car.
      const donor = garageCars(s)[0];
      if (!donor) throw new Error('Add a car to your garage first.');
      copyGarageCar(s.workingBytes, index, s.workingBytes, donor.base);
    }
    applyPreset(s.workingBytes, index, preset, { tiers: b.perfTiers, normalize: (hex) => s.normalizeCarVisualBlock(hex) });
    return preset.name;
  }

  function changed(message) {
    bridge().refresh();
    render();
    if (message) toast(message);
  }

  function onChange(e) {
    const s = save(), b = bridge();
    if (!s) return;
    const el = e.target;
    try {
      if (el.classList.contains('cc-add')) {
        if (!el.value) return;
        const free = records(s.workingBytes).find((r) => !r.listed);
        const name = putCar(free.index, el.value);
        return changed(`Custom car ${free.index + 1} added: ${name}`);
      }
      const row = el.closest('[data-cc]');
      if (!row) return;
      const index = Number(row.dataset.cc), base = baseOf(index);
      if (el.matches('[data-cc-car]') && el.value) return changed(`Custom car ${index + 1} is now ${putCar(index, el.value)}`);
      if (el.matches('[data-cc-perf]')) {
        setPerfTier(s.workingBytes, base, Object.values(b.perfTiers).find((t) => t.id === el.value));
        return changed(`Custom car ${index + 1}: ${el.selectedOptions[0].textContent}`);
      }
      if (el.matches('[data-cc-dyno]') && el.value) {
        applyDyno(s.workingBytes, base, b.dynoPresets[el.value]);
        return changed(`Custom car ${index + 1}: ${b.dynoPresets[el.value].label} applied to all 5 Dyno setups`);
      }
    } catch (err) {
      toast(err.message);
      render();
    }
  }

  function onClick(e) {
    const s = save(), row = e.target.closest('[data-cc]');
    if (!s || !row) return;
    const index = Number(row.dataset.cc), base = baseOf(index);
    if (e.target.closest('[data-cc-visuals]')) {
      return root.NFSU2Visual.openEditor(`Custom Car ${index + 1}`, () => save().workingBytes, base, false);
    }
    if (e.target.closest('[data-cc-delete]')) {
      if (!root.confirm || root.confirm(`Delete custom car ${index + 1}?`)) {
        deleteCar(s.workingBytes, index);
        changed(`Custom car ${index + 1} deleted`);
      }
      return;
    }
    const pill = e.target.closest('[data-cc-unique],[data-cc-unique-all]');
    if (pill) {
      if (pill.dataset.ccUniqueAll !== undefined) {
        for (let i = 0; i < 9; i++) setUnique(s.workingBytes, base, i, pill.dataset.ccUniqueAll === '1');
      } else {
        const i = Number(pill.dataset.ccUnique);
        setUnique(s.workingBytes, base, i, !uniques(s.workingBytes, base)[i]);
      }
      changed();
    }
  }

  function init() {
    const container = document.getElementById('garageSlotsContainer');
    if (!container || !bridge()) return;
    new MutationObserver(render).observe(container, { childList: true });
    root.addEventListener('nfsu2:gamedata', render);
    render();
  }

  root.NFSU2CustomCars = { records, baseOf, copyGarageCar, deleteCar, applyPreset, setPerfTier, perfTierId, uniques, setUnique, applyDyno, gameHash };

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }
})(typeof window !== 'undefined' ? window : globalThis);
