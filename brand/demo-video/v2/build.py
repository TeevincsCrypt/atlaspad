"""Fill demo.src.html → <scratch>/demo.html with shots, voice timing and asset paths."""
import json, pathlib, sys
here = pathlib.Path(__file__).resolve().parent; S = pathlib.Path(sys.argv[1]).resolve()
lv = here.parent.parent / "launch-video"
s = (here / "demo.src.html").read_text()
s = (s.replace("%%SHOTS%%", (here / "shots.json").read_text())
      .replace("%%VOICE%%", (S / "vo" / "voice.json").read_text())
      .replace("%%SHOT_DIR%%", f"file://{S}/shots")
      .replace("%%FONTS%%", f"file://{lv}")
      .replace("%%TG%%", f"file://{here.parent.parent}/social/update-telegram-live/tg-screenshot.jpg")
      .replace("%%COMPASS_A%%", (lv / "compass-a.frag").read_text())
      .replace("%%COMPASS_B%%", (lv / "compass-b.frag").read_text())
      .replace("%%COMPASS_C%%", (lv / "compass-c.frag").read_text()))
assert "%%" not in s
(S / "demo.html").write_text(s); print("built", S / "demo.html")
