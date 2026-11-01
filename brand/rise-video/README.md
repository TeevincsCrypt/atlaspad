# AtlasPad: The Rise

`atlaspad-rise-voiceover.mp4` is the same video with a female voice-over; `atlaspad-rise.mp4` is music only.

`atlaspad-rise.mp4` is a 41-second, 1920x1080, 30 fps video of one nation climbing every stage:
Settlement → Town → City → Metropolis → Empire. The thresholds shown are the real game rules
(10 / 50 / 250 / 1,000 citizens and civilization score 15 / 35 / 55 / 75). Pepeland and its numbers are an
illustrative example.

| File | What it does |
| --- | --- |
| `src/rise.src.html` | The film as one HTML page with a frame-exact `render(t)` timeline: isometric hex territory on a canvas, HUD, event feed, price ribbon |
| `src/build.py` | Injects the brand compass and the frog glyph from `../launch-video`, then writes `rise.html` |
| `src/soundtrack.py` | Synthesises the music with numpy: a layer is added and the key rises at every stage, with a hit on each level-up |
| `src/frames.js` | Renders frames with Playwright |
| `src/voiceover.py` | Generates the timed female narration locally with the open Kokoro TTS model (voice `af_heart`) |

Rebuild:

```bash
python3 src/build.py && python3 src/soundtrack.py
node src/frames.js rise.html - stream 30 41.5 \
  | ffmpeg -f image2pipe -framerate 30 -c:v png -i - -i soundtrack.wav \
      -af loudnorm=I=-14:TP=-1.5 -c:v libx264 -crf 17 -pix_fmt yuv420p \
      -c:a aac -b:a 256k -movflags +faststart -shortest atlaspad-rise.mp4
```

Voice-over (needs `pip install kokoro-onnx soundfile` and the two model files from
https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.0):

```bash
python3 src/voiceover.py kokoro-v1.0.onnx voices-v1.0.bin voiceover.wav
ffmpeg -i soundtrack.wav -i voiceover.wav -filter_complex "[1:a]aresample=48000,pan=stereo|c0=c0|c1=c0,highpass=f=90,acompressor=threshold=-20dB:ratio=3:attack=5:release=80,volume=3.0,asplit=2[vo][sc];[0:a]volume=0.95[mus];[mus][sc]sidechaincompress=threshold=0.08:ratio=2.2:attack=15:release=350[duck];[duck][vo]amix=inputs=2:normalize=0:duration=first,loudnorm=I=-14:TP=-1.5:LRA=11[out]" -map "[out]" -ar 48000 mix.wav
ffmpeg -i atlaspad-rise.mp4 -i mix.wav -map 0:v -map 1:a -c:v copy -c:a aac -b:a 256k -movflags +faststart -shortest atlaspad-rise-voiceover.mp4
```
