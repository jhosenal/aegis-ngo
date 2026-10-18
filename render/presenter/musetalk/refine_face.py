"""Keep MuseTalk's pixels only around the lips; everywhere else take the original (sharp) source frame.
MuseTalk repaints the whole lower face from a 256 px region, which smooths cheeks, jaw and chin and slightly narrows the face.
usage (from the MuseTalk src folder, venv python): refine_face.py <lipsynced.mp4> <source.mp4> <out_frames_dir>
Alignment: each output frame is matched to the source frame that agrees with it in the body region (below the face), so no assumption is made
about how MuseTalk cycled the source."""
import sys
from pathlib import Path
import cv2, numpy as np, torch

sys.path.insert(0, '.')
from mmpose.apis import inference_topdown, init_model
from mmpose.structures import merge_data_samples

lip_mp4, src_mp4, out_dir = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
out_dir.mkdir(parents=True, exist_ok=True)

def read_all(p):
    cap = cv2.VideoCapture(str(p)); fr = []
    while True:
        ok, f = cap.read()
        if not ok: break
        fr.append(f)
    return fr

S = read_all(src_mp4); O = read_all(lip_mp4)
print('source frames', len(S), 'lipsynced frames', len(O), flush=True)
H, W = O[0].shape[:2]
assert S[0].shape[:2] == (H, W), (S[0].shape, O[0].shape)

# ---- landmarks of every source frame (mouth centre and size)
model = init_model('./musetalk/utils/dwpose/rtmpose-l_8xb32-270e_coco-ubody-wholebody-384x288.py', './models/dwpose/dw-ll_ucoco_384.pth', device='cuda' if torch.cuda.is_available() else 'cpu')
mouth = []
for f in S:
    kp = merge_data_samples(inference_topdown(model, f)).pred_instances.keypoints[0][23:91]
    lips = kp[48:68]
    cx, cy = lips[:, 0].mean(), lips[:, 1].mean()
    mw = lips[:, 0].max() - lips[:, 0].min(); mh = lips[:, 1].max() - lips[:, 1].min()
    chin = kp[8]
    mouth.append((cx, cy, mw, mh, chin[1]))
del model; torch.cuda.empty_cache()
mouth = np.array(mouth, np.float32)
print('mouth width px', mouth[:, 2].mean().round(1), 'height', mouth[:, 3].mean().round(1), flush=True)

# ---- match every lipsynced frame to its source frame using the body region only (rows 55 to 95 percent)
r0, r1 = int(H * 0.55), int(H * 0.95)
Sb = np.stack([cv2.resize(f[r0:r1], (W // 8, (r1 - r0) // 8), interpolation=cv2.INTER_AREA).astype(np.float32) for f in S])
idx = []
for o in O:
    ob = cv2.resize(o[r0:r1], (W // 8, (r1 - r0) // 8), interpolation=cv2.INTER_AREA).astype(np.float32)
    idx.append(int(np.argmin(np.abs(Sb - ob[None]).mean(axis=(1, 2, 3)))))
idx = np.array(idx)
print('matched source index range', idx.min(), idx.max(), 'jumps', int((np.abs(np.diff(idx)) > 3).sum()), flush=True)

# ---- lip mask per frame: ellipse around the mouth that also covers the chin movement, feathered; centre smoothed over time
cx = np.convolve(np.pad(mouth[idx, 0], 2, mode='edge'), np.ones(5) / 5, mode='valid')
cy = np.convolve(np.pad(mouth[idx, 1], 2, mode='edge'), np.ones(5) / 5, mode='valid')
mw = mouth[:, 2].mean(); mh = max(mouth[:, 3].mean(), 6.0)
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
for i, (o, k) in enumerate(zip(O, idx)):
    rx, ry = mw * 0.72, mh * 2.0 + mw * 0.10     # tighter than before: only the lips and the first bit of chin come from MuseTalk
    ccy = cy[i] + mh * 0.5
    m = (((xx - cx[i]) / rx) ** 2 + ((yy - ccy) / ry) ** 2)
    m = np.clip(1.6 - m * 1.2, 0, 1)                # solid inside, soft shoulder outside
    m = cv2.GaussianBlur(m, (0, 0), max(4.0, mw * 0.12))
    m = m[..., None]
    # match the lipsynced colour to the source around the mouth so the patch does not look pink or cool
    ring = (m[..., 0] > 0.05) & (m[..., 0] < 0.6)
    if ring.sum() > 50:
        d = (S[k][ring].astype(np.float32).mean(0) - o[ring].astype(np.float32).mean(0))
    else:
        d = np.zeros(3, np.float32)
    o2 = np.clip(o.astype(np.float32) + d[None, None, :], 0, 255)
    # the mouth patch is a 256 px region scaled up: a mild unsharp mask brings back lip edge definition (limited to the patch by the mask)
    blur = cv2.GaussianBlur(o2, (0, 0), 1.4); o2 = np.clip(o2 + 0.9 * (o2 - blur), 0, 255)
    out = S[k].astype(np.float32) * (1 - m) + o2 * m
    cv2.imwrite(str(out_dir / f'{i + 1:05d}.png'), np.clip(out, 0, 255).astype(np.uint8))
print('refined', len(O), flush=True)
