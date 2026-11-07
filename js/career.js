/*
 * NFSU2 Save Editor — career completion from the game's own goals.
 *
 * "Complete game (100%)" marks every main career event and photo goal of the
 * player's GLOBALB.BUN as done, fills each stage's result sets the way the game
 * does, completes stages 0-5, moves to the post-career stage 6 and discovers the
 * standard shops. Shop, part and dealer-car gates then pass by the game's own
 * rules; nothing is copied from another player's save.
 *
 * Save layout, BUN tables and the completion routine are adapted from
 * hackch/NFSU2-Savegame-Editor (MIT License, Copyright (c) 2025 Christopher Hack),
 * src/model/career.ts, whose results were checked against the game's own
 * completion-percentage function (FUN_00528A60) on SPEED2.EXE v1.2.
 */
(function (root) {
  'use strict';

  const CAREER_SAVE_SIZE = 0xd6b6;
  const CURRENT_STAGE_OFF = 0xa175;
  const EVENT_COUNT_OFF = 0xa179;
  const EVENT_OFF = 0xa17d;
  const EVENT_CAPACITY = 384;
  const STAGE_OFF = 0x9962;
  const STAGE_STRIDE = 0x101;
  const STOCK_OFF = 0x24;
  const STOCK_COUNT_OFF = 0x4a4;
  const GARAGE_BASE = 0x5870;
  const GARAGE_STRIDE = 0x7f2;
  const GARAGE_SLOTS = 5;
  const SLOT_LOCK_REL = 0x428;

  const CAR_RECORD_STRIDE = 0x890;
  const CAR_HASH_REL = 0xd0;

  function view(bytes) {
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  // ---------------------------------------------------------------------------
  // GLOBALB.BUN career database (container 0x80034A10)
  // ---------------------------------------------------------------------------

  function parseCareerDatabase(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    const dv = view(bytes);
    const containers = [];
    let carChunk = null;
    (function walk(start, end) {
      for (let off = start; off + 8 <= end;) {
        const id = dv.getUint32(off, true), size = dv.getUint32(off + 4, true), next = off + 8 + size;
        if (next > end) throw new Error('Truncated game-data chunk.');
        if (id === 0x80034a10) containers.push(bytes.subarray(off + 8, next));
        else if (id === 0x34600 && !carChunk) carChunk = bytes.subarray(off + 8, next);
        else if (id & 0x80000000) walk(off + 8, next);
        off = next;
      }
    })(0, bytes.length);
    // The first container is the main career; a later one is the demo's.
    if (!containers.length) throw new Error('Missing NFSU2 career database in the game data.');
    if (!carChunk) throw new Error('Missing NFSU2 car table in the game data.');

    const raw = containers[0], cv = view(raw), chunks = new Map();
    for (let off = 0; off + 8 <= raw.length;) {
      const id = cv.getUint32(off, true), size = cv.getUint32(off + 4, true), next = off + 8 + size;
      if (next > raw.length || chunks.has(id)) throw new Error('Invalid or duplicate career-data chunk.');
      chunks.set(id, raw.subarray(off + 8, next));
      off = next;
    }
    const table = (id, stride) => {
      const t = chunks.get(id);
      if (!t || t.length % stride) throw new Error(`Missing or invalid career table ${id.toString(16)}.`);
      return t;
    };
    const strings = table(0x34a1d, 1);
    const stringAt = (off) => {
      const end = strings.indexOf(0, off);
      if (off >= strings.length || end < off) throw new Error('Invalid career string offset.');
      return String.fromCharCode(...strings.subarray(off, end));
    };

    const events = new Map();
    const eventBytes = table(0x34a11, 0x88), ev = view(eventBytes);
    for (let off = 0; off < eventBytes.length; off += 0x88) {
      const hash = ev.getUint32(off + 8, true);
      if (!hash || events.has(hash)) throw new Error('Invalid or duplicate career event hash.');
      const stage = eventBytes[off + 0x37], kind = eventBytes[off + 0x34];
      if (stage > 5 || kind > 3) throw new Error('Unsupported career event definition.');
      events.set(hash, { hash, name: stringAt(ev.getUint16(off, true)), stage, kind, special: eventBytes[off + 0xd] === 1 });
    }
    if (!events.size) throw new Error('Career database has no event definitions.');

    const SHOP_TYPES = ['', 'Performance', 'Body', 'Paint', 'Car dealer', 'Specialties'];
    const shops = [];
    const shopBytes = table(0x34a12, 0xa0), sv = view(shopBytes);
    for (let off = 0; off < shopBytes.length; off += 0xa0) {
      const hash = sv.getUint32(off + 0x38, true), type = shopBytes[off + 0x50];
      if (type < 1 || type > 5) continue; // intro home and the unique-reward shop
      const path = shopBytes.subarray(off + 0x40, off + 0x50), end = path.indexOf(0);
      const file = String.fromCharCode(...(end < 0 ? path : path.subarray(0, end))).replace(/\.BIN$/i, '');
      const stage = sv.getInt8(off + 0x9d), gate = shopBytes[off + 0x9c];
      if (stage < 0 || stage > 5 || gate > 4) throw new Error(`Unsupported career shop gate: ${file}.`);
      shops.push({ hash, name: `${SHOP_TYPES[type]} shop (${file}, stage ${stage})`, stage, gate,
        discovery: shopBytes[off + 0x51] !== 0, requirement: sv.getUint32(off + 0x74, true) });
    }

    const parts = [];
    const partBytes = table(0x34a1c, 0x28), pv = view(partBytes);
    for (let off = 0; off < partBytes.length; off += 0x28) {
      const item = pv.getInt32(off, true);
      for (let level = 1; level <= 3; level++) {
        const base = off + 4 + (level - 1) * 12;
        parts.push({ item, level, type: pv.getInt8(base + 4), requirement: pv.getUint32(base + 8, true) });
      }
    }

    const carGates = [];
    const carBytes = table(0x34a1f, 12), av = view(carBytes);
    for (let off = 0; off < carBytes.length; off += 12) {
      carGates.push({ hash: av.getUint32(off, true), events: [av.getUint32(off + 4, true), av.getUint32(off + 8, true)] });
    }

    const stages = [];
    const stageBytes = table(0x34a18, 0x50), tv = view(stageBytes);
    if (stageBytes.length !== 6 * 0x50) throw new Error('Career completion requires the six-stage main database.');
    for (let off = 0; off < stageBytes.length; off += 0x50) {
      if (stageBytes[off] !== stages.length) throw new Error('Unsupported career stage sequence.');
      stages.push({ id: stageBytes[off], finalEvent: tv.getUint32(off + 0x28, true) });
    }

    const photos = [];
    const photoBytes = table(0x34a16, 0x40), fv = view(photoBytes);
    for (let off = 0; off < photoBytes.length; off += 0x40) {
      photos.push({ hash: fv.getUint32(off + 0x20, true), stage: photoBytes[off + 0x25] });
    }

    let carStart = 0;
    while (carStart < 16 && carChunk[carStart] === 0x11) carStart++;
    const cars = [];
    for (let base = carStart; base + CAR_RECORD_STRIDE <= carChunk.length; base += CAR_RECORD_STRIDE) {
      let name = '';
      for (let k = 0; k < 0x20 && carChunk[base + k]; k++) name += String.fromCharCode(carChunk[base + k]);
      cars.push({ index: cars.length, name, hash: view(carChunk).getUint32(base + CAR_HASH_REL, true) });
    }

    return { events, shops, parts, carGates, stages, photos, cars };
  }

  // ---------------------------------------------------------------------------
  // Save-side reads
  // ---------------------------------------------------------------------------

  function savedEvents(save) {
    if (save.length < CAREER_SAVE_SIZE) throw new Error('This is not a career save.');
    const dv = view(save), count = dv.getUint32(EVENT_COUNT_OFF, true), stage = dv.getUint32(CURRENT_STAGE_OFF, true);
    if (stage > 6) throw new Error(`Unexpected career stage ${stage}.`);
    if (count > EVENT_CAPACITY) throw new Error('Career event count exceeds 384.');
    const events = new Map();
    for (let i = 0; i < count; i++) {
      const off = EVENT_OFF + i * 8, hash = dv.getUint32(off, true);
      if (!hash || events.has(hash)) throw new Error('Invalid or duplicate saved event.');
      events.set(hash, off);
    }
    return events;
  }

  /** Non-zero entries of a stage's result set (races 35, URL 4, sponsor 10). */
  function stageResultCount(save, stage, kind) {
    const [rel, size] = kind === 'races' ? [0, 35] : kind === 'urls' ? [0x8c, 4] : [0x9c, 10];
    const dv = view(save), base = STAGE_OFF + stage * STAGE_STRIDE + rel;
    let count = 0;
    for (let i = 0; i < size; i++) if (dv.getUint32(base + i * 4, true) !== 0) count++;
    return count;
  }

  /** What the game would still lock, evaluated with its own gate rules. */
  function careerReport(save, db) {
    const events = savedEvents(save), dv = view(save), stage = dv.getUint32(CURRENT_STAGE_OFF, true);
    const complete = (hash) => {
      const off = events.get(hash);
      return off !== undefined && save[off + 6] === 1;
    };
    const eventReason = (hash) => `Complete ${db.events.get(hash)?.name ?? '0x' + hash.toString(16).toUpperCase()}`;
    const countGate = (which, required, kind) => {
      const count = stageResultCount(save, which, kind);
      return count >= required ? '' : `Stage ${which}: ${count}/${required} ${kind}`;
    };
    const shopReason = (shop, checkDiscovery) => {
      if (stage < shop.stage) return `Requires stage ${shop.stage}`;
      if (shop.gate === 1 && !complete(shop.requirement)) return eventReason(shop.requirement);
      if (shop.gate >= 2) {
        const reason = countGate(shop.stage, shop.requirement, shop.gate === 2 ? 'sponsors' : shop.gate === 3 ? 'races' : 'urls');
        if (reason) return reason;
      }
      const off = events.get(shop.hash);
      if (checkDiscovery && shop.discovery && (off === undefined || save[off + 4] !== 1)) return `Discover ${shop.name}`;
      return '';
    };
    const shops = db.shops.map((shop) => {
      const reason = shopReason(shop, false), off = events.get(shop.hash);
      const discovered = !shop.discovery || (off !== undefined && save[off + 4] === 1);
      return { name: shop.name, hash: shop.hash, reason, discovered, discoverable: !reason && !discovered };
    });
    const parts = db.parts.map((part) => {
      let reason = '';
      if (part.type === 1) {
        const shop = db.shops.find((s) => s.hash === part.requirement);
        reason = shop ? shopReason(shop, true) : 'Unknown shop prerequisite';
      } else if (part.type >= 2 && part.type <= 4) {
        reason = countGate(part.requirement >>> 16, part.requirement & 0xffff,
          part.type === 2 ? 'races' : part.type === 3 ? 'sponsors' : 'urls');
      }
      return { name: `Item ${part.item}, level ${part.level}`, reason };
    });
    const cars = [];
    const activeStock = Math.min(dv.getUint32(STOCK_COUNT_OFF, true), 48);
    for (let i = 0; i < activeStock; i++) {
      const car = db.cars[dv.getInt32(STOCK_OFF + i * 0x18 + 0x14, true)];
      if (!car) continue;
      const gate = db.carGates.find((g) => g.hash === car.hash);
      // Each gate has one prerequisite per game region; the region is not stored in the save.
      const reasons = gate ? gate.events.map((h) => (db.events.has(h) && !complete(h) ? eventReason(h) : '')) : [''];
      cars.push({ name: car.name, reason: reasons.every((r) => r) ? reasons[0] : '' });
    }
    const completedEvents = [...db.events.keys()].filter(complete).length;
    const completedStages = db.stages.filter((s) => save[STAGE_OFF + s.id * STAGE_STRIDE + 0xfc] !== 0).length;
    const completedPhotos = db.photos.filter((p) => complete(p.hash)).length;
    return {
      stage, shops, parts, cars,
      events: completedEvents, totalEvents: db.events.size,
      percent: (completedEvents / db.events.size) * 100,
      stages: completedStages, totalStages: db.stages.length,
      photos: completedPhotos, totalPhotos: db.photos.length,
      lockedSlots: Array.from({ length: GARAGE_SLOTS }, (_, i) => i).filter((i) => save[GARAGE_BASE + i * GARAGE_STRIDE + SLOT_LOCK_REL] !== 0),
    };
  }

  // ---------------------------------------------------------------------------
  // Completion
  // ---------------------------------------------------------------------------

  function ensureEvent(save, events, hash) {
    const existing = events.get(hash);
    if (existing !== undefined) return existing;
    if (events.size >= EVENT_CAPACITY) throw new Error('Not enough career event slots.');
    const off = EVENT_OFF + events.size * 8;
    save.fill(0, off, off + 8); // stale inactive bytes must not become completion history
    view(save).setUint32(off, hash, true);
    events.set(hash, off);
    view(save).setUint32(EVENT_COUNT_OFF, events.size, true);
    return off;
  }

  function discoverShops(save, db) {
    const events = savedEvents(save);
    for (const shop of careerReport(save, db).shops.filter((s) => s.discoverable)) {
      save[ensureEvent(save, events, shop.hash) + 4] = 1;
    }
  }

  /**
   * Completes every main event and photo goal, the stage result sets and stages 0-5, sets
   * stage 6 (post-career), discovers the standard shops and opens the five garage slots.
   * Works on a copy; returns the completed save. Throws before changing anything if the
   * event table would overflow.
   */
  function completeGame(input, db) {
    const events = savedEvents(input);
    const hashes = new Set([...db.events.keys(), ...db.photos.map((p) => p.hash), ...db.shops.filter((s) => s.discovery).map((s) => s.hash)]);
    const needed = [...hashes].filter((h) => !events.has(h)).length;
    if (events.size + needed > EVENT_CAPACITY) throw new Error('Not enough event slots to complete the career.');
    const save = input.slice(), dv = view(save);
    for (const event of db.events.values()) {
      const off = ensureEvent(save, events, event.hash);
      // Leave events the game already recorded as won exactly as it wrote them.
      if (save[off + 6] !== 1) {
        save[off + 4] = 1;
        save[off + 6] = 1;
      }
      if (event.kind === 0 || (event.kind === 3 && event.special)) continue;
      const [rel, size] = event.kind === 1 ? [0x8c, 4] : event.kind === 2 ? [0x9c, 10] : [0, 35];
      const base = STAGE_OFF + event.stage * STAGE_STRIDE + rel;
      // As FUN_00513390: first empty entry, no duplicates, capped set.
      for (let i = 0; i < size; i++) {
        const at = base + i * 4, value = dv.getUint32(at, true);
        if (value === event.hash) break;
        if (value === 0) { dv.setUint32(at, event.hash, true); break; }
      }
    }
    for (const photo of db.photos) {
      const off = ensureEvent(save, events, photo.hash);
      if (save[off + 6] !== 1) {
        save[off + 4] = 2;
        save[off + 6] = 1;
      }
    }
    for (const stage of db.stages) {
      const base = STAGE_OFF + stage.id * STAGE_STRIDE;
      save[base + 0xfc] = 1;
      dv.setInt32(base + 0xfd, stage.id, true);
    }
    dv.setUint32(CURRENT_STAGE_OFF, 6, true);
    discoverShops(save, db);
    // A finished career has all five garage slots open (as in a real 100% save).
    for (let i = 0; i < GARAGE_SLOTS; i++) save[GARAGE_BASE + i * GARAGE_STRIDE + SLOT_LOCK_REL] = 0;
    return save;
  }

  // ---------------------------------------------------------------------------
  // UI: the 100% button runs this instead of copying a template save
  // ---------------------------------------------------------------------------

  let db = null;

  function bridge() {
    return root.NFSU2Bridge || null;
  }

  function toast(message) {
    const b = bridge();
    if (b) b.toast(message);
  }

  function summary(report) {
    const locked = [
      ...report.shops.filter((s) => s.reason).map((s) => s.name),
      ...report.parts.filter((p) => p.reason).map((p) => p.name),
      ...report.cars.filter((c) => c.reason).map((c) => c.name),
    ];
    return `${report.percent.toFixed(1)}% · ${report.events}/${report.totalEvents} events · ${report.photos}/${report.totalPhotos} photos · ` +
      `${report.stages}/${report.totalStages} stages · stage ${report.stage}` +
      (locked.length ? ` · still locked: ${locked.length}` : ' · nothing locked');
  }

  async function onCompleteClick(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
    const save = bridge()?.getSave();
    if (!save) return;
    if (save.isGarageDatFile) return toast('Load the career save (not GARAGE.DAT) to complete the game.');
    if (!db) {
      toast('Load your game data (GlobalB.lzc / GLOBALB.BUN) first: completion uses the game\'s own goals.');
      root.NFSU2Visual?.pickGameData?.();
      return;
    }
    try {
      const done = completeGame(save.workingBytes, db);
      save.workingBytes.set(done);
      bridge().refresh();
      const report = careerReport(save.workingBytes, db);
      renderStatus();
      toast(`Career completed: ${summary(report)}`);
    } catch (err) {
      toast(`Completion failed (save unchanged): ${err.message}`);
    }
  }

  const STAGE_NAMES = ['Prologue', 'Stage 1', 'Stage 2', 'Stage 3', 'Stage 4', 'Stage 5', 'Career complete'];

  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  /** Replaces the overview's estimates with the game's own figures once game data is loaded. */
  function renderStatus() {
    const save = bridge()?.getSave();
    if (!db) { setText('careerStatus', 'Load your game data (GlobalB.lzc) to complete the career from its real goals.'); return; }
    if (!save || save.isGarageDatFile) { setText('careerStatus', ''); return; }
    let report;
    try {
      report = careerReport(save.workingBytes, db);
    } catch (err) {
      setText('careerStatus', err.message);
      return;
    }
    setText('careerStatus', summary(report));
    setText('statCompletionPct', `${report.percent.toFixed(report.percent % 1 ? 1 : 0)}%`);
    setText('stageReadOnlyBadge', report.stage >= 6 ? 'COMPLETE' : `STAGE ${report.stage}`);
    setText('statStageName', STAGE_NAMES[report.stage] || `Stage ${report.stage}`);
    setText('statEventsCount', `${report.events} / ${report.totalEvents} won · ${report.photos} / ${report.totalPhotos} photos`);
    setText('statShopsFound', `${report.shops.filter((x) => x.discovered && !x.reason).length} / ${report.shops.length}`);
    setText('statCarLot', `${report.cars.filter((c) => !c.reason).length} / ${report.cars.length}`);
  }

  function init() {
    const button = document.getElementById('btnMasterUnlock100');
    if (button) button.addEventListener('click', onCompleteClick, true);
    root.addEventListener('nfsu2:gamedata', (e) => {
      try {
        db = parseCareerDatabase(e.detail.bytes);
      } catch (err) {
        db = null;
        toast(`Career data error: ${err.message}`);
      }
      renderStatus();
    });
    const container = document.getElementById('garageSlotsContainer');
    if (container) new MutationObserver(renderStatus).observe(container, { childList: true });
    renderStatus();
  }

  root.NFSU2Career = { parseCareerDatabase, careerReport, completeGame, stageResultCount, CURRENT_STAGE_OFF, SLOT_LOCK_REL };

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }
})(typeof window !== 'undefined' ? window : globalThis);
