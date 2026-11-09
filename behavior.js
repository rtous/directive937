"use strict";

// ---------- Soldier behavior ----------
// What each marine does, decided again ~10 times a second, in three layers (highest wins):
//
//   INSTINCT   reflexes that override any order
//                panic        overwhelmed (several hostiles close, worse alone) -> run fast, then hold
//                point-blank  a hostile within ~2 tiles -> shoot it, even under "fire hold"
//   ORDERS     the player's intent, given through the AI agent
//                task         what to do now: patrol, patrol <room>, goto, north/south/east/west, hold,
//                             retreat, follow, continue (one at a time; a new task replaces the old)
//                standing     how to do it, kept until changed: pace, fire, contact, pursue, watch
//                shape        how the squad is arranged: together, split (ALPHA/BRAVO), spread
//   DEFAULT    what they do untold: patrol freely, stay together, watch different angles,
//              engage hostiles they see, pursue them
//
// Each think: perceive -> instinct? -> react to a visible hostile (shaped by standing orders)
//             -> pursue a lost one -> carry out the task -> decide where to look.
// The result is written onto the soldier for world.js to carry out:
//   s.path (tiles to walk), s.halt (don't start another step), s.speed, s.target (alien to aim at),
//   s.wantFire, s.gaze (heading to face, null = straight ahead), s.glance (extra head turn).

const BEHAVIOR = {
  pace: { slow: 0.85, normal: 1.5, fast: 3.0 }, // walking speed, world units per second
  sight: { slow: 9, normal: 8, fast: 6 },       // how far a hostile can be seen, in tiles
  fogSight: 3,       // ...when the soldier or the hostile is in fog
  fov: 1.2,          // half-angle of what the helmet sees (radians, ~140 degrees in all)
  sense: 1.6,        // hostiles this close are noticed whichever way the soldier looks
  pointBlank: 2.2,   // instinct: shoot anything this close
  effective: 5,      // engage from this range; with pursue on, close in to it
  shadow: 4,         // with fire held and pursue on, follow a hostile from this far
  panic: 5,          // danger score that makes a soldier run...
  safe: 2,           // ...and the score that counts as safe again
  hp: { soldier: 100, alien: 100 }, // health everyone starts with
  damage: 10,        // health one rifle round takes off
  thinkEvery: 0.1,   // seconds between decisions
  report: {          // radio reports about hostiles (events for the agent)
    recontact: 15,   // seconds before a hostile seen again counts as a new contact
    charge: 8,       // seconds between "charging at me" calls for the same hostile
    trackerNear: 6,  // tiles: tracker movement this close, with nothing in sight, is called in
    trackerEvery: 10,// seconds between one soldier's tracker calls (unless it got closer)
    trackerSquad: 8, // seconds between tracker calls from anyone in the squad (they'd all call the same blip)...
    trackerUrgent: 3,// ...unless it's this close (tiles)
    lostAfter: 4,    // seconds out of sight before "lost sight of it"
    lostEvery: 15,   // seconds between "lost sight" calls
  },
  tracker: 12,       // motion tracker range in tiles (same as the map sonar) (it can't tell the ducts from the floor)
};

const DEFAULT_ORDERS = { pace: "normal", fire: "free", contact: "engage", pursue: "on", watch: "auto" };

// Standing orders: value -> words accepted for it, and what the soldier says when given it
const STANDING = {
  pace: {
    slow: [["slow", "slowly", "careful", "quiet", "sneak"], "Moving slow and careful."],
    normal: [["normal", "walk", "default"], "Normal pace."],
    fast: [["fast", "quick", "quickly", "run", "double", "hurry"], "Moving fast."],
  },
  fire: {
    free: [["free", "on", "yes", "open", "weapons-free"], "Weapons free."],
    hold: [["hold", "off", "no", "cease", "safe", "dont", "don't"], "Holding fire."],
  },
  contact: {
    engage: [["engage", "attack", "fight"], "Will engage hostiles on sight."],
    hold: [["hold", "freeze", "stop", "stand"], "Will hold position on contact."],
    retreat: [["retreat", "flee", "run", "withdraw", "avoid"], "Will fall back on contact."],
  },
  pursue: {
    on: [["on", "yes", "chase", "follow"], "Will pursue hostiles."],
    off: [["off", "no", "dont", "don't", "stay"], "Won't pursue."],
  },
  watch: {
    auto: [["auto", "around", "scan", "all", "angles"], "Watching all angles."],
    front: [["front", "ahead", "forward"], "Eyes front."],
    rear: [["rear", "back", "behind", "six"], "Watching our six."],
    // also: any of the 8 compass directions, the room's centre, a room, or a grid position (see setWatch)
  },
};

// Other words for orders: action -> [action, argument]
const SHORTCUTS = {
  explore: ["patrol"], wander: ["patrol"], search: ["patrol"],
  stop: ["hold"], stay: ["hold"], halt: ["hold"], wait: ["hold"],
  resume: ["continue"],
  flee: ["retreat"], fallback: ["retreat"], withdraw: ["retreat"],
  regroup: ["together"], group: ["together"],
  n: ["north"], s: ["south"], e: ["east"], w: ["west"],
  slow: ["pace", "slow"], fast: ["pace", "fast"],
  "hold-fire": ["fire", "hold"], "weapons-free": ["fire", "free"],
};

const ORDER_HELP = "Tasks: patrol [room], goto <room | x y>, north/south/east/west, hold, retreat [room], " +
  "follow <unit>, continue. Squad: together, split, spread. Standing: pace slow|normal|fast, fire free|hold, " +
  "contact engage|hold|retreat, pursue on|off, watch auto|front|rear|<direction, e.g. north-east>|center|<room>|<x y>, reset.";

const COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];

// nav: grid helpers from world.js. killAlien(alien) / killSoldier(soldier) take them out of the scene.
// emit(soldier, text) reports an event.
function createSquadBrain({ nav, soldiers: everyone, aliens, killAlien, killSoldier, emit }) {
  // only the living take part; `everyone` keeps the fallen for the status report
  let soldiers = everyone.slice();
  const { isOpen, cols, DIRS, DIR_NAMES, bfs, pathFrom, idx, roomOf, rooms, findRoom, headingFor, angleDiff, fogAt } = nav;

  let now = 0;                 // seconds since the mission started
  const known = new Map();     // alien -> { x, y, seen, by }: hostiles the squad has spotted
  const visited = new Map();   // room name -> time someone last entered it (patrol prefers stale rooms)
  let kills = 0;
  let squadTrackerAt = -99;    // last motion-tracker call from anyone

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const pos = (s) => [s.tx + (s.nx - s.tx) * s.progress, s.ty + (s.ny - s.ty) * s.progress];
  const here = (s) => (s.progress >= 1 ? [s.tx, s.ty] : [s.nx, s.ny]);
  const label = (s) => `Unit ${s.id} (${s.callsign})`;
  const where = (x, y) => roomOf(Math.round(x), Math.round(y))?.name ?? "a corridor";
  const compass = (dx, dy) => COMPASS[(Math.round(Math.atan2(dx, -dy) / (Math.PI / 4)) + 8) % 8];
  const angleTo = (s, x, y) => { const [px, py] = pos(s); return Math.atan2(-(x - px), -(y - py)); };
  const tiles = (n) => `${Math.round(n)} tile${Math.round(n) === 1 ? "" : "s"}`;
  const ok = (detail) => ({ ok: true, detail });
  const bad = (detail) => ({ ok: false, detail });
  const unknownRoom = (q) => `Unknown room "${q}". Rooms: ${rooms.map((r) => r.name).join(", ")}.`;

  // ---------- Perception ----------
  function clearLine(ax, ay, bx, by) {
    const n = Math.ceil(Math.hypot(bx - ax, by - ay) / 0.2);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (!isOpen(Math.round(ax + (bx - ax) * t), Math.round(ay + (by - ay) * t))) return false;
    }
    return true;
  }

  // Hostiles this soldier can see right now: in range, in the helmet's view (or very close), not behind walls
  function perceive(s) {
    const [px, py] = pos(s);
    const view = s.heading + s.lookOffset;
    const seen = [];
    for (const a of aliens) {
      if (a.dead || (a.inVent && !(a.dropT > 0))) continue; // up in the ducts: out of sight (unless dropping now)
      const d = Math.hypot(a.x - px, a.y - py);
      const range = fogAt(px, py) || fogAt(a.x, a.y) ? BEHAVIOR.fogSight : BEHAVIOR.sight[s.orders.pace];
      if (d > range) continue;
      const angle = Math.atan2(-(a.x - px), -(a.y - py));
      if (d > BEHAVIOR.sense && Math.abs(angleDiff(view, angle)) > BEHAVIOR.fov) continue;
      if (!clearLine(px, py, a.x, a.y)) continue;
      seen.push({ alien: a, d, angle, dir: compass(a.x - px, a.y - py) });
    }
    seen.sort((p, q) => p.d - q.d);

    const R = BEHAVIOR.report;
    // a hostile dropping out of a ceiling vent in view: called in once per hostile
    const dropped = seen.filter((c) => (c.alien.dropT > 0 || c.alien.freshDrop > 0) && !c.alien.dropReported);
    dropped.forEach((c) => {
      c.alien.dropReported = true;
      emit(s, `${label(s)} HOSTILE DROPPED FROM A CEILING VENT in ${where(c.alien.x, c.alien.y)}, ${tiles(c.d)} ${c.dir}!`);
    });
    // first sighting (or not seen for a while): call it in, with what each one is doing
    const fresh = seen.filter((c) => {
      const k = known.get(c.alien);
      return !dropped.includes(c) && (!k || now - k.seen > R.recontact);
    });
    seen.forEach((c) => known.set(c.alien, { x: c.alien.x, y: c.alien.y, seen: now, by: s.id }));
    if (fresh.length) {
      const what = fresh.length === 1 ? "hostile" : `${fresh.length} hostiles`;
      const at = fresh.map((c) => `${tiles(c.d)} ${c.dir} (${activity(c.alien, s)})`).join(", ");
      const total = seen.length > fresh.length ? ` ${seen.length} in sight now.` : "";
      emit(s, `${label(s)} CONTACT: ${what} in ${where(fresh[0].alien.x, fresh[0].alien.y)}, ${at}.${total}`);
    }
    // a hostile in view is charging this soldier
    for (const c of seen) {
      const a = c.alien;
      if (a.mode !== "chase" || a.prey !== s || fresh.includes(c)) continue;
      if (now - (s.chargeCalled.get(a) ?? -99) < R.charge) continue;
      s.chargeCalled.set(a, now);
      emit(s, `${label(s)} HOSTILE CHARGING AT ${s.callsign}! ${tiles(c.d)} ${c.dir}, ${where(a.x, a.y)}.`);
    }
    fresh.forEach((c) => { if (c.alien.mode === "chase" && c.alien.prey === s) s.chargeCalled.set(c.alien, now); });
    // lost sight of what it was watching
    if (seen.length) {
      s.lostInfo = { alien: seen[0].alien, dir: seen[0].dir, room: where(seen[0].alien.x, seen[0].alien.y), at: null };
    } else if (s.lostInfo) {
      const L = s.lostInfo;
      if (L.alien.dead) s.lostInfo = null;
      else if (L.at == null) L.at = now;
      else if (now - L.at >= R.lostAfter) {
        if (now - s.lostCalledAt >= R.lostEvery) {
          s.lostCalledAt = now;
          emit(s, `${label(s)} lost sight of the hostile, last seen ${L.dir} in ${L.room}.`);
        }
        s.lostInfo = null;
      }
    }
    // motion tracker: something close but nothing in sight (it could be in the ducts above)
    const near = aliens.filter((a) => !a.dead).map((a) => ({ a, d: Math.hypot(a.x - px, a.y - py) }))
      .sort((p, q) => p.d - q.d);
    const closest = near[0];
    if (!seen.length && closest && closest.d <= R.trackerNear) {
      const closer = s.trackerD == null || closest.d < s.trackerD - 1.5;
      const squadQuiet = now - squadTrackerAt >= R.trackerSquad || closest.d <= R.trackerUrgent;
      if (closer && squadQuiet && (now - s.trackerCalledAt >= R.trackerEvery || s.trackerD == null)) {
        s.trackerCalledAt = squadTrackerAt = now;
        s.trackerD = closest.d;
        const count = near.filter((m) => m.d <= R.trackerNear).length;
        emit(s, `${label(s)} MOTION TRACKER: ${count === 1 ? "movement" : `${count} signals`}, nearest ${tiles(closest.d)} ${compass(closest.a.x - px, closest.a.y - py)}, nothing in sight. Could be in the ceiling.`);
      }
    } else if (!closest || closest.d > R.trackerNear + 1) {
      s.trackerD = null;
    }
    s.visible = seen;
  }

  // What a hostile in view is doing, as a soldier would call it
  function activity(a, s) {
    if (a.dropT > 0 || a.freshDrop > 0) return "dropping from the ceiling";
    if (a.mode === "chase") return a.prey === s ? "charging at us" : "charging";
    return a.progress < 1 ? "moving" : "not moving";
  }

  // Hostiles the squad knows about and that are still a concern (seen within `within` seconds)
  const threats = (within = 60) => [...known].filter(([a, k]) => !a.dead && now - k.seen < within).map(([a]) => a);
  // What this soldier saw in the last few seconds: one that just left view is still behind them
  const recent = (s) => [...known].filter(([a, k]) => !a.dead && k.by === s.id && now - k.seen < 3).map(([a]) => a);

  // How threatened a soldier feels: close hostiles count most, nearby squad mates make it bearable
  function danger(s, list) {
    const [px, py] = pos(s);
    let score = 0;
    for (const a of list) {
      const d = Math.hypot(a.x - px, a.y - py);
      score += d <= BEHAVIOR.pointBlank ? 3 : d <= 4 ? 2 : d <= 7 ? 1 : 0;
    }
    if (!score) return 0;
    const support = soldiers.filter((o) => {
      if (o === s) return false;
      const [ox, oy] = pos(o);
      return Math.hypot(ox - px, oy - py) <= 3;
    }).length;
    return Math.max(0, score - Math.min(2, support));
  }

  // ---------- Movement helpers ----------
  // Walk to a tile. The route is kept while `key` stays the same, so calling this every think is cheap.
  function walkTo(s, x, y, key = `${x},${y}`, passable = isOpen) {
    if (s.goalKey === key) return true;
    const [fx, fy] = here(s);
    const search = bfs(fx, fy, passable);
    if (search.dist[idx(x, y)] < 0) return false;
    s.path = pathFrom(search, x, y);
    s.goalKey = key;
    return true;
  }
  const stopHere = (s, key = "stop") => { s.path = []; s.goalKey = key; };
  const atRest = (s) => s.progress >= 1 && !s.path.length;
  const atTile = (s, [x, y]) => s.progress >= 1 && s.tx === x && s.ty === y;

  // Nearest spot (by route) within `range` tiles of (x, y) with a clear view of it
  function approach(s, x, y, range, key) {
    x = Math.round(x);
    y = Math.round(y);
    const k = `${key}:${x},${y}`;
    if (s.goalKey === k) return true;
    const [fx, fy] = here(s);
    const search = bfs(fx, fy);
    let best = null, bestD = Infinity;
    for (let i = 0; i < search.dist.length; i++) {
      const d = search.dist[i];
      if (d < 0 || d >= bestD) continue;
      const tx = i % cols, ty = (i / cols) | 0;
      if (Math.hypot(tx - x, ty - y) > range || !clearLine(tx, ty, x, y)) continue;
      best = [tx, ty];
      bestD = d;
    }
    if (!best) return false;
    s.path = pathFrom(search, best[0], best[1]);
    s.goalKey = k;
    return true;
  }

  function roomTiles(room) {
    const tiles = [];
    for (let y = room.y; y < room.y + room.h; y++)
      for (let x = room.x; x < room.x + room.w; x++) if (isOpen(x, y)) tiles.push([x, y]);
    return tiles;
  }

  // Open tile near the room's centre that no squad mate is already heading for
  function roomTile(room, s) {
    const cx = room.x + (room.w - 1) / 2, cy = room.y + (room.h - 1) / 2;
    const taken = soldiers.filter((o) => o !== s && o.task.tile).map((o) => o.task.tile);
    let best = null, bestScore = Infinity;
    for (const [x, y] of roomTiles(room)) {
      const crowded = taken.some(([tx, ty]) => Math.hypot(tx - x, ty - y) < 1.5) ? 100 : 0;
      const score = Math.hypot(x - cx, y - cy) + crowded;
      if (score < bestScore) { bestScore = score; best = [x, y]; }
    }
    return best;
  }

  // As far as possible in a compass direction: best balance of progress that way vs. walking distance
  function headingTile(s, d) {
    const [fx, fy] = here(s);
    const search = bfs(fx, fy);
    const [dx, dy] = DIRS[d];
    let best = null, bestScore = 0;
    for (let i = 0; i < search.dist.length; i++) {
      if (search.dist[i] < 0) continue;
      const x = i % cols, y = (i / cols) | 0;
      const progress = (x - fx) * dx + (y - fy) * dy;
      if (progress <= 0) continue;
      const score = progress * 4 - search.dist[i];
      if (score > bestScore) { bestScore = score; best = [x, y]; }
    }
    return best;
  }

  // ---------- Squad shape ----------
  const followersOf = (s) => soldiers.filter((o) => o.leader === s).sort((a, b) => a.id - b.id);
  const rootOf = (s) => { let r = s; for (let i = 0; r.leader && i < 8; i++) r = r.leader; return r; };
  const rank = (s) => (s.leader ? followersOf(s.leader).indexOf(s) + 1 : 0);
  function groupOf(s) {
    const root = rootOf(s);
    return soldiers.filter((o) => rootOf(o) === root).sort((a, b) => a.id - b.id);
  }

  // Leaders don't run off: if a follower falls well behind, wait for it
  function waitForSquad(s) {
    const lagging = followersOf(s).filter((o) => !o.flee && o.task.kind === "follow" && o.leaderDist > rank(o) + 5);
    if (!lagging.length) return false;
    s.halt = true;
    s.doing = `waiting for ${lagging.map((o) => o.callsign).join(", ")} to catch up`;
    return true;
  }

  // Keep a few tiles behind the leader, one more for each place down the column
  function follow(s) {
    const L = s.leader;
    if (!L) { setTask(s, { kind: "hold" }); return; }
    const keep = rank(s);
    const [lx, ly] = here(L);
    const [fx, fy] = here(s);
    const search = bfs(fx, fy);
    const dist = search.dist[idx(lx, ly)];
    s.leaderDist = dist < 0 ? Infinity : dist;
    if (dist < 0) { stopHere(s); s.doing = `cut off from ${L.callsign}`; return; }
    if (dist <= keep || (!s.catchingUp && dist <= keep + 1)) {
      s.catchingUp = false;
      stopHere(s, "covering");
      s.doing = `covering ${L.callsign}`;
      return;
    }
    s.catchingUp = true;
    const full = pathFrom(search, lx, ly);
    s.path = full.slice(0, Math.max(0, full.length - keep));
    s.goalKey = `follow:${lx},${ly}`;
    s.speed = dist > keep + 4 ? BEHAVIOR.pace.fast : Math.max(L.speed, s.speed);
    s.doing = `following ${L.callsign}`;
  }

  // ---------- Tasks ----------
  function setTask(s, task) {
    if (s.task && s.task.kind !== "hold" && s.task.kind !== "follow") s.prevTask = s.task;
    s.task = task;
    s.goalKey = null;
    s.lastTarget = null;
    if (s.flee && s.flee.reason !== "instinct") s.flee = null;
  }

  function taskText(s) {
    const t = s.task;
    switch (t.kind) {
      case "patrol": return t.wpRoom ? `patrol freely (checking ${t.wpRoom.name})` : "patrol freely";
      case "patrol_area": return `patrol ${t.room.name}`;
      case "goto":
        if (t.spread) return `take spread position (${t.tile.join(", ")})`;
        return t.room ? `go to ${t.room.name}` : `go to (${t.tile.join(", ")})`;
      case "heading": return `head ${t.dir}`;
      case "hold": return "hold position";
      case "follow": return `follow ${s.leader ? s.leader.callsign : "nobody"}`;
      case "retreat": return t.room ? `retreat to ${t.room.name}` : "retreat from danger";
    }
    return t.kind;
  }

  function doTask(s, dt) {
    const t = s.task;
    switch (t.kind) {
      case "follow": return follow(s);
      case "hold":
        stopHere(s, "hold");
        s.doing = "holding position";
        return;
      case "goto":
      case "heading": {
        if (atTile(s, t.tile)) {
          const at = where(...t.tile);
          if (!t.spread) {
            emit(s, t.kind === "heading"
              ? `${label(s)} reached the furthest point ${t.dir} it can get to, in ${at}. Holding.`
              : `${label(s)} arrived at ${t.room ? t.room.name : `(${t.tile.join(", ")}) in ${at}`}. Holding.`);
          }
          setTask(s, { kind: "hold" });
          return doTask(s, dt);
        }
        if (!walkTo(s, ...t.tile)) {
          emit(s, `${label(s)} has no route to ${t.room ? t.room.name : "that position"}. Holding.`);
          setTask(s, { kind: "hold" });
          return;
        }
        if (waitForSquad(s)) return;
        s.doing = t.spread ? "moving to spread position" : `moving to ${t.room ? t.room.name : `(${t.tile.join(", ")})`}`;
        return;
      }
      case "patrol": return patrol(s, dt, null);
      case "patrol_area": return patrol(s, dt, t.room);
      case "retreat":
        if (!startFlee(s, "order", t.room)) {
          emit(s, `${label(s)} has nowhere to retreat to. Holding.`);
          setTask(s, { kind: "hold" });
        }
    }
  }

  // Patrol: walk to a waypoint, stop and look around, pick the next one.
  // Freely: rooms nobody has checked for a while, not the ones squad mates are already heading to.
  // In an area: random spots inside that room.
  function patrol(s, dt, area) {
    const t = s.task;
    if (t.tile && atTile(s, t.tile)) {
      t.tile = null;
      t.linger = area ? 1.5 + Math.random() * 2 : 2.5 + Math.random() * 2.5;
    }
    if (t.linger > 0) {
      t.linger -= dt;
      stopHere(s, "linger");
      s.doing = `patrolling, checking ${where(s.tx, s.ty)}`;
      return;
    }
    if (!t.tile) {
      const next = area ? areaWaypoint(s, area) : roomWaypoint(s);
      if (!next) { stopHere(s); s.doing = "patrolling, nowhere left to go"; return; }
      t.tile = next.tile;
      t.wpRoom = next.room;
    }
    if (!walkTo(s, ...t.tile, `patrol:${t.tile}`)) { t.tile = null; return; }
    if (waitForSquad(s)) return;
    s.doing = area ? `patrolling ${area.name}` : `patrolling, heading to ${t.wpRoom.name}`;
  }

  function roomWaypoint(s) {
    const [x, y] = here(s);
    const search = bfs(x, y);
    const current = roomOf(x, y);
    const claimed = soldiers.filter((o) => o !== s && o.task.kind === "patrol" && o.task.wpRoom).map((o) => o.task.wpRoom);
    let best = null, bestScore = -Infinity;
    for (const room of rooms) {
      if (room === current) continue;
      const tile = roomTile(room, s);
      const d = tile ? search.dist[idx(...tile)] : -1;
      if (d < 0) continue;
      const age = visited.has(room.name) ? Math.min(600, now - visited.get(room.name)) : 600;
      const score = age - d * 2 - (claimed.includes(room) ? 400 : 0) + Math.random() * 30;
      if (score > bestScore) { bestScore = score; best = { room, tile }; }
    }
    return best;
  }

  function areaWaypoint(s, room) {
    const [x, y] = here(s);
    if (roomOf(x, y) !== room) return { room, tile: roomTile(room, s) };
    const tiles = roomTiles(room).filter(([tx, ty]) => Math.hypot(tx - x, ty - y) >= 2.5);
    if (!tiles.length) return null;
    return { room, tile: tiles[Math.floor(Math.random() * tiles.length)] };
  }

  // ---------- Fleeing (panic instinct, retreat order, contact retreat) ----------
  // Away from known hostiles, around them rather than past them; or to a room if one is given.
  function startFlee(s, reason, room = null) {
    const [fx, fy] = here(s);
    const list = threats().filter((a) => Math.hypot(a.x - fx, a.y - fy) <= 12); // the ones that matter here
    // keep clear of hostiles, except for the first step out of where it stands
    const avoid = (x, y) => isOpen(x, y) && !list.some((a) => {
      const ax = Math.round(a.x), ay = Math.round(a.y);
      return (ax === x && ay === y) || (Math.abs(ax - x) <= 1 && Math.abs(ay - y) <= 1 && Math.abs(x - fx) + Math.abs(y - fy) > 1);
    });
    let search = bfs(fx, fy, avoid);
    let tile = null;
    if (room || !list.length) {
      tile = roomTile(room || findRoom("airlock"), s);
      if (search.dist[idx(...tile)] < 0) search = bfs(fx, fy);
    } else {
      let bestScore = -Infinity;
      for (let i = 0; i < search.dist.length; i++) {
        const d = search.dist[i];
        if (d < 0 || d > 25) continue;
        const x = i % cols, y = (i / cols) | 0;
        const away = Math.min(10, ...list.map((a) => Math.hypot(a.x - x, a.y - y)));
        const score = away * 3 - d * 0.5;
        if (score > bestScore) { bestScore = score; tile = [x, y]; }
      }
    }
    const cornered = list.length && !room && tile && tile[0] === fx && tile[1] === fy;
    if (!tile || search.dist[idx(...tile)] < 0 || cornered) {
      s.flee = null;
      s.panicCooldown = 3; // cornered: stand and fight (point-blank instinct still applies)
      return false;
    }
    const first = !s.flee;
    s.path = pathFrom(search, ...tile);
    s.goalKey = "flee";
    s.flee = { reason, room, tries: first ? 1 : s.flee.tries + 1 };
    if (first && reason === "instinct") {
      const n = s.visible.length;
      emit(s, `${label(s)} INSTINCT: overwhelmed by ${n} hostile${n === 1 ? "" : "s"} in ${where(fx, fy)}, breaking and running!`);
    }
    return true;
  }

  function doFlee(s) {
    const f = s.flee;
    s.speed = BEHAVIOR.pace.fast;
    s.instinct = f.reason === "instinct" ? "panic" : null;
    s.doing = f.reason === "instinct" ? "INSTINCT: running from hostiles" : f.room ? `retreating to ${f.room.name}` : "retreating from hostiles";
    if (!atRest(s)) return;
    // reached the spot: run further if it still isn't safe
    if (!f.room && f.tries < 4 && danger(s, threats()) >= BEHAVIOR.safe && startFlee(s, f.reason)) return;
    s.flee = null;
    s.panicCooldown = 4;
    const at = where(s.tx, s.ty);
    if (s.task.kind !== "follow") setTask(s, { kind: "hold" });
    emit(s, f.reason === "instinct"
      ? `${label(s)} broke away from the hostiles and is holding in ${at}.`
      : `${label(s)} fell back to ${at}. Holding.`);
  }

  // ---------- Combat ----------
  function shoot(s, c, instinct) {
    s.target = c.alien;
    s.gaze = c.angle;
    s.halt = true;
    s.wantFire = true;
    const at = `${tiles(c.d)} ${c.dir}`;
    if (instinct) {
      s.instinct = "point-blank";
      s.doing = `INSTINCT: firing point-blank at hostile ${at}`;
      if (s.orders.fire === "hold" && now - (s.lastPointBlank ?? -99) > 15) {
        emit(s, `${label(s)} INSTINCT: hostile ${at}, opening fire despite hold-fire.`);
      }
      s.lastPointBlank = now;
    } else {
      s.doing = `engaging hostile ${at}`;
    }
  }

  // A hostile is in view (not point-blank). Returns true if that took over from the task.
  function react(s, c) {
    const o = s.orders;
    const at = `${tiles(c.d)} ${c.dir}`;
    const canFire = o.fire === "free";
    if (o.contact === "retreat") {
      if (startFlee(s, "contact")) { doFlee(s); return true; }
    }
    if (o.contact === "hold") {
      s.halt = true;
      s.gaze = c.angle;
      if (canFire) shoot(s, c, false);
      s.doing = canFire ? `holding position, firing at hostile ${at}` : `holding position, weapons held, hostile ${at}`;
      return true;
    }
    if (canFire) {
      if (o.pursue === "on" && c.d > BEHAVIOR.effective && approach(s, c.alien.x, c.alien.y, BEHAVIOR.effective - 1, "close")) {
        s.gaze = c.angle;
        s.doing = `closing on hostile ${at}`;
        return true;
      }
      shoot(s, c, false);
      return true;
    }
    // weapons held: keep eyes on it, and shadow it if pursuing
    s.gaze = c.angle;
    if (o.pursue === "on") {
      if (c.d > BEHAVIOR.shadow + 1 && approach(s, c.alien.x, c.alien.y, BEHAVIOR.shadow, "shadow")) {
        s.doing = `shadowing hostile ${at}, weapons held`;
      } else {
        s.halt = true;
        s.doing = `watching hostile ${at}, weapons held`;
      }
      return true;
    }
    s.contactNote = `hostile ${at} in view, weapons held`;
    return false;
  }

  // The hostile it was fighting slipped out of view: go where it can be seen again
  function chase(s) {
    const c = s.lastTarget;
    if (!c || c.alien.dead || now - c.seen > 12 || s.orders.pursue !== "on" || s.orders.contact !== "engage") {
      s.lastTarget = null;
      return false;
    }
    const k = known.get(c.alien) || c.alien;
    const range = s.orders.fire === "free" ? BEHAVIOR.effective - 1 : BEHAVIOR.shadow;
    if (!approach(s, k.x, k.y, range, "chase") || (atRest(s) && s.goalKey === `chase:${Math.round(k.x)},${Math.round(k.y)}` && now - c.seen > 2)) {
      s.lastTarget = null;
      return false;
    }
    s.gaze = angleTo(s, k.x, k.y);
    s.doing = `pursuing hostile last seen in ${where(k.x, k.y)}`;
    return true;
  }

  // Called by world.js for each round fired. Returns what it was aimed at and whether it hit,
  // so world.js can draw the round landing on the target or on the wall behind it.
  function shot(s) {
    const a = s.target;
    if (!a || a.dead) return { target: null, hit: false };
    const [px, py] = pos(s);
    const d = Math.hypot(a.x - px, a.y - py);
    const skill = s.orders.pace === "slow" ? 1.1 : s.orders.pace === "fast" ? 0.8 : 1;
    a.alertedBy = s; // the gunfire gives the shooter away
    if (Math.random() > clamp(0.95 - d * 0.09, 0.2, 0.9) * skill) return { target: a, hit: false };
    a.hp = Math.max(0, a.hp - BEHAVIOR.damage);
    if (a.hp > 0) return { target: a, hit: true, killed: false };
    a.dead = true;
    known.delete(a);
    kills++;
    s.kills++;
    killAlien(a);
    emit(s, `${label(s)} killed a hostile in ${where(a.x, a.y)}.`);
    return { target: a, hit: true, killed: true };
  }

  // Take health off a soldier. how: what happened, for the death report ("was taken by a hostile in ...")
  function hurt(s, amount, how = null) {
    if (s.dead) return;
    s.hp = Math.max(0, s.hp - amount);
    if (s.hp > 0) {
      if (s.hp <= 30 && s.hp + amount > 30) emit(s, `${label(s)} badly wounded, health ${s.hp}.`);
      return;
    }
    s.dead = true;
    s.path = [];
    s.target = null;
    s.wantFire = false;
    soldiers = soldiers.filter((o) => o !== s);
    // whoever followed them follows their leader, or the senior of them takes over
    const orphans = everyone.filter((o) => o.leader === s).sort((a, b) => a.id - b.id);
    if (orphans.length) {
      const next = s.leader || orphans[0];
      if (!s.leader) { orphans[0].leader = null; orphans[0].task = { ...s.task }; orphans[0].goalKey = null; }
      orphans.forEach((o) => { if (o !== next) o.leader = next; });
    }
    s.leader = null;
    killSoldier(s);
    emit(s, `${label(s)} ${how || "is down"}. No life signs.`);
  }

  // ---------- Where to look ----------
  // Every so often a soldier glances somewhere else for a moment, then looks back.
  // Returns the current glance (radians, added to where they look). kind: "walk" | "stand" | "watch".
  const GLANCES = {
    walk: { every: [3, 7], size: [0.6, 1.2], hold: [0.8, 1.5] },   // walking: mostly straight ahead
    stand: { every: [2.5, 5], size: [0.7, 1.4], hold: [1, 2] },    // standing: looking around more
    watch: { every: [4, 8], size: [0.8, 1.5], hold: [0.8, 1.4] },  // told where to look: brief checks elsewhere
  };
  function glanceFor(s, dt, kind) {
    const g = GLANCES[kind];
    const pick = ([lo, hi]) => lo + Math.random() * (hi - lo);
    if ((s.glanceT -= dt) <= 0) {
      s.glancing = !s.glancing;
      s.glanceT = pick(s.glancing ? g.hold : g.every);
      s.glanceOff = s.glancing ? (Math.random() < 0.5 ? -1 : 1) * pick(g.size) : 0;
    }
    return s.glanceOff;
  }

  // A "watch" order only lasts while standing: a few seconds after the soldier starts moving it lapses
  const WATCH_LAPSE = 4; // seconds of moving
  function lapseWatch(s, dt, moving) {
    if (s.orders.watch === "auto" || !moving) { s.watchMoving = 0; return; }
    if ((s.watchMoving += dt) < WATCH_LAPSE) return;
    s.orders.watch = "auto";
    s.watchAim = null;
    s.watchMoving = 0;
  }

  // Where to look when nothing specific (a hostile, a target) has the soldier's attention.
  // auto: face where they walk; standing, each member of a group covers a different sector
  // (front, right, left, rear) so together they watch all around.
  function watch(s, dt, moving) {
    if (s.gaze != null) return; // already looking at something specific
    const w = s.orders.watch;
    const base = s.restHeading ?? s.heading;
    const sway = Math.sin(now * 0.7 + s.id * 1.7) * 0.08; // never perfectly still
    if (s.watchAim) { // a direction, or a point it keeps facing
      s.gaze = s.watchAim.point ? angleTo(s, ...s.watchAim.point) : s.watchAim.heading;
      s.glance = glanceFor(s, dt, "watch") + sway;
    } else if (w === "rear") {
      s.gaze = base + Math.PI;
      s.glance = glanceFor(s, dt, "watch") + sway;
    } else if (moving) { // auto or front: eyes on the way ahead, with the odd look around
      s.glance = glanceFor(s, dt, "walk") + sway;
    } else if (w === "front") {
      s.gaze = base;
      s.glance = glanceFor(s, dt, "watch") + sway;
    } else {
      const group = groupOf(s);
      const r = group.indexOf(s) % 4;
      s.gaze = base + [0, Math.PI / 2, -Math.PI / 2, Math.PI][r];
      s.glance = glanceFor(s, dt, "stand") + sway;
    }
  }

  // ---------- Decide ----------
  function think(s, dt) {
    s.halt = false;
    s.wantFire = false;
    s.target = null;
    s.gaze = null;
    s.glance = 0;
    s.instinct = null;
    s.speed = BEHAVIOR.pace[s.orders.pace];
    if (s.panicCooldown > 0) s.panicCooldown -= dt;

    lapseWatch(s, dt, s.moving || (!s.halt && s.path.length > 0));
    perceive(s);
    s.danger = danger(s, [...new Set([...s.visible.map((c) => c.alien), ...recent(s)])]);
    const calm = clamp(s.danger / BEHAVIOR.panic + (s.visible.length ? 0.25 : 0) + (s.fireLeft > 0 ? 0.2 : 0) + (s.flee ? 0.4 : 0), 0, 1);
    s.stress += (calm - s.stress) * Math.min(1, dt * (calm > s.stress ? 1 : 0.12));

    // INSTINCT
    if (!s.flee && s.danger >= BEHAVIOR.panic && !(s.panicCooldown > 0)) startFlee(s, "instinct");
    if (s.flee) return doFlee(s);
    const c = s.visible[0];
    if (c && c.d <= BEHAVIOR.pointBlank) return shoot(s, c, true);

    // ORDERS / DEFAULT: react to hostiles, then the task
    if (c) {
      s.lastTarget = { alien: c.alien, seen: now };
      if (react(s, c)) return;
    } else if (chase(s)) return;
    s.contactNote = null;
    doTask(s, dt);
    if (s.contactNote) s.doing += `, ${s.contactNote}`;
    watch(s, dt, !s.halt && (s.path.length > 0 || s.progress < 1));
  }

  function init(s, index) {
    Object.assign(s, {
      task: { kind: "patrol" }, prevTask: null,
      orders: { ...DEFAULT_ORDERS },
      leader: null, team: null,
      path: [], goalKey: null, halt: false, speed: BEHAVIOR.pace.normal,
      target: null, wantFire: false, gaze: null, glance: 0, restHeading: null,
      visible: [], danger: 0, stress: 0, instinct: null, doing: "",
      flee: null, lastTarget: null, panicCooldown: 0, kills: 0, leaderDist: 0, catchingUp: false,
      thinkT: index * 0.025, thinkDt: 0,
      glanceT: 2 + Math.random() * 4, glancing: false, glanceOff: 0, watchMoving: 0, watchAim: null,
      chargeCalled: new Map(), lostInfo: null, lostCalledAt: -99, trackerD: null, trackerCalledAt: -99,
      hp: BEHAVIOR.hp.soldier, dead: false,
    });
  }
  soldiers.forEach(init);
  // DEFAULT: the squad starts together behind the sergeant
  soldiers.slice(1).forEach((s) => { s.leader = soldiers[0]; s.task = { kind: "follow" }; });

  function update(s, dt) {
    if (s.dead) return;
    s.thinkDt += dt;
    if ((s.thinkT -= dt) > 0) return;
    s.thinkT = BEHAVIOR.thinkEvery;
    const elapsed = s.thinkDt;
    s.thinkDt = 0;
    think(s, elapsed);
  }

  // Called by world.js each time a soldier steps onto a new tile
  function arrived(s) {
    const room = roomOf(s.tx, s.ty);
    if (room && room !== s.lastRoom) {
      visited.set(room.name, now);
      const t = s.task;
      if ((t.kind === "goto" || t.kind === "heading") && !t.spread && t.room !== room) {
        emit(s, `${label(s)} entering ${room.name} while ${taskText(s)}.`);
      }
    }
    s.lastRoom = room;
  }

  // ---------- Orders ----------
  // unit: "all", 1-4, a name, "alpha"/"bravo", or a comma-separated list of those
  function findUnits(unit, among = soldiers) {
    const u = String(unit ?? "").trim().toLowerCase();
    if (u.includes(",")) return [...new Set(u.split(",").flatMap((p) => findUnits(p, among)))];
    if (["all", "*", "squad", "everyone"].includes(u)) return among.slice();
    const team = u.replace(/^team\s*/, "");
    if (team === "alpha" || team === "bravo") return among.filter((s) => s.team === team.toUpperCase());
    const n = u.replace(/^unit[-\s]*/, "").replace(/^0+/, "");
    const byId = among.filter((s) => String(s.id) === n);
    if (byId.length) return byId;
    return among.filter((s) => s.callsign.toLowerCase() === u || (u.length >= 3 && s.name.toLowerCase().includes(u)));
  }

  function parseTile(arg) {
    const m = arg.match(/^\(?\s*(\d+)\s*[,\s]\s*(\d+)\s*\)?$/);
    if (!m) return null;
    const x = Number(m[1]), y = Number(m[2]);
    // a wall tile: use the nearest open one
    let best = null, bestD = Infinity;
    for (let dy = -3; dy <= 3; dy++)
      for (let dx = -3; dx <= 3; dx++)
        if (isOpen(x + dx, y + dy) && Math.hypot(dx, dy) < bestD) { bestD = Math.hypot(dx, dy); best = [x + dx, y + dy]; }
    return best || "wall";
  }

  const TASKS = {
    patrol(s, arg) {
      if (!arg) { setTask(s, { kind: "patrol" }); return ok("Patrolling freely."); }
      const room = findRoom(arg);
      if (!room) return bad(unknownRoom(arg));
      setTask(s, { kind: "patrol_area", room });
      return ok(`Patrolling ${room.name}.`);
    },
    goto(s, arg) {
      if (!arg) return bad("goto needs a room or a grid position, e.g. goto medlab, goto 21 15.");
      let tile = parseTile(arg), room = null;
      if (tile === "wall") return bad(`(${arg}) is solid wall. Pick an open tile from the map.`);
      if (!tile) {
        room = findRoom(arg);
        if (!room) return bad(unknownRoom(arg));
        tile = roomTile(room, s);
      }
      const [fx, fy] = here(s);
      const d = bfs(fx, fy).dist[idx(...tile)];
      if (d < 0) return bad(`No route to ${room ? room.name : `(${tile.join(", ")})`}.`);
      setTask(s, { kind: "goto", tile, room });
      const name = room ? room.name : `(${tile.join(", ")}) in ${where(...tile)}`;
      return ok(d ? `Moving to ${name}, ${d} tiles.` : `Already at ${name}.`);
    },
    hold(s) {
      setTask(s, { kind: "hold" });
      return ok("Holding position.");
    },
    retreat(s, arg) {
      const room = arg ? findRoom(arg) : null;
      if (arg && !room) return bad(unknownRoom(arg));
      setTask(s, { kind: "retreat", room });
      const [x, y] = here(s);
      const near = threats().some((a) => Math.hypot(a.x - x, a.y - y) <= 12);
      return ok(room ? `Falling back to ${room.name}.` : near ? "Falling back from the hostiles." : "No hostiles close. Falling back to the AIRLOCK.");
    },
    follow(s, arg) {
      const L = findUnits(arg)[0];
      if (!L || L === s) return bad(`follow needs another unit, e.g. follow 1.`);
      if (rootOf(L) === s) return bad(`${L.callsign} is already following ${s.callsign}.`);
      setTask(s, { kind: "follow" });
      s.leader = L;
      s.team = L.team;
      return ok(`Following ${L.callsign}.`);
    },
    continue(s) {
      const p = s.prevTask;
      if (!p) return TASKS.patrol(s, "");
      if (p.kind === "heading") return TASKS[p.dir](s);
      setTask(s, { ...p, linger: 0 });
      return ok(`Resuming: ${taskText(s)}.`);
    },
  };
  DIR_NAMES.forEach((dir, d) => {
    TASKS[dir] = (s) => {
      const tile = headingTile(s, d);
      if (!tile) return bad(`Already as far ${dir} as the colony goes from here.`);
      setTask(s, { kind: "heading", dir, tile });
      return ok(`Heading ${dir}, ending in ${where(...tile)}.`);
    };
  });

  const SHAPES = {
    // Everyone named falls in behind the lowest-numbered of them
    together(units) {
      const sorted = [...units].sort((a, b) => a.id - b.id);
      const L = sorted[0];
      if (L.leader) { L.leader = null; if (L.task.kind === "follow") setTask(L, { kind: "hold" }); }
      const team = units.length === soldiers.length ? null : L.team;
      L.team = team;
      sorted.slice(1).forEach((o) => { o.leader = L; o.team = team; setTask(o, { kind: "follow" }); });
      return sorted.map((o) => ({ unit: o.id, name: o.callsign, ok: true,
        detail: o === L ? `Group forming on me (${units.length}). Task: ${taskText(L)}.` : `Forming on ${L.callsign}.` }));
    },
    // Two teams, each following its own leader
    split(units) {
      if (units.length < 2) return units.map((o) => ({ unit: o.id, name: o.callsign, ok: false, detail: "Need at least two units to split." }));
      const sorted = [...units].sort((a, b) => a.id - b.id);
      const half = Math.ceil(sorted.length / 2);
      const leadTask = rootOf(sorted[0]).task;
      const out = [];
      [sorted.slice(0, half), sorted.slice(half)].forEach((g, i) => {
        const team = i ? "BRAVO" : "ALPHA";
        const L = g[0];
        L.leader = null;
        L.team = team;
        if (L.task.kind === "follow") setTask(L, leadTask.kind === "patrol" ? { kind: "patrol" } : { kind: "hold" });
        g.slice(1).forEach((o) => { o.leader = L; o.team = team; setTask(o, { kind: "follow" }); });
        g.forEach((o) => out.push({ unit: o.id, name: o.callsign, ok: true,
          detail: `Team ${team}, ${o === L ? `leading ${g.slice(1).map((x) => x.callsign).join(", ") || "alone"}` : `following ${L.callsign}`}.` }));
      });
      return out;
    },
    // Fan out across the current room (or nearby corridor) and act independently
    spread(units) {
      units.forEach((o) => { o.leader = null; });
      const [x0, y0] = here(units[0]);
      const room = roomOf(x0, y0);
      let spots = room ? roomTiles(room) : [];
      if (!room) {
        const search = bfs(x0, y0);
        for (let i = 0; i < search.dist.length; i++) if (search.dist[i] >= 0 && search.dist[i] <= 5) spots.push([i % cols, (i / cols) | 0]);
      }
      // farthest-point picks: each spot as far as possible from those already chosen
      const cx = spots.reduce((a, t) => a + t[0], 0) / spots.length, cy = spots.reduce((a, t) => a + t[1], 0) / spots.length;
      const chosen = [spots.reduce((b, t) => (Math.hypot(t[0] - cx, t[1] - cy) > Math.hypot(b[0] - cx, b[1] - cy) ? t : b))];
      while (chosen.length < units.length) {
        const far = (t) => Math.min(...chosen.map((c) => Math.hypot(c[0] - t[0], c[1] - t[1])));
        chosen.push(spots.reduce((b, t) => (far(t) > far(b) ? t : b)));
      }
      const free = [...units];
      const out = [];
      chosen.forEach((tile) => {
        const o = free.reduce((b, u) => {
          const [ux, uy] = here(u), [bx, by] = here(b);
          return Math.hypot(ux - tile[0], uy - tile[1]) < Math.hypot(bx - tile[0], by - tile[1]) ? u : b;
        });
        free.splice(free.indexOf(o), 1);
        setTask(o, { kind: "goto", tile, room: null, spread: true });
        out.push({ unit: o.id, name: o.callsign, ok: true, detail: `Spreading out to (${tile.join(", ")}).` });
      });
      return out.sort((a, b) => a.unit - b.unit);
    },
  };

  // watch: auto | front | rear | a compass direction (north-east, ne, ...) | center (of the room it's in) |
  // a room (looks toward its centre) | a grid position "x y"
  function setWatch(s, raw) {
    let arg = raw.trim();
    while (/^(to|towards?|the|at|into)\s+/.test(arg)) arg = arg.replace(/^(to|towards?|the|at|into)\s+/, "");
    const lapse = " (lapses a few seconds after moving off)";
    const set = (label, aim, says) => {
      s.orders.watch = label;
      s.watchAim = aim;
      s.watchMoving = 0;
      return ok(says + (label === "auto" ? "" : lapse));
    };
    const simple = Object.keys(STANDING.watch).find((v) => v === arg || STANDING.watch[v][0].includes(arg));
    if (simple) return set(simple, null, STANDING.watch[simple][1]);
    // compass: "north-east", "northeast", "north east", "ne"
    const word = arg.replace(/[\s_]+/g, "-");
    const ci = COMPASS.findIndex((c) => c === word || c.replace("-", "") === word.replace("-", "") ||
      c.split("-").map((p) => p[0]).join("") === word);
    if (ci >= 0) {
      const a = ci * (Math.PI / 4); // clockwise from north; y grows south
      return set(COMPASS[ci], { heading: headingFor([Math.sin(a), -Math.cos(a)]) }, `Watching ${COMPASS[ci]}.`);
    }
    const centre = (r) => [r.x + (r.w - 1) / 2, r.y + (r.h - 1) / 2];
    if (/^(cent(er|re)|middle)( of( the)? room)?$|^room( cent(er|re))?$/.test(arg)) {
      const [x, y] = here(s);
      const room = roomOf(x, y);
      if (!room) return bad("Not in a room: give a direction (e.g. north-east), a room, or a position (x y) to watch.");
      return set(`center of ${room.name}`, { point: centre(room) }, `Watching the middle of ${room.name}.`);
    }
    const xy = arg.match(/^\(?\s*(\d+)\s*[,\s]\s*(\d+)\s*\)?$/);
    if (xy) {
      const point = [Number(xy[1]), Number(xy[2])];
      return set(`(${point.join(", ")})`, { point }, `Watching (${point.join(", ")}).`);
    }
    const room = findRoom(arg);
    if (room) return set(room.name, { point: centre(room) }, `Watching toward ${room.name}.`);
    return bad("watch needs: auto, front, rear, a direction (north, north-east, ne...), center (of this room), a room, or a position (x y).");
  }

  function setStanding(s, key, arg) {
    if (key === "reset") { s.orders = { ...DEFAULT_ORDERS }; s.watchAim = null; return ok("Standing orders back to default."); }
    if (key === "watch") return setWatch(s, arg);
    const options = STANDING[key];
    const value = Object.keys(options).find((v) => v === arg || options[v][0].includes(arg));
    if (!value) return bad(`${key} needs one of: ${Object.keys(options).join(", ")}.`);
    s.orders[key] = value;
    if (key === "watch") s.watchMoving = 0;
    return ok(options[value][1] + (key === "watch" && value !== "auto" ? " (lapses a few seconds after moving off)" : ""));
  }

  // Apply an order. Returns one { unit, name, ok, detail } per unit addressed.
  function order(unitSpec, rawAction, rawTarget) {
    const fallen = findUnits(unitSpec, everyone).filter((s) => s.dead);
    if (fallen.length && !findUnits(unitSpec).length) {
      return fallen.map((s) => ({ unit: s.id, name: s.callsign, ok: false, detail: `${s.callsign} is KIA.` }));
    }
    const results = applyOrder(unitSpec, rawAction, rawTarget);
    soldiers.forEach((s) => think(s, 0)); // act on it now, so the status sent back is current
    return results;
  }

  function applyOrder(unitSpec, rawAction, rawTarget) {
    const units = findUnits(unitSpec);
    if (!units.length) {
      const teamless = /^(team\s*)?(alpha|bravo)$/i.test(String(unitSpec).trim());
      return [{ unit: unitSpec, ok: false, detail: teamless
        ? `There is no team ${String(unitSpec).toUpperCase()} right now. Order "all split" first, or use unit numbers.`
        : `No unit called "${unitSpec}". Use 1-${soldiers.length}, a name, alpha, bravo or all.` }];
    }
    let action = String(rawAction || "").trim().toLowerCase();
    let arg = String(rawTarget || "").trim().toLowerCase();
    if (SHORTCUTS[action]) [action, arg] = [SHORTCUTS[action][0], SHORTCUTS[action][1] ?? arg];
    const result = (s, r) => ({ unit: s.id, name: s.callsign, ...r });

    if (SHAPES[action]) return SHAPES[action](units);
    if (STANDING[action] || action === "reset") return units.map((s) => result(s, setStanding(s, action, arg)));
    if (!TASKS[action]) return [{ unit: unitSpec, ok: false, detail: `Unknown order "${rawAction}". ${ORDER_HELP}` }];
    return units.map((s) => {
      // a follower whose leader got the same order stays in formation; the leader carries the task
      if (s.leader && units.includes(rootOf(s)) && action !== "follow") return result(s, ok(`Staying with ${s.leader.callsign}.`));
      const wasFollowing = s.leader && action !== "follow" ? s.leader : null;
      const r = TASKS[action](s, arg);
      if (r.ok && wasFollowing) { s.leader = null; r.detail = `Leaving ${wasFollowing.callsign}'s group. ${r.detail}`; }
      return result(s, r);
    });
  }

  // ---------- Reporting ----------
  function describe(s) {
    if (s.dead) return { health: 0, status: "KIA" };
    return {
      health: s.hp,
      status: s.hp > 60 ? "OK" : s.hp > 30 ? "WOUNDED" : "CRITICAL",
      team: s.team,
      following: s.leader ? s.leader.callsign : null,
      followed_by: followersOf(s).map((o) => o.callsign),
      task: taskText(s),
      standing_orders: { ...s.orders },
      doing: s.doing,
      instinct: s.instinct,
      hostiles_in_view: s.visible.map((c) => ({
        distance_tiles: Math.round(c.d), direction: c.dir, position: { x: Math.round(c.alien.x), y: Math.round(c.alien.y) },
        health: c.alien.hp, moving: c.alien.progress < 1, charging: c.alien.mode === "chase",
      })),
      kills: s.kills,
      motion_tracker: tracker(s),
    };
  }

  // Movement within range, floor or ducts alike (like the sonar on the map)
  function tracker(s) {
    const [px, py] = pos(s);
    const near = aliens.filter((a) => !a.dead)
      .map((a) => ({ a, d: Math.hypot(a.x - px, a.y - py) }))
      .filter((m) => m.d <= BEHAVIOR.tracker)
      .sort((p, q) => p.d - q.d);
    if (!near.length) return { signals: 0 };
    const { a, d } = near[0];
    return { signals: near.length, nearest: d < 1 ? "right on top of us" : `${tiles(d)} ${compass(a.x - px, a.y - py)}` };
  }

  function squadStatus() {
    return {
      known_hostiles: [...known].filter(([a]) => !a.dead).map(([a, k]) => ({
        position: { x: Math.round(k.x), y: Math.round(k.y) }, location: where(k.x, k.y), health: a.hp,
        last_seen_seconds_ago: Math.round(now - k.seen), spotted_by: k.by,
      })),
      hostiles_killed: kills,
    };
  }

  // Short code for the squad list on screen
  function shortCode(s) {
    if (s.dead) return "KIA";
    if (s.instinct === "panic") return "FLEE!";
    if (s.instinct) return "FIRE!";
    if (s.flee) return "RTRT";
    if (s.wantFire || s.fireLeft > 0) return "ENGG";
    const t = s.task;
    switch (t.kind) {
      case "patrol": return "PATR";
      case "patrol_area": return "P:" + t.room.label;
      case "goto": return t.spread ? "SPRD" : "→" + (t.room ? t.room.label : "POS");
      case "heading": return "→" + t.dir[0].toUpperCase();
      case "hold": return "HOLD";
      case "follow": return s.leader ? `FOL${s.leader.id}` : "FOL";
      case "retreat": return "RTRT";
    }
    return "--";
  }

  return {
    tick(dt) { now += dt; },
    update, arrived, shot, hurt, order, findUnits, describe, squadStatus, shortCode,
  };
}
