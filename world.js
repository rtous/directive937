"use strict";

// The 3D world of one level (levels.js): built from its data, rendered from the soldiers' helmet cameras.
// Rendered off-screen at low resolution; main.js copies each frame onto the CRT.
// This file builds the scene and moves, turns, aims and fires the soldiers. What they decide lives in
// behavior.js, the hostiles in hostiles.js, the goal in mission.js, the models in models.js.

const TILE = 2;          // world units per maze tile
const DEFAULT_WALL_H = 2.6; // ceiling height (a level can have its own: wallHeight)
const EYE_H = 1.6;
const TURN_SPEED = 2.6;  // radians / second (walking speed comes from behavior.js)

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
// squad: [{ id, name, callsign }], one soldier per entry, each with its own helmet camera. level: from levels.js.
// carry: who comes in from the level before, [{ alive, hp, pace, energy, exhausted }] per soldier (null: everyone, at full
// health and energy, normal pace).
function createWorld(width, height, squad, level, carry = null) {
  const grid = levelGrid(level);
  const rooms = level.rooms;
  // the ways out (sectors: the accesses to the neighbouring sectors). door: the outer-wall tile its hatch is on.
  const exits = (level.exits || []).map((e) => ({
    ...e, room: rooms.find((r) => r.name === e.room), door: { x: e.door[0], y: e.door[1] },
    toName: e.to ? sectorName(...e.to) : null,
  }));
  const roomAt = (x, y) => rooms.find((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) || null;
  const doors = createDoors(level.doors || [], grid, roomAt);
  const nav = createNav(grid, rooms, {
    home: rooms.find((r) => r.name === level.start), exits: exits.map((e) => e.room), doors,
    // the giant's body: nobody walks there
    // and the alien eggs: they stand in the way too
    solid: [
      ...(level.giant ? [[level.giant.x - level.giant.space, level.giant.y - level.giant.space, level.giant.x + level.giant.space, level.giant.y + level.giant.space]] : []),
      ...(level.eggs || []).filter(([x, y]) => !(level.starts || []).some(([sx, sy]) => sx === x && sy === y)).map(([x, y]) => [x, y, x, y]),
    ],
  });
  const { cols, rows, isOpen, roomOf, idx, DIRS, DIR_NAMES, MOVES, headingFor, angleDiff, bfs } = nav;
  const fogZones = level.fog || [];
  const WALL_H = level.wallHeight || DEFAULT_WALL_H;

  const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
  renderer.setSize(width, height, false);
  renderer.setPixelRatio(1);
  // filmic tone mapping keeps several overlapping lamps from blowing out to white
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.3;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  scene.fog = new THREE.Fog(0x000000, 2, 16);
  // Phong (per-pixel) so lamps light pools on the big flat surfaces; no shine
  const matte = (map) => new THREE.MeshPhongMaterial({ map, specular: 0x000000, shininess: 0 });

  // ---------- Walls ----------
  // One instanced mesh per wall style; only wall tiles that touch open floor can ever be seen.
  // Each tile gets its style from the room it faces (walls.js).
  const AROUND = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const facing = (x, y) => AROUND.map(([dx, dy]) => [x + dx, y + dy]).filter(([nx, ny]) => isOpen(nx, ny));
  const wallTextures = createWallTextures();
  const byStyle = new Map();
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (isOpen(x, y)) continue;
      const open = facing(x, y);
      if (!open.length) continue;
      const room = open.map(([nx, ny]) => roomOf(nx, ny)).find(Boolean) || null;
      const style = wallStyleFor(x, y, room);
      if (!byStyle.has(style)) byStyle.set(style, []);
      byStyle.get(style).push([x, y]);
    }
  }
  {
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
  }

  // ---------- Floor and ceiling ----------
  for (const [texture, y, rx] of [[floorTexture(), 0, -Math.PI / 2], [ceilingTexture(), WALL_H, Math.PI / 2]]) {
    texture.repeat.set(cols, rows);
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(cols * TILE, rows * TILE), matte(texture));
    plane.rotation.x = rx;
    plane.position.set((cols - 1) * TILE / 2, y, (rows - 1) * TILE / 2);
    scene.add(plane);
  }

  // ---------- Lights ----------
  // Very dim ambient; the helmet lamps do most of the work
  scene.add(new THREE.AmbientLight(0xffffff, 0.08));

  // Each room has a weak ceiling light (half the colony's power is out); corridors stay dark
  // (the feed is grayscale, so only red lights keep their colour; the rest become plain white)
  const fixtureGeo = new THREE.BoxGeometry(1.2, 0.08, 0.4);
  rooms.forEach((r) => {
    const [cx, cz] = nav.roomCentre(r).map((v) => v * TILE);
    const c = new THREE.Color(r.light);
    const color = c.r > 2 * c.g && c.r > 2 * c.b ? c : new THREE.Color(0xffffff).multiplyScalar(c.r * 0.3 + c.g * 0.59 + c.b * 0.11);
    const light = new THREE.PointLight(color, 0.42, Math.max(r.w, r.h) * TILE * 0.9, 1.5);
    light.position.set(cx, WALL_H - 0.3, cz);
    const fixture = new THREE.Mesh(fixtureGeo, new THREE.MeshBasicMaterial({ color }));
    fixture.position.set(cx, WALL_H - 0.05, cz);
    scene.add(light, fixture);
  });

  // Red emergency lights: fluorescent-style panels on the ceiling, lying along the corridor they light
  const lights = level.lights || [];
  {
    const panelGeo = new THREE.BoxGeometry(0.95, 0.04, 0.2);   // the glowing tube cover
    const housingGeo = new THREE.BoxGeometry(1.1, 0.07, 0.32); // dark metal casing around it
    const panelMat = new THREE.MeshBasicMaterial({ color: 0xd00000 });
    const housingMat = new THREE.MeshLambertMaterial({ color: 0x2a2d2b });
    lights.forEach(([tx, ty]) => {
      const light = new THREE.PointLight(0xe00000, 3.2, 9, 1.2);
      light.position.set(tx * TILE, WALL_H - 0.35, ty * TILE);
      const x = Math.round(tx), y = Math.round(ty);
      const northSouth = isOpen(x, y - 1) && isOpen(x, y + 1) && !(isOpen(x - 1, y) && isOpen(x + 1, y));
      const housing = new THREE.Mesh(housingGeo, housingMat);
      housing.position.set(tx * TILE, WALL_H - 0.035, ty * TILE);
      const panel = new THREE.Mesh(panelGeo, panelMat);
      panel.position.set(tx * TILE, WALL_H - 0.07, ty * TILE);
      if (northSouth) housing.rotation.y = panel.rotation.y = Math.PI / 2;
      scene.add(light, housing, panel);
    });
  }

  // Muzzle flashes, tracers and impacts (effects.js)
  const effects = createEffects(scene);

  // ---------- Ceiling vents ----------
  // A black hole in the ceiling with a metal frame. One too close to a red light panel moves to the nearest
  // free open tile.
  const VENT_CLEARANCE = 2; // tiles
  const ventOk = (x, y) => isOpen(x, y) && lights.every(([lx, ly]) => Math.hypot(lx - x, ly - y) >= VENT_CLEARANCE);
  const vents = (level.vents || []).map(([x, y]) => {
    if (ventOk(x, y)) return [x, y];
    let best = null, bestD = Infinity;
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++)
        if (ventOk(x + dx, y + dy) && Math.hypot(dx, dy) < bestD) { bestD = Math.hypot(dx, dy); best = [x + dx, y + dy]; }
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

  // ---------- Alien resin ----------
  // Over parts of the walls, the ceiling and the floor (walls.js): more the closer the sector is to THE NEST, none
  // far from it. The exit hatches, the doors, and the ceiling round the lights and vents stay clear.
  const resinLevel = resinAmount(level);
  if (resinLevel > 0) {
    const hatches = new Set(exits.map((e) => `${e.door.x},${e.door.y}`));
    const clearCeiling = new Set([...lights, ...vents].map(([x, y]) => y * 65536 + x));
    rooms.forEach((r) => {
      const [cx, cy] = nav.roomCentre(r);
      for (const x of new Set([Math.floor(cx), Math.ceil(cx)])) for (const y of new Set([Math.floor(cy), Math.ceil(cy)])) clearCeiling.add(y * 65536 + x);
    });
    const resin = createResin({
      cols, rows, isOpen, TILE, wallH: WALL_H, doors: level.doors || [],
      skip: (x, y) => hatches.has(`${x},${y}`), bareCeiling: (x, y) => clearCeiling.has(y * 65536 + x), amount: resinLevel,
    });
    if (resin) scene.add(resin);
  }

  // ---------- Doors ----------
  // Two leaves that slide apart into the walls, with the door's id stencilled on, and a weld seam down the middle
  // that grows from the floor up while it's being sealed (glowing hot while welding, dark once sealed).
  const doorTexture = (id) => makeTexture(64, (g, n) => {
    g.fillStyle = "#5d625f"; g.fillRect(0, 0, n, n);
    g.fillStyle = "#3a3e3c"; g.fillRect(0, 0, n, 3); g.fillRect(0, n - 3, n, 3);
    for (let y = 6; y < n - 6; y += 10) { g.fillStyle = "#d8b030"; g.fillRect(2, y, 5, 5); } // hazard edge (the meeting edge)
    g.fillStyle = "rgba(20,22,21,0.8)";
    g.font = "bold 13px monospace";
    g.fillText(id, 14, n / 2 + 4);
  });
  const doorMeshes = doors.list.map((d) => {
    const across = d.pass[0] ? "z" : "x"; // the leaves span the passage, so they lie across the way through
    const leafGeo = across === "z" ? new THREE.BoxGeometry(0.14, WALL_H, TILE / 2) : new THREE.BoxGeometry(TILE / 2, WALL_H, 0.14);
    const mat = matte(doorTexture(d.id));
    const leaves = [-1, 1].map((side) => {
      const leaf = new THREE.Mesh(leafGeo, mat);
      leaf.position.set(d.x * TILE, WALL_H / 2, d.y * TILE);
      scene.add(leaf);
      return { leaf, side };
    });
    const seamMat = new THREE.MeshBasicMaterial({ color: 0xff5020 });
    const seam = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1, 0.18), seamMat);
    seam.visible = false;
    scene.add(seam);
    return { d, across, leaves, seam, seamMat };
  });
  function updateDoorMeshes() {
    for (const m of doorMeshes) {
      const { d } = m;
      const shift = TILE / 4 + d.open * TILE / 2; // closed: the two leaves meet in the middle
      for (const { leaf, side } of m.leaves) leaf.position[m.across] = (m.across === "z" ? d.y : d.x) * TILE + side * shift;
      m.seam.visible = d.seal > 0 && d.open === 0;
      const h = Math.max(0.01, d.seal * WALL_H);
      m.seam.scale.y = h;
      m.seam.position.set(d.x * TILE, h / 2, d.y * TILE);
      m.seamMat.color.set(doors.welding(d) ? 0xff5020 : d.sealed ? 0x2a2420 : 0x6a3020);
    }
  }

  // ---------- Exits ----------
  // Each exit's hatch on the outer-wall tile next to its room, with a lit sign (the sector it leads to, or EXIT),
  // and arrows on the floor pointing at it. door.inward: the direction from the hatch into the room.
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const chevrons = (() => {
    const f = document.createElement("canvas");
    f.width = 256; f.height = 128;
    const fg = f.getContext("2d");
    fg.fillStyle = "#ffffff";
    for (let i = 0; i < 3; i++) { // pointing along +x
      const x = 30 + i * 70;
      fg.beginPath();
      fg.moveTo(x, 24); fg.lineTo(x + 40, 64); fg.lineTo(x, 104); fg.lineTo(x + 18, 104); fg.lineTo(x + 58, 64); fg.lineTo(x + 18, 24);
      fg.fill();
    }
    return new THREE.CanvasTexture(f);
  })();
  for (const { room, door: d, toName } of exits) {
    const inward = [
      Math.sign(clamp(d.x, room.x, room.x + room.w - 1) - d.x),
      Math.sign(clamp(d.y, room.y, room.y + room.h - 1) - d.y),
    ];
    d.inward = inward;
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
    g.fillText(toName ? `▶ ${toName}` : "EXIT", 64, 18);
    const hatch = new THREE.Mesh(new THREE.PlaneGeometry(TILE * 0.95, WALL_H * 0.95), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c) }));
    hatch.position.set((d.x + inward[0] * 0.5) * TILE + inward[0] * 0.01, WALL_H * 0.475, (d.y + inward[1] * 0.5) * TILE + inward[1] * 0.01);
    hatch.rotation.y = Math.atan2(inward[0], inward[1]); // its face looks into the room
    const glow = new THREE.PointLight(0xff3020, 0.8, TILE * 3, 1.5);
    glow.position.set((d.x + inward[0]) * TILE, WALL_H - 0.2, (d.y + inward[1]) * TILE);
    const arrows = new THREE.Mesh(new THREE.PlaneGeometry(TILE * 2.4, TILE * 1.2), new THREE.MeshBasicMaterial({
      map: chevrons, color: 0xd84a3a, transparent: true, opacity: 0.8, depthWrite: false,
    }));
    arrows.rotation.x = -Math.PI / 2;
    const marking = new THREE.Group(); // turned so the chevrons point at the hatch
    marking.add(arrows);
    marking.rotation.y = Math.atan2(inward[1], -inward[0]);
    marking.position.set((d.x + inward[0] * 2) * TILE, 0.02, (d.y + inward[1] * 2) * TILE);
    scene.add(hatch, glow, marking);
  }

  // ---------- Fog ----------
  const fogZoneAt = (x, y) => {
    const tx = Math.round(x), ty = Math.round(y);
    return fogZones.find(({ area: [x1, y1, x2, y2] }) => tx >= x1 && tx <= x2 && ty >= y1 && ty <= y2) || null;
  };
  const fogAt = (x, y) => !!fogZoneAt(x, y);
  // The camera's view closes in (grey, short range) while its soldier is inside fog
  const CLEAR_FOG = { near: 2, far: 16, color: new THREE.Color(0x000000) };
  const THICK_FOG = { near: 0.2, far: 5, color: new THREE.Color(0x181818) };

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
  fogZones.forEach(({ area: [x1, y1, x2, y2] }) => {
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

  // ---------- Soldiers ----------
  const bodyMat = new THREE.MeshLambertMaterial({ color: 0x8a8f86 });
  const visorMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

  // ---------- Helmet flashlight ----------
  // A lamp on the right side of each soldier's head (helmet or not). Its own camera sees only the light it
  // throws; the others also see the bright lens and a faint beam through the dark air.
  const LAMP_POS = new THREE.Vector3(0.17, 0.05, -0.04); // from the eyes: right, a little up, a little forward
  const BEAM_LEN = 4.5;
  const BEAM_RADIUS = 0.9;
  const beamGeo = new THREE.ConeGeometry(BEAM_RADIUS, BEAM_LEN, 20, 1, true);
  beamGeo.translate(0, -BEAM_LEN / 2, 0); // apex at the lens
  beamGeo.rotateX(Math.PI / 2);           // opening along -z, the way the camera looks
  const beamMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    uniforms: { strength: { value: 0.22 } },
    vertexShader: `
      varying float vAlong; varying float vFacing;
      void main() {
        vAlong = uv.y; // 1 at the lens, 0 at the far end
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vFacing = abs(dot(normalize(normalMatrix * normal), normalize(-mv.xyz)));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform float strength; varying float vAlong; varying float vFacing;
      void main() {
        float a = strength * vAlong * vAlong * vFacing; // fades out along the beam and toward its edges
        gl_FragColor = vec4(vec3(a), 1.0);
      }`,
  });
  const glowTex = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.25, "rgba(255,255,255,0.6)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const glowMat = new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });

  // The lamp, fixed to a soldier's head (their camera); returns what other cameras see of it
  function helmetFlashlight(camera) {
    const lamp = new THREE.SpotLight(0xffffff, 2.0, 20, Math.PI / 3.6, 0.6, 1);
    lamp.position.copy(LAMP_POS);
    lamp.target.position.set(LAMP_POS.x, LAMP_POS.y - 0.2, -5); // straight ahead, tipped a little down
    camera.add(lamp, lamp.target);
    const fx = new THREE.Group();
    fx.position.copy(LAMP_POS);
    fx.rotation.x = -0.04; // same downward tip as the light
    const beam = new THREE.Mesh(beamGeo, beamMat);
    const glow = new THREE.Sprite(glowMat);
    glow.scale.setScalar(0.3);
    fx.add(beam, glow);
    camera.add(fx);
    return fx;
  }

  let onEvent = () => {};
  let onFire = () => {}; // (soldier, shot times in seconds from now)
  let onSoldierDown = () => {}; // (soldier): just killed
  let onMissionEnd = () => {};
  let disposed = false;

  function makeSoldier(def, index) {
    const [sx, sy] = level.starts[index % level.starts.length];

    const camera = new THREE.PerspectiveCamera(78, width / height, 0.05, 40);
    scene.add(camera);
    const lampFx = helmetFlashlight(camera);
    camera.add(new THREE.PointLight(0xffffff, 0.4, 5)); // spill around the soldier

    // Placeholder figure, replaced by the 3D model once it loads (models.js)
    const body = new THREE.Group();
    const placeholder = new THREE.Group();
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 1.25, 8), bodyMat);
    torso.position.y = 0.85;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 6), bodyMat);
    head.position.y = 1.62;
    const helmetLamp = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.05), visorMat);
    helmetLamp.position.set(0.17, 1.66, -0.12); // where the flashlight shines from
    placeholder.add(torso, head, helmetLamp);
    body.add(placeholder);
    scene.add(body);

    return {
      ...def,
      camera, body, placeholder, lampFx,
      anim: null,                  // { mixer, actions, state, ... } once the model is loaded
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
      fogMix: 0,                   // 0..1: how far into fog the camera has closed in
      fireLeft: 0,                 // seconds of firing left (stands still meanwhile)
      fireTime: 0,                 // seconds since this burst started
      fireCooldown: 0,
      shots: [],                   // shot times still to come in this burst
      recoil: 0,                   // 1 right after a shot, fades to 0
      muzzle: effects.muzzleLight(), // light that flashes with each round
    };
  }

  const soldiers = squad.map(makeSoldier);
  if (modelsAvailable()) {
    soldiers.forEach((s) => dressSoldier(s).catch((err) => console.warn(`${s.callsign}: model not loaded, using the placeholder:`, err)));
  }

  // ---------- Aliens ----------
  // They start in the ventilation ducts and drop in through the ceiling vents (hostiles.js).
  const aliens = [];
  let alienModel = null; // models.js template, once loaded

  // A new hostile in the ducts at (x, y) tiles: hidden until it drops through a vent
  function spawnAlien(x, y) {
    if (!alienModel || disposed) return;
    const { group, mixer, actions } = alienFigure(alienModel);
    scene.add(group);
    const alien = { x, y, group, mixer, actions, hp: BEHAVIOR.hp.alien, dead: false };
    hostiles.initVent(alien);
    aliens.push(alien);
  }

  // The giant (only in the boss sector): standing in the middle of THE NEST for good (hostiles.js)
  function spawnGiant({ x, y }) {
    const { group, mixer, actions } = alienFigure(alienModel, GIANT.scale);
    group.position.set(x * TILE, 0, y * TILE);
    group.rotation.y = Math.random() * Math.PI * 2;
    scene.add(group);
    const giant = { x, y, group, mixer, actions, hp: GIANT.hp, dead: false };
    hostiles.initGiant(giant);
    aliens.push(giant);
  }

  // Alien eggs (sectors.js): [x, y, dx, dy, size], each turned its own way. Drawn instanced, one mesh per part of
  // the model (eggPieces, models.js) per room, each with bounds round that room's eggs: rooms out of view are left out.
  if (modelsAvailable() && level.eggs?.length) {
    eggTemplate().then((t) => {
      if (disposed) return;
      const onStart = ([x, y]) => (level.starts || []).some(([sx, sy]) => sx === x && sy === y);
      const byRoom = new Map();
      level.eggs.filter((e) => !onStart(e)).forEach((e) => { // never on top of a soldier
        const r = roomAt(e[0], e[1]);
        if (!byRoom.has(r)) byRoom.set(r, []);
        byRoom.get(r).push(e);
      });
      const pieces = eggPieces(t);
      const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), m = new THREE.Matrix4();
      let n = 0;
      byRoom.forEach((eggs) => {
        const at = eggs.map(([x, y, dx = 0, dy = 0, size = 1]) => new THREE.Matrix4().compose(
          new THREE.Vector3((x + dx) * TILE, (n++) * 0.0015, (y + dy) * TILE), // ground patches a hair apart, so they don't flicker
          q.setFromAxisAngle(up, tileHash(x * 7 + n, y, 9) * Math.PI * 2), new THREE.Vector3(size, size, size)));
        const centre = new THREE.Vector3();
        at.forEach((p) => centre.add(new THREE.Vector3().setFromMatrixPosition(p)));
        centre.divideScalar(at.length);
        const radius = Math.max(...at.map((p) => new THREE.Vector3().setFromMatrixPosition(p).distanceTo(centre))) + 2;
        for (const { geometry, material, matrix } of pieces) {
          // the part's geometry shared (same buffers), with this room's bounds
          const g = new THREE.BufferGeometry();
          for (const [name, attr] of Object.entries(geometry.attributes)) g.setAttribute(name, attr);
          g.setIndex(geometry.index);
          g.boundingSphere = new THREE.Sphere(centre, radius);
          const mesh = new THREE.InstancedMesh(g, material, eggs.length);
          at.forEach((p, i) => mesh.setMatrixAt(i, m.multiplyMatrices(p, matrix)));
          scene.add(mesh);
        }
      });
    }).catch((err) => console.warn("Egg model not loaded:", err));
  }

  if (modelsAvailable()) {
    alienTemplate().then((t) => {
      if (disposed) return;
      alienModel = t;
      if (level.giant) spawnGiant(level.giant);
      for (let i = 0; i < hostiles.schedule.start; i++) spawnAlien(...hostiles.ductPoint()); // already somewhere in the ducts
    }).catch((err) => console.warn("Alien model not loaded:", err));
  }

  // Killed: a last big splash and it's gone (death animations come later). The giant: the mission is won (once
  // this update is done, so the kill is reported first).
  const splash = (x, z) => effects.impact(new THREE.Vector3(x, 1.0, z), "flesh", new THREE.Vector3(0, -0.3, 0), true);
  let giantDown = null;
  function killAlien(a) {
    splash(a.x * TILE, a.y * TILE);
    scene.remove(a.group);
    if (a.giant) giantDown = a;
  }
  function killSoldier(s) {
    scene.remove(s.body);
    s.muzzle.light.intensity = 0;
    splash(s.body.position.x, s.body.position.z);
    onSoldierDown(s);
  }

  // ---------- Minds ----------
  // The soldiers' (behavior.js)
  const brain = createSquadBrain({
    nav, fogAt, soldiers, aliens, killAlien, killSoldier,
    emit: (s, text) => onEvent(s, text),
  });

  // The hostiles' (hostiles.js): touching a soldier kills them
  const hostiles = createHostiles({
    nav, TILE, ceiling: WALL_H, soldiers, fogAt, vents, schedule: level.hostiles,
    // the ducts the hostiles crawl along (sectors.js); a level without them gets a network from its first vent
    ducts: level.ducts || buildDucts(level.width, level.height, vents[0] || [1, 1], vents),
    spawn: spawnAlien,
    killSoldier: (s) => brain.hurt(s, s.hp, `was taken by a hostile in ${nav.where(s.tx, s.ty)}`),
    // the giant hit a soldier: a splash on them, and the health off
    lash: (giant, s) => {
      splash(s.body.position.x, s.body.position.z);
      const left = s.hp - GIANT.damage;
      if (left > 0) onEvent(s, `Unit ${s.id} (${s.callsign}) HIT BY THE GIANT, health ${left}. It reaches ${GIANT.range} tiles.`);
      brain.hurt(s, GIANT.damage, `was torn apart by the giant in ${nav.where(s.tx, s.ty)}`);
    },
  });

  // Who comes in from the level before: the others were lost there, and their health, energy and pace carry over
  if (carry) {
    soldiers.forEach((s, i) => {
      if (carry[i]?.alive) {
        s.hp = carry[i].hp;
        if (carry[i].energy != null) { s.energy = carry[i].energy; s.exhausted = !!carry[i].exhausted; }
        if (carry[i].pace) { s.orders.pace = carry[i].pace; s.speed = BEHAVIOR.pace[carry[i].pace]; } // still SLOW / RUN
      }
      else { brain.absent(s); scene.remove(s.body); }
    });
  }

  // The goal: get the squad out through one of the exits (mission.js), counting only those who came into this level
  const mission = createMission({
    exits, soldiers: soldiers.filter((s) => !s.dead), nav, leave: (s) => brain.leave(s),
    emit: (soldier, text) => onEvent(soldier, text),
    end: (result) => onMissionEnd(result),
  });

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

  // Follow a round from `from` along `dir` until it hits a wall, a closed door, the floor or the ceiling
  function bulletEnd(from, dir) {
    const p = from.clone();
    const step = dir.clone().multiplyScalar(0.1);
    for (let i = 0; i < 400; i++) {
      p.add(step);
      if (p.y <= 0.02 || p.y >= WALL_H - 0.02) return p;
      if (!nav.seeThrough(Math.round(p.x / TILE), Math.round(p.z / TILE))) return p.addScaledVector(step, -0.5);
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

  // Rapid bursts after raising the rifle; returns shot times in seconds
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

  // Stop and fire a burst; tells main.js when each shot sounds
  function startFiring(s) {
    const duration = 1.8 + Math.random() * 1.6; // seconds
    s.fireLeft = duration;
    s.fireTime = 0;
    s.shots = burstPattern(duration);
    onFire(s, s.shots.slice());
  }

  // ---------- What each soldier can perceive (for the agent) ----------
  function surroundings(s) {
    const [x, y] = unitTile(s);
    const room = roomOf(x, y);

    // how far the soldier can see straight down each direction, and which rooms that view opens into
    const lineOfSight = {};
    DIRS.forEach(([dx, dy], d) => {
      let n = 0;
      const seen = [];
      while (nav.seeThrough(x + dx * (n + 1), y + dy * (n + 1)) && n < 30) {
        n++;
        const r = roomOf(x + dx * n, y + dy * n);
        if (r && r !== room && !seen.includes(r.name)) seen.push(r.name);
      }
      const door = doors.at(x + dx * (n + 1), y + dy * (n + 1)); // what stopped the view, if it's a door
      lineOfSight[DIR_NAMES[d]] = (n === 0 ? (door ? "" : "wall") : `${n} tile${n === 1 ? "" : "s"} clear`) +
        (seen.length ? `, opens into ${seen.join(", ")}` : "") +
        (door ? `${n ? ", then " : ""}${door.sealed ? "sealed" : "closed"} door ${door.id}` : "");
    });

    const search = bfs(x, y);
    const nearby = soldiers
      .filter((o) => o !== s && !o.dead)
      .map((o) => ({ o, d: search.dist[idx(...unitTile(o))] }))
      .filter(({ o, d }) => d >= 0 && (d <= 8 || (room && roomOf(...unitTile(o)) === room)))
      .map(({ o, d }) => `${o.callsign} (unit ${o.id}), ${d} tiles away`);

    const fog = fogZoneAt(x, y);
    return {
      description: (room ? room.desc : "Narrow service corridor. Dark, pipes along the ceiling, condensation dripping.") +
        (fog ? ` ${fog.what} Visibility a few tiles.` : ""),
      exits: room
        ? nav.roomExits.get(room.name).map((e) => `${e.direction} door -> ${e.leads_to.join(" / ") || "dead end"}`)
        : [`this corridor connects to: ${nav.corridorLeadsTo(x, y, null).join(", ")}`],
      line_of_sight: lineOfSight,
      nearby_squad: nearby.length ? nearby : ["nobody within 8 tiles"],
    };
  }

  const compass4 = (angle) => DIR_NAMES[[0, 1, 2, 3].reduce((best, i) =>
    Math.abs(angleDiff(angle, headingFor(DIRS[i]))) < Math.abs(angleDiff(angle, headingFor(DIRS[best]))) ? i : best, 0)];

  function unitStatus(s) {
    const [x, y] = unitTile(s);
    // grid coordinates (same as the tactical map); x grows east, y grows south
    const base = { unit: s.id, name: s.name, location: roomOf(x, y)?.name ?? "CORRIDOR", position: { x, y } };
    if (s.dead) return { ...base, ...brain.describe(s) };
    return {
      ...base,
      facing: compass4(s.heading),
      looking: compass4(s.heading + s.lookOffset),
      ...brain.describe(s),
      moving: s.moving,
      firing: s.fireLeft > 0,
      open_directions: nav.openDirsFrom(x, y).map((i) => DIR_NAMES[i]),
      surroundings: surroundings(s),
    };
  }

  const colonyMap = rooms.map((r) => ({
    name: r.name, x: r.x, y: r.y, w: r.w, h: r.h,
    exits: nav.roomExits.get(r.name).map((e) => `${e.direction} -> ${e.leads_to.join(" / ") || "dead end"}`),
  }));

  function status() {
    return {
      level: level.name,
      grid_size: { width: cols, height: rows },
      units: soldiers.map(unitStatus),
      squad: brain.squadStatus(),
      mission: mission.status(),
      colony_map: colonyMap,
      doors: doors.list.map((d) => ({ id: d.id, position: { x: d.x, y: d.y }, where: d.where, state: doors.state(d) })),
    };
  }

  // ---------- Moving the soldiers ----------
  function stepTo(s, d) {
    s.dir = d;
    s.nx = s.tx + MOVES[d][0];
    s.ny = s.ty + MOVES[d][1];
    s.stepLen = MOVES[d][0] && MOVES[d][1] ? Math.SQRT2 : 1; // in tiles
    s.progress = 0;
  }

  function updateSoldier(s, dt) {
    if (s.dead) return;
    if (s.progress >= 1 && (s.tx !== s.nx || s.ty !== s.ny)) {
      s.tx = s.nx; s.ty = s.ny;
      brain.arrived(s);
    }
    brain.update(s, dt); // sets path, halt, speed, target, wantFire, gaze, glance
    if (s.exhausted) s.speed = Math.min(s.speed, BEHAVIOR.pace.normal); // out of breath: walk, don't run

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

    // Next step along the route. A door on it opens when the soldier reaches it (they wait while it slides);
    // a sealed one stops them in front of it.
    if (s.progress >= 1 && !s.halt && !s.target && s.path.length) {
      const [x, y] = s.path[0];
      const d = MOVES.findIndex(([dx, dy]) => dx === x - s.tx && dy === y - s.ty);
      const door = doors.at(x, y);
      if (door) doors.ask(door);
      if (d < 0) { s.path = []; s.goalKey = null; } // route no longer starts here: replan
      else if (door?.sealed) { /* stopped in front of it (behavior.js reports it, and waits while it's cut) */ }
      else if (!door || doors.canPass(door)) { s.path.shift(); stepTo(s, d); }
    }
    // stops mid-step to aim or fire
    const walking = s.progress < 1 && !firing && !s.target;
    const running = s.speed > CHARACTER.runAbove;

    // Body turns toward the way it walks, or (standing) toward what it watches; the head adds a glance
    const want = walking ? headingFor(MOVES[s.dir]) : s.gaze != null ? s.gaze : s.heading;
    const diff = angleDiff(s.heading, want);
    s.heading += Math.sign(diff) * Math.min(Math.abs(diff), TURN_SPEED * (running ? 1.6 : 1) * dt);
    if (walking) {
      s.restHeading = headingFor(MOVES[s.dir]);
      const toGaze = s.gaze != null ? angleDiff(s.heading, s.gaze) : 0;
      s.lookTarget = Math.max(-1.3, Math.min(1.3, toGaze + s.glance));
    } else {
      s.lookTarget = s.target ? 0 : s.glance;
    }
    s.lookOffset += (s.lookTarget - s.lookOffset) * Math.min(1, dt * 2.5);

    const moving = walking && Math.abs(diff) < 0.15;
    if (moving) {
      s.progress = Math.min(1, s.progress + (s.speed * dt) / (TILE * s.stepLen));
      s.walked += s.speed * dt;
    }
    s.moving = moving;
    // Energy: running spends it, standing or walking brings it back
    const E = BEHAVIOR.energy;
    if (moving && running) s.energy = Math.max(0, s.energy - E.drain * dt);
    else s.energy = Math.min(100, s.energy + (moving ? E.walk : E.rest) * dt);
    if (s.energy <= 0) s.exhausted = true;
    else if (s.exhausted && s.energy >= E.recover) s.exhausted = false;

    const [tx, ty] = unitPos(s);
    const px = tx * TILE, pz = ty * TILE;
    const bobRate = running ? 1.4 : 1;
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
    s.fogMix += ((fogAt(tx, ty) ? 1 : 0) - s.fogMix) * Math.min(1, dt * 1.5);
  }

  // Sparks where a soldier is welding: on the seam, at about chest height, on their side of the door
  function weldSparks(s) {
    const d = s.welding;
    const side = Math.sign((s.tx - d.x) * d.pass[0] + (s.ty - d.y) * d.pass[1]) || 1;
    const out = new THREE.Vector3(d.pass[0] * side, 0, d.pass[1] * side);
    const at = new THREE.Vector3(d.x * TILE, 0.9 + Math.random() * 0.5, d.y * TILE).addScaledVector(out, 0.1);
    effects.weld(at, out);
  }

  function update(dt) {
    brain.tick(dt);
    doors.update(dt, [...soldiers, ...aliens]);
    soldiers.forEach((s) => updateSoldier(s, dt));
    soldiers.forEach((s) => { if (s.welding && !s.dead) weldSparks(s); });
    updateDoorMeshes();
    hostiles.tick(dt, aliens);
    aliens.forEach((a) => hostiles.update(a, dt));
    if (giantDown) mission.victory(`THE GIANT is dead, in ${nav.where(giantDown.x, giantDown.y)}. The complex is clear of its source.`);
    mission.update();
    effects.update(dt);
    updateMist(dt);
  }

  // Render from one soldier's helmet camera (their own body hidden)
  function render(index) {
    soldiers.forEach((s, i) => (s.body.visible = s.lampFx.visible = !s.dead && i !== index));
    const k = soldiers[index].fogMix;
    scene.fog.near = CLEAR_FOG.near + (THICK_FOG.near - CLEAR_FOG.near) * k;
    scene.fog.far = CLEAR_FOG.far + (THICK_FOG.far - CLEAR_FOG.far) * k;
    scene.fog.color.copy(CLEAR_FOG.color).lerp(THICK_FOG.color, k);
    renderer.render(scene, soldiers[index].camera);
  }

  // Free the GPU context (a new world is built for a restart or another level)
  function dispose() {
    disposed = true;
    renderer.dispose();
    renderer.forceContextLoss();
  }

  update(0);
  return {
    level, canvas: renderer.domElement, grid, rooms, soldiers, aliens, vents, doors, exits, mission,
    update, render, status, dispose,
    order: brain.order, findUnits: brain.findUnits,
    nearestDoor: (i) => brain.nearestDoor(soldiers[i]), // by route, whatever its state
    // take health off units (for testing, from the browser console): world.hurt("2", 40)
    hurt: (unit, amount) => brain.findUnits(unit).forEach((s) => brain.hurt(s, amount)),
    set onEvent(fn) { onEvent = fn; },
    set onFire(fn) { onFire = fn; },
    set onSoldierDown(fn) { onSoldierDown = fn; },
    set onMissionEnd(fn) { onMissionEnd = fn; },
  };
}
