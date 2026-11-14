"""Bake curvature-corrected DEM and horizon tensors for all candidate sites."""
from __future__ import annotations

from generate_default_assets import SITES, build_site
from pathlib import Path


def main() -> None:
    output = Path(__file__).resolve().parents[1] / "frontend" / "public" / "assets"
    output.mkdir(parents=True, exist_ok=True)
    for index, (site_id, _name, _lat, _lon, _x, _y, _ridge, illumination) in enumerate(SITES):
        build_site(index, site_id, illumination, output)
    print(output)


if __name__ == "__main__":
    main()
