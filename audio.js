"use strict";

// CRT / radio static, gunfire, radio bursts and suspense music, generated with the Web Audio API. The only sound
// files are the death screams (sounds/shouting_*.wav), loaded once the audio starts.
// Browsers only allow audio after a user gesture: start() is called on load and again on the first click or key press.
function createStaticAudio() {
  let ctx = null;
  let master, noiseGain, crackleGain, humGain;
  let enabled = true;
  let gunBus = null, noiseBuf = null;
  let music = null; // the suspense score (see buildMusic)
  const SCREAMS = { male: "sounds/shouting_male.wav", female: "sounds/shouting_female.wav" };
  const screams = {}; // kind -> decoded AudioBuffer (missing until loaded, or if it can't be, e.g. from file://)

  function build() {
    ctx = new (window.AudioContext || window.webkitAudioContext)();

    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);

    // Looping white noise buffer
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;

    // Band-limit it so it sounds like a speaker, not pure white noise
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 300;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 6000;
    noise.connect(hp).connect(lp);

    // Steady hiss
    noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.08;
    lp.connect(noiseGain).connect(master);

    // Crackle: same noise, gain spiked briefly from update()
    crackleGain = ctx.createGain();
    crackleGain.gain.value = 0;
    lp.connect(crackleGain).connect(master);

    // Faint mains hum
    const hum = ctx.createOscillator();
    hum.type = "sawtooth";
    hum.frequency.value = 50;
    const humLp = ctx.createBiquadFilter();
    humLp.type = "lowpass";
    humLp.frequency.value = 180;
    humGain = ctx.createGain();
    humGain.gain.value = 0.025;
    hum.connect(humLp).connect(humGain).connect(master);

    noise.start();
    hum.start();
    buildGun();
    buildMusic();
    loadScreams();
  }

  function loadScreams() {
    for (const [kind, url] of Object.entries(SCREAMS)) {
      fetch(url)
        .then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
        .then((data) => new Promise((ok, fail) => ctx.decodeAudioData(data, ok, fail)))
        .then((buf) => { screams[kind] = buf; })
        .catch((err) => console.warn(`Scream not loaded (${url}):`, err));
    }
  }

  // ---------- Suspense music ----------
  // A generative score that follows the game's tension (0 = quiet, 1 = hostiles on top of the squad):
  //   drone   two low notes a semitone apart, a filter slowly breathing     (always)
  //   swells  slow dissonant pad chords drifting in and out, with reverb    (more often and higher with tension)
  //   pings   distant metallic hits in the reverb                            (now and then)
  //   pulse   a low heartbeat thump                                          (from tension ~0.25, faster as it rises)
  const MUSIC = { volume: 0.55 };
  const note = (n) => 55 * 2 ** (n / 12); // semitones above A1
  function buildMusic() {
    const out = ctx.createGain();
    out.gain.value = MUSIC.volume;
    out.connect(master);
    // reverb: a long decaying noise impulse, a little different per ear
    const verb = ctx.createConvolver();
    const ir = ctx.createBuffer(2, ctx.sampleRate * 3.5, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 3;
    }
    verb.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.7;
    verb.connect(wet).connect(out);

    // drone
    const droneLp = ctx.createBiquadFilter();
    droneLp.type = "lowpass";
    droneLp.frequency.value = 180;
    droneLp.Q.value = 4;
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.18;
    droneLp.connect(droneGain).connect(out);
    droneGain.connect(verb);
    for (const [n, type, detune] of [[0, "sawtooth", -6], [1, "sawtooth", 5], [-12, "sine", 0]]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = note(n);
      o.detune.value = detune;
      o.connect(droneLp);
      o.start();
    }
    const lfo = ctx.createOscillator(); // the filter breathing
    lfo.frequency.value = 0.045;
    const lfoAmt = ctx.createGain();
    lfoAmt.gain.value = 90;
    lfo.connect(lfoAmt).connect(droneLp.frequency);
    lfo.start();

    music = { out, verb, droneLp, droneGain, tension: 0, target: 0, nextSwell: 2, nextPing: 6, nextBeat: 0, clock: 0 };
    music.timer = setInterval(tickMusic, 100);
  }

  // A slow pad chord: sawtooths through a soft filter, fading in over seconds and out again
  function swell(t, notes, level, length) {
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(300, t);
    lp.frequency.linearRampToValueAtTime(900 + 1200 * music.tension, t + length * 0.5);
    lp.frequency.linearRampToValueAtTime(300, t + length);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(level, t + length * 0.45);
    g.gain.linearRampToValueAtTime(0.0001, t + length);
    lp.connect(g);
    g.connect(music.out);
    g.connect(music.verb);
    for (const n of notes) {
      for (const detune of [-8, 7]) {
        const o = ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = note(n);
        o.detune.value = detune;
        o.connect(lp);
        o.start(t);
        o.stop(t + length + 0.1);
      }
    }
  }

  // A far-off metallic hit: two inharmonic partials, mostly reverb
  function ping(t) {
    const base = 600 + Math.random() * 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    g.connect(music.verb);
    for (const mult of [1, 2.76]) {
      const o = ctx.createOscillator();
      o.frequency.value = base * mult;
      o.connect(g);
      o.start(t);
      o.stop(t + 1.7);
    }
  }

  // Heartbeat: a low thump that drops in pitch, and a softer second one just after
  function beat(t, level) {
    for (const [dt, k] of [[0, 1], [0.22, 0.6]]) {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(70, t + dt);
      o.frequency.exponentialRampToValueAtTime(38, t + dt + 0.18);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + dt);
      g.gain.exponentialRampToValueAtTime(level * k, t + dt + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.25);
      o.connect(g).connect(music.out);
      o.start(t + dt);
      o.stop(t + dt + 0.3);
    }
  }

  // Low-register note sets: calm = wide and hollow, tense = clustered and higher
  const CALM_CHORDS = [[0, 7, 13], [-2, 5, 11], [1, 8, 12], [0, 6, 15]];
  const TENSE_CHORDS = [[12, 13, 18], [13, 14, 19, 24], [11, 12, 17, 23], [15, 16, 22]];
  function tickMusic() {
    if (!music || ctx.state !== "running") return;
    const dt = 0.1;
    music.clock += dt;
    // tension eases toward the game's value: quickly up, slowly down
    music.tension += (music.target - music.tension) * (music.target > music.tension ? 0.08 : 0.015);
    const k = music.tension;
    const t = ctx.currentTime + 0.05;
    music.droneGain.gain.setTargetAtTime(0.14 + 0.12 * k, t, 0.5);
    music.droneLp.frequency.setTargetAtTime(160 + 260 * k, t, 0.8);

    if ((music.nextSwell -= dt) <= 0) {
      const set = Math.random() < k ? TENSE_CHORDS : CALM_CHORDS;
      swell(t, set[Math.floor(Math.random() * set.length)], 0.035 + 0.04 * k, 7 - 3 * k + Math.random() * 3);
      music.nextSwell = 9 - 6 * k + Math.random() * 5;
    }
    if ((music.nextPing -= dt) <= 0) {
      ping(t);
      music.nextPing = 7 + Math.random() * 14;
    }
    if (k > 0.25 && (music.nextBeat -= dt) <= 0) {
      beat(t, 0.25 + 0.45 * k);
      music.nextBeat = 60 / (55 + 75 * k); // 55 bpm, up to 130 at full tension
    }
  }

  // Shared chain for gunfire: soft clipping for punch, a short metal-corridor echo
  function buildGun() {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.3, ctx.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

    gunBus = ctx.createGain();
    const clip = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(3 * x) / Math.tanh(3);
    }
    clip.curve = curve;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 70;
    gunBus.connect(clip).connect(hp).connect(master);

    // echo: decaying noise impulse response
    const len = ctx.sampleRate * 0.7;
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    const verb = ctx.createConvolver();
    verb.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.3;
    hp.connect(verb).connect(wet).connect(master);
  }

  // One round of a heavy pulse rifle: low thump, sharp crack, metallic clack and ring
  function shot(t, out) {
    const v = 0.94 + Math.random() * 0.12; // small variation per round
    const env = (node, peak, decay) => {
      const g = ctx.createGain();
      g.gain.setValueAtTime(peak, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      node.connect(g).connect(out);
      return g;
    };

    const thump = ctx.createOscillator();
    thump.frequency.setValueAtTime(170 * v, t);
    thump.frequency.exponentialRampToValueAtTime(45, t + 0.09);
    env(thump, 1.3, 0.12);

    const crack = ctx.createBufferSource();
    crack.buffer = noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1700 * v;
    bp.Q.value = 0.7;
    crack.connect(bp);
    env(bp, 1.6, 0.07);

    const clack = ctx.createOscillator();
    clack.type = "square";
    clack.frequency.value = 2300 * v;
    const cbp = ctx.createBiquadFilter();
    cbp.type = "bandpass";
    cbp.frequency.value = 3100;
    cbp.Q.value = 5;
    clack.connect(cbp);
    env(cbp, 0.35, 0.03);

    const ring = ctx.createOscillator();
    ring.type = "triangle";
    ring.frequency.value = 1180 * v;
    env(ring, 0.07, 0.14);

    for (const o of [thump, crack, clack, ring]) { o.start(t); o.stop(t + 0.3); }
  }

  return {
    start() {
      if (!ctx) build();
      if (ctx.state === "suspended") ctx.resume();
    },
    get enabled() { return enabled; },
    toggle() {
      enabled = !enabled;
      if (ctx) master.gain.setTargetAtTime(enabled ? 0.5 : 0, ctx.currentTime, 0.05);
      return enabled;
    },
    // Gunfire: shot times in seconds from now; volume 0..1; muffle = low-pass cutoff in Hz (distance)
    gunfire(times, { volume = 1, muffle = 9000 } = {}) {
      if (!ctx || !enabled || !times.length) return;
      const out = ctx.createGain();
      out.gain.value = volume;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = muffle;
      out.connect(lp).connect(gunBus);
      const now = ctx.currentTime + 0.02;
      times.forEach((s) => shot(now + s, out));
    },
    // Radio transmission: a short, unintelligible burst. Squelch click, choppy band-limited static
    // (like speech buried in noise), closing click. Same length whatever was said.
    // kind: "soldier" or "mother" (the ship computer: a few data chirps instead of static)
    // urgent: someone shouting (contact!): louder, overdriven, higher and harsher, a little longer
    radio({ kind = "soldier", urgent = false } = {}) {
      if (!ctx || !enabled) return;
      const t0 = ctx.currentTime + 0.02;
      const len = urgent ? 0.55 + Math.random() * 0.25 : 0.38 + Math.random() * 0.2; // seconds between the clicks
      const out = ctx.createGain();
      out.gain.value = urgent ? 1.4 : 0.9;
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = urgent ? 650 : 400;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = urgent ? 4800 : 3200;
      if (urgent) { // a shout clips the radio: hard overdrive
        const drive = ctx.createWaveShaper();
        const curve = new Float32Array(512);
        for (let i = 0; i < 512; i++) { const x = i / 255.5 - 1; curve[i] = Math.max(-0.8, Math.min(0.8, Math.tanh(9 * x))); }
        drive.curve = curve;
        out.connect(drive).connect(hp).connect(lp).connect(master);
      } else {
        out.connect(hp).connect(lp).connect(master);
      }

      const burst = (t, dur, peak) => { // a noise burst with a sharp attack: the squelch
        const n = ctx.createBufferSource();
        n.buffer = noiseBuf;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(peak, t + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        n.connect(g).connect(out);
        n.start(t, Math.random() * 0.2);
        n.stop(t + dur + 0.02);
      };
      burst(t0, 0.06, urgent ? 1 : 0.9);
      const start = t0 + 0.06, end = start + len;

      if (kind === "mother") {
        for (let t = start; t < end - 0.04; t += 0.06 + Math.random() * 0.04) {
          const o = ctx.createOscillator();
          o.type = "square";
          o.frequency.value = 700 + Math.floor(Math.random() * 6) * 180;
          const g = ctx.createGain();
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(0.25, t + 0.004);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
          o.connect(g).connect(out);
          o.start(t);
          o.stop(t + 0.05);
        }
      } else {
        // static through a resonant band that wanders, chopped on and off quickly
        const n = ctx.createBufferSource();
        n.buffer = noiseBuf;
        n.loop = true;
        const band = ctx.createBiquadFilter();
        band.type = "bandpass";
        band.Q.value = urgent ? 3 : 1.6;
        const chop = ctx.createGain();
        chop.gain.setValueAtTime(0.0001, start);
        n.connect(band).connect(chop).connect(out);
        for (let t = start; t < end; ) {
          const on = urgent ? 0.02 + Math.random() * 0.04 : 0.025 + Math.random() * 0.06;
          const off = urgent ? 0.008 + Math.random() * 0.02 : 0.01 + Math.random() * 0.035;
          band.frequency.setTargetAtTime(urgent ? 1300 + Math.random() * 2000 : 700 + Math.random() * 1600, t, 0.01);
          chop.gain.setTargetAtTime(urgent ? 0.8 + Math.random() * 0.4 : 0.5 + Math.random() * 0.5, t, 0.006);
          chop.gain.setTargetAtTime(0.08, t + on, 0.008); // never fully silent: the hiss stays under it
          t += on + off;
        }
        chop.gain.setTargetAtTime(0.0001, end, 0.01);
        n.start(start, Math.random() * 0.2);
        n.stop(end + 0.05);
      }
      burst(end + 0.01, 0.05, 0.7); // closing click
    },
    // A soldier dying: kind "male" or "female"; volume 0..1; muffle = low-pass cutoff in Hz (distance)
    scream(kind, { volume = 1, muffle = 12000 } = {}) {
      if (!ctx || !enabled || !screams[kind]) return;
      const src = ctx.createBufferSource();
      src.buffer = screams[kind];
      src.playbackRate.value = 0.95 + Math.random() * 0.1; // not quite the same every time
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = muffle;
      const g = ctx.createGain();
      g.gain.value = volume;
      src.connect(lp).connect(g).connect(master);
      src.start(ctx.currentTime + 0.02);
    },
    // How tense the music should be: 0 (quiet) .. 1 (hostiles on top of the squad)
    setTension(t) {
      if (music) music.target = Math.max(0, Math.min(1, t));
    },
    // Sonar ping for the tactical map's sweep: a short, soft sine "pip" with a quick decay
    beep() {
      if (!ctx || !enabled) return;
      const t = ctx.currentTime + 0.01;
      const out = ctx.createGain();
      out.gain.setValueAtTime(0.0001, t);
      out.gain.exponentialRampToValueAtTime(0.07, t + 0.008);
      out.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
      out.connect(master);
      const tone = ctx.createOscillator();
      tone.type = "sine";
      tone.frequency.setValueAtTime(1320, t);
      tone.frequency.exponentialRampToValueAtTime(1250, t + 0.28);
      tone.connect(out);
      tone.start(t);
      tone.stop(t + 0.3);
    },
    // Called every feed frame with the current interference state. burst: heavy snow (no signal, switching).
    update({ burst, crackle }) {
      if (!ctx || !enabled) return;
      const t = ctx.currentTime;
      noiseGain.gain.setTargetAtTime(burst ? 0.45 : 0.07 + Math.random() * 0.02, t, burst ? 0.02 : 0.08);
      if (crackle) {
        crackleGain.gain.cancelScheduledValues(t);
        crackleGain.gain.setValueAtTime(0.25 + Math.random() * 0.35, t);
        crackleGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.03 + Math.random() * 0.05);
      }
    },
  };
}
