# directive937

A browser game: you sit in a spaceship control room and guide a squad through a 3D maze you can
only see through their helmet cameras. The squad is commanded and voiced by an AI agent on your machine.

## Play

Run `./serve.sh` and the game opens at http://localhost:8000 (`./serve.sh 9000` for another port).
Opening `index.html` directly doesn't work: the browser blocks the 3D models on `file://` pages.

## Connect an AI agent

One local AI agent (e.g. Claude Code) commands and voices the whole squad, and may run other ship
systems later. The player opens **⚙ AGENT SETUP** in the top bar, copies the prompt and pastes it into
the agent. The prompt has the agent fetch `bridge.mjs` from the game server, start it and run a
radio loop:

```
game (browser) --HTTP/SSE--> bridge.mjs on 127.0.0.1:8937 <--CLI-- agent
```

Agent commands: `node ~/.directive937/bridge.mjs start|wait|order|radio|status|stop` (see the top of
`bridge.mjs`; the orders are listed below). Every `wait` result includes each unit's task, standing orders,
what it is doing, hostiles in view and surroundings (room description, exits and where they lead, line
of sight, nearby squad), the squad's known hostiles and the colony map. Events wake the agent: contacts,
kills, instincts taking over, arrivals. The bridge only accepts the game's own origin and protects the
agent commands with a token stored in `~/.directive937/`. Starting the bridge replaces an older running version.

Optional MCP version (same protocol, tools instead of commands):
`cd bridge && npm install && claude mcp add directive937 -e DIRECTIVE937_ORIGINS=https://your-game-server -- node /full/path/bridge/index.js`

## The complex: sectors and accesses

The colony complex is a big square map of 8 x 8 sectors (`sectors.js`): A1 to H8, letter = column (west to
east), number = row (north to south). The squad plays one sector at a time, shown on the tactical map. Each
sector is generated from a fixed seed (the same complex every game, the same sector every visit): nine rooms on a
3 x 3 layout joined by corridors, doors (some starting sealed, never cutting anything off), vents, red lights,
steam or smoke. Sectors are linked by ACCESSES: a small room at the middle of a sector edge with a hatch (its sign
shows the sector it leads to), matching an access at the same spot of the neighbour's edge. Not every pair of
neighbours is linked (a maze over the grid, plus a few extra links); the outer edge of the complex has no
accesses, only the ENTRY on the south edge of D8, where the squad first comes in. Sectors further from the entry
get tenser: the hostiles come down sooner and multiply faster. The closer a sector is to THE NEST, the more of it is
in steam or smoke (about a quarter of the floor in the far corner, two thirds next to the nest; never the nest
itself) and the more of its walls, ceiling and floor are crusted with black alien resin (none far from the nest).

A soldier who steps into an access room goes through its hatch and leaves the sector. The first one through picks
the way for everyone: the other accesses close (crossed out on the tactical map), and the rest of the squad has to
follow through the same one. Patrols, inspections, spreading out, retreats and panic keep out of access rooms, so
nobody leaves by accident: only a deliberate order takes a soldier through: `goto` an access (`goto east access`,
or `goto exit` for the one the squad is leaving through or else the nearest), a grid position inside one, or a
direction (the console's direction pad included) that ends in one. A group following its leader goes through
with them. The monitor shows how many are through (`OUT 1/4`). Once nobody is left inside, if at least one soldier went through, the next sector starts straight away: the squad
arrives next to the matching access, with the health they had and still at the pace they were (SLOW / RUN). If they all died, the game freezes and SQUAD LOST
shows over the camera feed: REGROUP brings the whole squad back, all four at full health, in the sector where it
came into the AREA it's in (the named groups of sectors on the full map: ENTRY CONCOURSE, ENGINEERING DECKS...),
arriving through the same access; NEW MISSION starts over at the entry. Soldiers lost along the way stay lost
(their camera shows NO SIGNAL) until the squad regroups. The goal: kill THE GIANT in THE NEST, sector H1. That wins the mission: the game freezes and MISSION COMPLETE shows over the camera feed, with NEW MISSION to start over from the entry.

⤢ FULL MAP, beside the tactical map, opens the whole complex full screen as a paper map (`papermap.js`): black,
thin white lines, the sector grid and labels, the accesses and the entry; the only thing laid over it is the
sector the squad is in now: no soldiers, hostiles or door states. Esc or ✕ CLOSE closes it.

## Doors

Sliding doors sit in some corridors and room doorways (`doors.js`, placed in `levels.js`; some start sealed: D5, D6 and D8 in the colony), numbered D1, D2... on
the doors themselves, on the tactical map and in the agent's status. Soldiers and hostiles alike open one by
walking into it (they wait a moment while it slides open); it closes again a few seconds after nobody is in the
doorway. Nobody sees or shoots through a closed door.

SEAL welds a door shut: it doesn't open for hostiles or the squad, so it's the way to cut hostiles off from part
of the colony. Hostiles plan around sealed doors, and so do the soldiers' own moves (patrols, inspections,
retreats, panic, pursuit, spreading out). On a direct order (`goto`, or a direction, the pad included) a soldier
plans straight through a sealed door instead, and stops in front of it, reporting it once ("stopped at sealed door
D3 … order unseal to cut through"); once it's cut open they carry on by themselves. UNSEAL cuts through the weld (15 s; the seam shrinks back down
under the same sparks) and the door works normally again, for everyone. The weld is gradual both ways: a half-cut
door is still sealed and can be welded back up from where it was.
It's one soldier's job: from the console, the one on camera if they're among the ticked, else the first group
leader, else the first of them; from the agent, a group leader among those named. The console button works on the
door nearest that soldier, `SEAL/UNSEAL DOOR`: it welds that door, or cuts it open if it's sealed (the tooltip says which door and what it will do). The
soldier walks to the door (the agent can name one: `D3`, a room, or `x y`), closes it, and works standing in front
of it: sparks pour off a glowing seam that climbs the door (shrinks, when cutting), under a flickering arc. Having
to fight pauses the work; it carries on from where it was. The camera button shows `WELD nn%` or `CUT nn%`.

## Level format

A sector is a "level": plain data in the format described at the top of `levels.js` (grid size, rooms with name,
map label, aliases, interior, light colour, description for the agent and wall style; corridors, solid blocks,
doors, fog, vents, red lights, start room and tiles, exits with their hatch tiles, a briefing, optional overrides
of the hostiles' release schedule). `generateSector` in `sectors.js` produces them; `sectorLevel` adds where the
squad starts, depending on the access it came in through. `HANDMADE_LEVELS` in `levels.js` are the two hand-made
maps from before the complex (COLONY OUTPOST, REACTOR DECK): not in play, since they don't follow the sectors'
layout of accesses, kept as examples. `node tools/check-levels.js` checks every sector from every way in, and the
hand-made levels: rooms that touch, doors outside 1-wide passages, misplaced lights, vents, start tiles or hatches,
links that don't match on both sides, and that every room and access can be reached from the start with the
doors that start sealed (`-v` prints each sector). `createWorld(width, height, squad, level, carry)` builds any
level; `startSector(sector, from, carry)` in `main.js` swaps worlds (disposing the old one). Models and
animations load once per page (`models.js`) and are reused by every world.

## Soldier behavior

Soldiers decide for themselves about 10 times a second (`behavior.js`), in three layers. The highest one wins:

| Layer | What it is | Behaviors |
|---|---|---|
| **Instinct** | Reflexes that override any order | *Point-blank*: shoot any hostile within ~2 tiles, even under `fire hold`. *Panic*: when overwhelmed (several hostiles close; squad mates nearby make it bearable), run fast away from them, then hold. |
| **Orders** | The player's intent, through the agent | A **task** (one at a time), **standing orders** (kept until changed) and the **squad shape** (see below). |
| **Default** | What they do untold | Stay together behind the lowest-numbered unit, patrol room by room, watch different angles, engage hostiles they see, pursue them. |

Orders (`order <who> <order> [argument]`, who = `1-4`, a name, `alpha`/`bravo`, `all` or `1,3`):

- **Tasks**: `patrol` (freely) · `patrol <room>` · `goto <room>` / `goto <x> <y>` · `north|south|east|west` (as far as possible) · `hold` · `alert` (stop and look all around for 5 s, then carry on; followers stay in their group) · `inspect [room]` (walk to a few spots across the room, by default the one they're in or the nearest, look around at each, report and hold) · `retreat [room]` · `getout` (each runs to the nearest corridor, on their own, and holds) · `follow <unit>` · `seal [door]` (weld a door shut: `D3`, a room, `x y` or the nearest; one soldier, 20 s) · `unseal [door]` (cut it open again; also `unweld`, `cut`; 15 s) · `continue`
- **Squad shape**: `together` (regroup behind the lowest-numbered unit) · `split` (ALPHA = 1+2, BRAVO = 3+4) · `spread` (fan out across the room and act independently)
- **Standing orders**: `pace slow|normal|fast` · `fire free|hold` · `contact engage|hold|retreat` (what to do on seeing a hostile) · `pursue on|off` · `watch auto|front|rear|<direction, e.g. north-east>|center|<room>|<x y>` · `reset`

A group follows its leader: a task given to the leader (or the whole group) moves the group; a task given to one
follower alone takes it out of the group. Soldiers only see hostiles in front of them (~140°, ~8 tiles, not through
walls), or right next to them, so where they look matters. Walking, they look ahead with the odd glance around;
standing in a group, each covers a different angle. A `watch` order points them somewhere (still with the odd
glance elsewhere) and lapses back to `auto` a few seconds after the soldier starts moving.
Pace is a trade-off: `slow` sees further and aims better, `fast` runs but sees less. Heart rate on the biomonitor
follows each soldier's stress.

Hostiles (`hostiles.js`) start in the ventilation ducts, a hidden floor above the colony where they can't be seen
or shot and crawl freely over the map. They come in at the edges of the map and drop through openings in the
ceiling (dark squares in rooms and corridors, small squares on the tactical map). The colony starts silent: the first arrive in the ducts after ~20 s and the first comes down after ~35 s;
the number released then doubles every 50 s, and new ones keep arriving in the ducts (up to 40 alive). Each
soldier's status has a `motion_tracker` (signals within 12 tiles, ducts included). On the floor they roam:
each picks somewhere else (out of the room it's in, down the corridors), walks there opening doors on the way
(not sealed ones), stops to listen, and picks again. When one sees a soldier (or is shot) it charges, a little
slower than a soldier running on `pace fast`; if it touches a soldier, that soldier dies. Losing sight, it searches
where the soldier was last seen, then roams again. Some areas are full of steam or smoke (not shown on the
tactical map): inside, everyone sees only ~3 tiles and the helmet camera closes in.

The tactical map always shows the soldiers (one colour each). Hostiles only show up on sonar: each soldier carries
one, and every second a wave leaves each of them (one shared beep) and spreads out 12 tiles. A hostile appears as a
fading blip where a wave caught it, so the squad only senses what is near it.

Everyone has 100 health and a rifle round takes 10. Each round shows a muzzle flash and a tracer, and lands
as sparks on a wall or a splash on a hostile (`effects.js`). A killed hostile disappears. A soldier at 0
health is KIA: their camera goes to static, their vitals flatline, and anyone following them falls in behind
the next leader. `world.hurt(unit, amount)` in the browser console takes health off a soldier, for testing.

Soldiers call in hostiles as events for the agent to voice: contacts (with what each hostile is doing), a hostile
charging them, one dropping from a ceiling vent, motion-tracker movement close by with nothing in sight (limited
to one call every few seconds for the squad), losing sight of one, kills. With no agent linked, the soldiers call in those events
themselves as short radio messages (e.g. `FROST: CONTACT! ...`, `MOTHER: UNIT 3 (HUDSON) IS DOWN. NO LIFE SIGNS.`);
with an agent linked, the agent voices them instead. Every radio message, CONTROL's own included, plays a short
transmission: a squelch click, half a second of choppy, unintelligible static (MOTHER: data chirps), a click. Calls
about hostiles (the soldier just had a contact, charge, vent or tracker event, or the message sounds like an alarm)
come through shouted: louder, overdriven and harsher.

Suspense music is generated live (`audio.js`, no files): a low dissonant drone, slow pad swells, distant metallic
pings, and a heartbeat pulse once things get tense. It follows the game's tension (soldier stress, how close the
nearest hostile is, ducts included, hostiles in view) and plays and mutes with the AUDIO button.

The player talks to the whole squad and names a soldier in the message to address one ("Drake, hold there").

The console works without the agent too. The four big buttons beside the monitor pick whose helmet camera is
on screen and show each soldier's health, HOLD / SLOW / RUN and who they follow. Under the biomonitor, a chip per
soldier ticks them for orders (the box in the SQUAD title ticks or unticks them all); the order buttons then apply
to every ticked soldier (with none ticked, to the one on camera): HOLD / SLOW / RUN (one at a time, lit while all
of them are in that mode, whoever gave the order; pressing the lit one goes back to normal pace, and letting go of
HOLD they carry on, rejoining their group if they were following someone), ALERT, OUT OF THERE (each one stops
following anyone and runs to the nearest corridor, spread over different tiles, then holds), SEAL/UNSEAL DOOR, a
FOLLOW selector, and a direction pad that sends them as far as possible north, south, east or west (the centre is
HOLD). INSPECT, RETREAT, TOGETHER and SPREAD have no button but the agent can still order them. Each order shows in
the comms log as a CONTROL message (e.g. `CONTROL: FROST, HUDSON: HEAD NORTH`)
and is reported to the agent.

## Files

Scripts load in this order (plain `<script>` tags, no build step):

- `levels.js`: the level format, `levelGrid()` to turn one into a grid, and the two hand-made levels (not in play)
- `sectors.js`: the complex: which sectors are linked, and each sector generated as a level
- `doors.js`: sliding doors: opening, closing, what they block, welding them shut
- `nav.js`: grid navigation shared by everyone: routes (4- and 8-direction), rooms, exits, line of sight
- `walls.js`: wall textures (panels, ribbed metal, pipes, hazard bulkheads, consoles, hatches, cables, lockers, lab tiles) and which wall tile gets which
- `effects.js`: gunfire effects: muzzle flash, tracers, wall sparks, hit splashes
- `models.js`: soldier and alien models, animation clips and the rifle, loaded once and shared by every world
- `behavior.js`: what soldiers decide to do: instincts, orders, default behavior; health, death, leaving
- `hostiles.js`: what the aliens do: ducts and vents, wander, chase, kill on contact
- `mission.js`: the exit, soldiers leaving through it, and when the level ends
- `world.js`: builds a level's 3D world (Three.js) and moves, aims and fires the soldiers
- `audio.js`: static, radio bursts, gunfire and suspense music (Web Audio, no sound files)
- `tacmap.js`: the tactical map with the sonar
- `papermap.js`: the whole complex as a full-screen paper map
- `main.js`: the control room: CRT feed, biomonitor, comms, squad console, agent link, levels, main loop
- `index.html`, `style.css`: the control room layout
- `agent.html`: agent setup page; builds the prompt for wherever the game is hosted
- `bridge.mjs`: local bridge between the game and the agent (single file, no dependencies)
- `bridge/`: optional MCP wrapper around `bridge.mjs`
- `serve.sh`: local web server for testing (no caching)
- `tools/check-levels.js`: checks every sector's layout (`node tools/check-levels.js`)
