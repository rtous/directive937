"use strict";

// The mission: a survivor is hiding somewhere in the colony, far from where the squad came in.
// A soldier who gets close finds them; from then on the survivor follows that soldier.
//   WIN   the survivor reaches the extraction point (the AIRLOCK) with the squad
//   LOSE  the survivor dies, or the whole squad does
// The survivor never shows on the tactical map. Instead every soldier carries a distress-signal detector:
// the closer they are, the stronger the signal (walls don't block it; it's a radio beacon).

const MISSION = {
  findRange: 2.5,  // tiles: a soldier this close (with a clear view) finds the survivor
  regroup: 6,      // tiles: if their soldier dies, the survivor goes to another one this close
  far: 0.7,        // hiding spot: at least this share of the longest route from the airlock
  signalFalloff: 12, // tiles: the signal drops to ~37% at this distance, ~10% at 2.3x it
  walk: 1.5,       // survivor speed (world units/s), and when catching up:
  run: 3.0,
  thinkEvery: 0.2,
};

// nav: grid helpers. scene/TILE: to draw the survivor. soldiers: the squad. extraction: the airlock room.
// emit(soldier|null, text): report an event. end({ win, reason }): the mission is over.
function createMission({ nav, scene, TILE, soldiers, rooms, extraction, emit, end }) {
  const { isOpen, bfs, pathFrom, idx, cols, roomOf, DIRS, headingFor } = nav;
  const posOf = (u) => [u.tx + (u.nx - u.tx) * u.progress, u.ty + (u.ny - u.ty) * u.progress];
  const here = (u) => (u.progress >= 1 ? [u.tx, u.ty] : [u.nx, u.ny]);
  const living = () => soldiers.filter((s) => !s.dead);
  const where = (x, y) => roomOf(Math.round(x), Math.round(y))?.name ?? "a corridor";
  const label = (s) => `Unit ${s.id} (${s.callsign})`;
  let over = false;

  function clearLine(ax, ay, bx, by) {
    const n = Math.ceil(Math.hypot(bx - ax, by - ay) / 0.2);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (!isOpen(Math.round(ax + (bx - ax) * t), Math.round(ay + (by - ay) * t))) return false;
    }
    return true;
  }

  // ---------- Hiding spot: a room tile far (by route) from the airlock ----------
  const ex = Math.round(extraction.x + (extraction.w - 1) / 2), ey = Math.round(extraction.y + (extraction.h - 1) / 2);
  const fromAirlock = bfs(ex, ey);
  const spots = [];
  rooms.forEach((r) => {
    if (r === extraction) return;
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++) {
        const d = fromAirlock.dist[idx(x, y)];
        if (isOpen(x, y) && d > 0) spots.push({ x, y, d });
      }
  });
  const longest = Math.max(...spots.map((s) => s.d));
  const far = spots.filter((s) => s.d >= MISSION.far * longest);
  const spot = far[Math.floor(Math.random() * far.length)];


  // ---------- The survivor (simple figure for now) ----------
  const body = new THREE.Group();
  const cloth = new THREE.MeshLambertMaterial({ color: 0xcfc6b6 }); // light civilian clothes: stands out from the marines
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 1.0, 8), cloth);
  torso.position.y = 0.7;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), cloth);
  head.position.y = 1.34;
  body.add(torso, head);
  scene.add(body);

  const survivor = {
    name: "SURVIVOR",
    tx: spot.x, ty: spot.y, nx: spot.x, ny: spot.y, progress: 1, dir: -1, heading: Math.random() * Math.PI * 2,
    path: [], speed: MISSION.walk, walked: 0,
    state: "hiding", // "hiding" | "following" | "rescued" | "dead"
    leader: null, dead: false, thinkT: 0,
  };

  // ---------- Behaviour ----------
  function found(s) {
    survivor.state = "following";
    survivor.leader = s;
    emit(s, `${label(s)} found the survivor in ${where(survivor.tx, survivor.ty)}! The survivor follows ${s.callsign}. Bring them back to the AIRLOCK (extraction point).`);
  }

  // Keep a tile behind the soldier they follow; run to catch up
  function follow() {
    const L = survivor.leader;
    const [lx, ly] = here(L);
    const [fx, fy] = here(survivor);
    const search = bfs(fx, fy);
    const dist = search.dist[idx(lx, ly)];
    if (dist < 0 || dist <= 1) { survivor.path = []; return; }
    const full = pathFrom(search, lx, ly);
    survivor.path = full.slice(0, full.length - 1);
    survivor.speed = dist > 4 ? MISSION.run : Math.max(MISSION.walk, L.speed || MISSION.walk);
  }

  function think() {
    const squad = living();
    if (!squad.length) return finish(false, "The whole squad is down.");
    const [px, py] = posOf(survivor);
    if (survivor.state === "hiding") {
      const finder = squad.find((s) => {
        const [sx, sy] = posOf(s);
        return Math.hypot(sx - px, sy - py) <= MISSION.findRange && clearLine(sx, sy, px, py);
      });
      if (finder) found(finder);
      return;
    }
    if (survivor.state !== "following") return;
    if (!survivor.leader || survivor.leader.dead) {
      const next = squad
        .map((s) => { const [sx, sy] = posOf(s); return { s, d: Math.hypot(sx - px, sy - py) }; })
        .filter((c) => c.d <= MISSION.regroup)
        .sort((a, b) => a.d - b.d)[0];
      if (next) {
        survivor.leader = next.s;
        emit(next.s, `The survivor is now following ${label(next.s)}.`);
      } else {
        survivor.state = "hiding";
        survivor.leader = null;
        survivor.path = [];
        emit(null, `The survivor lost their escort and is hiding again in ${where(px, py)}.`);
        return;
      }
    }
    follow();
    if (roomOf(Math.round(px), Math.round(py)) === extraction) {
      survivor.state = "rescued";
      survivor.path = [];
      finish(true, `The survivor reached the extraction point with ${survivor.leader.callsign}.`);
    }
  }

  function finish(win, reason) {
    if (over) return;
    over = true;
    emit(null, `${win ? "MISSION COMPLETE" : "MISSION FAILED"}: ${reason}`);
    end({ win, reason });
  }

  // A hostile caught the survivor
  function kill() {
    if (survivor.dead) return;
    survivor.dead = true;
    survivor.state = "dead";
    scene.remove(body);
    const [px, py] = posOf(survivor);
    emit(survivor.leader, `The survivor was taken by a hostile in ${where(px, py)}.`);
    finish(false, "The survivor is dead.");
  }

  function update(dt) {
    if (over || survivor.dead) return;
    if ((survivor.thinkT -= dt) <= 0) { survivor.thinkT = MISSION.thinkEvery; think(); }
    if (over) return;

    // walk the route
    if (survivor.progress >= 1) {
      survivor.tx = survivor.nx; survivor.ty = survivor.ny;
      if (survivor.path.length) {
        const [x, y] = survivor.path.shift();
        const d = DIRS.findIndex(([dx, dy]) => dx === x - survivor.tx && dy === y - survivor.ty);
        if (d >= 0) {
          survivor.dir = d;
          survivor.nx = x; survivor.ny = y;
          survivor.progress = 0;
        } else survivor.path = [];
      }
    }
    const moving = survivor.progress < 1;
    if (moving) {
      survivor.progress = Math.min(1, survivor.progress + (survivor.speed * dt) / TILE);
      survivor.walked += survivor.speed * dt;
      survivor.heading = headingFor(DIRS[survivor.dir]);
    }
    const [px, py] = posOf(survivor);
    const bob = moving ? Math.abs(Math.sin(survivor.walked * 5)) * 0.05 : 0;
    body.position.set(px * TILE, bob, py * TILE);
    body.rotation.y = survivor.heading;
    // hiding: crouched low
    const crouch = survivor.state === "hiding" ? 0.6 : 1;
    body.scale.y += (crouch - body.scale.y) * Math.min(1, dt * 4);
  }

  // What the squad (and the agent) knows
  function status() {
    const [px, py] = posOf(survivor);
    const s = survivor;
    const survivorInfo = s.state === "hiding"
      ? { status: "missing", hint: "Follow the distress signal: each unit's distress_signal (0-100) is stronger the closer it is to the survivor." }
      : s.state === "dead" ? { status: "dead" }
      : { status: s.state, following: s.leader ? s.leader.callsign : null, location: where(px, py), position: { x: Math.round(px), y: Math.round(py) } };
    return {
      objective: `Find the survivor and bring them back to the extraction point (${extraction.name}).`,
      extraction_point: extraction.name,
      survivor: survivorInfo,
      outcome: over ? (s.state === "rescued" ? "won" : "lost") : "in progress",
    };
  }

  // Distress-signal strength a soldier's detector picks up, 0..100 (0 once the survivor is dead)
  function signal(s) {
    if (survivor.dead || s.dead) return 0;
    const [sx, sy] = posOf(s), [px, py] = posOf(survivor);
    return Math.round(100 * Math.exp(-Math.hypot(sx - px, sy - py) / MISSION.signalFalloff));
  }

  return {
    survivor, update, kill, status, signal,
    get over() { return over; },
    // the survivor counts as prey for hostiles once out of hiding
    get exposed() { return !survivor.dead && survivor.state === "following"; },
  };
}
