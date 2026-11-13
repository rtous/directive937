"use strict";

// Navigation over a level's grid, shared by the soldiers (behavior.js), the hostiles (hostiles.js),
// the mission (mission.js) and the world (world.js). Tiles: x grows east, y grows south.

// Where a unit (soldier or hostile) is: its fractional position, and the tile it stands on or is stepping onto
const unitPos = (u) => [u.tx + (u.nx - u.tx) * u.progress, u.ty + (u.ny - u.ty) * u.progress];
const unitTile = (u) => (u.progress >= 1 ? [u.tx, u.ty] : [u.nx, u.ny]);

// rooms: the level's rooms. home: the room the squad came in through. exits: the rooms that take a soldier out of
// the level (accesses), which nobody wanders into by accident (patrols, fleeing, spreading out...): only a
// deliberate order. Once one soldier has gone out through one, the others are closed (chooseExit): the rest of the
// squad has to follow through the same one. doors: the level's doors (doors.js), which change what can be crossed
// and seen through. solid: [[x1, y1, x2, y2]] floor nobody can walk on, though it can be seen across (the giant).
function createNav(grid, rooms, { home = null, exits = [], doors = null, solid = [] } = {}) {
  const rows = grid.length;
  const cols = grid[0].length;
  const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]]; // E S W N
  const DIR_NAMES = ["east", "south", "west", "north"];
  // soldiers also step diagonally (a diagonal step costs √2)
  const MOVES = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [-1, -1], [1, -1]];

  const idx = (x, y) => y * cols + x;
  const isOpen = (x, y) => y >= 0 && y < rows && x >= 0 && x < cols && grid[y][x] === 0;
  const openDirsFrom = (x, y) => DIRS.map((d, i) => (isOpen(x + d[0], y + d[1]) ? i : -1)).filter((i) => i >= 0);
  // which room each tile is in (index + 1; 0 = none), worked out once
  const roomGrid = new Int16Array(rows * cols);
  rooms.forEach((r, k) => {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) roomGrid[y * cols + x] = k + 1;
  });
  const roomOf = (x, y) => (x >= 0 && y >= 0 && x < cols && y < rows ? rooms[roomGrid[y * cols + x] - 1] || null : null);
  const where = (x, y) => roomOf(Math.round(x), Math.round(y))?.name ?? "a corridor";
  const roomCentre = (r) => [r.x + (r.w - 1) / 2, r.y + (r.h - 1) / 2];
  const solidGrid = new Uint8Array(rows * cols);
  solid.forEach(([x1, y1, x2, y2]) => { for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) solidGrid[idx(x, y)] = 1; });
  let chosenExit = null;
  const isExit = (r) => !!r && exits.includes(r);
  const inExit = (x, y) => isExit(roomOf(x, y));
  const closedExit = (r) => !!chosenExit && isExit(r) && r !== chosenExit;
  // Floor that soldiers and hostiles can cross (they open doors, but not sealed ones; not into an exit closed off
  // because the squad is leaving through another), and that can be seen (or shot) through (not a closed door)
  const walkable = (x, y) => isOpen(x, y) && !solidGrid[idx(x, y)] && !doors?.sealedAt(x, y) && !closedExit(roomOf(x, y));
  // ...the same, but planning straight through sealed doors (soldiers on a direct order: they stop at the door)
  const throughSeals = (x, y) => isOpen(x, y) && !solidGrid[idx(x, y)] && !closedExit(roomOf(x, y));
  const seeThrough = (x, y) => isOpen(x, y) && !doors?.blocksSight(x, y);
  // heading that looks along a tile direction; 0 looks toward -y (north), same as the cameras' rotation.y
  const headingFor = ([dx, dy]) => Math.atan2(-dx, -dy);
  const angleDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

  // Nothing in the way of the eye on the straight line between two points (walls, closed doors)
  function clearLine(ax, ay, bx, by) {
    const n = Math.ceil(Math.hypot(bx - ax, by - ay) / 0.2);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (!seeThrough(Math.round(ax + (bx - ax) * t), Math.round(ay + (by - ay) * t))) return false;
    }
    return true;
  }

  // Breadth-first search in the 4 directions. Returns distances (-1 = unreachable) and back-pointers.
  function bfs(fx, fy, passable = isOpen) {
    const dist = new Int32Array(rows * cols).fill(-1);
    const prev = new Int32Array(rows * cols).fill(-1);
    const queue = [[fx, fy]];
    dist[idx(fx, fy)] = 0;
    for (let q = 0; q < queue.length; q++) {
      const [x, y] = queue[q];
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (!passable(nx, ny) || dist[idx(nx, ny)] >= 0) continue;
        dist[idx(nx, ny)] = dist[idx(x, y)] + 1;
        prev[idx(nx, ny)] = idx(x, y);
        queue.push([nx, ny]);
      }
    }
    return { dist, prev };
  }

  // Soldiers' routes: 8 directions (Dijkstra). A diagonal is only taken when both tiles beside it are open too,
  // so nobody clips a wall corner. Same result shape as bfs(); distances are in tiles but not whole numbers.
  function routeSearch(fx, fy, passable = isOpen) {
    const dist = new Float32Array(rows * cols).fill(-1);
    const prev = new Int32Array(rows * cols).fill(-1);
    const done = new Uint8Array(rows * cols);
    const heap = [[0, idx(fx, fy)]]; // binary min-heap of [distance, tile index]
    const push = (e) => {
      heap.push(e);
      for (let i = heap.length - 1; i > 0;) {
        const p = (i - 1) >> 1;
        if (heap[p][0] <= heap[i][0]) break;
        [heap[p], heap[i]] = [heap[i], heap[p]];
        i = p;
      }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        for (let i = 0; ;) {
          const l = 2 * i + 1, r = l + 1;
          let m = i;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]];
          i = m;
        }
      }
      return top;
    };
    dist[idx(fx, fy)] = 0;
    while (heap.length) {
      const [d, i] = pop();
      if (done[i]) continue;
      done[i] = 1;
      const x = i % cols, y = (i / cols) | 0;
      for (const [dx, dy] of MOVES) {
        const nx = x + dx, ny = y + dy;
        if (!passable(nx, ny)) continue;
        if (dx && dy && (!passable(x + dx, y) || !passable(x, y + dy))) continue;
        const j = idx(nx, ny), nd = d + (dx && dy ? Math.SQRT2 : 1);
        if (dist[j] >= 0 && dist[j] <= nd + 1e-6) continue;
        dist[j] = nd;
        prev[j] = i;
        push([nd, j]);
      }
    }
    return { dist, prev };
  }

  // The tiles from a search's start to (tx, ty), excluding the start
  function pathFrom(search, tx, ty) {
    const path = [];
    for (let i = idx(tx, ty); search.prev[i] >= 0; i = search.prev[i]) path.unshift([i % cols, (i / cols) | 0]);
    return path;
  }

  // Rooms reachable from a corridor tile without passing through another room
  function corridorLeadsTo(x, y, exclude) {
    const seen = bfs(x, y, (cx, cy) => isOpen(cx, cy) && !roomOf(cx, cy));
    const found = new Set();
    for (let i = 0; i < seen.dist.length; i++) {
      if (seen.dist[i] < 0) continue;
      const cx = i % cols, cy = (i / cols) | 0;
      for (const [dx, dy] of DIRS) {
        const r = roomOf(cx + dx, cy + dy);
        if (r && r !== exclude && isOpen(cx + dx, cy + dy)) found.add(r.name);
      }
    }
    return [...found];
  }

  // Exits of every room (doorway tiles just outside it) and where they lead
  const roomExits = new Map(rooms.map((r) => {
    const exits = [];
    for (let y = r.y - 1; y <= r.y + r.h; y++) {
      for (let x = r.x - 1; x <= r.x + r.w; x++) {
        const inside = x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
        if (inside || !isOpen(x, y) || roomOf(x, y)) continue;
        const direction = y < r.y ? "north" : y >= r.y + r.h ? "south" : x < r.x ? "west" : "east";
        const leads_to = corridorLeadsTo(x, y, r);
        // a wide doorway is several tiles: list it once
        if (!exits.some((e) => e.direction === direction && e.leads_to.join() === leads_to.join())) {
          exits.push({ direction, door: { x, y }, leads_to });
        }
      }
    }
    return [r.name, exits];
  }));

  // A room by name, label or alias (exact first, then partial)
  function findRoom(query) {
    const q = String(query || "").trim().toLowerCase();
    if (!q) return null;
    return rooms.find((r) => r.name.toLowerCase() === q || r.label.toLowerCase() === q || r.aliases.includes(q)) ||
      rooms.find((r) => r.name.toLowerCase().includes(q) || r.aliases.some((a) => a.includes(q) || q.includes(a))) ||
      null;
  }

  return {
    cols, rows, DIRS, DIR_NAMES, MOVES, rooms, home, exits, doors,
    get chosenExit() { return chosenExit; },
    chooseExit(r) { chosenExit = r; },
    idx, isOpen, isExit, inExit, closedExit, walkable, throughSeals, seeThrough, openDirsFrom, roomOf, where, roomCentre, headingFor, angleDiff, clearLine,
    bfs, routeSearch, pathFrom, corridorLeadsTo, roomExits, findRoom,
  };
}
