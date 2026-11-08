"""Original 120 BPM track for the hype demo (numpy, no samples). Chapter hits land exactly on the section starts.
  python music.py <out.wav>"""
import sys, wave
import numpy as np

SR = 48000; DUR = 70.0; N = int(DUR * SR)
L = np.zeros(N); R = np.zeros(N)
rng = np.random.default_rng(12)
BPM = 120; B = 60 / BPM
CHAPTERS = [4.0, 13.0, 23.0, 30.0, 37.0, 42.0, 46.5, 53.0, 57.0]
LOGO_HIT, OUTRO = 2.5, 62.0
note = lambda m: 440 * 2 ** ((m - 69) / 12)

def add(sig, at, pan=0.0, gain=1.0):
    i = int(round(at * SR)); n = min(len(sig), N - i)
    if n <= 0 or i < 0: return
    L[i:i + n] += sig[:n] * gain * np.sqrt(1 - pan); R[i:i + n] += sig[:n] * gain * np.sqrt(1 + pan)

def lp(x, a):
    y = np.empty_like(x); acc = 0.0
    for i in range(len(x)): acc += a * (x[i] - acc); y[i] = acc
    return y

def env(n, a, r):
    e = np.ones(n); ai, ri = int(a * SR), int(r * SR)
    if ai: e[:ai] = np.linspace(0, 1, ai)
    if ri: e[-ri:] *= np.linspace(1, 0, ri) ** 2
    return e

def saw_pad(ms, dur, gain, cut=0.08):
    n = int(dur * SR); t = np.arange(n) / SR; s = np.zeros(n)
    for m in ms:
        for d in (-0.15, 0, 0.15):
            f = note(m) * (1 + d / 100); s += 2 * ((t * f + rng.random()) % 1) - 1
    return lp(s / (len(ms) * 3), cut) * env(n, 0.02, 0.1) * gain

def kick():
    n = int(0.36 * SR); t = np.arange(n) / SR
    return np.tanh(2.2 * np.sin(2 * np.pi * np.cumsum(48 + 130 * np.exp(-t * 38)) / SR) * np.exp(-t * 8))
def clap():
    n = int(0.22 * SR); t = np.arange(n) / SR; s = rng.standard_normal(n); s = s - lp(s, 0.1)
    e = np.exp(-t * 26) + 0.6 * np.exp(-np.maximum(t - 0.011, 0) * 30) * (t > 0.011) + 0.4 * np.exp(-np.maximum(t - 0.022, 0) * 30) * (t > 0.022)
    return s * e * 0.8
def hat(dec=90):
    n = int(0.08 * SR); t = np.arange(n) / SR; s = rng.standard_normal(n); s = s - lp(s, 0.45)
    return s * np.exp(-t * dec)
def bass(m, dur):
    n = int(dur * SR); t = np.arange(n) / SR; f = note(m)
    s = 2 * ((t * f) % 1) - 1 + 0.6 * np.sin(2 * np.pi * f / 2 * t)
    return lp(s, 0.035) * np.exp(-t * 3) * env(n, 0.003, 0.03)
def pluck(m, dur=0.22):
    n = int(dur * SR); t = np.arange(n) / SR; f = note(m)
    return (np.sin(2 * np.pi * f * t) + 0.5 * np.sin(4 * np.pi * f * t) + 0.25 * (2 * ((t * f * 3) % 1) - 1)) * np.exp(-t * 14)
def impact(g=1.0):
    n = int(2.2 * SR); t = np.arange(n) / SR
    s = np.sin(2 * np.pi * np.cumsum(32 + 90 * np.exp(-t * 12)) / SR) * np.exp(-t * 2.2)
    no = lp(rng.standard_normal(n), 0.12) * np.exp(-t * 7)
    return np.tanh(1.8 * (s + no)) * g
def crash():
    n = int(1.8 * SR); t = np.arange(n) / SR; s = rng.standard_normal(n); s = s - lp(s, 0.25)
    return s * np.exp(-t * 2.4) * 0.5
def riser(d):
    n = int(d * SR); t = np.arange(n) / SR; x = t / d
    no = rng.standard_normal(n); no = no - lp(no, 0.03 + 0.3 * 0)
    return (0.35 * no * x + 0.3 * np.sin(2 * np.pi * np.cumsum(300 + 2200 * x ** 2) / SR)) * x ** 2

PROG = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]  # Am F C G
ARP = [0, 2, 1, 2, 0, 2, 1, 2]

# ---------------- intro: tension, then the logo hit
add(riser(2.4), 0.1, gain=0.45)
for i in range(5): add(hat(60), 0.5 + i * B, gain=0.07 * (i + 1) / 5)
add(impact(1.0), LOGO_HIT); add(crash(), LOGO_HIT, gain=0.5)
add(saw_pad([45, 57, 64, 69], 1.6, 0.35, 0.05), LOGO_HIT)
for j, m in enumerate([81, 84, 88, 93]): add(pluck(m, 1.2), LOGO_HIT + 0.04 + j * 0.08, pan=-0.4 + 0.27 * j, gain=0.2)

# ---------------- main groove 4.0 → 62.0, chord per bar (2 s)
start, end = 4.0, OUTRO
pump = np.ones(N)
t = start; bar = 0
while t < end - 1e-6:
    ch = PROG[bar % 4]
    add(saw_pad(ch + [ch[0] + 12], 2.0, 0.22, 0.06 + 0.02 * (bar % 2)), t, pan=0.15 if bar % 2 else -0.15)
    for b in range(4):
        bt = t + b * B
        if bt >= end: break
        add(kick(), bt, gain=0.62)
        i0 = int(bt * SR); k = np.arange(int(0.3 * SR)); pump[i0:i0 + len(k)] = np.minimum(pump[i0:i0 + len(k)], 0.35 + 0.65 * (k / len(k)) ** 0.6)
        if b % 2 == 1: add(clap(), bt, pan=-0.05, gain=0.32)
        add(hat(), bt + B / 2, pan=0.3, gain=0.10)
        add(hat(140), bt + B / 4, pan=-0.3, gain=0.04); add(hat(140), bt + 3 * B / 4, pan=-0.3, gain=0.04)
        add(bass(ch[0] - 24, B / 2 * 0.9), bt + B / 2, gain=0.42)
        for s16 in range(2):
            add(pluck(ch[ARP[(b * 2 + s16) % 8]] + 12 + (12 if bar % 4 == 3 and s16 == 1 else 0)), bt + s16 * B / 2, pan=0.35 if s16 else -0.35, gain=0.07)
    t += 2.0; bar += 1
# side-chain pump on everything but the drums is approximated by ducking the whole bus a little on each kick
L *= 0.75 + 0.25 * pump; R *= 0.75 + 0.25 * pump

# ---------------- chapter hits: riser into a hit + crash + a gold chime
for c in CHAPTERS:
    add(riser(0.9), c - 0.9, gain=0.35)
    add(impact(0.8), c); add(crash(), c, gain=0.35)
    for j, m in enumerate([86, 90, 93]): add(pluck(m, 0.9), c + 0.02 + j * 0.05, pan=-0.3 + 0.3 * j, gain=0.13)

# ---------------- outro: big hit, sustained chord, fade
add(riser(2.0), OUTRO - 2.0, gain=0.5)
add(impact(1.1), OUTRO); add(crash(), OUTRO, gain=0.6)
add(saw_pad([57, 64, 69, 72, 76], 7.0, 0.45, 0.05), OUTRO)
add(saw_pad([33, 45], 7.0, 0.4, 0.04), OUTRO)
for j, m in enumerate([81, 84, 88, 93, 96]): add(pluck(m, 2.0), OUTRO + 0.05 + j * 0.08, pan=-0.4 + 0.2 * j, gain=0.2)

mix = np.stack([L, R], axis=1)
fade = np.ones(N); fs = int(68.0 * SR); fade[fs:] = np.linspace(1, 0, N - fs) ** 1.5
mix *= fade[:, None]
mix /= np.max(np.abs(mix)) + 1e-9
mix = np.tanh(mix * 1.4) / np.tanh(1.4) * 0.9
with wave.open(sys.argv[1], "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes((mix * 32767).astype(np.int16).tobytes())
print("music", DUR, "s")
