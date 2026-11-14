"""Bake analytical lunar ephemeris samples for the 2026-2030 mission interval."""
from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from pathlib import Path

DAY_MS = 86_400_000.0
J2000_JD = 2_451_545.0
START_MS = datetime(2026, 1, 1, tzinfo=timezone.utc).timestamp() * 1000
END_MS = datetime(2030, 1, 1, tzinfo=timezone.utc).timestamp() * 1000


def radians(value: float) -> float:
    return math.radians(value)


def wrap_degrees(value: float) -> float:
    return value % 360.0


def vector(distance: float, latitude: float, longitude: float) -> list[float]:
    return [
        distance * math.cos(latitude) * math.cos(longitude),
        distance * math.cos(latitude) * math.sin(longitude),
        distance * math.sin(latitude),
    ]


def sample(timestamp_ms: float) -> dict[str, object]:
    jd = timestamp_ms / DAY_MS + 2_440_587.5
    centuries = (jd - J2000_JD) / 36_525.0
    d = radians(wrap_degrees(297.8501921 + 445267.1114034 * centuries))
    m = radians(wrap_degrees(357.5291092 + 35999.0502909 * centuries))
    mp = radians(wrap_degrees(134.9633964 + 477198.8675055 * centuries))
    f = radians(wrap_degrees(93.2720950 + 483202.0175233 * centuries))
    omega = radians(wrap_degrees(125.0445479 - 1934.1362891 * centuries))
    inclination = radians(1.54242)
    delta_longitude = radians(
        -6.2888 * math.sin(mp)
        - 1.2740 * math.sin(2 * d - mp)
        - 0.6583 * math.sin(2 * d)
        - 0.2136 * math.sin(2 * mp)
        + 0.1851 * math.sin(m)
        + 0.1143 * math.sin(2 * f)
    )
    beta = radians(
        -5.1282 * math.sin(f)
        - 0.2806 * math.sin(mp + f)
        - 0.2777 * math.sin(mp - f)
        - 0.1732 * math.sin(2 * d - f)
    )
    w = delta_longitude - radians(0.0048 * math.sin(omega))
    earth_longitude = math.atan2(
        math.sin(w) * math.cos(beta) * math.cos(inclination) - math.sin(beta) * math.sin(inclination),
        math.cos(w) * math.cos(beta),
    )
    earth_latitude = math.asin(
        -math.sin(w) * math.cos(beta) * math.sin(inclination) - math.sin(beta) * math.cos(inclination)
    )
    earth_distance = (
        385000.56
        - 20905.355 * math.cos(mp)
        - 3699.111 * math.cos(2 * d - mp)
        - 2955.968 * math.cos(2 * d)
        - 569.925 * math.cos(2 * mp)
    ) * 1000.0
    solar_longitude = (earth_longitude + math.pi - d + radians(0.185 * math.sin(mp) - 0.032 * math.sin(m)) + math.pi) % (2 * math.pi) - math.pi
    corrected_omega = radians(0.012 * math.sin(2 * f))
    solar_latitude = radians(1.54242 * math.sin(f - d + corrected_omega))
    solar_distance = 1.495978707e11 * (1.00014 - 0.01671 * math.cos(m) - 0.00014 * math.cos(2 * m))
    return {
        "timestampMs": timestamp_ms,
        "julianDate": jd,
        "earthM": vector(earth_distance, earth_latitude, earth_longitude),
        "sunM": vector(solar_distance, solar_latitude, solar_longitude),
        "earthLongitudeRad": earth_longitude,
        "earthLatitudeRad": earth_latitude,
        "sunDistanceM": solar_distance,
    }


def main() -> None:
    output = Path(__file__).resolve().parents[1] / "frontend" / "public" / "assets" / "ephemeris_2026_2030.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    step_ms = 86_400_000.0
    samples = [sample(START_MS + index * step_ms) for index in range(int((END_MS - START_MS) / step_ms) + 1)]
    output.write_text(json.dumps({"startMs": START_MS, "endMs": END_MS, "stepMs": step_ms, "samples": samples}, separators=(",", ":")) + "\n", encoding="utf-8")
    print(output)


if __name__ == "__main__":
    main()
