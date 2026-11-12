"use strict";

// ---------- Config ----------
// The squad. One AI agent (on the player's machine) commands and voices all of them.
// color: the unit's dot on the tactical map (and a hint of it in the squad list)
const SQUAD = [
  { id: 1, name: "SGT. R. FROST", callsign: "FROST", color: "#ffa040" },
  { id: 2, name: "CPL. J. VASQUEZ", callsign: "VASQUEZ", color: "#4fd8ff" },
  { id: 3, name: "PVT. W. HUDSON", callsign: "HUDSON", color: "#ff6fa8" },
  { id: 4, name: "PVT. M. DRAKE", callsign: "DRAKE", color: "#c09bff" },
];
let selected = 0; // whose helmet camera / vitals are on screen
const missionStart = performance.now();

const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, "0");
const rand = (a, b) => a + Math.random() * (b - a);

function formatHMS(totalSeconds) {
  const s = Math.floor(totalSeconds);
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
}


// ---------- CRT camera feed ----------
// Drawn at low resolution and scaled up, like an old analog feed.
const feed = $("feed");
const fctx = feed.getContext("2d");
const W = feed.width;
const H = feed.height;
const img = fctx.createImageData(W, H);
const px = new Uint32Array(img.data.buffer);
const rowGain = new Float32Array(H);
const crt = $("crt");
const osdMsg = $("osd-msg");

// Static sound, on by default. Browsers hold audio back until the user first interacts with the page, so it is
// started now (plays straight away where the browser allows it) and again on the first click or key press.
const sound = createStaticAudio();
const audioBtn = $("audio-btn");
function refreshAudioBtn() {
  audioBtn.textContent = sound.enabled ? "AUDIO ON" : "AUDIO OFF";
  audioBtn.classList.toggle("on", sound.enabled);
}
sound.start();
refreshAudioBtn();
audioBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  sound.start(); // in case this is the first gesture
  sound.toggle();
  refreshAudioBtn();
});
function firstGesture() {
  sound.start(); // resumes the audio the browser held back
  window.removeEventListener("pointerdown", firstGesture);
  window.removeEventListener("keydown", firstGesture);
}
window.addEventListener("pointerdown", firstGesture);
window.addEventListener("keydown", firstGesture);

// The 3D mission world, seen only through the helmet camera.
// If Three.js failed to load (e.g. offline) the feed is just static.
const world = window.THREE ? createWorld(W, H, SQUAD) : null;
const sceneCanvas = document.createElement("canvas");
sceneCanvas.width = W;
sceneCanvas.height = H;
const sctx = sceneCanvas.getContext("2d", { willReadFrequently: true });
let scenePx = null; // RGBA of the latest 3D frame

// Interference state
let burstUntil = 0;   // heavy snow + "NO SIGNAL" (not triggered yet; reserved for a lost unit)
let switchUntil = 0;  // heavy snow while changing camera channel
const streaks = [];   // bright horizontal lines
// The feed is grayscale; only red light (emergency lamps) comes through as colour
const RED_MIN = 12;   // ignore faint warm tints
const RED_GAIN = 2.2; // how strongly red light shows on the monitor

function scheduleEvents(now) {
  if (Math.random() < 0.08) {
    streaks.push({ y: Math.floor(rand(0, H)), life: Math.floor(rand(1, 5)), gain: rand(40, 140) });
  }
}

function renderFeed(now) {
  const t = now / 1000;
  const switching = now < switchUntil;
  // a fallen soldier's helmet camera is lost
  const lost = world && world.soldiers[selected].dead;
  const burst = now < burstUntil || switching || lost;

  const streaksBefore = streaks.length;
  scheduleEvents(now);
  sound.update({
    burst,
    tearing: false,
    crackle: streaks.length > streaksBefore || Math.random() < 0.04,
  });

  // Per-row brightness: dark hum bar drifting up + random streaks
  const humY = (H - ((t * 30) % (H + 80))) | 0;
  for (let y = 0; y < H; y++) {
    const d = Math.abs(y - humY);
    rowGain[y] = d < 40 ? -18 * (1 - d / 40) : 0;
  }
  for (let i = streaks.length - 1; i >= 0; i--) {
    const s = streaks[i];
    for (let k = -1; k <= 1; k++) {
      const yy = s.y + k;
      if (yy >= 0 && yy < H) rowGain[yy] += s.gain * (k === 0 ? 1 : 0.4);
    }
    if (--s.life <= 0) streaks.splice(i, 1);
  }

  // Grab the latest 3D frame
  if (world) {
    world.render(selected);
    sctx.drawImage(world.canvas, 0, 0, W, H);
    scenePx = sctx.getImageData(0, 0, W, H).data;
  }

  const amp = burst ? 230 : scenePx ? 45 : 70;
  const base = burst ? 10 : scenePx ? 0 : 14;
  const signal = burst ? 0.08 : 1.15; // how much of the picture gets through

  for (let y = 0; y < H; y++) {
    const g = rowGain[y];
    const row = y * W;
    const srcRow = row;
    const jitter = Math.random() < 0.02 ? (Math.random() * 4 - 2) | 0 : 0;
    for (let x = 0; x < W; x++) {
      // faint diagonal RF interference pattern
      const wave = Math.sin(x * 0.35 + y * 0.9 + t * 9) * 5;
      let pic = 0, red = 0;
      if (scenePx) {
        let sx = x + jitter;
        sx = sx < 0 ? 0 : sx >= W ? W - 1 : sx;
        const si = (srcRow + sx) * 4;
        const sr = scenePx[si], sg = scenePx[si + 1], sb = scenePx[si + 2];
        const lum = sr * 0.3 + sg * 0.59 + sb * 0.11;
        pic = lum * signal;
        const excess = sr - (sg > sb ? sg : sb) - RED_MIN; // how much redder than everything else
        if (excess > 0) red = excess * signal;
      }
      const v = base + pic + Math.random() * amp + wave + g;
      // slight cool phosphor tint, plus the red wash
      let r = v * 0.92 + red * RED_GAIN, gr = v * 0.98 - red * 0.7, b = v - red * 0.7;
      r = r < 0 ? 0 : r > 255 ? 255 : r;
      gr = gr < 0 ? 0 : gr > 255 ? 255 : gr;
      b = b < 0 ? 0 : b > 255 ? 255 : b;
      px[row + x] = 0xff000000 | (b << 16) | (gr << 8) | r;
    }
  }
  fctx.putImageData(img, 0, 0);

  // Overlay state
  crt.classList.toggle("glitch", burst);
  if (burst) {
    osdMsg.textContent = switching ? `CH-${pad(SQUAD[selected].id)}` : "NO SIGNAL";
    osdMsg.classList.add("show");
  } else {
    osdMsg.classList.remove("show");
  }
}

// ---------- ECG ----------
const ecg = $("ecg");
const ectx = ecg.getContext("2d");
let ecgX = 0;
let ecgPrevY = ecg.height / 2;
let beatPhase = 0;
const vitals = SQUAD.map(() => ({
  bpm: Math.round(rand(80, 95)), resp: Math.round(rand(14, 18)),
  sys: Math.round(rand(115, 128)), dia: Math.round(rand(72, 82)), o2: 97, temp: 37.0,
}));

function ecgSample(phase) {
  // phase 0..1 within one heartbeat: P wave, QRS spike, T wave
  if (phase < 0.1) return Math.sin(phase / 0.1 * Math.PI) * 4;
  if (phase > 0.16 && phase < 0.19) return -6;
  if (phase >= 0.19 && phase < 0.23) return 28;
  if (phase >= 0.23 && phase < 0.26) return -10;
  if (phase > 0.38 && phase < 0.55) return Math.sin((phase - 0.38) / 0.17 * Math.PI) * 7;
  return 0;
}

function renderEcg(dt) {
  const steps = 2;
  for (let i = 0; i < steps; i++) {
    beatPhase += (vitals[selected].bpm / 60) * (dt / 1000) / steps;
    if (beatPhase >= 1) beatPhase -= 1;
    const flat = world && world.soldiers[selected].dead; // flatline
    const y = ecg.height * 0.6 - (flat ? 0 : ecgSample(beatPhase)) * 1.4 + rand(-0.6, 0.6);
    // erase just ahead of the sweep so the old trace gets overwritten
    ectx.clearRect(ecgX, 0, 10, ecg.height);
    ectx.strokeStyle = "#05b669";
    ectx.shadowColor = "#05b669";
    ectx.shadowBlur = 4;
    ectx.lineWidth = 1.5;
    ectx.beginPath();
    ectx.moveTo(ecgX - 1, ecgPrevY);
    ectx.lineTo(ecgX, y);
    ectx.stroke();
    ecgPrevY = y;
    ecgX = (ecgX + 1) % ecg.width;
  }
}

// ---------- Vitals screen static (lighter than the camera) ----------
const vnoise = $("vitals-noise");
const vnctx = vnoise.getContext("2d");
const vimg = vnctx.createImageData(vnoise.width, vnoise.height);
const vpx = new Uint32Array(vimg.data.buffer);
function renderVitalsNoise(now) {
  const vw = vnoise.width;
  const band = (now / 25) % (vnoise.height + 30) - 15; // bright interference band
  for (let i = 0; i < vpx.length; i++) {
    const y = (i / vw) | 0;
    let v = Math.random() * 120;
    if (Math.abs(y - band) < 3) v += 80;
    if (v > 255) v = 255;
    vpx[i] = 0xff000000 | (v << 16) | (v << 8) | v;
  }
  vnctx.putImageData(vimg, 0, 0);
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
function updateVitals() {
  vitals.forEach((v, i) => {
    // heart rate and breathing follow how stressed the soldier is (contact, firing, running)
    const stress = world ? world.soldiers[i].stress : 0;
    v.bpm = Math.round(clamp(v.bpm + (82 + stress * 65 - v.bpm) * 0.3 + rand(-3, 3), 65, 165));
    v.resp = Math.round(clamp(v.resp + (15 + stress * 12 - v.resp) * 0.3 + rand(-1, 1), 12, 30));
    v.sys = Math.round(clamp(v.sys + rand(-2, 2), 105, 150));
    v.dia = Math.round(clamp(v.dia + rand(-1.5, 1.5), 65, 95));
    v.o2 = Math.round(rand(94, 99));
    v.hp = world ? world.soldiers[i].hp : 100;
    if (world && world.soldiers[i].dead) Object.assign(v, { bpm: 0, resp: 0, sys: 0, dia: 0, o2: 0, hp: 0 });
  });
  const v = vitals[selected];
  const dead = world && world.soldiers[selected].dead;
  $("bpm").textContent = v.bpm;
  $("bpm").classList.toggle("alert", v.bpm > 120);
  $("o2").textContent = v.o2;
  $("o2").classList.toggle("alert", v.o2 < 95);
  $("bp").textContent = `${v.sys}/${v.dia}`;
  $("resp").textContent = v.resp;
  $("hp").textContent = v.hp;
  $("hp").classList.toggle("alert", v.hp <= 30);
  const stressed = v.bpm > 120 || v.o2 < 95;
  $("vstatus").textContent = dead ? "NO LIFE" : v.hp <= 30 ? "CRITICAL" : stressed ? "STRESS" : "STABLE";
  $("vstatus").classList.toggle("alert", dead || stressed || v.hp <= 30);
}

// ---------- Tactical map ----------
// Vector-style display: glowing outlines of the corridors, soldier as a blinking dot.
const mapCanvas = $("map");
const mctx = mapCanvas.getContext("2d");
const MAP_PAD = 16;
let mapLayer = null; // the colony outline, drawn once
// redraw once the VT323 font has loaded so the room labels use it
if (document.fonts) document.fonts.ready.then(() => { mapLayer = null; });
let mapGeom = null;

function buildMapLayer() {
  const mw = mapCanvas.width;
  const mh = mapCanvas.height;
  const grid = world.grid;
  const rows = grid.length;
  const cols = grid[0].length;
  const cell = Math.min((mw - MAP_PAD * 2) / cols, (mh - MAP_PAD * 2) / rows);
  const ox = (mw - cell * cols) / 2;
  const oy = (mh - cell * rows) / 2;
  mapGeom = { cell, ox, oy };

  mapLayer = document.createElement("canvas");
  mapLayer.width = mw;
  mapLayer.height = mh;
  const g = mapLayer.getContext("2d");

  // faint reference grid
  g.strokeStyle = "rgba(5,182,105,0.08)";
  g.lineWidth = 1;
  for (let x = 0; x <= mw; x += mw / 10) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, mh); g.stroke(); }
  for (let y = 0; y <= mh; y += mh / 8) { g.beginPath(); g.moveTo(0, y); g.lineTo(mw, y); g.stroke(); }

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

  // room labels, like a colony schematic
  g.shadowBlur = 6;
  g.fillStyle = "rgba(63,227,154,0.75)";
  g.font = `${Math.round(cell * 1.7)}px VT323, monospace`;
  g.textAlign = "left";
  g.textBaseline = "top";
  // top-left corner of each room, clear of the consoles and machinery in the middle
  for (const r of world.rooms) {
    g.fillText(r.label, ox + (r.x + 0.35) * cell, oy + (r.y + 0.25) * cell);
  }
  g.shadowBlur = 0;
}

// Sonar: every soldier carries one. Every SONAR.period a wave leaves each living soldier (one shared beep) and
// spreads out to SONAR.range tiles. Hostiles only show as a blip where a wave caught them, fading until the next
// wave passes. Soldiers are always shown.
const SONAR = { period: 1000, sweep: 850, fade: 1100, range: 12 }; // ms: between waves, to full range, blip fade; tiles
const sonarBlips = new Map(); // alien -> { x, y, at }: where and when the wave last caught it
let sonarWave = -1;           // index of the current wave
let sonarLastR = 0;

// Extraction point (the survivor is never shown on the map: soldiers find them by the distress signal)
function drawMission(now, cell, ox, oy, px, py) {
  const pulse = 0.55 + 0.45 * Math.sin(now / 300);
  const ex = world.extraction;
  mctx.save();
  mctx.strokeStyle = mctx.fillStyle = mctx.shadowColor = "#ff6a4a";
  mctx.shadowBlur = 10;
  mctx.globalAlpha = 0.5 + 0.4 * pulse;
  mctx.lineWidth = 2;
  mctx.setLineDash([4, 3]);
  mctx.strokeRect(ox + ex.x * cell, oy + ex.y * cell, ex.w * cell, ex.h * cell);
  mctx.setLineDash([]);
  mctx.font = `${Math.round(cell * 1.4)}px VT323, monospace`;
  mctx.textAlign = "center";
  mctx.fillText("EXTRACT", ox + (ex.x + ex.w / 2) * cell, oy + (ex.y + ex.h + 1.1) * cell);
  mctx.restore();
}

function renderMap(now) {
  mctx.clearRect(0, 0, mapCanvas.width, mapCanvas.height);
  if (!world) return;
  if (!mapLayer) buildMapLayer();

  // slight brightness wobble like an old vector screen
  mctx.globalAlpha = 0.88 + Math.random() * 0.12;
  mctx.drawImage(mapLayer, 0, 0);
  mctx.globalAlpha = 1;

  const { cell, ox, oy } = mapGeom;
  mctx.font = `${Math.round(cell * 1.3)}px VT323, monospace`;
  mctx.textBaseline = "middle";
  const px = (u) => ox + (u.tx + (u.nx - u.tx) * u.progress + 0.5) * cell; // map position of a moving unit
  const py = (u) => oy + (u.ty + (u.ny - u.ty) * u.progress + 0.5) * cell;
  drawMission(now, cell, ox, oy, px, py);

  // sonar waves, one from each living soldier
  const carriers = world.soldiers.map((s, i) => ({ s, i })).filter(({ s }) => !s.dead);
  const maxR = SONAR.range * cell;
  const wave = Math.floor(now / SONAR.period);
  if (wave !== sonarWave) { sonarWave = wave; sonarLastR = 0; if (carriers.length) sound.beep(); }
  const r = Math.min(1, (now - wave * SONAR.period) / SONAR.sweep) * maxR;
  if (r < maxR) {
    mctx.lineWidth = 1.5;
    mctx.shadowBlur = 6;
    carriers.forEach(({ s, i }) => {
      mctx.strokeStyle = mctx.shadowColor = SQUAD[i].color;
      mctx.globalAlpha = 0.4 * (1 - r / maxR);
      mctx.beginPath();
      mctx.arc(px(s), py(s), r, 0, Math.PI * 2);
      mctx.stroke();
    });
    mctx.globalAlpha = 1;
  }
  // a wave front caught these hostiles this frame
  world.aliens.forEach((a) => {
    if (a.dead) { sonarBlips.delete(a); return; }
    const ax = ox + (a.x + 0.5) * cell, ay = oy + (a.y + 0.5) * cell;
    const caught = carriers.some(({ s }) => {
      const d = Math.hypot(ax - px(s), ay - py(s));
      return d > sonarLastR && d <= r;
    });
    if (caught) sonarBlips.set(a, { x: ax, y: ay, at: now });
  });
  sonarLastR = r;
  // blips: identical white dots where each hostile was caught, fading
  mctx.fillStyle = mctx.shadowColor = "#ffffff";
  mctx.shadowBlur = 10;
  sonarBlips.forEach((b) => {
    const k = 1 - (now - b.at) / SONAR.fade;
    if (k <= 0) return;
    mctx.globalAlpha = k;
    mctx.beginPath();
    mctx.arc(b.x, b.y, cell * 0.45, 0, Math.PI * 2);
    mctx.fill();
  });
  mctx.globalAlpha = 1;

  // soldiers: one colour each, always shown; the one on camera has a ring
  world.soldiers.forEach((s, i) => {
    if (s.dead) return;
    const sx = ox + (s.tx + (s.nx - s.tx) * s.progress + 0.5) * cell;
    const sy = oy + (s.ty + (s.ny - s.ty) * s.progress + 0.5) * cell;
    const active = i === selected;
    const color = SQUAD[i].color;
    mctx.fillStyle = mctx.strokeStyle = mctx.shadowColor = color;
    mctx.shadowBlur = active ? 16 : 8;
    mctx.beginPath();
    mctx.arc(sx, sy, cell * 0.72, 0, Math.PI * 2);
    mctx.fill();
    if (active) {
      mctx.lineWidth = 1.5;
      mctx.beginPath();
      mctx.arc(sx, sy, cell * 1.2, 0, Math.PI * 2);
      mctx.stroke();
    }
    mctx.shadowBlur = 4;
    mctx.fillText(String(s.id), sx + cell * 0.95, sy - cell * 0.85);
  });
  mctx.shadowBlur = 0;

  const s = world.soldiers[selected];
  $("map-coords").textContent = `U${pad(s.id)} X${pad(s.tx)} Y${pad(s.ty)}`;
}

// ---------- Comms log ----------
// Only what is said on the radio: CONTROL (the player), the soldiers and MOTHER (voiced by the AI agent).
// Game events and order results go to the agent, not here; with no agent linked, radioFallback calls them in.
const logEl = $("log");

// kind: "ambient" | "alert" | "player" | "soldier" | "mother" | "system"
function addLog(text, kind = "ambient", who = "") {
  const li = document.createElement("li");
  li.className = kind;
  const t = document.createElement("span");
  t.className = "t";
  t.textContent = $("mission-time").textContent;
  li.appendChild(t);
  if (who) {
    const w = document.createElement("span");
    w.className = "who";
    w.textContent = who + ":";
    li.appendChild(w);
  }
  li.appendChild(document.createTextNode(text.toUpperCase())); // agent text is never parsed as HTML
  const atBottom = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 30;
  logEl.appendChild(li);
  while (logEl.children.length > 80) logEl.firstChild.remove();
  if (atBottom) logEl.scrollTop = logEl.scrollHeight;
}

// ---------- Agent link ----------
// The player's AI agent runs bridge.mjs on their own machine (see agent.html). The browser connects
// to it on localhost, so this works even when the game page itself comes from a remote server.
// bridge -> game: Server-Sent Events. game -> bridge: POST.
const BRIDGE_URL = (new URLSearchParams(location.search).get("bridge") || "http://127.0.0.1:8937").replace(/\/$/, "");
const agentPill = $("agent-pill");
let stream = null;
let bridgeOpen = false;
let agentListening = false;

function setAgentPill() {
  agentPill.classList.remove("linked", "listening");
  if (!bridgeOpen) {
    agentPill.textContent = "AGENT: OFFLINE";
  } else if (agentListening) {
    agentPill.textContent = "AGENT: STANDING BY";
    agentPill.classList.add("listening");
  } else {
    // linked, but the agent isn't waiting right now (thinking, or its loop isn't running)
    agentPill.textContent = "AGENT: LINKED";
    agentPill.classList.add("linked");
  }
}

function sendBridge(msg) {
  if (!bridgeOpen) return;
  // text/plain keeps it a "simple" request (no CORS preflight); the bridge parses it as JSON
  fetch(`${BRIDGE_URL}/game/message`, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify(msg),
  }).catch(() => {});
}

// Status sent to the agent: every unit's position/orders plus vitals
function fullStatus() {
  if (!world) return null;
  const st = world.status();
  st.units.forEach((u, i) => {
    u.vitals = { heart_rate: vitals[i].bpm, spo2: vitals[i].o2, resp: vitals[i].resp };
  });
  st.on_camera = SQUAD[selected].id;
  return st;
}

// Urgent radio calls (shouted): the soldier just had a hostile event, or the message sounds like an alarm
const hostileEventAt = new Map(); // unit id -> time of their last hostile-related event
const HOSTILE_EVENT = /CONTACT|CHARGING|CEILING VENT|MOTION TRACKER|INSTINCT|TAKEN BY|LOST SIGHT|OVERWHELMED/i;
const ALARM_WORDS = /\b(contact|hostiles?|charging|incoming|movement|they'?re|it'?s (coming|in|on)|in the ceiling|run|fall back|get back|help|open fire|fire!|behind (you|us))\b/i;
function isUrgent(unit, text) {
  return performance.now() - (hostileEventAt.get(unit) ?? -1e9) < 10000 || ALARM_WORDS.test(text);
}

// With no agent linked: game events as short radio calls, from the soldier or from MOTHER (the ship computer).
// Events are written for the agent ("Unit 2 (VASQUEZ) CONTACT: ..."); this turns them into what was said.
const RADIO_CALLS = [
  [/^CONTACT: (.*)/, "Contact! $1"],
  [/^HOSTILE CHARGING AT \w+! (.*)/, "It's coming right at me! $1"],
  [/^HOSTILE DROPPED FROM A CEILING VENT in (.*)/, "One just dropped out of the ceiling vent! $1"],
  [/^lost sight of the hostile, (.*)/, "Lost sight of it, $1"],
  [/^MOTION TRACKER: (.*)/, "Motion tracker: $1"],
  [/^INSTINCT: overwhelmed .*/, "Too many of them! I'm getting out of here!"],
  [/^INSTINCT: hostile (.*), opening fire despite hold-fire\./, "It's right on me ($1), firing!"],
  [/^broke away from the hostiles and is holding in (.*)\./, "I'm clear. Holding in $1."],
  [/^fell back to (.*)\. Holding\./, "Fell back to $1. Holding."],
  [/^killed a hostile in (.*)\./, "Hostile down in $1."],
  [/^badly wounded, health (\d+)\./, "I'm hit bad! Health $1."],
  [/^arrived at (.*)\. Holding\./, "In position at $1. Holding."],
  [/^reached the furthest point (\w+) it can get to, in (.*)\. Holding\./, "Can't go any further $1. Holding in $2."],
  [/^has no route to (.*)\. Holding\./, "No way through to $1. Holding."],
  [/^has nowhere to retreat to\. Holding\./, "Nowhere to fall back to. Holding."],
  [/^all-round check done, (.*)\. Back to: (.*)\./, "All around clear: $1. Back to $2."],
  [/^finished inspecting (.*): (.*)\. Holding\./, "$1 checked: $2. Holding."],
  [/^found the survivor in (.*?)!.*/, "I've found the survivor in $1! They're with me. Heading for the AIRLOCK."],
];
function radioFallback(soldier, text) {
  const say = (t, who, kind, unit) => {
    addLog(t, kind, who);
    sound.radio({ kind, urgent: kind === "soldier" && isUrgent(unit, t) });
  };
  if (/^MISSION (COMPLETE|FAILED)/.test(text)) return; // shown over the camera feed
  if (/ entering .* while /.test(text)) return;        // too frequent to call in
  if (/No life signs\.$/.test(text) || !soldier || soldier.dead) return say(text, "MOTHER", "mother");
  if (/^The survivor is now following/.test(text)) return say("The survivor's with me now.", soldier.callsign, "soldier", soldier.id);
  if (/^The survivor was taken/.test(text)) return say(text, "MOTHER", "mother");
  const body = text.replace(/^Unit \d+ \([^)]*\) /, "");
  const rule = RADIO_CALLS.find(([re]) => re.test(body));
  say(rule ? body.replace(rule[0], rule[1]) : body, soldier.callsign, "soldier", soldier.id);
}

// Who a radio message is from: a unit (number or name) or the ship computer
function speakerLabel(speaker) {
  const sp = String(speaker || "").trim();
  if (/^(mother|ship|computer)$/i.test(sp)) return { who: "MOTHER", kind: "mother" };
  const unit = world && sp ? world.findUnits(sp)[0] : null;
  if (unit) return { who: unit.callsign, kind: "soldier", unit: unit.id };
  return { who: sp ? sp.toUpperCase() : "UNKNOWN", kind: "soldier" };
}

function connectBridge() {
  stream = new EventSource(`${BRIDGE_URL}/game/stream`);
  stream.onopen = () => {
    bridgeOpen = true;
    setAgentPill();
    sendBridge({ type: "status", status: fullStatus() });
  };
  stream.onerror = () => {
    bridgeOpen = false;
    agentListening = false;
    setAgentPill();
    // EventSource retries on its own unless the bridge refused us outright
    if (stream.readyState === EventSource.CLOSED) {
      stream.close();
      setTimeout(connectBridge, 5000);
    }
  };
  stream.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    if (msg.type === "agent") {
      agentListening = !!msg.listening;
      setAgentPill();
    } else if (msg.type === "radio" && typeof msg.text === "string") {
      const { who, kind, unit } = speakerLabel(msg.speaker);
      addLog(msg.text, kind, who);
      // a short, unintelligible transmission burst; shouted when it's about hostiles
      sound.radio({ kind, urgent: kind === "soldier" && isUrgent(unit, msg.text) });

    } else if (msg.type === "order" && world) {
      const results = world.order(msg.unit, msg.action, msg.target);
      sendBridge({ type: "order_result", id: msg.id, results, status: fullStatus() });
    }
  };
}
connectBridge();

if (world) {
  // Gunfire: loud from the soldier on camera, quieter and duller from the others the further away they are
  world.onFire = (soldier, times) => {
    const viewer = world.soldiers[selected];
    const d = soldier === viewer ? 0 : soldier.camera.position.distanceTo(viewer.camera.position);
    sound.gunfire(times, {
      volume: soldier === viewer ? 1 : Math.max(0.06, 0.8 / (1 + d / 4)),
      muffle: soldier === viewer ? 9000 : Math.max(500, 5000 / (1 + d / 5)),
    });
  };
  world.onEvent = (soldier, text) => {
    if (soldier && HOSTILE_EVENT.test(text)) hostileEventAt.set(soldier.id, performance.now());
    // the agent voices events; with no agent linked the soldiers (or MOTHER) call them in themselves
    if (bridgeOpen) sendBridge({ type: "event", unit: soldier ? soldier.id : null, text, status: fullStatus() });
    else radioFallback(soldier, text);
  };
  // Win or lose: the world freezes and the result shows over the camera feed
  world.onMissionEnd = ({ win, reason }) => {
    const box = $("mission-end");
    box.className = `mission-end ${win ? "won" : "lost"}`;
    $("mission-end-title").textContent = win ? "MISSION COMPLETE" : "MISSION FAILED";
    $("mission-end-text").textContent = reason.toUpperCase();
    box.hidden = false;
  };
  $("restart-btn").addEventListener("click", () => location.reload());
  addLog(`MISSION: ${world.mission.status().objective} FOLLOW THE SURVIVOR'S DISTRESS SIGNAL (SOS): IT GETS STRONGER AS YOU CLOSE IN.`, "system");
}

// ---------- Comms input ----------
// No addressee picker: the player names who they talk to ("Frost, check the medlab"), the agent works it out

$("comms-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = $("comms-input");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  addLog(text, "player", "CONTROL");
  sound.radio({ kind: "player" });
  if (!bridgeOpen) {
    addLog("NO AGENT LINK. OPEN AGENT SETUP (TOP BAR) TO CONNECT YOUR AI AGENT.", "alert");
    return;
  }
  sendBridge({ type: "player_message", to: "all", text, status: fullStatus() });
});

// ---------- Squad list / camera selection ----------
const rosterEl = $("roster");
const rosterItems = SQUAD.map((u, i) => {
  const li = document.createElement("li");
  li.innerHTML = `<input type="checkbox" class="pick" title="Select for group orders"><span>${pad(u.id)}</span><b></b>` +
    `<span class="ctl"><button type="button" data-act="hold" title="Stop and look around (press again to carry on)">HOLD</button>` +
    `<button type="button" data-act="slow" title="Move slowly and carefully">SLOW</button>` +
    `<button type="button" data-act="run" title="Run">RUN</button>` +
    `<select class="fol" title="Who this soldier follows (NONE: acts on their own)"><option value="">FOL NONE</option>` +
    SQUAD.map((o, k) => (k === i ? "" : `<option value="${k}">FOL ${o.callsign}</option>`)).join("") + `</select></span>` +
    `<span class="sos" title="Distress signal strength"><i></i><i></i><i></i><i></i><i></i></span><em></em>`;
  li.style.setProperty("--unit", u.color);
  li.querySelector("b").textContent = u.name;
  li.title = "Show this soldier's helmet camera";
  li.addEventListener("click", () => selectUnit(i));
  const pick = li.querySelector(".pick");
  pick.addEventListener("click", (e) => e.stopPropagation()); // ticking a box doesn't switch the camera
  pick.addEventListener("change", updateSelection);
  const fol = li.querySelector(".fol");
  fol.addEventListener("click", (e) => e.stopPropagation()); // choosing a leader doesn't switch the camera
  fol.addEventListener("change", () => setLeader(i, fol.value));
  li.querySelectorAll(".ctl button").forEach((btn) => btn.addEventListener("click", (e) => {
    e.stopPropagation(); // a button press doesn't switch the camera
    groupOrder(btn.dataset.act, [i]);
  }));
  rosterEl.appendChild(li);
  return li;
});

// Distress signal each soldier's detector picks up, with a little flicker; shown on the monitor and in the squad list
const sosBars = (pct) => (pct <= 0 ? 0 : Math.min(5, 1 + Math.floor(pct / 20)));
function updateDistress() {
  if (!world) return;
  world.soldiers.forEach((s, i) => {
    const pct = world.mission.signal(s);
    const shown = pct > 0 ? Math.max(1, Math.min(100, pct + Math.round(rand(-3, 3)))) : 0;
    const bars = sosBars(shown);
    rosterItems[i].querySelectorAll(".sos i").forEach((b, k) => b.classList.toggle("on", k < bars));
    if (i !== selected) return;
    const el = $("osd-sos");
    if (s.dead) el.textContent = "SOS --";
    else if (world.mission.survivor.dead) el.textContent = "SOS LOST";
    else el.textContent = `SOS ${"▮".repeat(bars)}${"▯".repeat(5 - bars)} ${String(shown).padStart(2, "0")}%`;
  });
}

// How tense things are, for the music: 0 calm .. 1 hostiles on top of the squad.
// The most stressed soldier, how close the nearest hostile is to anyone (ducts included), any hostile in view.
function gameTension() {
  if (!world || world.mission.over) return 0;
  const squad = world.soldiers.filter((s) => !s.dead);
  if (!squad.length) return 0;
  let t = Math.max(...squad.map((s) => s.stress || 0));
  let nearest = Infinity;
  for (const a of world.aliens) {
    if (a.dead) continue;
    for (const s of squad) {
      const sx = s.tx + (s.nx - s.tx) * s.progress, sy = s.ty + (s.ny - s.ty) * s.progress;
      nearest = Math.min(nearest, Math.hypot(a.x - sx, a.y - sy));
    }
  }
  t = Math.max(t, 0.85 * Math.max(0, Math.min(1, 1 - (nearest - 2) / 10)));
  if (squad.some((s) => s.visible && s.visible.length)) t = Math.max(t, 0.65);
  return t;
}

function updateRoster() {
  rosterItems.forEach((li, i) => {
    li.classList.toggle("active", i === selected);
    const order = world ? world.shortOrder(world.soldiers[i]) : "--";
    li.querySelector("em").textContent = i === selected ? `CAM ${order}` : order;
    // the buttons show the soldier's actual state, whoever gave the order (these buttons or the agent)
    const s = world && world.soldiers[i];
    const mode = s && !s.dead ? modeOf(s) : null;
    li.querySelectorAll(".ctl button").forEach((b) => {
      b.classList.toggle("on", b.dataset.act === mode);
      b.disabled = !s || s.dead || world.mission.over;
    });
    // who they follow, kept in step with the game (orders from the agent change it too); not while it's being picked
    const fol = li.querySelector(".fol");
    if (document.activeElement !== fol) fol.value = s && !s.dead && s.leader ? String(world.soldiers.indexOf(s.leader)) : "";
    fol.disabled = !s || s.dead || world.mission.over;
    for (const o of fol.options) if (o.value) o.disabled = !world || world.soldiers[+o.value].dead;
    const pick = li.querySelector(".pick");
    if (s && s.dead && !pick.disabled) { pick.checked = false; pick.disabled = true; }
  });
  updateSelection();
}

// Who a soldier follows, from the selector in their row. "" = nobody: they stop and hold until given an order.
// A follower goes wherever their leader is, however far (running to catch up), unless there's no way through.
function setLeader(i, leader) {
  if (!world || world.mission.over || world.soldiers[i].dead) return;
  const s = world.soldiers[i];
  heldFrom.delete(s); // a HOLD let go later doesn't send them back to an old leader
  const L = leader === "" ? null : SQUAD[+leader];
  const results = L ? world.order(String(s.id), "follow", String(L.id)) : world.order(String(s.id), "hold");
  const what = L ? `follow ${L.callsign}` : "stop following, hold position";
  if (!results.every((r) => r.ok)) { // e.g. that soldier is already following this one
    addLog(`${s.callsign}: ${results.map((r) => r.detail).join(" ")}`, "alert");
    updateRoster();
    return;
  }
  addLog(`${s.callsign}: ${what.toUpperCase()}`, "player", "CONTROL");
  sound.radio({ kind: "player" });
  updateRoster();
  sendBridge({
    type: "event", unit: s.id, status: fullStatus(),
    text: `CONTROL used the console: ${s.callsign} ${what} (${results.map((r) => r.detail).join(" ")}).`,
  });
}

// ---------- HOLD / SLOW / RUN ----------
// One at a time: holding, moving slow or running. None lit = moving at normal pace (the default).
// Pressing the lit one goes back to that default; HOLD let go = carry on, or rejoin the soldier they followed.
// HOLD lights only on a soldier told to hold: their followers stop behind them too, but are still "following".
function modeOf(s) {
  if (s.task.kind === "hold") return "hold";
  return s.orders.pace === "slow" ? "slow" : s.orders.pace === "fast" ? "run" : "normal";
}
const heldFrom = new Map(); // soldier -> the leader they were following before HOLD (to rejoin after)

// Puts the soldiers in one mode ("hold" | "slow" | "run" | "normal"). Returns [what CONTROL said, results].
function setMode(units, mode) {
  const ids = (list) => list.map((s) => String(s.id)).join(",");
  const results = [];
  if (mode === "hold") {
    const free = units.filter((s) => modeOf(s) !== "hold");
    free.forEach((s) => heldFrom.set(s, s.leader || null));
    if (free.length) results.push(...world.order(ids(free), "hold"), ...world.order(ids(free), "watch", "auto"));
    results.push(...world.order(ids(units), "pace", "normal"));
    return ["hold and look around", results];
  }
  // let go of HOLD: whoever holds carries on, or falls back in behind their leader
  const held = units.filter((s) => modeOf(s) === "hold");
  const rest = [];
  held.forEach((s) => {
    const leader = heldFrom.get(s);
    heldFrom.delete(s);
    if (leader && !leader.dead && !held.includes(leader)) results.push(...world.order(String(s.id), "follow", String(leader.id)));
    else rest.push(s);
  });
  if (rest.length) results.push(...world.order(ids(rest), "continue"));
  results.push(...world.order(ids(units), "pace", mode === "run" ? "fast" : mode));
  const what = { slow: "move slow", run: "run", normal: held.length ? "carry on" : "normal pace" }[mode];
  return [what, results];
}

// ---------- Group orders ----------
// The ticked soldiers get the orders from the buttons and the direction pad under the squad list
// (the buttons in each row do the same for that soldier alone).
// Same orders the agent gives; each one shows in the comms log and is reported to the agent.
const selAll = $("sel-all");
const picks = rosterItems.map((li) => li.querySelector(".pick"));
const pickedIdx = () => picks.map((p, i) => (p.checked && !p.disabled ? i : -1)).filter((i) => i >= 0);
// who the buttons order: the ticked soldiers, or with none ticked the soldier on the monitor
const targetIdx = () => {
  const idx = pickedIdx();
  if (idx.length) return idx;
  return world && !world.soldiers[selected].dead ? [selected] : [];
};
const MODES = ["hold", "slow", "run"];
// the mode every one of these soldiers is in, or null if they differ
const sharedMode = (idx) => {
  const modes = new Set(idx.map((i) => modeOf(world.soldiers[i])));
  return modes.size === 1 ? [...modes][0] : null;
};

function updateSelection() {
  const live = picks.filter((p) => !p.disabled);
  const n = pickedIdx().length;
  selAll.checked = live.length > 0 && n === live.length;
  selAll.indeterminate = n > 0 && n < live.length;
  const idx = targetIdx();
  $("sel-count").textContent = n === 0 ? (idx.length ? `${SQUAD[selected].callsign} (ON CAMERA)` : "NOBODY")
    : n === live.length ? "ALL SELECTED" : `${n} SELECTED`;
  // The group buttons are plain push buttons: they never stay lit. What they change shows on each soldier's own
  // HOLD / SLOW / RUN buttons in the list above.
  const off = !idx.length || !world || world.mission.over;
  document.querySelectorAll("#group-orders button").forEach((b) => { b.disabled = off; });
}
selAll.addEventListener("change", () => {
  picks.forEach((p) => { if (!p.disabled) p.checked = selAll.checked; });
  updateSelection();
});
document.querySelectorAll("#group-orders button").forEach((btn) =>
  btn.addEventListener("click", () => groupOrder(btn.dataset.act)));

// act -> what CONTROL says, and the world orders it takes (HOLD / SLOW / RUN go through setMode)
const GROUP_ORDERS = {
  alert: ["alert, look all around", [["alert"]]],
  inspect: ["inspect the room", [["inspect"]]],
  retreat: ["fall back", [["retreat"]]],
  together: ["regroup", [["together"]]],
  spread: ["spread out", [["spread"]]],
  north: ["head north", [["north"]]],
  south: ["head south", [["south"]]],
  east: ["head east", [["east"]]],
  west: ["head west", [["west"]]],
};

function groupOrder(act, picked = targetIdx()) {
  if (!world || world.mission.over) return;
  const idx = picked.filter((i) => !world.soldiers[i].dead);
  if (!idx.length) return;
  let what, results = [];
  if (MODES.includes(act)) {
    [what, results] = setMode(idx.map((i) => world.soldiers[i]), sharedMode(idx) === act ? "normal" : act);
  } else {
    let steps;
    [what, steps] = GROUP_ORDERS[act];
    const ids = idx.map((i) => String(SQUAD[i].id)).join(",");
    for (const [action, arg] of steps) results.push(...world.order(ids, action, arg));
  }
  const live = world.soldiers.filter((s) => !s.dead).length;
  const who = idx.length === live && live > 1 ? "ALL" : idx.map((i) => SQUAD[i].callsign).join(", ");
  addLog(`${who}: ${what.toUpperCase()}`, "player", "CONTROL");
  sound.radio({ kind: "player" });
  updateRoster();
  sendBridge({
    type: "event", unit: idx.length === 1 ? SQUAD[idx[0]].id : null, status: fullStatus(),
    text: `CONTROL used the console: ${who} ${what} (${results.map((r) => `${r.name || ""} ${r.detail}`.trim()).join(" ")}).`,
  });
}

function selectUnit(i) {
  if (i === selected && switchUntil) return;
  selected = i;
  const u = SQUAD[i];
  $("soldier-name").textContent = u.name;
  $("osd-channel").textContent = `CH-${pad(u.id)}`;
  $("vitals-name").textContent = u.name;
  $("vitals-title").textContent = `BIOMONITOR // UNIT ${pad(u.id)}`;
  $("cam-title").firstChild.textContent = `HELMET CAM // UNIT ${pad(u.id)} `;
  switchUntil = performance.now() + 350;
  updateRoster();
  updateDistress();
  updateVitals();
}
selectUnit(0);

// ---------- Ticker ----------
$("ticker").textContent =
  "▲ ALL STATIONS REPORT ▲ HULL SEALS VERIFIED ▲ EXTERIOR TEMP -164C ▲ " +
  "SURFACE WIND 120 KPH ▲ CREW EXPENDABLE CLAUSE ACTIVE ▲ AWAIT FURTHER INSTRUCTIONS ▲";

// ---------- Main loop ----------
let lastFrame = 0;
let lastFeed = 0;
let lastSlow = -Infinity;
let lastDistress = 0;

function loop(now) {
  const dt = lastFrame ? now - lastFrame : 16;
  lastFrame = now;

  // ~30 fps for the analog feed
  if (now - lastFeed > 33) {
    renderFeed(now);
    renderVitalsNoise(now);
    lastFeed = now;
  }
  if (now - lastDistress > 250) {
    lastDistress = now;
    updateDistress();
    sound.setTension(gameTension());
  }
  // clamp so a backgrounded tab doesn't teleport the soldier
  if (world && !world.mission.over) world.update(Math.min(dt, 100) / 1000);
  renderEcg(dt);
  renderMap(now);

  $("mission-time").textContent = formatHMS((now - missionStart) / 1000);

  if (now - lastSlow > 1000) {
    lastSlow = now;
    const d = new Date();
    $("ship-clock").textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    updateVitals();
    updateRoster();
    sendBridge({ type: "status", status: fullStatus() });
  }
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
