"use strict";

// The mission: get the squad out through the EXIT door, a hatch in the colony's outer wall.
// A soldier who steps into the EXIT room goes through the door and leaves the level (alive, out of play).
// The level ends once nobody is left inside:
//   LEVEL COMPLETE  at least one soldier made it out (the exit leads on to the next level, later)
//   SQUAD LOST      everyone died before getting out

// exit: the EXIT room. soldiers: the squad. roomOf(x, y): the room at a tile. leave(s): take a soldier out of play.
// emit(soldier|null, text): report an event. end({ win, reason, out, lost }): the level is over.
function createMission({ exit, soldiers, roomOf, leave, emit, end }) {
  const label = (s) => `Unit ${s.id} (${s.callsign})`;
  const here = (s) => (s.progress >= 1 ? [s.tx, s.ty] : [s.nx, s.ny]);
  const out = [];  // soldiers who made it out, in order
  let over = false;

  function update() {
    if (over) return;
    for (const s of soldiers) {
      if (s.dead || roomOf(...here(s)) !== exit) continue;
      leave(s);
      out.push(s);
      const left = soldiers.filter((o) => !o.dead).length;
      emit(s, `${label(s)} went through the EXIT door. ${out.length} of ${soldiers.length} out` +
        (left ? `, ${left} still inside.` : "."));
    }
    if (soldiers.every((s) => s.dead)) finish();
  }

  function finish() {
    over = true;
    const lost = soldiers.filter((s) => !s.exited);
    const reason = out.length
      ? `${out.length} of ${soldiers.length} made it out: ${out.map((s) => s.callsign).join(", ")}.` +
        (lost.length ? ` Lost: ${lost.map((s) => s.callsign).join(", ")}.` : "")
      : "Nobody made it to the exit.";
    emit(null, `${out.length ? "LEVEL COMPLETE" : "SQUAD LOST"}: ${reason}`);
    end({ win: out.length > 0, reason, out: out.length, lost: lost.length });
  }

  // What the squad (and the agent) knows
  function status() {
    return {
      objective: `Get the squad out through the EXIT door (the ${exit.name} room, at the colony's outer wall). ` +
        "A soldier who steps into it leaves the level. The level ends when nobody is left inside.",
      exit: { room: exit.name, x: exit.x, y: exit.y, w: exit.w, h: exit.h },
      out: out.map((s) => s.callsign),
      still_inside: soldiers.filter((s) => !s.dead).map((s) => s.callsign),
      lost: soldiers.filter((s) => s.dead && !s.exited).map((s) => s.callsign),
      outcome: !over ? "in progress" : out.length ? "level complete" : "squad lost",
    };
  }

  return {
    update, status, out,
    get over() { return over; },
  };
}
