# HELIOS·LUNA architecture (as built)

A static web application that answers, for any landing site and any touchdown time between 2026 and 2044: *when will
this lander have sunlight, when can it talk to Earth, and how sure are we?* Everything runs in the browser; the
heavy, slow inputs (SPICE ephemeris, LOLA terrain, horizon atlases) are baked once by an offline pipeline.

`HELIOS_LUNA_v2_architecture.md` is the original design; this file describes what was built and why it differs.

## 1. Challenge objectives and where they are met

| Objective (challenge text) | What the tool does | Where |
|---|---|---|
| Curated sites (Apollo, CLPS, commercial, other nations) and custom coordinates | 79 Artemis III candidate sites (Wueller et al. 2026), 22 mission sites (Apollo 11–17, IM-1, IM-2, Blue Ghost 1, Chandrayaan-3, SLIM, Chang'e 3–6, Luna, CLPS targets), any `lat, lon` typed or clicked on a map; search with ⌘K | `data/missions.json`, `data/catalogue.ts`, `components/SitePicker.tsx` |
| Side-by-side comparison | Site × arrival-date matrix, scorecards for up to 4 pinned sites, printable mission brief | `Compare.tsx`, `Brief.tsx` |
| Date **and time** flexibility, lunar days and seasons | Touchdown date and UTC time; matrix spans 60–365 days; 19-year context per site; slip analysis | `App.tsx` scenario bar, `Sky.tsx`, `SlipPanel.tsx` |
| Sun and Earth relative to the horizon | 360° panorama on the exact LOLA horizon with true-size Sun and Earth (with Earth's phase) and their tracks; live south-pole map with ray-traced shadows | `Sky.tsx`, `PoleView.tsx`, `shaders/poleShade.frag.glsl` |
| Time remaining before sunset or Earthset | Operations clock: time to sunset/sunrise, Earthset/Earthrise and DSN loss/acquisition, terrain-aware, to the minute, live while scrubbing | `engine.events()`, `OpsClock.tsx` |
| Solar elevation, sunlight duration, Earth visibility windows | Solar and Earth elevation (max, mean), sunlit %, longest dark, array output for three array geometries, per-station pass list | `analysis.ts`, `Sky.tsx`, `Compare.tsx` |
| Multiple visualisation approaches | Panorama, live GPU pole map (shadow / Earth / both layers), regional GPU map, heat-map matrix, timelines, slip chart, horizon plots in the brief | components |
| Temporal dynamics | Play the stay (panorama and pole map), scrubbable station timeline, 19-year bars | `Sky.tsx`, `PoleView.tsx` |
| Accessibility across skill levels | One clean interface for everyone: plain-language verdicts and GO / CHECK / NO-GO grades, a guided printable lesson, light and dark themes, works on a phone | `App.tsx`, `Lesson.tsx` |
| Airless horizon, libration, orbital variation, real topography | No refraction; horizon = LOLA terrain or the limb of the sphere; DE440 ephemeris includes libration and orbit; 20 m–1.9 km terrain to 300 km | `horizon.ts`, `bake_ephemeris.py` |
| When to land | Landing-window finder: touchdown hours with Sun elevation in range, station contact through descent, and a stay meeting the profile; .ics export | `engine.windows()`, `Windows.tsx` |
| Where in the landing zone | Zone analysis: per-point slope and horizon over a 100 m–2 km zone | `engine.zone()`, `ZonePanel.tsx` |
| Respond to schedule slips; coordinate teams | Slip panel (−14…+60 days, nearest acceptable dates), saved plans with a change table, shareable links, CSV/JSON exports, mission brief | `SlipPanel.tsx`, `Plans.tsx`, `useStore.ts` |

## 2. Data

| Input | Product | Use |
|---|---|---|
| Sun, Earth, Earth orientation | NAIF SPICE: `de440s.bsp`, `moon_pa_de440_200625.bpc`, `moon_de440_250416.tf`, `earth_1962_260806_2126_combined.bpc`, `naif0012.tls` | baked hourly 2026–2044, MOON_ME, light time + stellar aberration (`bake_ephemeris.py`) |
| South-polar terrain | LOLA `LDEM_80S_20M`, `LDEM_60S_240M` (PDS) | 20 m and 120 m tiles per Artemis region, 40 m / 120 m pole tiles, 240 m and 480 m polar grids (`build_dem.py`) |
| Global terrain | LOLA `LDEM_16` (1/16°, ≈1.9 km, PDS) | horizons for sites anywhere on the Moon |
| Candidate sites | Wueller et al. 2026 (Zenodo 10.5281/zenodo.17084058, CC-BY-4.0), NASA Artemis III regions (Oct 2024) | catalogue |
| Mission sites | published lander positions (mostly LROC NAC) | `missions.json` |
| Deep Space Network | DSS-14, DSS-63, DSS-43 geodetic positions | `stations.json` |
| Validation references | PGDA illumination maps, LROC WAC frames and percent-lit map, SPICE, JPL Horizons API | `fetch_imagery.py`, `dsn_reference.py`, `horizons_reference.ts` |

The 120 MB of terrain and atlases are a GitHub Release asset; `npm run setup` (run automatically by `dev`/`build`)
downloads, checksums and unpacks it.

## 3. Computation

**Ephemeris.** Float32 records hourly: Sun and Earth vectors from the Moon's centre (km, MOON_ME, LT+S) and the
ITRF93→MOON_ME quaternion. Linear interpolation of vectors, slerp of the quaternion. Error vs SPICE < 0.0001°, vs JPL
Horizons < 0.0002°.

**Exact horizon with exact mast height.** For each of 1440 azimuths a ray marches along the great circle in 3-D (no
parabolic curvature approximation) from 10 m to 300 km, sampling the finest available grid (20 m → 120 m → 240 m →
480 m → 1.9 km global). For a sample at horizontal distance *h*, raising the observer by *z* changes
tan θ = a − z/h exactly, so the horizon at any mast height is the upper envelope of lines; only non-dominated lines
are kept (convex hull), giving the exact horizon for every height from 0 to 50 m without re-marching. The minimum
mast that meets a set of requirements is a bisection on that envelope. An early exit uses the highest terrain in the
grids as a strict bound.

**Visibility.** The Sun (radius from its distance) and Earth are integrated as discs in vertical strips clipped at the
horizon; Earth eclipsing the Sun is a two-disc overlap. "Sunlit" = visible fraction above a threshold.

**Direct-to-Earth link.** A station counts only if (1) it is above the lander's terrain horizon by the lander mask and
(2) the lander is above the station's local horizon by the station mask; station positions are WGS84 points rotated
into MOON_ME and added to the apparent Earth vector. Checked against SPICE by a separate route (test 11).

**Power.** Output = rated array power × visible Sun disc × cos(incidence) for a vertical Sun-tracking, horizontal, or
two-axis array; a battery balance with load and a heater when dark gives minimum state of charge and the time the
battery runs flat.

**Operations clock.** From any instant, the next two transitions of Sun (lit threshold), Earth (centre above terrain)
and link are found at 10-minute steps up to 45 days ahead and refined by bisection to under a minute.

**Landing windows.** One hourly series per site over the search span plus the stay; each candidate touchdown hour is
checked for Sun visibility and elevation range, an unbroken station link through the descent hours, and the
requirements over the following stay (the summary is recomputed per hour from the same series). Contiguous hours form
a window.

**Landing zone.** Points on a grid inside the zone circle, each with its own 360-azimuth horizon to 300 km and slope
from the finest terrain (±30 m differences); reported as the share of the zone that is flat (< 10°) and meets the
profile, with worst/median/best values.

**Scenario tools.** Site × date matrix (hourly series reused across arrival days), slip panel,
19-year context, neighbour-cell sensitivity band.

**GPU views.** *Live pole*: a fragment shader ray-marches every pixel through nested terrain textures toward the Sun
and Earth on the curved Moon (penumbra from the clearance angle), with lunar-Lambert photometry and filmic tone
mapping; 20 m tiles stream in when zoomed. Agreement with the point engine: 82/83 overview checks, 42/42 at 20 m.
*Region map*: a shader integrates a whole stay for each 120 m cell of a 15 km region from baked 3-D horizon atlases.

**Execution.** The engine runs in a Web Worker (Node for the pipeline: the same TypeScript); the UI (React, Zustand)
coalesces requests so slider drags never queue work, and marks results that are recomputing.

## 4. Validation (regenerated by `npm run validate`, shown under Methods & validation)

1 SPICE az/el · 2 horizon vs analytic cases · 3 convergence in azimuths and reach · 4 atlas vs point engine ·
5 PGDA long-term Sun and Earth visibility · 6 LROC WAC frames at their UTC (with mirrored and shifted controls) ·
7 performance · 8 exact mast envelope vs physical re-march · 9 published SunDays (inconclusive, explained) ·
10 LROC WAC percent-lit map · 11 DSN link geometry vs SPICE · 12 Sun/Earth vs JPL Horizons.
Thresholds for 5, 6 and 10 were fixed before running (`data-pipeline/VALIDATION_PROTOCOL.md`).

## 5. Differences from the original design

* TypeScript engine shared by browser and pipeline instead of Python/Numba.
* Exact convex mast envelope instead of baked height layers (a quadratic fit through layers was off by > 2°, test 8).
* Global coverage added with LOLA LDEM_16 so mission sites anywhere on the Moon work.
* 2-D GPU views (live pole, region map) instead of a Three.js 3-D scene.
* DEM-error uncertainty (clone ensembles) not built; the band is neighbour-cell sensitivity.

## 6. Known limits

Geometric link only (no link budget or antenna pattern); first-order power with editable placeholder hardware; global
terrain is 1.9 km (mountains on the horizon are right, boulders near the lander are not); 2026–2044 only.
