"""python voice.py <kokoro.onnx> <voices.bin> <outdir>: one WAV per section + word-level timing estimates (JSON)."""
import json, sys, numpy as np, soundfile as sf
from kokoro_onnx import Kokoro
sys.path.insert(0, __file__.rsplit("/", 1)[0])
from script import LINES
k = Kokoro(sys.argv[1], sys.argv[2]); out = sys.argv[3]; SR = 24000
info = {}
for key, text in LINES.items():
    parts, words = [], []
    for sentence in [s.strip() for s in text.split("|") if s.strip()]:
        s, _ = k.create(sentence, voice="af_heart", speed=1.12, lang="en-us")
        s = np.asarray(s, np.float32)
        idx = np.where(np.abs(s) > 0.012)[0]
        if len(idx): s = s[max(0, idx[0] - 150): idx[-1] + 1500]
        t0 = sum(len(p) for p in parts) / SR; d = len(s) / SR
        ws = sentence.split(); weights = [len(w.strip(",.")) + 2.5 for w in ws]; tot = sum(weights); acc = 0
        for w, wt in zip(ws, weights):
            words.append({"w": w, "t": round(t0 + d * acc / tot, 3)}); acc += wt
        words[-1]["end"] = round(t0 + d, 3)
        parts += [s, np.zeros(int(0.22 * SR), np.float32)]
    a = np.concatenate(parts[:-1]); sf.write(f"{out}/{key}.wav", a, SR)
    info[key] = {"dur": round(len(a) / SR, 3), "words": words}
    print(f"{key:9s} {len(a)/SR:5.2f}s")
json.dump(info, open(f"{out}/voice.json", "w"), indent=1)
