"use strict";

// The control room: the helmet-camera CRT, the biomonitor, the tactical map, the comms log, the squad console
// and the link to the player's AI agent. Builds a world for the sector the squad is in (startSector) and runs the loop.

// ---------- Config ----------
// The squad. One AI agent (on the player's machine) commands and voices all of them.
// color: the unit's dot on the tactical map (and a hint of it in the squad console)
// female: which death scream plays (sounds/shouting_female.wav or shouting_male.wav)
const SQUAD = [
  { id: 1, name: "SGT. R. FROST", callsign: "FROST", color: "#ffa040" },
  { id: 2, name: "CPL. J. VASQUEZ", callsign: "VASQUEZ", color: "#4fd8ff", female: true },
  { id: 3, name: "PVT. W. HUDSON", callsign: "HUDSON", color: "#ff6fa8" },
  { id: 4, name: "PVT. M. DRAKE", callsign: "DRAKE", color: "#c09bff" },
];

const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, "0");
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const formatHMS = (seconds) => {
  const s = Math.floor(seconds);
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
};

// ---------- State ----------
let world = null;      // the current level's world (null if the 3D engine isn't available: static only)
let atSector = { sector: SECTORS.entry, from: null }; // the sector the squad is in, and the access it came through (null: the entry)
// where the squad came into the area it's in (sectors.js: MAP_AREAS): the sector and the access it came through
// (null: the mission's entry). If the whole squad is lost, it comes back there, all of it.
let areaEntry = { sector: SECTORS.entry, from: null };
let levelStart = 0;    // performance.now() when it started
let levelEnd = null;   // ...and when it ended (the mission clock stops)
let selected = 0;      // whose helmet camera / vitals are on screen
const soldier = (i) => world && world.soldiers[i];
const inPlay = (i) => !!world && !world.soldiers[i].dead;

// ---------- Sound ----------
// On by default. Browsers hold audio back until the user first interacts with the page, so it is started now
// (plays straight away where the browser allows it) and again on the first click or key press.
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

// ---------- CRT camera feed ----------
// The 3D frame, drawn at low resolution and scaled up, like an old analog feed: grayscale with static, a hum bar,
// streaks and a faint RF pattern. Only red light (emergency lamps) comes through as colour.
const feed = $("feed");
const fctx = feed.getContext("2d");
const W = feed.width;
const H = feed.height;
const img = fctx.createImageData(W, H);
const px = new Uint32Array(img.data.buffer);
const rowGain = new Float32Array(H);
const crt = $("crt");
const osdMsg = $("osd-msg");
const sceneCanvas = document.createElement("canvas");
sceneCanvas.width = W;
sceneCanvas.height = H;
const sctx = sceneCanvas.getContext("2d", { willReadFrequently: true });

let switchUntil = 0;  // heavy snow while changing camera channel
const streaks = [];   // bright horizontal lines
const RED_MIN = 12;   // ignore faint warm tints
const RED_GAIN = 2.2; // how strongly red light shows on the monitor

function renderFeed(now) {
  const t = now / 1000;
  const switching = now < switchUntil;
  // the camera of a soldier who is down, or out through the exit, shows nothing but snow
  const lost = !!world && !inPlay(selected);
  const burst = switching || lost;

  const streak = Math.random() < 0.08;
  if (streak) streaks.push({ y: Math.floor(rand(0, H)), life: Math.floor(rand(1, 5)), gain: rand(40, 140) });
  sound.update({ burst, crackle: streak || Math.random() < 0.04 });

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
  let scenePx = null;
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
    const jitter = Math.random() < 0.02 ? (Math.random() * 4 - 2) | 0 : 0;
    for (let x = 0; x < W; x++) {
      const wave = Math.sin(x * 0.35 + y * 0.9 + t * 9) * 5; // faint diagonal RF interference
      let pic = 0, red = 0;
      if (scenePx) {
        const sx = clamp(x + jitter, 0, W - 1);
        const si = (row + sx) * 4;
        const sr = scenePx[si], sg = scenePx[si + 1], sb = scenePx[si + 2];
        pic = (sr * 0.3 + sg * 0.59 + sb * 0.11) * signal;
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

  crt.classList.toggle("glitch", burst);
  osdMsg.classList.toggle("show", burst);
  if (burst) osdMsg.textContent = switching ? `CH-${pad(SQUAD[selected].id)}` : soldier(selected).exited ? "EXITED" : "NO SIGNAL";
}

// ---------- Biomonitor ----------
// One line under the camera: an ECG trace and the vitals of the soldier on camera, over light static.
const ecg = $("ecg");
const ectx = ecg.getContext("2d");
let ecgX = 0;
let ecgPrevY = ecg.height / 2;
let beatPhase = 0;
fitCanvas(ecg, () => { ecgX = 0; ecgPrevY = ecg.height / 2; });

const newVitals = () => SQUAD.map(() => ({
  bpm: Math.round(rand(80, 95)), resp: Math.round(rand(14, 18)),
  sys: Math.round(rand(115, 128)), dia: Math.round(rand(72, 82)), o2: 97, hp: 100,
}));
let vitals = newVitals();

// phase 0..1 within one heartbeat: P wave, QRS spike, T wave
function ecgSample(phase) {
  if (phase < 0.1) return Math.sin(phase / 0.1 * Math.PI) * 4;
  if (phase > 0.16 && phase < 0.19) return -6;
  if (phase >= 0.19 && phase < 0.23) return 28;
  if (phase >= 0.23 && phase < 0.26) return -10;
  if (phase > 0.38 && phase < 0.55) return Math.sin((phase - 0.38) / 0.17 * Math.PI) * 7;
  return 0;
}

function renderEcg(dt) {
  const flat = !!world && !inPlay(selected); // no heartbeat to show
  ectx.strokeStyle = ectx.shadowColor = "#05b669";
  ectx.shadowBlur = 4;
  ectx.lineWidth = 1.5;
  for (let i = 0; i < 2; i++) {
    beatPhase = (beatPhase + (vitals[selected].bpm / 60) * (dt / 1000) / 2) % 1;
    const y = ecg.height * 0.6 - (flat ? 0 : ecgSample(beatPhase)) * (ecg.height / 64) + rand(-0.6, 0.6);
    ectx.clearRect(ecgX, 0, 10, ecg.height); // erase just ahead of the sweep so the old trace gets overwritten
    ectx.beginPath();
    ectx.moveTo(ecgX - 1, ecgPrevY);
    ectx.lineTo(ecgX, y);
    ectx.stroke();
    ecgPrevY = y;
    ecgX = (ecgX + 1) % ecg.width;
  }
}

const vnoise = $("vitals-noise");
const vnctx = vnoise.getContext("2d");
const vimg = vnctx.createImageData(vnoise.width, vnoise.height);
const vpx = new Uint32Array(vimg.data.buffer);
function renderVitalsNoise(now) {
  const band = (now / 25) % (vnoise.height + 30) - 15; // bright interference band
  for (let i = 0; i < vpx.length; i++) {
    const y = (i / vnoise.width) | 0;
    const v = Math.min(255, Math.random() * 120 + (Math.abs(y - band) < 3 ? 80 : 0));
    vpx[i] = 0xff000000 | (v << 16) | (v << 8) | v;
  }
  vnctx.putImageData(vimg, 0, 0);
}

// Heart rate and breathing follow how hard each soldier is working (walking, running) and the danger they're in
// (hostiles close or in view, firing, fleeing: behavior.js's stress), the two adding up.
const HEART = { rest: 78, walk: 10, run: 34, danger: 75, max: 190 }; // bpm: at rest, + moving, + danger at its worst
function updateVitals() {
  vitals.forEach((v, i) => {
    const s = soldier(i);
    if (s && s.dead) return Object.assign(v, { bpm: 0, resp: 0, sys: 0, dia: 0, o2: 0, hp: s.exited ? s.hp : 0 });
    const stress = s ? s.stress : 0;
    const effort = !s || !s.moving ? 0 : s.speed > CHARACTER.runAbove ? 1 : 0.3; // still, walking, running
    const exertion = effort === 1 ? HEART.run : effort ? HEART.walk : 0;
    v.bpm = Math.round(clamp(v.bpm + (HEART.rest + exertion + stress * HEART.danger - v.bpm) * 0.4 + rand(-3, 3), 60, HEART.max));
    v.resp = Math.round(clamp(v.resp + (15 + effort * 10 + stress * 12 - v.resp) * 0.4 + rand(-1, 1), 12, 36));
    v.sys = Math.round(clamp(v.sys + rand(-2, 2), 105, 150));
    v.dia = Math.round(clamp(v.dia + rand(-1.5, 1.5), 65, 95));
    v.o2 = Math.round(rand(94, 99));
    v.hp = s ? s.hp : 100;
  });
  const v = vitals[selected];
  const s = soldier(selected);
  const show = (id, text, alert = false) => { $(id).textContent = text; $(id).classList.toggle("alert", alert); };
  if (s && s.exited) { // out of the level: no telemetry, but not a death
    ["bpm", "o2", "bp", "resp", "hp"].forEach((id) => show(id, "--"));
    return show("vstatus", "EXITED");
  }
  const dead = !!s && s.dead;
  const stressed = v.bpm > 120 || v.o2 < 95;
  show("bpm", v.bpm, v.bpm > 120);
  show("o2", v.o2, v.o2 < 95);
  show("bp", `${v.sys}/${v.dia}`);
  show("resp", v.resp);
  show("hp", v.hp, v.hp <= 30);
  show("vstatus", dead ? "NO LIFE" : v.hp <= 30 ? "CRITICAL" : stressed ? "STRESS" : "STABLE", dead || stressed || v.hp <= 30);
}

// ---------- Tactical map ----------
const tacMap = createTacticalMap($("map"), { colors: SQUAD.map((u) => u.color), onWave: () => sound.beep() });

// ---------- Comms log ----------
// Only what is said on the radio: CONTROL (the player), the soldiers and MOTHER (voiced by the AI agent).
// Game events and order results go to the agent, not here; with no agent linked, radioFallback calls them in.
const logEl = $("log");

// kind: "alert" | "player" | "soldier" | "mother" | "system"
function addLog(text, kind, who = "") {
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

// A radio message (logged, with its transmission burst)
function say(text, kind, who, unit) {
  addLog(text, kind, who);
  sound.radio({ kind, urgent: kind === "soldier" && isUrgent(unit, text) });
}

// Urgent radio calls (shouted): the soldier just had a hostile event, or the message sounds like an alarm
const hostileEventAt = new Map(); // unit id -> time of their last hostile-related event
const HOSTILE_EVENT = /CONTACT|CHARGING|CEILING VENT|MOTION TRACKER|INSTINCT|TAKEN BY|LOST SIGHT|OVERWHELMED|GIANT/i;
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
  [/^brought down THE GIANT in (.*)!/, "The big one's down! It's dead, in $1!"],
  [/^HIT BY THE GIANT, health (\d+)\..*/, "It got me! Health $1! Stay out of its reach!"],
  [/^badly wounded, health (\d+)\./, "I'm hit bad! Health $1."],
  [/^arrived at (.*)\. Holding\./, "In position at $1. Holding."],
  [/^reached the furthest point (\w+) it can get to, in (.*)\. Holding\./, "Can't go any further $1. Holding in $2."],
  [/^has no route to (.*)\. Holding\./, "No way through to $1. Holding."],
  [/^has nowhere to retreat to\. Holding\./, "Nowhere to fall back to. Holding."],
  [/^all-round check done, (.*)\. Back to: (.*)\./, "All around clear: $1. Back to $2."],
  [/^finished inspecting (.*): (.*)\. Holding\./, "$1 checked: $2. Holding."],
  [/^sealed door (\w+) .*/, "Door $1 sealed. Nothing's getting through there now."],
  [/^cut door (\w+) open .*/, "Door $1 is open again. Watch it, they can use it too."],
  [/^has no route to door (\w+)\. Holding\./, "Can't get to door $1. Holding."],
  [/^stopped at sealed door (\w+) .*/, "Sealed door $1 in the way. Waiting here: it needs cutting open."],
];
function radioFallback(s, text) {
  if (/^(SECTOR CLEARED|SQUAD LOST|MISSION COMPLETE)/.test(text)) return; // in the log already, or over the camera feed
  if (/ entering .* while /.test(text)) return;        // too frequent to call in
  // deaths, soldiers leaving through the exit, anything without a soldier able to speak: MOTHER
  if (!s || s.dead) return say(text, "mother", "MOTHER");
  const body = text.replace(/^Unit \d+ \([^)]*\) /, "");
  const rule = RADIO_CALLS.find(([re]) => re.test(body));
  say(rule ? body.replace(rule[0], rule[1]) : body, "soldier", s.callsign, s.id);
}

// Who a radio message from the agent is from: a unit (number or name) or the ship computer
function speakerLabel(speaker) {
  const sp = String(speaker || "").trim();
  if (/^(mother|ship|computer)$/i.test(sp)) return { who: "MOTHER", kind: "mother" };
  const unit = world && sp ? world.findUnits(sp)[0] : null;
  if (unit) return { who: unit.callsign, kind: "soldier", unit: unit.id };
  return { who: sp ? sp.toUpperCase() : "UNKNOWN", kind: "soldier" };
}

// ---------- Agent link ----------
// The player's AI agent runs bridge.mjs on their own machine (see agent.html). The browser connects to it on
// localhost, so this works even when the game page itself comes from a remote server.
// bridge -> game: Server-Sent Events. game -> bridge: POST.
// The game only reaches for the bridge once the player presses LINK AGENT (connecting to localhost can make the
// browser ask for permission, which players without an agent shouldn't see). The choice is remembered, so a
// reload links again by itself; UNLINK forgets it.
const BRIDGE_URL = (new URLSearchParams(location.search).get("bridge") || "http://127.0.0.1:8937").replace(/\/$/, "");
const LINK_KEY = "directive937.agentLink";
const agentPill = $("agent-pill");
const linkBtn = $("link-btn");
let stream = null;
let bridgeOpen = false;
let agentListening = false;
let wantLink = false;
let retryTimer = null;

function setAgentPill() {
  linkBtn.textContent = wantLink ? "UNLINK" : "LINK AGENT";
  linkBtn.classList.toggle("on", wantLink);
  linkBtn.title = wantLink ? "Disconnect from your AI agent" : "Connect to your AI agent (start it first: see AGENT SETUP)";
  // linked but not listening: the agent is thinking, or its loop isn't running
  const [text, cls] = !wantLink ? ["OFFLINE", ""] : !bridgeOpen ? ["CONNECTING", "busy"]
    : agentListening ? ["STANDING BY", "listening"] : ["LINKED", "linked"];
  agentPill.textContent = `AGENT: ${text}`;
  agentPill.className = `status-pill agent-pill ${cls}`;
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

// Status sent to the agent: every unit's position, orders and surroundings, plus vitals
function fullStatus() {
  if (!world) return null;
  const st = world.status();
  st.units.forEach((u, i) => {
    u.vitals = { heart_rate: vitals[i].bpm, spo2: vitals[i].o2, resp: vitals[i].resp };
  });
  st.on_camera = SQUAD[selected].id;
  return st;
}
const sendEvent = (text, unit = null) => sendBridge({ type: "event", unit, text, status: fullStatus() });

function connectBridge() {
  if (!wantLink) return;
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
    if (stream && stream.readyState === EventSource.CLOSED) {
      stream.close();
      stream = null;
      retryTimer = setTimeout(connectBridge, 5000);
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
      say(msg.text, kind, who, unit);
    } else if (msg.type === "order" && world) {
      const results = world.order(msg.unit, msg.action, msg.target);
      sendBridge({ type: "order_result", id: msg.id, results, status: fullStatus() });
    }
  };
}

function linkAgent(on) {
  wantLink = on;
  try { if (on) localStorage.setItem(LINK_KEY, "1"); else localStorage.removeItem(LINK_KEY); } catch {}
  clearTimeout(retryTimer);
  if (on) {
    if (!stream) connectBridge();
  } else {
    if (stream) stream.close();
    stream = null;
    bridgeOpen = false;
    agentListening = false;
  }
  setAgentPill();
}
linkBtn.addEventListener("click", () => linkAgent(!wantLink));

// ---------- Comms input ----------
// No addressee picker: the player names who they talk to ("Frost, check the medlab"), the agent works it out
$("comms-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = $("comms-input");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  say(text, "player", "CONTROL");
  if (!bridgeOpen) {
    addLog(wantLink
      ? "AGENT NOT CONNECTED YET. IS IT RUNNING? SEE AGENT SETUP (TOP BAR)."
      : "NO AGENT LINK. START YOUR AI AGENT (SEE AGENT SETUP), THEN PRESS LINK AGENT (TOP BAR).", "alert");
    return;
  }
  sendBridge({ type: "player_message", to: "all", text, status: fullStatus() });
});

// ---------- Squad console ----------
// Big buttons beside the monitor pick whose helmet camera is on screen, and show each soldier's state.
// Under the biomonitor, a chip per soldier ticks them for orders; the order buttons, the FOLLOW selector and the
// direction pad then order the ticked soldiers (with none ticked, the one on camera). These are the same orders
// the agent gives: each one shows in the comms log and is reported to the agent.
const camButtons = SQUAD.map((u, i) => {
  const b = document.createElement("button");
  b.type = "button";
  b.style.setProperty("--unit", u.color);
  b.innerHTML = `<span class="cs-id">${pad(u.id)}</span><b></b><em></em>` +
    `<span class="cs-tags"><i class="cs-mode"></i><i class="cs-fol"></i></span>`;
  b.querySelector("b").textContent = u.callsign;
  b.title = `${u.name}: show helmet camera`;
  b.addEventListener("click", () => selectUnit(i));
  $("cam-select").appendChild(b);
  return b;
});

const picks = SQUAD.map((u) => {
  const li = document.createElement("li");
  li.innerHTML = `<input type="checkbox" class="pick" title="Select for orders"><span>${pad(u.id)}</span><b></b>`;
  li.style.setProperty("--unit", u.color);
  li.querySelector("b").textContent = u.callsign;
  li.title = `${u.name}: tick to give orders`;
  const pick = li.querySelector(".pick");
  li.addEventListener("click", (e) => { // the whole chip ticks the box
    if (e.target === pick || pick.disabled) return;
    pick.checked = !pick.checked;
    updateSelection();
  });
  pick.addEventListener("change", updateSelection);
  $("roster").appendChild(li);
  return pick;
});
const selAll = $("sel-all");
const followSel = $("go-follow");
const orderButtons = [...document.querySelectorAll("#group-orders button")];

// HOLD / SLOW / RUN: one at a time; none lit = moving at normal pace (the default). Pressing the lit one goes back
// to that default; HOLD let go = carry on, or rejoin the soldier they followed. HOLD lights only on a soldier told
// to hold: their followers stop behind them too, but are still "following".
const MODES = ["hold", "slow", "run"];
function modeOf(s) {
  if (s.task.kind === "hold") return "hold";
  return s.orders.pace === "slow" ? "slow" : s.orders.pace === "fast" ? "run" : "normal";
}
const heldFrom = new Map(); // soldier -> the leader they were following before HOLD (to rejoin after)

// Who the console orders: the ticked soldiers, or with none ticked the one on camera
const pickedIdx = () => picks.map((p, i) => (p.checked && !p.disabled ? i : -1)).filter((i) => i >= 0);
const targetIdx = () => {
  const idx = pickedIdx();
  return idx.length ? idx : inPlay(selected) ? [selected] : [];
};
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
  const off = !world || !idx.length || world.mission.over;
  orderButtons.forEach((b) => { b.disabled = off; });
  followSel.disabled = off;
  // HOLD / SLOW / RUN light up while every one of them is in that mode (whoever gave the order: buttons or agent)
  const mode = off ? null : sharedMode(idx);
  orderButtons.forEach((b) => b.classList.toggle("on", MODES.includes(b.dataset.act) && b.dataset.act === mode));
  if (!off) updateSealButton(idx);
  for (const o of followSel.options) if (o.value !== "-" && o.value !== "") o.disabled = !inPlay(+o.value);
}

// The camera buttons and chips follow each soldier's state
function updateSquad() {
  if (world) SQUAD.forEach((u, i) => {
    const s = world.soldiers[i];
    const cb = camButtons[i];
    cb.classList.toggle("active", i === selected);
    cb.classList.toggle("dead", s.dead && !s.exited);
    cb.classList.toggle("out", !!s.exited);
    cb.querySelector("em").textContent = s.exited ? "EXITED" : s.dead ? "NO SIGNAL" : `HP ${s.hp}`;
    // how they move (HOLD / SLOW / RUN; nothing at normal pace) and who they follow
    const job = !s.dead && s.task.kind === "seal" ? s.task : null; // welding a door shut, or cutting one open
    const mode = s.dead ? "normal" : job ? "weld" : modeOf(s);
    const modeTag = cb.querySelector(".cs-mode");
    modeTag.textContent = job ? (job.cut ? `CUT ${Math.round((1 - job.door.seal) * 100)}%` : `WELD ${Math.round(job.door.seal * 100)}%`)
      : mode === "normal" ? "" : mode.toUpperCase();
    modeTag.dataset.mode = mode;
    cb.querySelector(".cs-fol").textContent = !s.dead && s.leader ? `FOL ${s.leader.callsign}` : "";
    if (s.dead && !picks[i].disabled) { picks[i].checked = false; picks[i].disabled = true; }
  });
  updateSelection();
}

// What CONTROL did on the console: in the comms log, a radio burst, and an event for the agent
function reportConsole(who, what, results, unit = null) {
  say(`${who}: ${what.toUpperCase()}`, "player", "CONTROL");
  updateSquad();
  sendEvent(`CONTROL used the console: ${who} ${what} (${results.map((r) => `${r.name || ""} ${r.detail}`.trim()).join(" ")}).`, unit);
}

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

// act -> [what CONTROL says, the world order] (HOLD / SLOW / RUN go through setMode)
const GROUP_ORDERS = {
  alert: ["alert, look all around", "alert"],
  getout: ["get out of there, to the nearest corridor", "getout"],
  north: ["head north", "north"],
  south: ["head south", "south"],
  east: ["head east", "east"],
  west: ["head west", "west"],
};

// SEAL / UNSEAL is one soldier's job: the one on camera if they're among the ordered, else the first group
// leader among them, else the first of them. It works on the door nearest that soldier: a sealed one gets cut
// open, any other gets welded. Returns { i, door, job } (door null: no door they can reach).
function doorJob(idx) {
  const leaders = idx.filter((i) => { const L = world.soldiers[i].leader; return !L || !idx.includes(world.soldiers.indexOf(L)); });
  const i = idx.includes(selected) ? selected : (leaders[0] ?? idx[0]);
  const door = world.nearestDoor(i);
  return { i, door, job: door && door.sealed ? "unseal" : "seal" };
}
const sealBtn = document.querySelector('#group-orders [data-act="seal"]');
function updateSealButton(idx) {
  const { door, job } = idx.length ? doorJob(idx) : { door: null, job: "seal" };
  sealBtn.title = door ? `${job === "seal" ? "Weld" : "Cut open"} door ${door.id} (${door.where}), the nearest one: ` +
    `${job === "seal" ? "20" : "15"} s, one soldier (the one on camera if ticked, else a group leader)` : "No door within reach";
  if (!door) sealBtn.disabled = true;
}

function groupOrder(act) {
  if (!world || world.mission.over) return;
  let idx = targetIdx();
  if (!idx.length) return;
  let what, results;
  if (act === "seal") {
    const { i, door, job } = doorJob(idx);
    if (!door) return;
    idx = [i];
    what = `${job} door ${door.id}`;
    results = world.order(String(SQUAD[i].id), job, door.id);
  } else if (MODES.includes(act)) {
    [what, results] = setMode(idx.map((i) => world.soldiers[i]), sharedMode(idx) === act ? "normal" : act);
  } else {
    [what] = GROUP_ORDERS[act];
    results = world.order(idx.map((i) => String(SQUAD[i].id)).join(","), GROUP_ORDERS[act][1]);
  }
  const live = SQUAD.filter((u, i) => inPlay(i)).length;
  const who = idx.length === live && live > 1 ? "ALL" : idx.map((i) => SQUAD[i].callsign).join(", ");
  reportConsole(who, what, results, idx.length === 1 ? SQUAD[idx[0]].id : null);
}

// Who a soldier follows, from the FOLLOW selector. "" = nobody: they stop and hold until given an order.
// A follower goes wherever their leader is, however far (running to catch up), unless there's no way through.
function setLeader(i, leader) {
  if (!world || world.mission.over || !inPlay(i)) return;
  const s = world.soldiers[i];
  heldFrom.delete(s); // a HOLD let go later doesn't send them back to an old leader
  const L = leader === "" ? null : SQUAD[+leader];
  const results = L ? world.order(String(s.id), "follow", String(L.id)) : world.order(String(s.id), "hold");
  if (!results.every((r) => r.ok)) { // e.g. that soldier is already following this one
    addLog(`${s.callsign}: ${results.map((r) => r.detail).join(" ")}`, "alert");
    return updateSquad();
  }
  reportConsole(s.callsign, L ? `follow ${L.callsign}` : "stop following, hold position", results, s.id);
}

followSel.innerHTML = `<option value="-">FOLLOW…</option><option value="">FOLLOW NOBODY</option>` +
  SQUAD.map((o, k) => `<option value="${k}">FOLLOW ${o.callsign}</option>`).join("");
followSel.addEventListener("change", () => { // a one-shot order: it goes back to its label once used
  const v = followSel.value;
  followSel.value = "-";
  if (v !== "-") targetIdx().forEach((i) => { if (String(i) !== v) setLeader(i, v); });
});
selAll.addEventListener("change", () => {
  picks.forEach((p) => { if (!p.disabled) p.checked = selAll.checked; });
  updateSelection();
});
orderButtons.forEach((btn) => btn.addEventListener("click", () => groupOrder(btn.dataset.act)));

function selectUnit(i, force = false) {
  if (i === selected && !force) return;
  selected = i;
  const u = SQUAD[i];
  $("soldier-name").textContent = u.name;
  $("osd-channel").textContent = `CH-${pad(u.id)}`;
  $("vitals-name").textContent = u.name;
  $("vitals-title").textContent = `UNIT ${pad(u.id)}`;
  $("cam-title").firstChild.textContent = `HELMET CAM // UNIT ${pad(u.id)} `;
  switchUntil = performance.now() + 350;
  updateSquad();
  updateVitals();
}

// ---------- Sectors ----------
// The squad moves across the sectors of the world map (sectors.js), one at a time. Whoever goes through an access
// arrives in the neighbouring sector, at the matching access, with the health they had; the others are lost. If
// the whole squad is lost, it can start again, all four at full health, in the sector where it came into the
// area (MAP_AREAS) it's in.

// ---------- The comms log's own lines ----------
// What the player reads: grunt talk, short, rude and sarcastic. The agent gets the plain facts (sendEvent).
const pickOne = (lines) => lines[Math.floor(Math.random() * lines.length)];
const capital = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const names = (list) => (list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}` : list[0] || "");

// Arriving in a sector. how: null (from the sector before), "start" (a new mission) or "regroup" (a fresh squad
// after the last one was lost). newArea: the sector is in another area than the one before.
function arrivalLine(level, from, newArea, how) {
  const sector = level.name; // "SECTOR D8"
  const where = level.start ? `the ${level.start}` : "some stinking corridor";
  const area = areaOf(...level.sector)?.name || "this dump";
  if (how === "regroup") {
    return from
      ? pickOne([
        `Fresh meat, listen up. You're in ${sector}, ${where}, right where the last bunch walked into ${area}. Try not to end up like them.`,
        `New squad, same shitty job. ${sector}, ${where}: the way into ${area}. The last guys are still in there somewhere. In pieces.`,
        `Back at ${sector}, ${where}, boots on the ground. ${area} already ate one squad. Don't be dessert.`,
      ])
      : `Fresh meat, back at the entry to ${sector}. The last squad didn't make it. Keep your eyes peeled.`;
  }
  if (!from) return `OK guys, you're at the entry to ${sector}, on the edge of the complex. Keep your eyes peeled.`;
  const U = from.toUpperCase();
  const intro = pickOne([
    `Alright, you're through the ${U} access into ${sector}. You're in ${where}.`,
    `${sector}, ladies. In through the ${U} access, standing in ${where}.`,
    `Welcome to ${sector}, through the ${U} access. ${capital(where)}. Lovely.`,
  ]);
  const outro = newArea
    ? pickOne([
      `This is ${area} now. New neighbourhood, same shit.`,
      `You just walked into ${area}. Nobody's been in here for a long time. Nobody alive, anyway.`,
      `${area}. Command swears it's quiet. Command also swore the last place was quiet.`,
    ])
    : pickOne([
      "Same shit, different sector. Stay frosty.",
      "Check your corners and don't bunch up.",
      "Nobody gets cute. Eyes up, fingers off the trigger till you've got something to shoot.",
      "Keep it tight and keep it quiet. Anything moves that isn't us, you light it up.",
    ]);
  return `${intro} ${outro}`;
}

// Through an access: who made it, who didn't
function clearedLine(out, lost, to) {
  if (!lost.length) {
    return pickOne([
      `Everybody's through to ${to}. Move, move, move!`,
      `All present and accounted for. On to ${to}, people.`,
      `Whole squad made it to ${to}. Don't let it go to your heads.`,
    ]);
  }
  return `${names(out)} made it through to ${to}. ${names(lost)} didn't. ` +
    pickOne([`Poor bastard${lost.length > 1 ? "s" : ""}. Keep moving.`, "No time to mourn. Move it.", "Tag 'em and leave 'em. Eyes front."]);
}

// Build the world for a sector and reset everything that belongs to it. from: the access (direction) the squad
// comes in through, null at the entry. carry: who comes in, as above. how: "regroup" for a fresh squad after the
// last one was lost (only changes what the comms log says).
function startSector([sx, sy], from = null, carry = null, how = null) {
  if (world) world.dispose();
  // a new area (or the mission's entry): this is where the squad comes back if it's all lost
  const area = areaOf(sx, sy);
  const newArea = area !== areaOf(...atSector.sector);
  if (!from || newArea) areaEntry = { sector: [sx, sy], from };
  atSector = { sector: [sx, sy], from };
  const level = sectorLevel(sx, sy, from);
  $("level-name").textContent = level.name;
  try {
    world = window.THREE ? createWorld(W, H, SQUAD, level, carry) : null;
  } catch (err) { // e.g. no WebGL: the monitors show static only
    console.error("3D world not available:", err);
    world = null;
  }
  levelStart = performance.now();
  levelEnd = null;
  vitals = newVitals();
  heldFrom.clear();
  picks.forEach((p) => { p.checked = false; p.disabled = false; });
  $("mission-end").hidden = true;
  tacMap.setWorld(world);
  selectUnit(Math.max(0, world ? world.soldiers.findIndex((s) => !s.dead) : 0), true); // someone who's here
  if (!world) return;

  // Gunfire: loud from the soldier on camera, quieter and duller from the others the further away they are
  world.onFire = (s, times) => {
    const viewer = world.soldiers[selected];
    const d = s === viewer ? 0 : s.camera.position.distanceTo(viewer.camera.position);
    sound.gunfire(times, {
      volume: s === viewer ? 1 : Math.max(0.06, 0.8 / (1 + d / 4)),
      muffle: s === viewer ? 9000 : Math.max(500, 5000 / (1 + d / 5)),
    });
  };
  // A soldier killed: their scream, as loud and clear as their gunfire would be from where the camera is
  world.onSoldierDown = (s) => {
    const viewer = world.soldiers[selected];
    const d = s === viewer ? 0 : s.camera.position.distanceTo(viewer.camera.position);
    const female = !!(SQUAD.find((u) => u.id === s.id) || {}).female;
    sound.scream(female ? "female" : "male", {
      volume: s === viewer ? 1 : Math.max(0.15, 0.9 / (1 + d / 6)),
      muffle: s === viewer ? 12000 : Math.max(800, 6000 / (1 + d / 6)),
    });
  };
  // The agent voices events; with no agent linked the soldiers (or MOTHER) call them in themselves
  world.onEvent = (s, text) => {
    if (s && HOSTILE_EVENT.test(text)) hostileEventAt.set(s.id, performance.now());
    if (bridgeOpen) sendEvent(text, s ? s.id : null);
    else radioFallback(s, text);
  };
  world.onMissionEnd = endSector;

  const objective = world.mission.status().objective;
  const lost = world.soldiers.filter((s) => s.dead).map((s) => s.callsign);
  const squad = `${world.mission.total} of ${SQUAD.length} in the squad${lost.length ? ` (lost earlier: ${lost.join(", ")})` : ""}.`;
  addLog(arrivalLine(level, from, newArea, how), "system");
  sendEvent(`New sector: ${level.name}. ${level.briefing} ${squad} They are ${level.start ? `in the ${level.start}` : "in a corridor"}. ${objective} ` +
    "The map is new: see colony_map, doors and mission.accesses in the status.");
}

// Nobody left inside. Through an access: straight on to that sector, arriving at its matching access (the camera
// switching channel is the only pause). Everyone dead: the world freezes and SQUAD LOST shows over the camera feed.
function endSector({ win, victory, reason, exit }) {
  levelEnd = performance.now();
  if (victory) { // THE GIANT is dead: the mission is won
    $("mission-end").className = "mission-end won";
    $("mission-end-title").textContent = "MISSION COMPLETE";
    $("mission-end-text").textContent = reason.toUpperCase();
    $("restart-btn").hidden = true;
    $("new-btn").hidden = false;
    $("mission-end").hidden = false;
    return;
  }
  if (win) {
    const carry = world.soldiers.map((s) => ({ alive: !!s.exited, hp: s.hp, pace: s.orders.pace })); // pace: SLOW / RUN kept
    const { out, lost } = world.mission.status();
    addLog(clearedLine(out, lost, `sector ${exit.toName}`), "system");
    // after this frame's world update has finished with the old world
    setTimeout(() => startSector(exit.to, DIR[exit.dir].back, carry), 0);
    return;
  }
  $("mission-end").className = "mission-end lost";
  $("restart-btn").hidden = false;
  $("mission-end-title").textContent = "SQUAD LOST";
  const back = sectorName(...areaEntry.sector), area = areaOf(...areaEntry.sector)?.name || "this dump";
  $("mission-end-text").textContent = ("Nobody made it out. That's the whole squad in body bags. " + (areaEntry.from
    ? `Fresh bodies go in at ${back}, where the last bunch walked into ${area}.`
    : `Fresh bodies go in at the entry, ${back}.`)).toUpperCase();
  $("restart-btn").textContent = `REGROUP AT ${back}`;
  $("new-btn").hidden = !areaEntry.from; // already back at the mission's entry: the same thing
  $("mission-end").hidden = false;
}
// the whole squad again, at full health, in the sector where it came into this area
$("restart-btn").addEventListener("click", () => startSector(areaEntry.sector, areaEntry.from, null, "regroup"));
$("new-btn").addEventListener("click", () => startSector(SECTORS.entry));

// The whole complex, as a paper map (papermap.js)
const paperMap = createPaperMap($("paper-map"), { currentSector: () => atSector.sector });
$("map-btn").addEventListener("click", () => paperMap.open());

// ---------- Main loop ----------
$("ticker").textContent =
  "▲ ALL STATIONS REPORT ▲ HULL SEALS VERIFIED ▲ EXTERIOR TEMP -164C ▲ " +
  "SURFACE WIND 120 KPH ▲ CREW EXPENDABLE CLAUSE ACTIVE ▲ AWAIT FURTHER INSTRUCTIONS ▲";

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
      const [sx, sy] = unitPos(s);
      nearest = Math.min(nearest, Math.hypot(a.x - sx, a.y - sy));
    }
  }
  t = Math.max(t, 0.85 * clamp(1 - (nearest - 2) / 10, 0, 1));
  if (squad.some((s) => s.visible.length)) t = Math.max(t, 0.65);
  return t;
}

let lastFrame = 0, lastFeed = 0, lastQuarter = 0, lastSecond = -Infinity;
let lastError = "";
// The next frame is asked for first, and an error in one frame is reported rather than stopping the game for good
function loop(now) {
  requestAnimationFrame(loop);
  try {
    frame(now);
  } catch (err) {
    console.error(err);
    const msg = String(err && err.message || err);
    if (msg !== lastError) { lastError = msg; addLog(`SYSTEM ERROR: ${msg} (see the browser console)`, "alert"); }
  }
}

function frame(now) {
  const dt = lastFrame ? now - lastFrame : 16;
  lastFrame = now;

  // clamp so a backgrounded tab doesn't teleport the soldiers
  if (world && !world.mission.over) world.update(Math.min(dt, 100) / 1000);
  if (now - lastFeed > 33) { // ~30 fps for the analog feed
    lastFeed = now;
    renderFeed(now);
    renderVitalsNoise(now);
  }
  renderEcg(dt);
  tacMap.draw(now, selected);
  $("mission-time").textContent = formatHMS(((levelEnd ?? now) - levelStart) / 1000);
  if (world) {
    const s = world.soldiers[selected];
    $("map-coords").textContent = `U${pad(s.id)} X${pad(s.tx)} Y${pad(s.ty)}`;
  }

  if (now - lastQuarter > 250) {
    lastQuarter = now;
    if (world) $("osd-out").textContent = `OUT ${world.mission.out.length}/${world.mission.total}`;
    sound.setTension(gameTension());
  }
  if (now - lastSecond > 1000) {
    lastSecond = now;
    const d = new Date();
    $("ship-clock").textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    updateVitals();
    updateSquad();
    sendBridge({ type: "status", status: fullStatus() });
  }
}

// ---------- Start ----------
let linkedBefore = false;
try { linkedBefore = localStorage.getItem(LINK_KEY) === "1"; } catch {}
linkAgent(linkedBefore);
startSector(SECTORS.entry);
requestAnimationFrame(loop);
