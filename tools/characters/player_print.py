# Original tropical shirt print for the player (bold hibiscus and palm fronds on deep teal).
# Seamless tile, drawn procedurally (no source artwork). Needs Python 3 + Pillow.
#   python3 player_print.py <out.png> [size=1024]
# One tile spans PRINT_TILE_M metres of fabric (player.py samples it by body position).
import math, random, sys
from PIL import Image, ImageDraw

out = sys.argv[1]
S = int(sys.argv[2]) if len(sys.argv) > 2 else 1024
SS = 2  # supersampling
N = S * SS
BG = (14, 74, 107)
random.seed(7)
im = Image.new('RGB', (N, N), BG)
d = ImageDraw.Draw(im)


def wrap(fn, *a):
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            fn(dx * N, dy * N, *a)


def P(x, y, ox, oy):
    return (x * N + ox, y * N + oy)


def frond(ox, oy, b, c, t, g1, g2, lmax):
    pts = []
    for i in range(41):
        s = i / 40
        x = (1 - s) ** 2 * b[0] + 2 * (1 - s) * s * c[0] + s * s * t[0]
        y = (1 - s) ** 2 * b[1] + 2 * (1 - s) * s * c[1] + s * s * t[1]
        pts.append((x, y))
    for i in range(3, 40):
        s = i / 40
        x, y = pts[i]
        tx, ty = pts[i + 1][0] - pts[i - 1][0], pts[i + 1][1] - pts[i - 1][1]
        tl = math.hypot(tx, ty) or 1
        tx, ty = tx / tl, ty / tl
        L = lmax * math.sin(math.pi * (0.12 + 0.8 * s)) ** 0.7
        for side in (-1, 1):
            a = math.radians(52) * side
            dx_, dy_ = tx * math.cos(a) - ty * math.sin(a), tx * math.sin(a) + ty * math.cos(a)
            nx, ny = -dy_, dx_
            w = 0.16 * L
            tip = (x + dx_ * L, y + dy_ * L)
            mid = (x + dx_ * L * 0.45, y + dy_ * L * 0.45)
            poly = [P(x, y, ox, oy), P(mid[0] + nx * w, mid[1] + ny * w, ox, oy), P(*tip, ox, oy), P(mid[0] - nx * w, mid[1] - ny * w, ox, oy)]
            d.polygon(poly, fill=g1 if (i + (side > 0)) % 2 else g2)
            d.line([P(x, y, ox, oy), P(*tip, ox, oy)], fill=(120, 190, 110), width=max(1, SS))
    d.line([P(x, y, ox, oy) for x, y in pts], fill=(150, 200, 120), width=3 * SS)


def hibiscus(ox, oy, cx, cy, R, rot, main, edge, throat, vein):
    for k in range(5):
        a0 = rot + k * 2 * math.pi / 5
        poly = [P(cx, cy, ox, oy)]
        for j in range(33):
            u = j / 32
            b = a0 + (u - 0.5) * math.radians(84)
            r = R * (0.22 + 0.78 * math.sin(math.pi * u) ** 0.32) * (1 + 0.035 * math.sin(9 * math.pi * u))
            poly.append(P(cx + r * math.cos(b), cy + r * math.sin(b), ox, oy))
        d.polygon(poly, fill=main, outline=edge, width=2 * SS)
        for v in (-0.12, 0, 0.12):
            b = a0 + v
            d.line([P(cx, cy, ox, oy), P(cx + 0.78 * R * math.cos(b), cy + 0.78 * R * math.sin(b), ox, oy)], fill=vein, width=SS)
    rt = 0.3 * R
    d.ellipse([P(cx - rt, cy - rt, ox, oy), P(cx + rt, cy + rt, ox, oy)], fill=throat)
    a = rot + 0.4
    tip = (cx + 0.95 * R * math.cos(a), cy + 0.95 * R * math.sin(a))
    d.line([P(cx, cy, ox, oy), P(*tip, ox, oy)], fill=(250, 226, 150), width=3 * SS)
    for m in range(6):
        q = (tip[0] + 0.07 * R * math.cos(m), tip[1] + 0.07 * R * math.sin(m))
        rr = 0.035 * R
        d.ellipse([P(q[0] - rr, q[1] - rr, ox, oy), P(q[0] + rr, q[1] + rr, ox, oy)], fill=(255, 205, 40))


G1, G2 = (38, 140, 78), (24, 104, 60)
for b, c, t in [((0.02, 0.08), (0.2, 0.05), (0.46, 0.4)), ((0.58, 0.02), (0.9, 0.08), (0.96, 0.42)),
                ((0.32, 0.5), (0.1, 0.62), (0.04, 0.97)), ((0.62, 0.55), (0.78, 0.8), (0.52, 1.02))]:
    wrap(frond, b, c, t, G1, G2, 0.11)
RED = ((226, 52, 48), (150, 22, 34), (120, 10, 40), (255, 150, 120))
GOLD = ((246, 168, 48), (190, 96, 20), (200, 40, 40), (255, 220, 150))
CREAM = ((248, 236, 214), (200, 170, 140), (210, 60, 70), (255, 255, 255))
for (cx, cy, R, rot, pal) in [(0.2, 0.3, 0.13, 0.3, RED), (0.72, 0.64, 0.14, 1.1, RED), (0.52, 0.12, 0.08, 2.0, GOLD),
                              (0.9, 0.2, 0.075, 0.7, CREAM), (0.3, 0.8, 0.09, 2.6, GOLD), (0.08, 0.6, 0.06, 1.7, CREAM)]:
    wrap(hibiscus, cx, cy, R, rot, *pal)
im.resize((S, S), Image.LANCZOS).save(out)
print('PRINT', out, S)
