import { useState } from 'react';
import { useStore } from '../store/useStore';

const STEPS = [
  {
    title: 'The Sun circles the horizon',
    body: 'At the lunar poles the Sun never climbs more than a few degrees. Open the Sky view and press Play: the Sun slides sideways along the horizon for 29.5 days instead of rising and setting.',
    act: (s: any) => s.set({ tab: 'sky' }),
  },
  {
    title: 'A hill 100 km away matters',
    body: 'Because the Sun is so low, mountains far away throw shadows. Open the Trust tab and read “Why 35 km is not enough”: the sunlit percentage changes when we look farther.',
    act: (s: any) => s.set({ tab: 'trust' }),
  },
  {
    title: 'Height buys sunlight',
    body: 'Go back to Sky and drag Mast height from 2 m to 10 m. Terrain close to the lander stops blocking the Sun, and the dark gaps shrink.',
    act: (s: any) => s.set({ tab: 'sky', z: 10 }),
  },
  {
    title: 'Earth is also low, and wobbles',
    body: 'Earth hangs near the horizon and librates by about 7°. A station on Earth can only talk to the lander when both sides see each other. See the three station rows in the timeline.',
    act: (s: any) => s.set({ tab: 'sky' }),
  },
  {
    title: 'Compare sites and dates',
    body: 'Open Compare. Each coloured cell is a whole stay. Landing a week later can cost days of darkness: find a column that stays bright for every site you care about.',
    act: (s: any) => s.set({ tab: 'compare' }),
  },
];

export function Lesson() {
  const s = useStore();
  const [i, setI] = useState(0);
  return (
    <div className="card" style={{ marginBottom: 14, borderColor: 'var(--accent)' }}>
      <h3>
        Guided lesson · step {i + 1} of {STEPS.length}
      </h3>
      {STEPS.map((st, k) => (
        <div key={k} className={'step ' + (k === i ? 'on' : 'off')}>
          <b>{k + 1}</b>
          <div>
            <b>{st.title}</b>
            {k === i && (
              <div className="small" style={{ marginTop: 4 }}>
                {st.body}
              </div>
            )}
          </div>
        </div>
      ))}
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn" disabled={i === 0} onClick={() => setI(i - 1)}>
          Back
        </button>
        <button className="btn primary" onClick={() => STEPS[i].act(s)}>
          Show me
        </button>
        <button className="btn" disabled={i === STEPS.length - 1} onClick={() => setI(i + 1)}>
          Next
        </button>
        <button className="btn" onClick={() => window.print()} style={{ marginLeft: 'auto' }}>
          Print worksheet
        </button>
      </div>
    </div>
  );
}
