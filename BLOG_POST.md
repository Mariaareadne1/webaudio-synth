---
title: "From the Chaconne to Web Audio: building a synth that does its own music theory"
date: 2026-05-10
tags: [music, code, synthesis, web-audio, music-theory]
---

# From the Chaconne to Web Audio

> A synth keyboard where one finger plays a chord, four engines run in parallel, and a single key press can be either a single note or an arpeggiated 9th chord, depending on a toggle. I built it in a browser. This is the story of what I learned doing it.

**Live demo →** [mariaareadne1.github.io/webaudio-synth](https://mariaareadne1.github.io/webaudio-synth/)
**Code →** [github.com/Mariaareadne1/webaudio-synth](https://github.com/Mariaareadne1/webaudio-synth)

---

## Where this started

I played classical violin for ten years before I ever wrote a line of code that made a sound. I knew, intellectually, that music was math — you can't sit through enough theory classes without hearing it — but I knew it the way you "know" that water is H₂O. It was a fact about reality, not something I felt.

What changed was Bach. I spent a year picking through the **Chaconne from the D minor Partita** — one of those pieces every violinist eventually circles, the same way every pianist eventually circles the Goldbergs. It's twenty minutes of solo violin built on a four-bar harmonic skeleton, repeated and varied sixty-four times. There are passages where Bach is implying **four voices on one instrument**: a bass line, an inner voice, a melody, sometimes a fourth that ghosts in and out. He does it by stacking double-stops, by arpeggiating across all four strings so fast that your ear stitches the notes back together into chords, by *implying* harmonies the violin can't actually play in full.

The math I didn't feel in theory class, I started feeling in the Chaconne. You can hear the structure. Four voices fold out of one instrument like origami.

When I got to Computational Sound at Barnard this semester, the first two assignments were:

1. Build a keyboard in the browser that plays one note at a time.
2. Make that keyboard sound better — additive, AM, and FM synthesis.

I built them. They were fine. And then I kept going for about two more weeks, because I realized I could build something that did the same trick Bach was doing — unfolding chords from a single touch — but in code, in a browser, with no instrument required.

That project is called **TONUS**. This post is the long version of what I learned building it. Honest mix: some struggle, some wins.

---

## The first thing that broke: clicks

Lab 1 was supposed to be straightforward. Press a key, an oscillator starts. Release the key, it stops. The Web Audio API gives you `OscillatorNode` and `GainNode`, you wire them up, you call `start()` and `stop()`.

It made a sound. The sound was **bad**.

Every time I let go of a key, there was a sharp click. Not "the note ended" — an audible *pop*, like a record needle dropping. I figured I'd done something wrong. I hadn't. The problem is that an oscillator outputting a sine wave at, say, 440 Hz, is sitting somewhere along that wave at any given moment. When you stop it instantaneously, you're slamming the signal from wherever it was straight to zero. That vertical discontinuity is, mathematically, a step function — and step functions, when you Fourier-decompose them, contain energy at *every* frequency. Your ear interprets that as a click.

The fix is to never let the signal hit zero abruptly. Instead, you ramp it down over a few milliseconds:

```js
gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.15);
osc.stop(now + 0.15);
```

That's an **exponential ramp from the current gain to nearly-zero over 150ms, *then* the oscillator stops**. The ramp moves the signal smoothly to silence, so the discontinuity is gone, so the click is gone.

One gotcha: you cannot use `exponentialRampToValueAtTime` to ramp *to* zero, because exponential decay never reaches zero — mathematically, the function diverges. The Web Audio API will throw an error. You have to ramp to a tiny non-zero value like `0.0001` and call it close enough.

This sounds like a tiny detail. It taught me something I keep coming back to: **audio is not just data, it's data that has to be continuous**. The moment you let a discontinuity slip in, your ear catches it. Bach's bow doesn't slam off the string at the end of a phrase. Neither should code.

---

## ADSR: the shape of a single note

If you've ever played a piano, you know that a note doesn't just "happen." There's a moment of attack when the hammer hits the string, then the sound rings, then it decays. If you let go of the key, the damper falls and the sound dies fast. If you hold it, it dies slow.

Synthesizers model this with what's called an **ADSR envelope**: Attack, Decay, Sustain, Release. Four numbers that describe the shape of one note's loudness over time.

- **Attack** is how long it takes to get from silence to full volume.
- **Decay** is how long it takes to fall from peak to the sustain level.
- **Sustain** is the level the note holds at while you're still pressing the key.
- **Release** is how long it takes to fade to silence after you let go.

A **piano** has fast attack, fast decay, low sustain, medium release. A **string pad** has slow attack, slow decay, high sustain, slow release — the sound swells in and swells out. A **plucked synth** has near-instant attack and zero sustain — the note rings briefly and dies.

In Web Audio, you implement ADSR by scheduling automation events on a gain node:

```js
gainNode.gain.setValueAtTime(0.0001, now);
gainNode.gain.exponentialRampToValueAtTime(1.0, now + A);          // attack
gainNode.gain.exponentialRampToValueAtTime(S,   now + A + D);      // decay → sustain
// (when key released) →
gainNode.gain.exponentialRampToValueAtTime(0.0001, now + R);       // release
```

What I didn't expect: ADSR is *also* what makes the same set of partials sound like completely different instruments. The same C-E-G triad with a slow-attack envelope is a string section. With a fast-attack zero-sustain envelope, it's a glockenspiel. The timbre is the same. The shape is everything.

This was my first oh-that's-how-it-works moment.

---

## AM and FM: the two ways to twist a wave

Lab 2 asked for three synthesis methods. Additive synthesis is the easy one — stack sine waves at integer multiples of a fundamental frequency, and you build up the harmonic series. That's literally what a vibrating string does, decomposed. So a triangle wave is a sum of odd harmonics with rapidly decreasing amplitudes. A square wave is the same but flatter. A saw wave includes both odd and even harmonics. The math is Fourier's, from 1822.

AM and FM are the strange ones.

**Amplitude modulation** is when one oscillator multiplies another's volume. You have a *carrier* (the note you're playing, say 440 Hz) and a *modulator* (some other oscillator, say 6 Hz). You multiply them. What comes out depends entirely on the modulator's rate.

- **Slow modulator (below ~20 Hz)**: your ear can track the volume going up and down. It sounds like **tremolo** — that classic surf-guitar shimmer.
- **Fast modulator (in the audio range)**: your ear can no longer track the individual volume swings. They fuse into a new timbre. You hear sidebands at `carrier + modulator` and `carrier − modulator`, mathematically. This is **ring modulation**, and it's how you get those metallic, bell-like, sometimes alien sounds. The Daleks in Doctor Who are ring-modulated voices.

The same operation. The only thing that changed is the modulator's rate. The boundary between "rhythm" and "timbre" turns out to be about 20 Hz — wherever your ear stops parsing individual events and starts hearing a continuous tone.

**Frequency modulation** is different and weirder. Instead of modulating volume, you modulate the carrier's *pitch*. Not its average pitch — its instantaneous pitch, oscillating up and down many times per second.

```js
// modulator's output is added to the carrier's frequency
modulator.connect(modGain);   // modGain controls the amount
modGain.connect(carrier.frequency);
```

When the modulator is slow, you get **vibrato** — the carrier's pitch wobbles audibly. When the modulator is in the audio range, you get sidebands again, but now they multiply. Two oscillators produce dozens of new frequencies. This is the math that gave us the DX7 in 1983 — every digital "electric piano" you've ever heard, every "bell" patch, every clean glassy sound. John Chowning published the FM synthesis paper in 1973. He says the bell sounds were an accident; he was trying to make a vibrato effect, set the modulator's rate too high, and discovered the timbres by mistake.

There's a parameter called the **modulation index** which controls how far the carrier deviates. Low index = clean carrier, almost no change. High index = an explosion of partials. The single most important thing I learned building the FM engine is that **the index slider sweeps you continuously between "a sine wave" and "a bell" and "a screaming digital mess."** You hear a whole spectrum of instruments by moving one knob.

I sat at my laptop for an embarrassingly long time just moving that slider.

---

## Polyphony: the problem with two notes

The labs only really required one note at a time. I added polyphony because, well, music has chords.

Two oscillators at amplitude 1.0 sum to amplitude 2.0. The maximum the audio output can represent is 1.0. Anything above clips — gets cut off at 1.0 — and clipping is the worst-sounding thing your speakers can do. It's harsh, digital, headache-inducing.

The naive fix is to multiply everything by 0.5. But then a single note is half as loud as it should be. The correct fix is to **redistribute the gain dynamically**. If one voice is sounding, it gets full level. If four are sounding, each one gets a quarter. The total never exceeds the ceiling.

```js
function redistributeVoiceLevels() {
  const n = Object.keys(activeVoices).length;
  if (n === 0) return;
  const perVoice = MAX_POLY_GAIN / n;
  Object.values(activeVoices).forEach(v => {
    v.voiceLevel.gain.setTargetAtTime(perVoice, audioCtx.currentTime, 0.03);
  });
}
```

You call this every time a note starts or ends. The `setTargetAtTime` ramp is critical — if you snap the gains instantly, you get a different click. Smooth automation, always.

This is real engineering, not music theory. But it's the kind of detail that separates a synth that sounds like a toy from one that sounds like an instrument. **Every shortcut you take, your ear notices.**

---

## Then I saw the Nopia

In the middle of all this, a video kept showing up in my feeds. Two Argentinian designers had built a hardware controller called **Nopia** — a pastel-colored box with a one-octave keyboard where each key plays not a single note but a *chord*. You pick a key signature, you press a key, and it plays the diatonic chord built on that scale degree. The C key plays C major. The D key plays D minor. The G key plays G major. The B key plays B diminished. All within whatever key you've selected.

This is just music theory in hardware form. In a major scale, the chords built on each degree are predetermined: **I ii iii IV V vi vii°**. Roman numerals, capital for major, lowercase for minor, `°` for diminished. Anyone who's taken a theory class has stared at this chart. What Nopia did was turn it into a physical instrument.

I watched the demo video and immediately knew I had to do that for my synth. Not because it was needed — the synth worked fine without it — but because **it was the same trick Bach was doing**. One physical input, multi-voice harmonic output. The performer plays a single key; the listener hears a chord.

The implementation turned out to be remarkably clean, because the harmony layer doesn't have to *do* anything to the audio engine. It just decides which frequencies to fire:

```js
function playKey(keyCode) {
  if (chordModeOn) {
    const chord = chordSemitones(degree, root, complexity);
    chord.notes.forEach((semi, i) => {
      startVoice(semitoneToHz(semi), `${keyCode}:${i}`);
    });
  } else {
    startVoice(KEY_FREQ[keyCode], keyCode);
  }
}
```

That's the entire harmony layer at the call site. One key press becomes either one `startVoice` call or four. The synth engine doesn't even know it's playing a chord. Every parameter change — filter, ADSR, FM index — applies automatically because the chord is just notes, and the synth handles notes.

The chord table itself is a 12-entry array, one per chromatic position relative to the chosen root:

```js
const CHORD_TABLE = [
  // I (major triad on root)        ─ Z key in C major plays C-E-G
  { offset: 0,  intervals: [0, 4, 7, 11, 14], label: "I"   },
  // ii (minor)                     ─ X key plays D-F-A
  { offset: 2,  intervals: [0, 3, 7, 10, 14], label: "ii"  },
  // iii (minor)                    ─ C key plays E-G-B
  { offset: 4,  intervals: [0, 3, 7, 10, 14], label: "iii" },
  // IV (major)                     ─ V key plays F-A-C
  { offset: 5,  intervals: [0, 4, 7, 11, 14], label: "IV"  },
  // V (dominant)                   ─ B key plays G-B-D (+F for V7)
  { offset: 7,  intervals: [0, 4, 7, 10, 14], label: "V"   },
  // vi (minor)                     ─ N key plays A-C-E
  { offset: 9,  intervals: [0, 3, 7, 10, 14], label: "vi"  },
  // vii° (diminished)              ─ M key plays B-D-F
  { offset: 11, intervals: [0, 3, 6, 10, 13], label: "vii°"},
  // ...black keys give borrowed chords from parallel minor...
];
```

Those `intervals` are semitones from the chord's root. `[0, 4, 7]` is a major triad: root, major third, perfect fifth. `[0, 3, 7]` is a minor triad: root, minor third, perfect fifth. `[0, 3, 6]` is diminished: root, minor third, *diminished* fifth. The numbers are the same regardless of what key you're in — that's why "transposing" a song is just adding a constant to every note's MIDI number.

I had been told this in theory class. I had memorized it for tests. But I'd never *implemented* it before, and there's a specific kind of understanding that only comes from making the computer do the thing.

The black keys (S, D, G, H, J on the keyboard) handle the chords *outside* the diatonic seven — what theory calls **modal interchange** or **borrowed chords**. ♭VI, ♭VII, V/V, ♭III. These are the colors that pop and rock songs use when they want to step outside strict diatonic harmony. The "♭VI–♭VII–I" cadence at the end of an anthemic rock song? That's three borrowed chords resolving home. Now I had them on five keys.

---

## What the keyboard *shows* you

The thing I'm proudest of is the keyboard visualization. When chord mode is on and you press a key, the keyboard doesn't just light up that one key. It lights up **every key in the resulting chord**.

The pressed key glows magenta (the trigger). The other chord members glow phosphor green (the implied harmony). When you hold the Z key in C major with complexity set to 7th, you see Z (C), C (E), B (G), and M (B) all lit up. You're literally watching the chord shape on the keyboard.

This was the moment my classical-violin brain and my CS brain shook hands.

For years I'd been *reading* chords on a page — three notes stacked vertically on a staff. I'd been *hearing* chords played on piano. I'd been *implying* chords on violin through double-stops and fast arpeggiation. But I'd never had a keyboard that visually showed me *which keys correspond to which chord*. The TONUS keyboard now does that, dynamically, every time I press a key, in any of the twelve possible roots.

I've spent more time than I'd like to admit just pressing keys in different roots, watching the chord shapes light up, and seeing how they translate across keys. **The shape of a major triad on a keyboard is geometrically the same in every key, just shifted.** C major (white-white-white) and D♭ major (white-black-white) feel different under the fingers but they're the same shape — root, +4 semitones, +7 semitones. The keyboard finally taught me that visually.

---

## The cheap trick that makes everything sound expensive

There's one detail in the synth I want to flag because it was a single line of code that disproportionately changed how things sound.

Every time you press a key, I fire a **per-note filter envelope** on the master low-pass filter. The cutoff snaps up to a high value, then ramps back down over about 200ms.

```js
function applyFilterPluck(now) {
  const base = Number(ui.filterCutoff.value);
  const peak = Math.min(20000, base + 4500);
  masterFilter.frequency.cancelScheduledValues(now);
  masterFilter.frequency.setValueAtTime(base, now);
  masterFilter.frequency.linearRampToValueAtTime(peak, now + 0.005);
  masterFilter.frequency.linearRampToValueAtTime(base, now + 0.205);
}
```

What this does: every note starts *bright* (lots of high frequencies passing through) and rapidly gets *darker*. This is what a plucked string actually does in real life — the initial transient has a ton of high-frequency content from the attack, then those high frequencies decay faster than the fundamental. A real piano does this. A real harpsichord does this. A real Moog with the filter envelope routed to cutoff does this.

It's also what Daft Punk does to make those bass lines that punch you in the chest. The filter pluck is one of the most identifiable sounds of the last forty years of electronic music, and it's twelve lines of code.

When I turned the arpeggiator on for the first time, each rapid note got its own filter pluck. The result was an instant techno bass line. I hadn't written anything that knew what techno was. I'd just written a filter envelope and an arpeggiator, and they discovered the genre on their own.

---

## What I keep coming back to

The thing I didn't expect, going in, is how much of music production is **engineering ergonomics** rather than musical decisions. The actual synthesis math is well-understood — Chowning published FM in 1973, additive goes back to Helmholtz in the 19th century, AM/ring mod is centuries-old in concept. The math is solved.

What's *not* solved, ever, is the interface between human and instrument. How do you build something that lets a person who knows nothing about modulation indices make a satisfying sound? How do you build something that lets a person who's spent ten years learning to read four-voice chorales feel at home? Nopia's answer is: you encode the music theory into the hardware. TONUS's answer is the same, just in a browser, with the synthesis engine layered underneath.

I'm a violinist who learned to code. The Chaconne taught me that one instrument can imply four voices. Computational Sound taught me that a `GainNode` and an `OscillatorNode` can do the same thing. They were the same lesson, ten years apart, in different vocabularies.

It turns out the math really was there the whole time. I just needed to build something to feel it.

---

## Try it

The synth is live at **[mariaareadne1.github.io/webaudio-synth](https://mariaareadne1.github.io/webaudio-synth/)** — zero install, plays in any browser. Click *engage*, then start pressing keys. If you want the full experience: turn chord mode on, set complexity to 7th, turn the arpeggiator on, and hold Z. That's a Cmaj7 arpeggio with FM bell partials and an auto-plucked filter. One finger, full song.

Source is on [GitHub](https://github.com/Mariaareadne1/webaudio-synth). Headphones recommended.

---

*If you build something musical in the browser, or you have a favorite Web Audio trick, I'd love to hear about it.*
