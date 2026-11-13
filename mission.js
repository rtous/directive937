"use strict";

// The goal in a sector, for now: get the squad out through one of its accesses (exit rooms) to a neighbouring
// sector. A soldier who steps into an access room goes through its hatch and leaves the level (alive, out of play).
// The first one through picks the way for everyone: the other accesses close (nav.chooseExit), and the rest of the
// squad has to follow through the same one. The level ends once nobody is left inside:
//   through   at least one soldier went through: the squad moves on to that access's sector
//   lost      everyone died before getting out
// The goal of the whole mission: kill THE GIANT, in THE NEST (sectors.js: SECTORS.boss). victory() ends it.

// exits: [{ room, dir, to, toName }] the accesses. soldiers: those who came into this level. nav: for roomOf and
// to close the other accesses. leave(s): take a soldier out of play. emit(soldier|null, text): report an event.
// end({ win, reason, exit, out, lost }): the level is over.
function createMission({ exits, soldiers, nav, leave, emit, end }) {
  const label = (s) => `Unit ${s.id} (${s.callsign})`;
  const out = [];   // soldiers who went through, in order
  let chosen = null; // the access they're leaving through
  let over = false;
  let won = false;   // THE GIANT is dead
  const exitOf = (s) => { const r = nav.roomOf(...unitTile(s)); return exits.find((e) => e.room === r) || null; };
  const where = (e) => (e.toName ? `the ${e.room.name} to sector ${e.toName}` : `the ${e.room.name}`);

  function update() {
    if (over) return;
    for (const s of soldiers) {
      if (s.dead) continue;
      const e = exitOf(s);
      if (!e || (chosen && e !== chosen)) continue;
      if (!chosen) { chosen = e; nav.chooseExit(e.room); }
      leave(s);
      out.push(s);
      const left = soldiers.filter((o) => !o.dead).length;
      emit(s, `${label(s)} went through ${where(e)}. ${out.length} of ${soldiers.length} through` +
        (left ? `, ${left} still inside: they have to follow through the same access.` : "."));
    }
    if (soldiers.every((s) => s.dead)) finish();
  }

  // THE GIANT is dead: the mission is won, whoever is still inside
  function victory(how) {
    if (over) return;
    over = won = true;
    emit(null, `MISSION COMPLETE: ${how}`);
    end({ win: true, victory: true, reason: how, exit: null, out: out.length, lost: soldiers.filter((s) => s.dead && !s.exited).length });
  }

  function finish() {
    over = true;
    const lost = soldiers.filter((s) => !s.exited);
    const reason = out.length
      ? `${out.length} of ${soldiers.length} went through to ${chosen.toName ? `sector ${chosen.toName}` : "the next level"}: ` +
        `${out.map((s) => s.callsign).join(", ")}.` + (lost.length ? ` Lost: ${lost.map((s) => s.callsign).join(", ")}.` : "")
      : "Nobody made it out.";
    emit(null, `${out.length ? "SECTOR CLEARED" : "SQUAD LOST"}: ${reason}`);
    end({ win: out.length > 0, reason, exit: chosen, out: out.length, lost: lost.length });
  }

  // What the squad (and the agent) knows
  function status() {
    return {
      objective: `The mission: find and kill THE GIANT, in THE NEST, sector ${sectorName(...SECTORS.boss)}. ` +
        "Here: get the squad out through one of this sector's accesses to a neighbouring sector, all through the same one " +
        "(once a soldier goes through one, the others close). A soldier who steps into an access room leaves the sector. " +
        "The level ends when nobody is left inside.",
      accesses: exits.map((e) => ({ room: e.room.name, direction: e.dir || null, leads_to: e.toName ? `sector ${e.toName}` : null,
        position: { x: e.room.x, y: e.room.y, w: e.room.w, h: e.room.h }, closed: !!chosen && e !== chosen })),
      leaving_through: chosen ? chosen.room.name : null,
      out: out.map((s) => s.callsign),
      still_inside: soldiers.filter((s) => !s.dead).map((s) => s.callsign),
      lost: soldiers.filter((s) => s.dead && !s.exited).map((s) => s.callsign),
      outcome: won ? "MISSION COMPLETE: the giant is dead" : !over ? "in progress"
        : out.length ? `through to sector ${chosen.toName || "?"}` : "squad lost",
    };
  }

  return {
    update, status, victory, out,
    total: soldiers.length, // how many came into the level
    get chosen() { return chosen; },
    get over() { return over; },
  };
}
