# Blender stand-in for textures.sh where ImageMagick is missing (same outputs, same maths):
# colour / normal -> JPEG, specular -> ORM (R 1, G roughness = 0.92 - 0.6 * spec, B metal 0), opacity cards -> PNG with alpha.
# blender -b --python crowd_textures.py -- <Textures dir> <out dir> <prefix> [size]
import bpy, sys, os
import numpy as np
argv = sys.argv[sys.argv.index('--') + 1:]
src, out, p = argv[:3]
S = int(argv[3]) if len(argv) > 3 else 1024
os.makedirs(out, exist_ok=True)

def load(name):
    path = os.path.join(src, name)
    if not os.path.exists(path): return None
    im = bpy.data.images.load(path)
    im.colorspace_settings.name = 'Non-Color'  # raw values through, no view transform
    im.scale(S, S)
    return im

def write(px, name, fmt, alpha=False):
    im = bpy.data.images.new(name, S, S, alpha=alpha)
    im.colorspace_settings.name = 'Non-Color'
    im.pixels.foreach_set(px.astype(np.float32).ravel())
    im.filepath_raw = os.path.join(out, name)
    im.file_format = fmt
    im.save(quality=90) if fmt == 'JPEG' else im.save()

def pixels(im):
    a = np.empty(S * S * 4, dtype=np.float32)
    im.pixels.foreach_get(a)
    return a.reshape(S, S, 4)

for k in ('body', 'head'):
    for kind in ('color', 'normal'):
        im = load(f'{p}_{k}_{kind}.tga')
        if im: write(pixels(im), f'{p}_{k}_{kind}.jpg', 'JPEG')
    im = load(f'{p}_{k}_specular.tga')
    if im:
        a = pixels(im)
        g = 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]
        orm = np.stack([np.ones_like(g), np.clip(0.92 - 0.6 * g, 0, 1), np.zeros_like(g), np.ones_like(g)], -1)
        write(orm, f'{p}_{k}_orm.jpg', 'JPEG')
im = load(f'{p}_opacity_color.tga')
if im: write(pixels(im), f'{p}_opacity.png', 'PNG', alpha=True)
print('TEXTURES', sorted(os.listdir(out)))
