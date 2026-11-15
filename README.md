# HELIOS·LUNA: Lunar Landing Site Navigator

Project live at https://helios-luna-ls.vercel.app/ and https://ishanpradhan95-bit.github.io/HELIOS-LUNA/

NASA Space Apps Challenge 2026 · *Compare lunar south-pole landing sites and dates; see the Sun and Earth against the real horizon; assess power and direct-to-Earth windows.*

Pick a site and a date to see your week on the Moon: when you have power, when you can talk to Earth, and how sure we are. If it doesn't work out, say what the mission needs and it finds where, when and how tall.

Static app with no backend. Implements [`HELIOS_LUNA_v2_architecture.md`](HELIOS_LUNA_v2_architecture.md). Numbers come from LOLA terrain and SPICE ephemeris.

## Built for the challenge

| The challenge asks for | HELIOS·LUNA |
|---|---|
| Compare landing sites and dates quickly | Site × date matrix, up to 4 side-by-side scorecards, ⌘K search over 100+ sites (Artemis III candidates, Apollo, CLPS, Chandrayaan-3, SLIM, Chang'e, Luna) or any `lat, lon` |
| Sun and Earth positions relative to the horizon | Exact LOLA horizon (to 300 km, curved Moon, no refraction) with true-size Sun and Earth, Earth's phase, and a live GPU-rendered south pole with ray-traced shadows |
| Time remaining before sunset or Earthset | Operations clock: sunset/sunrise, Earthset/Earthrise and DSN loss/acquisition, to the minute |
| Power generation potential | Solar elevation, sunlit %, longest darkness, array output for three array geometries, battery state of charge |
| Direct-to-Earth windows | Station-resolved passes with both elevation masks, for NASA's DSN, ESA's Estrack deep-space antennas, both, or your own (commercial) stations |
| Hand-off to engineering tools | STK terrain mask (.aem), calendar (.ics), GeoJSON, CSV, JSON; paste a list of coordinates; `npm run evaluate` batch CLI |
| Schedule slips | "If the landing slips" panel (−14 to +60 days, nearest acceptable dates) and **Plans**: save a baseline, change date or site, read a line-by-line change table |
| When can we land? | **Landing windows**: every touchdown hour with the Sun at a usable angle for the cameras, station contact through descent, and a stay that meets the profile; Gantt chart, table, calendar (.ics) export |
| Where exactly in the zone? | **Landing zone**: slope (Artemis < 10° criterion) and lighting/link spread over a 100 m–2 km zone at 20 m terrain |
| Where is the water ice? | **Water ice nearby** panel on every Compare card and the Site view: distance and direction to the nearest permanently shadowed region (where water ice can survive), its area within 5 km, a *Very close / Close / Within reach / Far* tag, and a north-up mini map of the shadowed ground around the site with the route to the nearest patch; NASA PGDA illumination maps at 120 m, 85–90°S |
| Planners, educators and the public | Guided printable lesson, plain-language verdicts, mission brief (PDF), CSV/JSON exports |
| Accuracy | 12 automated validation tests incl. JPL Horizons (< 0.0002°), SPICE, PGDA and LROC imagery |

See [`ARCHITECTURE.md`](ARCHITECTURE.md) for how each part works.

## What you can do

| View | Question | What it shows |
|---|---|---|
| **Compare** | Which site, which date? | A GO / CHECK / NO-GO scorecard for each starred site (sunlight, longest darkness, Earth link, longest outage, what happens next) and the site × arrival-date matrix, with dates that fail the profile dimmed |
| **Windows** | When can we land? | Every touchdown hour with the Sun at a usable angle for the cameras, station contact through descent and a stay that meets the profile; Gantt chart, table, calendar (.ics) export |
| **Site** | What happens there? | A *Water ice nearby* banner with a 5 km map of permanently shadowed ground, the 360° exact horizon panorama with true-size Sun and Earth, the stay timeline, a live countdown to the next sunset, Earthset and loss of signal; tabs for the numbers, saved plans, schedule slips, landing-zone slope, minimum mast, station passes and 19-year context |
| **Map** | Where does the light fall? | The south pole rendered on the GPU from LOLA terrain, every pixel ray-traced toward the SPICE Sun and Earth (shadows with penumbrae, ground that sees Earth), 20 m detail when zoomed; "Over the stay" integrates a whole stay for every 120 m cell of a region |

**Export** gives a printable one-page mission brief, GeoJSON, an STK horizon mask, landing windows (.ics) and CSVs. **Methods & validation** (in the ⋯ menu) shows the automated tests, what the tool is *not*, and data provenance.

Four views (**Compare**, **Windows**, **Site**, **Map**) under one scenario bar (touchdown date and time, stay, mast, mission profile). Every site is graded **GO / CHECK / NO-GO** against the mission profile, with presets drawn from NASA criteria. **Learn** opens a guided, printable lesson; **Methods** shows how each number is computed and validated; **Export** gives the mission brief and CSVs. Light and dark themes. Every setting that changes a number (sites, dates, mast, masks, hardware, requirements) is in the URL hash, so a shared link reproduces the analysis. Exported CSV files start with `#` lines recording those settings and the data sources (`pandas.read_csv(f, comment='#')`).

## Run

```bash
npm install
npm run dev            # http://localhost:5173
npm run build          # static bundle in frontend/dist
npm run typecheck      # frontend and data-pipeline
```

The first `npm run dev` (or `build`, `preview`) downloads the baked terrain data, about 140 MB, into `frontend/public/assets/dem` and `atlas`, checks its SHA-256 and unpacks it. This needs a network connection once. To run the step by itself, or to use an archive you already downloaded from the Releases page:

```bash
npm run setup
npm run setup -- --from path/to/helios-luna-assets-v1.tar.gz
```

Needs Node ≥ 22 and a `tar` on the PATH (built in on macOS, Linux and Windows 10+). The small baked files (ephemeris, site catalogue, validation results, ≈ 7 MB) are in the repository; the terrain data is not, because it is regenerable and large.

## Batch evaluation (command line)

```bash
npm run evaluate -- sites.csv --start 2027-01-15T06:00 --days 7 --mast 2 --profile artemis --network both
```

`sites.csv` has a header row then `name,lat,lon` lines. Output is CSV on stdout: terrain quality, GO/CHECK/NO-GO, sunlit %,
longest darkness, link %, longest outage, maximum Sun and Earth elevation, and hours to the first sunset and Earthset.

## Repository layout

```
package.json                 npm workspace root (frontend) + pipeline scripts
scripts/                     setup-assets.mjs (download terrain data), pack-assets.mjs (maintainers), assets.json (URL, checksum, file list)
Makefile                     make all  → regenerate every baked asset from raw NASA data
frontend/                    Vite + React app
  public/assets/             baked data: ephemeris.bin, sites.json, validation.json in git;
                             dem/ and atlas/ installed by `npm run setup`
  src/
    math/                    point engine (also runs in Node): geo, dem, horizon (exact march + mast-height envelope),
                             ephemeris, visibility (disc-resolved), analysis (stations, power, eclipses, scorecards),
                             engine (loading, solver, uncertainty), client (worker RPC)
    components/              PoleView (live pole), Compare, Sky, MapView (region map), Brief, Trust, Lesson,
                             OpsClock, SlipPanel, SitePicker
    data/                    stations.json, missions.json (curated landing sites), catalogue.ts
    gl/areaEngine.ts         WebGL2 area engine (region map)
    gl/poleRenderer.ts       WebGL2 live pole renderer (ray-marched shadows and Earth visibility)
    shaders/                 poleShade.frag.glsl, areaIntegration.frag.glsl, areaFullscreen.vert.glsl
    store/useStore.ts        Zustand state, serialised to the URL hash
    workers/engine.worker.ts runs the engine off the UI thread
    data/stations.json       Deep Space Network stations (editable)
data-pipeline/               offline bake + validation
  fetch_nasa_assets.sh       LOLA DEMs, SPICE kernels, Wueller et al. 2026 sites
  bake_ephemeris.py          SPICE DE440 → hourly Sun, Earth, ITRF→MOON_ME quaternion
  build_dem.py               DEM pyramid + site catalogue (detects polar-stereographic orientation from known craters)
  bake_horizons.ts           same march code, multi-threaded → per-region Sun/Earth horizon atlases
  fetch_imagery.py, prep_imagery.py   PGDA and LROC reference data for validation
  dsn_reference.py           SPICE reference geometry for the station-link test → reference/dsn_reference.json
  horizons_reference.ts      JPL Horizons reference positions → reference/horizons_reference.json
  validate.ts, external.ts   validation → frontend/public/assets/validation.json
  VALIDATION_PROTOCOL.md     thresholds fixed before the external tests were run
  requirements.txt           pinned Python dependencies
```

Key ideas and where they live:

* **Exact horizon**: great-circle march in 3-D (no parabolic curvature), 1440 azimuths, out to 300 km: [`frontend/src/math/horizon.ts`](frontend/src/math/horizon.ts).
* **Exact mast height**: per azimuth the horizon is `max_k(a_k − z/h_k)`, a convex piecewise-linear function of height, so only non-dominated lines are kept and any height is exact with no re-march. "Minimum mast" is a bisection on that function.
* **Station-resolved link**: a pass needs the station above the lander's terrain horizon by a mask *and* the Moon above the station's elevation mask. Goldstone, Madrid and Canberra, editable in `frontend/src/data/stations.json`.
* **Atlas vs point engine**: the atlas drives the map only; every scorecard number comes from the point engine.

## Regenerating the data

```bash
make venv                                   # python venv from data-pipeline/requirements.txt
make data ephemeris dem horizons imagery validate     # or: make all
make pack                                   # re-bundle dem/ and atlas/ for a new Release
```

Downloads ≈ 3.5 GB (NAIF, MIT/PDS LOLA mirror, Zenodo, LROC/PGDA; about 1.4 GB of it only for validation). The horizon bake takes ≈ 6 min on 10 cores, the full validation ≈ 5 min. Raw downloads go to `data-pipeline/raw/` (git-ignored). Needs Python ≥ 3.10 and Node ≥ 22.

## Validation

Run `npm run validate`; results are written to `frontend/public/assets/validation.json` and shown under Methods & validation.

| # | Test | Reference |
|---|---|---|
| 1 | Sun/Earth topocentric az/el | SPICE evaluated directly at off-grid epochs |
| 2 | Horizon algorithm | bare-sphere dip, Gaussian hill vs brute-force scan |
| 3 | Convergence of azimuths and reach | same sites re-run at 180–1440 az, 35–300 km |
| 4 | Atlas vs point engine | 500 random cells × 6 azimuths |
| 5 | Long-term Sun and Earth visibility | PGDA 60 m average maps, 85–90°S |
| 6 | Time-specific lit/shadow | 12 LROC WAC polar frames at their UTC, with mirrored-azimuth and +7-day controls |
| 7 | Performance budget | measured in Node |
| 8 | Exact mast height | full re-march with the observer physically raised |
| 9 | Published SunDays (Wueller et al. 2026) | inconclusive (definition not reproducible) |
| 10 | Imagery-derived illumination | LROC WAC percent-lit map from 3,807 images |
| 11 | Deep Space Network link geometry | SPICE by a separate route (constant-position stations, LT+S), 300 epochs × 3 stations × 6 sites |
| 12 | Sun / Earth positions | NASA/JPL Horizons API (DE441), observers on the lunar surface, 72 epochs × 6 sites incl. Apollo 15 and the far side |

Thresholds for 5, 6 and 10 were fixed before they were run; test 11 was added later and its thresholds are set from the size of the light-time effects it ignores ([`VALIDATION_PROTOCOL.md`](data-pipeline/VALIDATION_PROTOCOL.md)). Per-domain weaknesses (Haworth and Nobile Rim 1 in test 5) and frames where a control exceeds 0.3 are listed under Methods & validation. The checks cover 85–90°S, mostly within 38 km of the pole; the Artemis III regions farther out are checked by test 5 for six of nine regions and by no imagery.

## Limitations

Comms is geometric (no link budget); power is first-order with placeholder hardware defaults you can edit; the ± ranges are ±120 m position sensitivity, not DEM error; far-field terrain beyond 40 km is a 480 m area-averaged grid. See Methods & validation.

## Differences from the architecture document

* Atlas is 128 × 128 cells at 120 m (the doc's "LOD-128" tier); 256 × 256 is not built.
* The march routine is TypeScript (used by both the bake and the browser), not Python/Numba.
* The Map is a hill-shaded 2-D view; there is no Three.js 3-D terrain.
* Uncertainty is Tier A only (neighbour cells); DEM-clone P10–P90 is not built.
* The 20 m LOLA product to 80°S is used, not the 5 m PGDA site DEMs.
* Global coverage was added (LOLA LDEM_16) so Apollo, CLPS and other nations' landing sites work, not only the south pole.
* i18n, PWA offline caching and rover traverse are not built; the DTE solar-exclusion option is not implemented.

## Data and credits

LOLA GDR polar and global DEMs (LDEM_80S_20M, LDEM_60S_240M, LDEM_16; NASA/GSFC; PDS Geosciences Node mirror at imbrium.mit.edu) · NASA/JPL Horizons (validation) · NAIF SPICE kernels (JPL) · PGDA illumination maps (Mazarico et al. 2011) · LROC WAC polar products (Speyerer & Robinson 2013) · candidate sites: Wueller et al. 2026, *JGR Planets* 131(3) e2025JE009434, Zenodo 10.5281/zenodo.17084058 (CC-BY-4.0) · Artemis III candidate regions (NASA, Oct 2024).
