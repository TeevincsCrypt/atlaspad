# AtlasPad demo video

`atlaspad-demo.mp4`: 1:57, 1920x1080, 30 fps, female voice-over, captions and original music. It's an edit of the
founder's screen-recorded walkthrough (all real on-chain actions), in 9 sections:

1. The $WIF flywheel · 2. Launch a nation · 3. Buy with $WIF · 4. Holders become citizens · 5. Citizens-only chat ·
6. Sell · 7. PnL cards · 8. Your profile · 9. Telegram alerts (with an intro and an outro).

The source recording carried a burned-in "clideo.com" watermark and a screen-recorder widget along its bottom edge;
the recording is cropped above both (rows 0–471 of 568), so neither appears anywhere.

| File | What it does |
| --- | --- |
| `src/script.py` | Narration text per section |
| `src/voice.py` | Generates the narration with the open Kokoro TTS model (voice `af_heart`) |
| `src/overlays.py`, `src/render_overlays.js` | Background, video frame, section headers and caption images |
| `src/film_clip.js` | Renders the intro, flywheel and outro clips from `../launch-video/film.html` |
| `src/edit.py` | The edit: clip list, speed changes, zooms, headers, progress bar, captions; writes the video |
| `src/music.py` | Original background music (numpy), timed to the sections |
| `src/mix.sh` | Places the narration, ducks the music under it, loudness-normalises and muxes |
