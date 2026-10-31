# AtlasPad launch film

`atlaspad-launch.mp4` is a 51-second, 1920x1080, 30 fps launch teaser with an original soundtrack.

Everything is generated from source in `src/`:

| File | What it does |
| --- | --- |
| `src/film.src.html` | The film as one HTML page with a frame-exact `render(t)` timeline (11 scenes) |
| `src/build.py` | Injects the brand compass, the frog glyph and repeated UI parts, then writes `film.html` |
| `src/soundtrack.py` | Synthesises the music and sound design with numpy, then writes `soundtrack.wav` |
| `src/frames.js` | Renders frames with Playwright (preview stills, or a PNG stream for ffmpeg) |

Rebuild:

```bash
python3 src/build.py && python3 src/soundtrack.py
node src/frames.js film.html - stream 30 51 \
  | ffmpeg -f image2pipe -framerate 30 -c:v png -i - -i soundtrack.wav \
      -af loudnorm=I=-14:TP=-1.5 -c:v libx264 -crf 17 -pix_fmt yuv420p \
      -c:a aac -b:a 256k -movflags +faststart -shortest atlaspad-launch.mp4
```

Preview single frames: `node src/frames.js film.html /tmp/out 8.5,14,28.5,48.5`.
The product shots (`shot-*.png`) are screenshots of the real app; the world map shows labelled demo nations.
