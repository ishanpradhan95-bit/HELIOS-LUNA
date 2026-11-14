#!/usr/bin/env python3
"""Convert the downloaded GeoTIFFs to raw arrays the TypeScript validation can read, and determine the WAC raster
orientation / scale independently of any frame timing: correlate the WAC percent-lit map against PGDA's average
illumination (LOLA-modelled, orientation known) under all 8 dihedral transforms. Writes prepped/meta.json.
"""
import json, os, numpy as np, tifffile
H = os.path.dirname(os.path.abspath(__file__)); D = os.path.join(H, "raw", "imagery"); P = os.path.join(D, "prepped"); os.makedirs(P, exist_ok=True)

def tif(path):
    with tifffile.TiffFile(path) as t: return t.pages[0].asarray()

pct = tif(f"{D}/WAC_POLE_ILL_PCT_SOUTH_100M.TIF").astype(np.uint8)      # 8-bit browse: used only to locate the Float32 array and for orientation
raw = np.fromfile(f"{D}/WAC_PCT_full.IMG", dtype=np.uint8)
wf = np.frombuffer(raw[9712:9712 + 1214 * 1214 * 4].tobytes(), dtype="<f4").reshape(1214, 1214).astype(np.float64)   # two 4856-byte PDS3 label records precede the data
assert np.corrcoef(wf[wf > -1e30], pct[wf > -1e30])[0, 1] > 0.99, "Float32 array does not match the browse image"
wf[wf < -1e30] = np.nan
wf.astype("<f4").tofile(f"{P}/wac_pct.f32")
pg = np.memmap(f"{D}/AVGVISIB_85S_060M_201608.IMG", dtype="<i2", mode="r", shape=(5058, 5058))

def pgda_at(x, y):
    c = np.floor(x / 60 + 2529).astype(int); r = np.floor(2529 - y / 60).astype(int)
    return pg[r, c].astype(np.float64) * 0.00004

N = pct.shape[0]; half = N / 2
yy, xx = np.mgrid[0:N, 0:N]
X = (xx + 0.5 - half) * 100.0; Y = (half - (yy + 0.5)) * 100.0
rho = np.hypot(X, Y); inside = rho < 55000
ref = pgda_at(X, Y)
transforms = {"identity": lambda a: a, "flipud": lambda a: a[::-1], "fliplr": lambda a: a[:, ::-1], "rot180": lambda a: a[::-1, ::-1],
              "transpose": lambda a: a.T, "transpose+flipud": lambda a: a.T[::-1], "transpose+fliplr": lambda a: a.T[:, ::-1], "transpose+rot180": lambda a: a.T[::-1, ::-1]}
res = {}
for name, f in transforms.items():
    w = f(pct).astype(np.float64)
    r = np.corrcoef(w[inside], ref[inside])[0, 1]
    res[name] = float(r); print(f"  {name:18s} r = {r:+.4f}")
best = max(res, key=res.get)
w = transforms[best](pct).astype(np.float64)
print("best transform:", best)
meta = {"wacPct": {"n": N, "res": 100.0, "unit": "percent of observations lit (Float32)", "transform": best, "correlationByTransform": res}, "frames": []}
frames = json.load(open(f"{D}/frames.json"))
for name in frames:
    img = tif(f"{D}/{name}.TIF").astype(np.uint8); m = tif(f"{D}/{name}.MASK.TIF").astype(np.uint8)
    img.tofile(f"{P}/{name}.u8"); m.tofile(f"{P}/{name}.mask.u8")
    meta["frames"].append({"name": name, "n": int(img.shape[0]), "validFraction": float(m.mean())})
    print(name, img.shape, f"valid {100 * m.mean():.1f} percent")
json.dump(meta, open(f"{P}/meta.json", "w"), indent=1)
