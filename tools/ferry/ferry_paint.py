"""Render-time surface finish for the ferry: marine paint instead of flat colour.

Real ship paint is a glossy topcoat over aluminium plate that dishes slightly between the
frames ("hungry horse"), with orange peel in the gloss, grime streaking down from deck edges and
window corners, and a scummy waterline. apply(materials) rebuilds the named Blender materials'
node trees in place (Cycles only; the GLB export still carries plain PBR factors).
Coordinates are the model's own metres (Object texture space).
"""
import bpy

WATERLINE_TOP = 0.55


class Tree:
    """Tiny helper around a material node tree."""

    def __init__(self, mat):
        self.nt = mat.node_tree
        self.n, self.l = self.nt.nodes, self.nt.links
        self.bsdf = self.n['Principled BSDF']
        self.coords = self.n.new('ShaderNodeTexCoord')

    def node(self, kind, **inputs):
        node = self.n.new(kind)
        for key, value in inputs.items():
            if hasattr(node, key) and not key[0].isupper():
                setattr(node, key, value)
            else:
                node.inputs[key.replace('_', ' ')].default_value = value
        return node

    def link(self, a, b):
        self.l.new(a, b)

    def mapped(self, scale):
        """Object coordinates scaled per axis (for streaks and bands)."""
        m = self.node('ShaderNodeMapping')
        m.inputs['Scale'].default_value = scale
        self.link(self.coords.outputs['Object'], m.inputs['Vector'])
        return m.outputs['Vector']

    def noise(self, vector, scale, detail=4.0, roughness=0.55):
        t = self.node('ShaderNodeTexNoise')
        t.inputs['Scale'].default_value = scale; t.inputs['Detail'].default_value = detail
        t.inputs['Roughness'].default_value = roughness
        self.link(vector, t.inputs['Vector'])
        return t.outputs['Fac']

    def ramp(self, fac, a, b, lo=0.0, hi=1.0):
        r = self.node('ShaderNodeValToRGB')
        r.color_ramp.elements[0].position = lo; r.color_ramp.elements[0].color = a
        r.color_ramp.elements[1].position = hi; r.color_ramp.elements[1].color = b
        self.link(fac, r.inputs['Fac'])
        return r.outputs['Color']

    def math(self, op, a, b=None, clamp=True):
        m = self.node('ShaderNodeMath'); m.operation = op; m.use_clamp = clamp
        for socket, value in ((m.inputs[0], a), (m.inputs[1], b)):
            if value is None: continue
            if isinstance(value, (int, float)): socket.default_value = value
            else: self.link(value, socket)
        return m.outputs[0]

    def mix(self, a, b, fac):
        m = self.node('ShaderNodeMix'); m.data_type = 'RGBA'
        for socket, value in ((m.inputs['A'], a), (m.inputs['B'], b), (m.inputs['Factor'], fac)):
            if isinstance(value, (int, float)): socket.default_value = value
            elif isinstance(value, tuple): socket.default_value = value
            else: self.link(value, socket)
        return m.outputs['Result']

    def height(self, axis):
        sep = self.node('ShaderNodeSeparateXYZ')
        self.link(self.coords.outputs['Object'], sep.inputs['Vector'])
        return sep.outputs[axis]


def paint(mat, base, grime, rough=0.26, coat=0.35, plating=0.6, streaks=0.28, waterline=False):
    """A marine topcoat: colour drift, grime streaks, gloss variation, orange peel, plate dishing."""
    t = Tree(mat)
    b = t.bsdf
    # Colour: a slow drift in the paint, then grime streaks running down (stretched in z).
    drift = t.noise(t.coords.outputs['Object'], 0.08, 3.0)
    colour = t.mix(tuple(c * 0.965 for c in base[:3]) + (1,), tuple(min(1, c * 1.03) for c in base[:3]) + (1,), drift)
    streak = t.noise(t.mapped((5.0, 5.0, 0.22)), 1.4, 6.0, 0.62)
    patchy = t.noise(t.coords.outputs['Object'], 0.12, 2.0)
    streak_mask = t.math('MULTIPLY', t.math('SUBTRACT', streak, 0.52), 4.0)
    streak_mask = t.math('MULTIPLY', streak_mask, t.math('SUBTRACT', t.math('MULTIPLY', patchy, 1.6), 0.35))
    streak_mask = t.math('MULTIPLY', streak_mask, streaks)
    colour = t.mix(colour, grime + (1,), streak_mask)
    if waterline:
        # Scum and weed staining in the wet band at the waterline, with a ragged top edge.
        z = t.height('Z')
        ragged = t.noise(t.mapped((1.0, 1.0, 1.0)), 2.5, 3.0)
        edge = t.math('ADD', WATERLINE_TOP - 0.18, t.math('MULTIPLY', ragged, 0.36))
        wet = t.math('GREATER_THAN', edge, z)
        colour = t.mix(colour, (0.035, 0.04, 0.025, 1), t.math('MULTIPLY', wet, 0.85))
    t.link(colour, b.inputs['Base Color'])
    # Gloss: rougher where grimy, a little blotchy everywhere.
    blotch = t.noise(t.coords.outputs['Object'], 0.9, 3.0)
    r = t.math('ADD', rough - 0.05, t.math('MULTIPLY', blotch, 0.12))
    r = t.math('ADD', r, t.math('MULTIPLY', streak_mask, 0.35))
    t.link(r, b.inputs['Roughness'])
    if 'Coat Weight' in b.inputs:
        b.inputs['Coat Weight'].default_value = coat
        b.inputs['Coat Roughness'].default_value = 0.05
    # Plate dishing between frames (1.2 m) and longitudinals (0.45 m), uneven from panel to
    # panel, plus fine orange peel in the topcoat.
    frames = t.node('ShaderNodeTexWave', wave_type='BANDS', bands_direction='Y', wave_profile='SIN')
    frames.inputs['Scale'].default_value = 0.2618; t.link(t.coords.outputs['Object'], frames.inputs['Vector'])
    longs = t.node('ShaderNodeTexWave', wave_type='BANDS', bands_direction='Z', wave_profile='SIN')
    longs.inputs['Scale'].default_value = 0.698; t.link(t.coords.outputs['Object'], longs.inputs['Vector'])
    dish = t.math('MULTIPLY', frames.outputs['Fac'], longs.outputs['Fac'])
    uneven = t.noise(t.coords.outputs['Object'], 0.35, 2.0)
    dish = t.math('MULTIPLY', dish, t.math('ADD', 0.35, uneven))
    bump_plate = t.node('ShaderNodeBump', invert=True)
    bump_plate.inputs['Strength'].default_value = plating * 0.25
    bump_plate.inputs['Distance'].default_value = 0.02
    t.link(dish, bump_plate.inputs['Height'])
    peel = t.noise(t.coords.outputs['Object'], 260.0, 2.0)
    bump_peel = t.node('ShaderNodeBump')
    bump_peel.inputs['Strength'].default_value = 0.035
    bump_peel.inputs['Distance'].default_value = 0.002
    t.link(peel, bump_peel.inputs['Height'])
    t.link(bump_plate.outputs['Normal'], bump_peel.inputs['Normal'])
    t.link(bump_peel.outputs['Normal'], b.inputs['Normal'])
    if 'Coat Normal' in b.inputs: t.link(bump_peel.outputs['Normal'], b.inputs['Coat Normal'])


def deck(mat, base):
    """Non-slip deck coating: gritty, scuffed and stained where people walk."""
    t = Tree(mat)
    b = t.bsdf
    stain = t.noise(t.coords.outputs['Object'], 0.6, 5.0, 0.6)
    t.link(t.ramp(stain, tuple(c * 0.75 for c in base[:3]) + (1,), tuple(c * 1.12 for c in base[:3]) + (1,), 0.3, 0.75), b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = 0.88
    grit = t.noise(t.coords.outputs['Object'], 90.0, 2.0)
    bump = t.node('ShaderNodeBump'); bump.inputs['Strength'].default_value = 0.25; bump.inputs['Distance'].default_value = 0.004
    t.link(grit, bump.inputs['Height']); t.link(bump.outputs['Normal'], b.inputs['Normal'])


def metal(mat, rough=0.3):
    """Brushed or weathered metal: roughness that varies and a faint grain."""
    t = Tree(mat)
    b = t.bsdf
    grain = t.noise(t.mapped((1.0, 1.0, 40.0)), 6.0, 3.0)
    t.link(t.math('ADD', rough - 0.08, t.math('MULTIPLY', grain, 0.18)), b.inputs['Roughness'])


def apply(materials=None):
    get = (materials or bpy.data.materials).get
    WHITE_GRIME = (0.42, 0.4, 0.35)
    for name, base, grime, kw in (
        ('SuperstructureWhite', (0.8, 0.81, 0.8), WHITE_GRIME, {}),
        ('DeckhouseWhite', (0.74, 0.75, 0.73), WHITE_GRIME, {'plating': 0.3}),
        ('HullNavy', (0.012, 0.035, 0.19), (0.03, 0.04, 0.07), {'coat': 0.45, 'waterline': True, 'streaks': 0.22}),
        ('Antifouling', (0.02, 0.07, 0.22), (0.03, 0.05, 0.06), {'coat': 0.0, 'rough': 0.6, 'plating': 0.2, 'waterline': True}),
        ('BandBlack', (0.008, 0.01, 0.013), (0.05, 0.05, 0.05), {'coat': 0.6, 'rough': 0.1, 'plating': 0.2, 'streaks': 0.12}),
        ('LiveryTeal', (0.0, 0.42, 0.45), WHITE_GRIME, {'plating': 0.6, 'streaks': 0.2}),
        ('SunGold', (0.92, 0.6, 0.15), WHITE_GRIME, {'plating': 0.6, 'streaks': 0.2}),
        ('LiverySoftNavy', (0.05, 0.075, 0.19), (0.03, 0.04, 0.07), {'plating': 0.6, 'streaks': 0.2}),
        ('LifebuoyOrange', (0.95, 0.28, 0.03), (0.35, 0.2, 0.1), {'plating': 0.0, 'coat': 0.1, 'rough': 0.5}),
    ):
        mat = get(name)
        if mat and mat.use_nodes: paint(mat, base, grime, **kw)
    for name, base in (('NonSlipDeck', (0.22, 0.23, 0.23)),):
        mat = get(name)
        if mat and mat.use_nodes: deck(mat, base)
    for name, rough in (('Stainless', 0.22), ('PaintedSteel', 0.5), ('StackBlack', 0.45)):
        mat = get(name)
        if mat and mat.use_nodes: metal(mat, rough)
