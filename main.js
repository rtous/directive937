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

// Static sound. Browsers block audio until the user interacts with the page.
const sound = createStaticAudio();
const audioBtn = $("audio-btn");
let audioStarted = false;
function refreshAudioBtn() {
  // browsers keep audio off until the first click or key press, so it shows OFF until then
  const on = audioStarted && sound.enabled;
  audioBtn.textContent = on ? "AUDIO ON" : "AUDIO OFF";
  audioBtn.classList.toggle("on", on);
}
function startAudio() {
  if (audioStarted) return;
  audioStarted = true;
  sound.start();
  refreshAudioBtn();
}
audioBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  if (!audioStarted) startAudio();
  else { sound.toggle(); refreshAudioBtn(); }
});
// Any first click or key press elsewhere on the page also turns sound on. Clicks on the audio button are left to
// its own handler: otherwise that first press would start the audio and the click would toggle it straight off.
function firstGesture(e) {
  if (e.target instanceof Node && audioBtn.contains(e.target)) return;
  startAudio();
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
// Only real messages: CONTROL, the soldiers and MOTHER (voiced by the AI agent) and game events
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
    if (!bridgeOpen) addLog("AGENT LINK ESTABLISHED", "system");
    bridgeOpen = true;
    setAgentPill();
    sendBridge({ type: "status", status: fullStatus() });
  };
  stream.onerror = () => {
    if (bridgeOpen) addLog("AGENT LINK LOST", "system");
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
      for (const r of results) {
        if (r.ok) addLog(`ORDER ${r.name}: ${r.detail}`, "system");
      }
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
    addLog(text, "system");
    sendBridge({ type: "event", unit: soldier ? soldier.id : null, text, status: fullStatus() });
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
  li.innerHTML = `<span>${pad(u.id)}</span><b></b>` +
    `<span class="ctl"><button type="button" data-act="hold" title="Stop and look around (press again to carry on)">HOLD</button>` +
    `<button type="button" data-act="slow" title="Move slowly and carefully">SLOW</button>` +
    `<button type="button" data-act="run" title="Run">RUN</button></span>` +
    `<span class="sos" title="Distress signal strength"><i></i><i></i><i></i><i></i><i></i></span><em></em>`;
  li.style.setProperty("--unit", u.color);
  li.querySelector("b").textContent = u.name;
  li.title = "Show this soldier's helmet camera";
  li.addEventListener("click", () => selectUnit(i));
  li.querySelectorAll(".ctl button").forEach((btn) => btn.addEventListener("click", (e) => {
    e.stopPropagation(); // a button press doesn't switch the camera
    quickOrder(i, btn.dataset.act);
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
    const btn = (act) => li.querySelector(`.ctl [data-act="${act}"]`);
    btn("hold").classList.toggle("on", !!s && !s.dead && s.task.kind === "hold");
    btn("slow").classList.toggle("on", !!s && !s.dead && s.orders.pace === "slow");
    btn("run").classList.toggle("on", !!s && !s.dead && s.orders.pace === "fast");
    li.querySelectorAll(".ctl button").forEach((b) => (b.disabled = !s || s.dead || world.mission.over));
  });
}

// Console buttons: quick orders straight to one soldier, reported to the agent so it knows
const heldFrom = new Map(); // soldier index -> the leader they were following before HOLD (to rejoin after)
function quickOrder(i, act) {
  if (!world || world.mission.over) return;
  const s = world.soldiers[i];
  if (s.dead) return;
  const id = String(SQUAD[i].id);
  let what, results;
  if (act === "hold") {
    if (s.task.kind === "hold") { // released: carry on, or fall back in behind the soldier they were following
      const leader = heldFrom.get(i);
      heldFrom.delete(i);
      what = "carry on";
      results = leader && !leader.dead ? world.order(id, "follow", String(leader.id)) : world.order(id, "continue");
    } else {
      heldFrom.set(i, s.leader || null);
      what = "hold and look around";
      results = [...world.order(id, "hold"), ...world.order(id, "watch", "auto")];
    }
  } else { // SLOW / RUN: only one at a time; pressing the lit one goes back to normal pace
    const want = act === "slow" ? "slow" : "fast";
    const pace = s.orders.pace === want ? "normal" : want;
    what = `pace ${pace}`;
    results = world.order(id, "pace", pace);
  }
  addLog(`${SQUAD[i].callsign}: ${what.toUpperCase()}`, "player", "CONTROL");
  updateRoster();
  sendBridge({
    type: "event", unit: SQUAD[i].id, status: fullStatus(),
    text: `CONTROL used the console: ${SQUAD[i].callsign} ${what} (${results.map((r) => r.detail).join(" ")}).`,
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
