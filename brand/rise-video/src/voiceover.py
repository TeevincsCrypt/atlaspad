"""Female voice-over for "The Rise", generated locally with Kokoro TTS (open model, voice af_heart).
  python voiceover.py <kokoro-v1.0.onnx> <voices-v1.0.bin> <out.wav>
Each line is placed at its scene time; a line that would overlap the previous one is pushed later."""
import sys
import numpy as np, soundfile as sf
from kokoro_onnx import Kokoro

VOICE = "af_heart"
# (start time in seconds, text, speed). "$WIF" is spelled "wif" so it is spoken as a word.
LINES = [
    (0.35, "Every empire starts as a settlement.", 1.0),
    (4.1, "Found a nation on Atlas Pad, and every holder becomes a citizen.", 1.08),
    (9.35, "Ten citizens. A town is born.", 1.0),
    (11.6, "Citizens vote, and the treasury fills with wif.", 1.05),
    (15.35, "Fifty citizens. Now, it's a city.", 1.0),
    (17.6, "It wins wars. It makes allies.", 1.0),
    (21.35, "Two hundred and fifty citizens. A metropolis.", 1.05),
    (24.4, "And every trade burns wif.", 1.0),
    (28.0, "One thousand citizens. An empire.", 0.95),
    (31.5, "Graduated to Uniswap, with its liquidity locked forever.", 1.08),
    (35.3, "From one holder, to an empire.", 0.95),
    (37.45, "Found your nation, at atlas wif dot x y z.", 1.05),
]
DUR = 41.5

def main(model, voices, out):
    k = Kokoro(model, voices)
    sr = 24000
    track = np.zeros(int(DUR * sr), dtype=np.float32)
    cursor = 0.0
    for at, text, speed in LINES:
        s, sr = k.create(text, voice=VOICE, speed=speed, lang="en-us")
        s = np.asarray(s, dtype=np.float32)
        # trim leading/trailing silence
        idx = np.where(np.abs(s) > 0.01)[0]
        if len(idx): s = s[max(0, idx[0] - 240): idx[-1] + 2400]
        start = max(at, cursor + 0.15)
        i = int(start * sr); n = min(len(s), len(track) - i)
        track[i:i + n] += s[:n]
        cursor = start + len(s) / sr
        print(f"{start:6.2f}-{cursor:6.2f}  {text}")
    track /= max(1e-9, np.abs(track).max()) / 0.9
    sf.write(out, track, sr)

if __name__ == "__main__":
    main(*sys.argv[1:4])
