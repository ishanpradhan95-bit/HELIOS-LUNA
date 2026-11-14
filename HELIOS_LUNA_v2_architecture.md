# HELIOS-LUNA v2 — Architecture & Winning Plan

**Challenge:** NASA Space Apps 2026 — Lunar Landing Site Navigator
**Status:** Proposed (supersedes the v1 "System Architecture & Engineering Specification")
**Date:** 14 Nov 2026 (hackathon weekend: 14–15 Nov)
**Deciders:** whole team; one owner each for data pipeline, engine, UI, validation/pitch

---

## 0. Summary

v1 was a good shape (bake offline, run in the browser) with a data model that is behind the 2026 field on accuracy. Other teams are already shipping 360–720 azimuth horizons out to 200–300 km, SPICE ephemerides through 2045, and published validation against LROC and PGDA. v1 has 180 azimuths, a 35 km reach, four sites (two no longer Artemis III candidates), and no validation.

v2 keeps the two-stage idea and changes what is baked and what is computed live:

| | v1 | v2 |
|---|---|---|
| Point analysis | Lookup in baked Uint8 angle tensor | **Exact horizon computed in a Web Worker on click** from a DEM pyramid, 1440 azimuths, out to 300 km |
| Mast height | Quadratic Lagrange through 0/5/20 m | **Exact for every height** via the convex obstruction envelope (§6.2) |
| Map analysis | One time step shaded on the GPU | **Whole mission window integrated per pixel on the GPU** from a 3D horizon atlas |
| Far field | 35 km (buffer only held 20 km) | 300 km, DEM extended to 70°S so the Earth-ward horizon is not truncated |
| Curvature | Parabolic `d²/2R` | Exact 3D vectors along great circles |
| Ephemeris | SPICE offline *and* a separate analytic model in the browser | One source: SPICE-baked binary, 2026–2045 |
| DTE comms | "Earth above horizon" + unsourced link model | **Station-resolved** line of sight with elevation masks at both ends |
| Sites | 4 hand-picked (2 outdated) | 9 current Artemis III regions, 130 peer-reviewed candidate sites, any clicked point |
| Uncertainty | none | DEM-error ensembles → confidence bands |
| Validation | none | 6-test plan with pass thresholds, shown in-app |
| Thermal / PV extras | Unsourced empirical curves | Removed; replaced by a transparent energy balance |

The differentiators nobody in the field has yet (§2.3): live area maps for *your* window, exact height physics with inverse queries, station-resolved DTE, and uncertainty bands.

**All performance figures in this document are targets to be measured, not measurements.** v1 listed "actual" latencies for code that did not exist; don't put unmeasured numbers in front of judges.

---

## 1. What the challenge and the judges ask for

Challenge sentence, decomposed into requirements:

| Phrase | Requirement |
|---|---|
| "intuitive tool" | A first-time user gets an answer in < 30 s with no manual. Existing tools are judged too complicated; this is the core problem statement. |
| "mission planners, educators, and the public" | Three modes over one engine, not three apps. |
| "compare landing sites and dates quickly" | Site × date is the primary axis of the UI. Comparison is the home screen, not a feature. |
| "Sun and Earth positions relative to the horizon" | The horizon panorama with Sun/Earth tracks is the mandatory visual. |
| "power generation potential" | Sunlit fraction of the solar disc → power → energy balance over the mission. |
| "direct-to-Earth communication windows" | Start/stop times of real link opportunities, not just "Earth is up". |

Judging criteria (Space Apps Judging & Awards Guide): Influence, Creativity, Validity, Relevance, Presentation. Award categories this project can target: **Best Use of Science** (validation, uncertainty), **Best Use of Data** (making LOLA/SPICE accessible), **Best Use of Technology** (GPU window integration), **Best Mission Concept**.

Mapping:

| Criterion | What earns it here |
|---|---|
| Validity | §8 validation numbers, visible in the app; honest limits page |
| Relevance | Compare-first UI; the nine *current* candidate regions |
| Creativity | Inverse queries; area maps; exact height physics |
| Influence | Works offline, on a phone, in several languages; classroom mode |
| Presentation | One 30-second story (§11) |

---

## 2. Prior art

### 2.1 Professional tools (the "complicated interfaces" the challenge refers to)

| Tool | What it does | Why it is slow for this job |
|---|---|---|
| NASA Moon Trek | Web GIS with illumination, slope, line-of-sight tools | General GIS; many clicks per site/date; no side-by-side date comparison |
| LROC QuickMap + TerrainShadows | 2D/3D shadow rendering, Sun or Earth as light source, visibility compute | Expert tool; one scene at a time |
| JPL Horizons / WebGeocalc | Exact Sun/Earth az/el for a lunar surface point | No terrain; text tables |
| NASA PGDA illumination products | 18.6-year average illumination, Earth visibility, PSR maps at 60–240 m/px | Long-term averages only; no dates |
| STK-based studies (e.g. Lafleur & Heeg 2010) | Sun/Earth access statistics for thousands of sites | Desktop licence, expert workflow |

Method lineage worth citing in the pitch: Mazarico et al. 2011 (horizon method, hourly over 18.6 years), JPL GSSR study (horizon masks compared against the regions bounding Sun and Earth motion — the same idea as our Earth-window atlas, §5.3), Barker et al. 2021 (5 m LOLA DEMs with error clones propagated to illumination).

### 2.2 The 2026 field (public repos for this same challenge, as of today)

| Project | Strengths | Gaps |
|---|---|---|
| rodneymora94965/lunar-site-navigator | SPICE DE440s; 360 az to 200 km; 2026–2045 hourly; window calendar; ±100 m position sensitivity; **validated** vs Horizons, LROC WAC, PGDA; share links, CSV | Sun treated as point for visibility; fixed 5 m observer; no ground stations or link model; heat maps precomputed at 3 h; custom points use a truncated DEM |
| pythonhack000/lunar-navigator | Whole-Moon 3D globe; 720 az to 300 km; panorama; 4-site compare; assistant | Analytic ephemeris (VSOP87/ELP); only unit tests as validation; 80 m polar DEM |
| ziyadell/Lunar-Landing-Site-Navigator | Horizons-based geometry, deployed | 4 regions, one point each, 80 m DEM, through 2028 only, disc-centre visibility |
| MoonSight, MoonSet, others | Horizons panels, FastAPI backends, 360° views | Early; no terrain-validated results |

Take this seriously: the best competitor already beats v1 on azimuth resolution, far-field reach, time span and validation. Table stakes for a top entry are now **≥360 azimuths, ≥200 km, SPICE, a compare view, a calendar, share links, and published validation**.

### 2.3 Where nobody is yet — our wedge

1. **Areas, not points, for your window.** Every project analyses pre-chosen points. The real planning question is "*where inside this 15 km region* is best for a 6.5-day stay arriving on date X?" — a map recomputed live for the chosen window, height and thresholds.
2. **Height as a first-class, exact variable.** The leading competitor reports that one site's sunlight goes 42% → 49% → 57% at 2 / 5 / 10 m, yet fixes the observer at 5 m. We make height a continuous exact slider and answer the inverse: "how tall must the mast be?"
3. **Inverse (requirements-first) queries.** Planners start from requirements, not sites: "≥ 6 days continuous sun, DTE ≥ 8 h/day, slope ≤ 8°" → ranked site × date × height answers.
4. **Station-resolved DTE.** Everyone equates "Earth disc centre above terrain" with comms. A ground station sits up to 0.95° from the disc centre as seen from the Moon — larger than typical terrain margins.
5. **Uncertainty.** PGDA publishes error clones of its 5 m DEMs. Nobody propagates them. A sunrise time with a ± band is more credible than one with four decimals.

---

## 3. Product

### 3.1 Three questions, three views

| View | Question | Core visual |
|---|---|---|
| **Compare** (home) | Which site, which date? | Site × arrival-date matrix (rows: sites; columns: days; colour: mission-window score), with 2–4 pinned sites as scorecards |
| **Sky** | What actually happens there? | 360° horizon panorama with Sun and Earth discs and their tracks; timeline strip of sun / link / both; scrubbing |
| **Map** | Where exactly, and how tall? | Region terrain coloured by the live per-pixel window integral; click any cell → Sky view for that point |

Every view shares one state: `sites[]`, `arrival`, `duration`, `height`, `requirements`. State is serialised into the URL so any comparison is a shareable link.

### 3.2 Scorecard (identical fields in every view and export)

- Sunlit % of window (disc-fraction weighted), longest continuous darkness, longest continuous sun
- DTE % of window, longest outage, number of passes per station
- "Both" % (power and link together)
- Minimum battery state of charge over the window (pass / fail against the chosen hardware profile)
- Slope at site; distance to nearest PSR
- Confidence band on the two headline percentages
- One plain-language verdict, generated from the numbers by template (no LLM needed): *"Sunlit 83 ± 4% of your 7 days. Earth link drops for 31 h starting 12 Jun 04:00 UTC. A 10 m mast removes the outage."*

### 3.3 Modes

| Mode | Changes |
|---|---|
| Planner | All numbers, thresholds, CSV/JSON export, requirements solver |
| Educator | Guided 5-step lesson ("why the Sun circles the horizon", "why a hill 100 km away matters"), printable worksheet, Earth-vs-Moon sky comparison |
| Explorer (public) | Story mode: stand on the rim, press play, watch a lunar day; verdict sentences only |

### 3.4 Reach

Static PWA, works offline after first load; phone layout; colour-blind-safe palettes with pattern/texture redundancy; keyboard operable; UI strings externalised for translation.

---

## 4. Architecture overview

```text
OFFLINE (Python, run once, reproducible with `make all`)
  LOLA DEMs (5 m sites, 20 m polar, 240 m to 60°S)   SPICE kernels (DE440, lunar PCK/FK, Earth PCK)
        |                                                   |
   build_pyramid.py                                   bake_ephemeris.py
   bake_atlas.py  (Numba, exact great-circle march)   validate_vs_horizons.py
   bake_uncertainty.py (DEM clones)                         |
        |                                                   |
        +----------------- static assets -------------------+
          dem pyramid tiles | horizon atlas per region | ephemeris.bin | sites.geojson | validation.json

BROWSER (static bundle; no backend)
  +-----------------------------+   +-----------------------------------------+
  | Point Engine (Web Worker,   |   | Area Engine (WebGL2)                    |
  | TS or Rust/WASM)            |   | - horizon atlas as 3D textures          |
  | - exact horizon + envelope  |   | - fragment shader integrates the window |
  |   for any clicked point     |   |   per pixel -> metrics texture          |
  | - 19-year hourly series     |   | - same shader lights the 3D terrain     |
  | - DTE per station, energy   |   +-----------------------------------------+
  | - requirements solver       |                    |
  +-----------------------------+                    |
                |                                    |
        Mission state (Zustand, URL-serialised)  <---+
                |
     Compare view | Sky view | Map view | Trust panel (validation + limits)
```

Two engines, one physics module. The point engine is the source of truth for every number shown on a scorecard. The area engine is for maps and for finding candidates; a cell picked from the map is always re-evaluated by the point engine before its numbers are displayed.

---

## 5. Data specifications

### 5.1 Ephemeris (`ephemeris_2026_2045.bin`)

- SPICE, offline. DE440 with the matching lunar orientation and frame kernels; target frame `MOON_ME`. The PGDA 5 m DEMs are documented as MOON_ME of DE421; the DE421/DE440 mean-Earth frames differ at about the metre level, negligible against a 5 m pixel, but state which was used. (v1 paired `moon_pa_de440` with the DE421-era `moon_080317.tf`; use the DE440-matched frame kernel — check the exact filename on NAIF.)
- Hourly, 2026-01-01 to 2044-12-31: 166,554 records. One full 18.6-year nodal cycle, so "best/worst year" statements are meaningful.
- Record (Float32 × 10 = 40 B): Sun position (km, 3), Earth-centre position (km, 3), quaternion ITRF→MOON_ME (4). **6.4 MB raw.**
- Positions, not unit directions: the observer's offset from the Moon's centre shifts Earth's apparent direction by up to 0.26°.
- Browser interpolation: linear on vectors (chord error ≈ 0.0007° per hour step), slerp on the quaternion (Earth's rotation is uniform to this accuracy).
- Aberration/light time: `LT+S` for the Sun (≈ 0.006°, free to include).

### 5.2 DEM pyramid (browser, for the point engine)

| Level | Use (distance from observer) | Resolution | Coverage | Size (Int16, raw) |
|---|---|---|---|---|
| L0 far | > 40 km | 480 m | pole to 70°S | ≈ 12 MB (one file) |
| L1 mid | 5–40 km | 120 m | ≈ 95 km square per region | ≈ 1.3 MB per region |
| L2 near | < 5 km | 20 m | ≈ 20 km square per region | ≈ 2 MB per region |

- Heights stored as Int16 at 0.5 m LSB relative to 1737.4 km.
- L0 must reach 70°S. Several candidate regions sit at 84–86°S; Earth is to their north, and the 80°S polar products end 304 km from the pole — only ~130–180 km north of those sites. A competitor documents exactly this truncation for its custom points.
- 300 km march cap is justified geometrically: an 8 km massif is on the limb for a 2 km-high observer at ≈ 250 km.
- The offline bake uses full resolution (5 m where PGDA site DEMs exist, optionally the newer shape-from-shading enhanced DEMs), not the browser pyramid.

### 5.3 Horizon atlas (per region, for the area engine)

Grid: 256 × 256 cells at 60 m (15.36 km), one baked observer height (2 m) plus one optional (10 m).

| Tensor | Shape | Azimuth sampling | Type | Raw size |
|---|---|---|---|---|
| Sun atlas | [256, 256, 360] | 1°, full circle | Uint8 | 22.5 MB |
| Earth atlas | [256, 256, 48] | 0.5°, only the ±12° window Earth can occupy | Uint8 | 3.0 MB |

- **Ephemeris-bounded quantisation.** For each region, encode only `[el_min − 0.3°, el_max + 0.3°]` of the body concerned, taken from the 19-year ephemeris. Horizons outside that range are equivalent to "always clear" / "always blocked". Near the pole the Sun range is ≈ 4°, giving ≈ 0.016° steps; at 84°S ≈ 0.05°. v1's fixed 0.2° step was 38% of the solar diameter.
- The Earth window bounds come from the ephemeris at bake time, not a constant.
- LOD: ship a 128 × 128 × 360 version (5.6 MB raw) first; refine to 256 when loaded. Regions load lazily.
- GPU: `TEXTURE_3D`, `R8`, linear filter, `REPEAT` on the azimuth axis (Sun atlas). WebGL2 only guarantees 256 per 3D dimension; check `MAX_3D_TEXTURE_SIZE` and fall back to 256 azimuth bins on the rare device that needs it.

### 5.4 Site catalogue (`sites.geojson`)

- The nine current Artemis III candidate regions (Oct 2024 downselect): Peak near Cabeus B, Haworth, Malapert Massif, Mons Mouton Plateau, Mons Mouton, Nobile Rim 1, Nobile Rim 2, de Gerlache Rim 2, Slater Plain.
- Candidate landing sites inside them from Wueller et al. 2026 (JGR Planets; Zenodo dataset with shapefiles; 130 sites meeting HLS requirements with a PSR within 2 km). Check the licence on the Zenodo record and cite both paper and dataset.
- Shackleton rim / connecting ridge kept as a clearly labelled "classic" teaching site, not as an Artemis III candidate.
- Per-site static layers: slope (from 5 m or 20 m DEM), PSR mask and 18.6-year average illumination / Earth visibility from PGDA (also used for validation).

---

## 6. Algorithms

### 6.1 Exact horizon (shared by bake and point engine)

For observer O (MOON_ME vector at surface height + mast height) and each azimuth:

1. March along the **great circle** leaving O at that azimuth. Steps: 10 m to 500 m, 20 m to 5 km, 100 m to 40 km, 400 m to 300 km.
2. At each step compute the 3D surface point P = (R + H)·n̂ with H sampled bilinearly from the pyramid level for that distance (convert n̂ to polar-stereographic x, y to index the DEM).
3. Elevation angle = asin((P − O)·ẑ_local / |P − O|). No curvature formula. The parabolic `d²/2R` used in v1 is off by 64 m at 200 km and 326 m at 300 km.
4. Keep the maximum. Point engine: 1440 azimuths (0.25°). Atlas: per §5.3.

Marching straight lines in the stereographic plane (v1) is not a great circle; the map scale error is 0.8% at 80°S and 3% at 70°S.

Target: one point, all azimuths, < 50 ms in a worker (≈ 2 M DEM samples).

### 6.2 Exact mast height: the obstruction envelope

For one azimuth, each terrain sample k at distance d_k contributes, to first order in z/d,

    tan θ_k(z) = a_k − z / d_k        (a_k = its tangent seen from z = 0)

so the horizon versus mast height z is

    tan θ(z) = max_k (a_k − z / d_k)

an upper envelope of straight lines: **convex, decreasing, piecewise linear in z.** Consequences:

- During the march keep only the non-dominated lines (a small list per azimuth). Then any height from 0 to 50 m is evaluated exactly with no re-march. The height slider is instant.
- If heights are instead sampled (atlas layers), linear interpolation in tan θ between samples can only **over**estimate the horizon (a chord lies above a convex curve). Errors are bounded and always pessimistic. In a random test with layers at 0/1/2/5/10/20 m the worst overestimate was 0.03°.
- v1's quadratic Lagrange fit has neither property. Example (2 m rise 40 m away, distant ridge behind): true horizon at 10 m mast is +0.56°, Lagrange through 0/5/20 m gives −0.58° — a 1.1° error, twice the solar diameter, in the optimistic direction.
- Inverse query "minimum height for requirement X" becomes a 1-D search on an exact function.

### 6.3 Disc-resolved visibility

- Sun (0.533°) and Earth (1.90°) are discs. Visible fraction = integrate the disc in vertical strips across azimuth, each strip clipped by the horizon at its own azimuth (9 strips for the Sun, 17 for Earth). This replaces v1's single straight-edge segment formula, which assumes a flat horizon under the disc — poor for Earth's 1.9° width.
- Atlas shader: straight-edge segment formula per pixel is acceptable for maps (point engine confirms).

### 6.4 Station-resolved DTE

A pass exists at time t for station s when all hold:

1. Station position (ITRF → MOON_ME via the baked quaternion) is above the site's terrain horizon at the station's own azimuth by ≥ `lander_mask` (default 2°, user 0–10°; low angles suffer terrain multipath).
2. The Moon is ≥ `station_mask` above the station's horizon (default 10°).
3. Optional: the site-to-station line clears the solar exclusion angle.

Default stations: the three DSN complexes (Goldstone, Madrid, Canberra); the list is a JSON file so users can add others. Output per station: pass list with AOS/LOS times; union coverage; longest outage. "Earth-centre above horizon" is still shown, labelled as the simple definition, so results are comparable with other tools.

Link budget: **out of the default path.** Offer a small, fully editable calculator (EIRP, G/T, frequency, range → margin) with every assumption visible. Do not display data rates the team cannot source.

### 6.5 Power and energy

- Array assumed vertical and Sun-tracking in azimuth (standard for polar landers/VSAT-style masts): P(t) = P_rated × f_disc(t) × cos(el_sun) ≈ P_rated × f_disc(t). State this assumption on screen.
- Energy balance: dE/dt = P(t) − P_load − P_heater·[dark], clipped to battery capacity. Inputs (array kW, loads, battery kWh) come from an editable hardware profile. Output: state-of-charge curve and minimum.
- Removed from v1: the "Diviner empirical cooling curve" and the bypass-diode derating formula. Neither had a source. A simple model with visible inputs is more defensible than a detailed one nobody can cite.

### 6.6 Eclipses

Flag any step where the Earth–Sun angular separation seen from the site is below (Earth radius 0.95° + Sun radius 0.27°); compute the occulted fraction by circle–circle overlap and multiply into f_disc. A lunar eclipse can darken an otherwise sunlit site for hours; none of the reviewed projects models it.

### 6.7 Area engine: per-pixel window integral

One fragment-shader pass over the region grid. Uniforms: a small texture of per-step Sun and Earth az/el for the region centre plus first-order corrections across the region, mast-height layer weights, thresholds.

Per pixel, loop over the window's time steps; fetch Sun and Earth horizon from the 3D textures; accumulate sunlit fraction, DTE fraction, both, and run-length state for longest dark gap. Write to a float render target (fallback: packed RGBA8).

Cost: a 28-day hourly window is 88 M texture fetches for 256²; a full year is 1.15 G, done in chunks across frames with additive passes. Targets: 28 days < 150 ms, one year < 2 s on an integrated GPU. This runs on parameter change, not every frame.

The same textures light the 3D terrain at the scrub time, so what the user sees shaded is exactly what the numbers are computed from.

### 6.8 Requirements solver

Input: requirement set + date range + site set (or "whole region"). Method: area engine screens cells and dates cheaply; top N candidates go to the point engine for exact evaluation across heights; return ranked (site, arrival date, minimum height) triples with the binding constraint named ("fails on Earth outage day 5").

### 6.9 Uncertainty

- Tier A (always): evaluate the 8 neighbours at ±1 atlas cell and report the min–max range. Shows position sensitivity.
- Tier B (regions with PGDA clone DEMs): rebuild the near-field horizon for each clone (far field fixed, as in Barker et al.), compute the scorecard per clone, report P10–P90. Baked offline for catalogue sites.
- Display: bands on the timeline around every rise/set, ± on percentages.

---

## 7. Decisions (ADRs)

### ADR-001: Where horizons are computed

**Context.** Low Sun/Earth elevations make the terrain horizon the whole problem. Need exact answers for arbitrary points and heights, plus map-wide analysis, with no server.

| Option | Complexity | Accuracy | Arbitrary point / height | Area maps | Hosting risk |
|---|---|---|---|---|---|
| A. v1: baked quantised angle tensor, 3 heights | Low | Low (2°, 35 km, 0.2° steps, Lagrange) | Grid cells only; interpolated height | One time step | None |
| B. Server API (FastAPI + SPICE + full DEMs) | Medium | High | Yes | Slow | Server can fail during judging; cold starts |
| C. Everything on demand in the browser | Medium | High | Yes | No (too slow per cell) | None |
| **D. Hybrid: exact point engine in a worker + baked atlas on the GPU** | Medium-high | High for points; good for maps | Yes, exact | Yes, full window | None |

**Decision:** D. **Trade-off:** two code paths must agree — mitigated by one shared march routine (Python/Numba port of the same algorithm) and a test that atlas values match the point engine at sampled cells within quantisation. **Revisit:** if time runs short, ship the point engine only (Option C) and precomputed maps; that still matches the field.

### ADR-002: Ephemeris source
**Decision:** SPICE baked to one binary; no analytic ephemeris in the browser. **Rejected:** astronomy-engine in the browser (simpler, any date, but a second model to validate and lower libration fidelity); live Horizons API (network dependency, rate limits). **Consequence:** date range fixed to the bake; rebake to extend.

### ADR-003: Height model
**Decision:** convex obstruction envelope in the point engine; two baked height layers in the atlas with tan-space linear interpolation. **Rejected:** Lagrange polynomial (non-physical, can err optimistically by > 1°).

### ADR-004: Rendering API
**Decision:** WebGL2 via Three.js/R3F (the team's existing plan). **Rejected for now:** WebGPU compute — cleaner for the window integral but uneven device support; keep as an optional path.

### ADR-005: Point engine language
**Decision:** TypeScript first (typed arrays; fastest to write and debug this weekend). Port the march loop to Rust/WASM only if the 50 ms target is missed.

### ADR-006: Comms model
**Decision:** geometric, station-resolved passes with masks; editable link calculator as an add-on. **Rejected:** default Ka/S-band data rates, knife-edge diffraction and Fresnel multipath from v1 — detailed but unsourced, and a validity risk.

### ADR-007: Scope of physics
**Decision:** cut thermal ODE, 4D A* rover routing and Pareto worker from the core. They do not answer the challenge sentence. Rover traverse is a stretch goal that reuses the area engine.

---

## 8. Validation plan (shown in-app as the "Trust" panel)

| # | Test | Reference | Pass threshold |
|---|---|---|---|
| 1 | Sun/Earth topocentric az/el | JPL Horizons, lunar-surface observer, ≥ 20 epochs × 3 sites | max error < 0.001° |
| 2 | Horizon algorithm | Analytic cases: bare sphere (dip angle), cone, crater rim, far wall with curvature | < 0.01° |
| 3 | Convergence | Same site at 180/360/720/1440 az and 35/100/200/300 km reach | Report the curve; this is also the pitch slide "why 35 km is wrong" |
| 4 | Atlas vs point engine | 500 random cells | within quantisation step |
| 5 | Long-term averages | PGDA 18.6-yr average illumination and Earth visibility (60 m, 85–90°S) | bias < 2 points, r > 0.95 (not independent: same LOLA source — say so) |
| 6 | Independent, time-specific | LROC WAC polar movie frames / NAC images at known UTC vs predicted lit mask | MCC > 0.6, plus sign controls (mirrored azimuth, shifted date) |

Also compare catalogue-site results with the published per-site illumination in Wueller et al. 2026 and Barker et al. 2021. The strongest competitor already reports tests 1, 5 and 6 with numbers; ours must be at least as explicit. Publish failures and unexplained gaps, not only passes.

`validation.json` is produced by the pipeline and rendered by the Trust panel, so the numbers on screen are regenerated, not typed.

---

## 9. Budgets (targets)

| Item | Target |
|---|---|
| First load to interactive (one region, LOD-128) | < 5 s on 10 Mbps; core bundle + ephemeris + one region ≤ ~15 MB compressed |
| Point engine: horizon envelope for a clicked point | < 50 ms |
| Point engine: 19-year hourly series + scorecard | < 150 ms |
| Height slider response | < 16 ms (envelope evaluation only) |
| Area engine: 28-day window map | < 150 ms |
| Area engine: 1-year map | < 2 s (chunked) |
| Site × date matrix for 9 sites × 365 days | < 1 s (point engine, series reused) |
| 3D viewport | 60 fps |

Measure these on a mid-range laptop and a phone before quoting any of them.

---

## 10. Build order for the weekend

The hackathon is running now. Build in tiers; each tier is demo-able on its own.

**Tier 0 — table stakes (must exist before anything else)**
1. `bake_ephemeris.py` + validation test 1.
2. DEM pyramid for 2 regions (one near-pole, one at ~85°S) + shared march routine + validation test 2.
3. Point engine in a worker: horizon, disc fractions, series, scorecard.
4. Sky view (panorama + tracks + timeline) and Compare view (2–4 scorecards + site × date matrix).
5. URL state, deploy to a static host.

**Tier 1 — the wedge**
6. Obstruction envelope + height slider + "minimum mast height" query.
7. Station-resolved DTE with pass lists.
8. Horizon atlas bake + area engine + Map view.
9. Validation tests 3–5 and the Trust panel.

**Tier 2 — depth**
10. All nine regions and the full candidate-site catalogue.
11. Requirements solver.
12. Uncertainty bands (tier A, then tier B).
13. Eclipses; energy balance with hardware profiles.
14. Validation test 6 (independent imagery).

**Tier 3 — reach**
15. Educator lesson, Explorer story mode, translations, PWA offline.
16. Rover traverse (only if everything above is done).

Freeze features well before submission; the last hours go to the demo video, README, and the limits page.

---

## 11. Pitch

Thirty-second story:

> "Pick a site and a date — here is your week on the Moon: when you have power, when you can talk to Earth, and how sure we are. Not happy? Tell it what the mission needs, and it finds where, when, and how tall."

Demo sequence (≈ 3 minutes):

1. Compare view opens on two candidate regions. One click on a red column of the matrix: "landing a week later costs four days of darkness."
2. Sky view: the Sun rolling along the horizon and dipping behind a named massif 120 km away. Toggle far-field 35 km → 300 km to show the sunrise time jump.
3. Height slider: 2 m → 10 m, the outage disappears. "Minimum mast: 8.4 m."
4. Map view: drag the arrival date, the whole region repaints.
5. Station strip: Earth is "up" but no station can see the lander for 40 minutes.
6. Trust panel: validation table, and the limits list.

Say plainly what it is not: not a certified mission tool, comms is geometric, power is first-order.

---

## 12. Risks

| Risk | Mitigation |
|---|---|
| Scope: v2 is larger than a weekend | Tiers; Tier 0 + two Tier 1 items is already competitive |
| Atlas and point engine disagree | Shared algorithm, test 4, point engine is always the displayed truth |
| Large downloads on venue Wi-Fi | LOD-128 first, lazy regions, service-worker cache, bundle one region in the repo for offline demo |
| DEM download/processing time (multi-GB) | Start downloads first; begin with the 20 m polar product, add 5 m site DEMs later |
| Site coordinates/licences | Use the published dataset with citation; mark which points are ours |
| Float render targets unavailable | RGBA8 packing fallback |
| Overclaiming | Every number has a source or is user-editable; Trust panel lists gaps |

---

## 13. Corrections to v1 worth knowing

- Far field reached 35 km but the 40 km buffer held only 20 km from centre.
- 2° azimuth bins leave 1.2 km between rays at 35 km and 3.5 km at 100 km.
- `connecting_ridge` and `shackleton` labels were swapped; "South-to-North" row order has no meaning in a polar stereographic grid (use "+Y toward 0°E").
- Chebyshev fitting in the diagram vs hourly JSON in the spec; 1.8 MB vs 1.6 MB compressed sizes.
- Performance table presented as measured.
- Earth's apparent diameter from the Moon is 1.90° (radius 0.95°).

---

## 14. Sources

- Challenge statement (as republished by local event sites): https://edeon.sonoma.edu/nasaspaceapps-26/
- Judging & Awards Guide: https://www.spaceappschallenge.org/resources/judging-awards-guide
- Artemis III nine regions: https://ntrs.nasa.gov/citations/20250011660 ; https://www.nasa.gov/news-release/nasa-provides-update-on-artemis-iii-moon-landing-regions/
- PGDA lunar polar illumination products (Mazarico et al. 2011): https://pgda.gsfc.nasa.gov/products/69
- PGDA high-resolution LOLA south-pole DEMs (Barker et al. 2021): https://pgda.gsfc.nasa.gov/products/78
- PGDA shape-from-shading enhanced DEMs (Bertone et al.): https://pgda.gsfc.nasa.gov/products/104
- LOLA archive: https://imbrium.mit.edu/
- Wueller et al. 2026 dataset: https://zenodo.org/records/17084058
- JPL GSSR illumination/communication maps: https://ntrs.nasa.gov/citations/20150014706
- Lafleur & Heeg 2010, Sun and Earth access trades: https://ssdl1.gatech.edu/sites/default/files/ssdl-files/papers/conferencePapers/AIAA-2010-8780.pdf
- NASA SVS, South Pole illumination with Earth and Sun: https://svs.gsfc.nasa.gov/5228
- LROC QuickMap TerrainShadows: https://www.actgate.com/post/quickmap-year-2022
- Moon Trek site characterisation: https://confit.atlas.jp/guide/event/jpgu2020/subject/PPS02-P12/date
- 2026 entries reviewed: https://github.com/rodneymora94965/lunar-site-navigator ; https://github.com/pythonhack000/lunar-navigator ; https://github.com/ziyadell/Lunar-Landing-Site-Navigator ; https://github.com/dagimfkadie/MoonSight ; https://github.com/RicardoArg23/MoonSet
