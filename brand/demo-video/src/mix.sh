#!/usr/bin/env bash
# Assemble the voice-over on the timeline, duck the music under it, and mux with the video.
#   bash mix.sh <scratch dir> <out.mp4>
set -euo pipefail
S="$1"; OUT="$2"
python3 - "$S" <<'PY'
import json, sys, wave, numpy as np, subprocess
S = sys.argv[1]
tl = json.load(open(f"{S}/timeline.json"))
SR = 48000
dur = tl[-1]["start"] + tl[-1]["dur"] + 0.5
vo = np.zeros(int(dur * SR), np.float32)
for s in tl:
    if s["vo"] is None: continue
    raw = subprocess.check_output(["ffmpeg", "-loglevel", "error", "-i", f"{S}/vo/{s['key']}.wav", "-ar", str(SR), "-ac", "1", "-f", "f32le", "-"])
    a = np.frombuffer(raw, np.float32)
    i = int(s["vo"] * SR); vo[i:i + len(a)] += a[: len(vo) - i]
vo /= max(1e-9, np.abs(vo).max()) / 0.9
with wave.open(f"{S}/vo_track.wav", "wb") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((vo * 32767).astype(np.int16).tobytes())
PY
ffmpeg -loglevel error -y -i "$S/music.wav" -i "$S/vo_track.wav" -filter_complex \
  "[1:a]aresample=48000,pan=stereo|c0=c0|c1=c0,highpass=f=90,acompressor=threshold=-20dB:ratio=3:attack=5:release=80,volume=3.0,asplit=2[vo][sc];[0:a]volume=0.85[mus];[mus][sc]sidechaincompress=threshold=0.06:ratio=3:attack=15:release=400[duck];[duck][vo]amix=inputs=2:normalize=0:duration=first,loudnorm=I=-14:TP=-1.5:LRA=11[out]" \
  -map "[out]" -ar 48000 "$S/mix.wav"
ffmpeg -loglevel error -y -i "$S/video_noaudio.mp4" -i "$S/mix.wav" -map 0:v -map 1:a -c:v copy -c:a aac -b:a 256k -movflags +faststart -shortest "$OUT"
