"use strict";

// Gunfire effects: muzzle flash at the rifle, a tracer streak, and an impact where the round lands
// (sparks on walls, a splash on a hostile). Everything is pooled: a fixed number of lights,
// particles and lines exist from the start, so firing never adds objects to the scene.

function createEffects(scene) {
  // soft round dot shared by particles and flashes
  const dotCanvas = document.createElement("canvas");
  dotCanvas.width = dotCanvas.height = 32;
  const g = dotCanvas.getContext("2d");
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.4, "rgba(255,255,255,0.6)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  const dot = new THREE.CanvasTexture(dotCanvas);

  // muzzle flash: a bright core with a few spikes
  const starCanvas = document.createElement("canvas");
  starCanvas.width = starCanvas.height = 64;
  const sg = starCanvas.getContext("2d");
  sg.drawImage(dotCanvas, 16, 16);
  sg.translate(32, 32);
  for (let i = 0; i < 5; i++) {
    sg.rotate((Math.PI * 2) / 5 + (Math.random() - 0.5) * 0.3);
    const spike = sg.createLinearGradient(0, 0, 0, -30);
    spike.addColorStop(0, "rgba(255,255,255,1)");
    spike.addColorStop(1, "rgba(255,255,255,0)");
    sg.fillStyle = spike;
    sg.beginPath();
    sg.moveTo(-4, 0);
    sg.lineTo(0, -30);
    sg.lineTo(4, 0);
    sg.fill();
  }
  const star = new THREE.CanvasTexture(starCanvas);

  const glow = (extra) => ({
    map: dot, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, ...extra,
  });

  // ---------- Particles: one cloud per kind, used as a ring buffer ----------
  function cloud(size, max) {
    const pos = new Float32Array(max * 3).fill(-100);
    const col = new Float32Array(max * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const points = new THREE.Points(geo, new THREE.PointsMaterial(glow({ size, vertexColors: true })));
    points.frustumCulled = false;
    scene.add(points);
    return {
      pos, col, geo, max, next: 0,
      vel: new Float32Array(max * 3), color: new Float32Array(max * 3),
      life: new Float32Array(max), total: new Float32Array(max), gravity: new Float32Array(max),
    };
  }
  const sparks = cloud(0.07, 300);
  const splash = cloud(0.14, 300);

  function emit(c, at, dir, n, { speed, spread, life, gravity, color }) {
    for (let k = 0; k < n; k++) {
      const i = c.next;
      c.next = (c.next + 1) % c.max;
      c.pos.set([at.x, at.y, at.z], i * 3);
      const s = speed * (0.4 + Math.random() * 0.6);
      c.vel.set([
        (dir.x + (Math.random() - 0.5) * spread) * s,
        (dir.y + (Math.random() - 0.3) * spread) * s,
        (dir.z + (Math.random() - 0.5) * spread) * s,
      ], i * 3);
      c.color.set(color, i * 3);
      c.life[i] = c.total[i] = life * (0.6 + Math.random() * 0.4);
      c.gravity[i] = gravity;
    }
  }

  function updateCloud(c, dt) {
    for (let i = 0; i < c.max; i++) {
      if (c.life[i] <= 0) continue;
      c.life[i] -= dt;
      const j = i * 3;
      if (c.life[i] <= 0) { c.pos[j + 1] = -100; continue; }
      c.vel[j + 1] -= c.gravity[i] * dt;
      c.pos[j] += c.vel[j] * dt;
      c.pos[j + 1] = Math.max(0.01, c.pos[j + 1] + c.vel[j + 1] * dt);
      c.pos[j + 2] += c.vel[j + 2] * dt;
      const f = c.life[i] / c.total[i]; // fades to black = invisible with additive blending
      c.col[j] = c.color[j] * f;
      c.col[j + 1] = c.color[j + 1] * f;
      c.col[j + 2] = c.color[j + 2] * f;
    }
    c.geo.attributes.position.needsUpdate = true;
    c.geo.attributes.color.needsUpdate = true;
  }

  // ---------- Tracers: short-lived line segments ----------
  const T_MAX = 48;
  const tPos = new Float32Array(T_MAX * 6).fill(-100);
  const tCol = new Float32Array(T_MAX * 6);
  const tLife = new Float32Array(T_MAX);
  const tGeo = new THREE.BufferGeometry();
  tGeo.setAttribute("position", new THREE.BufferAttribute(tPos, 3));
  tGeo.setAttribute("color", new THREE.BufferAttribute(tCol, 3));
  const tracers = new THREE.LineSegments(tGeo, new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  }));
  tracers.frustumCulled = false;
  scene.add(tracers);
  let tNext = 0;
  const TRACER_LIFE = 0.08;

  // ---------- Flashes: glowing sprites (muzzle, impact) ----------
  const flashes = Array.from({ length: 24 }, () => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial(glow({ color: 0xffffff })));
    sp.visible = false;
    scene.add(sp);
    return { sp, life: 0, total: 1, size: 1 };
  });
  let fNext = 0;
  function flash(at, size, life, color, map = dot) {
    const f = flashes[fNext];
    f.sp.material.map = map;
    fNext = (fNext + 1) % flashes.length;
    f.sp.position.copy(at);
    f.sp.material.color.set(color).multiplyScalar(2.5); // brighter than white: it's a flash
    f.sp.material.rotation = Math.random() * Math.PI;
    f.sp.visible = true;
    f.life = f.total = life;
    f.size = size;
  }

  // one light per shooter, always in the scene (adding lights later would recompile every shader)
  function muzzleLight() {
    const light = new THREE.PointLight(0xffd8a0, 0, 6, 2);
    scene.add(light);
    return { light, life: 0 };
  }

  const muzzles = [];
  const MUZZLE_LIGHT = 1.3; // enough to light the corridor, not to white out the wall beside the rifle

  return {
    muzzleLight() { const m = muzzleLight(); muzzles.push(m); return m; },

    // A round leaves the rifle at `from` heading along `dir`
    muzzle(m, from) {
      flash(from, 0.3 + Math.random() * 0.15, 0.05, 0xfff0c0, star);
      m.light.position.copy(from);
      m.light.intensity = MUZZLE_LIGHT;
      m.life = 0.06;
    },

    tracer(from, to) {
      const i = tNext;
      tNext = (tNext + 1) % T_MAX;
      // only the far part of the path: a streak, not a laser from the barrel
      const start = from.clone().lerp(to, 0.25 + Math.random() * 0.3);
      tPos.set([start.x, start.y, start.z, to.x, to.y, to.z], i * 6);
      tLife[i] = TRACER_LIFE;
    },

    // kind: "wall" (sparks) or "flesh" (a hostile hit); dir: the way the round was travelling
    impact(at, kind, dir, big = false) {
      const back = dir.clone().multiplyScalar(-1);
      if (kind === "flesh") {
        emit(splash, at, back, big ? 40 : 8, { speed: big ? 2.5 : 1.6, spread: 2.2, life: big ? 0.9 : 0.45, gravity: 6, color: [1.2, 1.4, 0.9] });
        flash(at, big ? 1.2 : 0.45, big ? 0.2 : 0.08, 0xd0e0b0);
      } else {
        emit(sparks, at, back, 8, { speed: 4, spread: 1.6, life: 0.3, gravity: 9, color: [2, 1.7, 1.2] });
        flash(at, 0.35, 0.06, 0xffe0b0);
      }
    },

    update(dt) {
      updateCloud(sparks, dt);
      updateCloud(splash, dt);
      for (let i = 0; i < T_MAX; i++) {
        if (tLife[i] <= 0) continue;
        tLife[i] -= dt;
        const f = Math.max(0, tLife[i] / TRACER_LIFE);
        if (f === 0) tPos.fill(-100, i * 6, i * 6 + 6);
        tCol.set([0.6 * f, 0.5 * f, 0.35 * f, 3 * f, 2.7 * f, 2.1 * f], i * 6); // brighter at the tip
      }
      tGeo.attributes.position.needsUpdate = true;
      tGeo.attributes.color.needsUpdate = true;
      for (const f of flashes) {
        if (!f.sp.visible) continue;
        f.life -= dt;
        if (f.life <= 0) { f.sp.visible = false; continue; }
        const k = f.life / f.total;
        f.sp.scale.setScalar(f.size * (0.6 + 0.4 * k));
        f.sp.material.opacity = k;
      }
      for (const m of muzzles) {
        if (m.life <= 0) continue;
        m.life -= dt;
        m.light.intensity = m.life > 0 ? MUZZLE_LIGHT * (m.life / 0.06) : 0;
      }
    },
  };
}
