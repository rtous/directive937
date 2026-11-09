"use strict";

// Hostile behavior, on two levels:
//   DUCTS   the ventilation floor above the colony. Hostiles there can't be seen or shot (only the sonar
//           picks them up) and crawl freely over the whole map. They all start there, at the edges.
//           A release schedule sends them, one at a time, to a ceiling opening, where they drop in.
//           The release rate doubles every VENTS.doubling seconds; new ones keep arriving at the edges.
//   FLOOR   wander the colony at random; on seeing a soldier (or being shot) run at them; touching a
//           soldier kills them. Lose sight -> search where they were last seen, then wander again.

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
};

const VENTS = {
  start: 0,          // hostiles in the ducts when the mission starts (none: the colony is silent)
  firstArrival: 20,  // seconds before the first ones reach the ducts (and show on the sonar)
  grace: 35,         // seconds before the first one comes down
  doubling: 50,      // seconds for the number released to double (1, 2, 4, 8, ...)
  stock: 4,          // keep at least this many waiting in the ducts...
  cap: 40,           // ...as long as fewer than this many are alive in total
  arriveEvery: 4,    // seconds between new arrivals at the duct edges
  crawl: 1.6,        // tiles per second, heading for an opening
  drift: 0.5,        // tiles per second, idling in the ducts
  drop: 0.6,         // seconds to drop from the ceiling to the floor
  nearSquad: 0.6,    // chance an opening near the squad is picked rather than any opening
};

// nav: grid helpers. TILE: world units per tile. ceiling: height a dropping hostile starts from.
// fogAt(x, y): is that tile in fog. killSoldier(soldier, alien): a soldier was caught.
// soldiers: the squad (dead ones are skipped). vents: [[x, y]] ceiling openings. cols/rows: map size.
// spawn(x, y): create a new hostile in the ducts at that point (world.js calls initVent on it).
// otherPrey(): anyone else they hunt (the survivor, once out of hiding); killOther(target, alien) when caught.
function createHostiles({ nav, TILE, ceiling, soldiers, fogAt, killSoldier, vents, cols, rows, spawn,
  otherPrey = () => [], killOther = () => {} }) {
  const { isOpen, DIRS, bfs, pathFrom, idx, angleDiff } = nav;
  const living = () => soldiers.filter((s) => !s.dead);
  const targets = () => [...living(), ...otherPrey().filter((t) => !t.dead)];
  const posOf = (u) => [u.tx + (u.nx - u.tx) * u.progress, u.ty + (u.ny - u.ty) * u.progress];
  const here = (u) => (u.progress >= 1 ? [u.tx, u.ty] : [u.nx, u.ny]);

  function clearLine(ax, ay, bx, by) {
    const n = Math.ceil(Math.hypot(bx - ax, by - ay) / 0.2);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (!isOpen(Math.round(ax + (bx - ax) * t), Math.round(ay + (by - ay) * t))) return false;
    }
    return true;
  }

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
  let clock = 0;        // seconds since the mission started
  let released = 0;     // hostiles sent down so far
  let arriveT = VENTS.firstArrival;

  // In the ducts at (a.x, a.y): hidden, drifting
  function initVent(a) {
    Object.assign(a, { inVent: true, vent: null, driftTo: null, dropT: 0, state: "idle", mode: "duct", progress: 1 });
    a.group.visible = false;
  }

  // A point at the edge of the map
  function edgePoint() {
    const t = Math.random();
    switch (Math.floor(Math.random() * 4)) {
      case 0: return [t * (cols - 1), 0.5];
      case 1: return [t * (cols - 1), rows - 1.5];
      case 2: return [0.5, t * (rows - 1)];
      default: return [cols - 1.5, t * (rows - 1)];
    }
  }

  // Mostly an opening close to a soldier (they hunt), sometimes any opening
  function chooseVent() {
    const squad = living();
    if (squad.length && Math.random() < VENTS.nearSquad) {
      const [sx, sy] = posOf(squad[Math.floor(Math.random() * squad.length)]);
      return vents.reduce((b, v) => (Math.hypot(v[0] - sx, v[1] - sy) < Math.hypot(b[0] - sx, b[1] - sy) ? v : b));
    }
    return vents[Math.floor(Math.random() * vents.length)];
  }

  // How many should have come down by now: 0 during the grace period, then 1, 2, 4, 8...
  const due = () => (clock < VENTS.grace ? 0 : Math.floor(2 ** ((clock - VENTS.grace) / VENTS.doubling)));

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
    if ((arriveT -= dt) <= 0 && idle < VENTS.stock && alive < VENTS.cap) {
      arriveT = VENTS.arriveEvery;
      spawn(...edgePoint());
    }
  }

  function updateVent(a, dt) {
    if (a.dropT > 0) { // falling through the opening
      a.dropT -= dt;
      a.group.position.y = Math.max(0, a.dropT / VENTS.drop) * (ceiling - 0.4);
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
    let goal = a.vent;
    if (!goal) {
      if (!a.driftTo || Math.hypot(a.driftTo[0] - a.x, a.driftTo[1] - a.y) < 0.2) {
        a.driftTo = [Math.max(0.5, Math.min(cols - 1.5, a.x + (Math.random() - 0.5) * 12)),
                     Math.max(0.5, Math.min(rows - 1.5, a.y + (Math.random() - 0.5) * 12))];
      }
      goal = a.driftTo;
    }
    const dx = goal[0] - a.x, dy = goal[1] - a.y, d = Math.hypot(dx, dy);
    const step = (a.vent ? VENTS.crawl : VENTS.drift) * dt;
    if (d > step) {
      a.x += (dx / d) * step;
      a.y += (dy / d) * step;
    } else if (a.vent) { // at the opening: drop
      [a.x, a.y] = a.vent;
      a.dropT = VENTS.drop;
      a.group.visible = true;
      a.group.position.set(a.x * TILE, ceiling - 0.4, a.y * TILE);
      a.group.rotation.y = Math.random() * Math.PI * 2;
    } else {
      [a.x, a.y] = goal;
    }
  }

  // Nearest soldier this alien can see right now
  function spot(a) {
    const [ax, ay] = posOf(a);
    let best = null, bestD = Infinity;
    for (const s of targets()) {
      const [sx, sy] = posOf(s);
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
    const [fx, fy] = here(a);
    const search = bfs(fx, fy);
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
      a.lastSeen = here(prey);
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

  // Random walk: keep going, only turn back at dead ends, now and then stop to listen
  function wanderStep(a) {
    const options = DIRS.map((d, i) => (isOpen(a.tx + d[0], a.ty + d[1]) ? i : -1)).filter((i) => i >= 0);
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

  function update(a, dt) {
    if (a.dead) return;
    if (a.inVent) return updateVent(a, dt);
    if (a.freshDrop > 0) a.freshDrop -= dt;
    if ((a.thinkT -= dt) <= 0) { a.thinkT = HOSTILE.thinkEvery; think(a); }
    if (a.pause > 0) a.pause -= dt;

    // next tile
    if (a.progress >= 1) {
      a.tx = a.nx; a.ty = a.ny;
      let d = -1;
      if (a.mode === "chase" && a.path.length) {
        const [x, y] = a.path.shift();
        d = DIRS.findIndex(([dx, dy]) => dx === x - a.tx && dy === y - a.ty);
        if (d < 0) { a.path = []; a.pathKey = null; }
      } else if (a.mode === "wander" && a.pause <= 0) {
        d = wanderStep(a);
      }
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
      const [px, py] = posOf(a.prey);
      const diff = angleDiff(a.heading, Math.atan2(px - a.tx, py - a.ty));
      a.heading += Math.sign(diff) * Math.min(Math.abs(diff), HOSTILE.turn * dt);
    }
    [a.x, a.y] = posOf(a);
    a.group.position.set(a.x * TILE, 0, a.y * TILE);
    a.group.rotation.y = a.heading;
    animate(a, dt, moving);

    // touch = kill
    for (const s of targets()) {
      const [sx, sy] = posOf(s);
      if (Math.hypot(sx - a.x, sy - a.y) < HOSTILE.reach) {
        if (soldiers.includes(s)) killSoldier(s, a);
        else killOther(s, a);
        a.mode = "wander";
        a.prey = null;
        a.path = [];
        a.pathKey = null;
        a.pause = HOSTILE.feed;
        break;
      }
    }
  }

  // What the squad's status can say about an alien
  const describe = (a) => (a.mode === "chase" ? "charging" : a.progress < 1 ? "moving" : "still");

  return { init, initVent, tick, update, describe, edgePoint, get released() { return released; } };
}
