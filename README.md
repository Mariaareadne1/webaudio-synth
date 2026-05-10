# PROBE

**A hybrid web audio synthesizer with a built-in harmony engine.** Four synthesis methods crossfaded in real time, plus a Nopia-inspired chord generator that turns the lower octave into a tonal-harmony machine. Built with the Web Audio API. Zero dependencies, no samples, no build step.

> Plays in any modern browser. Click **engage**, then type or click the keys.

---

## What's in it

### Two layers, one keyboard

**The synth layer** — four engines run simultaneously per voice. A normalised mixer crossfades between them so total amplitude can never exceed full scale, no matter where the faders sit.

| Engine | What it does |
|---|---|
| **Subtractive** | One oscillator (sine, triangle, saw, square) through a resonant low-pass filter. The classic. |
| **Additive** | 1–10 sine partials at integer multiples of the fundamental, with a user-controlled geometric falloff. Stack the harmonic series. |
| **Amplitude Mod** | A sub-audio or audio-rate modulator multiplies the carrier amplitude. At full depth it becomes ring modulation. |
| **Frequency Mod** | A modulator drives the carrier frequency. User-controlled ratio and modulation index — classic 2-op FM territory. |

**The harmony layer** — inspired by the [Nopia](https://nopia.io/) MIDI controller. Pick a key from the 12-button tonal selector, flip **chord mode** on, and every key in the lower octave plays a full chord built on a degree of the chosen scale. The synth layer just keeps doing its job — it doesn't know the difference between a single note and four.

| Control | What it does |
|---|---|
| **Tonal selector** | 12 chromatic buttons set the root key (C, C♯, D, …) |
| **Chord mode** | Lower octave plays chords; upper octave stays mono (so you can play melody over chords) |
| **Complexity** | triad → 7th → 9th — adds extensions on the fly |
| **Bass** | Adds the chord root an octave below |
| **Arpeggiator** | Cycles through chord notes instead of striking them simultaneously |

When you hold a chord, the keyboard **visualises the chord shape** — the pressed key glows magenta, every other note in the chord glows phosphor green. You see the harmony, not just hear it.

### Everything else

- **ADSR amplitude envelope** per voice (exponential ramps, no clicks)
- **Per-note filter envelope** — every key press snaps the cutoff open and lets it settle, giving the whole synth a Daft Punk–ish pluck character (the arpeggiator leans into this)
- **Resonant low-pass master filter** with a global **LFO** modulating its cutoff
- **Polyphonic** with automatic per-voice gain redistribution — held chords don't clip
- **Five presets**: daft bass · glass bell · disco pad · robot lead · pluck
- **Live oscilloscope** with one trace per active voice and a **post-master spectrum analyzer**
- **Record-to-file** — captures whatever you hear and saves a `.webm` audio clip
- **On-screen keyboard** plus 24-key computer-keyboard mapping (2 octaves)

---

## How it sounds

Some starting points if you're unsure where to begin:

- **Glass bell** preset, **chord mode on**, **complexity = 7th**, **arpeggiator on**. Hold the Z key. You're hearing a Cmaj7 arpeggio with FM bell partials and a self-modulating filter — one finger, full song.
- **Disco pad** preset, chord mode, **bass on**. Walk Z → V → N → C (I → IV → vi → iii). Classic four-chord progression with a sub octave underneath.
- **Daft bass** preset, **chord mode off**. Play in the lower octave, drop the **filter cutoff** to ~400 Hz, and crank **resonance**. Self-oscillating squelchy bass.
- Hold a single note. Move **mixer additive** and **mixer FM** faders inversely. You're hearing two completely different synthesis methods crossfade in real time on the same pitch.
- Switch tonal root to G, chord mode on. The same keys you used in C major now play in G — diatonic chord generation in any key.

---

## Signal flow

```
                  ┌──── additive  ─────┐
                  │                    │
key press ─▶ ┼────┼──── AM        ─────┼──▶ mix gains ──▶ envGain ──▶ voiceLevel ──▶┐
                  │                    │   (normalised)   (ADSR)    (poly-scaled)  │
                  ├──── FM        ─────┤                                            │
                  │                    │                                            │
                  └──── subtractive ───┘                                            │
                                                                                    ▼
            LFO ──▶ filter.frequency ───┐                                  globalGain
                                        │                                           │
                                        ▼                                           ▼
                              masterFilter (LPF + Q) ◀────────────────────── (sum of voices)
                                        │
                                        ├──▶ analyserBus ──▶ destination (speakers)
                                        │
                                        └──▶ MediaStreamDestination (recorder)
```

**Key design choices:**

1. **All four engines are always built** per voice, regardless of mix setting. This lets the mixer crossfade smoothly from zero — no clicks when a slider crosses 0.001.
2. **Polyphony is decoupled from envelopes.** Each voice has two stacked gains: `envGain` runs the ADSR on a normalised 0→1 scale; `voiceLevel` is what gets redistributed when a new note is played. This means held notes don't get their envelopes interrupted when you press another key.
3. **The mix is normalised** — the three engine gains plus a subtractive fallback always sum to 1. There's no way for the user to clip the synth by maxing all faders, which is the right behaviour for a teaching instrument.

---

## Try it

**Live demo:** [[your-username.github.io/probe-synth](https://your-username.github.io/probe-synth) <!-- replace with your real link -->](https://mariaareadne1.github.io/webaudio-synth/)

**Run locally:**

```bash
git clone https://github.com/your-username/probe-synth.git
cd probe-synth
# Any static server will do:
python3 -m http.server 8000
# or: npx serve .
```

Then visit `http://localhost:8000`. There is no build step.

> Browsers require a user gesture before audio can play. Click **engage** before pressing keys.

---

## Controls reference

### Computer keyboard

```
Lower octave:   Z  S  X  D  C  V  G  B  H  N  J  M
                C  C♯ D  D♯ E  F  F♯ G  G♯ A  A♯ B

Upper octave:   Q  2  W  3  E  R  5  T  6  Y  7  U
                C  C♯ D  D♯ E  F  F♯ G  G♯ A  A♯ B
```

### Modulation parameters

| Section | Param | Range | Notes |
|---|---|---|---|
| **Mixer** | additive · AM · FM | 0–1 each | Normalised; the three sum to ≤1 |
| **Additive** | count | 1–10 | Number of partials |
| | falloff | 0.1–1.0 | Geometric amplitude decay per partial |
| **AM** | rate | 0.1–80 Hz | Sub-audio is tremolo; audio-rate is ring-mod |
| | depth | 0–1 | At 1.0, becomes true ring modulation |
| **FM** | ratio | 0.25–8 | Modulator freq = carrier × ratio |
| | index | 0–1500 | Modulation depth in Hz — controls brightness |
| **Envelope** | A · D · R | 1 ms – 4 s | Exponential ramps |
| | S | 0–1 | Sustain level |
| **LFO** | rate | 0.1–20 Hz | Sine wave on filter cutoff |
| | depth | 0–3000 | Modulation amount in Hz |
| **Filter** | cutoff | 80–12000 Hz | Master low-pass corner |
| | resonance (Q) | 0.1–18 | High Q can self-oscillate |
| **Master** | volume | 0–1 | Output level |
| **Harmony** | key | C–B | Root of the scale; all 12 chromatic options |
| | chord mode | on/off | Lower octave plays chords vs single notes |
| | complexity | triad/7th/9th | How tall the chords stack |
| | bass | on/off | Adds chord root one octave down |
| | arpeggiator | on/off | Cycles chord notes instead of striking together |
| | arp rate | 1–20 Hz | Notes per second when arpeggiator is on |

### Chord recipes

Each key in the lower octave triggers a chord built on that scale degree:

| Key | Degree | In C major | What it is |
|---|---|---|---|
| Z | I | C major | tonic |
| X | ii | D minor | supertonic |
| C | iii | E minor | mediant |
| V | IV | F major | subdominant |
| B | V | G major | dominant (7th adds the F) |
| N | vi | A minor | relative minor |
| M | vii° | B diminished | leading-tone |
| S, D, G, H, J | non-diatonic | borrowed chords | ♭II, ♭III, V/V, ♭VI, ♭VII |

The black-key chords are modal-interchange / secondary-dominant colors — ♭VI–♭VII–I is a textbook rock cadence; V/V tonicises the dominant. These are exactly the chords pop and rock songs lean on when they want to step outside the strict diatonic seven.

---

## What I learned

This was built for COMS 3430 (Computational Sound) at Barnard / Columbia, where it began as two small labs — a single-oscillator keyboard, then a synth with three synthesis methods. The interesting work was everything that lives between those two assignments:

- **Polyphony without clicks.** A naïve `osc.stop()` on key-up produces zero-crossing clicks that sound like static. The fix is a per-voice gain node that exponentially ramps to a near-zero floor (`exponentialRampToValueAtTime(0.0001, ...)`) before the oscillator is stopped — and crucially, *never* ramp to 0 with the exponential ramp because the math diverges.
- **Clip-safe polyphonic gain.** Two voices at full amplitude sum to amplitude 2.0 and the result is digital distortion. Redistributing `MAX_POLY_GAIN / N` across all active voices keeps the master bus at unity regardless of how many keys are held — but you have to ramp the redistribution (`setTargetAtTime`) rather than snap it, or you introduce zipper noise.
- **Live parameter binding.** Sliders should affect notes that are currently held, not just notes played afterwards. Every engine builder attaches `input` listeners to the parameters it cares about and removes them on note-off, so there's no leak of stale listeners.
- **Audio-rate AM vs ring mod.** They're the same operation at different depths — `gain = (1 − depth) + depth × mod`. At depth 0.5 you get classic AM (gain stays positive); at depth 1.0 the gain can swing negative, which inverts the carrier and produces sidebands at `carrier ± modulator` — that's ring modulation.
- **FM index, not amplitude.** In FM synthesis you don't scale the modulator's loudness, you scale how far it deviates the carrier's frequency. That's why the FM section has an "index" slider measured in Hz, not a "depth" slider in dB.
- **Separating harmony from synthesis.** The Nopia-inspired chord layer doesn't touch the audio engine at all. A keypress in chord mode just calls `startVoice(freq)` once per chord note; the synth doesn't know whether it's playing one note or four. This kind of layered decomposition — *harmony decides what notes, synth decides what they sound like* — is how real instruments are designed too. Keeps each layer small and replaceable.

---

## Architecture notes

The whole thing lives in three files — `index.html`, `style.css`, `script.js` — about 1700 lines total. No bundler, no framework, no transpiler. The audio code is one IIFE inside a `DOMContentLoaded` handler so all state is private; nothing leaks onto `window`.

The signal graph is built per-note rather than reused — every key press creates fresh `OscillatorNode`s and `GainNode`s, scheduled to start immediately and stop after release. This is the Web Audio idiom (oscillators are single-use by design) and it's cheap: the Web Audio implementation lives in C++ and these nodes are essentially zero-cost to allocate.

---

## File layout

```
.
├── index.html      — markup for header, panels, keyboard, visualizers
├── style.css       — phosphor-green-on-near-black instrument aesthetic
├── script.js       — audio engine, voice builders, UI bindings, visualizers
└── README.md       — this file
```

---

## License

MIT. Take it apart, build something better.

---

*Built with the Web Audio API · no samples, no dependencies, no build step.*
