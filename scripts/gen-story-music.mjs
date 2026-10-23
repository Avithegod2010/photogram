// Generates assets/audio/story-ambient.wav — the Photography story background
// loop (v0.48). 100% synthesized here; no third-party samples, no license risk.
// 16 s, mono, 22.05 kHz, 16-bit ≈ 700 KB.
// Rerun with: node scripts/gen-story-music.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const SR = 22050;
const SECONDS = 16;
const N = SR * SECONDS;

// Chord progression (Hz): Am7 → Fmaj7 → Cmaj7 → Gsus4, 4 s each, soft pad.
// Sine partials + slow attack/release envelopes + a gentle rising 3-note bell.
function hz(semi) {
  return 440 * Math.pow(2, semi / 12);
}
// A3=57 semis above C0=0? We just use midi→freq: f = 440*2^((m-69)/12)
function midi(m) {
  return 440 * Math.pow(2, (m - 69) / 12);
}
const CHORDS = [
  [midi(57), midi(64), midi(67), midi(71)], // Am7: A3 E4 G4 B4
  [midi(53), midi(60), midi(64), midi(69)], // Fmaj7: F3 C4 E4 A4
  [midi(48), midi(55), midi(64), midi(71)], // Cmaj7: C3 G3 E4 B4
  [midi(55), midi(62), midi(67), midi(74)], // Gsus4: G3 D4 G4 D5
];
// Bell melody (one note per 4-s bar, sparse): A4, C5, E5, D5
const BELLS = [midi(69), midi(72), midi(76), midi(74)];

const data = new Float64Array(N);
for (let i = 0; i < N; i++) {
  const t = i / SR;
  const bar = Math.min(3, Math.floor(t / 4));
  const chord = CHORDS[bar];
  // Soft attack + release transitions at bar edges (smooth cross into the next
  // chord over the last 1.2 s).
  const local = t - bar * 4;
  const overlap = local > 2.8;
  const nxt = Math.min(3, bar + 1);
  const fade = overlap ? (local - 2.8) / 1.2 : 0;
  // Master shelving envelope: gentle swell overall.
  const master = 0.28 * (0.85 + 0.15 * Math.sin((t / SECONDS) * Math.PI * 2));
  let sample = 0;
  const voices = fade > 0 ? chord.map((f, k) => [f, chord[k], CHORDS[nxt][k]]) : chord.map((f) => [f, f, f]);
  for (const [, f1, f2] of voices) {
    const f = f1 * (1 - fade) + f2 * fade;
    // Two detuned sines + one octave-down support tier.
    sample += Math.sin(2 * Math.PI * f * t) * 0.42;
    sample += Math.sin(2 * Math.PI * f * 1.003 * t) * 0.28;
    sample += Math.sin(2 * Math.PI * (f / 2) * t) * 0.18;
  }
  // Sparse bell with exponential decay within its bar.
  const bellF = BELLS[bar];
  const bellEnv = Math.exp(-local * 1.4) * (local < 0.05 ? local / 0.05 : 1);
  sample += Math.sin(2 * Math.PI * bellF * t) * 0.16 * bellEnv;
  sample += Math.sin(2 * Math.PI * bellF * 2.01 * t) * 0.05 * bellEnv;
  data[i] = sample * master * 0.9;
}

// Normalize to ~-6 dBFS peak, 16-bit.
let peak = 0;
for (const v of data) peak = Math.max(peak, Math.abs(v));
const gain = peekSafe(peak);
function peekSafe(p) {
  return p > 0 ? 0.5 / p : 1;
}

const pcm = Buffer.alloc(N * 2);
for (let i = 0; i < N; i++) {
  const s = Math.round(data[i] * gain * 32767);
  pcm.writeInt16LE(Math.max(-32768, Math.min(32767, s)), i * 2);
}

// WAV header (RIFF/PCM mono).
const header = Buffer.alloc(44);
header.write("RIFF", 0);
header.writeUInt32LE(36 + pcm.length, 4);
header.write("WAVE", 8);
header.write("fmt ", 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20); // PCM
header.writeUInt16LE(1, 22); // mono
header.writeUInt32LE(SR, 24);
header.writeUInt32LE(SR * 2, 28); // byte rate
header.writeUInt16LE(2, 32); // block align
header.writeUInt16LE(16, 34); // bits
header.write("data", 36);
header.writeUInt32LE(pcm.length, 40);

const out = join(process.cwd(), "assets", "audio", "story-ambient.wav");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, Buffer.concat([header, pcm]));
console.log("wrote", out, (44 + pcm.length) / 1024, "KB");
