/*
 * NFSU2 Save Editor — visual customisation & Quick Race custom cars.
 *
 * Every car record (career slots 1-5, GARAGE.DAT slots 6-10 and the 20 Quick Race
 * custom cars) stores 170 "visual slot" values at record base + 0x18. Each value is
 * the game's string hash of a part name (e.g. 240SX_KIT09_FRONT_BUMPER, PEARL1_PAINT).
 * Which parts fit which car comes from the player's own GLOBAL\GLOBALB.BUN, read
 * locally in the browser; no game data ships with the editor.
 *
 * The part-database reader, slot tables and dependent-slot rules are adapted from
 * hackch/NFSU2-Savegame-Editor (MIT License, Copyright (c) 2025 Christopher Hack):
 * https://github.com/hackch/NFSU2-Savegame-Editor — see its technical.md for the traces.
 */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------------------
  // Save layout (offsets relative to the editor's record base unless noted)
  // ---------------------------------------------------------------------------

  const CAR_REL = 0x14;
  const VISUAL_REL = 0x18;
  const VISUAL_COUNT = 170;
  const PERF_REL = 0x310;

  /** Quick Race custom cars: 20 records of 0x430 bytes from 0x04A8; base = record + 8. */
  const CUSTOM_RECORD_START = 0x04a8;
  const CUSTOM_RECORD_STRIDE = 0x430;
  const CUSTOM_COUNT = 20;
  const CUSTOM_BASE_REL = 8;
  /** Record +0x04 (base -4): lookup handle; the game ignores records whose handle is 0. */
  const CUSTOM_HANDLE_REL = -4;
  /** Record +0x0C (base +4): non-zero when the record is listed in the frontend. */
  const CUSTOM_ENABLED_REL = 4;
  const CAREER_SAVE_SIZE = 0xd6b6;
  /** Garage records only: bytes from the editor base to the end of the 2,034-byte native record. */
  const GARAGE_RECORD_LEN = 0x7ea;
  const CUSTOM_RECORD_LEN = CUSTOM_RECORD_STRIDE - CUSTOM_BASE_REL;

  /** Garage records only: the purchased-parts subobject (Body Parts Storage) starts at base + 0x42A. */
  const PURCHASED_REL = 0x42a;
  /**
   * Ownership fields of the purchased-parts subobject, as serialized offsets and byte lengths.
   * Per-item 32-bit masks of owned variants for the career items the garage storage checks
   * (PS2 0x27A630/0x27A720; items from the slot table filled at 0x272CF8), then the separate
   * owned bitsets: rims (runtime +364; bit n is the n-th compatible rim of its group, so the stock rim
   * is never bought), roof scoops (+620), spoilers (+636), wing mirrors (+652),
   * hoods (+660, serialized +0x298) and NOS purge (+668, serialized +0x3B0). Checked against every
   * part bought in assets/JANE. Body paint, vinyl layers and five accent paints are never tracked.
   */
  const OWNED_ITEMS = Array.from({ length: 73 }, (_, i) => i + 14).filter((item) => ![20, 71, 72, 73].includes(item));
  const OWNED_AREAS = [[0x26c, 16], [0x27c, 16], [0x28c, 8], [0x298, 8], [0x3b0, 16]];
  /**
   * Owned rims: bit n is entry n of the shared rims group (confirmed by a purchase in the PC game: GRAVIS I
   * set bit 1327). Each rim model is in that group once per wheel class, and a car owns only the rims of
   * its own class (js/rim-data.js); owning rims of another class, or the DUMMY entry, padlocks the garage's
   * Rims category.
   *
   * The PC garage (SPEED2.EXE v1.2, 0x539C20) padlocks Rims when the career car's first owned-rims dword
   * (car +0x5A0, bits 0-31) is non-zero: its loop meant to scan all 64 dwords re-tests the first one.
   * So rims 0-31 of the list are left to the shops (where they are still free to fit) and every other rim
   * of the car's class is owned.
   */
  const OWNED_RIMS_REL = 0x16c;
  const GARAGE_RIM_BUG_BITS = 32;

  function rimBitsFor(car) {
    const data = root.NFSU2RimData;
    const cls = data && data.carClass[car];
    return cls ? data.bits[cls] : null;
  }

  function gameHash(name) {
    let hash = 0xffffffff;
    for (const c of String(name).toUpperCase()) hash = (Math.imul(hash, 33) + c.charCodeAt(0)) >>> 0;
    return hash;
  }

  function view(bytes) {
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  function readVisual(bytes, base) {
    const dv = view(bytes);
    return Array.from({ length: VISUAL_COUNT }, (_, i) => dv.getUint32(base + VISUAL_REL + i * 4, true));
  }

  function readCarHash(bytes, base) {
    return view(bytes).getUint32(base + CAR_REL, true);
  }

  function customCarBase(index) {
    return CUSTOM_RECORD_START + index * CUSTOM_RECORD_STRIDE + CUSTOM_BASE_REL;
  }

  /** Quick Race custom cars present in a career save. */
  function listCustomCars(bytes) {
    if (!bytes || bytes.length < CAREER_SAVE_SIZE) return [];
    const dv = view(bytes), cars = [];
    for (let i = 0; i < CUSTOM_COUNT; i++) {
      const base = customCarBase(i);
      const car = dv.getUint32(base + CAR_REL, true);
      const listed = dv.getUint32(base + CUSTOM_HANDLE_REL, true) !== 0 && dv.getUint32(base + CUSTOM_ENABLED_REL, true) !== 0;
      if (car !== 0 && listed) cars.push({ index: i, base, car });
    }
    return cars;
  }

  // ---------------------------------------------------------------------------
  // Visual slot tables (SPEED2.EXE slot-name table and slot->descriptor-type map)
  // ---------------------------------------------------------------------------

  const NAMES = [
    'BASE', 'FRONT_BUMPER', 'REAR_BUMPER', 'LEFT_SIDE_MIRROR', 'RIGHT_SIDE_MIRROR', 'BODY', 'WIDE_BODY',
    'ROOF', 'TOP', 'HOOD', 'TRUNK', 'SKIRT', 'SPOILER', 'ENGINE', 'HEADLIGHT', 'BRAKELIGHT', 'EXHAUST',
    'DOOR_LEFT', 'DOOR_RIGHT', 'DOOR_PANEL_LEFT', 'DOOR_PANEL_RIGHT', 'DOOR_SILL_LEFT', 'DOOR_SILL_RIGHT',
    'FENDER', 'QUARTER', 'HOOD_UNDER', 'TRUNK_UNDER', 'FRONT_BRAKE', 'REAR_BRAKE', 'FRONT_WHEEL',
    'REAR_WHEEL', 'SPINNER', 'WING_MIRROR', 'LICENSE_PLATE', 'TRUNK_AUDIO',
    ...Array.from({ length: 12 }, (_, i) => `TRUNK_AUDIO_COMP_${i}`),
    'DAMAGE_FRONT', 'DAMAGE_REAR', 'DAMAGE_LEFT', 'DAMAGE_RIGHT', 'DAMAGE_TOP',
    'DECAL_HOOD', 'DECAL_FRONT_WINDOW', 'DECAL_REAR_WINDOW', 'DECAL_LEFT_DOOR', 'DECAL_RIGHT_DOOR',
    'DECAL_LEFT_QUARTER', 'DECAL_RIGHT_QUARTER', 'WIDEBODY_DECAL_LEFT_DOOR', 'WIDEBODY_DECAL_RIGHT_DOOR',
    'WIDEBODY_DECAL_LEFT_QUARTER', 'WIDEBODY_DECAL_RIGHT_QUARTER', 'BASE_PAINT',
    ...Array.from({ length: 4 }, (_, i) => `VINYL_LAYER${i}`),
    'PAINT_ENGINE', 'PAINT_SPOILER', 'PAINT_BRAKE', 'PAINT_EXHAUST', 'PAINT_AUDIO', 'PAINT_RIM',
    'PAINT_SPINNER', 'PAINT_ROOF', 'PAINT_MIRROR',
    ...Array.from({ length: 16 }, (_, i) => `VINYL_COLOUR${Math.floor(i / 4)}_${i % 4}`),
    'KIT_CARBON', 'HOOD_CARBON', 'DOOR_CARBON', 'TRUNK_CARBON',
    ...['HOOD', 'FRONT_WINDOW', 'REAR_WINDOW', 'LEFT_DOOR', 'RIGHT_DOOR', 'LEFT_QUARTER', 'RIGHT_QUARTER']
      .flatMap((where) => Array.from({ length: 8 }, (_, i) => `DECAL_${where}_TEX${i}`)),
    'WINDOW_TINT', 'NEON', 'NEON_ENGINE', 'NEON_CABIN', 'NEON_TRUNK', 'CABIN_NEON_FRAME',
    'HEADLIGHT_BULB', 'DOOR_STYLE', 'HYDRAULICS', 'NOS_PURGE', 'CUSTOM_HUD',
    'HUD_BACKING_COLOUR', 'HUD_NEEDLE_COLOUR', 'HUD_CHARACTER_COLOUR', 'CV', 'WHEEL_MANUFACTURER', 'MISC',
  ];

  // SPEED2.EXE 0x802960: the save's 170 slots map onto the database's 69 part types.
  const TYPES = [
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 27, 28, 28, 29, 30, 31,
    60, 61, 61, 62, 62, 63, 63, 61, 61, 61, 61, 62, 62, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48,
    50, 50, 50, 50, 48, 48, 48, 48, 48, 48, 48, 48, 48,
    ...Array(16).fill(49), 51, 51, 51, 51, ...Array(56).fill(52),
    53, 54, 54, 54, 54, 55, 56, 57, 58, 59, 64, 65, 65, 65, 66, 67, 68,
  ];

  const UG1 = new Set([0x3455d6b, 0x163087, 0xdb7c, 0xdc00, 0xac6d1, 0x150fb80, 0x290c04d, 0x2ca04df,
    0x72b2e513, 0x3b8c48a, 0x4fd0522, 0x545aec60, 0x7502da84, 0x79aebfec, 0xbe48375e]);
  const UG2 = new Set([0x30236ee, 0xacc9, 0x453, 0x6e7, 0xa86e, 0xdc01, 0x293fad7, 0x4b10070a,
    0x9d2eff6, 0x2d7c9b5d, 0x35165819, 0xcf4458f8, 0xf77c13eb]);
  const SUV = new Set([0x219c94a, 0x6126dd4d, 0xcf704771]);

  /** Internal names of the stock cars, used for labels before GLOBALB.BUN is loaded. */
  const KNOWN_CARS = ['350Z', '240SX', '3000GT', 'A3', 'CELICA', 'COROLLA', 'CIVIC', 'ECLIPSE', 'FOCUS', 'G35',
    'GOLF', 'GTO', 'HUMMER', 'IMPREZAWRX', 'IS300', 'LANCEREVO8', 'MUSTANGGT', 'NAVIGATOR', 'PEUGOT', 'PEUGOT106', 'RSX',
    'RX7', 'RX8', 'SENTRA', 'SKYLINE', 'ESCALADE', 'CORSA', 'TIBURON', 'TT', 'MIATA', 'SUPRA'];
  const KNOWN_CAR_NAMES = new Map(KNOWN_CARS.map((name) => [gameHash(name), name]));

  const FRIENDLY = {
    FRONT_BUMPER: 'Front bumper', REAR_BUMPER: 'Rear bumper', LEFT_SIDE_MIRROR: 'Left mirror',
    RIGHT_SIDE_MIRROR: 'Right mirror', WIDE_BODY: 'Widebody kit', ROOF: 'Roof scoop', TOP: 'Roof top',
    HOOD: 'Hood', TRUNK: 'Trunk', SKIRT: 'Side skirts', SPOILER: 'Spoiler', ENGINE: 'Engine',
    HEADLIGHT: 'Headlights', BRAKELIGHT: 'Tail lights', EXHAUST: 'Exhaust tip', FRONT_WHEEL: 'Rims',
    SPINNER: 'Spinners', WING_MIRROR: 'Wing mirrors', TRUNK_AUDIO: 'Trunk audio layout',
    BASE_PAINT: 'Body paint', PAINT_ENGINE: 'Engine / hoses paint', PAINT_SPOILER: 'Spoiler paint',
    PAINT_BRAKE: 'Caliper paint', PAINT_EXHAUST: 'Muffler paint', PAINT_AUDIO: 'Audio paint',
    PAINT_RIM: 'Rim paint', PAINT_SPINNER: 'Spinner paint', PAINT_ROOF: 'Roof paint', PAINT_MIRROR: 'Mirror paint',
    KIT_CARBON: 'Carbon body kit', HOOD_CARBON: 'Carbon hood', DOOR_CARBON: 'Carbon doors',
    TRUNK_CARBON: 'Carbon trunk', WINDOW_TINT: 'Window tint', NEON: 'Underglow neon', NEON_ENGINE: 'Engine neon',
    NEON_CABIN: 'Cabin neon', NEON_TRUNK: 'Trunk neon', HEADLIGHT_BULB: 'Headlight bulbs',
    DOOR_STYLE: 'Door style', HYDRAULICS: 'Hydraulics', NOS_PURGE: 'NOS purge', CUSTOM_HUD: 'Custom gauges',
    HUD_BACKING_COLOUR: 'Gauge backing colour', HUD_NEEDLE_COLOUR: 'Gauge needle colour',
    HUD_CHARACTER_COLOUR: 'Gauge digit colour',
  };

  function label(name) {
    if (FRIENDLY[name]) return FRIENDLY[name];
    let m = /^VINYL_LAYER(\d)$/.exec(name);
    if (m) return `Vinyl layer ${+m[1] + 1}`;
    m = /^VINYL_COLOUR(\d)_(\d)$/.exec(name);
    if (m) return `Vinyl ${+m[1] + 1} colour ${+m[2] + 1}`;
    m = /^TRUNK_AUDIO_COMP_(\d+)$/.exec(name);
    if (m) return `Audio component ${+m[1] + 1}`;
    m = /^DECAL_(.+)_TEX(\d)$/.exec(name);
    if (m) return `${m[1].toLowerCase().replace(/_/g, ' ')} decal ${+m[2] + 1}`;
    return name.charAt(0) + name.slice(1).toLowerCase().replace(/_/g, ' ');
  }

  function category(id) {
    if ([29, 31].includes(id)) return ['BODY', 'Wheels'];
    if ([1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 32].includes(id)) return ['BODY', 'Body parts'];
    if (id >= 93 && id <= 96) return ['BODY', 'Carbon fibre'];
    if (id === 63 || (id >= 68 && id <= 76)) return ['PAINT', 'Paint'];
    if (id >= 64 && id <= 67) return ['GRAPHICS', 'Vinyl layers'];
    if (id >= 77 && id <= 92) return ['GRAPHICS', 'Vinyl colours'];
    if (id >= 105 && id <= 152) return ['GRAPHICS', 'Decals'];
    if (id === 153) return ['SPECIALTIES', 'Window tint'];
    if (id >= 34 && id <= 46) return ['SPECIALTIES', 'Trunk audio'];
    if ((id >= 154 && id <= 157) || id === 159) return ['SPECIALTIES', 'Lighting'];
    if (id >= 160 && id <= 162) return ['SPECIALTIES', 'Specialties'];
    if (id >= 163 && id <= 166) return ['SPECIALTIES', 'Gauges'];
    return null;
  }

  /** The 126 slots the editor lets you change; geometry, damage and bookkeeping slots are left alone. */
  const VISUAL_SLOTS = NAMES.flatMap((name, id) => {
    const cat = category(id);
    return cat ? [{ id, name, label: label(name), tab: cat[0], category: cat[1] }] : [];
  });

  /**
   * Slots where the game itself stores 0 for "nothing": spinners, vinyl layers, the secondary paints
   * (hoses, spoiler, calipers, muffler, audio, rims, spinners, roof, mirrors) and decal textures. A car
   * the game sets up from scratch has 0 in all of them. Every other slot uses a named part for "stock"
   * or "none" (STOCK, NO WIDEBODY, NO ROOF SCOOP, CARBON FIBRE NONE, NO NEON, NO HYDRAULICS...).
   */
  function isNoneSlot(slot) {
    return slot === 31 || (slot >= 64 && slot <= 76) || (slot >= 105 && slot <= 152);
  }

  /** The vinyl colours a new car gets for each of its four vinyl layers. */
  const DEFAULT_VINYL_COLOURS = ['VINYL_L1_COLOR09', 'VINYL_L1_COLOR02', 'VINYL_L2_COLOR11', 'VINYL_L1_COLOR01'].map(gameHash);

  function isColorSlot(slot) {
    return slot === 63 || (slot >= 68 && slot <= 92) || (slot >= 164 && slot <= 166);
  }

  /** The frontend's paint-category filter (attribute 0xEBB03E66): gloss/metal/pearl, hoses, calipers, mufflers, rims, vinyl. */
  function paintCategories(slot) {
    if ([63, 69, 75, 76].includes(slot)) return [0x2daab07, 0x3437a52, 0x3797533];
    if (slot === 68) return [0x16bdce];
    if (slot === 70) return [0xd6640dff];
    if (slot === 71) return [0x66350f0];
    if (slot === 73 || slot === 74) return [0xda27];
    if (slot >= 77 && slot <= 92) return [0x3e871f1];
    return null;
  }

  // ---------------------------------------------------------------------------
  // GLOBALB.BUN reader
  // ---------------------------------------------------------------------------

  /**
   * EA's JDLZ compression: the PC game ships GLOBAL\\GlobalB.lzc, a JDLZ-packed GLOBALB.BUN.
   * Header: "JDLZ", 0x02, 0x10, 2 bytes padding, uncompressed size, compressed size (uint32 LE).
   */
  function isJdlz(bytes) {
    return bytes.length >= 16 && bytes[0] === 0x4a && bytes[1] === 0x44 && bytes[2] === 0x4c && bytes[3] === 0x5a;
  }

  function decompressJdlz(bytes) {
    if (!isJdlz(bytes) || bytes[4] !== 2 || bytes[5] !== 0x10) throw new Error('Unsupported JDLZ file.');
    const size = view(bytes).getUint32(8, true), out = new Uint8Array(size);
    let i = 16, o = 0, flags1 = 1, flags2 = 1;
    while (i < bytes.length && o < size) {
      if (flags1 === 1) flags1 = bytes[i++] | 0x100;
      if (flags2 === 1) flags2 = bytes[i++] | 0x100;
      if (flags1 & 1) {
        let length, distance;
        if (flags2 & 1) {
          length = (bytes[i + 1] | ((bytes[i] & 0xf0) << 4)) + 3;
          distance = (bytes[i] & 0x0f) + 1;
        } else {
          distance = (bytes[i + 1] | ((bytes[i] & 0xe0) << 3)) + 17;
          length = (bytes[i] & 0x1f) + 3;
        }
        i += 2;
        if (distance > o || o + length > size) throw new Error('Corrupt JDLZ data.');
        for (let k = 0; k < length; k++, o++) out[o] = out[o - distance];
        flags2 >>= 1;
      } else {
        out[o++] = bytes[i++];
      }
      flags1 >>= 1;
    }
    if (o !== size) throw new Error('Truncated JDLZ data.');
    return out;
  }

  const CHUNK_CARS = 0x34600;
  const CAR_STRIDE = 0x890;
  const CAR_HASH_REL = 0xd0;
  const CAR_STOCK_PAINT_REL = 0x84c;

  function parseCars(bytes, chunks) {
    const c = chunks.get(CHUNK_CARS);
    if (!c) throw new Error('This file is not GLOBAL\\GLOBALB.BUN from NFSU2 (car table not found).');
    const dv = view(bytes), end = c.off + c.size;
    let start = c.off;
    while (start < c.off + 16 && bytes[start] === 0x11) start++;
    const cars = [];
    for (let base = start; base + CAR_STRIDE <= end; base += CAR_STRIDE) {
      let name = '';
      for (let k = 0; k < 0x20 && bytes[base + k]; k++) name += String.fromCharCode(bytes[base + k]);
      // +0x84C: the car's factory paint (+0x850 an alternative), what a new car is given.
      cars.push({ name, hash: dv.getUint32(base + CAR_HASH_REL, true), stockPaint: dv.getUint32(base + CAR_STOCK_PAINT_REL, true) });
    }
    if (!cars.length) throw new Error('This file is not GLOBAL\\GLOBALB.BUN from NFSU2 (car table is empty).');
    return cars;
  }

  function parseGameData(input) {
    let bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (isJdlz(bytes)) bytes = decompressJdlz(bytes);
    const dv = view(bytes);
    const chunks = new Map();
    (function walk(start, end) {
      for (let off = start; off + 8 <= end;) {
        const id = dv.getUint32(off, true), size = dv.getUint32(off + 4, true), next = off + 8 + size;
        if (next > end) throw new Error('Truncated game-data chunk; is this GLOBAL\\GLOBALB.BUN?');
        if (id & 0x80000000) walk(off + 8, next);
        else if (id === CHUNK_CARS || (id >= 0x34603 && id <= 0x3460c)) {
          if (chunks.has(id)) throw new Error(`Multiple visual databases are not supported (chunk ${id.toString(16)}).`);
          chunks.set(id, { off: off + 8, size });
        }
        off = next;
      }
    })(0, bytes.length);

    const cars = parseCars(bytes, chunks);
    const chunk = (id, stride) => {
      const c = chunks.get(id);
      if (!c || !c.size || c.size % stride) throw new Error(`Missing or invalid visual chunk ${id.toString(16)}.`);
      return bytes.subarray(c.off, c.off + c.size);
    };
    const header = chunk(0x34603, 4), rawDescriptors = chunk(0x34604, 1);
    if (header.length !== 60) throw new Error('Invalid visual database header.');
    const descriptorSize = view(header).getUint32(56, true) * 14;
    if (descriptorSize === 0 || descriptorSize > rawDescriptors.length || rawDescriptors.length - descriptorSize > 3) {
      throw new Error('Invalid visual descriptor count.');
    }
    const descriptors = rawDescriptors.subarray(0, descriptorSize), strings = chunk(0x34606, 1);
    const lists = chunk(0x3460c, 2), attributes = chunk(0x34605, 8), groups = chunk(0x3460b, 4);
    const tables = chunk(0x34607, 1);
    if (tables.length < VISUAL_COUNT * 8 || (tables.length - VISUAL_COUNT * 8) % 16) {
      throw new Error('Invalid visual compatibility table.');
    }
    const td = view(tables), dd = view(descriptors), ld = view(lists), ad = view(attributes), gd = view(groups);
    const defaults = Array.from({ length: VISUAL_COUNT * 2 }, (_, i) => td.getUint32(i * 4, true));
    const overrides = new Map();
    for (let off = VISUAL_COUNT * 8; off < tables.length; off += 16) {
      const car = td.getUint32(off, true), slot = td.getUint32(off + 4, true);
      if (slot >= VISUAL_COUNT) throw new Error('Invalid visual override slot.');
      overrides.set(`${car}:${slot}`, [td.getUint32(off + 8, true), td.getUint32(off + 12, true)]);
    }
    const decoder = new TextDecoder('windows-1252');
    const rgbKeys = ['RED', 'GREEN', 'BLUE'].map(gameHash);
    const parts = [];
    for (let off = 0; off < descriptors.length; off += 14) {
      const nameOff = dd.getUint16(off + 8, true) * 4, nameEnd = strings.indexOf(0, nameOff);
      const groupOff = descriptors[off + 7] * 4, list = dd.getUint16(off + 10, true);
      if (nameOff >= strings.length || nameEnd < nameOff || groupOff + 4 > groups.length || descriptors[off + 4] > 68) {
        throw new Error('Invalid visual descriptor.');
      }
      const attrs = new Map();
      if (list !== 0xffff) {
        const start = list * 2;
        if (start + 2 > lists.length) throw new Error('Invalid visual attribute list.');
        const count = ld.getUint16(start, true);
        if (start + 2 + count * 2 > lists.length) throw new Error('Truncated visual attribute list.');
        for (let i = 0; i < count; i++) {
          const pos = ld.getUint16(start + 2 + i * 2, true) * 8;
          if (pos + 8 > attributes.length) throw new Error('Invalid visual attribute index.');
          const key = ad.getUint32(pos, true), values = attrs.get(key) || [];
          values.push(ad.getUint32(pos + 4, true));
          attrs.set(key, values);
        }
      }
      const rgb = rgbKeys.map((k) => (attrs.get(k) || [])[0]);
      parts.push({
        hash: dd.getUint32(off, true),
        name: decoder.decode(strings.subarray(nameOff, nameEnd)),
        type: descriptors[off + 4],
        level: descriptors[off + 5] >> 5,
        variant: descriptors[off + 5] & 31,
        group: gd.getUint32(groupOff, true),
        attributes: attrs,
        color: rgb.every((n) => n !== undefined && n <= 255)
          ? '#' + rgb.map((n) => n.toString(16).padStart(2, '0')).join('') : '',
      });
    }
    return new VisualCatalog(parts, defaults, overrides, cars);
  }

  // ---------------------------------------------------------------------------
  // Catalogue: per-car options and edits that follow the game's linked-slot rules
  // ---------------------------------------------------------------------------

  class VisualCatalog {
    constructor(parts, defaults, overrides, cars) {
      this.parts = parts;
      this.defaults = defaults;
      this.overrides = overrides;
      this.cars = cars;
      this.carNames = new Map(cars.map((c) => [c.hash, c.name]));
      this.stockPaints = new Map(cars.map((c) => [c.hash, c.stockPaint]));
      this.optionCache = new Map();
    }

    carName(car) {
      return this.carNames.get(car);
    }

    options(car, slot) {
      if (!Number.isInteger(slot) || slot < 0 || slot >= VISUAL_COUNT) throw new RangeError('Invalid visual slot.');
      if (!this.carNames.has(car)) return [];
      const key = `${car}:${slot}`, cached = this.optionCache.get(key);
      if (cached) return cached;
      const groups = this.overrides.get(key) ||
        this.defaults.slice(slot * 2, slot * 2 + 2).map((g) => (g === 0xffffffff ? car : g));
      const parts = groups.flatMap((group) => this.parts.filter((p) => p.group === group && p.type === TYPES[slot] &&
        !(UG1.has(p.group) && this.attribute(p, 'EXCLUDE_UG1')) &&
        !(UG2.has(p.group) && this.attribute(p, 'EXCLUDE_UG2')) &&
        !(SUV.has(p.group) && this.attribute(p, 'EXCLUDE_SUV'))));
      this.optionCache.set(key, parts);
      return parts;
    }

    attribute(part, name) {
      const values = part && part.attributes.get(gameHash(name));
      return values ? values[0] : 0;
    }

    selectableOptions(car, slot) {
      const categories = paintCategories(slot);
      // DUMMY is the catalogue's internal placeholder part, not something the game offers.
      return this.options(car, slot).filter((part) => part.name !== 'DUMMY' && (!categories ||
        categories.includes((part.attributes.get(0xebb03e66) || [0])[0])));
    }

    part(car, slot, hash) {
      return this.options(car, slot).find((p) => p.hash === hash);
    }

    /**
     * What a car fresh from the game has in this slot: 0 where the game stores nothing, the car's
     * factory paint for the body, the default vinyl colours, otherwise the first level-0 part (STOCK,
     * NO WIDEBODY, NO NEON, ...). null when the stock value is not known for this car.
     */
    stockValue(car, slot) {
      if (slot === 63) {
        const paint = this.stockPaints.get(car);
        return this.selectableOptions(car, 63).some((p) => p.hash === paint) ? paint : null;
      }
      if (slot >= 77 && slot <= 92) return DEFAULT_VINYL_COLOURS[(slot - 77) % 4];
      if (isNoneSlot(slot)) return 0;
      const stock = this.selectableOptions(car, slot).find((p) => p.level === 0);
      return stock ? stock.hash : null;
    }

    /**
     * Resets the given editable slots (default: all) to stock, in place. The widebody kit and carbon
     * go first so bumpers, doors and vinyl exclusions follow the game's rules. Returns the slots that
     * could not be reset (no known stock value for this car).
     */
    resetToStock(bytes, base, slots = VISUAL_SLOTS.map((s) => s.id)) {
      const car = readCarHash(bytes, base), skipped = [];
      const order = [...slots].sort((a, b) => (a === 6 ? -1 : b === 6 ? 1 : a === 93 ? -1 : b === 93 ? 1 : a - b));
      for (const slot of order) {
        // No such part on this car (e.g. separate mirrors); "none" slots can always be cleared.
        if (!isNoneSlot(slot) && !this.options(car, slot).length) continue;
        const value = this.stockValue(car, slot);
        if (value === null) { skipped.push(slot); continue; }
        if (readVisual(bytes, base)[slot] === value) continue;
        try {
          this.edit(bytes, base, slot, value);
        } catch {
          skipped.push(slot);
        }
      }
      return skipped;
    }

    /** Slots hidden by installed parts (widebody hides bumpers/skirts, some kits hide named slots). */
    hidden(refs, car, slot) {
      if (slot === 69) return false;
      const wide = this.part(car, 6, refs[6]);
      if (wide && wide.level > 0 && [1, 2, 5, 11, 23, 24].includes(slot)) return true;
      const key = gameHash(NAMES[slot]);
      return refs.some((hash, i) => {
        if (hash === 0) return false;
        const p = this.part(car, i, hash);
        return !!p && (p.attributes.get(0xe80a3b62) || []).includes(key);
      });
    }

    /**
     * Sets one visual slot of the record at `base`, in place, and applies the dependent slots
     * the game's own setter changes (both wheels, audio components, under-hood, widebody doors,
     * carbon/vinyl exclusions, and the derived aero flags at +0x310).
     */
    edit(bytes, base, visual, hash) {
      if (!VISUAL_SLOTS.some((s) => s.id === visual)) throw new RangeError('This visual slot is derived or not editable.');
      const car = readCarHash(bytes, base);
      const refs = readVisual(bytes, base);
      const part = this.part(car, visual, hash);
      if (hash === 0 && !isNoneSlot(visual)) throw new RangeError('The game has no empty value here; choose the stock part instead.');
      if (hash !== 0 && !part) throw new RangeError('This part is not compatible with this car and slot.');
      if (hash !== 0 && !this.selectableOptions(car, visual).some((p) => p.hash === hash)) {
        throw new RangeError('This colour belongs to a different paint category.');
      }
      if (this.hidden(refs, car, visual)) throw new RangeError('This slot is hidden by the installed parts.');
      refs[visual] = hash;
      if (visual === 29) refs[30] = hash;
      if (visual === 34) {
        for (let i = 35; i <= 46; i++) {
          const stock = this.options(car, i).find((p) => p.level === 0);
          refs[i] = stock ? stock.hash : 0;
        }
      }
      if (visual === 9) {
        const under = this.part(car, 25, this.attribute(part, 'HOODUNDER')) || this.options(car, 25)[0];
        refs[25] = under ? under.hash : 0;
        if (this.attribute(part, 'CARBONFIBRE')) this.clearVinyls(refs, car, (p) => p.variant === 20);
      }
      if (visual === 6) {
        const wide = !!part && part.level !== 0;
        const prefix = `${this.carNames.get(car)}_`;
        ['LEFT', 'RIGHT', 'PANEL_LEFT', 'PANEL_RIGHT', 'SILL_LEFT', 'SILL_RIGHT'].forEach((name, i) => {
          const wanted = wide ? gameHash(`${prefix}KITW0${part.variant}_DOOR_${name}`) : 0;
          const door = this.options(car, 17 + i).find((p) => !wanted || p.hash === wanted);
          refs[17 + i] = door ? door.hash : 0;
        });
        if (wide) {
          ['LEFT_DOOR', 'RIGHT_DOOR', 'LEFT_QUARTER', 'RIGHT_QUARTER'].forEach((name, i) => {
            const decal = this.part(car, 59 + i, gameHash(`${prefix}WIDE${part.variant}_DECAL_${name}_RECT_MEDIUM`));
            refs[59 + i] = decal ? decal.hash : 0;
          });
        }
      }
      const levelOf = (slot) => (this.part(car, slot, refs[slot]) || { level: 0 }).level;
      if ((visual === 6 || visual === 93) && levelOf(93) > 0) {
        if (levelOf(6) > 0 || visual === 6) this.clearVinyls(refs, car, (p) => p.variant !== 20);
        else this.clearVinyls(refs, car, (p) => [14, 15, 21, 22, 23, 24, 25, 26].includes(p.variant));
      }
      const dv = view(bytes);
      refs.forEach((value, i) => dv.setUint32(base + VISUAL_REL + i * 4, value, true));
      if ([1, 2, 6, 11, 12].includes(visual)) {
        const start = base + PERF_REL;
        bytes.fill(0, start + 56, start + 68);
        const wide = levelOf(6) > 0;
        for (const [partSlot, first] of [[1, 56], [2, 62], [11, 59], [12, 65]]) {
          const level = wide ? 3 : Math.min(levelOf(partSlot), 3);
          if (level) bytes[start + first + level - 1] = 1;
        }
      }
      return bytes;
    }

    clearVinyls(refs, car, predicate) {
      for (let i = 64; i <= 67; i++) {
        const part = this.part(car, i, refs[i]);
        if (part && predicate(part)) refs[i] = 0;
      }
    }
  }

  function colorPalettes(parts) {
    const palettes = new Map();
    for (const part of parts) {
      const match = /^(.*?)(\d+)(\D*)$/.exec(part.name);
      const name = match ? `${match[1]}##${match[3]}`.replace(/^HOSES_L3_(?:TEST|COLOR)##$/, 'HOSES_L3') : 'Colours';
      const entries = palettes.get(name) || [];
      entries.push({ part, order: match ? Number(match[2]) : entries.length });
      palettes.set(name, entries);
    }
    return [...palettes].map(([name, entries]) => ({
      name: name.replace('##', '#').replace(/_/g, ' ').trim(),
      parts: entries.sort((a, b) => a.order - b.order).map((e) => e.part),
    }));
  }

  /**
   * Marks every part of every category as bought for this garage car, so the garage's Body Parts
   * Storage lists them all. Touches only the ownership fields above; needs no game data.
   */
  function ownAllParts(bytes, base) {
    const sub = base + PURCHASED_REL;
    for (const item of OWNED_ITEMS) bytes.fill(0xff, sub + item * 4, sub + item * 4 + 4);
    for (const [off, len] of OWNED_AREAS) bytes.fill(0xff, sub + off, sub + off + len);
    const rims = rimBitsFor(readCarHash(bytes, base));
    if (rims) {
      bytes.fill(0, sub + OWNED_RIMS_REL, sub + OWNED_RIMS_REL + 256);
      for (const n of rims) if (n >= GARAGE_RIM_BUG_BITS) bytes[sub + OWNED_RIMS_REL + (n >> 3)] |= 1 << (n & 7);
    }
    return bytes;
  }

  function ownsAllParts(bytes, base) {
    const sub = base + PURCHASED_REL;
    return OWNED_ITEMS.every((item) => bytes.subarray(sub + item * 4, sub + item * 4 + 4).every((b) => b === 0xff)) &&
      OWNED_AREAS.every(([off, len]) => bytes.subarray(sub + off, sub + off + len).every((b) => b === 0xff)) &&
      (rimBitsFor(readCarHash(bytes, base)) || []).every((n) => n < GARAGE_RIM_BUG_BITS || (bytes[sub + OWNED_RIMS_REL + (n >> 3)] >> (n & 7)) & 1);
  }

  // ---------------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------------

  const TABS = [['BODY', 'Body & wheels'], ['PAINT', 'Paint'], ['GRAPHICS', 'Vinyls & decals'], ['SPECIALTIES', 'Specialties']];
  let catalog = null;
  let catalogFile = '';

  function bridge() {
    return root.NFSU2Bridge || null;
  }

  function currentSave() {
    const b = bridge();
    return b ? b.getSave() : null;
  }

  function toast(message) {
    const b = bridge();
    if (b) b.toast(message);
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  }

  function hex8(n) {
    return '0x' + (n >>> 0).toString(16).toUpperCase().padStart(8, '0');
  }

  function carLabel(car) {
    return (catalog && catalog.carName(car)) || KNOWN_CAR_NAMES.get(car) || hex8(car);
  }

  function partLabel(part, car) {
    const prefix = `${carLabel(car)}_`;
    return part.name.startsWith(prefix) ? part.name.slice(prefix.length) : part.name;
  }

  /** Parses GLOBALB.BUN bytes and makes them the active part catalogue. */
  function loadGameData(input, name) {
    let bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (isJdlz(bytes)) bytes = decompressJdlz(bytes);
    catalog = parseGameData(bytes);
    catalogFile = name;
    // js/career.js reads the career tables from the same file.
    if (typeof root.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
      root.dispatchEvent(new CustomEvent('nfsu2:gamedata', { detail: { bytes, name } }));
    }
    toast(`Loaded ${name}: ${catalog.parts.length.toLocaleString()} parts for ${catalog.cars.length} cars`);
    renderCustomCars();
    return catalog;
  }

  /** Picks the GLOBALB.BUN via a hidden file input; resolves once parsed. */
  function pickGameData() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.bun,.BUN,.lzc,.LZC';
      input.addEventListener('change', async () => {
        const file = input.files && input.files[0];
        if (!file) return resolve(false);
        try {
          loadGameData(await file.arrayBuffer(), file.name);
          resolve(true);
        } catch (err) {
          toast(`Game data error: ${err.message}`);
          resolve(false);
        }
      });
      input.click();
    });
  }

  // --- Dialog ---------------------------------------------------------------

  let dialog = null;
  let state = null; // { title, getBytes, base, length, garage, draft (copy), tab, openPalette }

  function ensureDialog() {
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.className = 've-dialog';
    dialog.setAttribute('aria-labelledby', 've-title');
    dialog.addEventListener('close', () => { state = null; });
    dialog.addEventListener('click', onDialogClick);
    dialog.addEventListener('change', onDialogChange);
    document.body.appendChild(dialog);
    return dialog;
  }

  /**
   * Opens the editor for one car record.
   * @param {string} title Heading, e.g. "Slot 2" or "Custom Car 3".
   * @param {() => Uint8Array} getBytes Returns the live bytes holding the record.
   * @param {number} base Record base (offset of the car's +0x00 in the editor's slot model).
   * @param {boolean} garage Career/GARAGE.DAT record (has purchased parts) rather than a Quick Race custom car.
   */
  function openEditor(title, getBytes, base, garage) {
    const bytes = getBytes();
    const length = garage ? GARAGE_RECORD_LEN : CUSTOM_RECORD_LEN;
    state = { title, getBytes, base, length, garage, draft: bytes.slice(), tab: 'BODY', openPalette: null };
    ensureDialog();
    renderDialog();
    if (!dialog.open) dialog.showModal();
  }

  function draftDirty() {
    const live = state.getBytes();
    const start = state.base, end = state.base + state.length;
    for (let i = start; i < end; i++) if (live[i] !== state.draft[i]) return true;
    return false;
  }

  function renderDialog() {
    const car = readCarHash(state.draft, state.base);
    const refs = readVisual(state.draft, state.base);
    const head = `
      <div class="ve-head">
        <div>
          <h2 id="ve-title">Customise — ${escapeHtml(state.title)}</h2>
          <span class="ve-sub">${escapeHtml(carLabel(car))}${catalog ? ` · parts from ${escapeHtml(catalogFile)}` : ''}</span>
        </div>
        <button type="button" class="btn btn-xs btn-ghost" data-ve="close" aria-label="Close">✕</button>
      </div>`;
    if (!catalog) {
      dialog.innerHTML = head + `
        <div class="ve-body ve-empty">
          <p>Part lists (rims, spoilers, body kits, paints…) come from your own copy of the game, so the editor only offers parts that fit this car.</p>
          <p>Load <code>GLOBAL\\GlobalB.lzc</code> (or an unpacked <code>GLOBALB.BUN</code>) from your NFSU2 install folder. It is read locally and never uploaded.</p>
          <button type="button" class="btn btn-primary btn-sm" data-ve="load-bun">Load game data…</button>
        </div>`;
      return;
    }
    if (!catalog.carName(car)) {
      dialog.innerHTML = head + `<div class="ve-body ve-empty"><p>This car (${hex8(car)}) is not in the loaded game data.</p></div>`;
      return;
    }
    const tabs = TABS.map(([id, name]) =>
      `<button type="button" class="g-tab ${state.tab === id ? 'active' : ''}" data-ve-tab="${id}" role="tab" aria-selected="${state.tab === id}">${name}</button>`).join('');
    const groups = new Map();
    for (const slot of VISUAL_SLOTS.filter((s) => s.tab === state.tab)) {
      if (!groups.has(slot.category)) groups.set(slot.category, []);
      groups.get(slot.category).push(slot);
    }
    const sections = [...groups].map(([cat, slots]) => {
      let rows = slots.map((slot) => renderSlotRow(slot, car, refs)).filter(Boolean).join('');
      return rows ? `<section class="ve-group"><h3><span>${escapeHtml(cat)}</span>
        <button type="button" class="btn btn-xs btn-ghost" data-ve-reset="${escapeHtml(cat)}">Reset to stock</button></h3>${rows}</section>` : '';
    }).join('');
    const dirty = draftDirty();
    dialog.innerHTML = head + `
      <div class="garage-mode-tabs ve-tabs" role="tablist">${tabs}</div>
      <div class="ve-body">${sections || '<p class="ve-empty">No editable parts for this car in this category.</p>'}</div>
      <div class="ve-foot">
        <button type="button" class="btn btn-ghost btn-sm" data-ve="reset-all" title="Every part, paint, vinyl, decal and specialty back to what the game gives a new car">Reset whole car to stock</button>
        <span class="ve-note">${dirty ? 'Unapplied changes' : 'No changes'}</span>
        <button type="button" class="btn btn-ghost btn-sm" data-ve="discard" ${dirty ? '' : 'disabled'}>Discard</button>
        <button type="button" class="btn btn-primary btn-sm" data-ve="apply" ${dirty ? '' : 'disabled'}>Apply changes</button>
      </div>`;
  }

  function renderSlotRow(slot, car, refs) {
    const options = catalog.selectableOptions(car, slot.id);
    const current = refs[slot.id];
    if (!options.length && current === 0) return '';
    const stock = catalog.stockValue(car, slot.id);
    const stockTag = slot.id >= 77 && slot.id <= 92 ? 'default' : 'stock';
    const hidden = catalog.hidden(refs, car, slot.id);
    const installed = catalog.part(car, slot.id, current);
    const known = options.some((p) => p.hash === current);
    if (isColorSlot(slot.id)) {
      const swatch = installed && installed.color ? installed.color : 'transparent';
      const name = (current === 0 ? 'None' : installed ? installed.name : `Unknown ${hex8(current)}`) +
        (current === stock ? ` (${stockTag})` : '');
      const open = state.openPalette === slot.id;
      const stockPart = stock ? options.find((p) => p.hash === stock) : null;
      const quick = !open ? '' : `
        <div class="ve-palette"><span class="ve-palette-name">Quick</span><div class="ve-swatches">
          ${isNoneSlot(slot.id) ? `<button type="button" class="ve-swatch ve-swatch-none ${current === 0 ? 'selected' : ''}"
            title="None (game default)" aria-label="None" data-ve-pick="${slot.id}" data-hash="0"></button>` : ''}
          ${stockPart ? `<button type="button" class="ve-swatch ${current === stock ? 'selected' : ''}" style="background:${stockPart.color || 'transparent'}"
            title="${escapeHtml(stockPart.name)} (${stockTag})" aria-label="${stockTag}" data-ve-pick="${slot.id}" data-hash="${stock}"></button>` : ''}
        </div></div>`;
      const palettes = !open ? '' : quick + colorPalettes(options).map((pal) => `
        <div class="ve-palette"><span class="ve-palette-name">${escapeHtml(pal.name)}</span><div class="ve-swatches">
          ${pal.parts.map((p) => `<button type="button" class="ve-swatch ${p.hash === current ? 'selected' : ''}"
            style="background:${p.color || 'transparent'}" title="${escapeHtml(p.name)}${p.hash === stock ? ` (${stockTag})` : ''}" aria-label="${escapeHtml(p.name)}"
            data-ve-pick="${slot.id}" data-hash="${p.hash}"></button>`).join('')}
        </div></div>`).join('');
      return `
        <div class="ve-row ${hidden ? 'is-hidden' : ''}">
          <span class="ve-label">${escapeHtml(slot.label)}</span>
          <button type="button" class="ve-color-btn" data-ve-palette="${slot.id}" ${hidden ? 'disabled' : ''} aria-expanded="${open}">
            <span class="ve-chip" style="background:${swatch}"></span><span class="ve-color-name">${escapeHtml(name)}</span>
          </button>
          ${open ? `<div class="ve-palettes">${palettes}</div>` : ''}
        </div>`;
    }
    const opts = [];
    if (isNoneSlot(slot.id)) {
      opts.push(`<option value="0" ${current === 0 ? 'selected' : ''}>— None —${stock === 0 ? ` (${stockTag})` : ''}</option>`);
    } else if (current === 0) {
      opts.push('<option value="0" selected disabled>— Empty (not a game value) —</option>');
    }
    if (current !== 0 && !known) {
      opts.push(`<option value="${current}" selected>${escapeHtml(installed ? installed.name : 'Unknown ' + hex8(current))}</option>`);
    }
    // The stock part first, then the rest in catalogue order.
    const ordered = [...options.filter((p) => p.hash === stock), ...options.filter((p) => p.hash !== stock)];
    for (const p of ordered) {
      opts.push(`<option value="${p.hash}" ${p.hash === current ? 'selected' : ''}>${escapeHtml(partLabel(p, car))}${p.hash === stock ? ` (${stockTag})` : ''}</option>`);
    }
    return `
      <label class="ve-row ${hidden ? 'is-hidden' : ''}">
        <span class="ve-label">${escapeHtml(slot.label)}${hidden ? ' <em>(hidden by kit)</em>' : ''}</span>
        <select data-ve-slot="${slot.id}" ${hidden ? 'disabled' : ''}>${opts.join('')}</select>
      </label>`;
  }

  function resetDraft(slots, label) {
    const skipped = catalog.resetToStock(state.draft, state.base, slots);
    if (skipped.length) {
      const names = skipped.map((id) => VISUAL_SLOTS.find((s) => s.id === id)?.label || id).join(', ');
      toast(`${label}: reset to stock, except ${names} (no stock value known for this car)`);
    }
    renderDialog();
  }

  function onDialogChange(e) {
    const select = e.target.closest('[data-ve-slot]');
    if (select && state) setDraft(Number(select.dataset.veSlot), Number(select.value) >>> 0);
  }

  async function onDialogClick(e) {
    if (e.target === dialog) return dialog.close();
    if (!state) return;
    const el = e.target.closest('[data-ve],[data-ve-tab],[data-ve-palette],[data-ve-pick],[data-ve-reset]');
    if (!el) return;
    if (el.dataset.veTab) {
      state.tab = el.dataset.veTab;
      state.openPalette = null;
      return renderDialog();
    }
    if (el.dataset.vePalette) {
      const id = Number(el.dataset.vePalette);
      state.openPalette = state.openPalette === id ? null : id;
      return renderDialog();
    }
    if (el.dataset.vePick) return setDraft(Number(el.dataset.vePick), Number(el.dataset.hash) >>> 0);
    if (el.dataset.veReset) {
      const slots = VISUAL_SLOTS.filter((s) => s.tab === state.tab && s.category === el.dataset.veReset).map((s) => s.id);
      return resetDraft(slots, el.dataset.veReset);
    }
    switch (el.dataset.ve) {
      case 'close':
        return dialog.close();
      case 'load-bun':
        if (await pickGameData()) renderDialog();
        return;
      case 'reset-all':
        return resetDraft(undefined, 'Whole car');
      case 'discard':
        state.draft = state.getBytes().slice();
        return renderDialog();
      case 'apply': {
        const live = state.getBytes();
        live.set(state.draft.subarray(state.base, state.base + state.length), state.base);
        const b = bridge();
        if (b) b.refresh();
        toast(`${state.title}: visual changes applied`);
        state.draft = live.slice();
        return renderDialog();
      }
    }
  }

  // --- Garage slot cards: add a "Visuals" button --------------------------------

  function decorateSlotCards(container) {
    const save = currentSave();
    if (!save) return;
    container.querySelectorAll('.slot-card.status-in_use').forEach((card) => {
      const actions = card.querySelector('.slot-patch-actions');
      const ref = card.querySelector('[data-slot]');
      if (!actions || !ref || actions.querySelector('.btn-slot-visuals')) return;
      const slot = Number(ref.getAttribute('data-slot'));
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-xs btn-secondary btn-slot-visuals';
      btn.title = 'Rims, spoiler, body kit, paint, vinyls, neons…';
      btn.textContent = 'Visuals';
      btn.addEventListener('click', () => {
        const s = currentSave();
        if (!s) return;
        const gdat = s.isEditingGarageDat();
        const base = bridge().slotOffsets(slot, gdat).visualBase;
        const number = gdat ? slot + 6 : slot + 1;
        openEditor(`Slot ${number}`, () => currentSave().getActiveBytes(), base, true);
      });
      actions.prepend(btn);
    });
  }

  // --- Quick Race custom cars card ------------------------------------------

  let customCard = null;

  function ensureCustomCard() {
    if (customCard) return customCard;
    const garageCard = document.getElementById('garageSlotsContainer')?.closest('.card');
    if (!garageCard) return null;
    customCard = document.createElement('div');
    customCard.className = 'card ve-custom-card';
    customCard.innerHTML = `
      <div class="card-header">
        <div class="header-title-row">
          <div>
            <h2>Quick Race Custom Cars</h2>
            <span class="subtitle-inline">The cars from Quick Race → Customize, stored separately from your career garage</span>
          </div>
        </div>
        <button type="button" class="btn btn-secondary btn-sm" data-ve-load-bun>Load game data</button>
      </div>
      <div class="ve-custom-list"></div>`;
    customCard.querySelector('[data-ve-load-bun]').addEventListener('click', pickGameData);
    customCard.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-ve-custom]');
      if (!btn) return;
      const index = Number(btn.dataset.veCustom);
      openEditor(`Custom Car ${index + 1}`, () => currentSave().workingBytes, customCarBase(index), false);
    });
    garageCard.after(customCard);
    return customCard;
  }

  function renderCustomCars() {
    const save = currentSave();
    const card = ensureCustomCard();
    if (!card) return;
    const loadBtn = card.querySelector('[data-ve-load-bun]');
    loadBtn.textContent = catalog ? `✓ ${catalogFile}` : 'Load game data';
    const list = card.querySelector('.ve-custom-list');
    if (!save || save.isGarageDatFile) {
      card.hidden = !save ? true : false;
      list.innerHTML = save ? '<p class="ve-empty">Custom cars live in the career save, not in GARAGE.DAT.</p>' : '';
      return;
    }
    card.hidden = false;
    const cars = listCustomCars(save.workingBytes);
    list.innerHTML = cars.length ? cars.map((c) => `
      <div class="slot-card status-in_use ve-custom-row">
        <div class="slot-top-row">
          <div class="slot-title-group">
            <span class="slot-num">CUSTOM ${c.index + 1}</span>
            <span class="slot-car-name">${escapeHtml(carLabel(c.car))}</span>
          </div>
          <button type="button" class="btn btn-xs btn-secondary" data-ve-custom="${c.index}">Visuals</button>
        </div>
      </div>`).join('')
      : '<p class="ve-empty">This profile has no Quick Race custom cars yet. Create one in-game from Quick Race → Customize, then edit it here.</p>';
  }

  function init() {
    const container = document.getElementById('garageSlotsContainer');
    if (!container || !bridge()) return;
    new MutationObserver(() => {
      decorateSlotCards(container);
      renderCustomCars();
    }).observe(container, { childList: true });
    decorateSlotCards(container);
    renderCustomCars();
  }

  root.NFSU2Visual = {
    gameHash, ownAllParts, ownsAllParts, PURCHASED_REL, isNoneSlot, DEFAULT_VINYL_COLOURS, parseGameData, decompressJdlz,
    loadGameData, pickGameData, readVisual, readCarHash, listCustomCars, customCarBase, colorPalettes,
    VisualCatalog, VISUAL_SLOTS, VISUAL_COUNT, VISUAL_REL, PERF_REL,
  };

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }
})(typeof window !== 'undefined' ? window : globalThis);
