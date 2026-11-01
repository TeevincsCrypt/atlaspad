"""Assemble rise.html from rise.src.html: injects the brand compass and the frog glyph from the launch-video assets."""
import pathlib
here = pathlib.Path(__file__).resolve().parent
root = here.parent
assets = root.parent / "launch-video"
out = ((here / "rise.src.html").read_text()
       .replace("%%FROG%%", (assets / "frog.path").read_text().strip())
       .replace("%%COMPASS%%", (assets / "compass-c.frag").read_text()))
assert "%%" not in out
(root / "rise.html").write_text(out)
print("rise.html", len(out))
