#!/usr/bin/env python3
"""Build the browser DEM pyramid + site catalogue from the LOLA GDR polar products.

Outputs (frontend/public/assets):
  dem/far.bin            480 m,  +-614 km (reaches 70 deg S)           Int16 @ 0.5 m, rel. 1737.4 km
  dem/mid_global.bin     240 m,  +-304 km (reaches 80 deg S)           used for clicked points outside catalogue regions
  dem/<id>_mid.bin       120 m,  ~100 km square around region centre
  dem/<id>_near.bin       20 m,  ~22 km square around region centre
  dem/dem.json           grid metadata for all of the above
  sites.json             regions + candidate sites (Wueller et al. 2026, CC-BY-4.0) + classic teaching site

Projection: LOLA polar stereographic (south), true at the pole, sphere R = 1737.4 km:
  rho = 2 R tan(gamma/2),  gamma = angular distance from the pole.
Orientation (which image axis is lon 0) is *detected* by checking known terrain, not assumed.
"""
import json, math, os, re, sys
import numpy as np
import shapefile

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "raw")
OUT = os.path.join(HERE, "..", "frontend", "public", "assets")
os.makedirs(os.path.join(OUT, "dem"), exist_ok=True)
R = 1737400.0


def parse_lbl(path):
    t = open(path).read()
    g = lambda k: float(re.search(rf"\b{k}\s*=\s*([-\d.]+)", t).group(1))
    return int(g("LINES")), int(g("LINE_SAMPLES")), float(g("MAP_SCALE"))


def open_dem(name):
    lines, samples, scale = parse_lbl(os.path.join(RAW, "lola", name + ".LBL"))
    a = np.memmap(os.path.join(RAW, "lola", name + ".IMG"), dtype="<i2", mode="r", shape=(lines, samples))
    return a, scale


dem20, res20 = open_dem("LDEM_80S_20M")
dem240, res240 = open_dem("LDEM_60S_240M")
print("20m", dem20.shape, res20, " 240m", dem240.shape, res240)


def lonlat_to_xy(lat, lon, mode):
    gamma = math.radians(90.0 + lat)
    rho = 2 * R * math.tan(gamma / 2)
    l = math.radians(lon)
    return {
        "sin_cos": (rho * math.sin(l), rho * math.cos(l)),     # x = rho sin(lon), y = rho cos(lon)  (PDS south-pole convention)
        "cos_sin": (rho * math.cos(l), rho * math.sin(l)),
        "sin_negcos": (rho * math.sin(l), -rho * math.cos(l)),
        "negsin_cos": (-rho * math.sin(l), rho * math.cos(l)),
    }[mode]


def sample(dem, res, xs, ys):
    """Nearest-neighbour sample at projected metres (x right, y up, centre of image = pole)."""
    n = dem.shape[0]
    col = np.floor(xs / res + n / 2).astype(np.int64)
    row = np.floor(n / 2 - ys / res).astype(np.int64)
    ok = (col >= 0) & (col < n) & (row >= 0) & (row < n)
    out = np.full(xs.shape, np.nan, dtype=np.float32)
    out[ok] = dem[row[ok], col[ok]].astype(np.float32) * 0.5
    return out


# orientation check against known terrain
CRATERS = {"Cabeus": (-84.9, -35.5, 49), "Shoemaker": (-88.1, 44.9, 26), "Faustini": (-87.3, 77.0, 20),
           "de Gerlache": (-88.5, -87.1, 16), "Haworth": (-87.5, -5.0, 26)}   # lat, lon, radius km (IAU names)


def detect_orientation():
    """Pick the image-axis convention under which five well-known polar craters read as depressions
    (rim-annulus median minus floor median). Orientation is detected, never assumed."""
    scores = {}
    for mode in ("sin_cos", "cos_sin", "sin_negcos", "negsin_cos"):
        depths = []
        for name, (la, lo, rad) in CRATERS.items():
            x, y = lonlat_to_xy(la, lo, mode)
            k = int(rad * 1500 / res20)
            c, r = int(x / res20 + dem20.shape[0] / 2), int(dem20.shape[0] / 2 - y / res20)
            blk = dem20[r - k:r + k + 1, c - k:c + k + 1].astype(np.float32) * 0.5
            gy, gx = np.mgrid[-k:k + 1, -k:k + 1] * res20 / 1000
            rr = np.hypot(gx, gy)
            ring = blk[(rr > rad * 1.15) & (rr < rad * 1.5)]
            floor = blk[rr < 3]
            depths.append(float(np.median(ring) - np.median(floor)))
        scores[mode] = depths
        print(f"  orientation {mode:11s} crater depths (m): {[round(d) for d in depths]}")
    best = max(scores, key=lambda m: min(scores[m]))
    assert min(scores[best]) > 500, "no orientation reproduces known crater depths"
    return best


MODE = detect_orientation()
print("orientation:", MODE)
if MODE != "sin_cos":
    print("WARNING: orientation is not the PDS default; geometry.ts must be updated:", MODE)
json_mode = MODE


def resample_box(dem, res, x0, y0, tres, n, sub):
    """Mean of sub x sub nearest samples inside each target pixel. x0,y0 = centre of pixel (0,0) top-left."""
    out = np.zeros((n, n), dtype=np.float32)
    offs = (np.arange(sub) + 0.5) / sub - 0.5
    cols = np.arange(n)
    for r0 in range(0, n, 128):
        rows = np.arange(r0, min(n, r0 + 128))
        acc = np.zeros((len(rows), n), dtype=np.float32)
        cnt = np.zeros_like(acc)
        for oy in offs:
            for ox in offs:
                X = x0 + (cols[None, :] + ox) * tres + np.zeros((len(rows), 1))
                Y = y0 - (rows[:, None] + oy) * tres + np.zeros((1, n))
                v = sample(dem, res, X, Y)
                m = ~np.isnan(v)
                acc[m] += v[m]; cnt[m] += 1
        out[r0:r0 + len(rows)] = np.where(cnt > 0, acc / np.maximum(cnt, 1), np.nan)
    return out


def to_int16(a):
    a = np.where(np.isnan(a), -32768 * 0.5, a)       # NaN -> sentinel -16384 m (treated as "no data")
    return np.clip(np.round(a * 2.0), -32768, 32767).astype("<i2")


meta = {"R": R, "scale": 0.5, "orientation": json_mode, "grids": {}}


def write_grid(name, arr, cx, cy, tres, n):
    to_int16(arr).tofile(os.path.join(OUT, "dem", name + ".bin"))
    meta["grids"][name] = {"file": f"dem/{name}.bin", "n": n, "res": tres,
                            "x0": cx - (n - 1) / 2 * tres, "y0": cy + (n - 1) / 2 * tres}
    mb = os.path.getsize(os.path.join(OUT, "dem", name + ".bin")) / 1e6
    print(f"  wrote {name}: {n}x{n} @ {tres} m  {mb:.1f} MB   min {np.nanmin(arr):.0f} max {np.nanmax(arr):.0f} m")


# far (480 m, to 70S)
N0, RES0 = 2560, 480.0
print("far.bin")
far = resample_box(dem240, res240, (0 - (N0 - 1) / 2 * RES0), ((N0 - 1) / 2 * RES0), RES0, N0, 2)
# Replace the polar cap (<305 km, i.e. 80S+) with the 20 m product, area-averaged.
gx, gy = np.meshgrid(np.arange(N0), np.arange(N0))
X = (gx - (N0 - 1) / 2) * RES0; Y = ((N0 - 1) / 2 - gy) * RES0
cap = np.hypot(X, Y) < 300000
hi = resample_box(dem20, res20, -(N0 - 1) / 2 * RES0, (N0 - 1) / 2 * RES0, RES0, N0, 12)
far = np.where(cap & ~np.isnan(hi), hi, far)
write_grid("far", far, 0.0, 0.0, RES0, N0)

# global mid (240 m, to 80S)
NG, RESG = 2536, 240.0
print("mid_global.bin")
mg = resample_box(dem20, res20, -(NG - 1) / 2 * RESG, (NG - 1) / 2 * RESG, RESG, NG, 6)
write_grid("mid_global", mg, 0.0, 0.0, RESG, NG)

# sites + regions
REGION_NAMES = {
    "PCB": "Peak near Cabeus B", "HW": "Haworth", "MMA": "Malapert Massif", "MMP": "Mons Mouton Plateau",
    "MMO": "Mons Mouton", "NR1": "Nobile Rim 1", "NR2": "Nobile Rim 2", "dGR2": "de Gerlache Rim 2", "SP": "Slater Plain",
}
sf = shapefile.Reader(os.path.join(RAW, "sites", "x", "y", "LandingSites"))
fields = [f[0] for f in sf.fields[1:]]
sites_by_region = {}
for rec in sf.records():
    d = dict(zip(fields, list(rec)))
    sites_by_region.setdefault(d["Landing_Re"], []).append(d)


def mean_dir(items):
    v = np.zeros(3)
    for s in items:
        la, lo = math.radians(s["Latitude"]), math.radians(s["Longitude"])
        v += [math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la)]
    v /= np.linalg.norm(v)
    return math.degrees(math.asin(v[2])), math.degrees(math.atan2(v[1], v[0]))


regions = []
for rid, name in REGION_NAMES.items():
    items = sites_by_region[rid]
    lat, lon = mean_dir(items)
    sites = []
    for s in items:
        sites.append({
            "id": s["Name"], "region": rid, "lat": round(s["Latitude"], 5), "lon": round(s["Longitude"], 5),
            "psrAreaM2": s["PSR_AREA"], "psrId": s["ID"],
            "publishedSunDays": {str(2025 + i): s[k] for i, k in enumerate(
                ["SunDays25", "SunDays26", "SunDays27", "SunDays28", "SunDays29", "Sundays30", "SunDays31", "Sundays32"])},
            "publishedSunEarthDays": {str(2025 + i): s[k] for i, k in enumerate(
                ["Sun_Earth2", "SunEarth26", "SunEarth27", "SunEarth28", "SunEarth29", "SunEarth30", "SunEarth31", "SunEarth32"])},
        })
    regions.append({"id": rid, "name": name, "lat": round(lat, 4), "lon": round(lon, 4), "artemis3": True, "sites": sites})
# Shackleton rim crest, located from the DEM itself: crater floor = lowest point within 8 km of the pole,
# rim = highest point on the 9-13 km annulus around it (the ridge toward the de Gerlache connecting ridge).
def find_shackleton_rim():
    k = int(16000 / res20); c0 = dem20.shape[0] // 2
    blk = dem20[c0 - k:c0 + k + 1, c0 - k:c0 + k + 1].astype(np.float32) * 0.5
    gy, gx = np.mgrid[-k:k + 1, -k:k + 1] * res20
    near_pole = np.hypot(gx, gy) < 8000
    fi = np.argmin(np.where(near_pole, blk, np.inf)); fy, fx = np.unravel_index(fi, blk.shape)
    rr = np.hypot(gx - gx[fy, fx], gy - gy[fy, fx])
    ring = (rr > 9000) & (rr < 13000)
    ri = np.argmax(np.where(ring, blk, -np.inf)); ry, rx = np.unravel_index(ri, blk.shape)
    x, y = gx[ry, rx], -gy[ry, rx]            # image rows grow downward; y is up
    rho = math.hypot(x, y); g = 2 * math.atan(rho / (2 * R))
    return -math.degrees(math.pi / 2 - g), math.degrees(math.atan2(x, y)), float(blk[ry, rx]), float(blk[fy, fx])
slat, slon, rimh, floorh = find_shackleton_rim()
print(f"Shackleton rim crest: {slat:.3f}, {slon:.2f}  rim {rimh:.0f} m, floor {floorh:.0f} m")
regions.append({"id": "SHK", "name": "Shackleton rim (classic teaching site)", "lat": round(slat, 4), "lon": round(slon, 3),
                "artemis3": False, "sites": [{"id": "SHK-rim", "region": "SHK", "lat": round(slat, 5), "lon": round(slon, 4)}]})

# region tiles
NM, RESM = 840, 120.0     # 100.8 km
NN, RESN = 1100, 20.0     # 22 km
for reg in regions:
    cx, cy = lonlat_to_xy(reg["lat"], reg["lon"], MODE)
    # snap the centre to a 20 m pixel boundary so mid/near grids align with the source
    cx = round(cx / 120.0) * 120.0; cy = round(cy / 120.0) * 120.0
    reg["cx"], reg["cy"] = cx, cy
    print(reg["id"], reg["name"], reg["lat"], reg["lon"])
    nearA = resample_box(dem20, res20, cx - (NN - 1) / 2 * RESN, cy + (NN - 1) / 2 * RESN, RESN, NN, 1)
    write_grid(reg["id"] + "_near", nearA, cx, cy, RESN, NN)
    midA = resample_box(dem20, res20, cx - (NM - 1) / 2 * RESM, cy + (NM - 1) / 2 * RESM, RESM, NM, 6)
    write_grid(reg["id"] + "_mid", midA, cx, cy, RESM, NM)

# Pole-centred tiles (40 m to +-40 km, 120 m to +-100 km): serve clicked points near the pole and the 85-90 S validation sets.
print("POLE")
NPN, RESPN, NPM, RESPM = 2000, 40.0, 1668, 120.0
nearP = resample_box(dem20, res20, -(NPN - 1) / 2 * RESPN, (NPN - 1) / 2 * RESPN, RESPN, NPN, 2)
write_grid("POLE_near", nearP, 0.0, 0.0, RESPN, NPN)
midP = resample_box(dem20, res20, -(NPM - 1) / 2 * RESPM, (NPM - 1) / 2 * RESPM, RESPM, NPM, 6)
write_grid("POLE_mid", midP, 0.0, 0.0, RESPM, NPM)
regions.append({"id": "POLE", "name": "South pole (validation & custom points)", "lat": -90.0, "lon": 0.0, "cx": 0.0, "cy": 0.0, "artemis3": False, "hidden": True, "sites": []})

# Global fallback for sites anywhere on the Moon: LOLA LDEM_16 (1/16 deg, ~1.9 km), simple cylindrical, already Int16 LE at
# 0.5 m relative to 1737.4 km. Row 0 is centred on lat 90 - 1/32, column 0 on east longitude 1/32.
glob = np.fromfile(os.path.join(RAW, "lola", "LDEM_16.IMG"), dtype="<i2")
assert glob.size == 5760 * 2880
glob.tofile(os.path.join(OUT, "dem", "global_16.bin"))
meta["grids"]["global"] = {"file": "dem/global_16.bin", "type": "cylindrical", "ppd": 16, "nLon": 5760, "nLat": 2880,
                           "source": "LOLA LDEM_16 (GDR V3.1)"}

json.dump(meta, open(os.path.join(OUT, "dem", "dem.json"), "w"), indent=1)
json.dump({"source": "Wueller et al. 2026, JGR Planets 131(3) e2025JE009434; Zenodo 10.5281/zenodo.17084058 (CC-BY-4.0). "
                     "Region centres are the mean direction of the region's candidate sites (ours). SHK is a teaching site (ours).",
           "regions": regions}, open(os.path.join(OUT, "sites.json"), "w"), indent=1)
print("done")
