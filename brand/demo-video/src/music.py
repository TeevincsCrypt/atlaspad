"""Original background music for the AtlasPad demo, synthesised with numpy (no samples).
Hits land on the intro and outro, whooshes on each section change. The voice-over is mixed in later (ducked).
  python music.py <timeline.json> <out.wav>"""
import json, sys, wave
import numpy as np

tl = json.load(open(sys.argv[1]))
SR = 48000
DUR = tl[-1]["start"] + tl[-1]["dur"] + 0.5
N = int(DUR * SR)
L = np.zeros(N); R = np.zeros(N)
rng = np.random.default_rng(3)
BPM = 112; BEAT = 60 / BPM
note = lambda m: 440 * 2 ** ((m - 69) / 12)

def add(sig, at, pan=0.0, gain=1.0):
    i = int(at * SR); n = min(len(sig), N - i)
    if n <= 0 or i < 0: return
    L[i:i + n] += sig[:n] * gain * np.sqrt(1 - pan)
    R[i:i + n] += sig[:n] * gain * np.sqrt(1 + pan)

def lowpass(x, a):
    y = np.empty_like(x); acc = 0.0
    for i in range(len(x)):
        acc += a * (x[i] - acc); y[i] = acc
    return y

def env(n, a, r):
    e = np.ones(n); ai, ri = int(a * SR), int(r * SR)
    if ai: e[:ai] = np.linspace(0, 1, ai)
    if ri: e[-ri:] *= np.linspace(1, 0, ri) ** 2
    return e

def pad(ms, dur, gain, bright=0.3):
    n = int(dur * SR); t = np.arange(n) / SR; s = np.zeros(n)
    for m in ms:
        f = note(m)
        for d in (-0.12, 0, 0.12):
            ph = rng.random() * 6.28
            s += np.sin(2 * np.pi * f * (1 + d / 100) * t + ph) + bright * np.sin(4 * np.pi * f * (1 + d / 100) * t + ph)
    s *= 0.85 + 0.15 * np.sin(2 * np.pi * 0.25 * t)
    return s / (len(ms) * 3) * env(n, min(0.6, dur / 3), min(0.8, dur / 3)) * gain

def kick():
    n = int(0.32 * SR); t = np.arange(n) / SR
    return np.sin(2 * np.pi * np.cumsum(46 + 90 * np.exp(-t * 30)) / SR) * np.exp(-t * 10)
def hat(dec=80):
    n = int(0.06 * SR); t = np.arange(n) / SR; s = rng.standard_normal(n); s = s - lowpass(s, 0.3)
    return s * np.exp(-t * dec)
def snap():
    n = int(0.2 * SR); t = np.arange(n) / SR; s = rng.standard_normal(n); s = s - lowpass(s, 0.08)
    return s * np.exp(-t * 32)
def pluck(f, dur=0.4, dec=8):
    n = int(dur * SR); t = np.arange(n) / SR
    return (np.sin(2 * np.pi * f * t) + 0.45 * np.sin(4 * np.pi * f * t) + 0.2 * np.sin(6 * np.pi * f * t)) * np.exp(-t * dec)
def bass(f, dur):
    n = int(dur * SR); t = np.arange(n) / SR
    s = np.sign(np.sin(2 * np.pi * f * t)) * 0.4 + np.sin(2 * np.pi * f * t)
    return lowpass(s, 0.05) * env(n, 0.005, 0.06)
def impact(g=1.0):
    n = int(2.6 * SR); t = np.arange(n) / SR
    s = np.sin(2 * np.pi * np.cumsum(30 + 80 * np.exp(-t * 10)) / SR) * np.exp(-t * 1.7)
    no = lowpass(rng.standard_normal(n), 0.1) * np.exp(-t * 6)
    return np.tanh(1.7 * (s + 0.8 * no)) * g
def whoosh(d=0.7):
    n = int(d * SR); x = np.arange(n) / n
    return lowpass(rng.standard_normal(n), 0.12) * np.sin(np.pi * x) ** 2 * 1.6
def riser(d):
    n = int(d * SR); t = np.arange(n) / SR; x = t / d
    no = rng.standard_normal(n); no = no - lowpass(no, 0.05)
    return (0.3 * no + 0.3 * np.sin(2 * np.pi * np.cumsum(220 + 1300 * x ** 2) / SR)) * x ** 2.4

PROG = [[57, 60, 64, 69], [53, 57, 60, 65], [48, 52, 55, 60], [55, 59, 62, 67]]  # Am F C G
intro = tl[0]; outro = tl[-1]
body_start = intro["start"] + intro["dur"] - BEAT * 2   # groove starts just before the first feature
body_end = outro["start"]

# Intro: hit + shimmer on the logo, low pad.
add(impact(1.0), 0.05)
for j, m in enumerate([81, 84, 88, 93]): add(pluck(note(m), 1.6, 3.2), 0.1 + j * 0.09, pan=-0.4 + 0.27 * j, gain=0.22)
add(pad([45, 52, 57, 64], intro["dur"] + 0.6, 0.5, 0.15), 0.0)

# Body: 2-bar chords, kick on 1 & 3, hats on off-beats, snap on 2 & 4, bass, a light arp.
t = body_start; k = 0
while t < body_end - 0.01:
    bar = 4 * BEAT
    d = min(bar * 2 + 0.25, body_end - t + 0.3)
    ch = PROG[k % 4]
    add(pad(ch, d, 0.30, 0.25), t, pan=0.12 if k % 2 else -0.12)
    for b in range(8):
        bt = t + b * BEAT
        if bt >= body_end: break
        if b % 2 == 0: add(kick(), bt, gain=0.42)
        else: add(snap(), bt, pan=-0.1, gain=0.12)
        add(hat(), bt + BEAT / 2, pan=0.3, gain=0.07)
        add(bass(note(ch[0] - 12), BEAT * 0.85), bt, gain=0.20)
        if b % 2 == 1:
            add(pluck(note(ch[(b // 2) % 4] + 12), 0.35, 9), bt + BEAT / 2, pan=0.35 * (1 if b % 4 == 1 else -1), gain=0.08)
    t += bar * 2; k += 1

# Section changes: whoosh + a small chime on each new feature.
for i, s in enumerate(tl[1:-1], start=1):
    add(whoosh(), s["start"] - 0.45, pan=0.5 if i % 2 else -0.5, gain=0.32)
    add(pluck(note(88 + (i % 3) * 2), 0.9, 5), s["start"] + 0.05, pan=0.2, gain=0.12)

# Outro: riser into the final hit, warm chord to the end.
add(riser(2.0), body_end - 2.0, gain=0.4)
add(impact(1.0), body_end)
for j, m in enumerate([81, 84, 88, 93, 96]): add(pluck(note(m), 2.0, 2.2), body_end + 0.05 + j * 0.08, pan=-0.4 + 0.2 * j, gain=0.18)
add(pad([57, 60, 64, 69, 76], outro["dur"] + 0.5, 0.55, 0.4), body_end)
add(pad([45, 57], outro["dur"] + 0.5, 0.45), body_end)

mix = np.stack([L, R], axis=1)
fade = np.ones(N); fs = int((DUR - 1.4) * SR); fade[fs:] = np.linspace(1, 0, N - fs) ** 1.5
mix *= fade[:, None]
mix /= np.max(np.abs(mix)) + 1e-9
mix = np.tanh(mix * 1.3) / np.tanh(1.3) * 0.9
with wave.open(sys.argv[2], "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes((mix * 32767).astype(np.int16).tobytes())
print("music", round(DUR, 2), "s")
