"use strict";

// The level format: one map the squad plays, as plain data, built into a 3D world by world.js. The sectors of the
// world map (sectors.js) are generated in this format. HANDMADE_LEVELS below are two hand-made ones from before
// the world map: not in play (they don't follow the sectors' layout of accesses), kept as examples.
// Coordinates are grid tiles: x grows east, y grows south (north is up on the tactical map).
// Rectangles are [x1, y1, x2, y2], inclusive.
//
//   id, name        a short id, and the name shown to the player and the agent
//   briefing        one or two sentences on where the squad is now (comms log and the agent)
//   width, height   grid size; everything outside the rooms and corridors is solid wall
//   rooms           named areas. label: short name on the map. aliases: other words the agent may use.
//                   x, y, w, h: the interior. light: ceiling light colour (the feed is grayscale; only red shows).
//                   desc: what it looks like (sent to the agent). walls: wall style (walls.js), default corridor-like.
//   corridors       open runs joining the rooms
//   blocks          solid blocks inside rooms (consoles, machinery, crates)
//   doors           sliding doors (doors.js): single tiles of 1-wide passages, numbered D1, D2... in this order;
//                   [x, y, "sealed"] starts welded shut
//   fog             areas full of steam or smoke: everyone sees only a few tiles inside
//   vents           ceiling openings where hostiles drop in from the ducts (moved off red lights if too close)
//   lights          red emergency lights on the ceiling (fractional tiles allowed)
//   start           the room the squad comes in through (also where a "retreat" with no hostiles near ends)
//   starts          the tile each soldier starts on, in squad order
//   exits           the ways out: [{ room, door, dir?, to? }]: a room (stepping in = leaving the level), the
//                   outer-wall tile its hatch is on, and (sectors) which way it faces and the sector it leads to
//   hostiles        optional overrides of the release schedule (VENTS in hostiles.js), e.g. { grace: 20 }

const HANDMADE_LEVELS = [
  {
    id: "colony",
    name: "COLONY OUTPOST",
    briefing: "The squad is inside the silent colony outpost, at the AIRLOCK it came in through. The way on is the EXIT hatch beyond the LIVING QUARTERS.",
    width: 46,
    height: 32,
    rooms: [
      { name: "MEDLAB", label: "MED", aliases: ["medical", "infirmary", "med"], x: 3, y: 3, w: 8, h: 5, light: 0xd8fff0,
        walls: { base: "tiles", features: ["console", "hatch"] },
        desc: "Medical lab. Overturned gurneys, cracked specimen tanks, flickering surgical lamp." },
      { name: "LIVING QUARTERS", label: "QTRS", aliases: ["quarters", "barracks", "dorms", "qtrs"], x: 32, y: 3, w: 9, h: 6, light: 0xffe2b0,
        walls: { base: "lockers", features: ["panel", "cables"] },
        desc: "Crew bunks. Personal belongings scattered, beds unmade, a child's drawing on the wall." },
      { name: "OPERATIONS", label: "OPS", aliases: ["ops", "command", "control room"], x: 18, y: 11, w: 8, h: 7, light: 0xcfe4ff,
        walls: { base: "console", features: ["panel", "cables"] },
        desc: "Colony command centre. Central console still powered, screens showing static, chairs knocked over." },
      { name: "STORAGE", label: "STOR", aliases: ["stores", "warehouse", "stor"], x: 3, y: 13, w: 7, h: 6, light: 0xbfc8c0,
        walls: { base: "ribbed", features: ["hazard", "hatch"] },
        desc: "Supply storage. Stacked crates, some forced open, a cargo loader parked in the corner." },
      { name: "ATMOSPHERE PROCESSOR", label: "PROC", aliases: ["processor", "atmosphere", "reactor", "proc"], x: 32, y: 14, w: 9, h: 6, light: 0xffa040,
        walls: { base: "pipes", features: ["hazard", "cables"] },
        desc: "Atmosphere processing plant. Loud pumps, hot steam venting, amber warning lights." },
      { name: "MESS HALL", label: "MESS", aliases: ["mess", "canteen", "cafeteria"], x: 3, y: 24, w: 8, h: 5, light: 0xfff0d0,
        walls: { base: "panel", features: ["lockers", "hatch"] },
        desc: "Mess hall. Meals left half-eaten on the tables, a coffee machine still dripping." },
      { name: "AIRLOCK", label: "LOCK", aliases: ["base", "entrance", "lock", "start", "dropship"], x: 19, y: 25, w: 6, h: 5, light: 0xff4030,
        walls: { base: "hazard", features: ["ribbed", "hatch"] },
        desc: "Main airlock where the squad came in. Red emergency strobe, outer door sealed behind them." },
      { name: "ARMORY", label: "ARMS", aliases: ["armoury", "weapons", "arms"], x: 33, y: 25, w: 8, h: 4, light: 0xc8ffd0,
        walls: { base: "lockers", features: ["ribbed", "hazard"] },
        desc: "Colony armory. Weapon racks mostly empty, ammo cases scattered on the floor." },
      { name: "EXIT", label: "EXIT", aliases: ["exit door", "way out", "outer door", "evac", "hatch"], x: 42, y: 5, w: 3, h: 3, light: 0xff4030,
        walls: { base: "hazard", features: ["ribbed", "hatch"] },
        desc: "Exit vestibule. A heavy hatch in the outer wall, red EXIT light above it: the way out of this sector." },
    ],
    corridors: [
      [11, 5, 31, 5],     // north corridor: medlab <-> quarters
      [21, 6, 21, 10],    // north corridor -> operations
      [10, 15, 17, 15],   // operations <-> storage
      [26, 16, 31, 16],   // operations <-> atmosphere processor
      [21, 18, 22, 24],   // operations <-> airlock (2 wide main spine)
      [11, 26, 18, 26],   // mess hall <-> airlock
      [25, 26, 32, 26],   // airlock <-> armory
      [6, 8, 6, 12],      // medlab <-> storage
      [6, 19, 6, 23],     // storage <-> mess hall
      [36, 9, 36, 13],    // quarters <-> processor
      [36, 20, 36, 24],   // processor <-> armory
      [41, 6, 41, 6],     // quarters <-> exit
    ],
    doors: [
      [11, 5],   // D1 medlab, east doorway
      [31, 5],   // D2 living quarters, west doorway
      [21, 10],  // D3 operations, north doorway
      [10, 15],  // D4 storage, east doorway
      [31, 16, "sealed"],  // D5 atmosphere processor, west doorway
      [11, 26, "sealed"],  // D6 mess hall, east doorway
      [32, 26],  // D7 armory, west doorway
      [6, 11, "sealed"],   // D8 west corridor, medlab <-> storage
      [36, 21],  // D9 east corridor, processor <-> armory (in the steam)
    ],
    blocks: [
      [21, 13, 22, 14],                   // operations: central console
      [34, 16, 34, 17], [38, 16, 38, 17], // processor: pump columns
      [5, 15, 5, 16],                     // storage: crate stack
    ],
    fog: [
      { area: [32, 14, 40, 19], what: "Thick steam from the venting pumps." },  // atmosphere processor
      { area: [36, 20, 36, 24], what: "Steam drifting down the corridor." },     // processor -> armory
      { area: [3, 13, 9, 18], what: "Smoke hanging in the air, something smouldering behind the crates." }, // storage
      { area: [14, 5, 20, 5], what: "Smoke from a burnt-out panel fills the corridor." }, // north corridor
    ],
    // one per room except the airlock and the exit, plus a few corridors
    vents: [
      [8, 4], [38, 7], [24, 12], [8, 13], [39, 15], [9, 27], [36, 27],  // MED, QTRS, OPS, STOR, PROC, MESS, ARMS
      [14, 5], [26, 5], [13, 15], [22, 18], [6, 23], [36, 13], [29, 26], // corridors
    ],
    // every few tiles along the corridors plus a corner of each room
    lights: [
      [12, 5], [16, 5], [20, 5], [24, 5], [28, 5], // north corridor
      [21, 8],                                     // north corridor -> operations
      [11, 15], [15, 15],                          // operations <-> storage
      [28, 16],                                    // operations <-> atmosphere processor
      [21.5, 20], [21.5, 23],                      // main spine
      [6, 10], [6, 21],                            // west corridors
      [36, 11], [36, 22],                          // east corridors
      [13, 26], [17, 26], [27, 26], [31, 26],      // airlock side corridors
      [3, 3], [40, 3], [18, 17], [40, 19],         // room corners: medlab, quarters, ops, processor
      [9, 18], [3, 28], [40, 28],                  // storage, mess hall, armory
    ],
    start: "AIRLOCK",
    starts: [[20, 27], [23, 27], [20, 29], [23, 29]],
    exits: [{ room: "EXIT", door: [45, 6] }],
  },
  {
    id: "reactor",
    name: "REACTOR DECK",
    briefing: "Through the hatch the squad reaches the colony's reactor deck, at the TRANSIT LOCK on its west side. Pumps and cooling towers hiss in the dark; the EXIT is a hatch at the far east wall.",
    width: 44,
    height: 30,
    rooms: [
      { name: "TRANSIT LOCK", label: "TRNS", aliases: ["transit", "lock", "entrance", "start"], x: 2, y: 13, w: 5, h: 5, light: 0xff4030,
        walls: { base: "hazard", features: ["ribbed", "hatch"] },
        desc: "Transit lock from the outpost. The hatch the squad came through is shut behind them; red strobe turning." },
      { name: "CREW LOCKERS", label: "LCKR", aliases: ["lockers", "locker room", "changing room"], x: 2, y: 2, w: 7, h: 5, light: 0xe8e8d8,
        walls: { base: "lockers", features: ["panel", "hatch"] },
        desc: "Shift crew locker room. Lockers hanging open, a hard hat rolling on the floor, a radio hissing on a bench." },
      { name: "PUMP ROOM", label: "PUMP", aliases: ["pumps", "pump"], x: 14, y: 2, w: 9, h: 6, light: 0xffb060,
        walls: { base: "pipes", features: ["hazard", "cables"] },
        desc: "Coolant pump room. Big pumps thumping, hot steam leaking from a cracked manifold." },
      { name: "REACTOR CONTROL", label: "CTRL", aliases: ["control", "reactor", "control room"], x: 14, y: 12, w: 9, h: 7, light: 0xcfe4ff,
        walls: { base: "console", features: ["panel", "cables"] },
        desc: "Reactor control room. A long console of dials and warning lamps, the core readout flickering amber." },
      { name: "COOLING TOWER", label: "COOL", aliases: ["cooling", "tower", "cool"], x: 28, y: 2, w: 12, h: 7, light: 0xbfd8ff,
        walls: { base: "pipes", features: ["ribbed", "hazard"] },
        desc: "Base of the cooling tower. Two huge columns, condensation raining down, steam rolling across the floor." },
      { name: "COMMS", label: "COMM", aliases: ["communications", "radio", "comm"], x: 28, y: 13, w: 7, h: 5, light: 0xd8fff0,
        walls: { base: "console", features: ["cables", "hatch"] },
        desc: "Communications room. Transmitter racks dead, one screen looping a distress call nobody answered." },
      { name: "CARGO BAY", label: "CRGO", aliases: ["cargo", "bay", "crgo"], x: 2, y: 22, w: 10, h: 6, light: 0xbfc8c0,
        walls: { base: "ribbed", features: ["hazard", "hatch"] },
        desc: "Cargo bay. Shipping crates stacked high, a forklift on its side, chains swinging from the gantry." },
      { name: "MAINTENANCE", label: "MAINT", aliases: ["maint", "workshop"], x: 17, y: 23, w: 8, h: 5, light: 0xfff0d0,
        walls: { base: "panel", features: ["cables", "lockers"] },
        desc: "Maintenance workshop. Tools scattered across the benches, a welding rig still warm." },
      { name: "GENERATOR", label: "GEN", aliases: ["generators", "power", "gen"], x: 30, y: 22, w: 7, h: 6, light: 0xffa040,
        walls: { base: "hazard", features: ["pipes", "cables"] },
        desc: "Backup generator hall. One generator droning, the other dead and blackened." },
      { name: "EXIT", label: "EXIT", aliases: ["exit door", "way out", "outer door", "evac", "hatch"], x: 40, y: 21, w: 3, h: 3, light: 0xff4030,
        walls: { base: "hazard", features: ["ribbed", "hatch"] },
        desc: "Exit vestibule. A heavy hatch in the outer wall, red EXIT light above it: the way out of the reactor deck." },
    ],
    corridors: [
      [4, 7, 4, 12],      // lockers <-> transit lock
      [4, 18, 4, 21],     // transit lock <-> cargo bay
      [7, 15, 13, 15],    // transit lock <-> reactor control
      [9, 4, 13, 4],      // lockers <-> pump room
      [18, 8, 18, 11],    // pump room <-> reactor control
      [23, 5, 27, 5],     // pump room <-> cooling tower
      [23, 15, 27, 15],   // reactor control <-> comms
      [31, 9, 31, 12],    // cooling tower <-> comms
      [20, 19, 20, 22],   // reactor control <-> maintenance
      [12, 25, 16, 25],   // cargo bay <-> maintenance
      [25, 25, 29, 25],   // maintenance <-> generator
      [32, 18, 32, 21],   // comms <-> generator
      [37, 22, 39, 22],   // generator <-> exit
      [40, 5, 41, 5],     // cooling tower -> east shaft
      [41, 6, 41, 20],    // east shaft down to the exit
    ],
    doors: [
      [7, 15],              // D1 transit lock, east doorway
      [4, 12],              // D2 transit lock, north doorway
      [18, 11],             // D3 reactor control, north doorway
      [23, 15],             // D4 reactor control, east doorway
      [31, 12],             // D5 comms, north doorway
      [20, 22],             // D6 maintenance, north doorway
      [29, 25],             // D7 generator, west doorway
      [37, 22],             // D8 generator, east doorway (toward the exit)
      [41, 10, "sealed"],   // D9 east shaft: the short way to the exit
      [12, 25, "sealed"],   // D10 cargo bay, east doorway
    ],
    blocks: [
      [17, 15, 19, 15],                   // reactor control: the console
      [31, 4, 31, 5], [36, 4, 36, 5],     // cooling tower: the columns
      [5, 24, 5, 25], [8, 23, 9, 23],     // cargo bay: crates
    ],
    fog: [
      { area: [14, 2, 22, 7], what: "Hot steam from the cracked pump manifold." },     // pump room
      { area: [28, 2, 34, 8], what: "Steam rolling off the cooling columns." },        // cooling tower, west half
      { area: [41, 12, 41, 17], what: "Smoke drifting up the shaft from a burnt cable run." }, // east shaft
    ],
    // one per room except the transit lock and the exit, plus a few corridors
    vents: [
      [6, 4], [19, 4], [16, 13], [8, 25], [34, 5], [30, 15], [22, 25], [33, 24],  // rooms
      [10, 15], [26, 5], [41, 16], [16, 25],                                      // corridors
    ],
    lights: [
      [4, 9], [4, 20], [11, 4], [8, 15], [12, 15], [18, 10], [24, 5], [26, 15], [31, 10],
      [20, 20], [14, 25], [27, 25], [32, 19], [38, 22], [41, 8], [41, 13], [41, 18],     // corridors
      [2, 2], [22, 2], [14, 18], [2, 27], [39, 2], [34, 13], [24, 27], [36, 27],         // room corners
    ],
    start: "TRANSIT LOCK",
    starts: [[3, 14], [5, 14], [3, 16], [5, 16]],
    exits: [{ room: "EXIT", door: [43, 22] }],
    hostiles: { firstArrival: 10, grace: 20, doubling: 40 }, // they're already on the move
  },
];

// Build a level's grid: 1 = wall, 0 = open floor
function levelGrid(level) {
  const grid = Array.from({ length: level.height }, () => new Array(level.width).fill(1));
  const carve = ([x1, y1, x2, y2], v) => {
    for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++)
      for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) grid[y][x] = v;
  };
  level.rooms.forEach((r) => carve([r.x, r.y, r.x + r.w - 1, r.y + r.h - 1], 0));
  level.corridors.forEach((c) => carve(c, 0));
  level.blocks.forEach((b) => carve(b, 1));
  return grid;
}
