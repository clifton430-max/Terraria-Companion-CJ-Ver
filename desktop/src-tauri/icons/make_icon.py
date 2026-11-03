# Original pixel-art app icon: a glowing green sword over a grassy hill under a night sky.
import zlib, struct, random, sys
N = 32
hexc = lambda h: tuple(int(h[i:i+2], 16) for i in (1, 3, 5)) + (255,)
img = [[(0, 0, 0, 0)] * N for _ in range(N)]
rnd = random.Random(7)

def put(x, y, c):
    if 0 <= x < N and 0 <= y < N: img[y][x] = hexc(c) if isinstance(c, str) else c

# Rounded-square mask (pixel-stepped corners).
R = 6
def inside(x, y):
    for cx, cy in ((R, R), (N - 1 - R, R), (R, N - 1 - R), (N - 1 - R, N - 1 - R)):
        if (x < R and y < R and cx == R and cy == R) or (x > N-1-R and y < R and cx == N-1-R and cy == R) \
           or (x < R and y > N-1-R and cx == R and cy == N-1-R) or (x > N-1-R and y > N-1-R and cx == N-1-R and cy == N-1-R):
            return (x - cx) ** 2 + (y - cy) ** 2 <= R * R + 2
    return True

sky = ["#120f2e", "#1a1640", "#241d52", "#2f2563", "#3b2e73", "#4a3782"]
for y in range(N):
    for x in range(N):
        if not inside(x, y): continue
        band = min(len(sky) - 1, (y * len(sky)) // 22)
        put(x, y, sky[band])
# Stars and a crescent moon.
for (x, y, c) in [(4, 9, "#9fb4ff"), (13, 3, "#fff7c2"), (19, 6, "#fff7c2"), (28, 12, "#9fb4ff"), (24, 2, "#9fb4ff"), (15, 11, "#fff7c2"), (3, 15, "#fff7c2"), (29, 5, "#fff7c2")]:
    put(x, y, c)
for y in range(2, 11):
    for x in range(2, 11):
        if (x - 6) ** 2 + (y - 6) ** 2 <= 10 and (x - 7.8) ** 2 + (y - 4.8) ** 2 > 7:
            put(x, y, "#f4ecc2")
put(4, 7, "#d9cf9e"); put(5, 9, "#d9cf9e")

# Rolling hill: grass and dirt.
hill = [23, 23, 22, 22, 22, 21, 21, 21, 21, 22, 22, 22, 23, 23, 23, 22, 22, 21, 21, 21, 20, 20, 20, 21, 21, 22, 22, 23, 23, 23, 24, 24]
for x in range(N):
    top = hill[x]
    for y in range(top, N):
        if not inside(x, y): continue
        if y == top: c = "#7be05a"
        elif y == top + 1: c = "#4fae3e"
        else:
            c = "#8a5a3a" if rnd.random() > 0.18 else ("#6b4329" if rnd.random() > 0.3 else "#80808f")
        put(x, y, c)
    if rnd.random() < 0.35 and inside(x, top - 1): put(x, top - 1, "#5ec74a")

# Glow behind the blade (blend toward green).
def blend(c, g, a):
    return tuple(int(c[i] * (1 - a) + g[i] * a) for i in range(3)) + (255,)
G = hexc("#7dff8a")
C0 = 31  # blade core cells satisfy x + y = C0
for y in range(N):
    for x in range(N):
        if img[y][x][3] == 0: continue
        d = abs(x + y - C0)
        if 7 <= x <= 28 and 2 <= y <= 24 and d <= 4 and x - y > -6:
            img[y][x] = blend(img[y][x], G, 0.32 if d >= 3 else 0.5)

# Blade from (10,21) to the tip at (27,4).
for x in range(11, 28):
    y = C0 - x
    put(x + 1, y + 1, "#0e2a12") if x < 26 else None   # outline (lower-right side)
    put(x - 1, y - 1, "#0e2a12") if x > 11 else None   # outline (upper-left side)
    put(x, y, "#f0ffd8")                                # bright core
    if x < 26: put(x + 1, y, "#5fe06a"); put(x, y + 1, "#36a845")
    if x > 11: put(x - 1, y, "#9cff80"); put(x, y - 1, "#9cff80")
put(28, 3, "#0e2a12"); put(27, 4, "#f0ffd8"); put(28, 4, "#0e2a12"); put(27, 3, "#0e2a12")
# Crossguard (perpendicular to the blade, two cells thick), gold with a red gem.
guard = [(10 + k, 21 + k) for k in range(-3, 4)] + [(11 + k, 21 + k) for k in range(-3, 3)]
for (x, y) in guard:
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        if (x + dx, y + dy) not in guard: put(x + dx, y + dy, "#2a1606")
for (x, y) in guard:
    put(x, y, "#ffe07a" if (x + y) % 2 == 0 else "#d99a2a")
put(10, 21, "#ff4d6a"); put(11, 21, "#b0203a")
# Grip (two cells thick, wrapped) and pommel.
grip = [(9 - i, 22 + i) for i in range(4)] + [(10 - i, 22 + i) for i in range(4)]
for (x, y) in grip:
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        if (x + dx, y + dy) not in grip and (x + dx, y + dy) not in guard: put(x + dx, y + dy, "#1e0f04")
for i, (x, y) in enumerate(grip):
    put(x, y, "#8a5530" if (x + y + i) % 2 == 0 else "#5a341c")
for (x, y) in [(5, 26), (6, 26), (5, 27)]:
    put(x, y, "#ffe07a")
put(4, 27, "#1e0f04"); put(4, 26, "#1e0f04"); put(5, 28, "#1e0f04"); put(6, 27, "#d99a2a")

# Sparkles.
for (x, y) in [(22, 4), (29, 9), (17, 8), (25, 13)]:
    put(x, y, "#e8ffe0")

# Dark outline around the rounded square, plus a top highlight.
out = [row[:] for row in img]
for y in range(N):
    for x in range(N):
        if img[y][x][3] == 0: continue
        edge = any(not (0 <= x + dx < N and 0 <= y + dy < N) or img[y + dy][x + dx][3] == 0 for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))
        if edge: out[y][x] = hexc("#07061a")
img = out

def write(path, scale, margin):
    size = N * scale + margin * 2
    rows = []
    for py in range(size):
        row = bytearray([0])
        for px in range(size):
            x, y = (px - margin) // scale, (py - margin) // scale
            row += bytes(img[y][x]) if 0 <= x < N and 0 <= y < N and px >= margin and py >= margin else bytes(4)
        rows.append(bytes(row))
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(b''.join(rows), 9)) + chunk(b'IEND', b'')
    open(path, 'wb').write(png)

write(sys.argv[1], 26, 96)        # 1024×1024 with macOS-style margin
write(sys.argv[2], 8, 0)          # preview
