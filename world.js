"use strict";

// The mission world: a 3D maze rendered from the soldier's helmet camera.
// Rendered off-screen at low resolution; main.js copies each frame onto the CRT.

const TILE = 2;          // world units per maze tile
const WALL_H = 2.6;
const EYE_H = 1.6;
const TURN_SPEED = 2.6;  // radians / second (walking speed comes from behavior.js)

// Soldier models (Mixamo FBX), one per callsign. Until a model loads, or if it can't (e.g. opened from file://),
// that soldier is drawn as a simple placeholder figure. The animations are shared by all of them.
const CHARACTER = {
  models: {
    FROST: "characters/soldiers/frost.fbx",
    VASQUEZ: "characters/soldiers/vasquez.fbx",
    HUDSON: "characters/soldiers/hudson.fbx",
    DRAKE: "characters/soldiers/drake.fbx",
  },
  model: "characters/Vanguard By T. Choonyung.fbx", // for anyone without a model of their own
  walk: "characters/Walk With Rifle.fbx",
  run: "characters/Run Forward.fbx",
  idle: "characters/Rifle Turn.fbx",  // only its first frame: standing with the rifle up
  fire: "characters/Firing Rifle.fbx",
  height: 1.78,                       // metres
  walkClipSpeed: 1.31,                // m/s the walk clip was recorded at
  runClipSpeed: 3.5,                  // fallback if the run clip's speed can't be measured
};

// Alien model (rigged, with idle/walk/run1/attack1/attack2/kill1/kill2/die animations).
// Its textures aren't linked inside the FBX, so they're attached by material name.
const XENO_DIR = "characters/realistic-xenomorph-rig/";
const XENO = {
  model: XENO_DIR + "source/Xenomorph Default.fbx",
  textures: { // material name (lower case) -> [colour map, normal map]
    t_mi_xeno_body_basecolor: [XENO_DIR + "textures-web/body_basecolor.jpg", XENO_DIR + "textures-web/body_n.jpg"],
    t_mi_xeno_headcap_basecolor: [XENO_DIR + "textures-web/headcap_basecolor.jpg", XENO_DIR + "textures-web/headcap_n.jpg"],
  },
  height: 2.2,  // metres, standing (how many and when: VENTS in hostiles.js)
  darkness: 0.35, // multiplies the texture colour (1 = as painted)
};

// ---------- Colony layout ----------
// A fixed outpost: named rooms joined by narrow corridors. Grid tiles: 1 = wall, 0 = open.
// Coordinates are tiles; x grows east, y grows south (north is up on the tactical map).
const COLONY_W = 46;
const COLONY_H = 32;

const COLONY_ROOMS = [
  // name, short map label, aliases the agent may use, interior rectangle, ceiling light colour, what it looks like
  { name: "MEDLAB", label: "MED", aliases: ["medical", "infirmary", "med"], x: 3, y: 3, w: 8, h: 5, light: 0xd8fff0,
    desc: "Medical lab. Overturned gurneys, cracked specimen tanks, flickering surgical lamp." },
  { name: "LIVING QUARTERS", label: "QTRS", aliases: ["quarters", "barracks", "dorms", "qtrs"], x: 32, y: 3, w: 9, h: 6, light: 0xffe2b0,
    desc: "Crew bunks. Personal belongings scattered, beds unmade, a child's drawing on the wall." },
  { name: "OPERATIONS", label: "OPS", aliases: ["ops", "command", "control room"], x: 18, y: 11, w: 8, h: 7, light: 0xcfe4ff,
    desc: "Colony command centre. Central console still powered, screens showing static, chairs knocked over." },
  { name: "STORAGE", label: "STOR", aliases: ["stores", "warehouse", "stor"], x: 3, y: 13, w: 7, h: 6, light: 0xbfc8c0,
    desc: "Supply storage. Stacked crates, some forced open, a cargo loader parked in the corner." },
  { name: "ATMOSPHERE PROCESSOR", label: "PROC", aliases: ["processor", "atmosphere", "reactor", "proc"], x: 32, y: 14, w: 9, h: 6, light: 0xffa040,
    desc: "Atmosphere processing plant. Loud pumps, hot steam venting, amber warning lights." },
  { name: "MESS HALL", label: "MESS", aliases: ["mess", "canteen", "cafeteria"], x: 3, y: 24, w: 8, h: 5, light: 0xfff0d0,
    desc: "Mess hall. Meals left half-eaten on the tables, a coffee machine still dripping." },
  { name: "AIRLOCK", label: "LOCK", aliases: ["base", "entrance", "lock", "start", "dropship"], x: 19, y: 25, w: 6, h: 5, light: 0xff4030,
    desc: "Main airlock where the squad came in. Red emergency strobe, outer door sealed behind them." },
  { name: "ARMORY", label: "ARMS", aliases: ["armoury", "weapons", "arms"], x: 33, y: 25, w: 8, h: 4, light: 0xc8ffd0,
    desc: "Colony armory. Weapon racks mostly empty, ammo cases scattered on the floor." },
  // The way out: a small vestibule off the living quarters with a hatch in the outer (east) wall.
  // Whoever steps in goes through the door and leaves the level (mission.js).
  { name: "EXIT", label: "EXIT", aliases: ["exit door", "way out", "outer door", "evac", "hatch"], x: 42, y: 5, w: 3, h: 3, light: 0xff4030,
    desc: "Exit vestibule. A heavy hatch in the outer wall, red EXIT light above it: the way out of this sector." },
];
// Where the exit hatch is drawn: the outer-wall tile east of the EXIT room
const EXIT_DOOR = { x: 45, y: 6 };

// Corridors as straight runs: [x1, y1, x2, y2] (inclusive), 1 tile wide unless noted
const COLONY_CORRIDORS = [
  [11, 5, 31, 5],     // north corridor: medlab <-> quarters
  [21, 6, 21, 10],    // north corridor -> operations
  [10, 15, 17, 15],   // operations <-> storage
  [26, 16, 31, 16],   // operations <-> atmosphere processor
  [21, 18, 22, 24],   // operations <-> airlock (2 wide main spine)
  [11, 26, 18, 26],   // mess hall <-> airlock
  [25, 26, 32, 26],   // airlock <-> armory
  [6, 8, 6, 12],      // medlab <-> storage
  [6, 19, 6, 23],     // storage <-> mess hall
  [36, 9, 36, 13],    // quarters <-> processor
  [36, 20, 36, 24],   // processor <-> armory
  [41, 6, 41, 6],     // living quarters <-> exit
];

// Areas filled with steam or smoke: [x1, y1, x2, y2] (tiles, inclusive) and what it is.
// Inside, everyone (soldiers and hostiles) sees only a few tiles.
const FOG_ZONES = [
  { area: [32, 14, 40, 19], what: "Thick steam from the venting pumps." },  // atmosphere processor
  { area: [36, 20, 36, 24], what: "Steam drifting down the corridor." },     // processor -> armory
  { area: [3, 13, 9, 18], what: "Smoke hanging in the air, something smouldering behind the crates." }, // storage
  { area: [14, 5, 20, 5], what: "Smoke from a burnt-out panel fills the corridor." }, // north corridor
];

// Openings in the ceiling to the ventilation ducts, where hostiles drop in: [x, y] tiles.
// One per room except the airlock, plus a few corridors; at least 2 tiles from any red emergency light.
const VENT_OPENINGS = [
  [8, 4], [38, 7], [24, 12], [8, 13], [39, 15], [9, 27], [36, 27],  // MED, QTRS, OPS, STOR, PROC, MESS, ARMS
  [14, 5], [26, 5], [13, 15], [22, 18], [6, 23], [36, 13], [29, 26], // corridors
];

// Solid blocks inside rooms (consoles, machinery, pillars)
const COLONY_BLOCKS = [
  [21, 13, 22, 14],   // operations: central console
  [34, 16, 34, 17], [38, 16, 38, 17], // processor: pump columns
  [5, 15, 5, 16],     // storage: crate stack
];

function buildColony() {
  const grid = Array.from({ length: COLONY_H }, () => new Array(COLONY_W).fill(1));
  const carve = (x1, y1, x2, y2, v = 0) => {
    for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++)
      for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) grid[y][x] = v;
  };
  COLONY_ROOMS.forEach((r) => carve(r.x, r.y, r.x + r.w - 1, r.y + r.h - 1));
  COLONY_CORRIDORS.forEach((c) => carve(...c));
  COLONY_BLOCKS.forEach((b) => carve(...b, 1));
  const airlock = COLONY_ROOMS.find((r) => r.name === "AIRLOCK");
  const starts = [[airlock.x + 1, airlock.y + 2], [airlock.x + 4, airlock.y + 2], [airlock.x + 1, airlock.y + 4], [airlock.x + 4, airlock.y + 4]];
  return { grid, rooms: COLONY_ROOMS, starts };
}

function roomAt(rooms, x, y) {
  return rooms.find((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) || null;
}

// ---------- Procedural textures ----------
function makeTexture(size, draw) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  draw(c.getContext("2d"), size);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  return tex;
}

function floorTexture() {
  return makeTexture(64, (g, s) => {
    g.fillStyle = "#3b3f3d";
    g.fillRect(0, 0, s, s);
    g.fillStyle = "#1c1f1d"; // grating
    for (let i = 4; i < s; i += 8) {
      g.fillRect(i, 0, 2, s);
      g.fillRect(0, i, s, 2);
    }
  });
}

function ceilingTexture() {
  return makeTexture(64, (g, s) => {
    g.fillStyle = "#2e3230";
    g.fillRect(0, 0, s, s);
    g.fillStyle = "#151816";
    g.fillRect(0, s / 2 - 3, s, 6); // pipe channel
    g.fillStyle = "#4a4f4c";
    g.fillRect(0, s / 2 - 1, s, 2);
  });
}

// ---------- World ----------
// squad: [{ id, name, callsign }] — one soldier per entry, each with its own helmet camera.
function createWorld(width, height, squad) {
  const { grid, rooms, starts } = buildColony();
  const rows = grid.length;
  const cols = grid[0].length;

  const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
  renderer.setSize(width, height, false);
  renderer.setPixelRatio(1);
  // filmic tone mapping keeps several overlapping lamps from blowing out to white
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.3;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  scene.fog = new THREE.Fog(0x000000, 2, 16);

  // Walls as one instanced mesh; only wall tiles that touch open floor can ever be seen
  const touchesOpen = (x, y) => [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
    .some(([dx, dy]) => grid[y + dy] && grid[y + dy][x + dx] === 0);
  const wallTiles = [];
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++)
      if (grid[y][x] === 1 && touchesOpen(x, y)) wallTiles.push([x, y]);
  // Phong (per-pixel) so lamps light pools on the big flat surfaces; no shine
  const matte = (map) => new THREE.MeshPhongMaterial({ map, specular: 0x000000, shininess: 0 });
  // Each wall tile gets a style from the room it faces (walls.js); one instanced mesh per style
  const wallTextures = createWallTextures();
  const facingRoom = (x, y) => {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      if (grid[y + dy] && grid[y + dy][x + dx] === 0) {
        const r = roomAt(rooms, x + dx, y + dy);
        if (r) return r;
      }
    }
    return null;
  };
  const byStyle = new Map();
  wallTiles.forEach(([x, y]) => {
    const style = wallStyleFor(x, y, facingRoom(x, y));
    if (!byStyle.has(style)) byStyle.set(style, []);
    byStyle.get(style).push([x, y]);
  });
  const wallGeo = new THREE.BoxGeometry(TILE, WALL_H, TILE);
  const m = new THREE.Matrix4();
  const shade = new THREE.Color();
  byStyle.forEach((tiles, style) => {
    const walls = new THREE.InstancedMesh(wallGeo, matte(wallTextures[style]), tiles.length);
    tiles.forEach(([x, y], i) => {
      m.makeTranslation(x * TILE, WALL_H / 2, y * TILE);
      walls.setMatrixAt(i, m);
      walls.setColorAt(i, shade.setScalar(0.86 + tileHash(x, y, 4) * 0.18)); // panels a little lighter or darker
    });
    scene.add(walls);
  });

  const floorTex = floorTexture();
  floorTex.repeat.set(cols, rows);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(cols * TILE, rows * TILE),
    matte(floorTex)
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set((cols - 1) * TILE / 2, 0, (rows - 1) * TILE / 2);
  scene.add(floor);

  const ceilTex = ceilingTexture();
  ceilTex.repeat.set(cols, rows);
  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(cols * TILE, rows * TILE),
    matte(ceilTex)
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(floor.position.x, WALL_H, floor.position.z);
  scene.add(ceiling);

  // Very dim ambient; the helmet lamps do most of the work
  scene.add(new THREE.AmbientLight(0xffffff, 0.1));

  // Each room has a weak ceiling light (half the colony's power is out); corridors stay dark
  // (the feed is grayscale, so only red lights keep their colour; the rest become plain white)
  const fixtureGeo = new THREE.BoxGeometry(1.2, 0.08, 0.4);
  rooms.forEach((r) => {
    const cx = (r.x + (r.w - 1) / 2) * TILE;
    const cz = (r.y + (r.h - 1) / 2) * TILE;
    const c = new THREE.Color(r.light);
    const color = c.r > 2 * c.g && c.r > 2 * c.b ? c : new THREE.Color(0xffffff).multiplyScalar(c.r * 0.3 + c.g * 0.59 + c.b * 0.11);
    const light = new THREE.PointLight(color, 0.55, Math.max(r.w, r.h) * TILE * 0.9, 1.5);
    light.position.set(cx, WALL_H - 0.3, cz);
    scene.add(light);
    const fixture = new THREE.Mesh(fixtureGeo, new THREE.MeshBasicMaterial({ color }));
    fixture.position.set(cx, WALL_H - 0.05, cz);
    scene.add(fixture);
  });

  // Red emergency lights (tile x, y): every few tiles along the corridors plus a corner of each room
  const EMERGENCY_LIGHTS = [
    [12, 5], [16, 5], [20, 5], [24, 5], [28, 5], // north corridor
    [21, 8],                                     // north corridor -> operations
    [11, 15], [15, 15],                          // operations <-> storage
    [28, 16],                                    // operations <-> atmosphere processor
    [21.5, 20], [21.5, 23],                      // main spine
    [6, 10], [6, 21],                            // west corridors
    [36, 11], [36, 22],                          // east corridors
    [13, 26], [17, 26], [27, 26], [31, 26],      // airlock side corridors
    [3, 3], [40, 3], [18, 17], [40, 19],         // room corners: medlab, quarters, ops, processor
    [9, 18], [3, 28], [40, 28],                  // storage, mess hall, armory
  ];
  // Each is a fluorescent-style panel on the ceiling, lying along the corridor it lights
  const EMERGENCY_RED = 0xe00000;
  const panelGeo = new THREE.BoxGeometry(0.95, 0.04, 0.2);   // the glowing tube cover
  const housingGeo = new THREE.BoxGeometry(1.1, 0.07, 0.32); // dark metal casing around it
  const panelMat = new THREE.MeshBasicMaterial({ color: 0xd00000 });
  const housingMat = new THREE.MeshLambertMaterial({ color: 0x2a2d2b });
  const openTile = (x, y) => grid[y] && grid[y][x] === 0;
  EMERGENCY_LIGHTS.forEach(([tx, ty]) => {
    const light = new THREE.PointLight(EMERGENCY_RED, 3.2, 9, 1.2);
    light.position.set(tx * TILE, WALL_H - 0.35, ty * TILE);
    scene.add(light);
    // a corridor running north-south gets the panel turned that way
    const x = Math.round(tx), y = Math.round(ty);
    const northSouth = openTile(x, y - 1) && openTile(x, y + 1) && !(openTile(x - 1, y) && openTile(x + 1, y));
    const housing = new THREE.Mesh(housingGeo, housingMat);
    housing.position.set(tx * TILE, WALL_H - 0.035, ty * TILE);
    const panel = new THREE.Mesh(panelGeo, panelMat);
    panel.position.set(tx * TILE, WALL_H - 0.07, ty * TILE);
    if (northSouth) housing.rotation.y = panel.rotation.y = Math.PI / 2;
    scene.add(housing, panel);
  });

  // Muzzle flashes, tracers and impacts (effects.js)
  const effects = createEffects(scene);

  // ---------- Ceiling vents ----------
  // A black hole in the ceiling with a metal frame around it
  // Keep vents clear of the red light panels: a vent too close to one moves to the nearest free open tile
  const VENT_CLEARANCE = 2; // tiles
  const clearOfLights = (x, y) => EMERGENCY_LIGHTS.every(([lx, ly]) => Math.hypot(lx - x, ly - y) >= VENT_CLEARANCE);
  const vents = VENT_OPENINGS.map(([x, y]) => {
    if (openTile(x, y) && clearOfLights(x, y)) return [x, y];
    let best = null, bestD = Infinity;
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++)
        if (openTile(x + dx, y + dy) && clearOfLights(x + dx, y + dy) && Math.hypot(dx, dy) < bestD) {
          bestD = Math.hypot(dx, dy);
          best = [x + dx, y + dy];
        }
    return best;
  }).filter(Boolean);
  {
    const holeGeo = new THREE.PlaneGeometry(1.1, 1.1);
    const holeMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const frameMat = new THREE.MeshLambertMaterial({ color: 0x4a4e4b });
    const barH = new THREE.BoxGeometry(1.3, 0.06, 0.1), barV = new THREE.BoxGeometry(0.1, 0.06, 1.3);
    vents.forEach(([x, y]) => {
      const cx = x * TILE, cz = y * TILE;
      const hole = new THREE.Mesh(holeGeo, holeMat);
      hole.rotation.x = Math.PI / 2; // faces down
      hole.position.set(cx, WALL_H - 0.005, cz);
      scene.add(hole);
      for (const [geo, dx, dz] of [[barH, 0, -0.6], [barH, 0, 0.6], [barV, -0.6, 0], [barV, 0.6, 0]]) {
        const bar = new THREE.Mesh(geo, frameMat);
        bar.position.set(cx + dx, WALL_H - 0.03, cz + dz);
        scene.add(bar);
      }
    });
  }

  // ---------- Exit ----------
  // The hatch in the outer wall, with a lit EXIT sign, and arrows on the vestibule floor pointing at it
  const exit = rooms.find((r) => r.name === "EXIT");
  {
    const c = document.createElement("canvas");
    c.width = 128; c.height = 160;
    const g = c.getContext("2d");
    g.fillStyle = "#3a3d3b"; g.fillRect(0, 0, 128, 160);           // frame
    g.fillStyle = "#565b58"; g.fillRect(12, 34, 104, 126);          // hatch
    g.strokeStyle = "#202321"; g.lineWidth = 3;
    g.strokeRect(12, 34, 104, 126);
    g.beginPath(); g.moveTo(64, 34); g.lineTo(64, 160); g.stroke(); // split doors
    for (let y = 46; y < 160; y += 16) {                            // hazard stripes along the edges
      g.fillStyle = "#d8b030"; g.fillRect(14, y, 8, 8); g.fillRect(106, y, 8, 8);
    }
    g.fillStyle = "#ff3020"; g.fillRect(30, 6, 68, 22);             // the sign
    g.fillStyle = "#ffffff";
    g.font = "bold 18px monospace";
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText("EXIT", 64, 18);
    const door = new THREE.Mesh(new THREE.PlaneGeometry(TILE * 0.95, WALL_H * 0.95), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c) }));
    door.position.set((EXIT_DOOR.x - 0.5) * TILE - 0.01, WALL_H * 0.475, EXIT_DOOR.y * TILE);
    door.rotation.y = -Math.PI / 2; // facing west, into the vestibule
    scene.add(door);
    const glow = new THREE.PointLight(0xff3020, 0.8, TILE * 3, 1.5);
    glow.position.set((EXIT_DOOR.x - 1) * TILE, WALL_H - 0.2, EXIT_DOOR.y * TILE);
    scene.add(glow);

    const f = document.createElement("canvas");
    f.width = 256; f.height = 128;
    const fg = f.getContext("2d");
    fg.fillStyle = "#ffffff";
    for (let i = 0; i < 3; i++) { // chevrons pointing east, at the door
      const x = 30 + i * 70;
      fg.beginPath();
      fg.moveTo(x, 24); fg.lineTo(x + 40, 64); fg.lineTo(x, 104); fg.lineTo(x + 18, 104); fg.lineTo(x + 58, 64); fg.lineTo(x + 18, 24);
      fg.fill();
    }
    const arrows = new THREE.Mesh(new THREE.PlaneGeometry(TILE * 2.4, TILE * 1.2), new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(f), color: 0xd84a3a, transparent: true, opacity: 0.8, depthWrite: false,
    }));
    arrows.rotation.x = -Math.PI / 2;
    arrows.position.set((exit.x + (exit.w - 1) / 2) * TILE, 0.02, EXIT_DOOR.y * TILE);
    scene.add(arrows);
  }

  // ---------- Fog ----------
  // Which fog zone a (fractional) tile position is in, if any
  const fogZoneAt = (x, y) => {
    const tx = Math.round(x), ty = Math.round(y);
    return FOG_ZONES.find(({ area: [x1, y1, x2, y2] }) => tx >= x1 && tx <= x2 && ty >= y1 && ty <= y2) || null;
  };
  const fogAt = (x, y) => !!fogZoneAt(x, y);

  // Drifting mist: big soft sprites, faded by the scene fog so they only show up close
  const mistTexture = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d");
    for (let i = 0; i < 9; i++) {
      const x = 16 + Math.random() * 32, y = 16 + Math.random() * 32, r = 10 + Math.random() * 16;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, "rgba(255,255,255,0.35)");
      grad.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 64);
    }
    return new THREE.CanvasTexture(c);
  })();
  const mist = [];
  FOG_ZONES.forEach(({ area: [x1, y1, x2, y2] }) => {
    const tiles = (x2 - x1 + 1) * (y2 - y1 + 1);
    for (let i = 0; i < Math.ceil(tiles / 1.5); i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: mistTexture, color: 0x808080, transparent: true, opacity: 0.3, depthWrite: false,
      }));
      const base = new THREE.Vector3((x1 + Math.random() * (x2 - x1)) * TILE, 0.4 + Math.random() * 1.8, (y1 + Math.random() * (y2 - y1)) * TILE);
      sp.position.copy(base);
      sp.scale.setScalar(2.5 + Math.random() * 2);
      sp.material.rotation = Math.random() * Math.PI * 2;
      scene.add(sp);
      mist.push({ sp, base, phase: Math.random() * 10, spin: (Math.random() - 0.5) * 0.15 });
    }
  });
  let mistTime = 0;
  function updateMist(dt) {
    mistTime += dt;
    for (const m of mist) {
      const t = mistTime * 0.25 + m.phase;
      m.sp.position.set(m.base.x + Math.sin(t) * 0.6, m.base.y + Math.sin(t * 0.7) * 0.15, m.base.z + Math.cos(t * 0.8) * 0.6);
      m.sp.material.rotation += m.spin * dt;
      m.sp.material.opacity = 0.26 + Math.sin(t * 1.3) * 0.08;
    }
  }
  // The camera's view closes in (grey, short range) while its soldier is inside fog
  const CLEAR_FOG = { near: 2, far: 16, color: new THREE.Color(0x000000) };
  const THICK_FOG = { near: 0.2, far: 5, color: new THREE.Color(0x181818) };

  // ---------- Navigation helpers ----------
  const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]]; // E S W N in tile coords (north = up on the map)
  const DIR_NAMES = ["east", "south", "west", "north"];
  const isOpen = (tx, ty) => ty >= 0 && ty < rows && tx >= 0 && tx < cols && grid[ty][tx] === 0;
  const openDirsFrom = (tx, ty) =>
    DIRS.map((d, i) => (isOpen(tx + d[0], ty + d[1]) ? i : -1)).filter((i) => i >= 0);
  const roomOf = (x, y) => roomAt(rooms, x, y);
  // heading that looks along a tile direction; 0 looks toward -Z
  const headingFor = ([dx, dy]) => Math.atan2(-dx, -dy);
  const angleDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
  const idx = (x, y) => y * cols + x;

  // Breadth-first search over open tiles. Returns distances and back-pointers.
  function bfs(fx, fy, passable = isOpen) {
    const dist = new Int32Array(rows * cols).fill(-1);
    const prev = new Int32Array(rows * cols).fill(-1);
    const queue = [[fx, fy]];
    dist[idx(fx, fy)] = 0;
    for (let q = 0; q < queue.length; q++) {
      const [x, y] = queue[q];
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (!passable(nx, ny) || dist[idx(nx, ny)] >= 0) continue;
        dist[idx(nx, ny)] = dist[idx(x, y)] + 1;
        prev[idx(nx, ny)] = idx(x, y);
        queue.push([nx, ny]);
      }
    }
    return { dist, prev };
  }

  // Soldiers' routes: 8 directions, a diagonal step costs √2. A diagonal is only taken when both tiles beside it
  // are open too, so nobody clips a wall corner (in 1-tile corridors they still walk straight).
  // Same result shape as bfs(); distances are in tiles but no longer whole numbers.
  const MOVES = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [-1, -1], [1, -1]];
  function routeSearch(fx, fy, passable = isOpen) {
    const dist = new Float32Array(rows * cols).fill(-1);
    const prev = new Int32Array(rows * cols).fill(-1);
    const heap = [[0, idx(fx, fy)]]; // binary min-heap of [distance, tile index]
    const push = (e) => {
      heap.push(e);
      for (let i = heap.length - 1; i > 0;) {
        const p = (i - 1) >> 1;
        if (heap[p][0] <= heap[i][0]) break;
        [heap[p], heap[i]] = [heap[i], heap[p]];
        i = p;
      }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        for (let i = 0; ;) {
          const l = 2 * i + 1, r = l + 1;
          let m = i;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]];
          i = m;
        }
      }
      return top;
    };
    dist[idx(fx, fy)] = 0;
    const done = new Uint8Array(rows * cols);
    while (heap.length) {
      const [d, i] = pop();
      if (done[i]) continue;
      done[i] = 1;
      const x = i % cols, y = (i / cols) | 0;
      for (const [dx, dy] of MOVES) {
        const nx = x + dx, ny = y + dy;
        if (!passable(nx, ny)) continue;
        if (dx && dy && (!passable(x + dx, y) || !passable(x, y + dy))) continue;
        const j = idx(nx, ny), nd = d + (dx && dy ? Math.SQRT2 : 1);
        if (dist[j] >= 0 && dist[j] <= nd + 1e-6) continue;
        dist[j] = nd;
        prev[j] = i;
        push([nd, j]);
      }
    }
    return { dist, prev };
  }

  function pathFrom(search, tx, ty) {
    const path = [];
    for (let i = idx(tx, ty); search.prev[i] >= 0; i = search.prev[i]) path.unshift([i % cols, (i / cols) | 0]);
    return path; // excludes the start tile
  }

  // Rooms reachable from a corridor tile without passing through another room
  function corridorLeadsTo(x, y, exclude) {
    const corridor = (cx, cy) => isOpen(cx, cy) && !roomOf(cx, cy);
    const seen = bfs(x, y, corridor);
    const found = new Set();
    for (let i = 0; i < seen.dist.length; i++) {
      if (seen.dist[i] < 0) continue;
      const cx = i % cols, cy = (i / cols) | 0;
      for (const [dx, dy] of DIRS) {
        const r = roomOf(cx + dx, cy + dy);
        if (r && r !== exclude && isOpen(cx + dx, cy + dy)) found.add(r.name);
      }
    }
    return [...found];
  }

  // Exits of every room (doorway tiles just outside the room) and where they lead
  const roomExits = new Map(rooms.map((r) => {
    const exits = [];
    for (let y = r.y - 1; y <= r.y + r.h; y++) {
      for (let x = r.x - 1; x <= r.x + r.w; x++) {
        const inside = x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
        if (inside || !isOpen(x, y) || roomOf(x, y)) continue;
        const direction = y < r.y ? "north" : y >= r.y + r.h ? "south" : x < r.x ? "west" : "east";
        const leads_to = corridorLeadsTo(x, y, r);
        // a wide doorway is several tiles: list it once
        if (!exits.some((e) => e.direction === direction && e.leads_to.join() === leads_to.join())) {
          exits.push({ direction, door: { x, y }, leads_to });
        }
      }
    }
    return [r.name, exits];
  }));

  const colonyMap = rooms.map((r) => ({
    name: r.name, x: r.x, y: r.y, w: r.w, h: r.h,
    exits: roomExits.get(r.name).map((e) => `${e.direction} -> ${e.leads_to.join(" / ") || "dead end"}`),
  }));

  function findRoom(query) {
    const q = String(query || "").trim().toLowerCase();
    if (!q) return null;
    return rooms.find((r) => r.name.toLowerCase() === q || r.label.toLowerCase() === q || r.aliases.includes(q)) ||
      rooms.find((r) => r.name.toLowerCase().includes(q) || r.aliases.some((a) => a.includes(q) || q.includes(a))) ||
      null;
  }

  // ---------- Soldiers ----------
  // What they decide to do lives in behavior.js; this file walks, turns, aims, fires and animates them.
  const bodyMat = new THREE.MeshLambertMaterial({ color: 0x8a8f86 });
  const visorMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

  let onEvent = () => {};
  let onFire = () => {}; // (soldier, shot times in seconds from now)

  function makeSoldier(def, index) {
    const [sx, sy] = starts[index % starts.length];

    const camera = new THREE.PerspectiveCamera(78, width / height, 0.05, 40);
    scene.add(camera);
    const lamp = new THREE.SpotLight(0xffffff, 2.0, 20, Math.PI / 3.6, 0.6, 1);
    lamp.position.set(0.15, 0.1, 0);
    camera.add(lamp);
    camera.add(lamp.target);
    lamp.target.position.set(0, -0.2, -5);
    camera.add(new THREE.PointLight(0xffffff, 0.4, 5)); // spill around the soldier

    // Placeholder figure, replaced by the 3D model once it loads
    const body = new THREE.Group();
    const placeholder = new THREE.Group();
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 1.25, 8), bodyMat);
    torso.position.y = 0.85;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 6), bodyMat);
    head.position.y = 1.62;
    const helmetLamp = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.05), visorMat);
    helmetLamp.position.set(0.1, 1.7, -0.16);
    placeholder.add(torso, head, helmetLamp);
    body.add(placeholder);
    scene.add(body);

    return {
      ...def,
      camera, body, placeholder,
      anim: null,                  // { mixer, actions, state } once the model is loaded
      tx: sx, ty: sy,              // tile currently standing on / leaving
      nx: sx, ny: sy,              // tile walking to
      progress: 1,                 // 0..1 between tiles
      heading: 0,
      dir: -1,                     // index into MOVES (8 directions)
      stepLen: 1,                  // length of the current step in tiles (√2 on a diagonal)
      lookOffset: 0,               // head turn relative to the body
      lookTarget: 0,
      walked: Math.random() * 10,  // distance for head bob
      lastRoom: roomOf(sx, sy),
      moving: false,
      fireLeft: 0,                 // seconds of firing left (stands still meanwhile)
      fireTime: 0,                 // seconds since this burst started
      fireCooldown: 0,
      shots: [],                   // shot times still to come in this burst
      recoil: 0,                   // 1 right after a shot, fades to 0
      muzzle: effects.muzzleLight(), // light that flashes with each round
    };
  }

  const soldiers = squad.map(makeSoldier);

  // ---------- Soldier model ----------
  function loadFBX(url) {
    return new Promise((resolve, reject) => new THREE.FBXLoader().load(encodeURI(url), resolve, undefined, reject));
  }

  // The game moves soldiers itself, so pin the hips horizontally (drop the clip's root motion)
  function inPlace(clip) {
    const t = clip.tracks.find((tr) => /Hips\.position$/.test(tr.name));
    if (t) for (let i = 0; i < t.values.length; i += 3) { t.values[i] = t.values[0]; t.values[i + 2] = t.values[2]; }
    return clip;
  }

  // Grayscale a model's own colours (skin, uniform...) so only red light tints it on the feed
  function grayscale(model, setup = () => {}) {
    model.traverse((o) => {
      if (!o.isMesh) return;
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((mat) => {
        setup(mat);
        mat.color.setScalar(mat.color.r * 0.3 + mat.color.g * 0.59 + mat.color.b * 0.11);
        mat.onBeforeCompile = (shader) => {
          shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>",
            "#include <map_fragment>\n  diffuseColor.rgb = vec3(dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11)));");
        };
        mat.needsUpdate = true;
      });
    });
  }

  // How far a clip's hips travel per second (in the clip's own units), measured before inPlace()
  function hipsSpeed(clip) {
    const t = clip.tracks.find((tr) => /Hips\.position$/.test(tr.name));
    if (!t || !(clip.duration > 0)) return 0;
    const v = t.values, n = v.length;
    return Math.hypot(v[n - 3] - v[0], v[n - 1] - v[2]) / clip.duration;
  }

  // ---------- Rifle ----------
  // A simple black rifle built from boxes and a cylinder (the soldier model comes unarmed). Built along +Z with the
  // pistol grip at the origin, so lookAt() points the barrel. Each frame it sits in the right hand, aimed at the left.
  const rifleMat = new THREE.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 0.55, metalness: 0.5 });
  const rifleParts = [ // [geometry, x, y, z, tilt about X]
    [new THREE.BoxGeometry(0.055, 0.085, 0.40), 0, 0.035, 0.10, 0],    // receiver
    [new THREE.BoxGeometry(0.06, 0.065, 0.24), 0, 0.03, 0.40, 0],      // handguard
    [new THREE.CylinderGeometry(0.012, 0.012, 0.16, 8), 0, 0.04, 0.58, Math.PI / 2], // barrel
    [new THREE.BoxGeometry(0.045, 0.085, 0.24), 0, 0.005, -0.21, 0],   // stock
    [new THREE.BoxGeometry(0.035, 0.10, 0.045), 0, -0.04, 0.0, -0.3],  // pistol grip
    [new THREE.BoxGeometry(0.03, 0.14, 0.065), 0, -0.065, 0.17, 0.15], // magazine
    [new THREE.BoxGeometry(0.022, 0.035, 0.14), 0, 0.09, 0.06, 0],     // sight rail
  ];
  function makeRifle() {
    const rifle = new THREE.Group();
    for (const [geo, x, y, z, tilt] of rifleParts) {
      const m = new THREE.Mesh(geo, rifleMat);
      m.position.set(x, y, z);
      m.rotation.x = tilt;
      rifle.add(m);
    }
    return rifle;
  }

  const _grip = new THREE.Vector3(), _palm = new THREE.Vector3(), _left = new THREE.Vector3();
  const _dir = new THREE.Vector3(), _look = new THREE.Vector3();
  const LOW_READY = new THREE.Vector3(0, -0.57, -0.82); // body space: forward and down, when the hands let go
  function holdRifle(s, dt) {
    const { rifle, rightHand, rightPalm, leftHand } = s.anim;
    rightHand.getWorldPosition(_grip);
    if (rightPalm) _grip.lerp(rightPalm.getWorldPosition(_palm), 0.5); // between wrist and knuckles
    leftHand.getWorldPosition(_left);
    _dir.subVectors(_left, _grip);
    const span = _dir.length();
    // Both hands on the rifle (walk, idle, fire): point it at the left hand. Otherwise (the run swings its arms)
    // carry it pointing forward and down.
    if (span > 0.12 && span < 0.6) _dir.divideScalar(span);
    else _dir.copy(LOW_READY).applyQuaternion(s.body.quaternion);
    s.rifleDir = s.rifleDir ? s.rifleDir.lerp(_dir, Math.min(1, dt * 14)).normalize() : _dir.clone();
    rifle.position.copy(s.body.worldToLocal(_grip.clone()));
    rifle.lookAt(_look.addVectors(_grip, s.rifleDir));
  }

  // The clips were recorded on the Vanguard skeleton. Each soldier model can name its bones differently
  // ("mixamorig1Hips" vs "mixamorigHips") and have other proportions, so keep only the bone rotations plus the
  // hips position, renamed for that skeleton and with the hips height scaled to its body.
  function findHips(root) {
    let hips = null;
    root.traverse((o) => { if (!hips && o.isBone && /Hips$/.test(o.name)) hips = o; });
    return hips;
  }
  function retarget(clip, prefix, hipsScale) {
    const tracks = clip.tracks
      .filter((t) => /\.quaternion$/.test(t.name) || /Hips\.position$/.test(t.name))
      .map((t) => {
        const tr = t.clone();
        tr.name = t.name.replace(/^mixamorig\d*/, prefix);
        if (/Hips\.position$/.test(t.name)) for (let i = 0; i < tr.values.length; i++) tr.values[i] *= hipsScale;
        return tr;
      });
    return new THREE.AnimationClip(clip.name, clip.duration, tracks);
  }

  async function loadCharacter() {
    if (!THREE.FBXLoader || !THREE.SkeletonUtils) return;
    const [walkFbx, idleFbx, fireFbx, runFbx] = await Promise.all(
      [CHARACTER.walk, CHARACTER.idle, CHARACTER.fire, CHARACTER.run].map(loadFBX));
    // the run clip's speed, scaled by the walk clip whose real speed is known
    const walkRaw = hipsSpeed(walkFbx.animations[0]), runRaw = hipsSpeed(runFbx.animations[0]);
    const runSpeed = walkRaw > 0 && runRaw > walkRaw ? CHARACTER.walkClipSpeed * runRaw / walkRaw : CHARACTER.runClipSpeed;
    const clips = {
      walk: inPlace(walkFbx.animations[0]),
      idle: inPlace(idleFbx.animations[0]),
      fire: inPlace(fireFbx.animations[0]),
      run: inPlace(runFbx.animations[0]),
    };
    const clipHipsY = findHips(walkFbx)?.position.y || 1;

    // Each soldier gets their own model as soon as it arrives (they're big); the shared one stands in for anyone
    // without a model of their own or whose model fails to load.
    let shared = null;
    const sharedModel = () => (shared ??= loadFBX(CHARACTER.model));
    await Promise.all(soldiers.map(async (s) => {
      const url = CHARACTER.models[s.callsign];
      let model;
      try {
        model = await (url ? loadFBX(url) : sharedModel());
      } catch (err) {
        console.warn(`Model for ${s.callsign} not loaded, using the shared one:`, err);
        model = await sharedModel();
      }
      dressSoldier(s, model, clips, clipHipsY, runSpeed);
    }));
  }

  function dressSoldier(s, model, rawClips, clipHipsY, runSpeed) {
    const hips = findHips(model);
    if (!hips) { console.warn(`${s.callsign}'s model has no Mixamo skeleton`); return; }
    const prefix = hips.name.slice(0, -"Hips".length);
    if (!model.userData.ready) { // a model shared by several soldiers is prepared once
      grayscale(model);
      model.userData.scale = CHARACTER.height / new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3()).y;
      model.userData.ready = true;
    }
    const hipsScale = hips.position.y / clipHipsY;
    const clip = {};
    for (const k in rawClips) clip[k] = retarget(rawClips[k], prefix, hipsScale);

    const fig = THREE.SkeletonUtils.clone(model);
    fig.scale.setScalar(model.userData.scale);
    fig.rotation.y = Math.PI; // Mixamo characters face +Z; soldiers face -Z
    fig.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
    const mixer = new THREE.AnimationMixer(fig);
    const walk = mixer.clipAction(clip.walk);
    walk.time = Math.random() * clip.walk.duration; // squad not in lockstep
    walk.play();
    walk.enabled = false; // off until the first crossfade
    const idle = mixer.clipAction(clip.idle);
    idle.paused = true; // hold the first frame
    idle.play();
    const fire = mixer.clipAction(clip.fire); // loops for as long as the burst lasts
    fire.play();
    fire.enabled = false;
    const run = mixer.clipAction(clip.run);
    run.play();
    run.enabled = false;
    s.body.remove(s.placeholder);
    s.body.add(fig);
    s.anim = { mixer, actions: { walk, idle, fire, run }, state: "idle", runSpeed };
    const rightHand = fig.getObjectByName(prefix + "RightHand");
    const leftHand = fig.getObjectByName(prefix + "LeftHand");
    if (rightHand && leftHand) {
      const rifle = makeRifle();
      s.body.add(rifle);
      Object.assign(s.anim, { rifle, rightHand, leftHand, rightPalm: fig.getObjectByName(prefix + "RightHandMiddle1") });
    }
  }


  function animateSoldier(s, dt, moving, turning, firing) {
    const a = s.anim;
    const running = moving && s.speed > 2.2;
    const state = firing ? "fire" : running ? "run" : moving || turning ? "walk" : "idle";
    if (state !== a.state) {
      const to = a.actions[state];
      to.enabled = true; // a finished fade-out disables the action
      if (state === "fire") to.time = 0;
      a.actions[a.state].crossFadeTo(to, state === "fire" || a.state === "fire" || running ? 0.2 : 0.3, false);
      a.state = state;
    }
    // match stride to ground speed; shuffle slower when turning on the spot
    a.actions.walk.timeScale = moving ? s.speed / CHARACTER.walkClipSpeed : 0.6;
    a.actions.run.timeScale = s.speed / a.runSpeed;
    a.mixer.update(dt);
    if (a.rifle) holdRifle(s, dt);
  }

  loadCharacter().catch((err) => console.warn("Soldier model not loaded, using placeholder figure:", err));

  // ---------- Aliens ----------
  // They start in the ventilation ducts and drop in through the ceiling vents (hostiles.js).
  const aliens = [];
  let alienTemplate = null; // { model, scale, clips } once the model has loaded

  async function loadAliens() {
    const model = await loadFBX(XENO.model);
    const texLoader = new THREE.TextureLoader();
    grayscale(model, (mat) => {
      const tex = XENO.textures[mat.name.toLowerCase()];
      if (!tex) return;
      mat.map = texLoader.load(tex[0]);
      mat.normalMap = texLoader.load(tex[1]);
      mat.color.setScalar(XENO.darkness); // darker than its texture: a black, glossy creature
      if (mat.specular) mat.specular.set(0x777777); // wet shine
      if ("shininess" in mat) mat.shininess = 60;
    });
    const scale = XENO.height / new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3()).y;
    const clip = (name) => model.animations.find((c) => new RegExp(name + "$", "i").test(c.name));
    alienTemplate = { model, scale, clips: { idle: clip("idle") || model.animations[0], walk: clip("walk"), run: clip("run1") } };
    for (let i = 0; i < VENTS.start; i++) { // (none by default)
      const [x, y] = hostiles.edgePoint();
      spawnAlien(x, y);
    }
  }

  // A new hostile in the ducts at (x, y) tiles: hidden until it drops through a vent
  function spawnAlien(x, y) {
    if (!alienTemplate) return;
    const { model, scale, clips } = alienTemplate;
    const fig = THREE.SkeletonUtils.clone(model);
    fig.scale.setScalar(scale);
    fig.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
    const group = new THREE.Group();
    group.add(fig);
    scene.add(group);
    const mixer = new THREE.AnimationMixer(fig);
    const actions = {};
    for (const [name, c] of Object.entries(clips)) if (c) actions[name] = mixer.clipAction(c);
    if (actions.idle) {
      actions.idle.time = Math.random() * clips.idle.duration;
      actions.idle.play();
    }
    const alien = { x, y, group, mixer, actions, hp: BEHAVIOR.hp.alien, dead: false };
    hostiles.initVent(alien);
    aliens.push(alien);
  }

  if (THREE.FBXLoader && THREE.SkeletonUtils) {
    loadAliens().catch((err) => console.warn("Alien model not loaded:", err));
  }

  // Killed: a last big splash and it's gone (death animations come later)
  function killAlien(a) {
    effects.impact(new THREE.Vector3(a.x * TILE, 1.0, a.y * TILE), "flesh", new THREE.Vector3(0, -0.3, 0), true);
    scene.remove(a.group);
  }

  function killSoldier(s) {
    scene.remove(s.body);
    s.muzzle.light.intensity = 0;
    effects.impact(new THREE.Vector3(s.body.position.x, 1.0, s.body.position.z), "flesh", new THREE.Vector3(0, -0.3, 0), true);
  }

  // ---------- Rounds ----------
  // Where the rifle's muzzle is when aiming: ahead of the body, just below and right of the eyes
  function muzzlePoint(s) {
    const h = s.heading + s.lookOffset;
    const fwd = new THREE.Vector3(-Math.sin(h), 0, -Math.cos(h));
    const right = new THREE.Vector3(Math.cos(h), 0, -Math.sin(h));
    const p = s.body.position.clone().addScaledVector(fwd, 0.8).addScaledVector(right, 0.07);
    p.y = 1.42;
    return p;
  }

  // Follow a round from `from` along `dir` until it hits a wall, the floor or the ceiling
  function bulletEnd(from, dir) {
    const p = from.clone();
    const step = dir.clone().multiplyScalar(0.1);
    for (let i = 0; i < 400; i++) {
      p.add(step);
      if (p.y <= 0.02 || p.y >= WALL_H - 0.02) return p;
      if (!isOpen(Math.round(p.x / TILE), Math.round(p.z / TILE))) return p.addScaledVector(step, -0.5);
    }
    return p;
  }

  // One round: the brain decides hit or miss; here it is drawn from the muzzle to where it lands
  function fireRound(s) {
    const { target, hit } = brain.shot(s);
    const from = muzzlePoint(s);
    effects.muzzle(s.muzzle, from);
    let aim;
    if (target) {
      aim = new THREE.Vector3(target.x * TILE, 1.1, target.y * TILE);
      if (!hit) { // off to one side, high or low: it carries on to the wall behind
        const side = new THREE.Vector3(aim.z - from.z, 0, from.x - aim.x).normalize();
        aim.addScaledVector(side, (Math.random() < 0.5 ? -1 : 1) * (0.45 + Math.random() * 0.6));
        aim.y = 0.3 + Math.random() * 1.7;
      }
    } else {
      const h = s.heading + s.lookOffset;
      aim = from.clone().add(new THREE.Vector3(-Math.sin(h), 0, -Math.cos(h)));
    }
    const dir = aim.clone().sub(from).normalize();
    // a hit lands on the hostile's body, just short of its centre
    const end = hit ? aim.addScaledVector(dir, -0.3) : bulletEnd(from, dir);
    effects.tracer(from, end);
    effects.impact(end, hit ? "flesh" : "wall", dir);
  }

  const here = (s) => (s.progress >= 1 ? [s.tx, s.ty] : [s.nx, s.ny]);

  function stepTo(s, d) {
    s.dir = d;
    s.nx = s.tx + MOVES[d][0];
    s.ny = s.ty + MOVES[d][1];
    s.stepLen = MOVES[d][0] && MOVES[d][1] ? Math.SQRT2 : 1; // in tiles
    s.progress = 0;
  }

  // The soldiers' minds (see behavior.js)
  const brain = createSquadBrain({
    nav: { isOpen, cols, rows, DIRS, DIR_NAMES, bfs: routeSearch, pathFrom, idx, roomOf, rooms, findRoom, headingFor, angleDiff, fogAt },
    soldiers, aliens, killAlien, killSoldier,
    emit: (s, text) => onEvent(s, text),
  });

  // The hostiles' minds (see hostiles.js): touching a soldier kills them
  const hostiles = createHostiles({
    nav: { isOpen, DIRS, bfs, pathFrom, idx, angleDiff }, TILE, ceiling: WALL_H, soldiers, fogAt,
    vents, cols, rows, spawn: (x, y) => spawnAlien(x, y),
    otherPrey: () => [],
    killOther: () => {},
    killSoldier: (s) => {
      const room = roomOf(Math.round(s.tx), Math.round(s.ty));
      brain.hurt(s, s.hp, `was taken by a hostile in ${room ? room.name : "a corridor"}`);
    },
  });

  // The mission: get the squad out through the EXIT door (mission.js)
  let onMissionEnd = () => {};
  const mission = createMission({
    exit, soldiers, roomOf, leave: (s) => brain.leave(s),
    emit: (soldier, text) => onEvent(soldier, text),
    end: (result) => onMissionEnd(result),
  });

  // ---------- What each soldier can perceive ----------
  function surroundings(s) {
    const [x, y] = here(s);
    const room = roomOf(x, y);

    // how far the soldier can see straight down each direction, and which rooms that view opens into
    const lineOfSight = {};
    DIRS.forEach(([dx, dy], d) => {
      let n = 0;
      const seen = [];
      while (isOpen(x + dx * (n + 1), y + dy * (n + 1)) && n < 30) {
        n++;
        const r = roomOf(x + dx * n, y + dy * n);
        if (r && r !== room && !seen.includes(r.name)) seen.push(r.name);
      }
      lineOfSight[DIR_NAMES[d]] = n === 0 ? "wall" : `${n} tile${n === 1 ? "" : "s"} clear` + (seen.length ? `, opens into ${seen.join(", ")}` : "");
    });

    const search = bfs(x, y);
    const nearby = soldiers
      .filter((o) => o !== s)
      .map((o) => { const [ox, oy] = here(o); return { o, d: search.dist[idx(ox, oy)] }; })
      .filter(({ o, d }) => d >= 0 && (d <= 8 || (room && roomOf(...here(o)) === room)))
      .map(({ o, d }) => `${o.callsign} (unit ${o.id}), ${d} tiles away`);

    return {
      description: (room ? room.desc : "Narrow service corridor. Dark, pipes along the ceiling, condensation dripping.") +
        (fogZoneAt(x, y) ? ` ${fogZoneAt(x, y).what} Visibility a few tiles.` : ""),
      exits: room
        ? roomExits.get(room.name).map((e) => `${e.direction} door -> ${e.leads_to.join(" / ") || "dead end"}`)
        : [`this corridor connects to: ${corridorLeadsTo(x, y, null).join(", ")}`],
      line_of_sight: lineOfSight,
      nearby_squad: nearby.length ? nearby : ["nobody within 8 tiles"],
    };
  }

  const compass4 = (angle) => DIR_NAMES[[0, 1, 2, 3].reduce((best, i) =>
    Math.abs(angleDiff(angle, headingFor(DIRS[i]))) < Math.abs(angleDiff(angle, headingFor(DIRS[best]))) ? i : best, 0)];

  function unitStatus(s) {
    const [x, y] = here(s);
    if (s.dead) return { unit: s.id, name: s.name, location: roomOf(x, y)?.name ?? "CORRIDOR", position: { x, y }, ...brain.describe(s) };
    return {
      unit: s.id,
      name: s.name,
      location: roomOf(x, y)?.name ?? "CORRIDOR",
      // grid coordinates (same as the tactical map); x grows east, y grows south
      position: { x, y },
      facing: compass4(s.heading),
      looking: compass4(s.heading + s.lookOffset),
      ...brain.describe(s),
      moving: s.moving,
      firing: s.fireLeft > 0,
      open_directions: openDirsFrom(x, y).map((i) => DIR_NAMES[i]),
      surroundings: surroundings(s),
    };
  }

  function status() {
    return {
      grid_size: { width: cols, height: rows },
      units: soldiers.map(unitStatus),
      squad: brain.squadStatus(),
      mission: mission.status(),
      colony_map: colonyMap,
    };
  }

  // Rapid bursts of 3-7 rounds after raising the rifle; returns shot times in seconds
  function burstPattern(duration) {
    const times = [];
    let t = 0.35;
    while (t < duration - 0.3) {
      const rounds = 5 + Math.floor(Math.random() * 7); // 5-11 rounds, then a short pause
      for (let i = 0; i < rounds && t < duration - 0.3; i++, t += 0.07) times.push(t);
      t += 0.15 + Math.random() * 0.3;
    }
    return times;
  }

  // Stop and fire a burst; returns nothing, tells main.js when each shot sounds
  function startFiring(s) {
    const duration = 1.8 + Math.random() * 1.6; // seconds
    s.fireLeft = duration;
    s.fireTime = 0;
    s.shots = burstPattern(duration);
    onFire(s, s.shots.slice());
  }

  function updateSoldier(s, dt) {
    if (s.dead) return;
    if (s.progress >= 1 && (s.tx !== s.nx || s.ty !== s.ny)) {
      s.tx = s.nx; s.ty = s.ny;
      brain.arrived(s);
    }
    brain.update(s, dt); // sets path, halt, speed, target, wantFire, gaze, glance

    // Firing: bursts while the brain wants to and the rifle points at the target
    if (s.fireLeft > 0) {
      s.fireTime += dt;
      s.fireLeft -= dt;
      while (s.shots.length && s.shots[0] <= s.fireTime) { s.shots.shift(); s.recoil = 1; fireRound(s); }
      if (s.fireLeft <= 0) s.fireCooldown = 0.25 + Math.random() * 0.5;
    } else if (s.fireCooldown > 0) {
      s.fireCooldown -= dt;
    }
    const aimed = s.target && s.gaze != null && Math.abs(angleDiff(s.heading + s.lookOffset, s.gaze)) < 0.3;
    if (s.fireLeft <= 0 && s.wantFire && aimed && s.fireCooldown <= 0) startFiring(s);
    const firing = s.fireLeft > 0;
    s.recoil = Math.max(0, s.recoil - dt * 14);

    // Next step along the route
    if (s.progress >= 1 && !s.halt && !s.target && s.path.length) {
      const [x, y] = s.path[0];
      const d = MOVES.findIndex(([dx, dy]) => dx === x - s.tx && dy === y - s.ty);
      if (d < 0) { s.path = []; s.goalKey = null; } // route no longer starts here: replan
      else { s.path.shift(); stepTo(s, d); }
    }
    // stops mid-step to aim or fire
    const walking = s.progress < 1 && !firing && !s.target;

    // Body turns toward the way it walks, or (standing) toward what it watches; the head adds a glance
    const want = walking ? headingFor(MOVES[s.dir]) : s.gaze != null ? s.gaze : s.heading;
    const diff = angleDiff(s.heading, want);
    s.heading += Math.sign(diff) * Math.min(Math.abs(diff), TURN_SPEED * (s.speed > 2.2 ? 1.6 : 1) * dt);
    if (walking) {
      s.restHeading = headingFor(MOVES[s.dir]);
      const toGaze = s.gaze != null ? angleDiff(s.heading, s.gaze) : 0;
      s.lookTarget = Math.max(-1.3, Math.min(1.3, toGaze + s.glance));
    } else {
      s.lookTarget = s.target ? 0 : s.glance;
    }
    s.lookOffset += (s.lookTarget - s.lookOffset) * Math.min(1, dt * 2.5);

    let moving = false;
    if (walking && Math.abs(diff) < 0.15) {
      s.progress = Math.min(1, s.progress + (s.speed * dt) / (TILE * (s.stepLen || 1)));
      s.walked += s.speed * dt;
      moving = true;
    }
    s.moving = moving;

    const px = (s.tx + (s.nx - s.tx) * s.progress) * TILE;
    const pz = (s.ty + (s.ny - s.ty) * s.progress) * TILE;
    const bobRate = s.speed > 2.2 ? 1.4 : 1;
    const bob = moving ? Math.sin(s.walked * 5.5 * bobRate) * 0.045 * bobRate : 0;
    const sway = moving ? Math.sin(s.walked * 2.75 * bobRate) * 0.025 : 0;

    // each shot kicks the helmet camera up a little
    const kick = s.recoil * s.recoil;
    s.camera.position.set(px + sway, EYE_H + bob, pz);
    s.camera.rotation.set(-0.04 + bob * 0.3 + kick * 0.035, s.heading + s.lookOffset + kick * (Math.random() - 0.5) * 0.03,
      sway * 0.6 + kick * (Math.random() - 0.5) * 0.02, "YXZ");
    s.body.rotation.y = s.heading + s.lookOffset;
    if (s.anim) {
      s.body.position.set(px, 0, pz); // the walk clip has its own bob
      animateSoldier(s, dt, moving, Math.abs(diff) >= 0.15, firing);
    } else {
      s.body.position.set(px + sway, bob * 0.5, pz);
    }
  }

  function update(dt) {
    brain.tick(dt);
    soldiers.forEach((s) => {
      updateSoldier(s, dt);
      const [x, y] = [s.tx + (s.nx - s.tx) * s.progress, s.ty + (s.ny - s.ty) * s.progress];
      s.fogMix = (s.fogMix || 0) + ((fogAt(x, y) ? 1 : 0) - (s.fogMix || 0)) * Math.min(1, dt * 1.5);
    });
    hostiles.tick(dt, aliens);
    aliens.forEach((a) => hostiles.update(a, dt));
    mission.update(dt);
    effects.update(dt);
    updateMist(dt);
  }

  // Render from one soldier's helmet camera (their own body hidden)
  function render(index) {
    soldiers.forEach((s, i) => (s.body.visible = !s.dead && i !== index));
    const k = soldiers[index].fogMix || 0;
    scene.fog.near = CLEAR_FOG.near + (THICK_FOG.near - CLEAR_FOG.near) * k;
    scene.fog.far = CLEAR_FOG.far + (THICK_FOG.far - CLEAR_FOG.far) * k;
    scene.fog.color.copy(CLEAR_FOG.color).lerp(THICK_FOG.color, k);
    renderer.render(scene, soldiers[index].camera);
  }

  update(0);
  return {
    canvas: renderer.domElement, update, render, grid, rooms, soldiers, aliens, status,
    fogZones: FOG_ZONES.map((z) => z.area),
    vents, exit, exitDoor: EXIT_DOOR, mission,
    set onMissionEnd(fn) { onMissionEnd = fn; },
    order: brain.order, findUnits: brain.findUnits, shortOrder: brain.shortCode,
    // take health off units (for hostiles that fight back later, or testing): hurt("2", 40)
    hurt: (unit, amount) => brain.findUnits(unit).forEach((s) => brain.hurt(s, amount)),
    set onEvent(fn) { onEvent = fn; },
    set onFire(fn) { onFire = fn; },
  };
}
