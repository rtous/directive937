"use strict";

// Typed orders: what CONTROL types in the comms box ("Frost, Hudson: go east", "everyone regroup",
// "Vasquez seal D3", "run to the medlab", "hold fire") turned into game orders (behavior.js: world.order).
// Plain keyword rules, no model: instant and tiny.
//
// Self-contained on purpose: a pure function with no game state; main.js uses it only if this file is loaded. To remove it, delete this file and its <script> line in game.html.
//
// TextOrders.parse(text, { units, rooms }) -> { unit, orders } | null
//   units: [{ id, callsign }]   rooms: [{ name, label, aliases }] (the level's)
//   unit: "1,3" / "all" / null (nobody named: the caller picks, e.g. the ticked soldiers or the one on camera)
//   orders: [[action, target], ...] in the order to apply them (standing orders first, then the task)
//   null: nothing understood
const TextOrders = (() => {
  const DIR = "north|south|east|west";
  const COMPASS = "north[ -]?east|north[ -]?west|south[ -]?east|south[ -]?west|north|south|east|west";
  const ALL = /\b(all|everyone|everybody|squad|team|guys|marines|people|you all|all units)\b/;

  // Standing orders: every one that matches applies. [pattern, action, target]
  const STANDING = [
    [/\breset( (your|the|all))?( standing)?( orders)?\b|\bback to default\b/, "reset", ""],
    [/\b(hold|cease|stop)( your| the)? fire\b|\bdon'?t (shoot|fire)\b|\bweapons (hold|safe|tight)\b|\bno shooting\b/, "fire", "hold"],
    [/\bweapons free\b|\bopen fire\b|\bfire at will\b|\bfree fire\b|\bshoot( them| it| on sight)?\b|\bfire\b/, "fire", "free"],
    [/\bdon'?t (chase|pursue)( them| it)?\b|\bno (chasing|pursuit)\b|\bstop (chasing|pursuing)\b/, "pursue", "off"],
    [/\b(chase|pursue|hunt)( them| it| down)?\b/, "pursue", "on"],
    [/\bavoid (contact|them|it|hostiles)\b/, "contact", "retreat"],
    [/\bengage\b/, "contact", "engage"],
    [/\b(watch|check|cover)( your| our| the)? (six|back|rear)\b|\b(look|watch|eyes) (behind|back|rear)\b/, "watch", "rear"],
    [/\b(eyes|look|watch) (front|ahead|forward)\b/, "watch", "front"],
    [new RegExp(`\\b(?:look|watch|eyes|face|aim|cover)(?: to| at| towards?)?(?: the)? (${COMPASS})\\b`), "watch", 1],
    [/\b(slow(ly)?|careful(ly)?|quiet(ly)?|sneak|easy|cautious(ly)?)\b/, "pace", "slow"],
    [/\b(run(?! away)|fast|quick(ly)?|hurry|sprint|double time|move it|on the double)\b/, "pace", "fast"],
    [/\b(walk|normal pace)\b/, "pace", "normal"],
  ];

  // Tasks and squad shapes: the first that matches wins. [pattern, action, target]; target:
  // a string, a capture group number, or a function (match, room, door, follow) -> target (null: rule doesn't apply)
  const TASKS = [
    [/\b(watch|check|cover|eyes on|look at|look up at)( the)? (ceiling|vents?|roof|openings?)\b|\blook up\b/, "ceiling", ""],
    [/\b(regroup|together|group up|on me|form up|fall in|rally)\b/, "together", ""],
    [/\bsplit( up)?\b/, "split", ""],
    [/\b(spread( out)?|fan out|scatter)\b/, "spread", ""],
    [/\b(follow|stay with|stick with|go with|cover|fall in behind|behind)\b/, "follow", (m, room, door, follow) => follow],
    [/\b(unseal|unweld|cut( it| the door| through)?( open)?|open( the)?( sealed)? door)\b/, "unseal", (m, room, door) => door || room || ""],
    [/\b(seal|weld|shut|close)( it| the door| that door| the way| off)?\b/, "seal", (m, room, door) => door || room || ""],
    [/\b(get out( of there)?|out of there|evacuate|bail out|clear out)\b/, "getout", ""],
    [/\b(retreat|fall back|withdraw|run away|flee|pull back|back off)\b/, "retreat", (m, room) => room || ""],
    [/\b(inspect|check|clear|sweep|search)\b/, "inspect", (m, room) => room || ""],
    [/\b(patrol|explore|wander|scout|roam)\b/, "patrol", (m, room) => room || ""],
    [/\b(alert|look( all)? around|scan|eyes open|stay sharp|heads up|lookout)\b/, "alert", ""],
    [/\b(continue|carry on|resume|as you were|keep going|move on|proceed)\b/, "continue", ""],
    [/\b(go|move|head|get|walk|run|advance)?( back)? ?(to|into|towards?)( the)? ?(exit|way out|access|hatch)\b/, "goto", "exit"],
    [/\b(\d{1,2})[ ,]+(\d{1,2})\b/, "goto", (m) => `${m[1]} ${m[2]}`],
    [/./, "goto", (m, room) => room], // a room named anywhere: go there
    [new RegExp(`\\b(?:step|a bit|a little|one leg|next)\\b.*?\\b(${DIR})\\b|\\b(${DIR})\\b.*?\\b(a bit|a little|one step|one leg)\\b`),
      "step", (m) => m[1] || m[2]],
    [new RegExp(`\\b(${DIR})\\b`), 1, ""], // "go east": as far as possible that way
    [/\b(hold|stop|halt|wait|freeze|stay|stand fast|stay put|hold position|hold there)\b/, "hold", ""],
  ];

  const norm = (s) => ` ${String(s).toLowerCase().replace(/[^a-z0-9' -]+/g, " ").replace(/\s+/g, " ").trim()} `;
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  function parse(text, { units = [], rooms = [] } = {}) {
    let t = norm(text);
    const take = (re) => { const m = t.match(re); if (m) t = t.replace(m[0], " "); return m; };

    // who: names (callsigns), "unit 2" / "u2", everyone; "follow X": X is who they follow, not who's told
    const byWord = new Map(units.map((u) => [u.callsign.toLowerCase(), u]));
    const unitAlt = [...byWord.keys()].map(esc).join("|") || "(?!)";
    const unitRe = new RegExp(`\\b(?:unit ?|u)([1-9])\\b|\\b(${unitAlt})\\b`);
    const unitOf = (m) => (m[1] ? units.find((u) => String(u.id) === m[1]) : byWord.get(m[2]));
    let follow = null;
    const f = take(new RegExp(`\\b(follow|stay with|stick with|go with|cover|fall in behind|behind) (?:unit ?|u)?(${unitAlt}|[1-9])\\b`));
    if (f) {
      const u = byWord.get(f[2]) || units.find((x) => String(x.id) === f[2]);
      if (u) { follow = String(u.id); t = ` ${f[1]} ${t}`; } // keep the verb for the follow rule
    }
    const told = new Set();
    for (let m; (m = take(unitRe));) { const u = unitOf(m); if (u) told.add(u.id); }
    const all = !!take(ALL);

    // what: standing orders (all of them), then one task
    const orders = [];
    for (const [re, action, target] of STANDING) {
      const m = take(re);
      if (m) orders.push([action, typeof target === "number" ? m[target].replace(" ", "-") : target]);
    }
    // a door (D3, door 3) and a room (its name, map label or an alias; the longest that fits)
    const dm = take(/\b(?:door ?|d)(\d{1,2})\b/);
    const door = dm ? `D${dm[1]}` : null; // (one that isn't there: the soldier says so)
    const phrases = rooms.flatMap((r) => [r.name, r.label, ...(r.aliases || [])].filter((p) => p && p.length > 2).map((p) => [p.toLowerCase(), r.name]))
      .sort((a, b) => b[0].length - a[0].length);
    const hit = phrases.find(([p]) => t.includes(` ${p} `));
    const room = hit ? hit[1] : null;
    if (hit) t = t.replace(` ${hit[0]} `, "  ");
    for (const [re, action, target] of TASKS) {
      const m = t.match(re);
      if (!m) continue;
      const arg = typeof target === "function" ? target(m, room, door, follow) : target;
      if (arg == null) continue;
      orders.push([typeof action === "number" ? m[action] : action, arg]);
      break;
    }
    if (!orders.length) return null;

    // "together" / "split" with nobody named: the whole squad
    const shape = orders.some(([a]) => a === "together" || a === "split");
    if (follow) told.delete(Number(follow));
    const unit = all || (shape && !told.size) ? "all" : told.size ? [...told].join(",") : null;
    return { unit, orders };
  }

  const help = 'TRY: "FROST GO EAST", "ALL REGROUP", "VASQUEZ SEAL D3", "HUDSON CHECK THE MEDLAB", "RUN TO THE EXIT", ' +
    '"HOLD FIRE", "LOOK NORTH", "DRAKE FOLLOW FROST", "STEP WEST", "LOOK AROUND", "WATCH THE CEILING", "HOLD", "CARRY ON".';

  return { parse, help };
})();
