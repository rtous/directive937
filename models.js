"use strict";

// 3D models: the soldiers (Mixamo FBX with shared animation clips, plus a rifle built from boxes) and the
// hostiles. Files are loaded and prepared once per page and reused by every world (restarts, other levels).

// Soldier models, one per callsign. Until a model loads, or if it can't (e.g. opened from file://), that soldier
// is drawn as a simple placeholder figure (world.js). The animations are shared by all of them.
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
  runAbove: 2.2,                      // m/s: faster than this plays the run clip
};

// Alien model (rigged, with idle/walk/run1/... animations). Its textures aren't linked inside the FBX, so they're
// attached by material name.
const XENO_DIR = "characters/realistic-xenomorph-rig/";
const XENO = {
  model: XENO_DIR + "source/Xenomorph Default.fbx",
  textures: { // material name (lower case) -> [colour map, normal map]
    t_mi_xeno_body_basecolor: [XENO_DIR + "textures-web/body_basecolor.jpg", XENO_DIR + "textures-web/body_n.jpg"],
    t_mi_xeno_headcap_basecolor: [XENO_DIR + "textures-web/headcap_basecolor.jpg", XENO_DIR + "textures-web/headcap_n.jpg"],
  },
  height: 2.2,    // metres, standing
  darkness: 0.35, // multiplies the texture colour (1 = as painted)
};

const modelsAvailable = () => !!(window.THREE && THREE.FBXLoader && THREE.SkeletonUtils);

// ---------- Loading (each file once) ----------
const fbxCache = new Map();
function loadFBX(url) {
  if (!fbxCache.has(url)) {
    fbxCache.set(url, new Promise((resolve, reject) => new THREE.FBXLoader().load(encodeURI(url), resolve, undefined, reject)));
  }
  return fbxCache.get(url);
}
const once = (fn) => { let p = null; return () => (p ??= fn()); };

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

const hipsTrack = (clip) => clip.tracks.find((tr) => /Hips\.position$/.test(tr.name));

// How far a clip's hips travel per second (in the clip's own units)
function hipsSpeed(clip) {
  const t = hipsTrack(clip);
  if (!t || !(clip.duration > 0)) return 0;
  const v = t.values, n = v.length;
  return Math.hypot(v[n - 3] - v[0], v[n - 1] - v[2]) / clip.duration;
}

// The game moves soldiers itself, so pin the hips horizontally (drop the clip's root motion)
function inPlace(clip) {
  const t = hipsTrack(clip);
  if (t) for (let i = 0; i < t.values.length; i += 3) { t.values[i] = t.values[0]; t.values[i + 2] = t.values[2]; }
  return clip;
}

function findHips(root) {
  let hips = null;
  root.traverse((o) => { if (!hips && o.isBone && /Hips$/.test(o.name)) hips = o; });
  return hips;
}

// The clips were recorded on the Vanguard skeleton. Each soldier model can name its bones differently
// ("mixamorig1Hips" vs "mixamorigHips") and have other proportions, so keep only the bone rotations plus the
// hips position, renamed for that skeleton and with the hips height scaled to its body.
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

// The shared animation clips, in place, with the run clip's real speed
const soldierClips = once(async () => {
  const [walk, idle, fire, run] = await Promise.all([CHARACTER.walk, CHARACTER.idle, CHARACTER.fire, CHARACTER.run].map(loadFBX));
  // the run clip's speed, scaled by the walk clip whose real speed is known (measured before inPlace)
  const walkRaw = hipsSpeed(walk.animations[0]), runRaw = hipsSpeed(run.animations[0]);
  const runSpeed = walkRaw > 0 && runRaw > walkRaw ? CHARACTER.walkClipSpeed * runRaw / walkRaw : CHARACTER.runClipSpeed;
  return {
    clips: { walk: inPlace(walk.animations[0]), idle: inPlace(idle.animations[0]), fire: inPlace(fire.animations[0]), run: inPlace(run.animations[0]) },
    clipHipsY: findHips(walk)?.position.y || 1,
    runSpeed,
  };
});

// A soldier's own model (or the shared one if it has none or it fails), prepared once
async function soldierModel(callsign) {
  const url = CHARACTER.models[callsign];
  let model;
  try {
    model = await loadFBX(url || CHARACTER.model);
  } catch (err) {
    if (!url) throw err;
    console.warn(`Model for ${callsign} not loaded, using the shared one:`, err);
    model = await loadFBX(CHARACTER.model);
  }
  if (!model.userData.ready) {
    grayscale(model);
    model.userData.scale = CHARACTER.height / new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3()).y;
    model.userData.ready = true;
  }
  return model;
}

// ---------- Rifle ----------
// A simple black rifle built from boxes and a cylinder (the soldier models come unarmed). Built along +Z with the
// pistol grip at the origin, so lookAt() points the barrel. Each frame it sits in the right hand, aimed at the left.
const rifleParts = once(() => {
  const mat = new THREE.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 0.55, metalness: 0.5 });
  return [ // [geometry, x, y, z, tilt about X]
    [new THREE.BoxGeometry(0.055, 0.085, 0.40), 0, 0.035, 0.10, 0],    // receiver
    [new THREE.BoxGeometry(0.06, 0.065, 0.24), 0, 0.03, 0.40, 0],      // handguard
    [new THREE.CylinderGeometry(0.012, 0.012, 0.16, 8), 0, 0.04, 0.58, Math.PI / 2], // barrel
    [new THREE.BoxGeometry(0.045, 0.085, 0.24), 0, 0.005, -0.21, 0],   // stock
    [new THREE.BoxGeometry(0.035, 0.10, 0.045), 0, -0.04, 0.0, -0.3],  // pistol grip
    [new THREE.BoxGeometry(0.03, 0.14, 0.065), 0, -0.065, 0.17, 0.15], // magazine
    [new THREE.BoxGeometry(0.022, 0.035, 0.14), 0, 0.09, 0.06, 0],     // sight rail
  ].map(([geo, x, y, z, tilt]) => ({ geo, mat, x, y, z, tilt }));
});
function makeRifle() {
  const rifle = new THREE.Group();
  for (const { geo, mat, x, y, z, tilt } of rifleParts()) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.x = tilt;
    rifle.add(m);
  }
  return rifle;
}

// scratch vectors (created on first use, so this file loads even if Three.js didn't)
const rifleTmp = once(() => ({
  grip: new THREE.Vector3(), palm: new THREE.Vector3(), left: new THREE.Vector3(), dir: new THREE.Vector3(), look: new THREE.Vector3(),
  lowReady: new THREE.Vector3(0, -0.57, -0.82), // body space: forward and down, when the hands let go
}));
function holdRifle(s, dt) {
  const { rifle, rightHand, rightPalm, leftHand } = s.anim;
  const { grip: _grip, palm: _palm, left: _left, dir: _dir, look: _look, lowReady: LOW_READY } = rifleTmp();
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

// ---------- Soldiers ----------
// Load this soldier's model and swap it in for the placeholder figure in s.body. Sets s.anim.
async function dressSoldier(s) {
  const [model, { clips, clipHipsY, runSpeed }] = await Promise.all([soldierModel(s.callsign), soldierClips()]);
  const hips = findHips(model);
  if (!hips) { console.warn(`${s.callsign}'s model has no Mixamo skeleton`); return; }
  const prefix = hips.name.slice(0, -"Hips".length);
  const hipsScale = hips.position.y / clipHipsY;
  const clip = {};
  for (const k in clips) clip[k] = retarget(clips[k], prefix, hipsScale);

  const fig = THREE.SkeletonUtils.clone(model);
  fig.scale.setScalar(model.userData.scale);
  fig.rotation.y = Math.PI; // Mixamo characters face +Z; soldiers face -Z
  fig.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
  const mixer = new THREE.AnimationMixer(fig);
  const actions = {};
  for (const k of ["walk", "idle", "fire", "run"]) {
    actions[k] = mixer.clipAction(clip[k]);
    actions[k].play();
    actions[k].enabled = k === "idle"; // the others are off until the first crossfade
  }
  actions.walk.time = Math.random() * clip.walk.duration; // squad not in lockstep
  actions.idle.paused = true; // hold the first frame
  s.body.remove(s.placeholder);
  s.body.add(fig);
  s.anim = { mixer, actions, state: "idle", runSpeed };
  const rightHand = fig.getObjectByName(prefix + "RightHand");
  const leftHand = fig.getObjectByName(prefix + "LeftHand");
  if (rightHand && leftHand) {
    const rifle = makeRifle();
    s.body.add(rifle);
    Object.assign(s.anim, { rifle, rightHand, leftHand, rightPalm: fig.getObjectByName(prefix + "RightHandMiddle1") });
  }
}

// Crossfade between idle / walk / run / fire and match the stride to the ground speed
function animateSoldier(s, dt, moving, turning, firing) {
  const a = s.anim;
  const running = moving && s.speed > CHARACTER.runAbove;
  const state = firing ? "fire" : running ? "run" : moving || turning ? "walk" : "idle";
  if (state !== a.state) {
    const to = a.actions[state];
    to.enabled = true; // a finished fade-out disables the action
    if (state === "fire") to.time = 0;
    a.actions[a.state].crossFadeTo(to, state === "fire" || a.state === "fire" || running ? 0.2 : 0.3, false);
    a.state = state;
  }
  // shuffle slower when turning on the spot
  a.actions.walk.timeScale = moving ? s.speed / CHARACTER.walkClipSpeed : 0.6;
  a.actions.run.timeScale = s.speed / a.runSpeed;
  a.mixer.update(dt);
  if (a.rifle) holdRifle(s, dt);
}

// ---------- Hostiles ----------
// The alien model, textured and scaled, with its idle / walk / run clips
const alienTemplate = once(async () => {
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
  return { model, scale, clips: { idle: clip("idle") || model.animations[0], walk: clip("walk"), run: clip("run1"), attack: clip("attack1") } };
});

// A new alien figure from the loaded template: { group, mixer, actions } (idle playing). size: times normal.
function alienFigure({ model, scale, clips }, size = 1) {
  const fig = THREE.SkeletonUtils.clone(model);
  fig.scale.setScalar(scale * size);
  fig.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
  const group = new THREE.Group();
  group.add(fig);
  const mixer = new THREE.AnimationMixer(fig);
  const actions = {};
  for (const [name, c] of Object.entries(clips)) if (c) actions[name] = mixer.clipAction(c);
  if (actions.idle) {
    actions.idle.time = Math.random() * clips.idle.duration;
    actions.idle.play();
  }
  return { group, mixer, actions };
}

// ---------- Alien eggs ----------
// A static model: an egg on a root base, with web strands, standing on a patch of ground (cut out by an opacity
// map). Its textures aren't linked inside the FBX (every material is "defaultMat"), so they're attached by mesh name.
const EGG_DIR = "characters/alien-egg/";
const EGG = {
  model: EGG_DIR + "source/aliengeggFULL.fbx",
  parts: { // mesh name -> which textures
    Group13752: "shell", Group44234: "shell", Group64277: "shell", Group12847: "shell", // the four lips of the egg
    Group59158: "web", Group57259: "web",
    Group43410: "ground",
  },
  textures: { // [colour map, normal map, opacity map]; anything not listed above is "base" (roots and stalk)
    shell: [EGG_DIR + "textures-web/alienegg_basecolor.jpg", EGG_DIR + "textures-web/alienegg_n.jpg"],
    base: [EGG_DIR + "textures-web/baseegg_basecolor.jpg", EGG_DIR + "textures-web/baseegg_n.jpg"],
    web: [EGG_DIR + "textures-web/baseegg_basecolor.jpg", null, EGG_DIR + "textures-web/webegg_opacity.jpg"],
    ground: [EGG_DIR + "textures-web/piso_basecolor.jpg", EGG_DIR + "textures-web/piso_n.jpg", EGG_DIR + "textures-web/piso_opacity.jpg"],
  },
  ground: "Group43410", // the mesh that lies on the floor
  hidden: ["Group44292"], // under the ground patch, never seen: not drawn
  height: 1.25,   // metres, from the ground patch to the top of the egg
  darkness: 0.42, // multiplies the texture colour (1 = as painted)
};

// The egg model, textured, scaled and standing on y = 0 (drawn instanced: eggPieces)
const eggTemplate = once(async () => {
  const model = await loadFBX(EGG.model);
  const texLoader = new THREE.TextureLoader();
  const tex = new Map(); // each file once
  const load = (url) => (url ? tex.get(url) || tex.set(url, texLoader.load(url)).get(url) : null);
  model.traverse((o) => {
    if (!o.isMesh) return;
    if (EGG.hidden.includes(o.name)) { o.visible = false; return; }
    const [map, normalMap, alphaMap] = EGG.textures[EGG.parts[o.name] || "base"];
    o.material = new THREE.MeshPhongMaterial({
      map: load(map), normalMap: load(normalMap), alphaMap: load(alphaMap), alphaTest: alphaMap ? 0.5 : 0,
      side: THREE.DoubleSide, specular: 0x555555, shininess: 40, // a moist, leathery shine
    });
  });
  grayscale(model, (mat) => mat.color.setScalar(EGG.darkness));
  const ground = model.getObjectByName(EGG.ground);
  const groundY = ground ? new THREE.Box3().setFromObject(ground).min.y : new THREE.Box3().setFromObject(model).min.y;
  const top = new THREE.Box3().setFromObject(model).max.y;
  const scale = EGG.height / (top - groundY);
  model.scale.setScalar(scale);
  model.position.y = -groundY * scale + 0.01; // the ground patch just above the floor
  const template = new THREE.Group();
  template.add(model);
  return template;
});
// The egg's parts, for instancing: { geometry, material, matrix } each, matrix placing it within the egg
function eggPieces(template) {
  template.updateMatrixWorld(true);
  const parts = [];
  template.traverse((o) => {
    if (o.isMesh && o.visible) parts.push({ geometry: o.geometry, material: o.material, matrix: o.matrixWorld.clone() });
  });
  return parts;
}
