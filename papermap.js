"use strict";

// The paper map: the whole complex (every sector of sectors.js) full screen, drawn like the hand-made maps in
// old sci-fi films: a near-black sheet, thin pale lines, sector grid and labels (the Sevastolink palette, as in
// style.css: Hypersleep White lines, Synthetic grey labels, Cryo areas, Acid Blood for where the squad is). The only thing laid over it is the sector
// the squad is in now; no soldiers, no hostiles, no door states: it's paper.

// overlay: the full-screen element (hidden until opened), holding a canvas. currentSector(): [sx, sy] now.
const PAPER = {
  sheet: "#071a07",                       // deep
  ink: "rgba(204,213,212,0.85)",          // hypersleep: walls, accesses, the entry
  faint: "rgba(204,213,212,0.16)",        // the sector grid
  label: "rgba(204,213,212,0.7)",         // column letters, row numbers
  muted: "rgba(122,128,127,0.85)",        // synthetic: room labels, sector names
  area: "rgba(101,191,198,0.75)",         // cryo: the named areas
  here: "rgba(240,120,38,0.9)",           // acid: the sector the squad is in
  hereFill: "rgba(240,120,38,0.12)",
};

function createPaperMap(overlay, { currentSector }) {
  const canvas = overlay.querySelector("canvas");
  const ctx = canvas.getContext("2d");
  const N = SECTORS.size, T = SECTORS.tiles;
  const grids = new Map(); // "sx,sy" -> the sector's grid, once worked out

  function draw() {
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = PAPER.sheet;
    ctx.fillRect(0, 0, W, H);

    const M = 34; // margin for the column letters and row numbers
    const S = Math.min(W, H) - M * 2;
    const t = S / (N * T); // px per tile
    const ox = (W - S) / 2, oy = (H - S) / 2;
    const X = (sx, x) => ox + (sx * T + x) * t, Y = (sy, y) => oy + (sy * T + y) * t;

    // sector grid, faint and dashed, with letters and numbers in the margin
    ctx.strokeStyle = PAPER.faint;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    for (let k = 0; k <= N; k++) {
      ctx.beginPath(); ctx.moveTo(ox + k * T * t, oy); ctx.lineTo(ox + k * T * t, oy + S); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ox, oy + k * T * t); ctx.lineTo(ox + S, oy + k * T * t); ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.fillStyle = PAPER.label;
    ctx.font = "13px VT323, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let k = 0; k < N; k++) {
      const c = ox + (k + 0.5) * T * t, r = oy + (k + 0.5) * T * t;
      ctx.fillText(String.fromCharCode(65 + k), c, oy - M / 2);
      ctx.fillText(String.fromCharCode(65 + k), c, oy + S + M / 2);
      ctx.fillText(String(k + 1), ox - M / 2, r);
      ctx.fillText(String(k + 1), ox + S + M / 2, r);
    }

    // named areas spanning several sectors, in a Cryo pencil, just inside their borders (decoration)
    ctx.save();
    ctx.strokeStyle = ctx.fillStyle = PAPER.area;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([10, 5]);
    ctx.font = "12px VT323, monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    const inset = 5;
    for (const area of MAP_AREAS) {
      const cells = new Set();
      area.cells.forEach(([x1, y1, x2, y2]) => { for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) cells.add(`${x},${y}`); });
      const has = (x, y) => cells.has(`${x},${y}`);
      ctx.beginPath();
      for (const key of cells) { // each border edge of the area, pulled in a little toward its inside
        const [x, y] = key.split(",").map(Number);
        const x0 = X(x, 0), y0 = Y(y, 0), x1 = X(x + 1, 0), y1 = Y(y + 1, 0);
        const inL = has(x - 1, y) ? 0 : inset, inR = has(x + 1, y) ? 0 : inset;
        const inT = has(x, y - 1) ? 0 : inset, inB = has(x, y + 1) ? 0 : inset;
        if (!has(x, y - 1)) { ctx.moveTo(x0 + inL, y0 + inset); ctx.lineTo(x1 - inR, y0 + inset); }
        if (!has(x, y + 1)) { ctx.moveTo(x0 + inL, y1 - inset); ctx.lineTo(x1 - inR, y1 - inset); }
        if (!has(x - 1, y)) { ctx.moveTo(x0 + inset, y0 + inT); ctx.lineTo(x0 + inset, y1 - inB); }
        if (!has(x + 1, y)) { ctx.moveTo(x1 - inset, y0 + inT); ctx.lineTo(x1 - inset, y1 - inB); }
      }
      ctx.stroke();
      // the name, along the top of its first rectangle
      const [lx, ly] = area.cells[0];
      ctx.fillText(area.name, X(lx, 0) + inset + 4, Y(ly, 0) + inset + 14);
    }
    ctx.restore();

    // the sector the squad is in now: the one thing laid over the paper
    const [cx, cy] = currentSector();
    ctx.fillStyle = PAPER.hereFill;
    ctx.fillRect(X(cx, 0), Y(cy, 0), T * t, T * t);
    ctx.strokeStyle = PAPER.here;
    ctx.lineWidth = 2;
    ctx.strokeRect(X(cx, 0) + 1, Y(cy, 0) + 1, T * t - 2, T * t - 2);

    // every sector's walls: each wall edge that faces open floor, as a thin line
    ctx.strokeStyle = PAPER.ink;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let sy = 0; sy < N; sy++) for (let sx = 0; sx < N; sx++) {
      const key = `${sx},${sy}`;
      if (!grids.has(key)) grids.set(key, levelGrid(generateSector(sx, sy)));
      const g = grids.get(key);
      const open = (x, y) => g[y]?.[x] === 0;
      for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
        if (open(x, y)) continue;
        const x0 = X(sx, x), y0 = Y(sy, y), x1 = x0 + t, y1 = y0 + t;
        if (open(x, y - 1)) { ctx.moveTo(x0, y0); ctx.lineTo(x1, y0); }
        if (open(x, y + 1)) { ctx.moveTo(x0, y1); ctx.lineTo(x1, y1); }
        if (open(x - 1, y)) { ctx.moveTo(x0, y0); ctx.lineTo(x0, y1); }
        if (open(x + 1, y)) { ctx.moveTo(x1, y0); ctx.lineTo(x1, y1); }
      }
    }
    ctx.stroke();

    // accesses: a small mark joining the two hatches across the sector border; the entry, labelled
    ctx.strokeStyle = ctx.fillStyle = PAPER.ink;
    ctx.lineWidth = 1;
    for (let sy = 0; sy < N; sy++) for (let sx = 0; sx < N; sx++) {
      const level = generateSector(sx, sy);
      for (const e of level.exits) {
        if (e.dir !== "east" && e.dir !== "south") continue; // each link once
        const [dx, dy] = e.door;
        const along = e.dir === "east"; // the border is vertical
        const mx = X(sx, dx + (along ? 1 : 0.5)), my = Y(sy, dy + (along ? 0.5 : 1));
        ctx.strokeRect(mx - (along ? t : t * 1.5), my - (along ? t * 1.5 : t), along ? t * 2 : t * 3, along ? t * 3 : t * 2);
      }
      if (level.entry) {
        const r = level.rooms.find((o) => o.name === level.entry);
        const ex = X(sx, r.x + r.w / 2), ey = Y(sy, T);
        ctx.beginPath(); ctx.moveTo(ex, ey + 4); ctx.lineTo(ex, ey + 14); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(ex - 4, ey + 8); ctx.lineTo(ex, ey + 4); ctx.lineTo(ex + 4, ey + 8); ctx.stroke();
        ctx.font = "11px VT323, monospace";
        ctx.fillText("ENTRY", ex, ey + 21);
      }
    }

    // room labels, small, where there's room for them
    if (t >= 2.2) {
      ctx.fillStyle = PAPER.muted;
      ctx.font = `${Math.max(7, Math.round(t * 2.2))}px VT323, monospace`;
      for (let sy = 0; sy < N; sy++) for (let sx = 0; sx < N; sx++) {
        for (const r of generateSector(sx, sy).rooms) {
          if (r.w < 4 || r.h < 3) continue; // not the access vestibules
          ctx.fillText(r.label, X(sx, r.x + r.w / 2), Y(sy, r.y + r.h / 2));
        }
      }
    }
    // sector names, in each top-left corner
    ctx.fillStyle = PAPER.muted;
    ctx.font = "11px VT323, monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    for (let sy = 0; sy < N; sy++) for (let sx = 0; sx < N; sx++) ctx.fillText(sectorName(sx, sy), X(sx, 0) + 3, Y(sy, 0) + 2);
  }

  function open() {
    overlay.hidden = false;
    draw();
  }
  function close() { overlay.hidden = true; }
  window.addEventListener("resize", () => { if (!overlay.hidden) draw(); });
  window.addEventListener("keydown", (e) => { if (e.key === "Escape" && !overlay.hidden) close(); });
  overlay.addEventListener("click", (e) => { if (e.target === overlay || e.target.dataset.close != null) close(); });
  return { open, close, toggle: () => (overlay.hidden ? open() : close()) };
}
