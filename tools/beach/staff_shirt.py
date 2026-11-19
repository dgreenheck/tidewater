# Blender 5.x batch: the jetski hire attendant's body, public/models/beach/attendant.glb. It is the swim
# crowd's m01 (navy boardshorts, a white tee with navy trims) with the tee dyed the hire's teal, so he reads
# as staff next to the teal-and-white stand. Only the body colour texture changes: the fold shading is kept
# (each tee pixel keeps its brightness relative to the tee's mean), the trims, skin and shorts are untouched.
#   blender -b --factory-startup --python tools/beach/staff_shirt.py -- <repo root>
import bpy, sys, os, json, struct
from tempfile import gettempdir
import numpy as np

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else ['.']
ROOT = os.path.abspath(argv[0])
SRC = ROOT + '/public/models/characters/crowd/swim/m01.glb'
OUT = ROOT + '/public/models/beach/attendant.glb'
TEAL = np.array([0.03, 0.56, 0.60])        # sRGB 0..1, the stand's sign teal brightened for cloth
TMP = bpy.app.tempdir or gettempdir()
log = lambda *a: print('STAFF', *a, flush=True)

glb = open(SRC, 'rb').read()
jlen = struct.unpack_from('<I', glb, 12)[0]
J = json.loads(glb[20:20 + jlen])
b0 = 20 + jlen
blen = struct.unpack_from('<I', glb, b0)[0]
BIN = glb[b0 + 8:b0 + 8 + blen]
ii = next(i for i, im in enumerate(J['images']) if im.get('name', '').endswith('body_color'))
bv = J['bufferViews'][J['images'][ii]['bufferView']]
off = bv.get('byteOffset', 0)
src = os.path.join(TMP, 'staff_src.' + J['images'][ii]['mimeType'].split('/')[1])
open(src, 'wb').write(BIN[off:off + bv['byteLength']])

img = bpy.data.images.load(src)
w, h = img.size
px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)      # rows bottom-up, sRGB values
rgb = px[:, :, :3]
lum = rgb.mean(axis=2)
sat = rgb.max(axis=2) - rgb.min(axis=2)
v = 1.0 - (np.arange(h)[:, None] + 0.5) / h                             # top-down texture row, 0 at the top
v = np.broadcast_to(v, (h, w))
u = np.broadcast_to((np.arange(w)[None, :] + 0.5) / w, (h, w))
# the tee: near-white, low saturation, in the atlas's centre column (front and back) or the sleeve rows;
# the thongs and hands at the bottom corners stay as they are
tee = (lum > 0.52) & (sat < 0.16) & (((u > 0.32) & (u < 0.63) & (v < 0.9)) | ((v > 0.42) & (v < 0.62)))
m = float(lum[tee].mean())
k = np.clip(lum / m, 0.55, 1.2)[..., None]
rgb[tee] = (TEAL[None, :] * k[tee]).astype(np.float32)
px[:, :, :3] = rgb
img.pixels[:] = px.ravel()
log('tee pixels', int(tee.sum()), 'of', w * h, 'mean lum', round(m, 3))
out = os.path.join(TMP, 'staff_body.jpg')
img.filepath_raw = out; img.file_format = 'JPEG'
bpy.context.scene.render.image_settings.quality = 92
img.save_render(out)
new = open(out, 'rb').read()

# rebuild the binary chunk with the new texture in place of the old one (views kept in order, 4-byte aligned)
views = J['bufferViews']
order = sorted(range(len(views)), key=lambda i: views[i].get('byteOffset', 0))
chunks, pos = [], 0
for i in order:
    o = views[i].get('byteOffset', 0)
    data = new if i == J['images'][ii]['bufferView'] else BIN[o:o + views[i]['byteLength']]
    pad = (-pos) % 4
    chunks.append(b'\0' * pad); pos += pad
    views[i]['byteOffset'] = pos; views[i]['byteLength'] = len(data)
    chunks.append(data); pos += len(data)
J['images'][ii]['mimeType'] = 'image/jpeg'
J['images'][ii]['name'] = 'attendant_body_color'
nb = b''.join(chunks); nb += b'\0' * ((-len(nb)) % 4)
J['buffers'][0]['byteLength'] = len(nb)
js = json.dumps(J, separators=(',', ':')).encode(); js += b' ' * ((-len(js)) % 4)
total = 12 + 8 + len(js) + 8 + len(nb)
with open(OUT, 'wb') as f:
    f.write(struct.pack('<III', 0x46546C67, 2, total))
    f.write(struct.pack('<II', len(js), 0x4E4F534A)); f.write(js)
    f.write(struct.pack('<II', len(nb), 0x004E4942)); f.write(nb)
log('EXPORTED', OUT, total)
