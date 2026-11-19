"""Beach props for the Tidewater family beach, built procedurally in Blender 5 (headless).

Run:
  blender -b --factory-startup \
    --python tools/beach/props_build.py -- public/models/beach [--sheet DIR]

Writes one GLB per prop plus manifest.json into the output folder. Y up, +Z front, metres,
origin at the bottom centre unless the manifest says otherwise.

Prints and two-tone parts are material splits (a flat baseColorFactor per material). The
engine's loadModel (src/rally/VehicleModel.js) reads baseColorFactor, roughness, metalness and
emissive, one mesh per primitive, and ignores baseColorTexture, so no textures are used.
With --sheet DIR it also renders proof images (Eevee) into DIR.
"""
import bpy, bmesh, math, os, sys, json
from mathutils import Vector, Matrix

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = os.path.abspath(ARGS[0] if ARGS and not ARGS[0].startswith('--') else 'public/models/beach')
SHEET = ARGS[ARGS.index('--sheet') + 1] if '--sheet' in ARGS else None
TAU = math.tau
# Geometry is authored Y up (glTF axes) and turned Z up for Blender at the end; the exporter
# (export_yup) turns it back, so authored coordinates are exactly the GLB coordinates.
YUP = Matrix.Rotation(math.pi / 2, 4, 'X')
YUP_INV = YUP.inverted()
BUDGET = {'towel': 800, 'umbrella': 2500, 'sunnies': 600, 'esky': 3000}  # the esky is a hero prop: hinges, latch, cup holders, scuffs


def lin(c):
	return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def material(name, srgb, rough, metal=0.0, double=False):
	m = bpy.data.materials.get(name)
	if m:
		return m
	m = bpy.data.materials.new(name)
	try:
		m.use_nodes = True
	except Exception:
		pass
	rgba = (*[lin(c) for c in srgb], 1.0)
	nt = m.node_tree
	if nt is not None:
		bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
		if bsdf is None:
			out = next((n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'), None) or nt.nodes.new('ShaderNodeOutputMaterial')
			bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
			nt.links.new(bsdf.outputs[0], out.inputs[0])
		bsdf.inputs['Base Color'].default_value = rgba
		bsdf.inputs['Roughness'].default_value = rough
		bsdf.inputs['Metallic'].default_value = metal
	else:
		print('WARN no node tree for', name)
	m.diffuse_color = rgba
	m.roughness = rough
	m.metallic = metal
	m.use_backface_culling = not double  # glTF doubleSided follows this flag
	return m


class Prop:
	def __init__(self, name, mats, origin, ground=True, sharp=40):
		self.name, self.mats, self.origin, self.ground, self.sharp = name, mats, origin, ground, sharp
		self.bm = bmesh.new()

	def vert(self, p):
		return self.bm.verts.new(Vector(p))

	def face(self, vs, mi=0, smooth=True):
		f = self.bm.faces.new(vs)
		f.material_index = mi
		f.smooth = smooth
		return f


def smooth01(t):
	t = max(0.0, min(1.0, t))
	return t * t * (3 - 2 * t)


def interp(table, x):
	t = sorted(table)
	if x <= t[0][0]:
		return t[0][1]
	if x >= t[-1][0]:
		return t[-1][1]
	for (x0, v0), (x1, v1) in zip(t, t[1:]):
		if x0 <= x <= x1:
			return v0 + (v1 - v0) * (x - x0) / (x1 - x0)


def linspace(a, b, n):
	return [a + (b - a) * k / n for k in range(n + 1)]


def xform(P, faces, M):
	vs = list({v for f in faces for v in f.verts})
	bmesh.ops.transform(P.bm, matrix=M, verts=vs)


def loft(P, rings, mat=0, smooth=True):
	"""Faces between successive rings (a one-vert ring is a pole). Rings that run upward with
	points going from +X toward +Z get outward normals."""
	faces = []
	for j in range(len(rings) - 1):
		A, B = rings[j], rings[j + 1]
		m = mat(j) if callable(mat) else mat
		n = max(len(A), len(B))
		for i in range(n):
			i1 = (i + 1) % n
			if len(A) == 1:
				vs = [A[0], B[i], B[i1]]
			elif len(B) == 1:
				vs = [A[i], B[0], A[i1]]
			else:
				vs = [A[i], B[i], B[i1], A[i1]]
			faces.append(P.face(vs, m, smooth))
	return faces


def lathe(P, prof, n, mat=0, warp=None, smooth=True, recalc=True):
	rings = []
	for j, (r, y) in enumerate(prof):
		if r < 1e-7:
			rings.append([P.vert(warp(0.0, 0.0, y, j) if warp else (0.0, y, 0.0))])
			continue
		ring = []
		for i in range(n):
			t = TAU * i / n
			ring.append(P.vert(warp(t, r, y, j) if warp else (r * math.cos(t), y, r * math.sin(t))))
		rings.append(ring)
	faces = loft(P, rings, mat, smooth)
	if recalc:
		bmesh.ops.recalc_face_normals(P.bm, faces=faces)
	return faces


def tube(P, pts, r, sides=6, mi=0, loop=False, caps=True, up=None, rx=None, smooth=True):
	"""Sweep a section along a polyline. With 4 sides the section is a rectangle, r thick along
	N and rx wide along B. up (vector or callable of the point) fixes N; otherwise N is carried
	along the path."""
	pts = [Vector(p) for p in pts]
	n = len(pts)
	rx = rx or r
	rings, prevN = [], None
	for i, p in enumerate(pts):
		t = (pts[(i + 1) % n] - pts[i - 1]) if loop else (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)])
		t.normalize()
		if up is not None:
			u = Vector(up(p) if callable(up) else up)
			N = u - t * u.dot(t)
		elif prevN is None:
			a = Vector((0, 1, 0)) if abs(t.y) < 0.9 else Vector((1, 0, 0))
			N = a - t * a.dot(t)
		else:
			N = prevN - t * prevN.dot(t)
		N.normalize()
		prevN = N
		B = t.cross(N)
		ring = []
		for k in range(sides):
			if sides == 4:
				a, s = math.pi / 4 + k * math.pi / 2, math.sqrt(2)
			else:
				a, s = TAU * k / sides, 1.0
			ring.append(P.vert(p + N * (math.cos(a) * r * s) + B * (math.sin(a) * rx * s)))
		rings.append(ring)
	faces = []
	for i in range(n if loop else n - 1):
		A, C = rings[i], rings[(i + 1) % n]
		for k in range(sides):
			k1 = (k + 1) % sides
			faces.append(P.face([A[k], A[k1], C[k1], C[k]], mi, smooth))
	if caps and not loop:
		faces.append(P.face(rings[0][::-1], mi, False))
		faces.append(P.face(rings[-1], mi, False))
	bmesh.ops.recalc_face_normals(P.bm, faces=faces)
	return faces


def box(P, center, size, bevel=0.0, segs=2, mi=0):
	before = set(P.bm.faces)
	M = Matrix.Translation(center) @ Matrix.Diagonal((size[0], size[1], size[2], 1.0))
	vs = bmesh.ops.create_cube(P.bm, size=1.0, matrix=M)['verts']
	if bevel > 0:
		edges = list({e for v in vs for e in v.link_edges})
		bmesh.ops.bevel(P.bm, geom=edges, offset=bevel, segments=segs, profile=0.5, affect='EDGES', clamp_overlap=True)
	faces = [f for f in P.bm.faces if f not in before]
	for f in faces:
		f.material_index = mi
		f.smooth = True
	return faces


# ------------------------------------------------------------------ towels
def towel(name, xs, zs, mats, mat_of, seed, snap=None):
	P = Prop(name, mats, 'bottom centre on the sand; 1.6 m long along Z, 0.8 m wide along X; print faces +Y', sharp=70)
	ph = [seed * 1.37 + k * 2.11 for k in range(8)]
	nx, nz = len(xs), len(zs)
	g = []
	for i, x0 in enumerate(xs):
		col = []
		for j, z0 in enumerate(zs):
			x, z = snap(x0, z0) if snap else (x0, z0)
			h = 0.006
			h += 0.007 * (0.5 + 0.5 * math.sin(2.6 * z + 2.1 * x + ph[0])) * (0.5 + 0.5 * math.sin(4.7 * x - 1.3 * z + ph[1]))
			h += 0.0025 * math.sin(9.1 * z + 6.3 * x + ph[2])
			# two soft fold ridges wandering across the towel
			u = math.cos(ph[3]) * x + math.sin(ph[3]) * z - 0.3 * math.sin(ph[4])
			along = math.sin(ph[3]) * x - math.cos(ph[3]) * z
			h += 0.028 * math.exp(-u * u / 0.005) * (0.3 + 0.7 * (0.5 + 0.5 * math.sin(2.2 * along + ph[5])))
			u2 = math.cos(ph[6]) * x - math.sin(ph[6]) * z + 0.35 * math.sin(ph[7])
			h += 0.018 * math.exp(-u2 * u2 / 0.003) * (0.5 + 0.5 * math.sin(3.1 * z + ph[4]))
			ex, ez = i in (0, nx - 1), j in (0, nz - 1)
			if ex or ez:  # hem rolls under: edge down on the sand, pulled in and slightly wavy
				h = 0.0012
				if ex:
					x -= math.copysign(0.005, x) - 0.004 * math.sin(17 * z + ph[1])
				if ez:
					z -= math.copysign(0.005, z) - 0.004 * math.sin(19 * x + ph[2])
			elif i in (1, nx - 2) or j in (1, nz - 2):
				h += 0.0035  # thick rolled hem just inside the edge
			# one corner lifted and curling over, as if kicked or caught by the breeze
			dc = math.hypot(x - (0.4 if seed % 2 else -0.4), z - (0.8 if seed in (1, 4) else -0.8))
			if dc < 0.22:
				h += 0.05 * (1 - dc / 0.22) ** 2
			col.append(P.vert((x, max(h, 0.0012), z)))
		g.append(col)
	for i in range(nx - 1):
		for j in range(nz - 1):
			vs = [g[i][j], g[i][j + 1], g[i + 1][j + 1], g[i + 1][j]]
			cx = sum(v.co.x for v in vs) / 4
			cz = sum(v.co.z for v in vs) / 4
			P.face(vs, mat_of(cx, cz), True)
	return P


def build_towels():
	cream = material('towel_cream', (0.93, 0.89, 0.8), 0.92, double=True)
	XS, ZS = linspace(-0.4, 0.4, 12), linspace(-0.8, 0.8, 32)
	navy = material('towel_navy', (0.13, 0.22, 0.4), 0.92, double=True)
	out = [towel('towel_a', XS, ZS, [navy, cream], lambda x, z: int(math.floor((z + 0.8) / 0.1 + 1e-6)) % 2, 1)]

	sky = material('towel_sunset_sky', (0.91, 0.47, 0.22), 0.92, double=True)
	sun = material('towel_sunset_gold', (0.97, 0.78, 0.36), 0.92, double=True)
	sea = material('towel_sunset_sea', (0.15, 0.17, 0.32), 0.92, double=True)
	Z0, R = 0.15, 0.22

	def snap(x, z):  # pull grid points near the sun's rim onto it so the disc edge is round
		if z > Z0 + 1e-6:
			d = math.hypot(x, z - Z0)
			if d > 1e-6 and abs(d - R) < 0.024:
				return x * R / d, Z0 + (z - Z0) * R / d
		return x, z

	def sunset(x, z):
		if z > Z0:
			if math.hypot(x, z - Z0) < R:
				return 1
			if (0.6 < z < 0.65 and abs(x) < 0.3) or (0.7 < z < 0.75 and abs(x) < 0.18):
				return 1
			return 0
		k = int((Z0 - z) / 0.05)  # broken shimmer on the water, fading away from the horizon
		widths = {0: 0.3, 2: 0.24, 4: 0.17, 6: 0.1, 8: 0.05}
		cell = int(math.floor((x + 0.4) / (0.8 / 12)))
		return 1 if k in widths and abs(x) < widths[k] and (cell + k // 2) % 3 != 0 else 2
	out.append(towel('towel_b', XS, ZS, [sky, sun, sea], sunset, 2, snap))

	teal = material('towel_teal', (0.17, 0.5, 0.52), 0.92, double=True)
	XC = [-0.4] + linspace(-0.34, 0.34, 10) + [0.4]
	ZC = [-0.8] + linspace(-0.74, 0.74, 28) + [0.8]
	out.append(towel('towel_c', XC, ZC, [teal, cream], lambda x, z: 1 if abs(x) > 0.34 or abs(z) > 0.74 else 0, 3))

	blue = material('towel_check_blue', (0.36, 0.52, 0.74), 0.92, double=True)
	white = material('towel_check_white', (0.95, 0.93, 0.87), 0.92, double=True)
	out.append(towel('towel_d', XS, ZS, [blue, white],
		lambda x, z: (int(math.floor((x + 0.4) / 0.2 + 1e-6)) + int(math.floor((z + 0.8) / 0.2 + 1e-6))) % 2, 4))
	return out


# ------------------------------------------------------------------ umbrellas
def umbrella(name, colA, colB):
	mA = material(name + '_canopy_a', colA, 0.85, double=True)
	mB = material(name + '_canopy_b', colB, 0.85, double=True)
	mM = material('umbrella_metal', (0.8, 0.81, 0.82), 0.35, metal=1.0)
	P = Prop(name, [mA, mB, mM], 'pole foot at the sand line (sink it about 0.2 m); canopy tilts 16 deg toward +Z')
	lathe(P, [(0, 0.0), (0.016, 0.0), (0.016, 1.24), (0, 1.24)], 12, 2)
	lathe(P, [(0, 1.22), (0.022, 1.22), (0.024, 1.235), (0.024, 1.325), (0.021, 1.345), (0, 1.345)], 12, 2)
	box(P, (0.028, 1.28, 0.0), (0.012, 0.022, 0.018), 0.003, 1, 2)  # tilt button
	TILT, JY, AP, RISE, R = math.radians(16), 1.30, 0.84, 0.36, 1.0
	M = Matrix.Translation((0, JY, 0)) @ Matrix.Rotation(TILT, 4, 'X')
	local = lathe(P, [(0, 0.0), (0.0135, 0.0), (0.0135, AP - 0.06), (0, AP - 0.06)], 12, 2)

	def rib(k, r):
		a, f = TAU * k / 8, r / R
		return Vector((r * math.cos(a), AP - RISE * (0.35 * f + 0.65 * f * f), r * math.sin(a)))
	COLS = 32
	rings = [[P.vert((0, AP + 0.004, 0))]]
	for r in [0.05, 0.16, 0.3, 0.45, 0.6, 0.74, 0.87, 1.0]:
		ring = []
		for c in range(COLS):
			k, s = c // 4, (c % 4) / 4
			p = rib(k, r).lerp(rib(k + 1, r), s)
			p.y -= 0.016 * math.sin(math.pi * s) * (r / R) ** 0.8  # fabric sags between ribs
			ring.append(P.vert(p))
		rings.append(ring)
	canopy = loft(P, rings, 0)
	for idx, f in enumerate(canopy):
		f.material_index = ((idx % COLS) // 4) % 2
	bmesh.ops.reverse_faces(P.bm, faces=canopy)
	# scalloped valance, two lobes per panel
	FC, tops, bots, fringe = 12, [], [], []
	for c in range(8 * FC):
		k, s = c // FC, (c % FC) / FC
		p = rib(k, R).lerp(rib(k + 1, R), s)
		p.y -= 0.016 * math.sin(math.pi * s)
		radial = Vector((p.x, 0, p.z)).normalized()
		depth = 0.05 + 0.035 * math.sin(math.pi * ((2 * s) % 1.0))
		tops.append(P.vert(p - radial * 0.002))
		bots.append(P.vert(p - radial * 0.002 + (Vector((0, -1, 0)) + radial * 0.2).normalized() * depth))
	for c in range(8 * FC):
		c1 = (c + 1) % (8 * FC)
		fringe.append(P.face([tops[c], tops[c1], bots[c1], bots[c]], (c // FC) % 2, True))
	for k in range(8):
		local += tube(P, [rib(k, r) - Vector((0, 0.011, 0)) for r in [0.06, 0.2, 0.4, 0.6, 0.8, 0.99]], 0.0045, 4, 2)
		local += tube(P, [Vector((0, AP - 0.5, 0)), rib(k, 0.42) - Vector((0, 0.016, 0))], 0.0035, 4, 2)
	local += lathe(P, [(0, AP - 0.54), (0.021, AP - 0.54), (0.021, AP - 0.46), (0, AP - 0.46)], 10, 2)  # runner
	local += lathe(P, [(0, AP - 0.075), (0.03, AP - 0.075), (0.032, AP - 0.012), (0, AP - 0.012)], 10, 2)  # hub
	local += lathe(P, [(0, AP - 0.002), (0.021, AP - 0.002), (0.02, AP + 0.022), (0.012, AP + 0.04), (0, AP + 0.046)], 10, 2)  # top cap
	xform(P, local + canopy + fringe, M)
	return P


# ------------------------------------------------------------------ esky
def cyl(P, c, r, h, mi, axis='X', n=10):
	f = lathe(P, [(0, -h / 2), (r, -h / 2), (r, h / 2), (0, h / 2)], n, mi, smooth=False)
	R = {'X': Matrix.Rotation(-math.pi / 2, 4, 'Z'), 'Y': Matrix.Identity(4), 'Z': Matrix.Rotation(math.pi / 2, 4, 'X')}[axis]
	xform(P, f, Matrix.Translation(c) @ R)
	return f


def esky():
	import random
	rng = random.Random(11)
	mW = material('esky_white', (0.92, 0.92, 0.89), 0.45)
	mL = material('esky_blue', (0.14, 0.34, 0.62), 0.4)
	mD = material('esky_blue_dark', (0.07, 0.19, 0.38), 0.55)
	mG = material('esky_grey', (0.2, 0.21, 0.22), 0.7)
	mS = material('esky_scuff', (0.72, 0.69, 0.6), 0.85)
	mLS = material('esky_blue_scuff', (0.4, 0.52, 0.66), 0.7)
	P = Prop('esky', [mW, mL, mD, mG, mS, mLS], 'bottom centre; 0.55 m long along X, front faces +Z; handle folded back over the lid')
	body = box(P, (0, 0.15, 0), (0.55, 0.30, 0.35), 0.028, 3, 0)
	for v in {v for f in body for v in f.verts}:
		t = 1 - v.co.y / 0.30  # a little narrower at the base
		v.co.x *= 1 - 0.05 * t
		v.co.z *= 1 - 0.05 * t
	def zs(y): return 0.175 * (1 - 0.05 * (1 - y / 0.30))
	def xs(y): return 0.275 * (1 - 0.05 * (1 - y / 0.30))
	box(P, (0, 0.287, 0), (0.556, 0.018, 0.356), 0.007, 2, 0)                 # the moulded band under the lid
	for sx in (-1, 1):                                                        # the hand-holds moulded into the ends
		box(P, (sx * (xs(0.24) + 0.001), 0.24, 0), (0.004, 0.024, 0.13), 0.0, 1, 3)
		box(P, (sx * (xs(0.255) + 0.004), 0.255, 0), (0.008, 0.006, 0.15), 0.002, 1, 0)
	# the lid: a raised rim round a recessed panel, two cup holders at one end, scuffed on its high spots
	box(P, (0, 0.335, 0), (0.565, 0.07, 0.365), 0.022, 3, 1)
	box(P, (0, 0.3702, 0), (0.47, 0.002, 0.27), 0.0, 1, 2)
	for sz in (-1, 1):
		box(P, (0, 0.376, sz * 0.1475), (0.52, 0.012, 0.025), 0.005, 2, 1)
		box(P, (sz * 0.2475, 0.376, 0), (0.025, 0.012, 0.27), 0.005, 2, 1)
		f = lathe(P, [(0.0, 0.3722), (0.036, 0.3722), (0.036, 0.374), (0.042, 0.3765), (0.046, 0.3716)], 16, lambda j: 2 if j < 2 else 1, recalc=False)
		xform(P, f, Matrix.Translation((0.165, 0, sz * 0.066)))
		for q in f:  # an open cup: floor and lip face up, the wall faces the axis
			q.normal_update(); c = q.calc_center_median()
			d = q.normal.y if abs(q.normal.y) > 0.3 else q.normal.x * (0.165 - c.x) + q.normal.z * (sz * 0.066 - c.z)
			if d < 0: q.normal_flip()
	# the hinges along the back: the lid's knuckles either side of the body's, a steel pin through them
	for sx in (-1, 1):
		for dx, mi in ((-0.024, 1), (0.0, 0), (0.024, 1)):
			cyl(P, (sx * 0.17 + dx, 0.303, -0.19), 0.011, 0.022, mi, 'X')
		cyl(P, (sx * 0.17, 0.303, -0.19), 0.004, 0.078, 3, 'X', 8)
	# the latch at the front: the lid's hasp over the body's catch
	box(P, (0, 0.268, zs(0.268) + 0.007), (0.075, 0.02, 0.014), 0.003, 1, 0)
	box(P, (0, 0.29, 0.1945), (0.062, 0.05, 0.012), 0.004, 2, 1)
	box(P, (0, 0.278, 0.2015), (0.04, 0.012, 0.003), 0.001, 1, 2)
	# feet, the drain plug and the badge
	for sx in (-1, 1):
		for sz in (-1, 1): box(P, (sx * 0.22, -0.006, sz * 0.13), (0.06, 0.012, 0.04), 0.003, 1, 3)
	f = lathe(P, [(0, 0), (0.016, 0), (0.016, 0.012), (0.012, 0.018), (0, 0.018)], 10, 3)
	xform(P, f, Matrix.Translation((0.19, 0.045, zs(0.045) - 0.002)) @ Matrix.Rotation(math.pi / 2, 4, 'X'))
	box(P, (0.19, 0.045, zs(0.045) + 0.019), (0.022, 0.004, 0.004), 0.0, 1, 3)
	box(P, (-0.12, 0.175, zs(0.175) + 0.002), (0.17, 0.05, 0.004), 0.002, 1, 1)
	for dy, w in ((0.008, 0.12), (-0.01, 0.08)): box(P, (-0.12 - (0.12 - w) / 2, 0.175 + dy, zs(0.175) + 0.0045), (w, 0.009, 0.001), 0.0, 1, 0)
	# the swing handle, folded back over the lid, with its grip
	for sx in (-1, 1):
		f = lathe(P, [(0, -0.007), (0.017, -0.007), (0.017, 0.007), (0, 0.007)], 10, 0)
		xform(P, f, Matrix.Translation((sx * 0.29, 0.325, 0)) @ Matrix.Rotation(-math.pi / 2, 4, 'Z'))
	X, Y, Z = 0.298, 0.392, -0.122
	tube(P, [(-X, 0.325, 0), (-X, 0.352, -0.05), (-X, 0.376, -0.094), (-X + 0.009, 0.389, -0.116), (-X + 0.035, Y, Z),
		(-0.1, Y + 0.002, Z - 0.002), (0.1, Y + 0.002, Z - 0.002), (X - 0.035, Y, Z), (X - 0.009, 0.389, -0.116),
		(X, 0.376, -0.094), (X, 0.352, -0.05), (X, 0.325, 0)], 0.0085, 6, 0)
	tube(P, [(-0.075, Y + 0.002, Z - 0.002), (0.075, Y + 0.002, Z - 0.002)], 0.0135, 8, 3)
	for x in (-0.05, -0.017, 0.017, 0.05): tube(P, [(x - 0.003, Y + 0.002, Z - 0.002), (x + 0.003, Y + 0.002, Z - 0.002)], 0.0148, 8, 3)
	# scuffs and sand: grey-beige marks low on the white, a dusting along the base, worn spots on the lid's rim
	for _ in range(14):
		y = rng.uniform(0.02, 0.2); w = rng.uniform(0.008, 0.04); h = rng.uniform(0.003, 0.01); sz = rng.choice((-1, 1))
		if rng.random() < 0.6: box(P, (rng.uniform(-0.23, 0.23), y, sz * (zs(y) + 0.0012)), (w, h, 0.001), 0.0, 1, 4)
		else: box(P, (sz * (xs(y) + 0.0012), y, rng.uniform(-0.13, 0.13)), (0.001, h, w), 0.0, 1, 4)
	for sz in (-1, 1): box(P, (0, 0.012, sz * (zs(0.012) + 0.0012)), (0.49, 0.014, 0.001), 0.0, 1, 4)
	for sx in (-1, 1): box(P, (sx * (xs(0.012) + 0.0012), 0.012, 0), (0.001, 0.014, 0.3), 0.0, 1, 4)
	for _ in range(9):
		sz = rng.choice((-1, 1)); x = rng.uniform(-0.25, 0.25)
		box(P, (x, 0.3825, sz * 0.1475 + rng.uniform(-0.008, 0.008)), (rng.uniform(0.01, 0.035), 0.001, rng.uniform(0.004, 0.012)), 0.0, 1, 5)
	return P


# ------------------------------------------------------------------ beach bag
def beach_bag():
	mC = material('bag_canvas', (0.89, 0.84, 0.72), 0.92, double=True)
	mN = material('bag_navy', (0.14, 0.21, 0.36), 0.88, double=True)
	P = Prop('beach_bag', [mC, mN], 'bottom centre; 0.46 m wide along X, front faces +Z; handles up')
	H, N = 0.36, 28

	def dims(y):
		t = y / H
		return 0.19 + 0.04 * t, 0.082 - 0.03 * t ** 1.5 + 0.012 * math.sin(math.pi * t)

	def ring(y, inset=0.0):
		hw, hd = dims(y)
		hw -= inset
		hd -= inset
		pts = []
		for i in range(N):
			a = TAU * i / N
			c, s = math.cos(a), math.sin(a)
			w = 0.003 * math.sin(5 * a + 9 * y) * (y / H)  # canvas slump
			pts.append(P.vert((hw * math.copysign(abs(c) ** 0.5, c) * 0.95 * (1 + w), y, hd * math.copysign(abs(s) ** 0.5, s) * (1 + 2 * w))))
		return pts
	ys = [0.018, 0.05, 0.1, 0.14, 0.18, 0.22, 0.26, 0.3, 0.335, H]
	rings = [[P.vert((0, 0.0, 0))], ring(0.0, 0.014)] + [ring(y) for y in ys] + [ring(H - 0.022, 0.006)]
	navy_rows = {0, 1, 2, 5, 7}
	loft(P, rings, lambda j: 1 if j in navy_rows else 0)

	def zf(y, x, sgn):
		hw, hd = dims(y)
		q = min(0.999, abs(x) / (hw * 0.95)) ** 4
		return sgn * (hd * (1 - q) ** 0.25 + 0.0035)
	for sgn in (1, -1):
		pts = [(-0.085, y, zf(y, -0.085, sgn)) for y in (0.25, 0.3, H - 0.004)]
		for k in range(1, 18):
			t = k / 18
			pts.append((-0.085 * math.cos(math.pi * t), H + 0.2 * math.sin(math.pi * t), sgn * (dims(H)[1] + 0.012 + 0.03 * math.sin(math.pi * t))))
		pts += [(0.085, y, zf(y, 0.085, sgn)) for y in (H - 0.004, 0.3, 0.25)]
		tube(P, pts, 0.0022, 4, 1, up=(0, 0, 1), rx=0.012)
	return P


# ------------------------------------------------------------------ thongs
THONG_CP = [(0.0, -0.128), (0.03, -0.118), (0.038, -0.085), (0.034, -0.03), (0.041, 0.025), (0.047, 0.068), (0.04, 0.103),
	(0.02, 0.124), (-0.005, 0.131), (-0.03, 0.124), (-0.046, 0.1), (-0.05, 0.06), (-0.04, 0.005), (-0.033, -0.05),
	(-0.036, -0.095), (-0.026, -0.121)]


def catmull(pts, sub):
	out, n = [], len(pts)
	for i in range(n):
		p0, p1, p2, p3 = pts[i - 1], pts[i], pts[(i + 1) % n], pts[(i + 2) % n]
		for k in range(sub):
			t = k / sub
			t2, t3 = t * t, t * t * t
			out.append(tuple(0.5 * (2 * p1[d] + (-p0[d] + p2[d]) * t + (2 * p0[d] - 5 * p1[d] + 4 * p2[d] - p3[d]) * t2
				+ (-p0[d] + 3 * p1[d] - 3 * p2[d] + p3[d]) * t3) for d in range(2)))
	return out


def build_thong(P, sx):
	before = set(P.bm.faces)
	out = [(x * sx, z) for x, z in catmull(THONG_CP, 2)]
	B = [P.vert((x, 0.0, z)) for x, z in out]
	Mi = [P.vert((x, 0.011, z)) for x, z in out]
	T = [P.vert((x, 0.017, z)) for x, z in out]
	n = len(out)
	faces = [P.face(B[::-1], 1, False), P.face(T, 0, False)]
	bot, top = faces
	for i in range(n):
		i1 = (i + 1) % n
		faces.append(P.face([B[i], B[i1], Mi[i1], Mi[i]], 1, True))
		faces.append(P.face([Mi[i], Mi[i1], T[i1], T[i]], 0, True))
	bmesh.ops.recalc_face_normals(P.bm, faces=faces)
	bmesh.ops.bevel(P.bm, geom=list(top.edges), offset=0.0028, segments=2, profile=0.5, affect='EDGES', clamp_overlap=True)
	bmesh.ops.bevel(P.bm, geom=list(bot.edges), offset=0.002, segments=1, profile=0.5, affect='EDGES', clamp_overlap=True)
	for f in P.bm.faces:
		if f not in before:
			f.material_index = 0 if f.calc_center_median().y > 0.011 else 1
	px, pz = -0.021 * sx, 0.084  # toe post between the big and second toe
	post = lathe(P, [(0, 0.012), (0.0048, 0.012), (0.0048, 0.029), (0.0035, 0.033), (0, 0.034)], 8, 0)
	xform(P, post, Matrix.Translation((px, 0, pz)))
	for ax, az in ((0.034 * sx, -0.01), (-0.03 * sx, -0.016)):
		p0, p2 = Vector((px, 0.03, pz)), Vector((ax, 0.015, az))
		ctrl = (p0 + p2) / 2 + Vector((0, 0.045, 0))
		pts = [p0 * (1 - t) ** 2 + ctrl * 2 * t * (1 - t) + p2 * t * t for t in [k / 8 for k in range(9)]]
		side = Vector((math.copysign(0.6, ax - px), 0.8, 0)).normalized()
		tube(P, pts, 0.0022, 4, 0, up=side, rx=0.0085)
	return [f for f in P.bm.faces if f not in before]


def thongs():
	mT = material('thong_top', (0.16, 0.42, 0.52), 0.6)
	mW = material('thong_sole', (0.9, 0.9, 0.87), 0.7)
	P = Prop('thongs', [mT, mW], 'pair centre on the sand; toes toward +Z')
	for sx, x, z, rot in ((1, 0.068, 0.0, -6), (-1, -0.068, 0.025, 8)):
		part = build_thong(P, sx)
		xform(P, part, Matrix.Translation((x, 0, z)) @ Matrix.Rotation(math.radians(rot), 4, 'Y'))
	return P


# ------------------------------------------------------------------ cricket
def cricket_bat():
	mW = material('bat_willow', (0.87, 0.76, 0.56), 0.5)
	mG = material('bat_grip', (0.09, 0.1, 0.12), 0.8)
	P = Prop('cricket_bat', [mW, mG], 'top end of the handle; blade hangs down -Y, face toward +Z; hands grip y -0.03 to -0.24',
		ground=False)
	prof = [(0, -0.33), (0.0145, -0.33), (0.0145, -0.262), (0.0163, -0.256)]
	y, k = -0.25, 0
	while y < -0.02:  # tape wraps as shallow ridges
		prof.append((0.0172 if k % 2 == 0 else 0.0164, y))
		y += 0.0125
		k += 1
	prof += [(0.0168, -0.012), (0.0158, -0.004), (0.011, -0.0005), (0, 0.0)]
	lathe(P, prof, 10, lambda j: 1 if prof[j][1] >= -0.2565 else 0,
		warp=lambda t, r, y, j: (r * math.cos(t), y, 0.9 * r * math.sin(t)))
	ys = [-0.29, -0.305, -0.325, -0.345, -0.37, -0.41, -0.47, -0.54, -0.61, -0.68, -0.74, -0.79, -0.83, -0.85, -0.86]
	D = [(-0.29, 0.034), (-0.4, 0.054), (-0.66, 0.064), (-0.83, 0.05), (-0.86, 0.042)]
	E = [(-0.29, 0.03), (-0.45, 0.036), (-0.86, 0.04)]
	zf, rings = 0.02, []
	for y in ys:
		hw = (0.036 + 0.072 * smooth01((-0.29 - y) / 0.08)) / 2
		if y < -0.84:
			hw -= 0.004 if y > -0.855 else 0.009
		d, e = interp(D, y), interp(E, y)
		eb = zf - e - 0.002
		sp = min(zf - d, eb - 0.002)
		z4, z5 = eb + (sp - eb) * 0.72, eb + (sp - eb) * 0.96
		bx = hw - min(0.01, hw * 0.35)
		sec = [(hw - 0.004, zf), (hw, zf - 0.005), (hw, zf - e + 0.006), (bx, eb), (hw * 0.45, z4), (hw * 0.2, z5), (0, sp),
			(-hw * 0.2, z5), (-hw * 0.45, z4), (-bx, eb), (-hw, zf - e + 0.006), (-hw, zf - 0.005), (-hw + 0.004, zf), (0, zf + 0.0015)]
		rings.append([P.vert((x, y, z)) for x, z in sec])
	faces = loft(P, rings, 0)
	faces += [P.face(rings[0], 0, False), P.face(rings[-1][::-1], 0, False)]
	bmesh.ops.recalc_face_normals(P.bm, faces=faces)
	return P


def stumps():
	mW = material('stump_wood', (0.86, 0.75, 0.55), 0.5)
	P = Prop('stumps', [mW], 'foot of the middle stump at the sand line; bails on top; the batter stands on the +Z side')
	for x in (-0.0968, 0.0, 0.0968):
		f = lathe(P, [(0, 0), (0.0165, 0), (0.0175, 0.025), (0.0175, 0.69), (0.0166, 0.703), (0.012, 0.709), (0, 0.711)], 10, 0)
		xform(P, f, Matrix.Translation((x, 0, 0)))
	bail = [(0, -0.0548), (0.0034, -0.0545), (0.0037, -0.043), (0.0055, -0.041), (0.0066, -0.034), (0.0072, -0.012), (0.0061, -0.004),
		(0.0061, 0.004), (0.0072, 0.012), (0.0066, 0.034), (0.0055, 0.041), (0.0037, 0.043), (0.0034, 0.0545), (0, 0.0548)]
	for x in (-0.0484, 0.0484):
		f = lathe(P, bail, 8, 0)
		xform(P, f, Matrix.Translation((x, 0.7147, 0)) @ Matrix.Rotation(-math.pi / 2, 4, 'Z'))
	return P


def tennis_ball():
	mF = material('ball_felt', (0.8, 0.9, 0.22), 0.95)
	mS = material('ball_seam', (0.92, 0.93, 0.88), 0.6)
	P = Prop('tennis_ball', [mF, mS], 'bottom of the ball (centre is 0.0335 m up)')
	R = 0.0335
	prof = [(R * math.sin(math.pi * k / 11), R - R * math.cos(math.pi * k / 11)) for k in range(12)]
	prof[0], prof[-1] = (0, 0), (0, 2 * R)
	lathe(P, prof, 18, 0)
	k = 0.22
	a, c = 1 - k, 2 * math.sqrt(k * (1 - k))
	pts = []
	for i in range(56):
		t = TAU * i / 56
		v = Vector((a * math.cos(t) + k * math.cos(3 * t), c * math.sin(2 * t), a * math.sin(t) - k * math.sin(3 * t)))
		pts.append(v * (R * 0.992) + Vector((0, R, 0)))
	tube(P, pts, 0.0011, 4, 1, loop=True, up=lambda p: p - Vector((0, R, 0)), rx=0.0021)
	return P


def frisbee():
	m = material('frisbee_orange', (0.95, 0.48, 0.18), 0.4)
	P = Prop('frisbee', [m], 'bottom centre (rim on the sand), dome up')
	lathe(P, [(0, 0.0262), (0.06, 0.0258), (0.104, 0.0243), (0.12, 0.0215), (0.1255, 0.013), (0.1265, 0.004), (0.1295, 0.0),
		(0.1333, 0.0025), (0.1352, 0.011), (0.1338, 0.0195), (0.1285, 0.0262), (0.117, 0.0296), (0.1045, 0.0308), (0.1, 0.0317),
		(0.095, 0.0309), (0.07, 0.0312), (0.035, 0.0318), (0, 0.032)], 30, 0)
	return P


def book():
	import random
	rng = random.Random(5)
	mC = material('book_cover', (0.13, 0.42, 0.48), 0.55)
	mP = material('book_pages', (0.94, 0.91, 0.83), 0.9)
	mE = material('book_page_edge', (0.82, 0.78, 0.68), 0.95)
	mI = material('book_print', (0.45, 0.45, 0.47), 0.8)
	P = Prop('book', [mC, mP, mE, mI], 'bottom centre; paperback lying open face up, a few pages fanned up, spine along Z')
	TOP = [(0.0, 0.0055), (0.004, 0.0065), (0.012, 0.0122), (0.03, 0.0152), (0.07, 0.0154), (0.105, 0.0138), (0.122, 0.0112)]
	def yt(x): return interp(TOP, abs(x))
	for sx in (-1, 1):
		box(P, (sx * 0.064, 0.0006, 0), (0.126, 0.0012, 0.198), 0.0, 1, 0)       # the cover, open flat
		xsec = [(0.003, 0.0013)] + [(x, 0.0013) for x in (0.122,)] + [(x, yt(x)) for x in (0.122, 0.105, 0.085, 0.06, 0.04, 0.025, 0.014, 0.007, 0.003)]
		rings = []
		for z in (-0.095, 0.095):
			rings.append([P.vert((sx * x, y, z)) for x, y in xsec])
		n = len(xsec)
		faces = []
		for i in range(n):
			a, b = rings[0][i], rings[0][(i + 1) % n]; c, d = rings[1][(i + 1) % n], rings[1][i]
			mi = 2 if (i == 1) else 1                                              # the fore-edge in page-edge off-white
			faces.append(P.face([a, b, c, d], mi, i > 1))
		faces.append(P.face(rings[0], 2, False)); faces.append(P.face(rings[1], 2, False))   # head and tail page edges
		bmesh.ops.recalc_face_normals(P.bm, faces=faces)
		# lines of print, following the page's curve, with paragraph ends and a gap for a chapter break on one page
		for k in range(17):
			z = -0.08 + k * 0.01
			if sx < 0 and k in (3, 4): continue
			x1 = 0.108 if rng.random() > 0.18 else rng.uniform(0.04, 0.09)
			xs_ = [0.016 + (x1 - 0.016) * i / 5 for i in range(6)]
			xs_ = sorted(sx * x for x in xs_)
			top = [P.vert((x, yt(x) + 0.0004, z - 0.0018)) for x in xs_]; bot = [P.vert((x, yt(x) + 0.0004, z + 0.0018)) for x in xs_]
			for i in range(5): P.face([top[i], bot[i], bot[i + 1], top[i + 1]], 3, True)
	cyl(P, (0, 0.0032, 0), 0.0035, 0.2, 0, 'Z', 8)                                  # the spine's roll under the gutter
	# three pages fanned up off the right-hand side, each bending over under its own weight
	for k, th in enumerate((0.35, 0.6, 0.85)):
		pts, x, y, a = [], 0.004, yt(0.004) + 0.0003, th
		for i in range(9):
			pts.append((x, y)); s = 0.118 / 8; a -= (th + 0.25) / 8
			x += s * math.cos(a); y += s * math.sin(a)
		for side, off in ((1, 0.0003), (-1, -0.0003)):
			ra = [P.vert((px, py + off, -0.094)) for px, py in pts]; rb = [P.vert((px, py + off, 0.094)) for px, py in pts]
			for i in range(len(pts) - 1):
				q = [ra[i], rb[i], rb[i + 1], ra[i + 1]]
				P.face(q if side > 0 else q[::-1], 1, True)
	return P


def sun_hat():
	mS = material('hat_straw', (0.84, 0.72, 0.5), 0.9, double=True)
	mB = material('hat_band', (0.13, 0.13, 0.15), 0.8, double=True)
	P = Prop('sun_hat', [mS, mB], 'bottom centre (brim edge on the sand); to wear, put the origin 0.135 m below the head top')
	brim = [0.215, 0.203, 0.19, 0.176, 0.162, 0.148, 0.134, 0.12, 0.106]
	prof = []
	for i, r in enumerate(brim):
		y = 0.034 * ((0.215 - r) / 0.109) ** 0.75
		if 0 < i < len(brim) - 1:
			y += 0.0012 * (1 if i % 2 else -1)  # sewn straw braid rows
		prof.append((r, y))
	prof += [(0.1015, 0.037), (0.1005, 0.061), (0.097, 0.085), (0.091, 0.108), (0.08, 0.126), (0.06, 0.138), (0.032, 0.144), (0, 0.146)]

	def warp(t, r, y, j):
		f = max(0.0, (r - 0.106) / 0.109) ** 1.5
		y2 = y + f * (0.013 * (0.5 + 0.5 * math.sin(2 * t + 0.7)) + 0.004 * (0.5 + 0.5 * math.sin(5 * t + 1.3)))
		return (0.95 * r * math.cos(t), y2, r * math.sin(t))
	lathe(P, prof, 34, lambda j: 1 if j == len(brim) else 0, warp=warp, recalc=False)
	return P


def bucket_hat():
	m = material('bucket_cotton', (0.22, 0.29, 0.38), 0.92, double=True)
	P = Prop('bucket_hat', [m], 'bottom centre (brim edge on the sand); to wear, put the origin 0.115 m below the head top')
	brim = [0.148, 0.141, 0.134, 0.127, 0.12, 0.113, 0.106, 0.1]
	prof = []
	for i, r in enumerate(brim):
		y = (0.148 - r) * 0.85
		if 0 < i < len(brim) - 1:
			y += 0.0007 * (1 if i % 2 else -1)  # stitch rows
		prof.append((r, y))
	prof += [(0.0975, 0.043), (0.0965, 0.05), (0.093, 0.075), (0.088, 0.1), (0.083, 0.113), (0.076, 0.1195), (0.06, 0.1225), (0.03, 0.1238), (0, 0.124)]

	def warp(t, r, y, j):
		f = max(0.0, (r - 0.1) / 0.048)
		return (0.95 * r * math.cos(t), y + f * 0.006 * (0.5 + 0.5 * math.sin(3 * t + 0.4)), r * math.sin(t))
	lathe(P, prof, 32, 0, warp=warp, recalc=False)
	return P


def sunnies():
	mF = material('sunnies_frame', (0.05, 0.05, 0.055), 0.3)
	mL = material('sunnies_lens', (0.05, 0.075, 0.065), 0.06)
	P = Prop('sunnies', [mF, mL], 'the bridge; lenses face +Z, arms run back to -Z; eyes sit about 8 mm below and 15 mm behind',
		ground=False)

	def wrap(x):
		return -1.1 * x * x
	for sx in (1, -1):
		cx, cy = 0.037 * sx, -0.008
		P2 = []
		for i in range(16):
			t = TAU * i / 16 + 0.1
			c, s = math.cos(t), math.sin(t)
			x = 0.025 * math.copysign(abs(c) ** (2 / 3.2), c)
			y = 0.0205 * math.copysign(abs(s) ** (2 / 3.2), s)
			if s < 0:
				x *= 1 - 0.13 * (-s)
			y += 0.0025 * max(0.0, x / 0.025 * sx) * max(0.0, s)
			P2.append((cx + x, cy + y))
		n = len(P2)
		Pf, Qf, Qb, Pb, Lf, Lb = [], [], [], [], [], []
		for i, (x, y) in enumerate(P2):
			(x0, y0), (x1, y1) = P2[i - 1], P2[(i + 1) % n]
			L = math.hypot(x1 - x0, y1 - y0)
			nx, ny = (y1 - y0) / L, -(x1 - x0) / L
			w = 0.0052 + 0.0038 * max(0.0, ny)  # heavier brow
			qx, qy = x + nx * w, y + ny * w
			lx, ly = x + nx * 0.0015, y + ny * 0.0015
			Pf.append(P.vert((x, y, wrap(x) + 0.0025)))
			Pb.append(P.vert((x, y, wrap(x) - 0.0025)))
			Qf.append(P.vert((qx, qy, wrap(qx) + 0.0025)))
			Qb.append(P.vert((qx, qy, wrap(qx) - 0.0025)))
			Lf.append(P.vert((lx, ly, wrap(lx) + 0.0008)))
			Lb.append(P.vert((lx, ly, wrap(lx) - 0.0008)))
		ff, lf = [], [P.face(Lf, 1, True), P.face(Lb[::-1], 1, True)]
		for i in range(n):
			j = (i + 1) % n
			ff += [P.face([Pf[i], Qf[i], Qf[j], Pf[j]], 0), P.face([Qf[i], Qb[i], Qb[j], Qf[j]], 0),
				P.face([Qb[i], Pb[i], Pb[j], Qb[j]], 0), P.face([Pb[i], Pf[i], Pf[j], Pb[j]], 0)]
			lf.append(P.face([Lf[i], Lb[i], Lb[j], Lf[j]], 1, True))
		bmesh.ops.recalc_face_normals(P.bm, faces=ff)
		bmesh.ops.recalc_face_normals(P.bm, faces=lf)
		box(P, (0.066 * sx, 0.008, wrap(0.066) - 0.004), (0.007, 0.009, 0.01), 0.0015, 1, 0)  # hinge block
		tube(P, [(0.0685 * sx, 0.008, wrap(0.0685) - 0.006), (0.0705 * sx, 0.0075, -0.03), (0.072 * sx, 0.006, -0.08),
			(0.0715 * sx, 0.003, -0.12), (0.07 * sx, -0.006, -0.142), (0.068 * sx, -0.018, -0.155)], 0.0017, 4, 0, up=(1, 0, 0), rx=0.0034)
	tube(P, [(-0.0125, 0.003, wrap(0.0125) + 0.0005), (-0.006, 0.006, 0.0012), (0.006, 0.006, 0.0012), (0.0125, 0.003, wrap(0.0125) + 0.0005)],
		0.0024, 4, 0, up=(0, 0, 1), rx=0.0028)
	return P


# ------------------------------------------------------------------ finish, export, proofs
def finish(P):
	bm = P.bm
	if P.ground:
		miny = min(v.co.y for v in bm.verts)
		bmesh.ops.translate(bm, vec=(0, -miny, 0), verts=list(bm.verts))
	mn = [min(v.co[i] for v in bm.verts) for i in range(3)]
	mx = [max(v.co[i] for v in bm.verts) for i in range(3)]
	bmesh.ops.transform(bm, matrix=YUP, verts=list(bm.verts))
	me = bpy.data.meshes.new(P.name)
	bm.to_mesh(me)
	bm.free()
	for m in P.mats:
		me.materials.append(m)
	try:
		me.set_sharp_from_angle(angle=math.radians(P.sharp))
	except Exception as e:
		print('WARN sharp', e)
	me.calc_loop_triangles()
	ob = bpy.data.objects.new(P.name, me)
	bpy.context.scene.collection.objects.link(ob)
	info = {'tris': len(me.loop_triangles), 'size': [round(mx[i] - mn[i], 4) for i in range(3)],
		'min': [round(c, 4) for c in mn], 'origin': P.origin, 'materials': [m.name for m in P.mats]}
	return ob, info


def export(ob, path):
	for o in bpy.context.scene.objects:
		o.select_set(False)
	ob.select_set(True)
	bpy.context.view_layer.objects.active = ob
	bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
		export_cameras=False, export_lights=False, export_animations=False, export_extras=False)


def render_proofs(objs):
	os.makedirs(SHEET, exist_ok=True)
	sc = bpy.context.scene
	for eng in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE', 'BLENDER_WORKBENCH'):
		try:
			sc.render.engine = eng
			break
		except Exception:
			pass
	print('RENDER engine', sc.render.engine)
	try:
		sc.eevee.taa_render_samples = 48
	except Exception:
		pass
	for o in objs.values():
		o.hide_render = True
	world = bpy.data.worlds.new('studio')
	sc.world = world
	try:
		world.use_nodes = True
	except Exception:
		pass
	world.color = (0.55, 0.62, 0.72)
	if world.node_tree:
		bg = world.node_tree.nodes.get('Background')
		if bg:
			bg.inputs[0].default_value = (0.5, 0.58, 0.7, 1)
			bg.inputs[1].default_value = 0.9
	sun_d = bpy.data.lights.new('sun', 'SUN')
	sun_d.energy = 3.2
	sun_d.angle = math.radians(8)
	sun = bpy.data.objects.new('sun', sun_d)
	sc.collection.objects.link(sun)
	sun.rotation_euler = (YUP.to_3x3() @ Vector((0.45, -0.75, -0.5))).to_track_quat('-Z', 'Y').to_euler()

	def slab(name, center, size, mat):
		bm = bmesh.new()
		bmesh.ops.create_cube(bm, size=1.0, matrix=Matrix.Translation(center) @ Matrix.Diagonal((*size, 1.0)))
		bmesh.ops.transform(bm, matrix=YUP, verts=list(bm.verts))
		me = bpy.data.meshes.new(name)
		bm.to_mesh(me)
		bm.free()
		me.materials.append(mat)
		o = bpy.data.objects.new(name, me)
		sc.collection.objects.link(o)
		return o
	slab('sand', (20, -0.05, 0), (120, 0.1, 60), material('sand', (0.8, 0.7, 0.52), 1.0))
	grey = material('ref_grey', (0.5, 0.5, 0.5), 0.8)
	slab('human_1p8', (-5.0, 0.9, -1.6), (0.45, 1.8, 0.28), grey)

	def place(name, x, z, yaw=0.0, pre=None):
		src = objs[name]
		o = src.copy()
		o.hide_render = False
		sc.collection.objects.link(o)
		R = Matrix.Rotation(math.radians(yaw), 4, 'Y')
		if pre is not None:
			R = R @ pre
		miny = min((R @ (YUP_INV @ v.co)).y for v in src.data.vertices)
		o.matrix_world = YUP @ Matrix.Translation((x, -miny, z)) @ R @ YUP_INV
	LIE = Matrix.Rotation(-math.pi / 2, 4, 'X')  # bat lying face up
	# contact sheet
	place('umbrella_a', -3.4, -1.9)
	place('umbrella_b', -1.0, -1.9, 180)
	for i, n in enumerate(['towel_a', 'towel_b', 'towel_c', 'towel_d']):
		place(n, 0.9 + 1.1 * i, -1.4)
	for n, x in [('esky', -4.5), ('beach_bag', -3.6), ('thongs', -2.95), ('stumps', -1.0), ('tennis_ball', -0.55), ('frisbee', -0.15),
			('book', 0.35), ('sun_hat', 0.95), ('bucket_hat', 1.55), ('sunnies', 2.05)]:
		place(n, x, 0.6)
	place('cricket_bat', -2.55, 0.6, 90, LIE)
	# close-up vignette: towels under an umbrella
	place('umbrella_a', 20.0, -0.9)
	place('towel_b', 19.55, 0.35, 6)
	place('towel_a', 20.45, 0.4, -4)
	place('towel_c', 18.45, 0.1, 12)
	place('towel_d', 21.6, 0.2, -10)
	place('umbrella_b', 22.5, -1.0, 200)
	place('esky', 21.0, -0.75, 15)
	place('thongs', 19.6, 1.35, 10)
	place('frisbee', 20.8, 1.45)
	# small props close-up
	for n, x, z in [('esky', 39.1, -0.45), ('beach_bag', 39.8, -0.45), ('stumps', 40.35, -0.5), ('sun_hat', 40.95, -0.45),
			('bucket_hat', 39.1, 0.1), ('book', 39.6, 0.1), ('frisbee', 40.05, 0.1), ('thongs', 40.5, 0.1),
			('tennis_ball', 39.45, 0.5), ('sunnies', 39.8, 0.5)]:
		place(n, x, z)
	place('cricket_bat', 40.4, 0.5, 90, LIE)
	cam_d = bpy.data.cameras.new('cam')
	cam = bpy.data.objects.new('cam', cam_d)
	sc.collection.objects.link(cam)
	sc.camera = cam

	def shoot(fname, eye, target, lens, res):
		e, t = YUP @ Vector(eye), YUP @ Vector(target)
		cam.location = e
		cam.rotation_euler = (t - e).to_track_quat('-Z', 'Y').to_euler()
		cam_d.lens = lens
		sc.render.resolution_x, sc.render.resolution_y = res
		sc.render.filepath = os.path.join(SHEET, fname)
		bpy.ops.render.render(write_still=True)
		print('RENDER wrote', sc.render.filepath)
	shoot('sheet.png', (-0.2, 3.4, 6.6), (-0.2, 0.55, -0.5), 24, (2400, 1200))
	shoot('closeup_towels_umbrella.png', (20.2, 2.6, 5.0), (20.2, 0.5, -0.3), 30, (1800, 1200))
	shoot('closeup_small.png', (40.3, 1.25, 1.9), (40.3, 0.1, -0.1), 28, (1800, 1200))


def main():
	for o in list(bpy.data.objects):
		bpy.data.objects.remove(o, do_unlink=True)
	os.makedirs(OUT, exist_ok=True)
	props = build_towels() + [umbrella('umbrella_a', (0.14, 0.24, 0.42), (0.93, 0.91, 0.86)),
		umbrella('umbrella_b', (0.87, 0.45, 0.35), (0.93, 0.91, 0.86)), esky(), beach_bag(), thongs(), cricket_bat(), stumps(),
		tennis_ball(), frisbee(), book(), sun_hat(), bucket_hat(), sunnies()]
	manifest, objs = {}, {}
	for P in props:
		ob, info = finish(P)
		export(ob, os.path.join(OUT, P.name + '.glb'))
		manifest[P.name] = info
		objs[P.name] = ob
		cap = next((v for k, v in BUDGET.items() if P.name.startswith(k)), 1200)
		print('PROP', P.name, info['tris'], info['size'], info['min'], 'OVER' if info['tris'] > cap else 'ok')
	with open(os.path.join(OUT, 'manifest.json'), 'w') as fh:
		json.dump(manifest, fh, indent=2)
	if SHEET:
		render_proofs(objs)


main()
