"""Generate deterministic 128x128 DEM and 180-bin horizon tensors for four lunar sites."""
from __future__ import annotations

import json
import math
import struct
from pathlib import Path

RADIUS_M = 1_737_400.0
SIZE = 128
PIXEL_M = 20.0
AZIMUTH_BINS = 180
MASTS = (0.0, 5.0, 20.0)
SITES = (
    ("shackleton", "Shackleton Connecting Ridge", -89.54, 222.0, -9310.0, -10340.0, 2150.0, 0.86),
    ("connecting_ridge", "Peak Near Shackleton", -89.78, 203.5, -10150.0, -15450.0, 2420.0, 0.91),
    ("nobile", "Nobile Rim 1", -85.20, 53.5, 17500.0, 6200.0, 1650.0, 0.68),
    ("malapert", "Malapert Massif", -85.95, 0.5, 1200.0, -39000.0, 4800.0, 0.78),
)


def elevation(site_index: int, x: float, y: float) -> float:
    scale = (site_index + 1) * 0.73
    ridge = (900 + site_index * 260) * math.exp(-((x * math.cos(scale) + y * math.sin(scale)) / 500.0) ** 2)
    basin = -(420 + site_index * 110) * math.exp(-(((x - 700) ** 2 + (y + 500) ** 2) / 1_500_000))
    undulation = 120 * math.sin(x / 180 + scale) * math.cos(y / 240 - scale)
    return ridge + basin + undulation


def build_site(site_index: int, site_id: str, illumination: float, root: Path) -> None:
    dem = [0.0] * (4 * SIZE * SIZE)
    heights = [[0.0] * SIZE for _ in range(SIZE)]
    for row in range(SIZE):
        for col in range(SIZE):
            x = (col - (SIZE - 1) / 2) * PIXEL_M
            y = (row - (SIZE - 1) / 2) * PIXEL_M
            h = elevation(site_index, x, y)
            heights[row][col] = h
            dx = (elevation(site_index, x + PIXEL_M, y) - elevation(site_index, x - PIXEL_M, y)) / (2 * PIXEL_M)
            dy = (elevation(site_index, x, y + PIXEL_M) - elevation(site_index, x, y - PIXEL_M)) / (2 * PIXEL_M)
            slope_deg = math.degrees(math.atan(math.hypot(dx, dy)))
            psr_distance = math.hypot(max(0.0, x - 700.0), max(0.0, y + 500.0))
            annual = max(0.0, min(1.0, illumination + 0.09 * math.cos(x / 1500) - 0.16 * math.exp(-psr_distance / 300)))
            index = row * SIZE + col
            dem[index] = h
            dem[SIZE * SIZE + index] = slope_deg
            dem[2 * SIZE * SIZE + index] = psr_distance
            dem[3 * SIZE * SIZE + index] = annual
    (root / f"site_{site_id}_dem.bin").write_bytes(struct.pack(f"<{len(dem)}f", *dem))

    horizons = bytearray(3 * SIZE * SIZE * AZIMUTH_BINS)
    for row in range(SIZE):
        for col in range(SIZE):
            index = row * SIZE + col
            h0 = heights[row][col]
            for mast_index, mast in enumerate(MASTS):
                for azimuth in range(AZIMUTH_BINS):
                    alpha = math.radians(azimuth * 2.0)
                    distance = 2500.0
                    local_ridge = 180.0 * math.cos(alpha + site_index * 0.73) + 70.0 * math.sin(2.0 * alpha - site_index)
                    massif = 1000.0 * math.exp(-((9000.0 - 9000.0) / 5000.0) ** 2) * (0.5 + 0.5 * math.cos(alpha + site_index))
                    best = math.atan((max(local_ridge, massif) - (h0 + mast) - distance * distance / (2 * RADIUS_M)) / distance)
                    quantized = max(0, min(255, round(math.degrees(best) * 5.0 + 50.0)))
                    offset = ((mast_index * SIZE * SIZE + index) * AZIMUTH_BINS) + azimuth
                    horizons[offset] = quantized
    (root / f"site_{site_id}_horizons.bin").write_bytes(horizons)


def main() -> None:
    root = Path(__file__).resolve().parents[1] / "frontend" / "public" / "assets"
    root.mkdir(parents=True, exist_ok=True)
    metadata = []
    for index, (site_id, name, lat, lon, x, y, ridge, illumination) in enumerate(SITES):
        build_site(index, site_id, illumination, root)
        metadata.append({"id": site_id, "name": name, "latitudeDeg": lat, "longitudeDeg": lon, "centerX": x, "centerY": y, "ridgeHeightM": ridge})
    (root / "sites_metadata.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    (root / "ephemeris_2026_2030.json").write_text(json.dumps({"epoch": "2026-01-01T00:00:00Z", "periodDays": 29.530588, "sites": metadata}, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
