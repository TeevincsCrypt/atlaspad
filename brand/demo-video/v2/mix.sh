#!/usr/bin/env bash
# bash mix.sh <scratch dir> <out.mp4>: place narration, duck the music lightly under it, normalise, mux.
set -euo pipefail
S="$1"; OUT="$2"
python3 - "$S" <<'PY'
import sys, wave, subprocess, numpy as np
S = sys.argv[1]; SR = 48000
VO = {"flywheel": 4.6, "launch": 14.1, "buy": 24.2, "citizens": 31.0, "chat": 38.3, "sell": 43.2, "pnl": 47.7, "profile": 54.2, "telegram": 58.3, "outro": 63.0}
track = np.zeros(int(70 * SR), np.float32)
for k, at in VO.items():
    a = np.frombuffer(subprocess.check_output(["ffmpeg", "-loglevel", "error", "-i", f"{S}/vo/{k}.wav", "-ar", str(SR), "-ac", "1", "-f", "f32le", "-"]), np.float32)
    i = int(at * SR); track[i:i + len(a)] += a[: len(track) - i]
track /= max(1e-9, np.abs(track).max()) / 0.9
with wave.open(f"{S}/vo_track.wav", "wb") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((track * 32767).astype(np.int16).tobytes())
PY
ffmpeg -loglevel error -y -i "$S/music.wav" -i "$S/vo_track.wav" -filter_complex \
  "[1:a]aresample=48000,pan=stereo|c0=c0|c1=c0,highpass=f=100,equalizer=f=3000:t=q:w=1:g=3,acompressor=threshold=-22dB:ratio=3.5:attack=4:release=70,volume=3.2,asplit=2[vo][sc];[0:a]volume=0.9[mus];[mus][sc]sidechaincompress=threshold=0.07:ratio=2.5:attack=12:release=300[duck];[duck][vo]amix=inputs=2:normalize=0:duration=first,loudnorm=I=-13:TP=-1.2:LRA=9[out]" \
  -map "[out]" -ar 48000 "$S/mix.wav"
ffmpeg -loglevel error -y -i "$S/video.mp4" -i "$S/mix.wav" -map 0:v -map 1:a -c:v copy -c:a aac -b:a 256k -movflags +faststart -shortest "$OUT"
