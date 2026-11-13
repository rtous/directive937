"use strict";

// The world map: a big square map divided into SECTORS.size x SECTORS.size sectors. Each sector is one map the
// squad plays (a "level", as levels.js describes it), generated from a fixed seed: the same world every game, and
// the same sector every time the squad comes back to it.
//
// Sectors are linked by ACCESSES: a small room at the middle of a sector edge, with a hatch, leading to the
// neighbouring sector, whose matching access sits at the same spot of the shared edge. Not every pair of
// neighbours is linked (a maze over the grid, with a few extra links). The big map's outer edge has no accesses;
// the squad first comes in through the ENTRY on its south edge.
//
// The GIANT, a huge hostile that never moves, sits in THE NEST, the middle room of the boss sector (top right).
// The hostiles come from there: the closer a sector is to it, the more of them, the sooner and the faster they
// multiply; only the entry sector and its neighbours have none (hostileSchedule).
//
// Coordinates: sector (sx, sy), sx = column A.. (west to east), sy = row 1.. (north to south).

const SECTORS = {
  size: 8,              // sectors per side
  tiles: 40,            // tiles per sector side
  seed: 937,            // the world
  entry: [3, 7],        // sector D8: where the squad first comes in, through the south edge
  boss: [7, 0],         // sector H1: THE NEST, where the giant is
  quiet: 1,             // sectors this many steps (or fewer) from the entry have no hostiles
  extraLinks: 0.18,     // share of the remaining neighbour pairs linked on top of the maze
};
const DIR = {
  north: { d: [0, -1], back: "south" }, south: { d: [0, 1], back: "north" },
  east: { d: [1, 0], back: "west" }, west: { d: [-1, 0], back: "east" },
};

// Sector names as on the map: column letter, row number ("D8")
const sectorName = (sx, sy) => `${String.fromCharCode(65 + sx)}${sy + 1}`;

// Repeatable random numbers: mulberry32, seeded from the world seed and some numbers
function seededRandom(...keys) {
  let a = keys.reduce((h, k) => Math.imul(h ^ (k + 0x9e3779b9), 2654435761) >>> 0, SECTORS.seed >>> 0);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- Which sectors are linked ----------
// A maze over the grid (every sector reachable from the entry), plus a few extra links so there are loops.
// Returns a Set of "sx,sy,dir" for every link, both ways.
const sectorLinks = (() => {
  let links = null;
  return () => {
    if (links) return links;
    links = new Set();
    const N = SECTORS.size, rnd = seededRandom(1);
    const add = (x, y, dir) => {
      const [dx, dy] = DIR[dir].d;
      links.add(`${x},${y},${dir}`);
      links.add(`${x + dx},${y + dy},${DIR[dir].back}`);
    };
    const inside = (x, y) => x >= 0 && y >= 0 && x < N && y < N;
    const seen = new Set([SECTORS.entry.join()]);
    const stack = [SECTORS.entry];
    while (stack.length) { // randomised depth-first search
      const [x, y] = stack[stack.length - 1];
      const next = Object.keys(DIR).filter((dir) => {
        const [dx, dy] = DIR[dir].d;
        return inside(x + dx, y + dy) && !seen.has(`${x + dx},${y + dy}`);
      });
      if (!next.length) { stack.pop(); continue; }
      const dir = next[Math.floor(rnd() * next.length)];
      const [dx, dy] = DIR[dir].d;
      add(x, y, dir);
      seen.add(`${x + dx},${y + dy}`);
      stack.push([x + dx, y + dy]);
    }
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      for (const dir of ["east", "south"]) {
        const [dx, dy] = DIR[dir].d;
        if (inside(x + dx, y + dy) && !links.has(`${x},${y},${dir}`) && rnd() < SECTORS.extraLinks) add(x, y, dir);
      }
    }
    return links;
  };
})();
// Named areas spanning several sectors, drawn on the paper map. Decoration only: they change nothing in the game.
// cells: [[sx1, sy1, sx2, sy2]] rectangles of sectors (inclusive); an area can be several.
const MAP_AREAS = [
  { name: "RESEARCH DIVISION", cells: [[0, 0, 2, 2], [0, 3, 1, 3]] },
  { name: "COMMS RELAY", cells: [[3, 0, 4, 0]] },
  { name: "OPERATIONS CORE", cells: [[3, 1, 4, 3], [2, 3, 2, 3]] },
  { name: "RESTRICTED ZONE", cells: [[5, 0, 7, 2]] },
  { name: "COOLING ARRAY", cells: [[5, 3, 7, 4]] },
  { name: "HABITATION RING", cells: [[0, 4, 2, 7]] },
  { name: "ENGINEERING DECKS", cells: [[4, 5, 7, 7], [3, 4, 4, 4]] },
  { name: "ENTRY CONCOURSE", cells: [[3, 5, 3, 7]] },
];

const sectorAccesses = (sx, sy) => Object.keys(DIR).filter((dir) => sectorLinks().has(`${sx},${sy},${dir}`));

// ---------- What rooms can be ----------
// name, map label, aliases, wall style, ceiling light, description
const ROOM_KINDS = [
  ["MEDLAB", "MED", ["medical", "infirmary"], ["tiles", ["console", "hatch"]], 0xd8fff0, "Medical lab. Overturned gurneys, cracked specimen tanks, a flickering surgical lamp."],
  ["CREW QUARTERS", "QTRS", ["quarters", "bunks", "dorms"], ["lockers", ["panel", "cables"]], 0xffe2b0, "Crew bunks. Belongings scattered, beds unmade, a photo taped to a locker."],
  ["OPERATIONS", "OPS", ["ops", "command"], ["console", ["panel", "cables"]], 0xcfe4ff, "Operations room. Consoles still powered, screens showing static, chairs knocked over."],
  ["STORAGE", "STOR", ["stores", "warehouse"], ["ribbed", ["hazard", "hatch"]], 0xbfc8c0, "Supply storage. Crates stacked high, some forced open, a cargo loader in the corner."],
  ["PROCESSOR", "PROC", ["atmosphere", "processor"], ["pipes", ["hazard", "cables"]], 0xffa040, "Atmosphere processing. Loud pumps, hot steam venting, amber warning lights."],
  ["MESS HALL", "MESS", ["mess", "canteen"], ["panel", ["lockers", "hatch"]], 0xfff0d0, "Mess hall. Meals left half-eaten on the tables, a coffee machine still dripping."],
  ["ARMORY", "ARMS", ["armoury", "weapons"], ["lockers", ["ribbed", "hazard"]], 0xc8ffd0, "Armory. Weapon racks mostly empty, ammo cases scattered on the floor."],
  ["PUMP ROOM", "PUMP", ["pumps"], ["pipes", ["hazard", "cables"]], 0xffb060, "Coolant pump room. Big pumps thumping, steam leaking from a cracked manifold."],
  ["REACTOR CONTROL", "CTRL", ["reactor", "control"], ["console", ["panel", "cables"]], 0xcfe4ff, "Reactor control. A long console of dials and warning lamps, the core readout flickering amber."],
  ["COMMS", "COMM", ["communications", "radio"], ["console", ["cables", "hatch"]], 0xd8fff0, "Communications room. Transmitter racks dead, one screen looping an unanswered distress call."],
  ["CARGO BAY", "CRGO", ["cargo", "bay"], ["ribbed", ["hazard", "hatch"]], 0xbfc8c0, "Cargo bay. Shipping crates, a forklift on its side, chains swinging from the gantry."],
  ["MAINTENANCE", "MNT", ["maint", "workshop"], ["panel", ["cables", "lockers"]], 0xfff0d0, "Maintenance workshop. Tools scattered across the benches, a welding rig still warm."],
  ["GENERATOR", "GEN", ["generators", "power"], ["hazard", ["pipes", "cables"]], 0xffa040, "Generator hall. One generator droning, the other dead and blackened."],
  ["HYDROPONICS", "HYDR", ["hydro", "garden", "greenhouse"], ["tiles", ["pipes", "panel"]], 0xd0ffd0, "Hydroponics bay. Racks of wilted plants under dead grow lamps, water pooling on the floor."],
  ["LABORATORY", "LAB", ["lab", "research"], ["tiles", ["console", "cables"]], 0xe0f0ff, "Research lab. Sample cases smashed open, notes scattered, a containment cell standing empty."],
  ["WATER TREATMENT", "WATR", ["water", "treatment"], ["pipes", ["ribbed", "hazard"]], 0xbfe0ff, "Water treatment. Filtration tanks gurgling, a sour chemical smell, a pump cycling on and off."],
  ["CONTROL ROOM", "CRM", ["control room"], ["console", ["panel", "hatch"]], 0xcfe4ff, "Section control room. A wall of dead monitors, one blinking cursor."],
  ["DORMITORY", "DORM", ["dorm", "barracks"], ["lockers", ["panel", "hatch"]], 0xffe2b0, "Dormitory. Rows of bunks, a radio murmuring static under a pillow."],
  ["SECURITY", "SEC", ["security", "guard post", "brig"], ["hazard", ["console", "lockers"]], 0xffd0c0, "Security post. Monitors smashed, a holding cell standing open."],
  ["CHAPEL", "CHPL", ["chapel"], ["panel", ["cables", "tiles"]], 0xfff0d0, "Small chapel. Benches pushed aside, candles burnt down to stubs."],
  ["LIBRARY", "LIB", ["library", "archive", "records"], ["panel", ["lockers", "console"]], 0xfff0d0, "Records archive. Data drives spilled from their racks, a reader still humming."],
  ["INFIRMARY", "INF", ["sick bay", "clinic"], ["tiles", ["hatch", "console"]], 0xd8fff0, "Sick bay. Beds with torn restraints, an IV stand rolling on the uneven floor."],
  ["SUBSTATION", "SUBS", ["substation", "relay"], ["cables", ["hazard", "pipes"]], 0xffc070, "Power substation. Breakers thrown, cables hanging, the hum of live current."],
  ["COOLING PLANT", "COOL", ["cooling", "chillers"], ["pipes", ["ribbed", "hazard"]], 0xbfd8ff, "Cooling plant. Chiller units sweating, condensation raining down."],
];
const NEST = ["THE NEST", "NEST", ["nest", "hive", "lair", "giant"], ["ribbed", ["pipes", "cables"]], 0xff6040,
  "A vast chamber under a towering ceiling, its walls crusted with resin. In the middle, something enormous sits perfectly still."];
const FOG_KINDS = [
  "Steam venting from a cracked pipe.", "Smoke hanging in the air, something smouldering.",
  "Thick condensation fog rolling across the floor.", "Coolant vapour leaking from a ruptured line.",
];

// How the hostiles come into a sector (overrides of VENTS in hostiles.js). None in the entry sector and the ones
// next to it (SECTORS.quiet steps or fewer from the entry). Everywhere else they come, more the closer the sector is
// to the boss sector: more of them alive at once, arriving and coming down sooner, multiplying faster.
function hostileSchedule(sx, sy) {
  if (Math.abs(sx - SECTORS.entry[0]) + Math.abs(sy - SECTORS.entry[1]) <= SECTORS.quiet) return { cap: 0, stock: 0, start: 0 };
  const far = (SECTORS.size - 1) * 2; // the most steps between two sectors
  const d = Math.abs(sx - SECTORS.boss[0]) + Math.abs(sy - SECTORS.boss[1]);
  const k = 0.3 + 0.7 * (1 - d / far); // 0.3 (the far corner) .. 1 (the boss sector)
  return {
    cap: Math.round(6 + 40 * k),       // alive at once
    stock: Math.round(2 + 6 * k),      // waiting in the ducts
    start: Math.round(3 * k),          // already in the ducts when the squad arrives
    firstArrival: Math.round(18 - 12 * k),
    grace: Math.round(32 - 24 * k),    // before the first one comes down
    doubling: Math.round(48 - 26 * k), // seconds for the number released to double
    arriveEvery: 4.5 - 2.5 * k,
  };
}

// ---------- One sector ----------
// A 3x3 layout of slots, each SLOT tiles square after a MARGIN on every side (room for the access rooms at the
// edges). Each slot holds a room, a junction (corridors just meeting) or nothing. The slots an access leads into,
// the entry's and THE NEST are always there; how many others, and how many are rooms, depends on the sector's
// density: from a single corridor between two accesses to nine rooms. Rooms always cover their slot's centre
// lines, so corridors between neighbouring slots are straight runs along those lines. A maze over the slots
// that are there (plus a few extra links) decides which are joined.
const SLOT = 11, MARGIN = 4;
const GIANT_SPACE = 2; // tiles around the giant's centre that its body fills (nobody walks there): a 5x5 square
const slotCentre = (i) => MARGIN + SLOT * i + SLOT / 2 | 0; // 9, 20, 31
const EDGE_SLOT = { north: [1, 0], south: [1, 2], east: [2, 1], west: [0, 1] }; // the slot each access leads into
const DENSITY = { // how many other slots are there, how likely each is a room, how big rooms get
  sparse: { extra: [0, 2], room: 0.3, size: [3, 7] },
  medium: { extra: [2, 5], room: 0.6, size: [3, 9] },
  dense: { extra: [8, 8], room: 0.85, size: [4, 9] },
};

const sectorCache = new Map();
function generateSector(sx, sy) {
  const key = `${sx},${sy}`;
  if (sectorCache.has(key)) return sectorCache.get(key);
  const T = SECTORS.tiles, rnd = seededRandom(2, sx, sy);
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  const between = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const name = sectorName(sx, sy);
  const isBoss = sx === SECTORS.boss[0] && sy === SECTORS.boss[1];
  const isEntry = sx === SECTORS.entry[0] && sy === SECTORS.entry[1];
  const accesses = sectorAccesses(sx, sy);
  const r0 = rnd();
  const density = isBoss ? "dense" : r0 < 0.3 ? "sparse" : r0 < 0.7 ? "medium" : "dense";
  const D = DENSITY[density];

  // ---- which slots are there ----
  const slots = [];
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) slots.push({ i, j, c: [slotCentre(i), slotCentre(j)], there: false });
  const slotAt = (i, j) => slots[j * 3 + i];
  const need = accesses.map((dir) => slotAt(...EDGE_SLOT[dir]));
  if (isEntry) need.push(slotAt(1, 2));
  if (isBoss) need.push(slotAt(1, 1));
  need.forEach((s) => { s.there = true; s.needed = true; });
  const others = slots.filter((s) => !s.there).sort(() => rnd() - 0.5);
  others.slice(0, Math.max(between(...D.extra), need.length < 2 ? 1 : 0)).forEach((s) => { s.there = true; });
  // join up whatever isn't connected, through the slots in between (they become junctions)
  const neighbours = (s) => [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([di, dj]) => [s.i + di, s.j + dj])
    .filter(([i, j]) => i >= 0 && j >= 0 && i < 3 && j < 3).map(([i, j]) => slotAt(i, j));
  for (;;) {
    const there = slots.filter((s) => s.there);
    const comp = new Set([there[0]]);
    for (let grew = true; grew;) { // the slots reachable from the first one, through slots that are there
      grew = false;
      for (const s of [...comp]) for (const n of neighbours(s)) if (n.there && !comp.has(n)) { comp.add(n); grew = true; }
    }
    const lonely = there.find((s) => !comp.has(s));
    if (!lonely) break;
    const prev = new Map([[lonely, null]]), queue = [lonely]; // shortest way from it to the connected ones
    let hit = null;
    for (let q = 0; q < queue.length && !hit; q++) {
      for (const n of neighbours(queue[q])) {
        if (prev.has(n)) continue;
        prev.set(n, queue[q]);
        if (comp.has(n)) { hit = n; break; }
        queue.push(n);
      }
    }
    for (let s = prev.get(hit); s; s = prev.get(s)) s.there = true;
  }

  // ---- rooms and junctions ----
  const kinds = [...ROOM_KINDS].sort(() => rnd() - 0.5);
  const rooms = [];
  for (const s of slots) {
    if (!s.there) continue;
    const nest = isBoss && s.i === 1 && s.j === 1;
    s.nest = nest;
    if (!nest && rnd() >= D.room) continue; // a junction: the corridors just meet at the slot's centre
    const o = [MARGIN + SLOT * s.i, MARGIN + SLOT * s.j], c = s.c;
    const w = nest ? 9 : between(...D.size), h = nest ? 9 : between(...D.size);
    const x = between(Math.max(o[0] + 1, c[0] - w + 1), Math.min(o[0] + SLOT - 1 - w, c[0]));
    const y = between(Math.max(o[1] + 1, c[1] - h + 1), Math.min(o[1] + SLOT - 1 - h, c[1]));
    const [kind, label, aliases, [base, features], light, desc] = nest ? NEST : kinds[rooms.length];
    s.room = { name: kind, label, aliases, x, y, w, h, light, desc, walls: { base, features } };
    rooms.push(s.room);
  }

  // ---- which slots are joined: a maze over those that are there, plus extra links ----
  const joins = []; // [slotA, slotB, inMaze]
  {
    const start = slots.find((s) => s.there);
    const seen = new Set([start]), stack = [start];
    while (stack.length) {
      const s = stack[stack.length - 1];
      const next = neighbours(s).filter((n) => n.there && !seen.has(n));
      if (!next.length) { stack.pop(); continue; }
      const n = pick(next);
      joins.push([s, n, true]);
      seen.add(n);
      stack.push(n);
    }
    for (const s of slots) for (const n of neighbours(s)) {
      if (!s.there || !n.there || n.i + n.j < s.i + s.j) continue;
      if (!joins.some(([a, b]) => (a === s && b === n) || (a === n && b === s)) && rnd() < 0.35) joins.push([s, n, false]);
    }
  }

  // ---- corridors, doors and lights ----
  // the tile a corridor leaving slot s toward (dx, dy) starts from: just outside its room, or its centre
  const edgeOf = (s, dx, dy) => {
    if (!s.room) return [...s.c];
    const r = s.room;
    return dx > 0 ? [r.x + r.w, s.c[1]] : dx < 0 ? [r.x - 1, s.c[1]] : dy > 0 ? [s.c[0], r.y + r.h] : [s.c[0], r.y - 1];
  };
  const corridors = [], doors = [], lights = [], corridorTiles = [];
  const junctionTiles = new Set(slots.filter((s) => s.there && !s.room).map((s) => s.c.join()));
  for (const [a, b, inMaze] of joins) {
    const [p, q] = a.i + a.j < b.i + b.j ? [a, b] : [b, a]; // p west/north of q
    const along = p.j === q.j ? [1, 0] : [0, 1];
    const [x1, y1] = edgeOf(p, along[0], along[1]), [x2, y2] = edgeOf(q, -along[0], -along[1]);
    corridors.push([x1, y1, x2, y2]);
    const tiles = [];
    for (let k = 0; k <= T; k++) {
      const t = [x1 + along[0] * k, y1 + along[1] * k];
      tiles.push(t);
      if (t[0] === x2 && t[1] === y2) break;
    }
    const inner = tiles.filter((t) => !junctionTiles.has(t.join())); // not where corridors meet
    corridorTiles.push(...inner);
    // a door now and then: next to a room, or partway along; only links off the maze may start sealed (so
    // everything can still be reached)
    if (inner.length && rnd() < 0.45) {
      const ends = [p.room && tiles[0], q.room && tiles[tiles.length - 1]].filter(Boolean);
      const door = ends.length ? pick(ends) : inner[Math.floor(inner.length / 2)];
      doors.push(!inMaze && rnd() < 0.5 ? [...door, "sealed"] : door);
    }
    for (let k = 2; k < tiles.length - 1; k += 4) {
      if (!doors.some(([dx, dy]) => dx === tiles[k][0] && dy === tiles[k][1])) lights.push(tiles[k]);
    }
  }

  // ---- the accesses to neighbouring sectors, and the entry on the big map's edge ----
  const exits = [];
  const edgeRoom = (dir, roomName, label, aliases, desc) => {
    const s = slotAt(...EDGE_SLOT[dir]), [cx, cy] = s.c;
    let room, run, door;
    if (dir === "north") { room = { x: cx - 1, y: 1, w: 3, h: 2 }; run = [cx, 3, ...edgeOf(s, 0, -1)]; door = [cx, 0]; }
    if (dir === "south") { room = { x: cx - 1, y: T - 3, w: 3, h: 2 }; run = [...edgeOf(s, 0, 1), cx, T - 4]; door = [cx, T - 1]; }
    if (dir === "east") { room = { x: T - 3, y: cy - 1, w: 2, h: 3 }; run = [...edgeOf(s, 1, 0), T - 4, cy]; door = [T - 1, cy]; }
    if (dir === "west") { room = { x: 1, y: cy - 1, w: 2, h: 3 }; run = [3, cy, ...edgeOf(s, -1, 0)]; door = [0, cy]; }
    Object.assign(room, { name: roomName, label, aliases, light: 0xff4030, desc, walls: { base: "hazard", features: ["ribbed", "hatch"] } });
    rooms.push(room);
    corridors.push(run);
    return { room, door };
  };
  for (const dir of accesses) {
    const [dx, dy] = DIR[dir].d;
    const to = sectorName(sx + dx, sy + dy);
    const U = dir.toUpperCase();
    const { room, door } = edgeRoom(dir, `${U} ACCESS`, `${U[0]}-AC`,
      [`${dir} access`, `${dir} exit`, `${dir} hatch`, `exit ${dir}`, `access ${dir}`, `sector ${to.toLowerCase()}`, to.toLowerCase()],
      `Access vestibule. A heavy hatch in the ${dir} wall, red light above it: the way through to sector ${to}.`);
    exits.push({ room: room.name, door, dir, to: [sx + dx, sy + dy] });
  }
  if (isEntry) {
    edgeRoom("south", "ENTRY", "ENTRY", ["entry", "entrance", "start", "lock"],
      "Entry lock where the squad came in from outside. The outer hatch is sealed behind them; red strobe turning.");
  }

  // ---- what's in the rooms ----
  const roomSlots = slots.filter((s) => s.room);
  // a pillar or crate stack in the bigger rooms, clear of the lines corridors cross them on
  const blocks = [];
  for (const s of roomSlots) {
    if (s.nest) continue;
    const r = s.room, bx = s.c[0] + 2, by = s.c[1] + 2;
    if (r.w >= 7 && r.h >= 6 && bx < r.x + r.w - 1 && by < r.y + r.h - 1 && rnd() < 0.6) blocks.push([bx, by, bx, by]);
  }
  // ceiling vents: one per room (off the centre lines, blocks and the giant), and over some junctions; at least one
  const vents = [];
  for (const s of roomSlots) {
    const r = s.room, spots = [];
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
      const underGiant = s.nest && Math.abs(x - s.c[0]) <= GIANT_SPACE && Math.abs(y - s.c[1]) <= GIANT_SPACE;
      if (x !== s.c[0] && y !== s.c[1] && !underGiant && !blocks.some(([bx, by]) => bx === x && by === y)) spots.push([x, y]);
    }
    if (spots.length) vents.push(pick(spots));
  }
  for (const s of slots) if (s.there && !s.room && rnd() < 0.5) vents.push([...s.c]);
  if (!vents.length) vents.push(pick([...slots.filter((s) => s.there && !s.room).map((s) => s.c), ...corridorTiles]));
  // red lights: along the corridors (above), plus a corner of some rooms
  for (const s of roomSlots) if (rnd() < 0.5) lights.push([s.room.x, s.room.y]);
  // steam or smoke in a room or two
  const fog = roomSlots.filter(() => rnd() < 0.15).slice(0, 2)
    .map((s) => ({ area: [s.room.x, s.room.y, s.room.x + s.room.w - 1, s.room.y + s.room.h - 1], what: pick(FOG_KINDS) }));

  const level = {
    id: `sector-${name}`, name: `SECTOR ${name}`, sector: [sx, sy], density,
    width: T, height: T, rooms, corridors, doors, blocks, fog, vents, lights, exits,
    entry: isEntry ? "ENTRY" : null,
    hostiles: hostileSchedule(sx, sy),
    // the boss sector: a towering ceiling over everything, and the giant in the middle of THE NEST
    ...(isBoss ? { wallHeight: 7, giant: { x: slotCentre(1), y: slotCentre(1), space: GIANT_SPACE } } : {}),
  };
  sectorCache.set(key, level);
  return level;
}

// A sector ready to play, with the squad arriving from `from` (the direction of the access they came through,
// on this sector's side), or at the entry. Picks the start room (none if the access leads into bare corridors)
// and the start tiles: the open tiles nearest the access, past its vestibule.
function sectorLevel(sx, sy, from = null) {
  const base = generateSector(sx, sy);
  const grid = levelGrid(base);
  const roomAt = (x, y) => base.rooms.find((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) || null;
  const exitRooms = new Set(base.exits.map((e) => e.room));
  let start = null, near, tiles = [];
  if (!from) {
    start = base.rooms.find((r) => r.name === base.entry);
    near = [start.x + 1, start.y];
    for (let y = start.y; y < start.y + start.h; y++) for (let x = start.x; x < start.x + start.w; x++) tiles.push([x, y]);
  } else {
    near = base.exits.find((e) => e.dir === from).door;
    const [si, sj] = EDGE_SLOT[from];
    const c = [slotCentre(si), slotCentre(sj)];
    start = roomAt(...c); // the room the access leads into, if there is one
    if (start) {
      for (let y = start.y; y < start.y + start.h; y++) for (let x = start.x; x < start.x + start.w; x++) if (grid[y][x] === 0) tiles.push([x, y]);
    } else { // bare corridors: the open tiles nearest the access, outside any exit room
      const seen = new Set(), queue = [near];
      while (queue.length && tiles.length < 12) {
        const [x, y] = queue.shift();
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const n = [x + dx, y + dy];
          if (seen.has(n.join()) || grid[n[1]]?.[n[0]] !== 0) continue;
          seen.add(n.join());
          queue.push(n);
          if (!exitRooms.has(roomAt(...n)?.name)) tiles.push(n);
        }
      }
    }
  }
  tiles.sort((a, b) => Math.hypot(a[0] - near[0], a[1] - near[1]) - Math.hypot(b[0] - near[0], b[1] - near[1]));
  const U = from ? from.toUpperCase() : null;
  const accesses = base.exits.map((e) => `${e.dir} (to sector ${sectorName(...e.to)})`).join(", ");
  return {
    ...base,
    start: start ? start.name : null,
    starts: tiles.slice(0, 4),
    briefing: (from ? `The squad came through the ${U} ACCESS into ${base.name}, and is ${start ? `in the ${start.name}` : "in a corridor"}.`
      : `The squad is at the ENTRY of ${base.name}, on the edge of the complex.`) + ` Accesses from here: ${accesses}.`,
  };
}
