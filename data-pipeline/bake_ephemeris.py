#!/usr/bin/env python3
"""Bake the 2026-2045 hourly ephemeris used by every number in the app.

Record (Float32 x 10 = 40 B), all in the MOON_ME frame (DE440-matched lunar frame kernel):
  [0:3]  Sun   position relative to the Moon's centre, km   (LT+S)
  [3:6]  Earth position relative to the Moon's centre, km   (LT+S)
  [6:10] unit quaternion (w, x, y, z) rotating ITRF93 (Earth-fixed) vectors into MOON_ME

Also writes ephemeris.json (epoch, step, count, kernels used) and validation reference
samples (independent of the browser interpolation) for validate.ts test 1.
"""
import json, os, sys
import numpy as np
import spiceypy as sp

HERE = os.path.dirname(os.path.abspath(__file__))
K = os.path.join(HERE, "raw", "kernels")
import argparse
ap = argparse.ArgumentParser()
ap.add_argument("--start", default="2026-01-01T00:00:00"); ap.add_argument("--end", default="2045-01-01T00:00:00")
ap.add_argument("--out", default=os.path.join(HERE, "..", "frontend", "public", "assets")); ap.add_argument("--name", default="ephemeris")
args = ap.parse_args()
OUT = args.out
os.makedirs(OUT, exist_ok=True)

KERNELS = [
    "naif0012.tls", "pck00011.tpc", "moon_pa_de440_200625.bpc",
    "moon_de440_250416.tf", "earth_combined.bpc", "de440s.bsp",
]
for k in KERNELS:
    sp.furnsh(os.path.join(K, k))

START = args.start
END = args.end                    # exclusive
STEP = 3600.0
et0 = sp.str2et(START.replace("T", " ") + " UTC")
et1 = sp.str2et(END.replace("T", " ") + " UTC")
n = int(round((et1 - et0) / STEP))
ets = et0 + STEP * np.arange(n)
print(f"{n} hourly records, {START} .. {END}")

def mat_to_quat(R):
    """Rotation matrix -> unit quaternion (w, x, y, z), w >= 0."""
    q = sp.m2q(R)
    q = np.array(q, dtype=np.float64)
    if q[0] < 0: q = -q
    return q

rec = np.zeros((n, 10), dtype=np.float32)
prev = None
for i, et in enumerate(ets):
    sun, _ = sp.spkpos("SUN", et, "MOON_ME", "LT+S", "MOON")
    earth, _ = sp.spkpos("EARTH", et, "MOON_ME", "LT+S", "MOON")
    R = sp.pxform("ITRF93", "MOON_ME", et)
    q = mat_to_quat(R)
    if prev is not None and np.dot(prev, q) < 0: q = -q   # keep slerp on the short arc
    prev = q
    rec[i, 0:3] = sun; rec[i, 3:6] = earth; rec[i, 6:10] = q
    if i % 20000 == 0: print(f"  {i}/{n}")

# Unix-ms of first record, for the browser (TDB/UTC difference handled by SPICE; we store UTC epoch)
epoch_unix_ms = int(np.datetime64(START, "ms").astype("int64"))
rec.tofile(os.path.join(OUT, args.name + ".bin"))

# Independent reference samples at off-grid times (not hourly nodes) so interpolation error is tested too.
rng = np.random.default_rng(42)
sites = [(-89.54, 129.0), (-88.0, 5.0), (-85.9, 0.9), (-85.4, 31.0)]   # lat, lon deg (planetocentric)
ref = []
for _ in range(24):
    et = et0 + rng.uniform(0, n * STEP)
    lat, lon = sites[rng.integers(len(sites))]
    la, lo = np.radians(lat), np.radians(lon)
    nhat = np.array([np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)])
    R_ = 1737.4
    pos = R_ * nhat
    east = np.array([-np.sin(lo), np.cos(lo), 0.0])
    north = np.array([-np.sin(la) * np.cos(lo), -np.sin(la) * np.sin(lo), np.cos(la)])
    out = {"unixMs": epoch_unix_ms + int(round((et - et0) * 1000)), "lat": float(lat), "lon": float(lon)}
    for body in ("SUN", "EARTH"):
        v, _ = sp.spkpos(body, et, "MOON_ME", "LT+S", "MOON")
        v = np.array(v) - pos
        out[body.lower()] = {
            "az": float(np.degrees(np.arctan2(v @ east, v @ north)) % 360.0),
            "el": float(np.degrees(np.arcsin((v @ nhat) / np.linalg.norm(v)))),
        }
    ref.append(out)

meta = {
    "version": 1,
    "frame": "MOON_ME (DE440-matched, moon_de440_250416.tf)",
    "aberration": "LT+S",
    "startUnixMs": epoch_unix_ms,
    "stepSeconds": STEP,
    "count": n,
    "recordFloats": 10,
    "layout": ["sun[3] km", "earth[3] km", "quat ITRF93->MOON_ME wxyz[4]"],
    "kernels": KERNELS,
    "spiceToolkit": sp.tkvrsn("TOOLKIT"),
    "referenceSamples": ref,
}
json.dump(meta, open(os.path.join(OUT, args.name + ".json"), "w"), indent=1)
print("wrote", os.path.getsize(os.path.join(OUT, args.name + ".bin")) / 1e6, "MB")
