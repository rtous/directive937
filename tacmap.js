"use strict";

// The tactical map: a vector-style display of the level (glowing outlines of the corridors), the doors, the
// soldiers as coloured dots, the exits (accesses), and the hostiles only as sonar blips.
//
// Sonar: every soldier carries one. Every SONAR.period a wave leaves each soldier still in play (onWave: one
// shared beep) and spreads out to SONAR.range tiles. A hostile shows as a blip where a wave caught it, fading
// until the next wave passes, so the squad only senses what is near it.

const SONAR = { period: 1000, sweep: 850, fade: 1100, range: 12 }; // ms: between waves, to full range, blip fade; tiles
const MAP_PAD = 16; // px around the level

// canvas: drawn at the size it is shown. colors: one per soldier, in squad order. onWave(): a sonar wave left.
function createTacticalMap(canvas, { colors, onWave = () => {} }) {
  const ctx = canvas.getContext("2d");
  let world = null;
  let layer = null; // the level's outline, drawn once per world and size
  let geom = null;  // { cell, ox, oy }: tile size and offset in px
  const blips = new Map(); // alien -> { x, y, at }: where and when a wave last caught it
  let wave = -1;    // index of the current wave
  let lastR = 0;    // how far the current wave had got last frame (px)

  // redraw once the VT323 font has loaded so the room labels use it
  if (document.fonts) document.fonts.ready.then(() => { layer = null; });
  fitCanvas(canvas, () => { layer = null; });

  function buildLayer() {
    const w = canvas.width, h = canvas.height;
    const { grid } = world;
    const rows = grid.length, cols = grid[0].length;
    const cell = Math.min((w - MAP_PAD * 2) / cols, (h - MAP_PAD * 2) / rows);
    geom = { cell, ox: (w - cell * cols) / 2, oy: (h - cell * rows) / 2 };
    const { ox, oy } = geom;

    layer = document.createElement("canvas");
    layer.width = w;
    layer.height = h;
    const g = layer.getContext("2d");

    // faint reference grid
    g.strokeStyle = "rgba(5,182,105,0.08)";
    g.lineWidth = 1;
    for (let x = 0; x <= w; x += w / 10) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    for (let y = 0; y <= h; y += h / 8) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }

    // corridor outlines: every wall edge that faces open floor
    const open = (x, y) => y >= 0 && y < rows && x >= 0 && x < cols && grid[y][x] === 0;
    g.beginPath();
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (grid[y][x] !== 1) continue;
        const x0 = ox + x * cell, y0 = oy + y * cell;
        const x1 = x0 + cell, y1 = y0 + cell;
        if (open(x, y - 1)) { g.moveTo(x0, y0); g.lineTo(x1, y0); }
        if (open(x, y + 1)) { g.moveTo(x0, y1); g.lineTo(x1, y1); }
        if (open(x - 1, y)) { g.moveTo(x0, y0); g.lineTo(x0, y1); }
        if (open(x + 1, y)) { g.moveTo(x1, y0); g.lineTo(x1, y1); }
      }
    }
    g.lineCap = "square";
    // wide soft glow, then a bright core
    g.strokeStyle = "rgba(5,182,105,0.35)";
    g.lineWidth = 6;
    g.shadowColor = "#05b669";
    g.shadowBlur = 14;
    g.stroke();
    g.shadowBlur = 4;
    g.strokeStyle = "#3fe39a";
    g.lineWidth = 2;
    g.stroke();

    // ceiling vents (openings to the ducts): small dim squares
    g.strokeStyle = "rgba(63,227,154,0.55)";
    g.lineWidth = 1;
    for (const [x, y] of world.vents) g.strokeRect(ox + (x + 0.2) * cell, oy + (y + 0.2) * cell, cell * 0.6, cell * 0.6);

    // room labels, like a colony schematic: top-left corner of each room, clear of what's in the middle
    g.shadowBlur = 6;
    g.fillStyle = "rgba(63,227,154,0.75)";
    g.font = `${Math.round(cell * 1.7)}px VT323, monospace`;
    g.textAlign = "left";
    g.textBaseline = "top";
    for (const r of world.rooms) g.fillText(r.label, ox + (r.x + 0.35) * cell, oy + (r.y + 0.25) * cell);
  }

  // Each exit (access) outlined, pulsing, with its hatch in the outer wall and the sector it leads to. Once the
  // squad is leaving through one, the others are crossed out.
  function drawExits(now) {
    const { cell, ox, oy } = geom;
    const chosen = world.mission.chosen;
    ctx.save();
    ctx.font = `${Math.round(cell * 1.3)}px VT323, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const e of world.exits) {
      const { room: r, door } = e;
      const closed = chosen && chosen !== e;
      ctx.strokeStyle = ctx.fillStyle = ctx.shadowColor = closed ? "#7a807f" : "#f07826";
      ctx.shadowBlur = closed ? 0 : 10;
      ctx.globalAlpha = closed ? 0.6 : 0.5 + 0.4 * (0.55 + 0.45 * Math.sin(now / 300));
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      const x0 = ox + r.x * cell, y0 = oy + r.y * cell, w = r.w * cell, h = r.h * cell;
      ctx.strokeRect(x0, y0, w, h);
      ctx.setLineDash([]);
      if (closed) { // crossed out
        ctx.beginPath();
        ctx.moveTo(x0, y0); ctx.lineTo(x0 + w, y0 + h);
        ctx.moveTo(x0 + w, y0); ctx.lineTo(x0, y0 + h);
        ctx.stroke();
      }
      // a bar along the wall face the hatch is on
      const [ix, iy] = door.inward;
      const along = ix ? [cell * 0.6, cell * 2] : [cell * 2, cell * 0.6];
      const cx = ox + (door.x + 0.5 + ix * 0.2) * cell, cy = oy + (door.y + 0.5 + iy * 0.2) * cell;
      ctx.fillRect(cx - along[0] / 2, cy - along[1] / 2, along[0], along[1]);
      // where it leads, just inside the room
      if (e.toName) ctx.fillText(e.toName, ox + (r.x + r.w / 2 + ix * 2.6) * cell, oy + (r.y + r.h / 2 + iy * 2.6) * cell);
    }
    ctx.restore();
  }

  // Doors: a bar across the passage when closed, split apart when open, thick and orange once sealed (blinking
  // while being welded or cut open), with the door's id beside it
  function drawDoors(now) {
    const { cell, ox, oy } = geom;
    const doors = world.doors;
    ctx.save();
    ctx.font = `${Math.round(cell * 1.2)}px VT323, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const d of doors.list) {
      const cx = ox + (d.x + 0.5) * cell, cy = oy + (d.y + 0.5) * cell;
      const [ax, ay] = [d.pass[1], d.pass[0]]; // along the bar (across the passage)
      const welding = doors.welding(d);
      const hot = welding ? Math.floor(now / 250) % 2 === 0 : d.sealed; // blinks while being welded or cut
      ctx.strokeStyle = ctx.fillStyle = ctx.shadowColor = hot ? "#f07826" : "#3fe39a";
      ctx.shadowBlur = hot ? 8 : 4;
      ctx.lineWidth = d.sealed ? cell * 0.5 : cell * 0.3;
      const half = cell * 0.55, gap = d.open * half; // the leaves slide apart from the middle
      ctx.beginPath();
      ctx.moveTo(cx - ax * half, cy - ay * half);
      ctx.lineTo(cx - ax * gap, cy - ay * gap);
      ctx.moveTo(cx + ax * gap, cy + ay * gap);
      ctx.lineTo(cx + ax * half, cy + ay * half);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 0.8;
      ctx.fillText(d.id, cx + d.pass[0] * cell * 0.1 + ax * cell * 1.5, cy + d.pass[1] * cell * 0.1 + ay * cell * 1.5);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  function draw(now, selected) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!world) return;
    if (!layer) buildLayer();
    const { cell, ox, oy } = geom;

    // slight brightness wobble like an old vector screen
    ctx.globalAlpha = 0.88 + Math.random() * 0.12;
    ctx.drawImage(layer, 0, 0);
    ctx.globalAlpha = 1;

    const at = (u) => { const [x, y] = unitPos(u); return [ox + (x + 0.5) * cell, oy + (y + 0.5) * cell]; };
    drawExits(now);
    drawDoors(now);

    // sonar waves, one from each soldier in play
    const carriers = world.soldiers.map((s, i) => ({ s, i, p: at(s) })).filter(({ s }) => !s.dead);
    const maxR = SONAR.range * cell;
    const w = Math.floor(now / SONAR.period);
    if (w !== wave) { wave = w; lastR = 0; if (carriers.length) onWave(); }
    const r = Math.min(1, (now - w * SONAR.period) / SONAR.sweep) * maxR;
    if (r < maxR) {
      ctx.lineWidth = 1.5;
      ctx.shadowBlur = 6;
      ctx.globalAlpha = 0.4 * (1 - r / maxR);
      carriers.forEach(({ i, p }) => {
        ctx.strokeStyle = ctx.shadowColor = colors[i];
        ctx.beginPath();
        ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
        ctx.stroke();
      });
      ctx.globalAlpha = 1;
    }
    // a wave front caught these hostiles this frame
    world.aliens.forEach((a) => {
      if (a.dead) { blips.delete(a); return; }
      const ax = ox + (a.x + 0.5) * cell, ay = oy + (a.y + 0.5) * cell;
      const caught = carriers.some(({ p }) => {
        const d = Math.hypot(ax - p[0], ay - p[1]);
        return d > lastR && d <= r;
      });
      if (caught) blips.set(a, { x: ax, y: ay, at: now, size: a.giant ? 2.4 : 1 });
    });
    lastR = r;
    // blips: identical white dots where each hostile was caught, fading
    ctx.fillStyle = ctx.shadowColor = "#ccd5d4"; // hypersleep
    ctx.shadowBlur = 10;
    blips.forEach((b) => {
      const k = 1 - (now - b.at) / SONAR.fade;
      if (k <= 0) return;
      ctx.globalAlpha = k;
      ctx.beginPath();
      ctx.arc(b.x, b.y, cell * 0.45 * b.size, 0, Math.PI * 2); // the giant: a big one
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    // soldiers: one colour each, always shown; the one on camera has a ring
    ctx.font = `${Math.round(cell * 1.3)}px VT323, monospace`;
    ctx.textBaseline = "middle";
    carriers.forEach(({ s, i, p: [sx, sy] }) => {
      const active = i === selected;
      ctx.fillStyle = ctx.strokeStyle = ctx.shadowColor = colors[i];
      ctx.shadowBlur = active ? 16 : 8;
      ctx.beginPath();
      ctx.arc(sx, sy, cell * 0.72, 0, Math.PI * 2);
      ctx.fill();
      if (active) {
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(sx, sy, cell * 1.2, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.shadowBlur = 4;
      ctx.fillText(String(s.id), sx + cell * 0.95, sy - cell * 0.85);
    });
    ctx.shadowBlur = 0;
  }

  return {
    draw,
    // show another world (a restart or a new level)
    setWorld(w) { world = w; layer = null; blips.clear(); },
  };
}

// Keep a canvas's drawing buffer the size it is shown, so it stays sharp whatever the layout
function fitCanvas(c, onResize) {
  const fit = () => {
    const w = Math.round(c.clientWidth), h = Math.round(c.clientHeight);
    if (w > 0 && h > 0 && (c.width !== w || c.height !== h)) { c.width = w; c.height = h; onResize(); }
  };
  if (window.ResizeObserver) new ResizeObserver(fit).observe(c); else window.addEventListener("resize", fit);
  fit();
}
