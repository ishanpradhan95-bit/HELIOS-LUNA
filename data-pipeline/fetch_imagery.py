#!/usr/bin/env python3
"""Download the independent reference data for validation tests 5 and 6 into data-pipeline/raw/imagery/.
  PGDA  (LOLA team, Mazarico et al. 2011): AVGVISIB_85S_060M_201608 (Sun) and _EARTH (Earth) average visibility, 60 m, 85-90 S
  LROC  WAC_POLE_ILL_PCT_SOUTH_100M: percentage-lit map from 3807 WAC images, 2010-02-15..2011-02-05, 88-90 S (Speyerer & Robinson 2013)
  LROC  WAC polar movie frames (BDRWMV): single-orbit WAC mosaics with UTC in the file name; 8-bit browse TIF + validity mask
Frames are chosen by a fixed rule (one per ~30.4 days from 2010-03-01, first south-pole frame at/after the target) so the
selection cannot be tuned to the outcome. Resumable.
"""
import json, os, subprocess, sys, datetime as dt
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "raw", "imagery"); os.makedirs(OUT, exist_ok=True)

def get(url, dest):
    if os.path.exists(dest) and os.path.getsize(dest) > 0: print("have", os.path.basename(dest)); return
    print("get ", os.path.basename(dest), flush=True)
    subprocess.run(["curl", "-fL", "--retry", "5", "-C", "-", "-sS", "-o", dest + ".part", url], check=True)
    os.replace(dest + ".part", dest)

PGDA = "http://imbrium.mit.edu/EXTRAS/ILLUMINATION/IMG"
for f in ("AVGVISIB_85S_060M_201608", "AVGVISIB_85S_060M_201608_EARTH"):
    for e in ("LBL", "IMG"): get(f"{PGDA}/{f}.{e}", f"{OUT}/{f}.{e}")

STORE = "https://pds.mcp.nasa.gov/data/store/img/lunar_reconnaissance_orbiter/pds4/lroc/lro-l-lroc-5-rdr/LROLRC_2001"
PCT = f"{STORE}/EXTRAS/BROWSE/WAC_POLE/WAC_POLE_ILL_PCT_SOUTH/WAC_POLE_ILL_PCT_SOUTH_100M"
FULL = f"{STORE}/DATA/BDR/WAC_POLE/WAC_POLE_ILL_PCT_SOUTH/WAC_POLE_ILL_PCT_SOUTH_100M"
get(FULL + ".IMG", f"{OUT}/WAC_PCT_full.IMG"); get(FULL + ".xml", f"{OUT}/WAC_PCT_full.xml")   # Float32 percent (the TIF is an 8-bit browse stretch)
get(PCT + ".TIF", f"{OUT}/WAC_POLE_ILL_PCT_SOUTH_100M.TIF"); get(PCT + ".xml", f"{OUT}/WAC_POLE_ILL_PCT_SOUTH_100M.xml")

ODE = "https://oderest.rsl.wustl.edu/live2/?target=moon&query=product&results=m&ihid=LRO&iid=LROC&pt=BDRWMV&output=json"
frames = []
t0 = dt.datetime(2010, 3, 1)
for k in range(12):
    a = t0 + dt.timedelta(days=k * 365.25 / 12 + (k % 4) * 0.25)          # varied time of day, fixed rule
    names = []
    for span in (1.0, 3.0, 7.0):                      # fixed widening rule if the archive has a gap
        b = a + dt.timedelta(days=span)
        url = f"{ODE}&minobtime={a:%Y-%m-%dT%H:%M:%S}&maxobtime={b:%Y-%m-%dT%H:%M:%S}&limit=80"
        d = json.loads(subprocess.run(["curl", "-fsSL", "--retry", "3", "--max-time", "120", url], check=True, capture_output=True, text=True).stdout)["ODEResults"]["Products"]
        if isinstance(d, str): continue
        names = sorted({p["External_url"].rsplit("/", 1)[1][:-4] for p in d["Product"] if "_S2" in p["External_url"]})
        if names: break
    if not names: print("no south frame near", a); continue
    frames.append(names[0]); print("frame", k, names[0], f"(target {a:%Y-%m-%d %H:%M})")
json.dump(frames, open(f"{OUT}/frames.json", "w"))
B = f"{STORE}/EXTRAS/BROWSE/WAC_POLE/WAC_POLE_MOVIE_SOUTH"
for n in frames:
    get(f"{B}/{n}.TIF", f"{OUT}/{n}.TIF"); get(f"{B}/{n}.MASK.TIF", f"{OUT}/{n}.MASK.TIF")
print("imagery fetch complete")
