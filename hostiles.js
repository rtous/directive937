"use strict";

// Hostile behavior, on two levels:
//   DUCTS   the ventilation ducts above the colony (sectors.js: a network of lines branching out from THE NEST
//           to every ceiling opening). Hostiles there can't be seen or shot (only the sonar picks them up) and
//           crawl only along the ducts. New ones come in where the sector's ducts do: from the border on the
//           nest's side, or the nest itself. A release schedule sends them, one at a time, to a ceiling opening,
//           where they drop in. The release rate doubles every VENTS.doubling seconds.
//   GIANT   one huge hostile in THE NEST (sectors.js): never moves. It turns toward the nearest soldier it can see
//           and lashes out at them (GIANT.range), and it takes a lot of rounds to bring down.
//   FLOOR   roam the colony: pick somewhere else (another room, down the corridors), walk there opening doors on
//           the way (not sealed ones), stop and listen, pick again; on seeing a soldier (or being shot) run at
//           them; touching a soldier kills them. Lose sight -> search where they were last seen, then roam again.

const HOSTILE = {
  wander: 1.1,       // walking speed, world units per second
  chase: 2.6,        // running speed (a soldier on "pace fast" is slightly quicker)
  turn: 6,           // radians per second
  sight: 8,          // tiles
  fogSight: 3,       // tiles, when either side is in fog
  fov: 1.4,          // half-angle of view, radians
  sense: 3,          // soldiers this close are noticed in any direction
  reach: 0.7,        // tiles: closer than this to a soldier = the soldier is taken
  feed: 2.5,         // seconds it stays put after a kill
  thinkEvery: 0.15,
  roam: [6, 30],     // tiles of walking to the next place it roams to [min, max]
  listen: [1, 4],    // seconds it stops there, listening
};

// The release schedule. A level can override any of these (levels.js: hostiles).
const VENTS = {
  start: 0,          // hostiles in the ducts when the level starts (none: the colony is silent)
  firstArrival: 20,  // seconds before the first ones reach the ducts (and show on the sonar)
  grace: 35,         // seconds before the first one comes down
  doubling: 50,      // seconds for the number released to double (1, 2, 4, 8, ...)
  stock: 4,          // keep at least this many waiting in the ducts...
  cap: 40,           // ...as long as fewer than this many are alive in total
  arriveEvery: 4,    // seconds between new arrivals where the ducts come in
  crawl: 1.6,        // tiles per second, heading for an opening
  drift: 0.5,        // tiles per second, idling in the ducts
  driftRange: 12,    // tiles along the ducts an idle one wanders to
  drop: 0.6,         // seconds to drop from the ceiling to the floor
  nearSquad: 0.6,    // chance an opening near the squad is picked rather than any opening
};

const GIANT = {
  hp: 2000,          // health (a normal hostile has BEHAVIOR.hp.alien; a round takes BEHAVIOR.damage)
  scale: 3,          // times the size of a normal hostile
  range: 6,          // tiles: it lashes at soldiers this close that it can see
  damage: 25,        // health one lash takes off
  every: 2.5,        // seconds between lashes
  turn: 1.2,         // radians per second
};

// nav: grid helpers (nav.js). TILE: world units per tile. ceiling: height a dropping hostile starts from.
// soldiers: the squad (those out of play are skipped). fogAt(x, y): is that tile in fog. vents: [[x, y]] ceiling
// openings. ducts: { root, links } (sectors.js: buildDucts). schedule: the level's overrides of VENTS. spawn(x, y): create a new hostile in the ducts at that point
// (world.js calls initVent on it). killSoldier(soldier): a soldier was caught. lash(giant, soldier): the giant hit
// a soldier (world.js takes the health off).
function createHostiles({ nav, TILE, ceiling, soldiers, fogAt, vents, ducts, schedule, spawn, killSoldier, lash }) {
  // they open doors like the soldiers do (walking into one), but can't get through a sealed one (walkable)
  const { walkable, doors, DIRS, bfs, pathFrom, idx, angleDiff, clearLine, cols, rows, roomOf } = nav;
  const V = { ...VENTS, ...schedule };
  const living = () => soldiers.filter((s) => !s.dead);

  // On the floor, standing on tile (a.x, a.y)
  function init(a) {
    Object.assign(a, {
      inVent: false,
      tx: a.x, ty: a.y, nx: a.x, ny: a.y, progress: 1, dir: -1,
      heading: a.group.rotation.y, path: [], pathKey: null,
      mode: "wander", prey: null, lastSeen: null, alertedBy: null,
      pause: Math.random() * 6, thinkT: Math.random() * HOSTILE.thinkEvery, state: "idle",
    });
  }

  // ---------- Ducts ----------
  let clock = 0;        // seconds since the level started
  let released = 0;     // hostiles sent down so far
  let arriveT = V.firstArrival;

  // The ducts as a graph of tiles: key -> neighbouring keys
  const ductKey = (x, y) => Math.round(y) * cols + Math.round(x);
  const ductXY = (k) => [k % cols, Math.floor(k / cols)];
  const ductNext = new Map();
  const join = (a, b) => (ductNext.get(a) || ductNext.set(a, []).get(a)).push(b);
  for (const [x1, y1, x2, y2] of ducts.links) { join(ductKey(x1, y1), ductKey(x2, y2)); join(ductKey(x2, y2), ductKey(x1, y1)); }
  const ductTiles = [...ductNext.keys()];

  // Breadth first along the ducts from tile `from`: the way to `to` (keys after `from`), or, with no `to`, the
  // tiles within `range` steps
  function ductSearch(from, to = null, range = Infinity) {
    const prev = new Map([[from, -1]]), steps = new Map([[from, 0]]), queue = [from];
    for (let q = 0; q < queue.length; q++) {
      const k = queue[q];
      if (k === to) break;
      if (steps.get(k) >= range) continue;
      for (const n of ductNext.get(k) || []) {
        if (prev.has(n)) continue;
        prev.set(n, k);
        steps.set(n, steps.get(k) + 1);
        queue.push(n);
      }
    }
    if (to == null) return queue;
    if (!prev.has(to)) return null;
    const path = [];
    for (let k = to; k !== from; k = prev.get(k)) path.unshift(k);
    return path;
  }

  // In the ducts at (a.x, a.y), which is on them: hidden, drifting
  function initVent(a) {
    Object.assign(a, { inVent: true, vent: null, ductAt: ductKey(a.x, a.y), ductPath: [], ductGoal: null, dropT: 0,
      state: "idle", mode: "duct", progress: 1 });
    a.group.visible = false;
  }

  // Where new ones come into this sector's ducts, and anywhere along them (for those already there at the start)
  const entryPoint = () => [...ducts.root];
  const ductPoint = () => ductXY(ductTiles.length ? ductTiles[Math.floor(Math.random() * ductTiles.length)] : ductKey(...ducts.root));

  // Mostly an opening close to a soldier (they hunt), sometimes any opening
  function chooseVent() {
    const squad = living();
    if (squad.length && Math.random() < V.nearSquad) {
      const [sx, sy] = unitPos(squad[Math.floor(Math.random() * squad.length)]);
      return vents.reduce((b, v) => (Math.hypot(v[0] - sx, v[1] - sy) < Math.hypot(b[0] - sx, b[1] - sy) ? v : b));
    }
    return vents[Math.floor(Math.random() * vents.length)];
  }

  // How many should have come down by now: 0 during the grace period, then 1, 2, 4, 8...
  const due = () => (clock < V.grace ? 0 : Math.floor(2 ** ((clock - V.grace) / V.doubling)));

  // Once per frame, before update(): release hostiles on schedule and keep the ducts stocked
  function tick(dt, aliens) {
    clock += dt;
    while (released < due()) {
      const waiting = aliens.filter((a) => !a.dead && a.inVent && !a.vent);
      if (!waiting.length) break; // more will arrive at the edges and catch up
      const a = waiting[Math.floor(Math.random() * waiting.length)];
      a.vent = chooseVent();
      released++;
    }
    const alive = aliens.filter((a) => !a.dead).length;
    const idle = aliens.filter((a) => !a.dead && a.inVent && !a.vent).length;
    if ((arriveT -= dt) <= 0 && idle < V.stock && alive < V.cap) {
      arriveT = V.arriveEvery;
      spawn(...entryPoint());
    }
  }

  function updateVent(a, dt) {
    if (a.dropT > 0) { // falling through the opening
      a.dropT -= dt;
      a.group.position.y = Math.max(0, a.dropT / V.drop) * (ceiling - 0.4);
      if (a.dropT <= 0) {
        a.group.position.y = 0;
        init(a);
        a.pause = 0.4;
        a.heading = a.group.rotation.y;
        a.freshDrop = 3; // seconds it still counts as "just dropped in" (for the soldiers' reports)
      }
      a.mixer.update(dt);
      return;
    }
    // where it's crawling to: the opening it was sent to, or (idle) somewhere along the ducts nearby
    const ventAt = a.vent ? ductKey(...a.vent) : null;
    if (ventAt != null && a.ductGoal !== ventAt) { // just sent: turn for the opening, from the next tile on
      const from = a.ductPath.length ? a.ductPath[0] : a.ductAt;
      const way = ductSearch(from, ventAt);
      a.ductGoal = ventAt;
      a.ductPath = way ? (a.ductPath.length ? [from, ...way] : way) : [];
    }
    if (!a.ductPath.length) {
      if (ventAt != null) { // at the opening (or it isn't on the ducts): drop
        [a.x, a.y] = a.vent;
        a.dropT = V.drop;
        a.group.visible = true;
        a.group.position.set(a.x * TILE, ceiling - 0.4, a.y * TILE);
        a.group.rotation.y = Math.random() * Math.PI * 2;
        return;
      }
      const near = ductSearch(a.ductAt, null, V.driftRange);
      a.ductGoal = near[Math.floor(Math.random() * near.length)];
      a.ductPath = ductSearch(a.ductAt, a.ductGoal) || [];
    }
    // along the path, tile to tile
    let step = (a.vent ? V.crawl : V.drift) * dt;
    while (step > 0 && a.ductPath.length) {
      const [nx, ny] = ductXY(a.ductPath[0]);
      const dx = nx - a.x, dy = ny - a.y, d = Math.hypot(dx, dy);
      if (d > step) {
        a.x += (dx / d) * step;
        a.y += (dy / d) * step;
        step = 0;
      } else {
        [a.x, a.y] = [nx, ny];
        a.ductAt = a.ductPath.shift();
        step -= d;
      }
    }
  }

  // Nearest soldier this alien can see right now
  function spot(a) {
    const [ax, ay] = unitPos(a);
    let best = null, bestD = Infinity;
    for (const s of living()) {
      const [sx, sy] = unitPos(s);
      const d = Math.hypot(sx - ax, sy - ay);
      const range = fogAt(ax, ay) || fogAt(sx, sy) ? HOSTILE.fogSight : HOSTILE.sight;
      if (d > range || d >= bestD) continue;
      const angle = Math.atan2(sx - ax, sy - ay); // same convention as group.rotation.y
      if (d > HOSTILE.sense && Math.abs(angleDiff(a.heading, angle)) > HOSTILE.fov) continue;
      if (!clearLine(ax, ay, sx, sy)) continue;
      best = s;
      bestD = d;
    }
    return best;
  }

  function goTo(a, x, y) {
    const key = `${x},${y}`;
    if (a.pathKey === key) return true;
    const [fx, fy] = unitTile(a);
    const search = bfs(fx, fy, walkable);
    if (search.dist[idx(x, y)] < 0) return false;
    a.path = pathFrom(search, x, y);
    a.pathKey = key;
    return true;
  }

  function think(a) {
    const seen = spot(a);
    const prey = seen || (a.alertedBy && !a.alertedBy.dead ? a.alertedBy : null);
    a.alertedBy = null;
    if (prey) {
      a.mode = "chase";
      a.prey = prey;
      a.lastSeen = unitTile(prey);
      a.pause = 0;
    }
    if (a.mode === "chase") {
      const [x, y] = a.lastSeen;
      const there = a.progress >= 1 && a.tx === x && a.ty === y;
      if (there || !goTo(a, x, y)) { // lost them: back to wandering
        a.mode = "wander";
        a.prey = null;
        a.path = [];
        a.pathKey = null;
        a.pause = 1 + Math.random() * 2;
      }
    }
  }

  // Somewhere to roam to: a tile HOSTILE.roam steps away by the shortest way, out of the room it's in (so it
  // doesn't mill about one room: through its doors, down the corridors). Sets its path; false if there's nowhere.
  function roam(a) {
    const [fx, fy] = unitTile(a);
    const here = roomOf(fx, fy);
    const search = bfs(fx, fy, walkable);
    const [lo, hi] = HOSTILE.roam;
    const near = [], away = [];
    for (let i = 0; i < search.dist.length; i++) {
      const d = search.dist[i];
      if (d < lo || d > hi) continue;
      const x = i % cols, y = (i / cols) | 0;
      (here && roomOf(x, y) === here ? near : away).push([x, y]);
    }
    const pool = away.length ? away : near;
    if (!pool.length) return false;
    const [x, y] = pool[Math.floor(Math.random() * pool.length)];
    a.path = pathFrom(search, x, y);
    a.pathKey = "roam";
    return a.path.length > 0;
  }

  // Random walk, when there's nowhere to roam to: keep going, only turn back at dead ends, now and then stop
  function wanderStep(a) {
    const options = DIRS.map((d, i) => (walkable(a.tx + d[0], a.ty + d[1]) ? i : -1)).filter((i) => i >= 0);
    if (!options.length) return -1;
    const back = (a.dir + 2) % 4;
    const forward = options.filter((d) => d !== back);
    const pool = forward.length ? forward : options;
    if (options.length >= 3 && Math.random() < 0.3) a.pause = 1 + Math.random() * 4;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function animate(a, dt, moving) {
    const want = moving ? (a.mode === "chase" ? "run" : "walk") : "idle";
    const acts = a.actions;
    if (want !== a.state && acts[want]) {
      const from = acts[a.state];
      acts[want].enabled = true;
      acts[want].play();
      if (from) from.crossFadeTo(acts[want], 0.25, false);
      a.state = want;
    }
    a.mixer.update(dt);
  }

  // ---------- The giant ----------
  // Standing on tile (a.x, a.y) for good
  function initGiant(a) {
    Object.assign(a, {
      giant: true, inVent: false, tx: a.x, ty: a.y, nx: a.x, ny: a.y, progress: 1, dir: -1,
      heading: a.group.rotation.y, path: [], mode: "guard", prey: null, lashT: GIANT.every, attackLeft: 0,
    });
  }

  function updateGiant(a, dt) {
    // the nearest soldier in range it can see (it senses all around: it's in no hurry to turn its whole body)
    let prey = null, best = Infinity;
    for (const s of living()) {
      const [sx, sy] = unitPos(s);
      const d = Math.hypot(sx - a.x, sy - a.y);
      if (d <= GIANT.range && d < best && clearLine(a.x, a.y, sx, sy)) { best = d; prey = s; }
    }
    a.prey = prey;
    a.mode = prey ? "lash" : "guard";
    a.lashT = Math.max(0, a.lashT - dt);
    if (prey) {
      const [px, py] = unitPos(prey);
      const diff = angleDiff(a.heading, Math.atan2(px - a.x, py - a.y));
      a.heading += Math.sign(diff) * Math.min(Math.abs(diff), GIANT.turn * dt);
      if (a.lashT === 0 && Math.abs(diff) < 0.6) {
        a.lashT = GIANT.every;
        attackAnimation(a);
        lash(a, prey);
      }
    }
    // the attack plays once, then back to standing still
    if (a.attackLeft > 0 && (a.attackLeft -= dt) <= 0.2 && a.actions.attack) {
      a.actions.attack.fadeOut(0.2);
      a.actions.idle?.reset().fadeIn(0.2).play();
      a.attackLeft = 0;
    }
    a.group.rotation.y = a.heading;
    a.mixer.update(dt);
  }
  function attackAnimation(a) {
    const at = a.actions.attack;
    if (!at) return;
    a.actions.idle?.fadeOut(0.15);
    at.reset().setLoop(THREE.LoopOnce, 1).fadeIn(0.15).play();
    a.attackLeft = at.getClip().duration;
  }

  function update(a, dt) {
    if (a.dead) return;
    if (a.giant) return updateGiant(a, dt);
    if (a.inVent) return updateVent(a, dt);
    if (a.freshDrop > 0) a.freshDrop -= dt;
    if ((a.thinkT -= dt) <= 0) { a.thinkT = HOSTILE.thinkEvery; think(a); }
    if (a.pause > 0) a.pause -= dt;

    // next tile. A door on the way opens as it walks into it (it waits while the door slides); a sealed one
    // means another way.
    if (a.progress >= 1) {
      a.tx = a.nx; a.ty = a.ny;
      let d = -1;
      // roaming: there (path done): stop and listen; then off to the next place
      if (a.mode === "wander" && a.pause <= 0 && !a.path.length) {
        if (a.pathKey === "roam") {
          a.pathKey = null;
          a.pause = HOSTILE.listen[0] + Math.random() * (HOSTILE.listen[1] - HOSTILE.listen[0]);
        } else roam(a);
      }
      if ((a.mode === "chase" || (a.mode === "wander" && a.pause <= 0)) && a.path.length) {
        const [x, y] = a.path[0];
        d = DIRS.findIndex(([dx, dy]) => dx === x - a.tx && dy === y - a.ty);
        if (d < 0 || !walkable(x, y)) { d = -1; a.path = []; a.pathKey = null; } // off route, or sealed since
      } else if (a.mode === "wander" && a.pause <= 0) {
        // still heading for the door it was waiting at, unless it got sealed meanwhile
        const w = a.waitDir;
        d = w != null && walkable(a.tx + DIRS[w][0], a.ty + DIRS[w][1]) ? w : wanderStep(a);
      }
      const door = d >= 0 ? doors.at(a.tx + DIRS[d][0], a.ty + DIRS[d][1]) : null;
      if (door) doors.ask(door);
      a.waitDir = door && !doors.canPass(door) ? d : null;
      if (a.waitDir != null) d = -1; // wait for it to open
      else if (d >= 0 && a.path.length) a.path.shift();
      if (d >= 0 && a.pause <= 0) {
        a.dir = d;
        a.nx = a.tx + DIRS[d][0];
        a.ny = a.ty + DIRS[d][1];
        a.progress = 0;
      }
    }

    const moving = a.progress < 1;
    if (moving) {
      const speed = a.mode === "chase" ? HOSTILE.chase : HOSTILE.wander;
      a.progress = Math.min(1, a.progress + (speed * dt) / TILE);
      const [dx, dy] = DIRS[a.dir];
      const want = Math.atan2(dx, dy);
      const diff = angleDiff(a.heading, want);
      a.heading += Math.sign(diff) * Math.min(Math.abs(diff), HOSTILE.turn * dt);
    } else if (a.prey && !a.prey.dead) { // standing: face the prey
      const [px, py] = unitPos(a.prey);
      const diff = angleDiff(a.heading, Math.atan2(px - a.tx, py - a.ty));
      a.heading += Math.sign(diff) * Math.min(Math.abs(diff), HOSTILE.turn * dt);
    }
    [a.x, a.y] = unitPos(a);
    a.group.position.set(a.x * TILE, 0, a.y * TILE);
    a.group.rotation.y = a.heading;
    animate(a, dt, moving);

    // touch = kill
    for (const s of living()) {
      const [sx, sy] = unitPos(s);
      if (Math.hypot(sx - a.x, sy - a.y) < HOSTILE.reach) {
        killSoldier(s);
        a.mode = "wander";
        a.prey = null;
        a.path = [];
        a.pathKey = null;
        a.pause = HOSTILE.feed;
        break;
      }
    }
  }

  return { initVent, initGiant, tick, update, entryPoint, ductPoint, schedule: V };
}
