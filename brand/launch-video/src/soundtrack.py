"""Original soundtrack for the AtlasPad launch film, synthesised with numpy (no samples). Writes soundtrack.wav."""
import numpy as np, wave, pathlib
SR, DUR = 48000, 51.0
N = int(SR * DUR)
L = np.zeros(N); R = np.zeros(N)
t_all = np.arange(N) / SR
rng = np.random.default_rng(7)

def add(sig, at, pan=0.0, gain=1.0):
    i = int(at * SR); n = min(len(sig), N - i)
    if n <= 0: return
    L[i:i+n] += sig[:n] * gain * np.sqrt(0.5 * (1 - pan)) * 1.414
    R[i:i+n] += sig[:n] * gain * np.sqrt(0.5 * (1 + pan)) * 1.414

def env(n, a, r):
    e = np.ones(n); ai = int(a * SR); ri = int(r * SR)
    if ai: e[:ai] = np.linspace(0, 1, ai)
    if ri: e[-ri:] *= np.linspace(1, 0, ri) ** 2
    return e

def lowpass(x, a):  # one-pole
    y = np.empty_like(x); acc = 0.0
    for i in range(len(x)):
        acc += a * (x[i] - acc); y[i] = acc
    return y

def note(f): return 440 * 2 ** ((f - 69) / 12)

# --- pads: A minor -> F -> C -> G, warm detuned saws softened
def pad(freqs, dur, gain):
    n = int(dur * SR); tt = np.arange(n) / SR; s = np.zeros(n)
    for f in freqs:
        for d in (-0.12, 0.0, 0.11):
            ph = rng.random() * 6.28
            s += np.sin(2*np.pi*f*(1+d/100)*tt + ph) + 0.3*np.sin(2*np.pi*2*f*(1+d/100)*tt + ph) + 0.12*np.sin(2*np.pi*3*f*tt)
    s *= (0.85 + 0.15*np.sin(2*np.pi*0.25*tt))
    return s / (len(freqs) * 3) * env(n, min(1.2, dur/3), min(1.5, dur/3)) * gain

prog = [[57, 60, 64, 69], [53, 57, 60, 65], [48, 55, 60, 64], [55, 59, 62, 67]]
# intro: dark single chord, low
add(pad([note(45), note(52), note(57)], 7.3, 0.55), 0.0)
# main bed from 7s, 2-bar chords (4s each at 120bpm)
t = 7.0; k = 0
while t < 45.0:
    d = min(4.3, 45.3 - t)
    add(pad([note(m) for m in prog[k % 4]], d, 0.42), t, pan=(-0.2 if k % 2 else 0.2))
    add(pad([note(prog[k % 4][0] - 12)], d, 0.35), t)
    t += 4.0; k += 1
add(pad([note(m) for m in [57, 60, 64, 69, 76]], 6.0, 0.6), 45.0)
add(pad([note(45), note(33)], 6.0, 0.5), 45.0)

# --- sub boom + impact
def boom(gain=1.0):
    n = int(3.0 * SR); tt = np.arange(n) / SR
    f = 30 + 70 * np.exp(-tt * 9)
    s = np.sin(2*np.pi*np.cumsum(f)/SR) * np.exp(-tt * 1.6)
    noise = lowpass(rng.standard_normal(n), 0.08) * np.exp(-tt * 5) * 0.8
    return (np.tanh(1.6 * (s + noise))) * gain
for at in (7.0, 45.0): add(boom(1.0), at)

# --- risers (filtered noise + rising tone) before impacts
def riser(dur):
    n = int(dur * SR); tt = np.arange(n) / SR; x = tt / dur
    noise = rng.standard_normal(n)
    hp = noise - lowpass(noise, 0.02 + 0.3 * 0)  # brighten
    tone = np.sin(2*np.pi*np.cumsum(200 + 900 * x**2)/SR) * 0.25
    return (hp * 0.35 + tone) * x ** 2.2
add(riser(1.6), 5.4, gain=0.55)
add(riser(2.0), 43.0, gain=0.55)

# --- whooshes at scene changes
def whoosh(dur=0.7):
    n = int(dur * SR); tt = np.arange(n) / SR; x = tt / dur
    s = lowpass(rng.standard_normal(n), 0.05 + 0.25 * np.sin(np.pi * x).mean())
    return s * np.sin(np.pi * x) ** 2 * 1.8
for i, at in enumerate((3.85, 11.7, 16.75, 20.75, 24.75, 31.25, 35.75, 40.75)):
    add(whoosh(), at, pan=(-0.5 if i % 2 else 0.5), gain=0.5)

# --- soft kick + hats on the beat, 120bpm, 7.5 -> 44.5
def kick():
    n = int(0.35 * SR); tt = np.arange(n) / SR
    return np.sin(2*np.pi*np.cumsum(45 + 90*np.exp(-tt*30))/SR) * np.exp(-tt * 9)
def hat():
    n = int(0.06 * SR); tt = np.arange(n) / SR
    s = rng.standard_normal(n); s = s - lowpass(s, 0.3)
    return s * np.exp(-tt * 70)
b = 8.0
while b < 44.6:
    beat = round((b - 8.0) / 0.5)
    if beat % 2 == 0: add(kick(), b, gain=0.55)
    add(hat(), b + 0.25, pan=0.3, gain=0.12)
    b += 0.5

# --- UI sounds
def click(f=2400, g=1.0):
    n = int(0.03 * SR); tt = np.arange(n) / SR
    return np.sin(2*np.pi*f*tt) * np.exp(-tt * 260) * g
def pluck(f, dur=0.9):
    n = int(dur * SR); tt = np.arange(n) / SR
    return (np.sin(2*np.pi*f*tt) + 0.4*np.sin(2*np.pi*2*f*tt) + 0.15*np.sin(2*np.pi*3*f*tt)) * np.exp(-tt * 5)
def thud():
    n = int(0.5 * SR); tt = np.arange(n) / SR
    return np.tanh(2 * (np.sin(2*np.pi*np.cumsum(60+140*np.exp(-tt*25))/SR) * np.exp(-tt*8) + lowpass(rng.standard_normal(n), 0.2)*np.exp(-tt*25)*0.6))
for i in range(8): add(click(2200 + 300 * (i % 3), 0.5), 12.9 + i * 0.1, pan=0.2)       # typing name
for i in range(5): add(click(2600, 0.5), 13.75 + i * 0.09, pan=0.2)                     # ticker
add(click(1200, 0.9), 15.45); add(pluck(note(81)) * 0.5, 15.6); add(pluck(note(88)) * 0.35, 15.68)  # founded chime
add(thud(), 24.0, gain=0.7)                       # PASSED stamp
add(click(1200, 0.9), 33.25)                     # confirm
add(thud(), 33.75, gain=0.7); add(pluck(note(84)) * 0.4, 33.8)  # ON-CHAIN stamp
for i in range(30): add(click(3200, 0.25), 34.0 + i * 0.033, pan=-0.2)  # tx typing
# citizen counter ticks, accelerating
for i in range(40):
    x = i / 39; add(click(1800 + 1400 * x, 0.25), 17.6 + 2.7 * x ** 0.6, pan=(x - 0.5))
# flywheel sparkles each time the pulse passes a node (125 deg/s, nodes 72 deg apart)
scale = [69, 72, 76, 79, 81]
for i in range(8):
    at = 27.2 + i * 72 / 125
    if at < 31.3: add(pluck(note(scale[i % 5] + 12)) * 0.35, at, pan=np.sin(i))
# logo shimmer
for i, m in enumerate([81, 84, 88, 93]): add(pluck(note(m), 1.6) * 0.25, 7.05 + i * 0.09, pan=(-0.4 + 0.27 * i))
for i, m in enumerate([81, 84, 88, 93, 96]): add(pluck(note(m), 2.0) * 0.25, 45.05 + i * 0.08, pan=(-0.4 + 0.2 * i))
add(pluck(note(69), 2.5) * 0.4, 47.6); add(pluck(note(76), 2.5) * 0.3, 47.6)   # URL pill

# master: gentle saturation, fade out
mix = np.stack([L, R], axis=1)
fade = np.ones(N); fs = int(49.6 * SR); fade[fs:] = np.linspace(1, 0, N - fs) ** 1.5
mix *= fade[:, None]
mix /= np.max(np.abs(mix)) + 1e-9
mix = np.tanh(mix * 1.3) / np.tanh(1.3) * 0.9
pcm = (mix * 32767).astype(np.int16)
out = pathlib.Path(__file__).resolve().parent.parent / "soundtrack.wav"
with wave.open(str(out), "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
print("wrote", out)
