"""Bake a permanently-shadowed-region (PSR) mask for the browser.

Source: PGDA AVGVISIB_85S_060M_201608 (Mazarico et al. 2011), average Sun visibility at 60 m, 85-90 S,
polar stereographic. A 120 m output cell is PSR when at least 3 of its four 60 m cells never see the Sun
(average visibility exactly 0). Output: frontend/public/assets/psr_120.bin, row-major bits (MSB first),
row 0 = +y edge, plus psr_120.json with the grid geometry.
"""
import json, sys
import numpy as np

SRC = "data-pipeline/raw/imagery/AVGVISIB_85S_060M_201608.IMG"
NP = 5058
a = np.fromfile(SRC, dtype="<i2").reshape(NP, NP)
n = NP // 2  # 2529 cells of 120 m
z = (a[: 2 * n, : 2 * n] == 0).astype(np.uint8)
cnt = z[0::2, 0::2] + z[1::2, 0::2] + z[0::2, 1::2] + z[1::2, 1::2]
psr = cnt >= 3
bits = np.packbits(psr.astype(np.uint8), axis=None)
bits.tofile("frontend/public/assets/psr_120.bin")
meta = {
    "source": "PGDA AVGVISIB_85S_060M_201608 (LOLA, Mazarico et al. 2011): cells with zero average Sun visibility",
    "n": int(n),
    "cell_m": 120,
    "half_extent_m": NP / 2 * 60,
    "rule": "120 m cell is PSR when >= 3 of 4 60 m cells have average Sun visibility 0",
    "psr_cells": int(psr.sum()),
    "psr_km2": round(float(psr.sum()) * 0.0144, 1),
}
json.dump(meta, open("frontend/public/assets/psr_120.json", "w"), indent=1)
print(meta, bits.nbytes)
