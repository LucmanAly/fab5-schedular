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
          <small>Name them next, then add workers and link each one to a store</small>
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
      </div>
    </div>
  );
}

export function StepConfigure({ stores, workers, onStores, onWorkers }) {
  const renameStore = (id, name) => onStores(stores.map((s) => (s.id === id ? { ...s, name } : s)));
  const renameWorker = (id, name) => onWorkers(workers.map((w) => (w.id === id ? { ...w, name } : w)));
  const setType = (id, type) => onWorkers(workers.map((w) => (w.id === id ? { ...w, type } : w)));
  const removeWorker = (id) => onWorkers(workers.filter((w) => w.id !== id));

  function addWorker(type) {
    const nextId = workers.reduce((max, w) => Math.max(max, w.id), 0) + 1;
    onWorkers([...workers, { id: nextId, name: type === 'main' ? 'New main' : 'New float', type, store_ids: [] }]);
  }
  function addStoreLink(workerId, storeId) {
    onWorkers(
      workers.map((w) => (w.id === workerId && !w.store_ids.includes(storeId) ? { ...w, store_ids: [...w.store_ids, storeId] } : w))
    );
  }
  function removeStoreLink(workerId, storeId) {
    onWorkers(workers.map((w) => (w.id === workerId ? { ...w, store_ids: w.store_ids.filter((id) => id !== storeId) } : w)));
  }
  function makeTopPreference(workerId, storeId) {
    onWorkers(
      workers.map((w) =>
        w.id === workerId ? { ...w, store_ids: [storeId, ...w.store_ids.filter((id) => id !== storeId)] } : w
      )
    );
  }

  const unlinked = workers.filter((w) => !w.store_ids.length);

  return (
    <div className="panel">
      <h2>Name stores and add workers</h2>
      <p className="hint">
        Stores come first. Then add each worker and link them to the store(s) they can work — the first store you link is their top
        preference (a main's is effectively their home store; a float can rank several).
      </p>

      <h3 className="col-head">Stores</h3>
      <div className="store-name-list">
        {stores.map((s) => (
          <div className="pair-row" key={s.id}>
            <input value={s.name} onChange={(e) => renameStore(s.id, e.target.value)} aria-label={`Store ${s.id} name`} />
          </div>
        ))}
      </div>

      <h3 className="col-head">Workers</h3>
      <div className="worker-add-row">
        <button type="button" className="btn" onClick={() => addWorker('main')}>
          + Add main worker
        </button>
        <button type="button" className="btn" onClick={() => addWorker('float')}>
          + Add float
        </button>
      </div>

      {unlinked.length > 0 && (
        <p className="hint">
          {unlinked.length} worker{unlinked.length > 1 ? 's' : ''} not linked to a store yet — link at least one below or they won't be scheduled.
        </p>
      )}

      <div className="worker-list">
        {workers.map((w) => {
          const linked = w.store_ids.map((id) => stores.find((s) => s.id === id)).filter(Boolean);
          const linkable = stores.filter((s) => !w.store_ids.includes(s.id));
          return (
            <div className="worker-row" key={w.id}>
              <div className="worker-row-top">
                <input value={w.name} onChange={(e) => renameWorker(w.id, e.target.value)} aria-label="Worker name" />
                <select value={w.type} onChange={(e) => setType(w.id, e.target.value)} aria-label={`${w.name} type`}>
                  <option value="main">Main</option>
                  <option value="float">Float</option>
                </select>
                <button type="button" className="btn btn-ghost" onClick={() => removeWorker(w.id)} aria-label={`Remove ${w.name}`}>
                  ✕
                </button>
              </div>
              <div className="worker-row-links">
                {linked.length === 0 && <span className="hint">Not linked to any store yet.</span>}
                {linked.map((s, i) => (
                  <span key={s.id} className={`store-chip ${i === 0 ? 'primary' : ''}`}>
                    {i === 0 ? '★ ' : ''}
                    {s.name}
                    {i !== 0 && (
                      <button type="button" onClick={() => makeTopPreference(w.id, s.id)} title="Make top preference">
                        ↑
                      </button>
                    )}
                    <button type="button" onClick={() => removeStoreLink(w.id, s.id)} title="Remove link">
                      ✕
                    </button>
                  </span>
                ))}
                {linkable.length > 0 && (
                  <select
                    value=""
                    onChange={(e) => e.target.value && addStoreLink(w.id, Number(e.target.value))}
                    aria-label={`Add store link for ${w.name}`}
                  >
                    <option value="">+ Add store…</option>
                    {linkable.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          );
        })}
        {workers.length === 0 && <p className="hint">No workers yet — add one above.</p>}
      </div>
    </div>
  );
}
