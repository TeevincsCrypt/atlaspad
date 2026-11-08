"""Extract each shot's frames at 30 fps of OUTPUT time: cropped above the watermark, denoised, sharpened (card JPEGs),
plus tiny blurred copies for the background."""
import json, os, subprocess, sys
REC, OUT = sys.argv[1], sys.argv[2]
for s in json.load(open(os.path.join(os.path.dirname(__file__), "shots.json"))):
    a, b = s["src"]; t0, t1 = s["t"]; n = round((t1 - t0) * 30)
    d = os.path.join(OUT, s["id"]); os.makedirs(d, exist_ok=True)
    pts = (t1 - t0) / (b - a)
    base = f"crop=1280:472:0:0,setpts=(PTS-STARTPTS)*{pts:.6f},fps=30"
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-ss", str(a), "-t", str(b - a + 0.3), "-i", REC,
                    "-vf", base + ",hqdn3d=1.2:1.2:5:5,scale=1920:-2:flags=lanczos,unsharp=7:7:0.9:5:5:0.0",
                    "-frames:v", str(n), "-q:v", "2", f"{d}/f%04d.jpg"], check=True)
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-ss", str(a), "-t", str(b - a + 0.3), "-i", REC,
                    "-vf", base + ",scale=320:-2,boxblur=6:2", "-frames:v", str(n), "-q:v", "5", f"{d}/b%04d.jpg"], check=True)
    got = len([f for f in os.listdir(d) if f.startswith("f")])
    print(f"{s['id']:9s} {got:4d} frames (want {n})")
