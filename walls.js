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
