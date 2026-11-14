# External validation protocol (fixed before the first run, 2026-11-14)

Reference data are downloaded by `fetch_imagery.py` and prepared by `prep_imagery.py`; comparisons are in `external.ts`.
Thresholds, metrics, point sets and frame selection below were set before any comparison was computed. The only
analysis performed beforehand was characterising the *references themselves* (orientation, units, bimodality).

| Test | Reference | Our quantity | Pass |
|---|---|---|---|
| 5 | PGDA AVGVISIB_85S_060M_201608 (+ _EARTH): fraction of hourly steps with ANY part of the disc visible, 60 m | same definition, 2-hourly 2026–2044, observer z = 0, nearest pixel; 300 pole points (ρ < 38 km) + 6 regions at 85–87°S, 70 points each | \|bias\| < 2 points and Pearson r > 0.95, for Sun and Earth |
| 10 | WAC_POLE_ILL_PCT_SOUTH_100M (Float32 percent, 3807 WAC images, 2010-02-15 … 2011-02-05) | % of hourly steps in that span with Sun disc > 50 % visible, 2010 SPICE ephemeris, z = 0; 600 pole points | \|bias\| < 3 points and r > 0.9 (imagery-vs-LOLA-model agreement is r = 0.944, so a stricter bar tests the reference) |
| 6 | 12 WAC polar movie frames, UTC from the file name + 3.5 min; first south frame at/after the target dates (2010-03-01 + k·30.44 d, hour varied by k mod 4; windows widen 1 → 3 → 7 days if the archive has a gap) | predicted lit = Sun disc > 50 %; image lit = per-frame Otsu threshold over valid pixels in the 38 km disc; 1500 pole points | pooled MCC > 0.6; mirrored-azimuth control < 0.3; +7-day-shift control < 0.3 |

Orientation of all WAC rasters: identity, chosen by correlating the WAC percent map with PGDA's map under the 8 dihedral
transforms (r = 0.944 vs ≤ 0.22 for the rest). This is independent of the frame comparison and was re-scanned on the frames as a check.
Results, including failures, are written to `frontend/public/assets/validation.json` unchanged.
