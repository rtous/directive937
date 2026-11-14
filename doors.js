"use strict";

// Doors: sliding doors on single tiles of 1-wide passages (levels.js: doors).
//   CLOSED   the default. Soldiers and hostiles open one by walking into it (they wait a moment while it slides
//            open). Nobody sees or shoots through a closed door.
//   OPEN     while someone is in the doorway, and for a few seconds after someone last went through.
//   SEALED   welded shut by a soldier (the SEAL order, behavior.js): it doesn't open for anyone until a soldier
//            cuts through the weld (UNSEAL): then it's an ordinary door again.
// Welding: the soldier stands in front of the closed door and welds for DOOR.sealTime seconds in all (cutting:
// DOOR.cutTime). The work pauses if they have to do something else and carries on later from where it was;
// d.seal (0..1) is how much weld there is, so a half-cut door can be welded again, and the other way round.
// Until the weld is finished the door still opens for anyone who walks into it (a hostile too, right past the
// welder), and opening it breaks the weld: back to 0. Only a fully sealed door holds.

const DOOR = {
  speed: 2.2,       // how fast a door slides (fraction of fully open per second)
  holdOpen: 2.5,    // seconds a door stays open after someone last asked
  passable: 0.8,    // how open it must be to step in
  sealTime: 20,     // seconds of welding to seal one
  cutTime: 15,      // seconds of cutting to unseal one
};

// spots: [[x, y, "sealed"?]] door tiles (sealed: welded shut from the start). grid: the level's grid (to tell which way each passage runs).
// roomOf(x, y): the room at a tile, to name what each door leads into.
function createDoors(spots, grid, roomOf) {
  const floor = (x, y) => grid[y]?.[x] === 0;
  let clock = 0;

  const doors = spots.map(([x, y, start], i) => {
    // the way through: along x if the passage runs east-west, else along y
    const pass = floor(x - 1, y) && floor(x + 1, y) ? [1, 0] : [0, 1];
    if (!floor(x + pass[0], y + pass[1]) || floor(x + pass[1], y + pass[0])) console.warn(`Door at (${x}, ${y}) isn't in a 1-wide passage`);
    const rooms = [...new Set([-1, 1].map((k) => roomOf(x + pass[0] * k, y + pass[1] * k)?.name).filter(Boolean))];
    return {
      id: `D${i + 1}`, x, y, pass,
      where: rooms.length ? `${rooms.join(" / ")} doorway` : "corridor",
      rooms,
      open: 0,            // 0 shut .. 1 fully open
      askedUntil: -1,     // a soldier wants it open until then
      occupied: false,    // someone is in the doorway: it can't close
      seal: start === "sealed" ? 1 : 0, // how much weld there is, 0..1
      sealed: start === "sealed",
      weldingUntil: -1,   // someone is welding or cutting it right now
      forced: 0,          // times a half-welded door was forced open (the weld broken)
    };
  });
  const byTile = new Map(doors.map((d) => [`${d.x},${d.y}`, d]));
  const at = (x, y) => byTile.get(`${x},${y}`) || null;

  // units: everyone who can stand in a doorway (soldiers, hostiles on the floor)
  function update(dt, units) {
    clock += dt;
    for (const d of doors) {
      d.occupied = units.some((u) => !u.dead && !u.inVent && ((u.tx === d.x && u.ty === d.y) || (u.nx === d.x && u.ny === d.y)));
      const want = d.occupied || (!d.sealed && clock < d.askedUntil);
      if (want && !d.sealed && d.seal > 0) { d.seal = 0; d.forced++; } // not finished: opening it breaks the weld
      d.open = Math.max(0, Math.min(1, d.open + (want ? 1 : -1) * DOOR.speed * dt));
    }
  }

  return {
    list: doors,
    at,
    update,
    // what blocks what: a sealed door blocks everyone's way; any closed door blocks the view
    sealedAt: (x, y) => !!at(x, y)?.sealed,
    blocksSight: (x, y) => { const d = at(x, y); return !!d && d.open < 0.5; },
    // someone at the door wants it open (ignored once sealed)
    ask(d) { if (!d.sealed) d.askedUntil = clock + DOOR.holdOpen; },
    canPass: (d) => !d.sealed && d.open >= DOOR.passable,
    // A soldier welds for dt seconds. Returns "blocked" (someone in the doorway), "closing" (open: they wait for it
    // to shut, which it does once nobody wants it open), "welding" or "sealed".
    weld(d, dt) {
      if (d.seal >= 1) return "sealed"; // (a sealed door that's partly cut gets welded back up)
      d.weldingUntil = clock + 0.3;
      if (d.occupied) return "blocked";
      if (d.open > 0) return "closing";
      d.seal = Math.min(1, d.seal + dt / DOOR.sealTime);
      if (d.seal < 1) return "welding";
      d.sealed = true;
      return "sealed";
    },
    // A soldier cuts through the weld for dt seconds. Returns "blocked", "closing", "cutting" or "unsealed".
    cut(d, dt) {
      if (d.seal <= 0) return "unsealed";
      d.weldingUntil = clock + 0.3;
      if (d.occupied) return "blocked"; // (only a half-welded door can be open)
      if (d.open > 0) return "closing";
      d.seal = Math.max(0, d.seal - dt / DOOR.cutTime);
      if (d.seal > 0) return "cutting";
      d.sealed = false;
      return "unsealed";
    },
    // someone is welding or cutting it right now (sparks, a hot seam)
    welding: (d) => clock < d.weldingUntil && d.open === 0 && d.seal > 0,
    state: (d) => (d.sealed ? (d.seal < 1 ? `sealed, ${Math.round((1 - d.seal) * 100)}% cut` : "sealed")
      : d.seal > 0 ? `${Math.round(d.seal * 100)}% sealed, ${d.open > 0.5 ? "open" : "closed"}` : d.open > 0.5 ? "open" : "closed"),
  };
}
