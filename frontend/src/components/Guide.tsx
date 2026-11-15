import { useStore } from '../store/useStore';
import { Icon } from './common';

export function Guide() {
  const s = useStore();

  return (
    <div className="page guide-page">
      <header className="pagehead">
        <div>
          <div className="guide-badge">
            <Icon name="guide" size={14} />
            <span>Platform Guide &amp; Operational Manual</span>
          </div>
          <h1>How to Use HELIOS·LUNA</h1>
          <p className="sub">
            Complete operational guide to precision lunar landing-site navigation, solar illumination modeling, and Direct-To-Earth communications.
          </p>
        </div>
      </header>

      {/* Hero Overview */}
      <section className="panel guide-hero-card">
        <div className="guide-hero-content">
          <h2 className="guide-title">Platform Architecture &amp; Physics Engine</h2>
          <p className="guide-text">
            At the lunar south pole, the Sun skims the horizon at an altitude of only ~1.5°, casting shadows that stretch over 100 kilometers across crater rims, while Earth continuously wobbles (librates) near the horizon by ±7°. Finding safe landing sites requires rigorously modeling whether a location will receive sufficient sunlight for solar arrays and maintain line-of-sight to ground antennas on Earth.
          </p>
          <p className="guide-text">
            HELIOS·LUNA pairs high-resolution Lunar Orbiter Laser Altimeter (LOLA) digital elevation models (down to 20 m grid resolution) with NASA JPL SPICE DE442 ephemerides. It traces true 3D rays across the lunar surface to calculate real-time shadows, cumulative stay illumination, and Direct-To-Earth (DTE) communication availability for any coordinate on the Moon.
          </p>
          <div className="guide-hero-tags">
            <span className="pill-tag">NASA JPL SPICE DE442</span>
            <span className="pill-tag">LOLA 20 m–240 m Digital Elevation</span>
            <span className="pill-tag">Deep Space Network (DSN)</span>
            <span className="pill-tag">Instantaneous &amp; Stay Ray Tracing</span>
            <span className="pill-tag">Automated GO / NO-GO Grading</span>
            <span className="pill-tag">STK .aem &amp; GeoJSON Export</span>
          </div>
        </div>
      </section>

      {/* Core Workflow */}
      <div className="sect" style={{ marginTop: 24, marginBottom: 12 }}>
        <span>Mission Planning Workflow</span>
      </div>
      <div className="guide-steps-grid">
        <div className="card guide-step-card">
          <div className="step-num">01</div>
          <h3 className="step-heading">Set Scenario &amp; Hardware</h3>
          <p className="step-desc">
            Use the top toolbar to set your <b>Touchdown UTC</b> date/time, expedition <b>Surface Stay</b> (1–14 days), and lander <b>Mast Height</b> ($z$). Raising mast height lowers the local horizon, helping clear nearby crater walls.
          </p>
          <div className="step-meta">
            <Icon name="clock" size={13} />
            <span>Top toolbar controls</span>
          </div>
        </div>

        <div className="card guide-step-card">
          <div className="step-num">02</div>
          <h3 className="step-heading">Explore &amp; Select Sites</h3>
          <p className="step-desc">
            Explore candidate landing sites using the <b>Map</b> or the compact <b>Dock</b>. Click anywhere on the polar terrain to analyze custom coordinates, or press <kbd>⌘K</kbd> to search craters and Artemis III candidate zones.
          </p>
          <div className="step-meta">
            <Icon name="search" size={13} />
            <span>Map click or Quick Search (⌘K)</span>
          </div>
        </div>

        <div className="card guide-step-card">
          <div className="step-num">03</div>
          <h3 className="step-heading">Analyze Windows &amp; Export</h3>
          <p className="step-desc">
            Compare candidate sites side-by-side, search multi-week landing windows satisfying camera illumination angles, inspect 360° panoramic horizon profiles, and export mission briefs (PDF), GeoJSON, or STK masks.
          </p>
          <div className="step-meta">
            <Icon name="share" size={13} />
            <span>Views &amp; Export menu</span>
          </div>
        </div>
      </div>

      {/* Detailed Feature Breakdown by View */}
      <div className="sect" style={{ marginTop: 28, marginBottom: 12 }}>
        <span>Comprehensive View Breakdown &amp; Features</span>
      </div>

      {/* Feature 1: Map View */}
      <section className="panel guide-feature-panel">
        <div className="guide-feature-header">
          <div className="guide-feature-icon">
            <Icon name="pole" size={20} />
          </div>
          <div className="guide-feature-meta">
            <div className="guide-feature-tag">Primary Exploration Tool</div>
            <h3 className="guide-feature-title">Map — Interactive South Pole Explorer</h3>
          </div>
          <button className="btn primary" onClick={() => s.set({ tab: 'pole' })}>
            <Icon name="pole" size={13} />
            <span>Open Map</span>
          </button>
        </div>
        <p className="guide-feature-intro">
          The Map view provides a real-time, interactive 2D south polar stereographic projection covering the lunar south pole from -80° to -90° latitude, powered by multi-resolution LOLA digital elevation models.
        </p>
        <div className="guide-subfeatures-grid">
          <div className="subfeature-card">
            <h4>Click Ground to Analyze Any Coordinate</h4>
            <p>
              Click anywhere on the map surface to drop an instant analysis marker. The engine samples the exact planetocentric latitude and east longitude, fetches high-resolution local terrain (20 m–240 m), traces horizon rays, and adds it as a <b>Custom Point</b> for full solar and Earth line-of-sight evaluation.
            </p>
          </div>
          <div className="subfeature-card">
            <h4>"At a moment" vs. "Over the stay" Modes</h4>
            <p>
              Toggle between <b>At a moment</b> (instantaneous ray-traced shadow state at the scrubbed cursor minute) and <b>Over the stay</b> (cumulative sunlight percentage integrated across the entire 1–14 day stay for every 120 m cell, revealing peaks of eternal light vs. permanently shadowed regions).
            </p>
          </div>
          <div className="subfeature-card">
            <h4>Multi-Channel Layer Display</h4>
            <p>
              Switch between <b>Sunlight</b> (solar illumination only), <b>Earth in view</b> (direct radio line-of-sight to Earth with libration angles), and <b>Sun + Earth</b> (composite multi-spectral overlay showing simultaneous power and communication coverage).
            </p>
          </div>
          <div className="subfeature-card">
            <h4>Timeline Playback &amp; Dynamic Shadows</h4>
            <p>
              Use the scrub bar at the bottom to step hour-by-hour through the stay, or press <kbd>Space</kbd> / <b>Play</b> to animate shadows sweeping dynamically across crater rims. The live telemetry HUD displays Sun elevation, Earth elevation, % Earth illuminated, and countdowns to next sunset and Earthset.
            </p>
          </div>
          <div className="subfeature-card">
            <h4>Exposure Slider &amp; Terrain Grid</h4>
            <p>
              Adjust contrast and brightness from 0.5× to 5.0× using the exposure slider to inspect deep crater interiors or bright ridges. Toggle distance scales (50 km scale bar), polar latitude rings (-88°, -89°, -90°), and official IAU crater labels.
            </p>
          </div>
          <div className="subfeature-card">
            <h4>Live Ground Station Tracking</h4>
            <p>
              View the real-time line-of-sight link vector from the selected site to the active Earth ground station (Goldstone, Madrid, or Canberra) taking into account Earth rotation and lunar libration.
            </p>
          </div>
        </div>
      </section>

      {/* Feature 2: Compare View */}
      <section className="panel guide-feature-panel">
        <div className="guide-feature-header">
          <div className="guide-feature-icon">
            <Icon name="compare" size={20} />
          </div>
          <div className="guide-feature-meta">
            <div className="guide-feature-tag">Trade Study &amp; Evaluation</div>
            <h3 className="guide-feature-title">Compare — Multi-Site Evaluation &amp; Arrival Matrix</h3>
          </div>
          <button className="btn" onClick={() => s.set({ tab: 'compare' })}>
            <Icon name="compare" size={13} />
            <span>Open Compare</span>
          </button>
        </div>
        <p className="guide-feature-intro">
          Compare candidate landing sites side-by-side to evaluate mission feasibility against operational requirements and discover optimal arrival dates.
        </p>
        <div className="guide-subfeatures-grid">
          <div className="subfeature-card">
            <h4>Side-by-Side KPI Cards</h4>
            <p>
              Compare up to 4 pinned sites simultaneously. Each card includes a synchronized dual-channel miniature timeline (Sunlit hours in yellow, Earth link in blue), exact coordinates, terrain quality, and four critical operational metrics.
            </p>
          </div>
          <div className="subfeature-card">
            <h4>Automated GO / CHECK / NO-GO Grading</h4>
            <p>
              Every site is automatically graded against your mission profile: <b>GO</b> (meets all requirements), <b>CHECK</b> (marginal solar or link duration), or <b>NO-GO</b> (violates critical constraints like maximum continuous darkness).
            </p>
          </div>
          <div className="subfeature-card">
            <h4>120-Day Arrival Date Matrix (Heatmap)</h4>
            <p>
              A 4-month calendar matrix evaluating stays starting on any day in 1-day increments. Switch metrics between <b>Sunlit %</b>, <b>Earth link %</b>, <b>Both simultaneous %</b>, or <b>Longest darkness</b>. Click any cell to re-center the mission scenario on that date.
            </p>
          </div>
          <div className="subfeature-card">
            <h4>CSV Matrix Export</h4>
            <p>
              Download the entire multi-month evaluation matrix as a CSV file complete with provenance headers, formatted for immediate import into Python, pandas, or Excel.
            </p>
          </div>
        </div>
      </section>

      {/* Feature 3: Windows View */}
      <section className="panel guide-feature-panel">
        <div className="guide-feature-header">
          <div className="guide-feature-icon">
            <Icon name="clock" size={20} />
          </div>
          <div className="guide-feature-meta">
            <div className="guide-feature-tag">Trajectory &amp; Flight Dynamics</div>
            <h3 className="guide-feature-title">Windows — Touchdown &amp; Descent Window Solver</h3>
          </div>
          <button className="btn" onClick={() => s.set({ tab: 'windows' })}>
            <Icon name="clock" size={13} />
            <span>Find Windows</span>
          </button>
        </div>
        <p className="guide-feature-intro">
          Search forward up to 365 days to identify safe touchdown epochs that satisfy descent imaging, terrain-relative navigation, and ground station visibility constraints.
        </p>
        <div className="guide-subfeatures-grid">
          <div className="subfeature-card">
            <h4>Camera Illumination Angle Filter</h4>
            <p>
              Lander hazard detection and optical terrain-relative navigation (TRN) cameras require grazing sunlight between 1° and 15° elevation at touchdown to create identifiable shadow relief without blinding glare.
            </p>
          </div>
          <div className="subfeature-card">
            <h4>Descent Communication Continuity</h4>
            <p>
              Filter windows to require continuous line-of-sight to an Earth ground station for 1 hour prior to touchdown through landing, ensuring uninterrupted telemetry during critical powered descent.
            </p>
          </div>
          <div className="subfeature-card">
            <h4>Interactive Gantt Timeline &amp; "Plan this"</h4>
            <p>
              Visualize window openings, durations, and closures across weeks. Click <b>Plan this</b> on any window to instantly apply that exact touchdown epoch to the entire application.
            </p>
          </div>
          <div className="subfeature-card">
            <h4>iCalendar (.ics) Export</h4>
            <p>
              Export solved landing windows directly to calendar applications (.ics) for integration with mission operations schedules.
            </p>
          </div>
        </div>
      </section>

      {/* Feature 4: Site View */}
      <section className="panel guide-feature-panel">
        <div className="guide-feature-header">
          <div className="guide-feature-icon">
            <Icon name="sky" size={20} />
          </div>
          <div className="guide-feature-meta">
            <div className="guide-feature-tag">Astronomical &amp; Telecommunications Analysis</div>
            <h3 className="guide-feature-title">Site — 360° Horizon Elevation &amp; DSN Passes</h3>
          </div>
          <button className="btn" onClick={() => s.set({ tab: 'sky' })}>
            <Icon name="sky" size={13} />
            <span>Open Site Sky</span>
          </button>
        </div>
        <p className="guide-feature-intro">
          A high-precision local astronomical observatory view displaying the panoramic 360° terrain mask, ephemeris tracks, and telecommunication pass schedules.
        </p>
        <div className="guide-subfeatures-grid">
          <div className="subfeature-card">
            <h4>360° Spherical Terrain Horizon Mask</h4>
            <p>
              Renders the exact elevation profile of surrounding crater ridges and mountains plotted against azimuth (N, E, S, W). Shows the continuous multi-day path of the Sun disc skimming along crater peaks.
            </p>
          </div>
          <div className="subfeature-card">
            <h4>Earth Libration Orbit &amp; Visibility</h4>
            <p>
              Displays the apparent motion of Earth in the sky as it moves through its ±7° libration ellipse, showing precisely when Earth dips below local terrain ridges causing radio outages.
            </p>
          </div>
          <div className="subfeature-card">
            <h4>24-Hour Interactive Ops Clock</h4>
            <p>
              A circular 24-hour mission clock showing solar illumination arcs, shadow intervals, and active Earth contact windows hour-by-hour across the expedition.
            </p>
          </div>
          <div className="subfeature-card">
            <h4>Per-Station Deep Space Network (DSN) Passes</h4>
            <p>
              Detailed timeline showing line-of-sight passes, acquisition of signal (AOS), loss of signal (LOS), and handover windows across Goldstone, Madrid, and Canberra stations.
            </p>
          </div>
          <div className="subfeature-card">
            <h4>Lander Power &amp; Thermal Simulation</h4>
            <p>
              Configure battery capacity (Wh), payload power draw (W), solar array efficiency, and mast height to simulate battery state of charge (SoC) and detect cold soak survival risks.
            </p>
          </div>
          <div className="subfeature-card">
            <h4>STK .aem Horizon Mask Export</h4>
            <p>
              Export an azimuth-elevation horizon mask file formatted for direct import into Ansys Systems Tool Kit (STK) for orbital trajectory and mission simulation.
            </p>
          </div>
        </div>
      </section>

      {/* Additional Features: Profiles, Networks, Search, Exports */}
      <div className="sect" style={{ marginTop: 28, marginBottom: 12 }}>
        <span>Hardware Parameters, Networks &amp; Global Tools</span>
      </div>
      <div className="panel guide-concepts-panel">
        <div className="concepts-grid">
          <div className="concept-item">
            <h4>Mast Height Advantage ($z$)</h4>
            <p>
              Adjustable from 0 m to 50 m. Placing solar panels or antennas atop an elevated mast lowers the apparent local horizon geometrically, clearing nearby crater obstacles and dramatically reducing shadow duration.
            </p>
          </div>
          <div className="concept-item">
            <h4>Mission Profile Requirements</h4>
            <p>
              Configure operational GO / NO-GO constraints: minimum total sunlit percentage, maximum allowable continuous darkness hours, minimum DTE communication percentage, and maximum communication outage. Choose from Artemis III crew, robotic CLPS, or rover presets.
            </p>
          </div>
          <div className="concept-item">
            <h4>Ground Station Networks</h4>
            <p>
              Toggle between NASA Deep Space Network (Goldstone, Madrid, Canberra) and Near Space Network (commercial antennas), or add custom ground station coordinates (latitude, longitude, elevation mask) for private commercial ground segments.
            </p>
          </div>
          <div className="concept-item">
            <h4>Quick Search &amp; Coordinate Input (<kbd>⌘K</kbd>)</h4>
            <p>
              Press <kbd>⌘K</kbd> to search candidate craters (Shackleton, Malapert, Haworth, Cabeus, Mons Mouton, Nobile), historical landing sites (Apollo, SLIM, Chang'e), or type custom decimal coordinates (e.g. <code>-89.5, 120.0</code>) to instantly create a new custom landing site.
            </p>
          </div>
          <div className="concept-item">
            <h4>Mission Brief &amp; PDF Export</h4>
            <p>
              Generate a printable engineering mission report containing executive verdicts, site comparisons, horizon elevation plots, ops clocks, and ground station pass schedules.
            </p>
          </div>
          <div className="concept-item">
            <h4>GIS GeoJSON &amp; Shareable URLs</h4>
            <p>
              Export site coordinates, touchdown times, and graded metrics as GeoJSON for QGIS / ArcGIS. Click <b>Share</b> in the top bar to copy a URL encoding the exact mission scenario for team collaboration.
            </p>
          </div>
        </div>
      </div>

      {/* Keyboard Shortcuts Table */}
      <div className="sect" style={{ marginTop: 28, marginBottom: 12 }}>
        <span>Keyboard Shortcuts &amp; Controls</span>
      </div>
      <div className="panel guide-shortcuts-panel">
        <div className="shortcuts-table">
          <div className="shortcut-row">
            <div className="shortcut-key">
              <kbd>⌘</kbd> <kbd>B</kbd> or <kbd>Ctrl</kbd> <kbd>B</kbd>
            </div>
            <div className="shortcut-desc">
              Toggle sidebar between the compact navigation Dock and the expanded site list.
            </div>
          </div>
          <div className="shortcut-row">
            <div className="shortcut-key">
              <kbd>⌘</kbd> <kbd>K</kbd> or <kbd>/</kbd>
            </div>
            <div className="shortcut-desc">
              Open Quick Search to locate craters, candidate zones, or enter custom coordinates.
            </div>
          </div>
          <div className="shortcut-row">
            <div className="shortcut-key">
              <kbd>Space</kbd>
            </div>
            <div className="shortcut-desc">
              Play or pause timeline playback across the mission duration in Map and Site views.
            </div>
          </div>
          <div className="shortcut-row">
            <div className="shortcut-key">
              <kbd>Esc</kbd>
            </div>
            <div className="shortcut-desc">
              Dismiss open dialogs, search palettes, or mission profile drawers.
            </div>
          </div>
        </div>
      </div>

      {/* Quick Launch CTA Banner */}
      <div className="guide-cta-bar">
        <div className="cta-text">
          <b>Ready to plan your lunar landing?</b>
          <span>Choose an operational view to begin exploring candidate landing sites.</span>
        </div>
        <div className="cta-actions">
          <button className="btn primary" onClick={() => s.set({ tab: 'pole' })}>
            <Icon name="pole" size={13} />
            <span>Explore Map</span>
          </button>
          <button className="btn" onClick={() => s.set({ tab: 'compare' })}>
            <Icon name="compare" size={13} />
            <span>Compare Sites</span>
          </button>
          <button className="btn" onClick={() => s.set({ tab: 'windows' })}>
            <Icon name="clock" size={13} />
            <span>Find Windows</span>
          </button>
        </div>
      </div>
    </div>
  );
}
