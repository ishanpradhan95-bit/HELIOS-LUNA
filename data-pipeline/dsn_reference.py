#!/usr/bin/env python3
"""Reference geometry for the Deep Space Network link check (validate.ts test 11).

For random epochs 2026-2044, lander sites and the three DSN stations, SPICE computes by its own route:
  * the station's azimuth and elevation seen from the lander (spkcpt: constant-position target in ITRF93, LT+S), and
  * the lander's elevation seen from the station above the WGS84 ellipsoid normal (spkcpo, LT+S).
The app instead adds the station's ITRF93 position, rotated by the baked ITRF93->MOON_ME quaternion, to the baked
apparent Earth vector. Output: data-pipeline/reference/dsn_reference.json (small, committed, so validate.ts runs
without the SPICE kernels).
"""
import json, os
import numpy as np
import spiceypy as sp

HERE = os.path.dirname(os.path.abspath(__file__))
K = os.path.join(HERE, "raw", "kernels")
for k in ["naif0012.tls", "pck00011.tpc", "moon_pa_de440_200625.bpc", "moon_de440_250416.tf",
          "earth_combined.bpc", "de440s.bsp"]:
    sp.furnsh(os.path.join(K, k))

stations = json.load(open(os.path.join(HERE, "..", "frontend", "src", "data", "stations.json")))["stations"]
RE, F = 6378.137, 1 / 298.257223563
R_MOON = 1737.4
sites = [(-89.54, 129.0), (-88.0, 5.0), (-85.9, 0.9), (-85.4, 31.0), (-83.58, -69.08), (-87.2, 126.6)]

START, END = "2026-01-01 00:00:00 UTC", "2045-01-01 00:00:00 UTC"
et0, et1 = sp.str2et(START), sp.str2et(END)
epoch_unix_ms = int(np.datetime64("2026-01-01T00:00:00", "ms").astype("int64"))
rng = np.random.default_rng(2026)


def enu(lat, lon):
    la, lo = np.radians(lat), np.radians(lon)
    up = np.array([np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)])
    east = np.array([-np.sin(lo), np.cos(lo), 0.0])
    north = np.array([-np.sin(la) * np.cos(lo), -np.sin(la) * np.sin(lo), np.cos(la)])
    return up, east, north


samples = []
for _ in range(300):
    et = et0 + rng.uniform(0, et1 - et0 - 7200)
    lat, lon = sites[rng.integers(len(sites))]
    up, east, north = enu(lat, lon)
    site = R_MOON * up                                     # lander on the 1737.4 km sphere, MOON_ME
    out = {"unixMs": epoch_unix_ms + int(round((et - et0) * 1000)), "lat": lat, "lon": lon, "stations": {}}
    for st in stations:
        st_itrf = sp.georec(np.radians(st["lon"]), np.radians(st["lat"]), st["heightM"] / 1000, RE, F)
        # station seen from the lander
        pos, _lt = sp.spkcpt(st_itrf, "EARTH", "ITRF93", et, "MOON_ME", "OBSERVER", "LT+S", "MOON")
        v = np.array(pos[:3]) - site
        el_l = np.degrees(np.arcsin(v @ up / np.linalg.norm(v)))
        az_l = np.degrees(np.arctan2(v @ east, v @ north)) % 360
        # lander seen from the station
        st8, lt = sp.spkcpo("MOON", et, "J2000", "OBSERVER", "LT+S", st_itrf, "EARTH", "ITRF93")
        site_j = sp.pxform("MOON_ME", "J2000", et - lt) @ site
        w = sp.pxform("J2000", "ITRF93", et) @ (np.array(st8[:3]) + site_j)
        n_st = sp.surfnm(RE, RE, RE * (1 - F), st_itrf)    # WGS84 ellipsoid normal (geodetic up)
        el_s = np.degrees(np.arcsin(n_st @ w / np.linalg.norm(w)))
        out["stations"][st["id"]] = {"landerAz": float(az_l), "landerEl": float(el_l), "stationEl": float(el_s)}
    samples.append(out)

os.makedirs(os.path.join(HERE, "reference"), exist_ok=True)
dst = os.path.join(HERE, "reference", "dsn_reference.json")
json.dump({"spiceToolkit": sp.tkvrsn("TOOLKIT"), "lunarRadiusKm": R_MOON, "samples": samples}, open(dst, "w"), indent=1)
print("wrote", dst, len(samples), "epochs")
