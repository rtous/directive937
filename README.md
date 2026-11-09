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

## Mission

A survivor is hiding somewhere in the colony, far from the AIRLOCK where the squad comes in (`mission.js`). The
survivor never shows on the tactical map: each soldier carries a distress-signal detector, stronger the closer
they are (shown on the camera monitor as SOS bars and a percentage, and as small bars next to each soldier in
the squad list). A soldier who gets within ~2.5 tiles finds them, and the survivor follows that soldier (or another one nearby if that soldier dies). Bring the survivor back
to the AIRLOCK, the extraction point marked on its floor and outlined on the map, to win. If the survivor dies, or
the whole squad, the mission is lost. Either way the game freezes and the result shows over the camera feed, with
a restart button. The survivor is a simple placeholder figure for now.

## Soldier behavior

Soldiers decide for themselves about 10 times a second (`behavior.js`), in three layers. The highest one wins:

| Layer | What it is | Behaviors |
|---|---|---|
| **Instinct** | Reflexes that override any order | *Point-blank*: shoot any hostile within ~2 tiles, even under `fire hold`. *Panic*: when overwhelmed (several hostiles close; squad mates nearby make it bearable), run fast away from them, then hold. |
| **Orders** | The player's intent, through the agent | A **task** (one at a time), **standing orders** (kept until changed) and the **squad shape** (see below). |
| **Default** | What they do untold | Stay together behind the lowest-numbered unit, patrol room by room, watch different angles, engage hostiles they see, pursue them. |

Orders (`order <who> <order> [argument]`, who = `1-4`, a name, `alpha`/`bravo`, `all` or `1,3`):

- **Tasks**: `patrol` (freely) · `patrol <room>` · `goto <room>` / `goto <x> <y>` · `north|south|east|west` (as far as possible) · `hold` · `retreat [room]` · `follow <unit>` · `continue`
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
soldier's status has a `motion_tracker` (signals within 12 tiles, ducts included). On the floor they wander
at random. When one sees a soldier (or is shot) it charges, a little
slower than a soldier running on `pace fast`; if it touches a soldier, that soldier dies. Losing sight, it searches
where the soldier was last seen, then wanders again. Some areas are full of steam or smoke (not shown on the
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
to one call every few seconds for the squad), losing sight of one, kills. Every radio message plays a short
transmission: a squelch click, half a second of choppy, unintelligible static (MOTHER: data chirps), a click. Calls
about hostiles (the soldier just had a contact, charge, vent or tracker event, or the message sounds like an alarm)
come through shouted: louder, overdriven and harsher.

Suspense music is generated live (`audio.js`, no files): a low dissonant drone, slow pad swells, distant metallic
pings, and a heartbeat pulse once things get tense. It follows the game's tension (soldier stress, how close the
nearest hostile is, ducts included, hostiles in view) and plays and mutes with the AUDIO button.

The player talks to the whole squad and names a soldier in the message to address one ("Drake, hold there").
Each soldier in the squad list also has quick console buttons that stay lit while active: HOLD (stop and look
around; press again to carry on, rejoining their group if they were following someone) and SLOW / RUN (pace;
only one at a time, press the lit one again for normal pace). They show the soldier's actual state, so orders
from the agent light them too, and each press is reported to the agent.

## Files

- `index.html`, `style.css`, `main.js`: control room, CRT feed, squad/camera selection, comms, agent link
- `world.js`: 3D colony, soldier movement/aiming/firing/animation, aliens (Three.js)
- `behavior.js`: what soldiers decide to do: instincts, orders, default behavior; health and death
- `effects.js`: gunfire effects: muzzle flash, tracers, wall sparks, hit splashes
- `hostiles.js`: what the aliens do: wander, chase, kill on contact
- `mission.js`: the survivor, the extraction point, winning and losing
- `walls.js`: wall textures (panels, ribbed metal, pipes, hazard bulkheads, consoles, hatches, cables, lockers, lab tiles) and which room gets which
- `serve.sh`: local web server for testing
- `audio.js`: static/noise sound
- `agent.html`: agent setup page; builds the prompt for wherever the game is hosted
- `bridge.mjs`: local bridge between the game and the agent (single file, no dependencies)
- `bridge/`: optional MCP wrapper around `bridge.mjs`
