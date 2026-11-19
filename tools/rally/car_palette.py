"""The car palette: the untextured materials every Tidewater car GLB is built from.

Shared by the importer (tools/rally/import_cars.py) and the Blender-built hero cars
(tools/rally/hero_kit.py), so a material means the same thing on every car: src/rally/CarLights.js
finds the lamp lenses by the names Headlamp and TailLamp, and test/vehicle-glass.mjs holds every
GlassPanels material to Glass (blended, alpha 0.78, dark tint).
Colours are linear RGB(A) factors, as glTF stores them.
"""
# name: (base rgba, metallic, roughness, emissive rgb or None, clearcoat (factor, roughness) or None)
PALETTE = {
    "BodyPaint": ((0.62, 0.02, 0.018, 1), 0.64, 0.28, None, (0.34, 0.17)),
    # the second colour of a two-tone car (the Corsaire's haunches behind its C line); same finish
    "BodyPaintSecond": ((0.62, 0.02, 0.018, 1), 0.64, 0.28, None, (0.34, 0.17)),
    "Graphite": ((0.021, 0.028, 0.032, 1), 0.36, 0.36, None, None),
    "AlloyDark": ((0.075, 0.095, 0.105, 1), 0.86, 0.30, None, None),
    "Alloy": ((0.38, 0.44, 0.46, 1), 0.92, 0.22, None, None),
    "BrightMetal": ((0.69, 0.76, 0.78, 1), 0.96, 0.18, None, None),
    "Indicator": ((0.82, 0.21, 0.015, 1), 0.20, 0.22, (0.123, 0.0315, 0.00225), None),
    "Headlamp": ((0.79, 0.91, 0.98, 1), 0.30, 0.13, (0.711, 0.819, 0.882), None),
    "TailLamp": ((0.55, 0.008, 0.008, 1), 0.28, 0.19, (0.154, 0.00224, 0.00224), None),
    "LicensePlate": ((0.7, 0.73, 0.68, 1), 0.05, 0.55, None, None),
    "Caliper": ((0.61, 0.035, 0.016, 1), 0.35, 0.28, None, None),
    "Glass": ((0.038, 0.078, 0.094, 0.78), 0.28, 0.12, None, None),
    "Interior": ((0.022, 0.029, 0.034, 1), 0.02, 0.75, None, None),
    "SeatFabric": ((0.20, 0.012, 0.008, 1), 0.02, 0.84, None, None),
    "Rubber": ((0.012, 0.015, 0.018, 1), 0.04, 0.69, None, None),
    "Tread": ((0.007, 0.01, 0.012, 1), 0.02, 0.76, None, None),
    "BrakeRotor": ((0.16, 0.18, 0.19, 1), 0.88, 0.40, None, None),
}
