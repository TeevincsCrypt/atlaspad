"""Original soundtrack for "The Rise": a track that gains a layer at every stage, with a hit on each level-up.
Synthesised with numpy (no samples). Writes soundtrack.wav."""
import numpy as np, wave, pathlib
SR, DUR = 48000, 41.5
N = int(SR * DUR)
L = np.zeros(N); R = np.zeros(N)
rng = np.random.default_rng(11)
UPS = [9.0, 15.0, 21.0, 27.5]
STARTS = [3.5, 9.0, 15.0, 21.0, 27.5]

def add(sig, at, pan=0.0, gain=1.0):
    i = int(at * SR); n = min(len(sig), N - i)
    if n <= 0 or i < 0: return
    L[i:i+n] += sig[:n] * gain * np.sqrt(1 - pan)
    R[i:i+n] += sig[:n] * gain * np.sqrt(1 + pan)

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

note = lambda m: 440 * 2 ** ((m - 69) / 12)
BPM = 120; BEAT = 60 / BPM

def pad(ms, dur, gain, bright=0.3):
    n = int(dur * SR); tt = np.arange(n) / SR; s = np.zeros(n)
    for m in ms:
        f = note(m)
        for d in (-0.1, 0, 0.1):
            ph = rng.random() * 6.28
            s += np.sin(2*np.pi*f*(1+d/100)*tt + ph) + bright*np.sin(4*np.pi*f*(1+d/100)*tt + ph)
    s *= 0.85 + 0.15 * np.sin(2*np.pi*0.25*tt)
    return s / (len(ms) * 3) * env(n, min(0.8, dur/3), min(1.2, dur/3)) * gain

# chord progression in D minor-ish, rising key per stage (+2 semitones each stage = "levelling up")
PROG = [[50, 53, 57, 62], [46, 50, 53, 58], [48, 52, 55, 60], [45, 49, 52, 57]]
def stage_of(t):
    s = 0
    for i, st in enumerate(STARTS):
        if t >= st: s = i
    return s

# hook: low drone
add(pad([38, 45, 50], 3.9, 0.55, 0.1), 0.0)
# bars of 2s (one chord per bar), transposed up per stage
t = 3.5; k = 0
while t < 34.6:
    s = stage_of(t + 0.01); tr = s * 2
    d = min(2.15, 34.9 - t)
    add(pad([m + tr for m in PROG[k % 4]], d, 0.32 + s * 0.04, 0.25 + s * 0.08), t, pan=0.15 if k % 2 else -0.15)
    add(pad([PROG[k % 4][0] - 12 + tr], d, 0.28), t)
    t += 2.0; k += 1
# end chord
add(pad([62, 65, 69, 74, 81], 6.8, 0.6, 0.4), 34.6)
add(pad([38, 50], 6.8, 0.45), 34.6)

def kick():
    n = int(0.35 * SR); tt = np.arange(n) / SR
    return np.sin(2*np.pi*np.cumsum(45 + 95*np.exp(-tt*30))/SR) * np.exp(-tt*9)
def hat(dec=70):
    n = int(0.07 * SR); tt = np.arange(n) / SR; s = rng.standard_normal(n); s = s - lowpass(s, 0.3)
    return s * np.exp(-tt * dec)
def clap():
    n = int(0.25 * SR); tt = np.arange(n) / SR; s = rng.standard_normal(n); s = s - lowpass(s, 0.08)
    return s * (np.exp(-tt*28) + 0.5*np.exp(-np.maximum(tt-0.012, 0)*30)*(tt > 0.012))
def pluck(f, dur=0.5, dec=7):
    n = int(dur * SR); tt = np.arange(n) / SR
    return (np.sin(2*np.pi*f*tt) + 0.45*np.sin(4*np.pi*f*tt) + 0.2*np.sin(6*np.pi*f*tt)) * np.exp(-tt*dec)
def bass(f, dur):
    n = int(dur * SR); tt = np.arange(n) / SR
    s = np.sign(np.sin(2*np.pi*f*tt)) * 0.5 + np.sin(2*np.pi*f*tt)
    return lowpass(s, 0.06) * env(n, 0.005, 0.08)

# rhythm layers by stage: 0 hats-lite, 1 +kick, 2 +clap +bass, 3 +arp, 4 everything louder
b = 3.5; i = 0
while b < 34.4:
    s = stage_of(b + 0.001); tr = s * 2
    bar_pos = i % 8
    chord = PROG[(i // 4) % 4]
    if s >= 0: add(hat(), b + BEAT/2, pan=0.3, gain=0.08 + 0.03*s)
    if s >= 1 and i % 2 == 0: add(kick(), b, gain=0.55 + 0.05*s)
    if s >= 2 and i % 4 == 2: add(clap(), b, pan=-0.1, gain=0.22)
    if s >= 2: add(bass(note(chord[0] - 12 + tr), BEAT*0.9), b, gain=0.22)
    if s >= 3:
        for j in range(2):
            m = chord[(i*2 + j) % 4] + 12 + tr
            add(pluck(note(m), 0.35, 9), b + j*BEAT/2, pan=(-0.4 if j else 0.4), gain=0.12)
    if s >= 4: add(hat(40), b + BEAT/4, pan=-0.3, gain=0.07)
    b += BEAT; i += 1

# level-up: riser + impact + shimmer
def riser(dur):
    n = int(dur * SR); tt = np.arange(n) / SR; x = tt / dur
    no = rng.standard_normal(n); no = no - lowpass(no, 0.05)
    tone = np.sin(2*np.pi*np.cumsum(220 + 1400*x**2)/SR) * 0.3
    return (no*0.3 + tone) * x**2.4
def impact(g=1.0):
    n = int(2.4 * SR); tt = np.arange(n) / SR
    s = np.sin(2*np.pi*np.cumsum(32 + 80*np.exp(-tt*10))/SR) * np.exp(-tt*1.8)
    no = lowpass(rng.standard_normal(n), 0.1) * np.exp(-tt*6)
    return np.tanh(1.7*(s + no*0.8)) * g
for k, u in enumerate(UPS):
    add(riser(1.4 + 0.2*k), u - (1.4 + 0.2*k), gain=0.35 + 0.05*k)
    add(impact(0.85 + 0.1*k), u)
    tr = (k + 1) * 2
    for j, m in enumerate([74, 77, 81, 86]):
        add(pluck(note(m + tr), 1.4, 3.5), u + 0.04 + j*0.07, pan=-0.45 + 0.3*j, gain=0.18)
# requirement ticks just before each level-up
for u in UPS:
    for d, m in ((1.0, 84), (0.6, 88)):
        add(pluck(note(m), 0.25, 18), u - d, gain=0.16)
# event card blips
for et in [5.2, 7.0, 11.0, 12.8, 16.8, 18.6, 22.8, 24.6, 29.6, 31.4]:
    add(pluck(note(91), 0.18, 25), et, pan=0.5, gain=0.12)
# hex pops: soft ticks across each stage's growth window
for s, st in enumerate(STARTS):
    for j in range(10):
        add(pluck(note(72 + (j % 5) * 3 + s*2), 0.12, 30), st + 0.2 + j*0.17, pan=np.sin(j), gain=0.05)
# empire: crown choir swell + extra boom
add(pad([62+8, 66+8, 69+8, 74+8], 6.5, 0.35, 0.6), 27.6)
add(impact(1.0), 27.55)
# end sting
add(impact(0.7), 34.8)
for j, m in enumerate([74, 78, 81, 86, 90]):
    add(pluck(note(m), 2.0, 2.2), 37.8 + j*0.08, pan=-0.4 + 0.2*j, gain=0.15)

mix = np.stack([L, R], axis=1)
fade = np.ones(N); fs = int(40.2 * SR); fade[fs:] = np.linspace(1, 0, N - fs) ** 1.5
mix *= fade[:, None]
mix /= np.max(np.abs(mix)) + 1e-9
mix = np.tanh(mix * 1.3) / np.tanh(1.3) * 0.9
out = pathlib.Path(__file__).resolve().parent.parent / "soundtrack.wav"
with wave.open(str(out), "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes((mix * 32767).astype(np.int16).tobytes())
print("wrote", out)
