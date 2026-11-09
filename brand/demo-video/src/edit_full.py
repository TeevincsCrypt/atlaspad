"""Full-screen walkthrough version (no zooms): the cleaned recording fills the frame width edge to edge.
Composites the AtlasPad demo: the cleaned screen recording inside a branded frame, film clips, the Telegram banner,
section headers, progress and captions. Writes raw frames to ffmpeg and a timeline JSON for the audio mix.

  python edit.py <recording> <scratch dir> <telegram banner png> <out.mp4>

The recording's bottom 96 rows (a burned-in "clideo.com" watermark and the screen recorder's widget) are cropped off.
"""
import json, math, subprocess, sys
import numpy as np
from PIL import Image, ImageDraw

REC, S, BANNER, OUT = sys.argv[1:5]
FPS = 30
W, H = 1920, 1080
SRC_W, SRC_H = 1280, 472          # recording after cropping the watermark strip
WIN_X, WIN_Y, WIN_W, WIN_H = 0, 156, 1920, 708

voice = json.load(open(f"{S}/vo/voice.json"))
captions = json.load(open(f"{S}/captions.json"))
VO_DELAY = 0.45  # narration starts this long after its section begins

# Zoom targets on the 1280x472 recording: (cx, cy, z_start, z_end)
COUNTER = (330, 380, 1.0, 2.0)
BUYPANEL = (1060, 200, 1.4, 1.55)
CHATZ = (600, 300, 1.3, 1.38)
CARD = (636, 290, 1.35, 1.45)
WIZ = (640, 236, 1.05, 1.15)
NONE = None

# Sections: (key, [clips]). Clips: ("rec", start, end, speed, zoom) | ("film", name) | ("image", path, seconds)
TIMELINE = [
    ("intro", [("film", "intro")]),
    ("flywheel", [("rec", 3.0, 11.0, 1.0, NONE), ("film", "flywheel")]),
    ("launch", [("rec", 17.0, 33.0, 3.0, NONE), ("rec", 36.0, 47.0, 2.4, NONE), ("rec", 48.0, 62.0, 3.0, NONE),
                ("rec", 63.0, 78.0, 6.0, NONE), ("rec", 78.0, 90.0, 1.3, NONE)]),
    ("buy", [("rec", 90.0, 101.0, 1.3, NONE), ("rec", 102.0, 124.0, 7.0, NONE), ("rec", 125.0, 129.0, 2.0, NONE),
             ("rec", 130.0, 136.0, 1.0, NONE)]),
    ("citizens", [("rec", 151.0, 153.6, 0.8, NONE), ("rec", 136.0, 138.6, 0.65, NONE), ("rec", 153.6, 161.0, 1.5, NONE)]),
    ("chat", [("rec", 162.0, 176.0, 1.6, NONE)]),
    ("sell", [("rec", 176.0, 180.0, 1.0, NONE), ("rec", 180.0, 213.0, 7.0, NONE)]),
    ("pnl", [("rec", 214.0, 220.0, 3.0, NONE), ("rec", 221.0, 231.0, 1.0, NONE)]),
    ("profile", [("rec", 139.0, 150.0, 1.2, NONE)]),
    ("telegram", [("image", BANNER, 7.6)]),
    ("outro", [("film", "outro")]),
]


def ease(x):
    x = min(1, max(0, x))
    return x * x * (3 - 2 * x)

def clip_seconds(c):
    if c[0] == "rec": return (c[2] - c[1]) / c[3]
    if c[0] == "film": return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f"{S}/film_{c[1]}.mp4"])) + (c[2] if len(c) > 2 else 0)
    return c[2]

# Make every section at least as long as its narration (+ breathing room) by slowing its last recording clip.
plan = []
for key, clips in TIMELINE:
    clips = [list(c) for c in clips]
    need = voice[key]["dur"] + VO_DELAY + 0.9 if key in voice else 0
    total = sum(clip_seconds(c) for c in clips)
    if total < need:
        last = clips[-1]
        if last[0] == "film":  # hold the film's last frame
            last.append(need - total) if len(last) == 2 else None
        elif last[0] == "rec":
            dur = (last[2] - last[1]) / last[3] + (need - total)
            last[3] = (last[2] - last[1]) / dur
        else:
            last[2] += need - total
    plan.append((key, clips))

# ---- assets
bg = Image.open(f"{S}/ov/bg.png").convert("RGB")
frame_ov = Image.open(f"{S}/ov/frame.png").convert("RGBA")
ov_cache = {}
def ov(name):
    if name not in ov_cache: ov_cache[name] = Image.open(f"{S}/ov/{name}.png").convert("RGBA")
    return ov_cache[name]
mask = Image.new("L", (WIN_W, WIN_H), 0)
ImageDraw.Draw(mask).rectangle([0, 0, WIN_W - 1, WIN_H - 1], fill=255)
feature_keys = [k for k, _ in plan if k not in ("intro", "outro")]

def frames_of(cmd, w, h):
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    size = w * h * 3
    while True:
        b = p.stdout.read(size)
        if len(b) < size: break
        yield np.frombuffer(b, np.uint8).reshape(h, w, 3)
    p.wait()

def rec_frames(start, end, speed, zoom):
    src = frames_of(["ffmpeg", "-ss", f"{start}", "-t", f"{end - start + 0.2}", "-i", REC, "-vf", f"crop={SRC_W}:{SRC_H}:0:0,fps=30,hqdn3d=1.2:1.2:5:5,scale={WIN_W}:{WIN_H}:flags=lanczos,unsharp=7:7:0.8:5:5:0.0",
                     "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], WIN_W, WIN_H)
    n = round((end - start) / speed * FPS)
    cur, idx = None, -1
    for k in range(n):
        want = int(k * speed)
        while idx < want:
            nxt = next(src, None)
            if nxt is None: break
            cur, idx = nxt, idx + 1
        img = Image.fromarray(cur)
        if False:
            cx, cy, z0, z1 = zoom
            z = z0 + (z1 - z0) * ease(k / max(1, n - 1))
            cw, ch = SRC_W / z, SRC_H / z
            x0 = min(max(cx - cw / 2, 0), SRC_W - cw); y0 = min(max(cy - ch / 2, 0), SRC_H - ch)
            img = img.resize((WIN_W, WIN_H), Image.BICUBIC, box=(x0, y0, x0 + cw, y0 + ch))
        yield img

def film_frames(name, hold=0.0):
    last = None
    for f in frames_of(["ffmpeg", "-i", f"{S}/film_{name}.mp4", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], W, H):
        last = Image.fromarray(f)
        yield last
    for _ in range(round(hold * FPS)):
        yield last

def image_frames(path, secs):
    im = Image.open(path).convert("RGB")
    n = round(secs * FPS)
    for k in range(n):
        z = 1.0 + 0.06 * ease(k / max(1, n - 1))
        cw, ch = im.width / z, im.height / z
        x0, y0 = (im.width - cw) / 2, (im.height - ch) / 2
        yield im.resize((W, H), Image.BICUBIC, box=(x0, y0, x0 + cw, y0 + ch))

enc = subprocess.Popen(["ffmpeg", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                        "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p", "-movflags", "+faststart", OUT], stdin=subprocess.PIPE)

timeline = []
t_global = 0.0
for si, (key, clips) in enumerate(plan):
    sec_start = t_global
    sec_frames = sum(round(clip_seconds(c) * FPS) for c in clips)
    timeline.append({"key": key, "start": round(sec_start, 3), "dur": round(sec_frames / FPS, 3), "vo": round(sec_start + VO_DELAY, 3) if key in voice else None})
    caps = captions.get(key, [])
    k_sec = 0
    for c in clips:
        gen = rec_frames(c[1], c[2], c[3], c[4]) if c[0] == "rec"  else film_frames(c[1], c[2] if len(c) > 2 else 0.0) if c[0] == "film" else image_frames(c[1], c[2])
        windowed = c[0] == "rec"
        for content in gen:
            ts = k_sec / FPS  # time within section
            if windowed:
                out = bg.copy()
                # fade content in/out at section edges
                fade = min(1.0, ease(ts / 0.3), ease((sec_frames / FPS - ts) / 0.25))
                if fade < 1: content = Image.blend(Image.new("RGB", content.size, (5, 6, 11)), content, fade)
                out.paste(content, (WIN_X, WIN_Y), mask)
                d0 = ImageDraw.Draw(out)
                d0.line([(0, WIN_Y - 1), (W, WIN_Y - 1)], fill=(120, 98, 58), width=2)
                d0.line([(0, WIN_Y + WIN_H), (W, WIN_Y + WIN_H)], fill=(120, 98, 58), width=2)
                if key in feature_keys:
                    h = ov(f"header_{key}")
                    a = ease((ts - 0.05) / 0.45)
                    if a > 0:
                        hh = h.copy(); hh.putalpha(hh.getchannel("A").point(lambda v: int(v * a)))
                        out.paste(hh, (int(70 - 30 * (1 - a)), 36), hh)
                    # progress: one bar per feature, current one gold
                    d = ImageDraw.Draw(out)
                    fi = feature_keys.index(key)
                    for i in range(len(feature_keys)):
                        x = 1320 + i * 58
                        col = (243, 213, 143) if i == fi else (110, 92, 58) if i < fi else (40, 44, 58)
                        d.rounded_rectangle([x, 128, x + 48, 133], radius=3, fill=col)
                cap_y = 890
            else:
                out = content.copy()
                fade = min(1.0, ease(ts / 0.2)) if si > 0 else 1.0
                if key == "outro":  # final fade to black
                    fade = min(fade, ease((sec_frames / FPS - ts) / 0.9))
                if fade < 1: out = Image.blend(Image.new("RGB", out.size, (0, 0, 0)), out, fade)
                cap_y = 960
            # caption
            tv = ts - VO_DELAY
            cur = next((cc for cc in caps if cc["start"] - 0.05 <= tv < cc["end"] + 0.12), None)
            if cur:
                cimg = ov(cur["id"])
                ca = min(1.0, (tv - cur["start"] + 0.05) / 0.12)
                if ca < 1:
                    cimg = cimg.copy(); cimg.putalpha(cimg.getchannel("A").point(lambda v: int(v * ca)))
                out.paste(cimg, ((W - cimg.width) // 2, cap_y), cimg)
            enc.stdin.write(out.tobytes())
            k_sec += 1
    t_global += k_sec / FPS
    print(f"{key:9s} start {sec_start:6.2f}s  dur {k_sec / FPS:5.2f}s", flush=True)

enc.stdin.close(); enc.wait()
json.dump(timeline, open(f"{S}/timeline.json", "w"), indent=1)
print("total", round(t_global, 2), "s")
