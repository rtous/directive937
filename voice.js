"use strict";

// Voice orders (experimental): speak into the comms box with the browser's own speech recognition (Chrome's Web
// Speech API, webkitSpeechRecognition: the audio goes to Google's servers, so it needs a connection, and the page
// on localhost or https). What is heard goes in the comms input and is sent as if typed.
//
// Self-contained on purpose: it only finds the comms form by its ids, adds its own button and styles, and sends
// through the form's normal submit. To remove it, delete this file and its <script> line in game.html.
//
// Use: click the MIC button (click again to stop early), or hold the ` key (push to talk) while not typing.
(() => {
  const VOICE = {
    lang: "en-US",     // what the player speaks
    pushToTalk: "Backquote", // key held to talk (KeyboardEvent.code)
  };

  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const form = document.getElementById("comms-form");
  const input = document.getElementById("comms-input");
  if (!Recognition || !form || !input) return; // not supported here (e.g. Firefox): the game stays as it is

  const style = document.createElement("style");
  style.textContent = `
    .voice-btn { background: var(--deep, #071a07); border: 1px solid var(--line, #1f5a2a); color: var(--synthetic, #7a807f);
      font: inherit; font-size: 10px; letter-spacing: 0.12em; padding: 3px 6px; cursor: pointer; }
    .voice-btn:hover { border-color: var(--seegson, #05b669); color: var(--seegson, #05b669); }
    .voice-btn.live { background: var(--acid, #f07826); border-color: var(--acid, #f07826); color: var(--deep, #071a07);
      animation: voice-pulse 0.8s ease-in-out infinite alternate; }
    @keyframes voice-pulse { from { opacity: 1; } to { opacity: 0.55; } }
    .comms-form input.voice-interim { color: var(--acid, #f07826); }
  `;
  document.head.appendChild(style);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "voice-btn";
  btn.textContent = "MIC";
  btn.title = `Voice order: click to talk (or hold the ${VOICE.pushToTalk === "Backquote" ? "`" : VOICE.pushToTalk} key)`;
  form.insertBefore(btn, form.querySelector('button[type="submit"]'));

  const rec = new Recognition();
  rec.lang = VOICE.lang;
  rec.interimResults = true; // show the words as they come
  rec.continuous = false;    // one order per go: it stops by itself after a pause
  rec.maxAlternatives = 1;

  let live = false, heard = "", typedBefore = "";
  const show = (on) => { live = on; btn.classList.toggle("live", on); btn.textContent = on ? "● REC" : "MIC"; };

  function start() {
    if (live) return;
    heard = "";
    typedBefore = input.value;
    try { rec.start(); show(true); } catch (err) { console.warn("Voice: could not start:", err); }
  }
  function stop() { if (live) rec.stop(); } // the final result still comes in, then onend

  rec.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) heard += r[0].transcript;
      else interim += r[0].transcript;
    }
    input.value = (heard + interim).trim();
    input.classList.toggle("voice-interim", !!interim);
  };
  rec.onerror = (e) => {
    if (e.error === "no-speech" || e.error === "aborted") return;
    console.warn("Voice:", e.error);
    if (e.error === "not-allowed" || e.error === "service-not-allowed") btn.title = "Voice: microphone blocked (allow it in the address bar)";
  };
  rec.onend = () => {
    show(false);
    input.classList.remove("voice-interim");
    const text = heard.trim();
    if (text) { input.value = text; form.requestSubmit(); } // sent like a typed message
    else input.value = typedBefore; // nothing heard: leave what was typed
  };

  btn.addEventListener("click", () => (live ? stop() : start()));
  const typing = () => ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName);
  window.addEventListener("keydown", (e) => {
    if (e.code !== VOICE.pushToTalk || e.repeat || typing()) return;
    e.preventDefault();
    start();
  });
  window.addEventListener("keyup", (e) => { if (e.code === VOICE.pushToTalk && live) stop(); });
})();
