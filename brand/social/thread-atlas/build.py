"""Builds thread.html from thread.src.html and renders the five 1600x900 thread images.
  python build.py   (needs Node + Playwright)"""
import pathlib, subprocess
here = pathlib.Path(__file__).resolve().parent
src = (here / "thread.src.html").read_text()
ladder = "".join(
    f'<div class="panel" style="display:flex;justify-content:space-between;align-items:center;padding:20px 26px;{"border-color:rgba(243,213,143,.55);" if i == 4 else ""}">'
    f'<span style="font-family:Unbounded;font-weight:600;font-size:26px" class="{"gold" if i == 4 else ""}">{n}</span>'
    f'<span class="mono" style="font-size:15px;color:#8c95aa">{c} citizens</span></div>'
    for i, (n, c) in enumerate([("Settlement", "0+"), ("Town", "10+"), ("City", "50+"), ("Metropolis", "250+"), ("Empire", "1,000+")]))
out = src.replace("%%COMPASS%%", (here / "compass-a.frag").read_text()).replace("%%LADDER%%", ladder)
assert "%%" not in out
(here / "thread.html").write_text(out)
js = """
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1.5 });
  await p.goto('file://' + process.argv[1]); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(300);
  for (let i = 1; i <= 5; i++) await (await p.$('#c' + i)).screenshot({ path: process.argv[2] + '/atlas-thread-' + i + '.png' });
  await b.close();
})();
"""
subprocess.run(["node", "-e", js, str(here / "thread.html"), str(here)], check=True)
print("ok")
