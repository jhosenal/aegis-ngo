"""Green-screen key for a flat green background: alpha from green dominance, despill, optional downscale. usage: keygreen.py <frames_in_dir> <frames_out_dir> <scale>"""
import sys
from pathlib import Path
import cv2, numpy as np

src, dst, scale = Path(sys.argv[1]), Path(sys.argv[2]), float(sys.argv[3])
dst.mkdir(parents=True, exist_ok=True)
D0, D1 = 38.0, 84.0   # green dominance (g - max(r,b)): below D0 fully subject, above D1 fully background
n = 0
for f in sorted(src.glob('*.png')):
    bgr = cv2.imread(str(f)).astype(np.float32)
    b, g, r = bgr[..., 0], bgr[..., 1], bgr[..., 2]
    d = g - np.maximum(r, b)
    a = 1.0 - np.clip((d - D0) / (D1 - D0), 0, 1)
    a = np.clip((a - 0.18) / 0.82, 0, 1)                       # pull the matte in a touch: the outer rim is mostly background green
    a = cv2.GaussianBlur(a, (0, 0), 0.6)                      # soften the staircase on hair edges
    cap = np.maximum(r, b) + 4.0
    g2 = np.minimum(g, cap)
    out = np.dstack([b, g2, r])
    # edge colour: partial-alpha pixels take the colour of the solid interior beside them (normalised convolution), so no teal rim is left
    solid = (a > 0.97).astype(np.float32)
    solid = cv2.erode(solid, np.ones((3, 3), np.uint8))
    num = cv2.GaussianBlur(out * solid[..., None], (0, 0), 3.0); den = cv2.GaussianBlur(solid, (0, 0), 3.0)[..., None]
    interior = num / np.maximum(den, 1e-3)
    edge = (a < 0.97)[..., None] & (den > 0.02)
    out = np.where(edge, interior, out)
    out = np.clip(out, 0, 255).astype(np.uint8)
    alpha = np.clip(a * 255, 0, 255).astype(np.uint8)
    rgba = np.dstack([out, alpha])
    if scale != 1.0:
        rgba = cv2.resize(rgba, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    cv2.imwrite(str(dst / f.name), rgba)
    n += 1
print('keyed', n, 'frames')
