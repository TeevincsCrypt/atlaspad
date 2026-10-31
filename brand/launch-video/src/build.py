"""Assemble film.html from film.src.html: injects the brand compass, the frog glyph and repeated UI parts."""
import math, pathlib
here = pathlib.Path(__file__).resolve().parent
root = here.parent
src = (here / "film.src.html").read_text()

bars = "".join('<div style="flex:1;height:6px;border-radius:3px"></div>' for _ in range(8))

hexes = []
R = 46
for q in range(-4, 5):
    for r in range(-4, 5):
        s = -q - r
        d = max(abs(q), abs(r), abs(s))
        if d > 4: continue
        x = R * math.sqrt(3) * (q + r / 2); y = R * 1.5 * r
        pts = " ".join(f"{x + (R-4)*math.cos(math.radians(60*k-30)):.1f},{y + (R-4)*math.sin(math.radians(60*k-30)):.1f}" for k in range(6))
        hexes.append(f'<polygon data-r="{d}" points="{pts}" fill="rgba(214,178,110,{0.55 - d*0.08:.2f})" stroke="#f3d58f" stroke-opacity=".7" stroke-width="1.5" style="transform-box:fill-box;transform-origin:center"/>')
hexes = "".join(hexes)

ladder = "".join(
    f'<div style="display:flex;justify-content:space-between;align-items:center;padding:14px 20px;border:1px solid;border-radius:12px;background:rgba(255,255,255,.02)">'
    f'<span style="font-family:Unbounded;font-weight:600;font-size:24px">{n}</span>'
    f'<span style="font-family:\'JetBrains Mono\',monospace;font-size:18px;color:#8c95aa">{c} citizens <span class="ck" style="color:#f3d58f;margin-left:10px">✓</span></span></div>'
    for n, c in [("Settlement", "0+"), ("Town", "10+"), ("City", "50+"), ("Metropolis", "250+"), ("Empire", "1,000+")])

chips_data = [("🏛️", "Build", "embassies, ports, forts"), ("⚔️", "Declare war", "take territory on the map"), ("🤝", "Form alliances", "shared borders, shared wins"),
              ("💰", "Fund the treasury", "every trade feeds it"), ("🗺️", "Expand territory", "the map grows with market cap"), ("📜", "Pass laws", "tax, tariffs, charters")]
chips = "".join(
    f'<div class="panel chip" style="left:{215 + (i % 3) * 500}px;top:{240 + (i // 3) * 130}px"><div class="ic">{ic}</div><div><div class="t">{t}</div><div class="s">{s}</div></div></div>'
    for i, (ic, t, s) in enumerate(chips_data))

nodes_data = [((780, 262), "Found a nation", "100 WIF fee · burned"), ((1262, 470), "Trade the curve", "every buy and sell in WIF"),
              ((1140, 860), "Graduate", "WIF/nation pool · LP burned"), ((420, 860), "Treasury grows", "0.5% of trades, paid in WIF"),
              ((298, 470), "Citizens spend", "wars, buildings, alliances")]
nodes = "".join(f'<div class="panel node" style="left:{x}px;top:{y}px"><div class="t">{t}</div><div class="s">{s}</div></div>' for (x, y), t, s in nodes_data)

feats_data = [("$WIF bonding curves", "every nation is priced in $WIF"), ("Uniswap V2 · LP burned", "liquidity locked forever at graduation"),
              ("On-chain governance", "citizens propose, vote and execute"), ("No admin keys", "immutable contracts · open source")]
feats = "".join(
    f'<div class="panel feat" style="left:{300 + (i % 2) * 700}px;top:{440 + (i // 2) * 170}px"><div class="d"></div><div><div class="t">{t}</div><div class="s">{s}</div></div></div>'
    for i, (t, s) in enumerate(feats_data))

out = (src.replace("%%COMPASS_A%%", (root / "compass-a.frag").read_text())
          .replace("%%COMPASS_C%%", (root / "compass-c.frag").read_text())
          .replace("%%FROG%%", (root / "frog.path").read_text().strip())
          .replace("%%BARS%%", bars).replace("%%HEXES%%", hexes).replace("%%LADDER%%", ladder)
          .replace("%%CHIPS%%", chips).replace("%%NODES%%", nodes).replace("%%FEATS%%", feats))
assert "%%" not in out
(root / "film.html").write_text(out)
print("film.html", len(out))
