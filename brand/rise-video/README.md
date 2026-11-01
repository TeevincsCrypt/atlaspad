# AtlasPad: The Rise

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

Rebuild:

```bash
python3 src/build.py && python3 src/soundtrack.py
node src/frames.js rise.html - stream 30 41.5 \
  | ffmpeg -f image2pipe -framerate 30 -c:v png -i - -i soundtrack.wav \
      -af loudnorm=I=-14:TP=-1.5 -c:v libx264 -crf 17 -pix_fmt yuv420p \
      -c:a aac -b:a 256k -movflags +faststart -shortest atlaspad-rise.mp4
```
