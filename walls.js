"use strict";

// Wall styles: procedural textures for the walls, and which one each wall tile gets.
// Each room has a base style that suits it (levels.js), with the odd feature panel (hatch, console, cables...);
// corridors change style every few tiles. The feed is grayscale, so the styles differ mostly in shape
// and brightness rather than colour.

// One 128x128 canvas texture per style. The texture covers a whole wall face (2 m wide, 2.6 m tall).
function createWallTextures() {
  const S = 128;
  const make = (draw) => {
    const c = document.createElement("canvas");
    c.width = c.height = S;
    const g = c.getContext("2d");
    draw(g);
    grime(g);
    const tex = new THREE.CanvasTexture(c);
    tex.magFilter = THREE.NearestFilter;
    return tex;
  };
  const rect = (g, color, x, y, w, h) => { g.fillStyle = color; g.fillRect(x, y, w, h); };
  const rivets = (g, points, color = "#9aa09c") => points.forEach(([x, y]) => rect(g, color, x, y, 3, 3));
  function grime(g) {
    for (let i = 0; i < 900; i++) rect(g, `rgba(0,0,0,${Math.random() * 0.12})`, Math.random() * S, Math.random() * S, 2, 2);
    for (let i = 0; i < 4; i++) { // streaks running down
      const x = Math.random() * S;
      const grad = g.createLinearGradient(0, 0, 0, S);
      grad.addColorStop(0, "rgba(0,0,0,0)");
      grad.addColorStop(1, "rgba(0,0,0,0.18)");
      g.fillStyle = grad;
      g.fillRect(x, S * Math.random() * 0.5, 2 + Math.random() * 4, S);
    }
  }
  // a raised panel: light top/left edge, dark bottom/right edge
  function bevel(g, x, y, w, h, face, light = "#8d938f", dark = "#2a2e2c") {
    rect(g, face, x, y, w, h);
    rect(g, light, x, y, w, 2);
    rect(g, light, x, y, 2, h);
    rect(g, dark, x, y + h - 2, w, 2);
    rect(g, dark, x + w - 2, y, 2, h);
  }
  function stencil(g, text, x, y, size = 11, color = "rgba(20,22,21,0.75)") {
    g.fillStyle = color;
    g.font = `bold ${size}px monospace`;
    g.fillText(text, x, y);
  }

  return {
    // Plain double panel with a vent strip (the original wall)
    panel: make((g) => {
      rect(g, "#6d736f", 0, 0, S, S);
      g.strokeStyle = "#2a2e2c";
      g.lineWidth = 3;
      g.strokeRect(2, 2, S - 4, S / 2 - 4);
      g.strokeRect(2, S / 2 + 2, S - 4, S / 2 - 4);
      for (let y = S * 0.62; y < S * 0.85; y += 6) rect(g, "#3a3f3c", S * 0.2, y, S * 0.6, 3);
      rivets(g, [[8, 8], [S - 10, 8], [8, S / 2 - 10], [S - 10, S / 2 - 10], [8, S / 2 + 8], [S - 10, S / 2 + 8], [8, S - 10], [S - 10, S - 10]]);
    }),

    // Corrugated metal: vertical ribs between a top and bottom rail
    ribbed: make((g) => {
      rect(g, "#5d625f", 0, 0, S, S);
      for (let x = 0; x < S; x += 10) {
        rect(g, "#7c827e", x, 14, 3, S - 28);
        rect(g, "#3b3f3d", x + 6, 14, 3, S - 28);
      }
      bevel(g, 0, 0, S, 14, "#555a57");
      bevel(g, 0, S - 14, S, 14, "#555a57");
      rivets(g, Array.from({ length: 8 }, (_, i) => [6 + i * 16, 5]).concat(Array.from({ length: 8 }, (_, i) => [6 + i * 16, S - 9])));
    }),

    // Pipes running along the wall on brackets
    pipes: make((g) => {
      rect(g, "#454a47", 0, 0, S, S);
      g.strokeStyle = "#2a2e2c";
      g.lineWidth = 2;
      g.strokeRect(1, 1, S - 2, S - 2);
      for (const [y, h] of [[18, 14], [42, 8], [58, 8], [86, 18]]) {
        const grad = g.createLinearGradient(0, y, 0, y + h);
        grad.addColorStop(0, "#a3a9a5");
        grad.addColorStop(0.4, "#6f7571");
        grad.addColorStop(1, "#262a28");
        g.fillStyle = grad;
        g.fillRect(0, y, S, h);
      }
      for (let x = 14; x < S; x += 40) { // brackets and a valve
        rect(g, "#2f3331", x, 14, 5, 96);
        rect(g, "#555a57", x - 2, 14, 9, 3);
      }
      rect(g, "#8d938f", 92, 80, 10, 30);
      rect(g, "#2a2e2c", 88, 92, 18, 4);
    }),

    // Bulkhead with hazard stripes along the bottom
    hazard: make((g) => {
      bevel(g, 0, 0, S, S * 0.68, "#696f6b");
      stencil(g, "C-" + (10 + Math.floor(Math.random() * 80)), 12, 30, 16);
      g.save();
      g.beginPath();
      g.rect(0, S * 0.68, S, S * 0.32);
      g.clip();
      rect(g, "#c9a227", 0, S * 0.68, S, S * 0.32);
      g.fillStyle = "#1c1d1b";
      for (let x = -S; x < S * 2; x += 22) {
        g.beginPath();
        g.moveTo(x, S);
        g.lineTo(x + 11, S);
        g.lineTo(x + 11 + S * 0.32, S * 0.68);
        g.lineTo(x + S * 0.32, S * 0.68);
        g.fill();
      }
      g.restore();
      rect(g, "#2a2e2c", 0, S * 0.68 - 2, S, 3);
    }),

    // Control console: screens, rows of switches, a few lit indicators
    console: make((g) => {
      rect(g, "#4b504d", 0, 0, S, S);
      bevel(g, 10, 12, 50, 36, "#121614");
      bevel(g, 68, 12, 50, 36, "#121614");
      for (let y = 18; y < 44; y += 5) { // faint screen lines
        rect(g, "rgba(150,200,160,0.18)", 14, y, 30 + Math.random() * 12, 1);
        rect(g, "rgba(150,200,160,0.18)", 72, y, 20 + Math.random() * 22, 1);
      }
      for (let row = 0; row < 3; row++)
        for (let i = 0; i < 9; i++) bevel(g, 10 + i * 12, 60 + row * 13, 8, 8, Math.random() < 0.2 ? "#d6e8d8" : "#2f3331");
      rect(g, "#1e2220", 8, 102, S - 16, 18);
      for (let i = 0; i < 5; i++) rect(g, Math.random() < 0.5 ? "#e8e8c0" : "#5a5f5c", 14 + i * 22, 108, 6, 6);
    }),

    // Maintenance hatch: an inset door with bolts and a handle
    hatch: make((g) => {
      rect(g, "#676d69", 0, 0, S, S);
      bevel(g, 22, 14, 84, 100, "#565b58", "#2a2e2c", "#8d938f"); // inset: shadow on top
      g.strokeStyle = "#2a2e2c";
      g.lineWidth = 2;
      g.strokeRect(28, 20, 72, 88);
      rivets(g, [[30, 22], [94, 22], [30, 102], [94, 102], [62, 22], [62, 102]], "#a7ada9");
      rect(g, "#a3a9a5", 84, 52, 6, 26); // handle
      rect(g, "#2a2e2c", 90, 52, 2, 26);
      stencil(g, "MAINT", 38, 44);
    }),

    // Cable runs: bundles of cables held by clamps
    cables: make((g) => {
      rect(g, "#3f4441", 0, 0, S, S);
      let x = 6;
      while (x < S - 6) {
        const w = 3 + Math.floor(Math.random() * 6);
        const shade = 40 + Math.floor(Math.random() * 70);
        rect(g, `rgb(${shade},${shade + 4},${shade + 2})`, x, 0, w, S);
        rect(g, "rgba(255,255,255,0.15)", x, 0, 1, S);
        x += w + 2 + Math.floor(Math.random() * 4);
      }
      for (const y of [20, 64, 108]) bevel(g, 0, y, S, 6, "#6a706c");
    }),

    // Lockers: tall doors with vent slits and handles
    lockers: make((g) => {
      rect(g, "#2a2e2c", 0, 0, S, S);
      for (let i = 0; i < 3; i++) {
        const x = 3 + i * 42;
        bevel(g, x, 3, 38, S - 6, i === 1 ? "#6a706c" : "#727874");
        for (let y = 12; y < 30; y += 5) rect(g, "#2f3331", x + 8, y, 22, 2);
        rect(g, "#a3a9a5", x + 30, 60, 3, 14);
        stencil(g, String(i + 1 + Math.floor(Math.random() * 30)).padStart(2, "0"), x + 6, S - 14, 10);
      }
    }),

    // Lab tiles: small clean squares (the medical lab)
    tiles: make((g) => {
      rect(g, "#7e8481", 0, 0, S, S);
      for (let y = 0; y < S; y += 16)
        for (let x = 0; x < S; x += 16) rect(g, Math.random() < 0.08 ? "#6f7572" : "#8a908c", x + 1, y + 1, 14, 14);
      rect(g, "#5d625f", 0, S - 18, S, 18); // kick plate
    }),
  };
}

// Corridors (and rooms without a style of their own): a mix of plain styles. Each room picks its own in levels.js
// as { base, features }: the style it's built from and the feature panels sprinkled in.
const CORRIDOR_WALLS = { base: ["ribbed", "panel", "pipes", "cables"], features: ["hatch", "pipes", "cables", "hazard"] };
const WALL_FEATURE_CHANCE = 0.22;

// Repeatable pseudo-random number in [0, 1) for a tile, so the walls look the same every visit
function tileHash(x, y, salt = 0) {
  let h = (x * 73856093) ^ (y * 19349663) ^ (salt * 83492791);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Style for a wall tile. room: the room it faces, or null for a corridor wall.
function wallStyleFor(x, y, room) {
  const def = room?.walls || CORRIDOR_WALLS;
  if (tileHash(x, y, 1) < WALL_FEATURE_CHANCE) return def.features[Math.floor(tileHash(x, y, 2) * def.features.length)];
  if (Array.isArray(def.base)) { // corridors: a new look every 4 tiles or so
    return def.base[Math.floor(tileHash(Math.floor(x / 4), Math.floor(y / 4), 3) * def.base.length)];
  }
  return def.base;
}

// ---------- Alien resin ----------
// Black, glossy, organic secretions grown over parts of the walls: hardened, wet-looking mucus with lumps, ribbed
// strands and drips running down from the ceiling, spreading over the ceiling and pooling on the floor.
// It spreads out from THE NEST: the closer a sector is to the boss sector, the more of its walls, ceiling and floor
// are covered and the thicker it is (resinAmount); sectors far enough away (the entry among them) have none.
// It is real geometry: a fine grid in front of each wall face, pushed out by a thickness field. Where the field
// is zero the grid sits just behind the wall face, so the coating's edge is where the lump comes out of the wall:
// an irregular, organic outline with no textures needed. The field runs in world space along each wall line, so
// neighbouring tiles join up.
const RESIN = {
  reach: 11,       // sectors this many steps (or more) from the boss sector have none
  step: 0.08,      // grid spacing (world units; taller walls get a coarser one)
  maxThick: 0.16,  // how far the thickest lumps stand out from the wall
  stepFlat: 0.1,    // grid spacing on the ceiling and floor
  maxHang: 0.32,   // how low the biggest growths hang from the ceiling
  maxPool: 0.09,   // how thick the pools on the floor get
  chunk: 6,        // tiles per side of each piece the renderer can leave out when it's out of view
  sheen: 0.1,      // how much the wet surface gleams at glancing angles
};

// How infested a level is, 0 (none) .. 1 (the boss sector), from its distance to the boss sector in steps
function resinAmount(level) {
  if (!level.sector) return 0;
  const d = Math.abs(level.sector[0] - SECTORS.boss[0]) + Math.abs(level.sector[1] - SECTORS.boss[1]);
  return Math.max(0, 1 - d / RESIN.reach);
}

// The settings for the level being built (createResin sets them from its amount): thr, how much of the zone noise
// counts as infested (lower: more of it); min, below which a zone is surely bare; scale, how thick it all is.
let resinCfg = { thr: 0.6, min: 0.42, scale: 1 };

// Smooth 3D value noise in [0, 1], and a few octaves of it (lattice values from fixed tables: fast)
const RESIN_PERM = new Uint8Array(512), RESIN_VAL = new Float32Array(256);
for (let i = 0; i < 256; i++) { RESIN_PERM[i] = i; RESIN_VAL[i] = tileHash(i, 7, 101); }
for (let i = 255; i > 0; i--) { const j = Math.floor(tileHash(i, 3, 211) * (i + 1)); [RESIN_PERM[i], RESIN_PERM[j]] = [RESIN_PERM[j], RESIN_PERM[i]]; }
for (let i = 0; i < 256; i++) RESIN_PERM[i + 256] = RESIN_PERM[i];
// z picks a layer (each wall line, the ceiling, the floor... has its own); the noise is smooth in x and y only
function resinNoise(x, y, z) {
  const xf = Math.floor(x), yf = Math.floor(y);
  const xi = xf & 255, yi = yf & 255, zi = Math.floor(z * 13.7) & 255;
  const u = (x - xf) * (x - xf) * (3 - 2 * (x - xf)), v = (y - yf) * (y - yf) * (3 - 2 * (y - yf));
  const P = RESIN_PERM, V = RESIN_VAL;
  const p0 = P[xi], p1 = P[xi + 1];
  const a = V[P[P[p0 + yi] + zi]], b = V[P[P[p1 + yi] + zi]];
  const c = V[P[P[p0 + yi + 1] + zi]], d = V[P[P[p1 + yi + 1] + zi]];
  const top = a + (b - a) * u, bot = c + (d - c) * u;
  return top + (bot - top) * v;
}
function resinFbm(x, y, z, octaves = 3) {
  let s = 0, a = 0.5, n = 0;
  for (let i = 0; i < octaves; i++, a *= 0.5) { s += a * resinNoise(x, y, z); n += a; x *= 2.03; y *= 2.03; z *= 1.7; }
  return s / n;
}
const smooth = (a, b, t) => { const k = Math.min(1, Math.max(0, (t - a) / (b - a))); return k * k * (3 - 2 * k); };

// How far the resin stands out at (U along the wall line, V height) on wall line W, 0 = bare wall.
// zone: resinZone(U, W), which stretches of wall are infested (the same all the way up, so worked out per column).
const resinZone = (U, W) => resinFbm(U * 0.11, W * 0.31, 3.7, 2);
function resinThickness(U, V, W, wallH, zone) {
  const fade = smooth(resinCfg.min, resinCfg.min + 0.08, zone); // well away from any patch: bare
  if (fade <= 0) return 0;
  const top = smooth(wallH - 1.1, wallH, V);                   // it gathers under the ceiling...
  const foot = smooth(0.45, 0, V);                             // ...and pools at the foot of the wall
  const streak = resinNoise(U * 3.2, V * 0.35, W + 9.1);       // long vertical runs: drips and strands
  const blotch = resinFbm(U * 0.9, V * 0.7, W + 4.3, 2);
  const cover = fade * ((zone - resinCfg.thr) * 3.2 + (blotch - 0.5) * 0.9 + (streak - 0.5) * 0.9 + top * 0.55 + foot * 0.2) - (1 - fade) * 0.3;
  if (cover <= 0) return 0;
  const body = smooth(0, 0.45, cover);                         // swells up from its edge
  const lumps = resinFbm(U * 2.6, V * 2.2, W + 1.9, 2);           // uneven, bulging mass
  // ribbed, tube-like strands running mostly downward, bending a little
  const rib = Math.pow(Math.abs(Math.sin(U * 11 + resinNoise(U * 0.8, V * 1.1, W) * 7)), 4);
  const blister = Math.pow(resinNoise(U * 6, V * 6, W + 7.7), 6) * 2.2; // the odd small blister
  return resinCfg.scale * RESIN.maxThick * body * (0.3 + 0.55 * lumps + 0.25 * rib * body + 0.25 * blister) + 0.008 * resinNoise(U * 14, V * 14, W);
}

// The wall face seen from open tile (x, y) looking (dx, dy) at a wall: its centre, the along-wall direction t
// (t x up = the face's outward normal, so the face looks back at the tile), W: one value per wall line, U0: where
// the face's centre is along that line
function wallFace(x, y, dx, dy, TILE) {
  const nx = -dx, ny = -dy;
  const cx = (x + dx / 2) * TILE, cz = (y + dy / 2) * TILE;
  const tx = ny, tz = -nx;
  return { cx, cz, tx, tz, W: (cx * nx + cz * ny) * 1.37 + (nx * 3 + ny * 7) * 11.3, U0: cx * tx + cz * tz };
}

// Ceiling and floor: which stretches are infested, as for the walls
const resinFlatZone = (px, pz, kind) => resinFbm(px * 0.09, pz * 0.09, kind === "ceiling" ? 17.3 : 41.9, 2);

// How thick the resin is at world point (px, pz) of the ceiling (hanging down) or the floor (pooled), 0 = bare.
// It has its own patches, and also spreads out from the walls where their coating reaches the top (ceiling) or
// the foot (floor), so it runs on round the corner.
// faces(x, y): the wall faces round open tile (x, y), with their coating's profile at the top and the foot
// (resinFaces below). bare(x, y): open tiles to keep clear.
function resinFlatThickness(px, pz, kind, { TILE, faces, bare, isOpen }) {
  const ceil = kind === "ceiling";
  const tx0 = Math.round(px / TILE), tz0 = Math.round(pz / TILE);
  const reach = ceil ? 1.3 : 0.8;
  // from the walls: every wall face within reach (the faces of the tiles around this point)
  let fromWalls = 0, clear = 1, ragged = -1;
  for (let y = tz0 - 1; y <= tz0 + 1; y++) for (let x = tx0 - 1; x <= tx0 + 1; x++) {
    if (!isOpen(x, y)) continue;
    // keep clear of bare tiles (doors, lights, vents): fade out towards them
    if (bare(x, y)) {
      const ox = Math.max(0, Math.abs(px - x * TILE) - TILE / 2), oz = Math.max(0, Math.abs(pz - y * TILE) - TILE / 2);
      clear = Math.min(clear, smooth(0, 0.4, Math.hypot(ox, oz)));
      continue;
    }
    for (const f of faces(x, y)) {
      const d = (f.cx - px) * f.dx + (f.cz - pz) * f.dy;      // how far out from the face
      if (d < -0.01 || d >= reach) continue;
      const along = px * f.tx + pz * f.tz - f.U0;              // where along it
      const dist = Math.hypot(d, Math.max(0, Math.abs(along) - TILE / 2));
      if (dist >= reach) continue;
      const prof = ceil ? f.top : f.foot;
      const k = Math.max(0, Math.min(1, along / TILE + 0.5)) * (prof.length - 1), k0 = Math.floor(k), k1 = Math.min(prof.length - 1, k0 + 1);
      const w = prof[k0] + (prof[k1] - prof[k0]) * (k - k0);
      if (w <= 0) continue;
      // ragged edge: the spread reaches further in some places than others
      if (ragged < 0) ragged = 0.55 + 0.9 * resinNoise(px * 2.3, pz * 2.3, ceil ? 5.1 : 8.4);
      fromWalls = Math.max(fromWalls, w * smooth(reach * ragged, 0, dist));
    }
  }
  if (clear <= 0) return 0;
  const zone = resinFlatZone(px, pz, kind);
  if (fromWalls <= 0 && zone <= resinCfg.min) return 0; // nothing of its own here, nothing spreading from a wall
  const fade = smooth(resinCfg.min, resinCfg.min + 0.08, zone);
  const blotch = resinFbm(px * 0.8, pz * 0.8, ceil ? 2.2 : 6.6, 2);
  const own = fade * ((zone - resinCfg.thr) * 3.2 + (blotch - 0.5) * 1.1) - (1 - fade) * 0.3;
  const cover = Math.max(own, fromWalls * 1.1 + (blotch - 0.5) * 0.5 - 0.12) * clear;
  if (cover <= 0) return 0;
  const body = smooth(0, ceil ? 0.7 : 0.9, cover); // rises gently from its edge
  if (ceil) {
    const lumps = resinFbm(px * 2.6, pz * 2.6, 13.1, 2);
    // ribbed strands crawling across, and heavy bulbs hanging from the mass
    const rib = Math.pow(Math.abs(Math.sin(px * 7 + pz * 3 + resinNoise(px * 0.7, pz * 0.7, 3.3) * 8)), 4);
    const bulb = Math.pow(resinNoise(px * 2.2, pz * 2.2, 19.7), 5) * 3.2;
    return Math.min(RESIN.maxHang * resinCfg.scale, resinCfg.scale * RESIN.maxThick * body * (0.3 + 0.55 * lumps + 0.25 * rib * body) + resinCfg.scale * RESIN.maxHang * bulb * body * body) +
      0.008 * resinNoise(px * 14, pz * 14, 1);
  }
  // floor: wet pools swollen with lumps and clustered blisters; the lamps only glint off their rounded sides
  const lumps = resinFbm(px * 3.4, pz * 3.4, 23.9, 3);
  const b1 = Math.pow(resinNoise(px * 4.5, pz * 4.5, 27.1), 3), b2 = Math.pow(resinNoise(px * 8, pz * 8, 31.3), 3);
  return resinCfg.scale * RESIN.maxPool * body * (0.2 + 0.45 * lumps + (1.1 * b1 + 0.6 * b2) * body) + 0.01 * body * resinNoise(px * 11, pz * 11, 2);
}

// Fine bumps for the surface, so the shine breaks up like a wet, uneven skin
function resinBumpTexture() {
  const S = 128, c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d"), img = g.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    // tileable: blend the noise with copies of itself shifted by one period
    const fx = x / S, fy = y / S, P = 8, f = (X, Y) => resinFbm(X, Y, 3.3, 3);
    const n = (f(fx * P, fy * P) * (1 - fx) + f((fx - 1) * P, fy * P) * fx) * (1 - fy) +
      (f(fx * P, (fy - 1) * P) * (1 - fx) + f((fx - 1) * P, (fy - 1) * P) * fx) * fy;
    const v = Math.round(255 * Math.min(1, Math.max(0, (n - 0.3) * 2.2)));
    const i = (y * S + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// The resin for a level: a group of meshes (null if this sector has none). isOpen(x, y): floor tile. skip(x, y): wall tiles to
// leave bare (exit hatches); faces looking onto a door tile are left bare too (doors: [[x, y]]).
// bareCeiling(x, y): open tiles whose ceiling stays clear (lights, vents).
function createResin({ cols, rows, isOpen, TILE, wallH, skip = () => false, doors = [], bareCeiling = () => false, amount = 1 }) {
  if (amount <= 0) return null;
  // more infested: a bigger share of the zone noise counts (a few patches at the edge of its reach, nearly
  // everything in the nest), and thicker
  const thr = 0.72 - 0.36 * amount;
  resinCfg = { thr, min: thr - 0.18, scale: 0.7 + 0.45 * amount };
  const doorAt = new Set(doors.map(([x, y]) => `${x},${y}`));
  const doorTile = new Set(doors.map(([x, y]) => y * 65536 + x));
  const step = RESIN.step * Math.sqrt(Math.max(1, wallH / 2.6)); // the nest's towering walls: coarser
  const nU = Math.round(TILE / step), nV = Math.round(wallH / step);
  const pos = [], uv = [], index = [];
  const hs = new Float32Array((nU + 1) * (nV + 1)), zones = new Float32Array(nU + 1);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    if (isOpen(x, y) || skip(x, y)) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (!isOpen(x + dx, y + dy) || doorAt.has(`${x + dx},${y + dy}`)) continue;
      // the face: centre, outward normal n = (dx, dy), along-wall direction t (t x up = n, so it faces out)
      const { cx, cz, tx, tz, W } = wallFace(x + dx, y + dy, -dx, -dy, TILE);
      // the wall carries on past this face (same wall line) on either side? if not, the coating thins out there
      const goesOn = (s) => !isOpen(x + tx * s, y + tz * s) && isOpen(x + tx * s + dx, y + tz * s + dy) && !skip(x + tx * s, y + tz * s);
      const endA = goesOn(-1), endB = goesOn(1);
      let any = false;
      for (let i = 0; i <= nU; i++) zones[i] = resinZone(cx * tx + cz * tz - TILE / 2 + (i / nU) * TILE, W);
      if (zones.every((z) => z < resinCfg.min)) continue;
      for (let j = 0; j <= nV; j++) for (let i = 0; i <= nU; i++) {
        const u = -TILE / 2 + (i / nU) * TILE, v = (j / nV) * wallH;
        const U = cx * tx + cz * tz + u;
        let h = resinThickness(U, v, W, wallH, zones[i]);
        if (!endA) h *= smooth(-TILE / 2, -TILE / 2 + 0.3, u);
        if (!endB) h *= smooth(TILE / 2, TILE / 2 - 0.3, u);
        hs[j * (nU + 1) + i] = h;
        if (h > 0.004) any = true;
      }
      if (!any) continue;
      const base = pos.length / 3;
      for (let j = 0; j <= nV; j++) for (let i = 0; i <= nU; i++) {
        const u = -TILE / 2 + (i / nU) * TILE, v = (j / nV) * wallH;
        const out = hs[j * (nU + 1) + i] - 0.012; // bare wall: just behind the face
        pos.push(cx + tx * u + dx * out, v, cz + tz * u + dy * out);
        uv.push((cx * tx + cz * tz + u) * 0.9, v * 0.9);
      }
      for (let j = 0; j < nV; j++) for (let i = 0; i < nU; i++) {
        const a = j * (nU + 1) + i, b = a + 1, c = a + nU + 2, d = a + nU + 1;
        if (hs[a] <= 0 && hs[b] <= 0 && hs[c] <= 0 && hs[d] <= 0) continue; // all inside the wall
        index.push(base + a, base + b, base + c, base + a, base + c, base + d);
      }
    }
  }
  // ---------- Ceiling and floor ----------
  // One fine grid over the whole sector for each, its vertices shared between tiles so the mass runs on unbroken.
  // The thickness at a point depends only on where it is, so neighbouring tiles always agree.
  const nH = Math.round(TILE / RESIN.stepFlat), cell = TILE / nH;
  const isBare = (x, y) => doorTile.has(y * 65536 + x);
  // the wall faces round each open tile, with how thick their coating is along the top and the foot
  const faceCache = new Map(), PROFILE = 11;
  const faces = (x, y) => {
    const key = y * 65536 + x;
    if (faceCache.has(key)) return faceCache.get(key);
    const list = [];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (isOpen(x + dx, y + dy) || skip(x + dx, y + dy)) continue;
      const f = { ...wallFace(x, y, dx, dy, TILE), dx, dy, top: new Float32Array(PROFILE), foot: new Float32Array(PROFILE) };
      for (let k = 0; k < PROFILE; k++) {
        const U = f.U0 + (k / (PROFILE - 1) - 0.5) * TILE, zone = resinZone(U, f.W);
        if (zone < resinCfg.min) continue;
        f.top[k] = resinThickness(U, wallH, f.W, wallH, zone) / RESIN.maxThick;
        f.foot[k] = resinThickness(U, 0, f.W, wallH, zone) / RESIN.maxThick;
      }
      if (f.top.some((v) => v > 0) || f.foot.some((v) => v > 0)) list.push(f);
    }
    faceCache.set(key, list);
    return list;
  };
  let floorFrom = 0; // where the floor's triangles start (it has a material of its own)
  for (const kind of ["ceiling", "floor"]) {
    if (kind === "floor") floorFrom = index.length;
    const bare = kind === "ceiling" ? (x, y) => isBare(x, y) || bareCeiling(x, y) : isBare;
    const vAt = new Map(), hAt = new Map();
    const height = (gi, gj) => { // grid point (gi, gj): world x = gi * cell - TILE / 2, z likewise
      const key = gi * 65536 + gj;
      if (hAt.has(key)) return hAt.get(key);
      const px = gi * cell - TILE / 2, pz = gj * cell - TILE / 2;
      const h = resinFlatThickness(px, pz, kind, { TILE, faces, bare, isOpen });
      hAt.set(key, h);
      return h;
    };
    const vertex = (gi, gj) => {
      const key = gi * 65536 + gj;
      if (vAt.has(key)) return vAt.get(key);
      const px = gi * cell - TILE / 2, pz = gj * cell - TILE / 2, h = height(gi, gj);
      vAt.set(key, pos.length / 3);
      pos.push(px, kind === "ceiling" ? wallH + 0.012 - h : h - 0.012, pz); // bare: just behind the surface
      uv.push(px * 0.9, pz * 0.9);
      return vAt.get(key);
    };
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      if (!isOpen(x, y) || bare(x, y)) continue;
      // quick look first: nothing anywhere near this tile, skip it
      const px0 = (x - 0.5) * TILE, pz0 = (y - 0.5) * TILE;
      let near = false;
      for (let ny = y - 1; ny <= y + 1 && !near; ny++) for (let nx = x - 1; nx <= x + 1; nx++) if (isOpen(nx, ny) && faces(nx, ny).length) near = true;
      for (const fx of [0, 0.5, 1]) for (const fz of [0, 0.5, 1])
        if (!near && resinFlatZone(px0 + fx * TILE, pz0 + fz * TILE, kind) > resinCfg.min - 0.03) near = true;
      if (!near) continue;
      const gi0 = x * nH, gj0 = y * nH;
      for (let j = 0; j < nH; j++) for (let i = 0; i < nH; i++) {
        const A = [gi0 + i, gj0 + j], B = [gi0 + i + 1, gj0 + j], C = [gi0 + i + 1, gj0 + j + 1], D = [gi0 + i, gj0 + j + 1];
        if ([A, B, C, D].every(([a, b]) => height(a, b) <= 0)) continue;
        const [a, b, c, d] = [A, B, C, D].map(([p, q]) => vertex(p, q));
        if (kind === "ceiling") index.push(a, b, c, a, c, d); // faces down
        else index.push(a, c, b, a, d, c);                     // faces up
      }
    }
  }

  if (!index.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  const bump = resinBumpTexture();
  // near black, with a tight wet highlight where the helmet lamps catch it. Wet sheen: like a wet surface, it
  // reflects more the more glancing the view. Only as much as there is light falling on it: in the dark it stays black.
  const material = (bumpScale, sheen, power) => {
    const mat = new THREE.MeshPhongMaterial({ color: 0x0a0b0a, specular: 0xb4bab6, shininess: 85, bumpMap: bump, bumpScale });
    mat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace("#include <envmap_fragment>", `#include <envmap_fragment>
        {
          vec3 lit = reflectedLight.directDiffuse / max(diffuseColor.rgb, vec3(0.002));
          float glance = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), ${power.toFixed(1)});
          outgoingLight += lit * glance * ${sheen.toFixed(3)};
        }`);
    };
    return mat;
  };
  // the floor pools lie flat, away from the lamps' reflection: rougher skin so they glisten, and more sheen
  const materials = [material(0.035, RESIN.sheen, 3), material(0.14, RESIN.sheen * 1.6, 2)];

  // Cut it into chunks of the map (after working out the normals on the whole, so there are no seams) so the
  // renderer only draws the ones in view: near the nest there is a lot of it.
  const normal = geo.getAttribute("normal").array;
  const CHUNK = RESIN.chunk * TILE, chunks = new Map();
  for (let t = 0; t < index.length; t += 3) {
    const v0 = index[t];
    const key = Math.floor(pos[v0 * 3] / CHUNK) * 4096 + Math.floor(pos[v0 * 3 + 2] / CHUNK);
    if (!chunks.has(key)) chunks.set(key, { remap: new Map(), pos: [], normal: [], uv: [], index: [[], []] });
    const c = chunks.get(key);
    for (let k = 0; k < 3; k++) {
      const v = index[t + k];
      let n = c.remap.get(v);
      if (n === undefined) {
        n = c.pos.length / 3;
        c.remap.set(v, n);
        c.pos.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
        c.normal.push(normal[v * 3], normal[v * 3 + 1], normal[v * 3 + 2]);
        c.uv.push(uv[v * 2], uv[v * 2 + 1]);
      }
      c.index[t < floorFrom ? 0 : 1].push(n);
    }
  }
  geo.dispose();
  const group = new THREE.Group();
  chunks.forEach((c) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(c.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(c.normal, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(c.uv, 2));
    g.setIndex([...c.index[0], ...c.index[1]]);
    g.addGroup(0, c.index[0].length, 0);
    g.addGroup(c.index[0].length, c.index[1].length, 1);
    g.computeBoundingSphere();
    group.add(new THREE.Mesh(g, materials));
  });
  return group;
}
