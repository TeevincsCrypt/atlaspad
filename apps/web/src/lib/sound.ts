"use client";
import { useUi } from "./store";

/**
 * Optional, synthesized sound cues (no audio files, no autoplay). Muted by default; only plays after the user
 * turns sound on, which also satisfies browser autoplay policies.
 */
export type SoundCue = "founded" | "achievement" | "war" | "boom" | "crisis" | "goldenAge" | "click" | "confirm" | "error";

let ctx: AudioContext | null = null;
function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function tone(a: AudioContext, freq: number, start: number, dur: number, type: OscillatorType = "sine", gain = 0.08, glideTo?: number) {
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, a.currentTime + start);
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, a.currentTime + start + dur);
  g.gain.setValueAtTime(0.0001, a.currentTime + start);
  g.gain.exponentialRampToValueAtTime(gain, a.currentTime + start + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + start + dur);
  osc.connect(g).connect(a.destination);
  osc.start(a.currentTime + start);
  osc.stop(a.currentTime + start + dur + 0.05);
}

function noise(a: AudioContext, start: number, dur: number, gain = 0.05, lowpass = 400) {
  const buffer = a.createBuffer(1, a.sampleRate * dur, a.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = a.createBufferSource();
  src.buffer = buffer;
  const f = a.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.value = lowpass;
  const g = a.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(a.destination);
  src.start(a.currentTime + start);
}

export function playSound(cue: SoundCue) {
  if (!useUi.getState().soundOn) return;
  const a = audio();
  if (!a) return;
  switch (cue) {
    case "click":
      tone(a, 880, 0, 0.06, "triangle", 0.03);
      break;
    case "confirm":
      tone(a, 660, 0, 0.12, "sine", 0.06);
      tone(a, 990, 0.1, 0.2, "sine", 0.06);
      break;
    case "error":
      tone(a, 220, 0, 0.25, "sawtooth", 0.03, 140);
      break;
    case "achievement":
      [523, 659, 784, 1047].forEach((f, i) => tone(a, f, i * 0.09, 0.35, "triangle", 0.05));
      break;
    case "founded":
      [262, 392, 523, 784].forEach((f, i) => tone(a, f, i * 0.16, 0.9, "sine", 0.06));
      noise(a, 0, 0.6, 0.02, 900);
      break;
    case "war":
      noise(a, 0, 0.5, 0.12, 180);
      tone(a, 98, 0, 0.6, "sawtooth", 0.05, 65);
      noise(a, 0.45, 0.4, 0.1, 160);
      break;
    case "boom":
      [440, 554, 659, 880].forEach((f, i) => tone(a, f, i * 0.07, 0.25, "triangle", 0.04));
      break;
    case "crisis":
      tone(a, 330, 0, 0.9, "sawtooth", 0.035, 110);
      noise(a, 0.1, 1.2, 0.04, 300);
      break;
    case "goldenAge":
      [523, 659, 784, 1047, 1319].forEach((f, i) => tone(a, f, i * 0.12, 1.2, "sine", 0.05));
      [1568, 2093].forEach((f, i) => tone(a, f, 0.6 + i * 0.15, 0.8, "triangle", 0.025));
      break;
  }
}
