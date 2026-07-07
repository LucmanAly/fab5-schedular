import { mondayOf, formatWeek, fmtTime } from '../lib/scheduler';

const SPLIT_OPTIONS = ['12:00', '13:00', '14:00', '15:00', '16:00'];

export function StepInit({ cfg, onChange }) {
  const set = (patch) => onChange({ ...cfg, ...patch });
  return (
    <div className="panel">
      <h2>Set up the week</h2>
      <p className="hint">Counts and rules. Change them any week without losing names.</p>

      <div className="field-row">
        <label className="field">
          <span>Week starting (Monday)</span>
          <input
            type="date"
            value={cfg.weekStart}
            onChange={(e) => e.target.value && set({ weekStart: mondayOf(e.target.value) })}
          />
          <small>Building the week of {formatWeek(cfg.weekStart)}</small>
        </label>

        <label className="field">
          <span>Number of stores</span>
          <input
            type="number"
            min="1"
            max="30"
            value={cfg.numStores}
            onChange={(e) => set({ numStores: Math.max(1, Number(e.target.value) || 1) })}
          />
          <small>Each store gets one main worker</small>
        </label>

        <label className="field">
          <span>Floating workers</span>
          <input
            type="number"
            min="0"
            max="30"
            value={cfg.numFloats}
            onChange={(e) => set({ numFloats: Math.max(0, Number(e.target.value) || 0) })}
          />
          <small>They cover any store, and can split a day between two</small>
        </label>

        <div className="field">
          <span>Max days in a row</span>
          <div className="seg">
            {[2, 3, 4].map((n) => (
              <button key={n} type="button" className={cfg.maxConsec === n ? 'active' : ''} onClick={() => set({ maxConsec: n })}>
                {n}
              </button>
            ))}
          </div>
          <small>After this many days, a rest day is required</small>
        </div>

        <div className="field">
          <span>Shift changeover</span>
          <div className="seg">
            {SPLIT_OPTIONS.map((t) => (
              <button key={t} type="button" className={cfg.splitTime === t ? 'active' : ''} onClick={() => set({ splitTime: t })}>
                {fmtTime(t)}
              </button>
            ))}
          </div>
          <small>Where a split day divides: morning ends and evening begins here</small>
        </div>
      </div>
    </div>
  );
}

export function StepConfigure({ stores, workers, onStores, onWorkers }) {
  const mains = workers.filter((w) => w.type === 'main');
  const floats = workers.filter((w) => w.type === 'float');

  const renameStore = (id, name) => onStores(stores.map((s) => (s.id === id ? { ...s, name } : s)));
  const renameWorker = (id, name) => onWorkers(workers.map((w) => (w.id === id ? { ...w, name } : w)));

  return (
    <div className="panel">
      <h2>Name stores and workers</h2>
      <p className="hint">Each main worker is tied to one store. Floats go wherever they're needed.</p>

      <div className="config-cols">
        <div>
          <h3 className="col-head">Stores &amp; their main worker</h3>
          {stores.map((s) => {
            const main = mains.find((m) => m.store_id === s.id);
            return (
              <div className="pair-row" key={s.id}>
                <input value={s.name} onChange={(e) => renameStore(s.id, e.target.value)} aria-label={`Store ${s.id} name`} />
                <span className="pair-arrow">→</span>
                <input
                  value={main ? main.name : ''}
                  onChange={(e) => main && renameWorker(main.id, e.target.value)}
                  aria-label={`Main worker for store ${s.id}`}
                />
              </div>
            );
          })}
        </div>
        <div>
          <h3 className="col-head">Floating workers</h3>
          {floats.map((f) => (
            <div className="pair-row" key={f.id}>
              <input value={f.name} onChange={(e) => renameWorker(f.id, e.target.value)} aria-label="Float name" />
            </div>
          ))}
          {floats.length === 0 && <p className="hint">No floats configured.</p>}
        </div>
      </div>
    </div>
  );
}
