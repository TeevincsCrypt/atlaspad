"""Generate one narration WAV per section with Kokoro (af_heart). Prints durations as JSON.
  python voice.py <kokoro.onnx> <voices.bin> <outdir>"""
import json, sys, numpy as np, soundfile as sf
from kokoro_onnx import Kokoro
sys.path.insert(0, __file__.rsplit("/", 1)[0])
from script import SECTIONS
k = Kokoro(sys.argv[1], sys.argv[2]); out = sys.argv[3]
SR = 24000
info = {}
for key, _title, text in SECTIONS:
    if not text: continue
    parts, lines = [], []
    for sentence in [s.strip() for s in text.split("|") if s.strip()]:
        s, sr = k.create(sentence, voice="af_heart", speed=1.05, lang="en-us")
        s = np.asarray(s, np.float32)
        idx = np.where(np.abs(s) > 0.01)[0]
        if len(idx): s = s[max(0, idx[0] - 200): idx[-1] + 1800]
        start = sum(len(p) for p in parts) / SR
        lines.append({"text": sentence, "start": round(start, 3), "dur": round(len(s) / SR, 3)})
        parts += [s, np.zeros(int(0.32 * SR), np.float32)]
    audio = np.concatenate(parts[:-1])
    sf.write(f"{out}/{key}.wav", audio, SR)
    info[key] = {"dur": round(len(audio) / SR, 3), "lines": lines}
json.dump(info, open(f"{out}/voice.json", "w"), indent=1)
for k2, v in info.items(): print(f"{k2:10s} {v['dur']:6.2f}s")
