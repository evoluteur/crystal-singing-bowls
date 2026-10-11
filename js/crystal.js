/*!
 * Crystal Singing Bowls
 * https://github.com/evoluteur/crystal-singing-bowls
 * (c) 2026 Olivier Giulieri - MIT license
 *
 * Every bowl is synthesized with the Web Audio API. Fused quartz rings with
 * an almost pure sine tone and very little damping, so a crystal bowl is
 * modeled as a strong fundamental that lasts a long time, a faint inharmonic
 * overtone, and a slow beating from two oscillators a fraction of a hertz
 * apart. Nothing is sampled or downloaded.
 */

const CHAKRAS = [
  {
    name: "Root",
    sk: "Muladhara",
    color: "#ef5350",
    where: "Base of the spine",
    element: "Earth",
    bija: "LAM",
    theme: "Grounding, safety, the body",
  },
  {
    name: "Sacral",
    sk: "Svadhisthana",
    color: "#ff9800",
    where: "Lower belly",
    element: "Water",
    bija: "VAM",
    theme: "Feeling, pleasure, creativity",
  },
  {
    name: "Solar plexus",
    sk: "Manipura",
    color: "#fdd835",
    where: "Above the navel",
    element: "Fire",
    bija: "RAM",
    theme: "Will, confidence, energy",
  },
  {
    name: "Heart",
    sk: "Anahata",
    color: "#66bb6a",
    where: "Center of the chest",
    element: "Air",
    bija: "YAM",
    theme: "Love, compassion, balance",
  },
  {
    name: "Throat",
    sk: "Vishuddha",
    color: "#29b6f6",
    where: "Throat",
    element: "Space (ether)",
    bija: "HAM",
    theme: "Voice, truth, expression",
  },
  {
    name: "Third eye",
    sk: "Ajna",
    color: "#5c6bc0",
    where: "Between the eyebrows",
    element: "Light",
    bija: "OM",
    theme: "Intuition, insight, imagination",
  },
  {
    name: "Crown",
    sk: "Sahasrara",
    color: "#ab47bc",
    where: "Top of the head",
    element: "Thought",
    bija: "Silence",
    theme: "Awareness, connection, peace",
  },
];
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const SOLFEGGIO = [396, 417, 528, 639, 741, 852, 963];
const SOLF_SYL = ["Ut", "Re", "Mi", "Fa", "Sol", "La", "Si"];

const SETS = {
  a440: "Notes, A = 440 Hz",
  a432: "Notes, A = 432 Hz",
  solfeggio: "Solfeggio",
};
const SET_NOTES = {
  a440: "One bowl per note of the C major scale, C for the root up to B for the crown, the way most crystal bowl sets are sold. Concert pitch: A = 440 Hz.",
  a432: "The same seven notes tuned a little lower, with A at 432 Hz, a tuning many sound healers prefer.",
  solfeggio: "The six Solfeggio frequencies (396 to 852 Hz) plus 963 Hz for the crown. They are not notes of a scale, so the bowls sound less consonant together.",
};
const OCTAVES = { 3: "Low (8 to 14 in)", 4: "Middle (6 to 10 in)" };
const JOURNEY = { 30: "30 s each", 60: "1 min each", 120: "2 min each" };
const BATH_LENGTHS = { 5: "5 min", 10: "10 min", 20: "20 min", 30: "30 min" };
const MODES = { strike: "Strike", sing: "Sing (hold)" };

// Partials of the quartz bowl model: ratio to the fundamental, level, the
// beat (Hz) between the two oscillators of the pair, and the decay time.
const PARTIALS = [
  { ratio: 1, amp: 1, beat: 0.22, tau: 13 },
  { ratio: 2, amp: 0.035, beat: 0.4, tau: 5 }, // faint harmonic of the glass
  { ratio: 2.83, amp: 0.09, beat: 0.75, tau: 4.2 },
  { ratio: 5.35, amp: 0.022, beat: 1.6, tau: 1.8 },
];

const KEY = "crystal-bowls-settings";
let settings = {
  set: "a440",
  octave: 4,
  volume: 70,
  reverb: 50,
  mode: "strike",
  journey: 60,
  bath: 10,
};

let AC = null;
let bus, dryGain, wetGain, master;
let bowls = [];
const voices = {}; // index -> sung voice
const ringing = new Map(); // index -> { t0, tau, sustain, level }
let focus = 0; // bowl shown in the water view and chakra card
let bath = null;
let journey = null;
let animId = 0;
let waterPhase = 0;

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- tuning

const buildBowls = () => {
  bowls = CHAKRAS.map((c, i) => {
    let freq, note;
    if (settings.set === "solfeggio") {
      freq = SOLFEGGIO[i] / (settings.octave === 3 ? 2 : 1);
      note = SOLF_SYL[i];
    } else {
      const midi = 12 * (settings.octave + 1) + MAJOR[i];
      freq = +settings.set.slice(1) * Math.pow(2, (midi - 69) / 12);
      note = NOTE_NAMES[MAJOR[i]] + settings.octave;
    }
    return { i, freq, note, color: c.color, chakra: c, scale: 1.04 - i * 0.05 };
  });
};

// ---------------------------------------------------------------- audio

const impulse = (ctx, seconds = 5.5, decay = 2.4) => {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      lp += 0.3 * (Math.random() * 2 - 1 - lp);
      d[i] = lp * Math.pow(1 - i / n, decay) * 1.5;
    }
  }
  return buf;
};

const ensureAudio = () => {
  if (!AC) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    AC = new Ctx();
    bus = AC.createGain();
    dryGain = AC.createGain();
    wetGain = AC.createGain();
    const conv = AC.createConvolver();
    conv.buffer = impulse(AC);
    master = AC.createGain();
    const comp = AC.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 5;
    bus.connect(dryGain).connect(master);
    bus.connect(conv).connect(wetGain).connect(master);
    master.connect(comp).connect(AC.destination);
    applyMix();
  }
  if (AC.state === "suspended") AC.resume();
  return AC;
};

const applyMix = () => {
  if (!AC) return;
  const t = AC.currentTime;
  const wet = settings.reverb / 100;
  master.gain.setTargetAtTime((settings.volume / 100) ** 1.6, t, 0.05);
  dryGain.gain.setTargetAtTime(1 - 0.5 * wet, t, 0.05);
  wetGain.gain.setTargetAtTime(wet * 1.2, t, 0.05);
};

// The soft "tock" of a rubber mallet against the glass.
const thump = (t0, freq, strength) => {
  const n = Math.floor(AC.sampleRate * 0.05);
  const buf = AC.createBuffer(1, n, AC.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 4);
  const src = AC.createBufferSource();
  src.buffer = buf;
  const lp = AC.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = Math.min(4000, freq * 3);
  const g = AC.createGain();
  g.gain.value = 0.07 * strength;
  src.connect(lp).connect(g).connect(bus);
  src.start(t0);
};

// One bowl voice. A sung voice swells over a few seconds and holds, with a
// slow "wah" as the mallet travels around the rim; a struck voice blooms in
// a few milliseconds and rings for half a minute.
const makeVoice = (freq, { sing = false, strength = 1 } = {}) => {
  const t0 = AC.currentTime;
  const out = AC.createGain();
  out.gain.value = 0;
  const wob = AC.createGain();
  wob.gain.value = sing ? 0.85 : 1;
  out.connect(wob).connect(bus);
  const nodes = [];
  if (sing) {
    const lfo = AC.createOscillator();
    lfo.frequency.value = 0.7 + Math.random() * 0.3; // one turn of the mallet
    const lg = AC.createGain();
    lg.gain.value = 0.14;
    lfo.connect(lg).connect(wob.gain);
    lfo.start(t0);
    nodes.push(lfo);
    // faint friction of suede on frosted glass, tuned to the bowl
    const n = AC.sampleRate * 2;
    const nb = AC.createBuffer(1, n, AC.sampleRate);
    const nd = nb.getChannelData(0);
    for (let i = 0; i < n; i++) nd[i] = Math.random() * 2 - 1;
    const ns = AC.createBufferSource();
    ns.buffer = nb;
    ns.loop = true;
    const bp = AC.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = freq;
    bp.Q.value = 30;
    const ng = AC.createGain();
    ng.gain.value = 0.25;
    ns.connect(bp).connect(ng).connect(out);
    ns.start(t0);
    nodes.push(ns);
  }
  const drift = 1 + (Math.random() - 0.5) * 0.001;
  let maxTau = 0;
  PARTIALS.forEach((p, i) => {
    const f = freq * p.ratio * drift;
    if (f > 16000) return;
    const pg = AC.createGain();
    pg.gain.value = p.amp * (sing && i > 0 ? 0.6 : 1);
    const env = AC.createGain();
    if (sing) env.gain.value = 1;
    else {
      env.gain.setValueAtTime(0, t0);
      env.gain.linearRampToValueAtTime(1, t0 + 0.012);
      env.gain.setTargetAtTime(0, t0 + 0.012, p.tau);
    }
    maxTau = Math.max(maxTau, p.tau);
    for (const d of [0, p.beat * (0.8 + Math.random() * 0.4)]) {
      const o = AC.createOscillator();
      o.frequency.value = f + d;
      o.connect(pg);
      o.start(t0);
      nodes.push(o);
    }
    pg.connect(env).connect(out);
  });
  const peak = 0.17 * strength;
  if (sing) {
    out.gain.setTargetAtTime(peak * 1.1, t0, 1.4);
  } else {
    out.gain.setValueAtTime(peak, t0);
    thump(t0, freq, strength);
    const stopAt = t0 + maxTau * 6 + 0.5;
    nodes.forEach((n) => n.stop(stopAt));
  }
  return {
    release(fade = 2.2) {
      const t = AC.currentTime;
      out.gain.cancelScheduledValues(t);
      out.gain.setValueAtTime(out.gain.value, t);
      out.gain.setTargetAtTime(0, t, fade);
      nodes.forEach((n) => n.stop(t + fade * 7));
    },
  };
};

// ---------------------------------------------------------------- playing

const setFocus = (i) => {
  if (focus !== i) {
    focus = i;
    renderChakra();
  }
};

const strike = (i, strength = 1) => {
  if (!ensureAudio()) return;
  makeVoice(bowls[i].freq, { strength });
  ringing.set(i, { t0: AC.currentTime, tau: PARTIALS[0].tau, sustain: false, from: strength });
  setFocus(i);
  startAnim();
};

const singStart = (i) => {
  if (!ensureAudio() || voices[i]) return;
  voices[i] = makeVoice(bowls[i].freq, { sing: true });
  ringing.set(i, { t0: AC.currentTime, swell: AC.currentTime, sustain: true });
  setFocus(i);
  startAnim();
};

const singStop = (i, fade = 2.2) => {
  const v = voices[i];
  if (!v) return;
  v.release(fade);
  delete voices[i];
  ringing.set(i, { t0: AC.currentTime, tau: fade * 1.2, sustain: false, from: ringing.get(i)?.level || 0.9 });
};

const stopAll = () => Object.keys(voices).forEach((i) => singStop(+i, 1.2));

// ---------------------------------------------------------------- visuals

const levelOf = (r, now) => {
  if (r.sustain) return Math.min(1, 0.1 + (now - r.swell) / 3.5);
  return (r.from ?? 1) * Math.exp(-(now - r.t0) / (r.tau * 0.75));
};

const startAnim = () => {
  if (!animId) animId = requestAnimationFrame(frame);
};

const frame = () => {
  animId = 0;
  const now = AC ? AC.currentTime : 0;
  document.querySelectorAll(".bowl").forEach((el, i) => {
    const r = ringing.get(i);
    if (!r) return;
    const lv = levelOf(r, now);
    r.level = lv;
    if (lv < 0.02) {
      ringing.delete(i);
      el.classList.remove("ringing");
      el.style.setProperty("--glow", 0);
    } else {
      el.classList.add("ringing");
      el.style.setProperty("--glow", lv.toFixed(3));
    }
  });
  drawWater();
  if (ringing.size || bath || journey) animId = requestAnimationFrame(frame);
};

// Top view of the focused bowl, half filled with water. The bowl's rim flexes
// in its lowest mode (two nodal diameters: four lobes), which raises tiny
// standing ripples near the rim at the four antinodes. A sung bowl's pattern
// turns with the mallet; a struck one stays put.
let waterImg = null;
const WRES = 150;
const drawWater = () => {
  const cv = $("water");
  if (!cv) return;
  const c = cv.getContext("2d");
  const W = cv.width;
  const b = bowls[focus];
  const r = ringing.get(focus);
  const lv = r ? r.level || 0 : 0;
  waterPhase += 1 / 60;
  if (!waterImg) waterImg = c.createImageData(WRES, WRES);
  const d = waterImg.data;
  const [cr, cg, cb] = hexRgb(b.color);
  const dark = document.documentElement.getAttribute("data-theme") !== "light";
  const spin = r && r.sustain ? waterPhase * 2 * Math.PI * 0.8 : 0.35;
  const k = 22 + focus * 2.2; // ripple wavenumber: higher bowls, finer ripples
  const shiver = Math.sin(waterPhase * 2 * Math.PI * 7.3);
  const R = WRES / 2;
  for (let y = 0; y < WRES; y++) {
    for (let x = 0; x < WRES; x++) {
      const dx = (x + 0.5 - R) / R;
      const dy = (y + 0.5 - R) / R;
      const rr = Math.hypot(dx, dy);
      const p = (y * WRES + x) * 4;
      if (rr > 1) {
        d[p + 3] = 0;
        continue;
      }
      const th = Math.atan2(dy, dx);
      const rim = Math.max(0, (rr - 0.35) / 0.65);
      const lobes = Math.cos(2 * (th - spin));
      const standing = lobes * lobes * Math.sin(k * (1 - rr) * Math.PI) * rim * rim * shiver;
      const travel = 0.25 * Math.sin(k * 0.6 * rr * Math.PI - waterPhase * 9) * rim;
      const h = lv * (standing * 0.9 + travel * lv);
      // base: deep in the center, lighter toward the frosted wall
      const base = dark ? 0.16 + 0.32 * rr * rr : 0.55 + 0.35 * rr * rr;
      const s = Math.max(0, Math.min(1, base + h * 0.55));
      const tint = 0.25 + 0.55 * lv;
      d[p] = (s * 255) * (1 - tint) + cr * s * tint * 1.2;
      d[p + 1] = (s * 255) * (1 - tint) + cg * s * tint * 1.2;
      d[p + 2] = (s * 255) * (1 - tint) + cb * s * tint * 1.2;
      d[p + 3] = 255;
    }
  }
  if (!drawWater.off) drawWater.off = Object.assign(document.createElement("canvas"), { width: WRES, height: WRES });
  drawWater.off.getContext("2d").putImageData(waterImg, 0, 0);
  c.clearRect(0, 0, W, W);
  const pad = 16;
  c.save();
  c.beginPath();
  c.arc(W / 2, W / 2, W / 2 - pad, 0, Math.PI * 2);
  c.clip();
  c.imageSmoothingEnabled = true;
  c.drawImage(drawWater.off, pad, pad, W - 2 * pad, W - 2 * pad);
  c.restore();
  // the frosted rim, glowing with the bowl's color while it sings
  c.lineWidth = 12;
  c.strokeStyle = dark ? "rgba(235,240,248,0.85)" : "rgba(255,255,255,0.95)";
  c.beginPath();
  c.arc(W / 2, W / 2, W / 2 - pad + 2, 0, Math.PI * 2);
  c.stroke();
  if (lv > 0.01) {
    c.save();
    c.shadowColor = b.color;
    c.shadowBlur = 30 * lv;
    c.lineWidth = 3;
    c.strokeStyle = b.color;
    c.globalAlpha = Math.min(1, lv * 1.4);
    c.beginPath();
    c.arc(W / 2, W / 2, W / 2 - pad + 8, 0, Math.PI * 2);
    c.stroke();
    c.restore();
  }
  if (r && r.sustain) {
    // the mallet, travelling around the rim
    const a = spin;
    const mx = W / 2 + Math.cos(a) * (W / 2 - 6);
    const my = W / 2 + Math.sin(a) * (W / 2 - 6);
    c.fillStyle = "#b08a64";
    c.beginPath();
    c.arc(mx, my, 7, 0, Math.PI * 2);
    c.fill();
  }
};

const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

// ---------------------------------------------------------------- journey

const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

const startJourney = () => {
  if (!ensureAudio()) return;
  stopBath();
  stopAll();
  journey = { step: -1, len: settings.journey, timer: 0, tick: 0, stepStart: 0 };
  $("journey-btn").textContent = "Stop the journey";
  journeyNext();
  journey.tick = setInterval(updateJourneyLeft, 500);
  startAnim();
};

const journeyNext = () => {
  if (!journey) return;
  const prev = journey.step;
  journey.step++;
  if (journey.step >= bowls.length) {
    if (prev >= 0) singStop(prev, 4);
    stopJourney(true);
    return;
  }
  singStart(journey.step);
  // the previous bowl fades out under the new one
  if (prev >= 0) setTimeout(() => singStop(prev, 2.5), 1500);
  journey.stepStart = Date.now();
  journey.timer = setTimeout(journeyNext, journey.len * 1000);
  renderJourneyDots();
  updateJourneyLeft();
};

const stopJourney = (finished = false) => {
  if (!journey) return;
  clearTimeout(journey.timer);
  clearInterval(journey.tick);
  if (!finished) stopAll();
  journey = null;
  $("journey-btn").textContent = "Start the journey";
  $("journey-left").textContent = finished ? "Complete" : "";
  renderJourneyDots();
};

const updateJourneyLeft = () => {
  if (!journey) return;
  const left = Math.max(0, journey.len - (Date.now() - journey.stepStart) / 1000);
  $("journey-left").textContent = `${journey.step + 1} of 7, ${fmtTime(left)}`;
};

const renderJourneyDots = () => {
  $("journey-dots").innerHTML = bowls
    .map((b, i) => {
      const state = journey ? (i < journey.step ? "done" : i === journey.step ? "now" : "") : "";
      return `<span class="${state}" style="--c:${b.color}"></span>`;
    })
    .join("");
};

// ---------------------------------------------------------------- sound bath

const scheduleBath = () => {
  if (!bath) return;
  let i;
  do i = Math.floor(Math.random() * bowls.length);
  while (i === bath.last && bowls.length > 1);
  bath.last = i;
  if (Math.random() < 0.35 && !voices[i]) {
    // a long sung tone
    singStart(i);
    const hold = 6000 + Math.random() * 6000;
    setTimeout(() => singStop(i, 3), hold);
    bath.timer = setTimeout(scheduleBath, hold + 2000 + Math.random() * 4000);
  } else {
    strike(i, 0.5 + Math.random() * 0.4);
    bath.timer = setTimeout(scheduleBath, 5000 + Math.random() * 7000);
  }
};

const updateBathLeft = () => {
  if (!bath) {
    $("bath-left").textContent = "";
    return;
  }
  const left = Math.max(0, (bath.end - Date.now()) / 1000);
  $("bath-left").textContent = fmtTime(left) + " left";
  if (left <= 0) stopBath();
};

const startBath = () => {
  if (!ensureAudio()) return;
  stopJourney();
  bath = { end: Date.now() + settings.bath * 60000, last: -1 };
  bath.tick = setInterval(updateBathLeft, 500);
  $("bath-btn").textContent = "Stop sound bath";
  scheduleBath();
  updateBathLeft();
  startAnim();
};

const stopBath = () => {
  if (!bath) return;
  clearTimeout(bath.timer);
  clearInterval(bath.tick);
  bath = null;
  stopAll();
  $("bath-btn").textContent = "Start sound bath";
  updateBathLeft();
};

// ---------------------------------------------------------------- UI

const bowlSvg = (b) => `
  <svg viewBox="0 0 100 84" aria-hidden="true">
    <defs>
      <linearGradient id="q${b.i}" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#dfe6ef"/>
        <stop offset="0.35" stop-color="#ffffff"/>
        <stop offset="1" stop-color="#c3ccd8"/>
      </linearGradient>
      <radialGradient id="g${b.i}" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stop-color="${b.color}" stop-opacity="0.95"/>
        <stop offset="1" stop-color="${b.color}" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <ellipse cx="50" cy="78" rx="40" ry="5" fill="rgba(0,0,0,0.3)"/>
    <g class="rings">
      <ellipse class="ring" cx="50" cy="20" rx="44" ry="8"/>
      <ellipse class="ring" cx="50" cy="20" rx="44" ry="8"/>
      <ellipse class="ring" cx="50" cy="20" rx="44" ry="8"/>
    </g>
    <path d="M7 20 L9 58 Q11 76 50 76 Q89 76 91 58 L93 20 Z" fill="url(#q${b.i})"/>
    <ellipse class="inner-glow" cx="50" cy="48" rx="36" ry="22" fill="url(#g${b.i})"/>
    <ellipse cx="50" cy="20" rx="43" ry="8" fill="#f3f6fa"/>
    <ellipse cx="50" cy="21" rx="38" ry="6" fill="#cfd8e3"/>
    <ellipse class="water-top" cx="50" cy="22" rx="30" ry="4" fill="${b.color}" fill-opacity="0.35"/>
    <path d="M17 30 L18 56" stroke="rgba(255,255,255,0.9)" stroke-width="3" stroke-linecap="round"/>
  </svg>`;

const renderBowls = () => {
  $("bowls").innerHTML = bowls
    .map(
      (b) => `
    <button type="button" class="bowl" data-i="${b.i}" style="--c:${b.color};--s:${b.scale.toFixed(2)}"
      aria-label="${b.note}, ${b.chakra.name} chakra, ${b.freq.toFixed(1)} hertz">
      <span class="bowl-key">${b.i + 1}</span>
      ${bowlSvg(b)}
      <div class="bowl-note">${b.note}</div>
      <div class="bowl-freq">${b.freq.toFixed(1)} Hz</div>
      <div class="bowl-name">${b.chakra.name}</div>
    </button>`,
    )
    .join("");
};

const renderChakra = () => {
  const b = bowls[focus];
  const c = b.chakra;
  $("chakra-card").style.setProperty("--c", c.color);
  $("chakra-card").innerHTML = `
    <h3>Chakra ${focus + 1} of 7</h3>
    <div class="ck-name"><span class="ck-dot"></span>${c.name} <span class="ck-sk">${c.sk}</span></div>
    <p class="ck-theme">${c.theme}</p>
    <dl class="ck-facts">
      <dt>Where</dt><dd>${c.where}</dd>
      <dt>Element</dt><dd>${c.element}</dd>
      <dt>Seed sound</dt><dd>${c.bija}</dd>
      <dt>Bowl</dt><dd>${b.note}, ${b.freq.toFixed(1)} Hz</dd>
    </dl>`;
  $("water-cap").textContent = `The water in the ${c.name.toLowerCase()} bowl`;
};

const chips = (id, obj, key) => {
  $(id).innerHTML = Object.entries(obj)
    .map(([k, v]) => `<button type="button" data-k="${k}" aria-pressed="${String(settings[key]) === k}">${v}</button>`)
    .join("");
};

const renderControls = () => {
  chips("mode-chips", MODES, "mode");
  chips("set-chips", SETS, "set");
  chips("octave-chips", OCTAVES, "octave");
  chips("journey-chips", JOURNEY, "journey");
  chips("bath-chips", BATH_LENGTHS, "bath");
  $("tuning-note").textContent = SET_NOTES[settings.set];
  $("volume").value = settings.volume;
  $("volume-val").textContent = settings.volume + "%";
  $("reverb").value = settings.reverb;
  $("reverb-val").textContent = settings.reverb + "%";
};

const save = () => {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // storage unavailable: settings just won't persist
  }
};

const restore = () => {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || "null");
    if (!s) return;
    if (SETS[s.set]) settings.set = s.set;
    if (OCTAVES[s.octave]) settings.octave = +s.octave;
    if (MODES[s.mode]) settings.mode = s.mode;
    if (JOURNEY[s.journey]) settings.journey = +s.journey;
    if (BATH_LENGTHS[s.bath]) settings.bath = +s.bath;
    for (const k of ["volume", "reverb"]) {
      if (typeof s[k] === "number") settings[k] = Math.min(100, Math.max(0, s[k]));
    }
  } catch {
    // ignore corrupt saved data
  }
};

const setSetting = (key, value) => {
  settings[key] = value;
  save();
  if (key === "set" || key === "octave") {
    stopJourney();
    stopAll();
    buildBowls();
    renderBowls();
    renderChakra();
    renderJourneyDots();
  }
  renderControls();
};

const bindChips = (id, key, num) =>
  $(id).addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (b) setSetting(key, num ? +b.dataset.k : b.dataset.k);
  });

const bind = () => {
  bindChips("mode-chips", "mode", false);
  bindChips("set-chips", "set", false);
  bindChips("octave-chips", "octave", true);
  bindChips("journey-chips", "journey", true);
  bindChips("bath-chips", "bath", true);
  for (const k of ["volume", "reverb"]) {
    $(k).addEventListener("input", (e) => {
      settings[k] = +e.target.value;
      $(k + "-val").textContent = settings[k] + "%";
      applyMix();
      save();
    });
  }
  $("journey-btn").addEventListener("click", () => (journey ? stopJourney() : startJourney()));
  $("bath-btn").addEventListener("click", () => (bath ? stopBath() : startBath()));

  const grid = $("bowls");
  grid.addEventListener("pointerdown", (e) => {
    const el = e.target.closest(".bowl");
    if (!el) return;
    const i = +el.dataset.i;
    if (settings.mode === "sing") {
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // synthetic or already-released pointer
      }
      singStart(i);
    } else strike(i);
  });
  const release = (e) => {
    const el = e.target.closest?.(".bowl");
    if (el && settings.mode === "sing" && !(journey && journey.step === +el.dataset.i)) singStop(+el.dataset.i);
  };
  grid.addEventListener("pointerup", release);
  grid.addEventListener("pointercancel", release);
  grid.addEventListener("contextmenu", (e) => e.preventDefault());
  // keyboard: 1-7 (Enter/Space on a focused bowl is handled by pointer events
  // for mouse users; keyboard users get the number keys)
  document.addEventListener("keydown", (e) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= bowls.length) {
      if (settings.mode === "sing") singStart(n - 1);
      else strike(n - 1);
    }
  });
  document.addEventListener("keyup", (e) => {
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= bowls.length && settings.mode === "sing") singStop(n - 1);
  });
  window.addEventListener("omg-theme", () => drawWater());
};

const initCrystal = () => {
  restore();
  buildBowls();
  renderBowls();
  renderControls();
  renderChakra();
  renderJourneyDots();
  bind();
  drawWater();
};
