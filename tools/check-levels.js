#!/usr/bin/env node
// Checks the world map for layout mistakes: node tools/check-levels.js [-v]
// Every sector (sectors.js), from every way the squad can come in, and the hand-made levels (levels.js).
// Prints problems; -v also prints each sector's accesses and what's reachable. Exits 1 on errors.
const fs = require("fs"), vm = require("vm"), path = require("path");
const root = path.join(__dirname, "..");
const verbose = process.argv.includes("-v");
const ctx = vm.createContext({ console, Math, Map, Set, Int32Array, Int16Array, Float32Array, Uint8Array, String });
for (const f of ["levels.js", "sectors.js", "doors.js", "nav.js"]) vm.runInContext(fs.readFileSync(path.join(root, f), "utf8"), ctx, { filename: f });
const W = vm.runInContext("({ HANDMADE_LEVELS, SECTORS, DIR, levelGrid, generateSector, sectorLevel, sectorLinks, sectorName, createDoors, createNav })", ctx);

let errors = 0;
function check(L, label) {
  const problems = [];
  const bad = (msg) => problems.push(msg);
  const grid = W.levelGrid(L);
  const open = (x, y) => grid[y]?.[x] === 0;
  const roomAt = (x, y) => L.rooms.find((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) || null;
  const warn = console.warn;
  console.warn = (m) => bad(m); // createDoors warns about doors outside 1-wide passages
  const doors = W.createDoors(L.doors || [], grid, roomAt);
  console.warn = warn;
  const g = L.giant;
  const nav = W.createNav(grid, L.rooms, { doors, solid: g ? [[g.x - g.space, g.y - g.space, g.x + g.space, g.y + g.space]] : [] });

  // the outer ring must be wall; rooms must not touch each other directly (they'd merge into one space)
  for (let x = 0; x < L.width; x++) if (open(x, 0) || open(x, L.height - 1)) bad(`open tile on the outer edge at x=${x}`);
  for (let y = 0; y < L.height; y++) if (open(0, y) || open(L.width - 1, y)) bad(`open tile on the outer edge at y=${y}`);
  for (const a of L.rooms) for (const b of L.rooms) {
    if (a === b || a.name > b.name) continue;
    if (a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h) bad(`rooms ${a.name} and ${b.name} touch or overlap`);
  }
  if (new Set(L.rooms.map((r) => r.name)).size !== L.rooms.length) bad("two rooms share a name");
  const start = L.start ? L.rooms.find((r) => r.name === L.start) : null; // (none: the squad starts in a corridor)
  if (L.start && !start) bad(`start room ${L.start} doesn't exist`);
  const exitRooms = new Set((L.exits || []).map((e) => e.room));
  (L.starts || []).forEach(([x, y]) => {
    if (!open(x, y) || (start && roomAt(x, y) !== start)) bad(`start tile (${x}, ${y}) isn't open floor${start ? ` in ${L.start}` : ""}`);
    if (exitRooms.has(roomAt(x, y)?.name)) bad(`start tile (${x}, ${y}) is in an exit room`);
  });
  if ((L.starts || []).length < 4) bad("fewer than 4 start tiles");
  (L.vents || []).forEach(([x, y]) => { if (!open(x, y)) bad(`vent (${x}, ${y}) isn't on open floor`); if (doors.at(x, y)) bad(`vent (${x}, ${y}) is on a door`); });
  (L.lights || []).forEach(([x, y]) => { if (!open(Math.round(x), Math.round(y))) bad(`light (${x}, ${y}) isn't over open floor`); if (doors.at(x, y)) bad(`light (${x}, ${y}) is over a door`); });
  (L.fog || []).forEach(({ area: [x1, y1, x2, y2] }) => { if (x1 > x2 || y1 > y2) bad(`fog area ${[x1, y1, x2, y2]} is back to front`); });
  for (const e of L.exits || []) {
    const room = L.rooms.find((r) => r.name === e.room);
    if (!room) { bad(`exit room ${e.room} doesn't exist`); continue; }
    const [dx, dy] = e.door;
    const nextTo = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([ox, oy]) => roomAt(dx + ox, dy + oy) === room);
    if (open(dx, dy) || !nextTo) bad(`hatch (${dx}, ${dy}) of ${room.name} must be a wall tile right next to it`);
  }
  // reachability from the start, with the doors that start sealed
  const reach = {};
  if (L.starts?.length) {
    const [sx, sy] = L.starts[0];
    const search = nav.bfs(sx, sy, nav.walkable);
    for (const r of L.rooms) {
      let best = Infinity;
      for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
        const d = search.dist[nav.idx(x, y)];
        if (d >= 0 && d < best) best = d;
      }
      reach[r.name] = best;
      if (best === Infinity) bad(`${r.name} can't be reached from the start (with the doors that start sealed)`);
    }
  }
  errors += problems.length;
  if (problems.length || verbose) {
    console.log(`${label}: ${problems.length ? problems.length + " problem(s)" : "OK"}`);
    problems.forEach((p) => console.log("  ! " + p));
    if (verbose) {
      console.log("  exits: " + (L.exits || []).map((e) => e.room + (e.to ? ` -> ${W.sectorName(...e.to)}` : "")).join(", "));
      console.log("  sealed at start: " + (doors.list.filter((d) => d.sealed).map((d) => d.id).join(", ") || "none"));
      console.log("  from the start: " + Object.entries(reach).map(([n, d]) => `${n} ${d === Infinity ? "UNREACHABLE" : d}`).join(", "));
    }
  }
}

// every sector, from every way in
const N = W.SECTORS.size;
let sectors = 0;
for (let sy = 0; sy < N; sy++) for (let sx = 0; sx < N; sx++) {
  const base = W.generateSector(sx, sy);
  const ways = base.exits.map((e) => e.dir);
  if (base.entry) ways.push(null);
  if (!ways.length) { errors++; console.log(`SECTOR ${W.sectorName(sx, sy)}: no way in`); }
  for (const from of ways) check(W.sectorLevel(sx, sy, from), `SECTOR ${W.sectorName(sx, sy)} (in from ${from || "the entry"})`);
  // links are both ways, and none leads off the big map
  for (const e of base.exits) {
    const [tx, ty] = e.to;
    if (tx < 0 || ty < 0 || tx >= N || ty >= N) { errors++; console.log(`SECTOR ${W.sectorName(sx, sy)}: ${e.room} leads off the map`); continue; }
    if (!W.generateSector(tx, ty).exits.some((o) => o.dir === W.DIR[e.dir].back)) { errors++; console.log(`SECTOR ${W.sectorName(sx, sy)}: ${e.room} has no matching access on the other side`); }
  }
  sectors++;
}
for (const L of W.HANDMADE_LEVELS) check(L, `${L.name} (hand-made, not in play)`);
console.log(`${sectors} sectors, ${W.sectorLinks().size / 2} links, ${W.HANDMADE_LEVELS.length} hand-made levels: ${errors ? errors + " problem(s)" : "all OK"}`);
process.exit(errors ? 1 : 0);
