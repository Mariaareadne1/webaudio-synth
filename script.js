/* ============================================================
   TONUS — a hybrid web audio synthesizer
   Subtractive · Additive · AM · FM · crossfaded in real time
   Built on the Web Audio API. Zero dependencies.
   ============================================================ */

document.addEventListener("DOMContentLoaded", () => {

  /* ---------- 1. AUDIO CONTEXT + MASTER BUS ---------- */

  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  // Master signal chain:  voice → globalGain → masterFilter → analyserBus → destination
  const globalGain   = audioCtx.createGain();
  const masterFilter = audioCtx.createBiquadFilter();
  const analyserBus  = audioCtx.createAnalyser();   // for the post-master spectrum
  const recorderTap  = audioCtx.createMediaStreamDestination();

  globalGain.gain.value      = 0.30;
  masterFilter.type          = "lowpass";
  masterFilter.frequency.value = 8000;
  masterFilter.Q.value       = 0.7;
  analyserBus.fftSize        = 2048;

  globalGain.connect(masterFilter);
  masterFilter.connect(analyserBus);
  analyserBus.connect(audioCtx.destination);
  analyserBus.connect(recorderTap);   // record what you hear

  /* ---------- 2. CONSTANTS ---------- */

  const MAX_POLY_GAIN = 0.40;   // ceiling for the sum of all voices

  // Filter pluck envelope (per-note)
  const FILT_ENV_ATTACK = 0.005;
  const FILT_ENV_DECAY  = 0.20;
  const FILT_ENV_AMOUNT = 4500;

  /* ---------- 2a. HARMONY ENGINE  (Nopia-inspired) ----------
     Each key on the lower octave triggers a chord built on a scale
     degree of the user-selected root key. White keys play diatonic
     chords (I ii iii IV V vi vii°). Black keys play modal-interchange
     chords — borrowed from the parallel minor / fancy substitutions.

     A "complexity" setting controls how many extensions to stack:
       0 = triad      (root, 3rd, 5th)
       1 = 7th chord  (+ 7th)
       2 = 9th chord  (+ 9th)
  -------------------------------------------------------------- */

  const ROOT_NAMES = ["C","C♯","D","D♯","E","F","F♯","G","G♯","A","A♯","B"];

  // For each of the 12 chromatic positions in the lower octave (relative
  // to the chosen root), define [intervals-of-the-chord-from-root-of-key,
  // chordQualityLabel]. Intervals are in semitones from the *chord root*,
  // not the key root.
  //
  // For example, in C major:
  //   key 0 (C)  → chord root = C (offset 0),  triad intervals 0,4,7  → C E G  (C major)
  //   key 2 (D)  → chord root = D (offset 2),  triad intervals 0,3,7  → D F A  (D minor)
  //   key 4 (E)  → chord root = E (offset 4),  triad intervals 0,3,7  → E G B  (E minor)
  //   ...
  //   key 1 (C♯) → borrowed: ♭II (Neapolitan), C♯-F-G♯ → spicy modal interchange
  //
  // chordTable[i] = { offset, triad, seventh, ninth, label }
  // The offset is added to the key-root to get the chord's root note.
  // Intervals are RELATIVE to that chord root.
  const CHORD_TABLE = [
    // i=0  → I (major triad on root)
    { offset:  0, intervals: [0, 4, 7, 11, 14], label: "I"   },
    // i=1  → ♭II (Neapolitan, major chord a half-step up — borrowed)
    { offset:  1, intervals: [0, 4, 7, 10, 14], label: "♭II" },
    // i=2  → ii (minor)
    { offset:  2, intervals: [0, 3, 7, 10, 14], label: "ii"  },
    // i=3  → ♭III (major — borrowed from parallel minor)
    { offset:  3, intervals: [0, 4, 7, 10, 14], label: "♭III"},
    // i=4  → iii (minor)
    { offset:  4, intervals: [0, 3, 7, 10, 14], label: "iii" },
    // i=5  → IV (major)
    { offset:  5, intervals: [0, 4, 7, 11, 14], label: "IV"  },
    // i=6  → V/V (secondary dominant of V — major chord on ♯IV/♭V)
    { offset:  6, intervals: [0, 4, 7, 10, 14], label: "V/V" },
    // i=7  → V (major, with dominant 7 on extension)
    { offset:  7, intervals: [0, 4, 7, 10, 14], label: "V"   },
    // i=8  → ♭VI (major — borrowed)
    { offset:  8, intervals: [0, 4, 7, 10, 14], label: "♭VI" },
    // i=9  → vi (minor)
    { offset:  9, intervals: [0, 3, 7, 10, 14], label: "vi"  },
    // i=10 → ♭VII (major — borrowed, very common in pop)
    { offset: 10, intervals: [0, 4, 7, 10, 14], label: "♭VII"},
    // i=11 → vii° (diminished)
    { offset: 11, intervals: [0, 3, 6, 10, 13], label: "vii°"},
  ];

  // Given a key-degree index (0-11 within the lower octave), the chosen
  // tonal root (0-11, where 0=C), and the complexity (0=triad, 1=7th, 2=9th),
  // return the array of MIDI-style semitone offsets from C4 (=60) for each
  // chord member.
  function chordSemitones(degree, root, complexity) {
    const e = CHORD_TABLE[degree];
    if (!e) return null;
    // How many intervals to use from the chord recipe?
    // triad=3, seventh=4, ninth=5
    const n = 3 + Math.max(0, Math.min(2, complexity));
    const out = [];
    for (let i = 0; i < n; i++) {
      out.push(root + e.offset + e.intervals[i]);
    }
    return { notes: out, label: e.label, chordRoot: root + e.offset };
  }

  // Convert a semitone offset from C4 (60) into Hz.
  function semitoneToHz(s) {
    return 261.6256 * Math.pow(2, s / 12);
  }

  // The lower octave's 12 key codes, in chromatic order (C, C♯, D, D♯, ...).
  // We use these to map key-press → scale-degree index (0–11).
  const LOWER_OCTAVE_CODES = [
    "90","83","88","68","67","86","71","66","72","78","74","77",
  ];
  const LOWER_OCTAVE_DEGREE = {};   // keyCode → degree
  LOWER_OCTAVE_CODES.forEach((c, i) => { LOWER_OCTAVE_DEGREE[c] = i; });

  const KEY_FREQ = {
    // Lower octave (home row + adjacent)
    "90": 261.6256, "83": 277.1826, "88": 293.6648, "68": 311.1270,
    "67": 329.6276, "86": 349.2282, "71": 369.9944, "66": 391.9954,
    "72": 415.3047, "78": 440.0000, "74": 466.1638, "77": 493.8833,
    // Upper octave
    "81": 523.2511, "50": 554.3653, "87": 587.3295, "51": 622.2540,
    "69": 659.2551, "82": 698.4565, "53": 739.9888, "84": 783.9909,
    "54": 830.6094, "89": 880.0000, "55": 932.3275, "85": 987.7666,
  };

  // For the on-screen click keyboard. Layout matches a real piano octave.
  const KEY_DISPLAY = [
    { code: "90", label: "Z", note: "C₄",  black: false },
    { code: "83", label: "S", note: "C♯",  black: true  },
    { code: "88", label: "X", note: "D",   black: false },
    { code: "68", label: "D", note: "D♯",  black: true  },
    { code: "67", label: "C", note: "E",   black: false },
    { code: "86", label: "V", note: "F",   black: false },
    { code: "71", label: "G", note: "F♯",  black: true  },
    { code: "66", label: "B", note: "G",   black: false },
    { code: "72", label: "H", note: "G♯",  black: true  },
    { code: "78", label: "N", note: "A",   black: false },
    { code: "74", label: "J", note: "A♯",  black: true  },
    { code: "77", label: "M", note: "B",   black: false },
    { code: "81", label: "Q", note: "C₅",  black: false },
    { code: "50", label: "2", note: "C♯",  black: true  },
    { code: "87", label: "W", note: "D",   black: false },
    { code: "51", label: "3", note: "D♯",  black: true  },
    { code: "69", label: "E", note: "E",   black: false },
    { code: "82", label: "R", note: "F",   black: false },
    { code: "53", label: "5", note: "F♯",  black: true  },
    { code: "84", label: "T", note: "G",   black: false },
    { code: "54", label: "6", note: "G♯",  black: true  },
    { code: "89", label: "Y", note: "A",   black: false },
    { code: "55", label: "7", note: "A♯",  black: true  },
    { code: "85", label: "U", note: "B",   black: false },
  ];

  /* ---------- 3. UI HANDLES ---------- */

  const $ = (id) => document.getElementById(id);

  const startBtn   = $("startBtn");
  const recordBtn  = $("recordBtn");

  // Modulation params (now exposed to the UI)
  const ui = {
    waveform:   $("waveform"),
    preset:     $("preset"),

    mixAdd:     $("mixAdd"),
    mixAM:      $("mixAM"),
    mixFM:      $("mixFM"),

    addPartials: $("addPartials"),
    addFalloff:  $("addFalloff"),

    amFreq:      $("amFreq"),
    amDepth:     $("amDepth"),

    fmRatio:     $("fmRatio"),
    fmIndex:     $("fmIndex"),

    attack:      $("attack"),
    decay:       $("decay"),
    sustain:     $("sustain"),
    release:     $("release"),

    lfoRate:     $("lfoRate"),
    lfoDepth:    $("lfoDepth"),

    filterCutoff: $("filterCutoff"),
    filterQ:      $("filterQ"),
    volume:       $("volume"),

    // Harmony / Nopia-inspired layer
    chordMode:   $("chordMode"),
    tonalRoot:   $("tonalRoot"),
    complexity:  $("complexity"),
    bassToggle:  $("bassToggle"),
    arpToggle:   $("arpToggle"),
    arpRate:     $("arpRate"),
  };

  // Bind <output> readouts next to each slider.
  function bindReadout(input, fmt) {
    if (!input) return;
    const out = document.querySelector(`output[for="${input.id}"]`);
    if (!out) return;
    const update = () => { out.textContent = fmt(Number(input.value)); };
    input.addEventListener("input", update);
    update();
  }

  const fix = (n) => (v) => v.toFixed(n);
  const hz  = (v) => `${v.toFixed(1)} Hz`;
  const ms  = (v) => v < 1 ? `${(v * 1000).toFixed(0)} ms` : `${v.toFixed(2)} s`;
  const int = (v) => `${Math.round(v)}`;

  bindReadout(ui.mixAdd,      fix(2));
  bindReadout(ui.mixAM,       fix(2));
  bindReadout(ui.mixFM,       fix(2));
  bindReadout(ui.addPartials, int);
  bindReadout(ui.addFalloff,  fix(2));
  bindReadout(ui.amFreq,      hz);
  bindReadout(ui.amDepth,     fix(2));
  bindReadout(ui.fmRatio,     fix(2));
  bindReadout(ui.fmIndex,     int);
  bindReadout(ui.attack,      ms);
  bindReadout(ui.decay,       ms);
  bindReadout(ui.sustain,     fix(2));
  bindReadout(ui.release,     ms);
  bindReadout(ui.lfoRate,     hz);
  bindReadout(ui.lfoDepth,    int);
  bindReadout(ui.filterCutoff,(v) => `${Math.round(v)} Hz`);
  bindReadout(ui.filterQ,     fix(2));
  bindReadout(ui.volume,      fix(2));

  // Complexity reads as a label, not a number.
  const COMPLEXITY_LABEL = ["triad", "7th", "9th"];
  if (ui.complexity) {
    const out = document.querySelector(`output[for="complexity"]`);
    const update = () => { out.textContent = COMPLEXITY_LABEL[Number(ui.complexity.value)] || "—"; };
    ui.complexity.addEventListener("input", update);
    update();
  }
  bindReadout(ui.arpRate, hz);

  // Tonal root: pretty-print the chosen key name.
  if (ui.tonalRoot) {
    const out = document.querySelector(`output[for="tonalRoot"]`);
    const update = () => { out.textContent = ROOT_NAMES[Number(ui.tonalRoot.value)] + " major"; };
    ui.tonalRoot.addEventListener("input", update);
    update();
  }

  // When any harmony control changes, release everything (cleanest UX).
  [ui.tonalRoot, ui.complexity, ui.chordMode, ui.bassToggle, ui.arpToggle]
    .filter(Boolean)
    .forEach(el => el.addEventListener("change", () => {
      Object.keys(keyToVoices).slice().forEach(releaseKey);
    }));

  /* ---------- 4. START BUTTON (browsers require user gesture) ---------- */

  let audioReady = false;
  startBtn.addEventListener("click", async () => {
    await audioCtx.resume();
    audioReady = true;
    startBtn.classList.add("is-on");
    startBtn.querySelector(".btn-label").textContent = "ONLINE";
  });

  /* ---------- 5. GLOBAL LFO  (modulates filter cutoff) ---------- */

  const lfoOsc  = audioCtx.createOscillator();
  const lfoGain = audioCtx.createGain();
  lfoOsc.type = "sine";
  lfoOsc.frequency.value = Number(ui.lfoRate.value);
  lfoGain.gain.value     = Number(ui.lfoDepth.value);
  lfoOsc.connect(lfoGain);
  lfoGain.connect(masterFilter.frequency);
  lfoOsc.start();

  function syncGlobals() {
    const now = audioCtx.currentTime;
    lfoOsc.frequency.setValueAtTime(Number(ui.lfoRate.value), now);
    lfoGain.gain.setValueAtTime(Number(ui.lfoDepth.value), now);
    masterFilter.frequency.setValueAtTime(Number(ui.filterCutoff.value), now);
    masterFilter.Q.setValueAtTime(Number(ui.filterQ.value), now);
    globalGain.gain.setTargetAtTime(Number(ui.volume.value), now, 0.01);
  }
  [ui.lfoRate, ui.lfoDepth, ui.filterCutoff, ui.filterQ, ui.volume]
    .forEach(el => el.addEventListener("input", syncGlobals));
  syncGlobals();

  /* ---------- 5a. TONAL SELECTOR BUTTONS ---------- */
  // Twelve chromatic buttons act as a radio group; clicking one sets the
  // hidden #tonalRoot input and dispatches its change event so the rest
  // of the system reacts (chord-label readout, key release on change).
  (function wireTonalSelector() {
    const sel = $("tonalSelector");
    if (!sel) return;
    const buttons = sel.querySelectorAll(".tonal-btn");
    const setActive = (val) => {
      buttons.forEach(b => b.classList.toggle("is-on", b.dataset.val === String(val)));
    };
    buttons.forEach(btn => {
      btn.addEventListener("click", () => {
        const val = Number(btn.dataset.val);
        ui.tonalRoot.value = String(val);
        setActive(val);
        ui.tonalRoot.dispatchEvent(new Event("input",  { bubbles: true }));
        ui.tonalRoot.dispatchEvent(new Event("change", { bubbles: true }));
      });
    });
    setActive(Number(ui.tonalRoot.value));
  })();

  /* ---------- 6. VOICE BUILDERS ---------- */
  // Each builder returns { stop(t) } and is responsible for ONLY producing
  // signal at unity-ish level into the dest node. The mix gains shape balance.

  function buildSubtractive(freq, dest, now) {
    const osc = audioCtx.createOscillator();
    osc.type = ui.waveform.value;
    osc.frequency.setValueAtTime(freq, now);
    osc.connect(dest);
    osc.start(now);
    return { stop: (t) => safeStop(osc, t) };
  }

  function buildAdditive(freq, dest, now) {
    const n = Math.max(1, Math.min(10, Math.round(Number(ui.addPartials.value))));
    const falloff = Number(ui.addFalloff.value);  // 0.1..1.0 — geometric falloff per partial
    const oscs = [];

    // Normalise so the sum of partial amplitudes ≈ 1 regardless of falloff/n.
    let weights = [];
    for (let i = 0; i < n; i++) weights.push(Math.pow(falloff, i));
    const norm = weights.reduce((a, b) => a + b, 0);

    for (let i = 0; i < n; i++) {
      const osc = audioCtx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq * (i + 1), now);
      const g = audioCtx.createGain();
      g.gain.value = weights[i] / norm;
      osc.connect(g).connect(dest);
      osc.start(now);
      oscs.push(osc);
    }
    return { stop: (t) => oscs.forEach(o => safeStop(o, t)) };
  }

  function buildAM(freq, dest, now) {
    // Carrier at the played note; modulator at a user-controlled rate.
    // Output = carrier × (1 + depth·mod), implemented as a multiplied gain.
    const carrier  = audioCtx.createOscillator();
    const mod      = audioCtx.createOscillator();
    const modDepth = audioCtx.createGain();
    const amp      = audioCtx.createGain();   // this is the multiplier

    carrier.type = ui.waveform.value;
    carrier.frequency.setValueAtTime(freq, now);

    mod.type = "sine";
    mod.frequency.setValueAtTime(Number(ui.amFreq.value), now);

    modDepth.gain.setValueAtTime(Number(ui.amDepth.value), now);

    // amp.gain is offset by 1, then mod·depth pushes it up/down → AM.
    amp.gain.setValueAtTime(1 - Number(ui.amDepth.value), now);
    mod.connect(modDepth).connect(amp.gain);

    carrier.connect(amp).connect(dest);

    carrier.start(now);
    mod.start(now);

    // Keep this voice's AM params live as the user moves sliders.
    const onAm = () => {
      const t = audioCtx.currentTime;
      mod.frequency.setTargetAtTime(Number(ui.amFreq.value), t, 0.01);
      modDepth.gain.setTargetAtTime(Number(ui.amDepth.value), t, 0.01);
      amp.gain.setTargetAtTime(1 - Number(ui.amDepth.value), t, 0.01);
    };
    ui.amFreq.addEventListener("input", onAm);
    ui.amDepth.addEventListener("input", onAm);

    return {
      stop: (t) => {
        ui.amFreq.removeEventListener("input", onAm);
        ui.amDepth.removeEventListener("input", onAm);
        safeStop(carrier, t);
        safeStop(mod, t);
      }
    };
  }

  function buildFM(freq, dest, now) {
    // True FM: modulator's output is added to the carrier's frequency.
    const carrier = audioCtx.createOscillator();
    const mod     = audioCtx.createOscillator();
    const modGain = audioCtx.createGain();

    carrier.type = ui.waveform.value;
    carrier.frequency.setValueAtTime(freq, now);

    mod.type = "sine";
    const ratio = Number(ui.fmRatio.value);
    mod.frequency.setValueAtTime(freq * ratio, now);

    modGain.gain.setValueAtTime(Number(ui.fmIndex.value), now);

    mod.connect(modGain).connect(carrier.frequency);
    carrier.connect(dest);

    carrier.start(now);
    mod.start(now);

    const onFm = () => {
      const t = audioCtx.currentTime;
      mod.frequency.setTargetAtTime(freq * Number(ui.fmRatio.value), t, 0.01);
      modGain.gain.setTargetAtTime(Number(ui.fmIndex.value), t, 0.01);
    };
    ui.fmRatio.addEventListener("input", onFm);
    ui.fmIndex.addEventListener("input", onFm);

    return {
      stop: (t) => {
        ui.fmRatio.removeEventListener("input", onFm);
        ui.fmIndex.removeEventListener("input", onFm);
        safeStop(carrier, t);
        safeStop(mod, t);
      }
    };
  }

  // Stop an oscillator safely (no double-stop).
  function safeStop(osc, t) {
    try { osc.stop(t); } catch (_) { /* already stopped */ }
  }

  /* ---------- 7. MIXER  ---------- */
  // The three engines feed individual gains that sum into the voice envelope.
  // Levels are normalised so total amplitude never exceeds 1 (clip guard).

  function normalisedMix() {
    const a = Number(ui.mixAdd.value);
    const m = Number(ui.mixAM.value);
    const f = Number(ui.mixFM.value);
    const sub = (a + m + f) < 0.001 ? 1 : 0;  // if all three are 0, fall back to subtractive
    const total = a + m + f + sub;
    return { a: a/total, m: m/total, f: f/total, s: sub/total };
  }

  /* ---------- 8. POLYPHONY ---------- */
  // Each voice has its OWN voiceLevel gain. We redistribute MAX_POLY_GAIN
  // across all active voices' voiceLevel nodes whenever a note starts/ends.
  // The envGain runs a clean 0→1→sustain→0 envelope, untouched by polyphony.

  const activeVoices = {};   // key code → voice record

  function redistributeVoiceLevels() {
    const keys = Object.keys(activeVoices);
    if (keys.length === 0) return;
    const perVoice = MAX_POLY_GAIN / keys.length;
    const now = audioCtx.currentTime;
    keys.forEach(k => {
      const { voiceLevel } = activeVoices[k];
      voiceLevel.gain.cancelScheduledValues(now);
      voiceLevel.gain.setTargetAtTime(perVoice, now, 0.03);
    });
  }

  /* ---------- 9. ADSR ENVELOPE ---------- */
  // The envelope shapes a unit-scaled value (0 → 1 → sustain → 0).
  // Final amplitude is set by the per-voice voiceLevel node downstream.

  function applyAttackDecay(gainParam, now) {
    const A = Math.max(0.001, Number(ui.attack.value));
    const D = Math.max(0.001, Number(ui.decay.value));
    const S = Math.max(0.0001, Number(ui.sustain.value));
    gainParam.cancelScheduledValues(now);
    gainParam.setValueAtTime(0.0001, now);
    gainParam.exponentialRampToValueAtTime(1.0, now + A);
    gainParam.exponentialRampToValueAtTime(Math.max(0.0001, S), now + A + D);
  }

  function applyFilterPluck(now) {
    const base = Number(ui.filterCutoff.value);
    const peak = Math.min(20000, base + FILT_ENV_AMOUNT);
    masterFilter.frequency.cancelScheduledValues(now);
    masterFilter.frequency.setValueAtTime(base, now);
    masterFilter.frequency.linearRampToValueAtTime(peak, now + FILT_ENV_ATTACK);
    masterFilter.frequency.linearRampToValueAtTime(base, now + FILT_ENV_ATTACK + FILT_ENV_DECAY);
  }

  /* ---------- 10. VOICE LIFECYCLE  (one oscillator stack = one voice) ----------
     The synth engine is parameterised purely on frequency. The chord/
     harmony layer sits on top and decides which frequencies to fire.
  -------------------------------------------------------------------- */

  // Start a single voice at the given frequency. Returns a voiceId that
  // can be passed to stopVoice() later. The voiceId is just an opaque key
  // into activeVoices.
  function startVoice(freq, voiceId) {
    if (!audioReady) return null;

    const now = audioCtx.currentTime;
    applyFilterPluck(now);

    // Signal chain per voice:
    //   engines → mixGains → envGain (ADSR, 0→1→S→0) → voiceLevel → globalGain
    const envGain    = audioCtx.createGain();
    const voiceLevel = audioCtx.createGain();
    envGain.gain.value    = 0.0001;
    voiceLevel.gain.value = MAX_POLY_GAIN;   // will be redistributed below

    envGain.connect(voiceLevel);
    voiceLevel.connect(globalGain);

    // Per-voice analyser tap (drives the per-voice oscilloscope trace).
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    const waveData = new Uint8Array(analyser.fftSize);
    voiceLevel.connect(analyser);

    // Mixer fan-out into envGain.
    const addG = audioCtx.createGain();
    const amG  = audioCtx.createGain();
    const fmG  = audioCtx.createGain();
    const subG = audioCtx.createGain();
    addG.connect(envGain); amG.connect(envGain); fmG.connect(envGain); subG.connect(envGain);

    const mix = normalisedMix();
    addG.gain.setValueAtTime(mix.a, now);
    amG.gain.setValueAtTime(mix.m,  now);
    fmG.gain.setValueAtTime(mix.f,  now);
    subG.gain.setValueAtTime(mix.s, now);

    const voices = [];
    voices.push(buildAdditive(freq, addG, now));
    voices.push(buildAM(freq, amG, now));
    voices.push(buildFM(freq, fmG, now));
    voices.push(buildSubtractive(freq, subG, now));

    applyAttackDecay(envGain.gain, now);

    activeVoices[voiceId] = {
      envGain, voiceLevel, voices, analyser, waveData,
      mixGains: { addG, amG, fmG, subG },
    };

    redistributeVoiceLevels();
    updateActiveReadout();
    return voiceId;
  }

  // Release one voice by id.
  function stopVoice(voiceId) {
    const voice = activeVoices[voiceId];
    if (!voice) return;
    const now = audioCtx.currentTime;
    const R = Math.max(0.001, Number(ui.release.value));
    voice.envGain.gain.cancelScheduledValues(now);
    voice.envGain.gain.setValueAtTime(voice.envGain.gain.value, now);
    voice.envGain.gain.exponentialRampToValueAtTime(0.0001, now + R);
    voice.voices.forEach(v => v.stop(now + R + 0.02));
    delete activeVoices[voiceId];
    redistributeVoiceLevels();
    updateActiveReadout();
  }

  /* ---------- 11. PER-KEY PLAYBACK  (mono vs chord) ----------
     A single key press can spawn one voice (mono mode) or several
     (chord mode). We track which voices belong to which key so
     releaseKey() stops them all together. The lower octave is the
     harmony zone; the upper octave is always single-note (lets you
     play melody over chords with one hand on each).
  ------------------------------------------------------------- */

  const keyToVoices = {};   // keyCode → array of voiceIds
  const keyHighlights = {}; // keyCode → array of *visual* keyCodes that should glow

  // Arpeggiator state: when active, a chord-key fires its notes one at a time.
  let arpState = null;   // { intervalId, notes, idx, voiceId }

  function playKey(keyCode) {
    if (!audioReady) return;
    if (keyToVoices[keyCode]) return;   // already held

    const degree = LOWER_OCTAVE_DEGREE[keyCode];
    const isChordZone = (degree !== undefined) && ui.chordMode.checked;

    if (isChordZone) {
      // Chord mode: build the chord, optionally arpeggiate.
      const root = Number(ui.tonalRoot.value);
      const complexity = Number(ui.complexity.value);
      const chord = chordSemitones(degree, root, complexity);
      if (!chord) return;

      // Bass: optionally drop the chord root an octave below.
      const bassOn = ui.bassToggle.checked;
      const notes = chord.notes.slice();
      if (bassOn) notes.unshift(chord.notes[0] - 12);

      // Track which on-screen keys should highlight to show the chord.
      // We map chord semitones back to the nearest lower-octave key code.
      // Chord-member keys get the softer .is-chord state; the *triggered*
      // key itself gets the bright .is-on state.
      const highlights = chordToVisualKeys(chord.notes)
        .filter(k => k !== keyCode);   // don't double-paint the trigger
      keyHighlights[keyCode] = highlights;
      highlights.forEach(k => flashKeyChord(k, true));
      flashKey(keyCode, true);   // the triggered key — bright

      // Show the chord label in the readout.
      $("chordLabel").textContent = `${ROOT_NAMES[root]} · ${chord.label}`;

      if (ui.arpToggle.checked) {
        startArpForKey(keyCode, notes);
      } else {
        // Fire all chord notes at once.
        const voiceIds = notes.map((semi, i) => {
          const id = `${keyCode}:${i}`;
          startVoice(semitoneToHz(semi), id);
          return id;
        });
        keyToVoices[keyCode] = voiceIds;
      }
    } else {
      // Mono mode (or upper-octave key): one note, original behaviour.
      const freq = KEY_FREQ[keyCode];
      if (!freq) return;
      startVoice(freq, keyCode);
      keyToVoices[keyCode] = [keyCode];
      flashKey(keyCode, true);
    }
  }

  function releaseKey(keyCode) {
    // Stop any arpeggio bound to this key first.
    if (arpState && arpState.keyCode === keyCode) {
      stopArp();
    }
    const voiceIds = keyToVoices[keyCode];
    if (voiceIds) {
      voiceIds.forEach(stopVoice);
      delete keyToVoices[keyCode];
    }
    // Clear highlights.
    const highlights = keyHighlights[keyCode];
    if (highlights) {
      highlights.forEach(k => flashKeyChord(k, false));
      delete keyHighlights[keyCode];
    }
    flashKey(keyCode, false);
    if (Object.keys(keyToVoices).length === 0) {
      $("chordLabel").textContent = "—";
    }
  }

  // Map chord semitones (relative to C4=0) to the visual key codes in the
  // lower octave that represent those pitch classes. Used to glow the
  // chord shape on the keyboard.
  function chordToVisualKeys(semitones) {
    const result = [];
    semitones.forEach(s => {
      const pitchClass = ((s % 12) + 12) % 12;
      const code = LOWER_OCTAVE_CODES[pitchClass];
      if (code) result.push(code);
    });
    return result;
  }

  /* ---------- 12. ARPEGGIATOR ---------- */

  function startArpForKey(keyCode, notes) {
    stopArp();
    // The lifetime of the arpeggio is tied to this key being held.
    let idx = 0;
    let activeId = null;

    const step = () => {
      // Stop the previous note.
      if (activeId) {
        stopVoice(activeId);
        activeId = null;
      }
      const semi = notes[idx % notes.length];
      const id = `${keyCode}:arp:${idx}`;
      startVoice(semitoneToHz(semi), id);
      activeId = id;
      // Keep keyToVoices in sync so releaseKey can clean up.
      keyToVoices[keyCode] = [id];
      idx++;
    };

    const rateHz = Number(ui.arpRate.value);
    const intervalMs = 1000 / rateHz;
    step();   // fire first note immediately
    const intervalId = setInterval(step, intervalMs);

    arpState = { intervalId, keyCode, activeId: () => activeId };
  }

  function stopArp() {
    if (!arpState) return;
    clearInterval(arpState.intervalId);
    arpState = null;
  }

  // Legacy aliases so existing keyboard/click handlers keep working.
  const playNote    = playKey;
  const stopNote    = releaseKey;

  // Live mix-slider updates apply to all currently-held voices.
  function onMixChange() {
    const mix = normalisedMix();
    const now = audioCtx.currentTime;
    Object.values(activeVoices).forEach(v => {
      v.mixGains.addG.gain.setTargetAtTime(mix.a, now, 0.02);
      v.mixGains.amG .gain.setTargetAtTime(mix.m, now, 0.02);
      v.mixGains.fmG .gain.setTargetAtTime(mix.f, now, 0.02);
      v.mixGains.subG.gain.setTargetAtTime(mix.s, now, 0.02);
    });
  }
  [ui.mixAdd, ui.mixAM, ui.mixFM].forEach(el => el.addEventListener("input", onMixChange));

  /* ---------- 11. INPUT — KEYBOARD + ON-SCREEN KEYS ----------
     SUSTAIN: holding SPACE acts like a piano sustain pedal — any key
     you release while space is down stays sounding until space is
     released (or that key is pressed again).
  -------------------------------------------------------------- */

  let sustainOn = false;          // is space currently held?
  const sustainedKeys = new Set();// keys deferred from release while sustain is active

  function setSustainIndicator(on) {
    const ind = $("sustainIndicator");
    if (ind) ind.classList.toggle("is-on", on);
  }

  window.addEventListener("keydown", (e) => {
    // Sustain pedal: spacebar.
    if (e.code === "Space" || e.which === 32) {
      e.preventDefault();
      if (!sustainOn) {
        sustainOn = true;
        setSustainIndicator(true);
      }
      return;
    }
    if (e.repeat) return;
    const k = (e.detail || e.which).toString();
    if (KEY_FREQ[k]) {
      // If the key is currently being sustained, release it cleanly
      // before re-triggering so the user hears a fresh attack.
      if (sustainedKeys.has(k)) {
        sustainedKeys.delete(k);
        releaseKey(k);
      }
      if (!keyToVoices[k]) playKey(k);
    }
  });

  window.addEventListener("keyup", (e) => {
    // Sustain release: cut everything that was deferred.
    if (e.code === "Space" || e.which === 32) {
      sustainOn = false;
      setSustainIndicator(false);
      // Release every key the user had let go of while pedaling.
      sustainedKeys.forEach(k => releaseKey(k));
      sustainedKeys.clear();
      return;
    }
    const k = (e.detail || e.which).toString();
    if (keyToVoices[k]) {
      if (sustainOn) {
        // Don't actually release — defer until sustain is lifted.
        sustainedKeys.add(k);
      } else {
        releaseKey(k);
      }
    }
  });

  // Click-keyboard release also respects sustain.
  function releaseFromPointer(code) {
    if (!keyToVoices[code]) return;
    if (sustainOn) {
      sustainedKeys.add(code);
    } else {
      releaseKey(code);
    }
  }

  // Build the click-keyboard.
  const kb = $("keyboard");
  const keyEls = {};
  KEY_DISPLAY.forEach(({ code, label, note, black }) => {
    const el = document.createElement("div");
    el.className = `key ${black ? "key-black" : "key-white"}`;
    el.dataset.code = code;
    el.innerHTML = `
      <div class="key-note">${note}</div>
      <div class="key-label">${label}</div>
    `;
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      if (!keyToVoices[code]) playKey(code);
    });
    const release = () => releaseFromPointer(code);
    el.addEventListener("pointerup", release);
    el.addEventListener("pointerleave", release);
    el.addEventListener("pointercancel", release);
    kb.appendChild(el);
    keyEls[code] = el;
  });

  function flashKey(code, on) {
    const el = keyEls[code];
    if (el) el.classList.toggle("is-on", !!on);
  }
  function flashKeyChord(code, on) {
    const el = keyEls[code];
    if (el) el.classList.toggle("is-chord", !!on);
  }

  function updateActiveReadout() {
    const n = Object.keys(activeVoices).length;
    $("polyCount").textContent = n.toString().padStart(2, "0");
  }

  /* ---------- 12. PRESETS ---------- */

  const PRESETS = {
    custom: null,
    daftBass: {
      waveform: "sawtooth",
      mixAdd: 0.05, mixAM: 0.00, mixFM: 0.95,
      fmRatio: 1.00, fmIndex: 420,
      filterCutoff: 700,  filterQ: 6,
      lfoRate: 1.2, lfoDepth: 250,
      attack: 0.005, decay: 0.20, sustain: 0.55, release: 0.30,
    },
    glassBell: {
      waveform: "sine",
      mixAdd: 0.40, mixAM: 0.00, mixFM: 0.60,
      addPartials: 7, addFalloff: 0.45,
      fmRatio: 3.50, fmIndex: 380,
      filterCutoff: 8000, filterQ: 1.0,
      lfoRate: 4.5, lfoDepth: 80,
      attack: 0.005, decay: 0.80, sustain: 0.10, release: 1.20,
    },
    discoPad: {
      waveform: "sawtooth",
      mixAdd: 0.55, mixAM: 0.10, mixFM: 0.35,
      addPartials: 5, addFalloff: 0.70,
      amFreq: 4.5, amDepth: 0.40,
      fmRatio: 2.00, fmIndex: 80,
      filterCutoff: 2200, filterQ: 2.5,
      lfoRate: 0.6, lfoDepth: 900,
      attack: 0.40, decay: 0.60, sustain: 0.75, release: 1.40,
    },
    robotLead: {
      waveform: "square",
      mixAdd: 0.20, mixAM: 0.25, mixFM: 0.55,
      addPartials: 3, addFalloff: 0.55,
      amFreq: 12.0, amDepth: 0.55,
      fmRatio: 1.50, fmIndex: 220,
      filterCutoff: 3200, filterQ: 4.0,
      lfoRate: 6.0, lfoDepth: 350,
      attack: 0.01, decay: 0.10, sustain: 0.80, release: 0.20,
    },
    pluck: {
      waveform: "triangle",
      mixAdd: 0.65, mixAM: 0.00, mixFM: 0.35,
      addPartials: 4, addFalloff: 0.50,
      fmRatio: 2.00, fmIndex: 60,
      filterCutoff: 3500, filterQ: 2.0,
      lfoRate: 3.0, lfoDepth: 60,
      attack: 0.002, decay: 0.30, sustain: 0.00, release: 0.40,
    },
  };

  function applyPreset(name) {
    const p = PRESETS[name];
    if (!p) return;
    Object.entries(p).forEach(([k, v]) => {
      const el = ui[k] || (k === "waveform" ? ui.waveform : null);
      if (!el) return;
      el.value = String(v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    syncGlobals();
    onMixChange();
  }
  ui.preset.addEventListener("change", () => applyPreset(ui.preset.value));

  /* ---------- 13. VISUALS — SCOPE + SPECTRUM ---------- */

  const scope = $("scope");
  const sctx  = scope.getContext("2d");
  const spec  = $("spectrum");
  const xctx  = spec.getContext("2d");
  const specData = new Uint8Array(analyserBus.frequencyBinCount);

  // Match canvas pixel size to its displayed size for crispness.
  function resizeCanvas(c) {
    const r = c.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    c.width  = Math.max(1, Math.round(r.width  * dpr));
    c.height = Math.max(1, Math.round(r.height * dpr));
    c.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function resizeAll() { resizeCanvas(scope); resizeCanvas(spec); }
  window.addEventListener("resize", resizeAll);
  resizeAll();

  function colorForVoice(i) {
    // Cycle through a small phosphor palette.
    const palette = ["#7fff8c", "#ffb547", "#5be0ff", "#ff3d8b", "#c5ff5b"];
    return palette[i % palette.length];
  }

  function drawFrame() {
    requestAnimationFrame(drawFrame);

    /* === SCOPE === */
    const w = scope.clientWidth, h = scope.clientHeight;
    sctx.clearRect(0, 0, w, h);

    // Centre line + faint grid.
    sctx.strokeStyle = "rgba(127,255,140,0.10)";
    sctx.lineWidth = 1;
    for (let x = 0; x <= w; x += w / 10) {
      sctx.beginPath(); sctx.moveTo(x, 0); sctx.lineTo(x, h); sctx.stroke();
    }
    for (let y = 0; y <= h; y += h / 4) {
      sctx.beginPath(); sctx.moveTo(0, y); sctx.lineTo(w, y); sctx.stroke();
    }
    sctx.strokeStyle = "rgba(127,255,140,0.25)";
    sctx.beginPath(); sctx.moveTo(0, h/2); sctx.lineTo(w, h/2); sctx.stroke();

    const voices = Object.values(activeVoices);
    if (voices.length === 0) {
      // Idle line.
      sctx.strokeStyle = "rgba(127,255,140,0.35)";
      sctx.lineWidth = 1.25;
      sctx.beginPath();
      sctx.moveTo(0, h/2); sctx.lineTo(w, h/2);
      sctx.stroke();
    } else {
      voices.forEach((v, i) => {
        v.analyser.getByteTimeDomainData(v.waveData);
        sctx.strokeStyle = colorForVoice(i);
        sctx.lineWidth = 1.5;
        sctx.globalAlpha = 0.85;
        sctx.beginPath();
        const slice = w / v.waveData.length;
        for (let j = 0; j < v.waveData.length; j++) {
          const val = (v.waveData[j] - 128) / 128;
          const x = j * slice;
          const y = h/2 + val * (h/2) * 0.9;
          if (j === 0) sctx.moveTo(x, y); else sctx.lineTo(x, y);
        }
        sctx.stroke();
      });
      sctx.globalAlpha = 1;
    }

    /* === SPECTRUM === */
    const sw = spec.clientWidth, sh = spec.clientHeight;
    xctx.clearRect(0, 0, sw, sh);
    analyserBus.getByteFrequencyData(specData);

    // Log-scaled bars across the audible range.
    const bins = specData.length;
    const cols = 64;
    const colW = sw / cols;
    for (let i = 0; i < cols; i++) {
      const t0 = i / cols, t1 = (i + 1) / cols;
      // Log mapping: emphasise lower frequencies.
      const f0 = Math.floor(Math.pow(t0, 2.2) * bins);
      const f1 = Math.max(f0 + 1, Math.floor(Math.pow(t1, 2.2) * bins));
      let sum = 0;
      for (let k = f0; k < f1; k++) sum += specData[k];
      const v = (sum / (f1 - f0)) / 255;
      const barH = v * sh * 0.95;
      // Gradient by height — green low, amber mid, magenta peaks.
      const g = xctx.createLinearGradient(0, sh, 0, sh - barH);
      g.addColorStop(0,    "#3a4a3a");
      g.addColorStop(0.55, "#7fff8c");
      g.addColorStop(0.85, "#ffb547");
      g.addColorStop(1,    "#ff3d8b");
      xctx.fillStyle = g;
      xctx.fillRect(i * colW + 1, sh - barH, colW - 2, barH);
    }
  }
  drawFrame();

  /* ---------- 14. RECORDER ---------- */

  let mediaRecorder = null;
  let chunks = [];
  let isRecording = false;

  recordBtn.addEventListener("click", async () => {
    if (!audioReady) {
      await audioCtx.resume();
      audioReady = true;
      startBtn.classList.add("is-on");
      startBtn.querySelector(".btn-label").textContent = "ONLINE";
    }
    if (!isRecording) {
      chunks = [];
      mediaRecorder = new MediaRecorder(recorderTap.stream);
      mediaRecorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      mediaRecorder.onstop = () => {
        const blob = new Blob(chunks, { type: "audio/webm" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `tonus-${Date.now()}.webm`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
      };
      mediaRecorder.start();
      isRecording = true;
      recordBtn.classList.add("is-rec");
      recordBtn.querySelector(".btn-label").textContent = "STOP · SAVE";
    } else {
      mediaRecorder.stop();
      isRecording = false;
      recordBtn.classList.remove("is-rec");
      recordBtn.querySelector(".btn-label").textContent = "RECORD";
    }
  });

  /* ---------- 15. SERIAL NUMBER (cosmetic) ---------- */

  $("serial").textContent =
    Math.floor(Math.random() * 9000 + 1000) + "·" +
    Math.floor(Math.random() * 9000 + 1000);
});
