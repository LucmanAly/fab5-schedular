import { useState } from 'react';

// Lock grid — the inverse of a leave request. A lock guarantees a worker a
// full day at a specific store. Tap a cell, then pick one of that worker's
// linked stores (locks respect store links).
export default function LockGrid({ workers, stores, labels, locks, onSet }) {
  const [target, setTarget] = useState(null); // { worker, dayIdx }

  const storeName = (id) => (stores.find((s) => s.id === id) || {}).name || `Store ${id}`;
  const lockAt = (workerId, dayIdx) => {
    const row = locks[workerId];
    const v = row ? row[dayIdx] : null;
    return v == null ? null : v;
  };

  return (
    <>
      <div className="grid-wrap">
        <table className="grid checkgrid tone-lock">
          <thead>
            <tr>
              <th className="sticky-col">Worker</th>
              {labels.map((l) => (
                <th key={l}>{l}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {workers.map((w) => (
              <tr key={w.id}>
                <td className="sticky-col name-cell">
                  {w.name}
                  <span className={`chip chip-${w.main_store_id != null ? 'main' : 'float'}`}>
                    {w.main_store_id != null ? 'main' : 'float'}
                  </span>
                </td>
                {labels.map((_, d) => {
                  const locked = lockAt(w.id, d);
                  return (
                    <td key={d}>
                      <button
                        type="button"
                        className={`checkcell lockcell ${locked != null ? 'on' : ''}`}
                        aria-label={`Lock for ${w.name}, ${labels[d]}`}
                        title={locked != null ? `Locked to ${storeName(locked)}` : 'Add lock'}
                        onClick={() => setTarget({ worker: w, dayIdx: d })}
                      >
                        {locked != null ? `🔒 ${storeName(locked)}` : ''}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="settings-hint">
        🔒 A locked day overrides everything except store coverage itself. Setting a lock clears any leave request on
        the same day.
      </p>

      {target && (
        <div className="modal-backdrop" onClick={() => setTarget(null)}>
          <div className="modal sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-grab" />
            <h3>
              Lock {target.worker.name} — {labels[target.dayIdx]}
            </h3>
            <p className="hint">Guarantee {target.worker.name} works this day at one of their linked stores.</p>
            <ul className="picker">
              {(target.worker.store_ids || []).map((sid) => {
                const active = lockAt(target.worker.id, target.dayIdx) === sid;
                return (
                  <li key={sid}>
                    <button
                      type="button"
                      className={`pick pick-row ${active ? 'pick-active' : ''}`}
                      onClick={() => {
                        onSet(target.worker.id, target.dayIdx, sid);
                        setTarget(null);
                      }}
                    >
                      <span className="pick-name">{storeName(sid)}</span>
                      {active && <span aria-hidden>✓</span>}
                    </button>
                  </li>
                );
              })}
              {(target.worker.store_ids || []).length === 0 && (
                <li>
                  <p className="hint">This worker isn’t linked to any store yet — link them in Settings first.</p>
                </li>
              )}
            </ul>
            <div className="modal-actions">
              {lockAt(target.worker.id, target.dayIdx) != null && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    onSet(target.worker.id, target.dayIdx, null);
                    setTarget(null);
                  }}
                >
                  Remove lock
                </button>
              )}
              <button type="button" className="btn btn-ghost" onClick={() => setTarget(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
