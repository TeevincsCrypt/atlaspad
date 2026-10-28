"""Generates the AtlasPad compass-star mark as SVG fragments (viewBox 0 0 200 200, centre 100,100)."""
import math, sys

C = 100.0

def pt(r, deg):
    a = math.radians(deg - 90)  # 0deg = north, clockwise
    return (C + r * math.cos(a), C + r * math.sin(a))

def f(p):
    return f"{p[0]:.2f} {p[1]:.2f}"

def arm(angle, tip, side, spread, light, dark):
    """A bevelled star point: two triangles (lit / shaded half) from the centre to the tip."""
    t = pt(tip, angle)
    l = pt(side, angle - spread)
    r = pt(side, angle + spread)
    c = (C, C)
    return (f'<path d="M{f(t)} L{f(l)} L{f(c)} Z" fill="{light}"/>'
            f'<path d="M{f(t)} L{f(r)} L{f(c)} Z" fill="{dark}"/>')

def ring_segments(radius, width, gap_deg, cut):
    """Four thick ring arcs centred on N/E/S/W, broken where the diagonal points pass.
    Ends are cut at an angle (`cut` degrees of skew) like the reference mark."""
    ro, ri = radius + width / 2, radius - width / 2
    out = []
    for centre in (0, 90, 180, 270):
        a0 = centre - (45 - gap_deg / 2)
        a1 = centre + (45 - gap_deg / 2)
        p1, p2 = pt(ro, a0), pt(ro, a1)
        p3, p4 = pt(ri, a1 - cut), pt(ri, a0 + cut)
        out.append(
            f'<path d="M{f(p1)} A{ro} {ro} 0 0 1 {f(p2)} L{f(p3)} A{ri} {ri} 0 0 0 {f(p4)} Z" fill="url(#{{id}}ring)"/>'
        )
    return "".join(out)

def mark(theme="dark"):
    if theme == "dark":
        g = ("#f8e9b8", "#dcb76c", "#9c7633")  # ring gradient
        light, dark = "#fbeec4", "#c9a258"
        dlight, ddark = "#efd796", "#b38c46"
    else:  # deeper gold that holds contrast on white / cream
        g = ("#d9b56a", "#b08433", "#6f4f1a")
        light, dark = "#e2bf72", "#9a7029"
        dlight, ddark = "#c99d4a", "#7e5a1f"
    parts = [
        '<defs>'
        f'<linearGradient id="{{id}}ring" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{g[0]}"/>'
        f'<stop offset="0.5" stop-color="{g[1]}"/><stop offset="1" stop-color="{g[2]}"/></linearGradient>'
        '<radialGradient id="{id}core" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#fffdf4"/>'
        '<stop offset="0.35" stop-color="#fff3cc" stop-opacity="0.95"/><stop offset="1" stop-color="#f6dc9a" stop-opacity="0"/></radialGradient>'
        '</defs>',
        ring_segments(radius=54, width=17, gap_deg=24, cut=7),
    ]
    for a in (45, 135, 225, 315):
        parts.append(arm(a, tip=74, side=11, spread=45, light=dlight, dark=ddark))
    for a in (0, 90, 180, 270):
        parts.append(arm(a, tip=96, side=13, spread=45, light=light, dark=dark))
    parts.append('<circle cx="100" cy="100" r="22" fill="url(#{id}core)"/>')
    return "".join(parts)

if __name__ == "__main__":
    theme = sys.argv[1] if len(sys.argv) > 1 else "dark"
    print(mark(theme).replace("{id}", sys.argv[2] if len(sys.argv) > 2 else "cmp-"))
