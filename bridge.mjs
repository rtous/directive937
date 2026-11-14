#!/usr/bin/env node
// Aliens: USCMC bridge: links the game (in the browser) to an AI agent on the same machine.
// Single file, no dependencies, Node 18+. Served by the game server so a pasted prompt can fetch it.
//
//   game (browser)  --HTTP/SSE-->  bridge (127.0.0.1:8937)  <--CLI--  agent (e.g. Claude Code)
//
// Agent commands (each prints JSON):
//   node bridge.mjs start [--origin URL]... [--allow-file]   start in the background
//   node bridge.mjs wait [seconds]                            wait for the next transmission
//   node bridge.mjs order <who> <order> [argument...]         give soldiers an order (see ORDERS below)
//   node bridge.mjs radio <speaker> <message...>              speak as a unit or as MOTHER
//   node bridge.mjs status                                    current state of every unit
//   node bridge.mjs stop                                      shut the bridge down
//
// Security: game endpoints only accept pages from allowed origins (so other websites can't send
// prompts to the agent); agent endpoints need a token stored in ~/.directive937 and refuse browsers.

import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const VERSION = "0.3.0";
const HOME_DIR = process.env.DIRECTIVE937_HOME || path.join(os.homedir(), ".directive937");
const CONFIG_FILE = path.join(HOME_DIR, "bridge.json");
const LOG_FILE = path.join(HOME_DIR, "bridge.log");
const DEFAULT_PORT = Number(process.env.DIRECTIVE937_PORT || 8937);
// Orders the game understands (it also accepts a few synonyms and explains any mistake)
const ORDERS = `  who: 1-4, a soldier's name, alpha / bravo (teams after a split), all, or a list like 1,3
  TASKS (what to do now; replaces the previous task)
    patrol                      patrol freely, room by room (default)
    patrol <room>               patrol inside one room
    goto <room> | goto <x> <y>  go to a room or a grid position
    north|south|east|west       travel as far as possible that way
    hold                        stay where you are
    alert                       stop and look all around for 5 s, then carry on
    inspect [room]              check a room (default: the current/nearest) spot by spot, then hold
    retreat [room]              run from known hostiles (or to a room), then hold
    follow <unit>               follow another soldier
    getout                      each one stops following anyone and runs to the nearest corridor, then holds
    seal [door]                 weld a door shut (D1.., a room, x y, or the nearest): 20 s, one soldier
    unseal [door]               cut a sealed door open again (also: unweld, cut): 15 s, one soldier
    continue                    resume the previous task
  SQUAD SHAPE
    together                    the named units regroup behind the lowest-numbered one
    split                       two teams: ALPHA (1 leads 2) and BRAVO (3 leads 4)
    spread                      fan out across the current room and act independently
  STANDING ORDERS (kept until changed)
    pace slow|normal|fast
    fire free|hold
    contact engage|hold|retreat what to do on seeing a hostile
    pursue on|off               chase hostiles that slip out of view
    watch auto|front|rear|<direction incl. north-east>|center|<room>|<x y>   lapses to auto a few seconds after moving
    reset                       standing orders back to default`;
const NEEDS_ARGUMENT = ["goto", "follow", "pace", "fire", "contact", "pursue", "watch"];

// ======================= Server =======================

function serve({ port, origins, allowFile }) {
  fs.mkdirSync(HOME_DIR, { recursive: true });
  const token = crypto.randomBytes(24).toString("hex");
  const allowed = new Set(origins);

  const streams = new Set();   // open SSE connections to game pages
  const queue = [];            // transmissions not yet picked up by the agent
  const waiters = [];          // agent `wait` calls currently blocked
  const pendingOrders = new Map();
  let lastStatus = null;
  let seq = 0;

  const log = (...a) => fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${a.join(" ")}\n`);

  function originAllowed(origin) {
    if (!origin) return true; // not a browser
    if (origin === "null") return allowFile; // file:// pages (also sandboxed iframes, hence opt-in)
    if (allowed.has(origin)) return true;
    try {
      const { hostname } = new URL(origin);
      return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
    } catch {
      return false;
    }
  }

  function push(msg) {
    const data = `data: ${JSON.stringify(msg)}\n\n`;
    for (const res of streams) res.write(data);
  }
  const pushAgentState = () => push({ type: "agent", listening: waiters.length > 0 });

  function deliver(t) {
    const w = waiters.shift();
    if (w) { w([t]); pushAgentState(); } else queue.push(t);
  }

  const json = (res, code, body, headers = {}) => {
    res.writeHead(code, { "Content-Type": "application/json", ...headers });
    res.end(JSON.stringify(body));
  };

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on("data", (c) => {
        size += c.length;
        if (size > 64 * 1024) { reject(new Error("too large")); req.destroy(); } else chunks.push(c);
      });
      req.on("end", () => {
        try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}); } catch (e) { reject(e); }
      });
    });
  }

  // ---------- game endpoints ----------
  function handleGame(req, res, url) {
    const origin = req.headers.origin;
    if (!originAllowed(origin)) {
      log("rejected origin", origin);
      return json(res, 403, { error: "origin not allowed", origin });
    }
    const cors = origin ? {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Private-Network": "true",
      Vary: "Origin",
    } : {};

    if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }

    if (url.pathname === "/game/stream" && req.method === "GET") {
      res.writeHead(200, { ...cors, "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
      res.write("retry: 3000\n\n");
      res.write(`data: ${JSON.stringify({ type: "agent", listening: waiters.length > 0 })}\n\n`);
      streams.add(res);
      const ping = setInterval(() => res.write(": ping\n\n"), 15000);
      log("game connected", origin || "-");
      req.on("close", () => { clearInterval(ping); streams.delete(res); log("game disconnected"); });
      return;
    }

    if (url.pathname === "/game/message" && req.method === "POST") {
      return readBody(req).then((m) => {
        if (m.status) lastStatus = m.status;
        const clip = (s) => String(s).slice(0, 500);
        if (m.type === "player_message" && m.text) {
          deliver({ from: "player", to: m.to || "all", text: clip(m.text) });
        } else if (m.type === "event" && m.text) {
          deliver({ from: "game", unit: m.unit ?? null, text: clip(m.text) });
        } else if (m.type === "order_result") {
          const p = pendingOrders.get(m.id);
          if (p) { pendingOrders.delete(m.id); p(m); }
        }
        json(res, 200, { ok: true }, cors);
      }).catch(() => json(res, 400, { error: "bad request" }, cors));
    }
    json(res, 404, { error: "not found" }, cors);
  }

  // ---------- agent endpoints ----------
  async function handleAgent(req, res, url) {
    if (req.headers.origin) return json(res, 403, { error: "agent API is not available to web pages" });
    if (req.headers["x-directive937-token"] !== token) return json(res, 401, { error: "bad token" });
    let body;
    try { body = await readBody(req); } catch { return json(res, 400, { error: "bad request" }); }
    const gameLinked = streams.size > 0;
    const notLinked = "The game is not connected. Ask the player to open the game page in a browser on this machine.";

    switch (url.pathname) {
      case "/agent/wait": {
        if (queue.length) return json(res, 200, { transmissions: queue.splice(0), status: lastStatus });
        const seconds = Math.min(Math.max(Number(body.seconds) || 100, 1), 3600);
        let done = false;
        const finish = (items) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          const i = waiters.indexOf(waiter);
          if (i >= 0) waiters.splice(i, 1);
          pushAgentState();
          if (res.destroyed) { items.forEach((t) => queue.unshift(t)); return; } // caller gone: keep them
          json(res, 200, items.length
            ? { transmissions: items, status: lastStatus }
            : { transmissions: [], note: gameLinked || streams.size ? "Nothing yet. Run wait again." : notLinked, status: lastStatus });
        };
        const waiter = (items) => finish(items);
        const timer = setTimeout(() => finish([]), seconds * 1000);
        res.on("close", () => { if (!done) { done = true; clearTimeout(timer); const i = waiters.indexOf(waiter); if (i >= 0) waiters.splice(i, 1); pushAgentState(); } });
        waiters.push(waiter);
        pushAgentState();
        return;
      }
      case "/agent/order": {
        const unit = String(body.unit ?? "").toLowerCase().slice(0, 40);
        const action = String(body.action ?? "").toLowerCase();
        if (!/^[a-z-]{1,20}$/.test(action)) return json(res, 400, { error: `not an order: "${action}"\n${ORDERS}` });
        const target = body.target ? String(body.target).slice(0, 60) : undefined;
        if (NEEDS_ARGUMENT.includes(action) && !target) return json(res, 400, { error: `${action} needs an argument\n${ORDERS}` });
        if (!gameLinked) return json(res, 409, { error: notLinked });
        const id = ++seq;
        const result = await new Promise((resolve) => {
          const timer = setTimeout(() => { pendingOrders.delete(id); resolve({ results: [], error: "no answer from the game" }); }, 3000);
          pendingOrders.set(id, (r) => { clearTimeout(timer); resolve(r); });
          push({ type: "order", id, unit, action, target });
        });
        return json(res, 200, { results: result.results, error: result.error, status: result.status ?? lastStatus });
      }
      case "/agent/radio": {
        if (!body.message) return json(res, 400, { error: "message required" });
        if (!gameLinked) return json(res, 409, { error: notLinked });
        push({ type: "radio", speaker: String(body.speaker ?? ""), text: String(body.message).slice(0, 400) });
        return json(res, 200, { ok: true });
      }
      case "/agent/status":
        return json(res, 200, { game_connected: gameLinked, agent_waiting: waiters.length > 0, status: lastStatus });
      case "/agent/allow-origin":
        if (body.origin) allowed.add(String(body.origin));
        if (body.allowFile) allowFile = true;
        return json(res, 200, { ok: true, origins: [...allowed], allow_file: allowFile });
      case "/agent/shutdown":
        json(res, 200, { ok: true, message: "bridge stopped" });
        setTimeout(() => process.exit(0), 50);
        return;
    }
    json(res, 404, { error: "unknown command" });
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/health") return json(res, 200, { app: "directive937-bridge", version: VERSION });
    if (url.pathname.startsWith("/game/")) return handleGame(req, res, url);
    if (url.pathname.startsWith("/agent/")) return handleAgent(req, res, url).catch((e) => json(res, 500, { error: e.message }));
    json(res, 404, { error: "not found" });
  });

  server.on("error", (e) => {
    console.error(e.code === "EADDRINUSE" ? `Port ${port} is already in use.` : e.message);
    process.exit(1);
  });
  server.listen(port, "127.0.0.1", () => {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({ port, token, pid: process.pid }), { mode: 0o600 });
    log(`listening on 127.0.0.1:${port}; origins: ${[...allowed].join(", ") || "(local only)"}; file pages: ${allowFile}`);
    console.error(`directive937 bridge listening on http://127.0.0.1:${port}`);
  });
}

// ======================= Agent-side client =======================

function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")); } catch { return null; }
}

// The running bridge's version, or null if none answers on that port
async function health(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1500) });
    const j = await r.json();
    return j.app === "directive937-bridge" ? j.version : null;
  } catch {
    return null;
  }
}

export async function agentRequest(command, body = {}) {
  const cfg = readConfig();
  if (!cfg) throw new Error("Bridge not started. Run: node bridge.mjs start");
  let r;
  try {
    r = await fetch(`http://127.0.0.1:${cfg.port}/agent/${command}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-directive937-token": cfg.token },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("Bridge not running. Run: node bridge.mjs start");
  }
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

// Start the server in the background (or reuse a running one). Returns a summary.
export async function ensureRunning({ port = DEFAULT_PORT, origins = [], allowFile = false } = {}) {
  let running = await health(port);
  const cfg0 = readConfig();
  if (running && running !== VERSION && cfg0 && cfg0.port === port) {
    // an older bridge from a previous session: replace it with this version
    await agentRequest("shutdown").catch(() => {});
    for (let i = 0; i < 20 && running; i++) { await new Promise((r) => setTimeout(r, 150)); running = await health(port); }
  }
  if (running) {
    const cfg = readConfig();
    if (cfg && cfg.port === port) {
      for (const origin of origins) await agentRequest("allow-origin", { origin });
      if (allowFile) await agentRequest("allow-origin", { allowFile: true });
      return { ok: true, message: `Bridge already running on port ${port}.` };
    }
    throw new Error(`Port ${port} is used by a bridge whose token is missing. Run 'stop' from the shell that started it, or use --port.`);
  }
  fs.mkdirSync(HOME_DIR, { recursive: true });
  const args = [fileURLToPath(import.meta.url), "serve", "--port", String(port)];
  origins.forEach((o) => args.push("--origin", o));
  if (allowFile) args.push("--allow-file");
  const out = fs.openSync(LOG_FILE, "a");
  spawn(process.execPath, args, { detached: true, stdio: ["ignore", out, out] }).unref();
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 200));
    if (await health(port)) {
      return { ok: true, message: `Bridge started on port ${port}. The game connects automatically when its page is open.` };
    }
  }
  throw new Error(`Bridge did not start. See ${LOG_FILE}`);
}

// ======================= CLI =======================

function parseFlags(argv) {
  const flags = { origins: [], allowFile: false, port: DEFAULT_PORT, rest: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--origin") flags.origins.push(new URL(argv[++i]).origin);
    else if (argv[i] === "--allow-file") flags.allowFile = true;
    else if (argv[i] === "--port") flags.port = Number(argv[++i]);
    else flags.rest.push(argv[i]);
  }
  return flags;
}

const HELP = `Aliens: USCMC bridge ${VERSION}
  start [--origin URL]... [--allow-file] [--port N]   start in the background
  wait [seconds]                                      wait for the next transmission (default 100s)
  order <who> <order> [argument...]                   e.g. order all south | order 2 goto medlab | order all pace slow
${ORDERS}
  radio <speaker> <message...>                        speaker: 1-4, a soldier's name, or MOTHER (ship computer)
  status                                              state of every unit
  stop                                                shut down`;

async function cli(argv) {
  const [cmd, ...rest] = argv;
  const f = parseFlags(rest);
  const print = (o) => console.log(JSON.stringify(o, null, 2));
  switch (cmd) {
    case "serve": return serve({ port: f.port, origins: f.origins, allowFile: f.allowFile });
    case "start": return print(await ensureRunning(f));
    case "wait": return print(await agentRequest("wait", { seconds: Number(f.rest[0]) || 100 }));
    case "order": {
      if (f.rest.length < 2) throw new Error(`usage: order <who> <order> [argument...]\n${ORDERS}`);
      return print(await agentRequest("order", { unit: f.rest[0], action: f.rest[1], target: f.rest.slice(2).join(" ") || undefined }));
    }
    case "radio": {
      if (f.rest.length < 2) throw new Error("usage: radio <speaker> <message...>");
      return print(await agentRequest("radio", { speaker: f.rest[0], message: f.rest.slice(1).join(" ") }));
    }
    case "status": return print(await agentRequest("status"));
    case "stop": return print(await agentRequest("shutdown"));
    default: console.log(HELP);
  }
}

const isMain = process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  cli(process.argv.slice(2)).catch((e) => {
    console.log(JSON.stringify({ error: e.message }, null, 2));
    process.exit(1);
  });
}
