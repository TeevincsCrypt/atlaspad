"""Builds overlays.html and a JSON job list for render_overlays.js: background, video frame, section headers and
caption chunks (each rendered to a transparent PNG)."""
import json, pathlib, re, sys
here = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(here))
from script import SECTIONS
voice = json.load(open(sys.argv[1]))
out = pathlib.Path(sys.argv[2])
compass = (here.parent.parent / "launch-video" / "compass-c.frag").read_text()

def chunks(sentence):
    """Split a sentence into caption-sized pieces (<= ~7 words), preferring commas."""
    parts = [p.strip() for p in re.split(r"(?<=,)\s+", sentence) if p.strip()]
    res = []
    for p in parts:
        words = p.split()
        while len(words) > 8:
            res.append(" ".join(words[:6])); words = words[6:]
        res.append(" ".join(words))
    # merge very short pieces into the previous one
    merged = []
    for r in res:
        if merged and len(r.split()) <= 2 and len(merged[-1].split()) <= 6: merged[-1] += " " + r
        else: merged.append(r)
    return merged

def pretty(t):
    # show "$WIF" on screen even though the voice reads "wif"
    t = re.sub(r"\bwif\b", "$WIF", t)
    return t.replace("atlas $WIF dot x y z", "atlaswif.xyz")

jobs, captions = [], {}
feature_keys = [k for k, title, _ in SECTIONS if title]
for key, title, _text in SECTIONS:
    if title:
        n = feature_keys.index(key) + 1
        jobs.append({"id": f"header_{key}", "kind": "header", "num": f"{n:02d}", "of": f"{len(feature_keys):02d}", "title": title})
    if key in voice:
        caps = []
        for li, line in enumerate(voice[key]["lines"]):
            cs = chunks(line["text"])
            total = sum(len(c) for c in cs)
            t = line["start"]
            for ci, c in enumerate(cs):
                d = line["dur"] * len(c) / total
                cid = f"cap_{key}_{li}_{ci}"
                jobs.append({"id": cid, "kind": "caption", "text": pretty(c)})
                caps.append({"id": cid, "start": round(t, 3), "end": round(t + d, 3)})
                t += d
        captions[key] = caps
jobs.append({"id": "bg", "kind": "bg"})
jobs.append({"id": "frame", "kind": "frame"})
json.dump(jobs, open(out / "overlay_jobs.json", "w"), indent=1)
json.dump(captions, open(out / "captions.json", "w"), indent=1)

html = f"""<!doctype html><html><head><meta charset="utf-8"><style>
@font-face {{ font-family: Unbounded; font-weight: 600; src: url(file://{here}/unbounded-latin-600-normal.woff2); }}
@font-face {{ font-family: Unbounded; font-weight: 700; src: url(file://{here}/unbounded-latin-700-normal.woff2); }}
html,body{{margin:0;background:transparent}}
#bg{{width:1920px;height:1080px;position:relative;overflow:hidden;
  background: radial-gradient(1100px 600px at 50% -10%, rgba(214,178,110,.13), transparent 70%), radial-gradient(900px 700px at 100% 110%, rgba(110,168,255,.07), transparent 70%), #05060b}}
#bg .grid{{position:absolute;inset:0;background-image:linear-gradient(rgba(214,178,110,.045) 1px,transparent 1px),linear-gradient(90deg,rgba(214,178,110,.045) 1px,transparent 1px);background-size:60px 60px;mask-image:radial-gradient(ellipse at 50% 40%,black 20%,transparent 80%)}}
#frame{{width:1920px;height:1080px;position:relative}}
#frame .win{{position:absolute;left:78px;top:188px;width:1764px;height:653px;border-radius:20px;box-shadow:0 0 0 2px rgba(255,255,255,.10),0 0 0 1px rgba(214,178,110,.25) inset;}}
#frame .glow{{position:absolute;left:78px;top:188px;width:1764px;height:653px;border-radius:20px;box-shadow:0 50px 120px -40px rgba(0,0,0,.9),0 0 80px -30px rgba(214,178,110,.35)}}
.header{{display:inline-flex;align-items:center;gap:22px;padding:8px 4px}}
.header .num{{font-family:"JetBrains Mono",monospace;font-size:22px;letter-spacing:.2em;color:#e2bd72;padding:8px 14px;border:1px solid rgba(226,189,114,.4);border-radius:10px;background:rgba(226,189,114,.08)}}
.header .t{{font-family:Unbounded;font-weight:700;font-size:46px;color:#eef0f6;letter-spacing:-.005em}}
.header .of{{font-family:"JetBrains Mono",monospace;font-size:18px;color:#6f7891;letter-spacing:.2em}}
.cap{{display:inline-block;max-width:1500px;padding:14px 30px;border-radius:16px;background:rgba(5,6,11,.78);border:1px solid rgba(255,255,255,.08);
  font-family:Inter,sans-serif;font-weight:600;font-size:40px;line-height:1.25;color:#fff;text-align:center;text-shadow:0 2px 10px rgba(0,0,0,.6)}}
.cap b{{color:#f3d58f;font-weight:700}}
.brand{{position:absolute;right:84px;top:92px;display:flex;align-items:center;gap:12px;font-family:Unbounded;font-weight:700;font-size:20px;letter-spacing:.3em;color:#eef0f6;opacity:.9}}
</style></head><body><div id="stage"></div>
<template id="tpl-bg"><div id="bg"><div class="grid"></div><div class="brand"><svg width="34" height="34" viewBox="0 0 200 200">{compass}</svg>ATLASPAD</div></div></template>
<template id="tpl-frame"><div id="frame"><div class="glow"></div><div class="win"></div></div></template>
</body></html>"""
(out / "overlays.html").write_text(html)
print(len(jobs), "overlay jobs")
