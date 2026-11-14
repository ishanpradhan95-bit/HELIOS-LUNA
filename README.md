# HELIOS-LUNA

HELIOS-LUNA is a static lunar south-pole mission-design workstation. The
repository contains an offline Python asset pipeline and a Vite/React
frontend. The frontend is serverless at runtime: candidate-site metadata,
DEM tensors, horizon tensors, and analytical ephemeris are generated into
`frontend/public/assets`.

## Run

```text
npm install
npm run dev
```

The production checks are:

```text
npm run typecheck
npm run build
```

## Data pipeline

Python 3.10+ is required for asset generation. Run the deterministic fallback
generator before serving the app:

```text
python data-pipeline/generate_default_assets.py
python data-pipeline/bake_ephemeris.py
python data-pipeline/bake_horizons.py
```

The generated site tensors use little-endian `Float32` DEM channels with shape
`[4, 128, 128]` and `Uint8` horizon tensors with shape
`[3, 128, 128, 180]`. Horizon quantization is `round((degrees + 10) * 5)`.
The NASA fetch script is optional and accepts a trusted asset URL; the
deterministic assets remain available without network access.

## Mission model

The TypeScript math modules implement lunar stereographic and ENU transforms,
the specified analytical Sun/Earth ephemeris, fractional solar-disk
visibility, mast interpolation and structural mass, Ka/S-band terrain link
loss, radiative thermal behavior, and mission-state controls for the four
candidate sites.
