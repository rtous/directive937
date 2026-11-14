#!/usr/bin/env node
// Optional MCP front-end for the Directive 937 bridge (the main setup is the pasted prompt in agent.html).
// It exposes the same commands as `node bridge.mjs ...` as MCP tools, and starts bridge.mjs if needed.
//
//   claude mcp add directive937 -e DIRECTIVE937_ORIGINS=https://your-game-server -- node /path/to/bridge/index.js
//
// stdout is reserved for MCP.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { agentRequest, ensureRunning } from "../bridge.mjs";

const origins = (process.env.DIRECTIVE937_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
const allowFile = process.env.DIRECTIVE937_ALLOW_FILE === "1";

const reply = async (fn) => {
  try {
    return { content: [{ type: "text", text: JSON.stringify(await fn(), null, 2) }] };
  } catch (e) {
    return { content: [{ type: "text", text: e.message }], isError: true };
  }
};

const server = new McpServer({ name: "directive937", version: "0.3.0" });
const UNIT = z.string().describe('A unit number (1-4), a soldier\'s name, "alpha"/"bravo" (teams after a split), "all", or a list like "1,3"');

server.registerTool("wait_for_transmission", {
  description: "Wait for the next transmission from the game (player radio messages or game events). " +
    "Returns them with the status of every unit. Call again after handling each result.",
  inputSchema: { seconds: z.number().int().min(5).max(3600).optional().describe("Default 240") },
}, ({ seconds = 240 }) => reply(() => agentRequest("wait", { seconds })));

server.registerTool("send_order", {
  description: "Give soldiers an order. Soldiers act on their own between orders (default: stay together, patrol, " +
    "watch all angles, engage and pursue hostiles); instincts (point-blank fire, panic flight) override orders.\n" +
    "TASKS: patrol [room] | goto <room | x y> | north/south/east/west (as far as possible) | step north|south|east|west (one leg: from a room out the doorway on that side to the next room's centre; along a corridor to the next junction, dead end or sealed door) | hold | " +
    "alert (stop, look all around 5 s, carry on) | inspect [room] (check it spot by spot, then hold) | " +
    "retreat [room] | getout (each runs to the nearest corridor, on their own) | follow <unit> | seal [door] (weld a door shut, 20 s, one soldier) | unseal [door] (cut a sealed door open again, 15 s) | continue.\n" +
    "SQUAD SHAPE: together (regroup behind the lowest-numbered unit) | split (ALPHA 1+2, BRAVO 3+4) | spread.\n" +
    "STANDING ORDERS (kept until changed): pace slow|normal|fast | fire free|hold | contact engage|hold|retreat | " +
    "pursue on|off | watch auto|front|rear|<direction, diagonals too: north-east>|center (of the room)|<room>|<x y> (lapses to auto a few seconds after moving) | reset.",
  inputSchema: {
    unit: UNIT,
    action: z.enum(["patrol", "goto", "north", "south", "east", "west", "step", "hold", "alert", "inspect", "retreat", "follow", "continue",
      "together", "split", "spread", "pace", "fire", "contact", "pursue", "watch", "reset"]),
    target: z.string().optional().describe("The argument: a room (MEDLAB, AIRLOCK...), a position \"x y\", a unit, or a value like slow / hold / off"),
  },
}, ({ unit, action, target }) => reply(() => agentRequest("order", { unit, action, target })));

server.registerTool("radio", {
  description: "Send a radio message shown in the game's comms box, spoken by a unit (1-4 or name) or MOTHER (ship computer).",
  inputSchema: { speaker: z.string(), message: z.string().min(1).max(400) },
}, ({ speaker, message }) => reply(() => agentRequest("radio", { speaker, message })));

server.registerTool("get_status", {
  description: "Current status of every unit (position, task, standing orders, what it is doing, hostiles in view, vitals) and the squad's known hostiles.",
  inputSchema: {},
}, () => reply(() => agentRequest("status")));

try {
  await ensureRunning({ origins, allowFile });
} catch (e) {
  console.error("[directive937]", e.message);
}
await server.connect(new StdioServerTransport());
