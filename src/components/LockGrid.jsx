import { useState } from 'react';
import { lockAt, rangeCompact, storeWindow, toMin, fmtMin, minToHHMM } from '../lib/scheduler';

// Lock grid — the inverse of a leave request. A lock guarantees a worker a
// day (or, optionally, an exact time range) at a specific store. Tap a cell,
// then pick one of that worker's linked stores: tapping the store name locks
// the whole day (the simple default); the ⏱ on a store row opens a time-range
// editor instead. Lock values: storeId | { storeId, start, end }.
//
// Range rule: the schedule day has exactly one changeover point, so a range
// must start at the store's opening or end at its closing time (a prefix or
// suffix of the day) — validated here rather than left for the generator.
export default function LockGrid({ workers, stores, labels, locks, onSet }) {
  const [target, setTarget] = useState(null); // { worker, dayIdx }

  const storeName = (id) => (stores.find((s) => s.id === id) || {}).name || `Store ${id}`;

  function cellText(workerId, dayIdx) {
    const lk = lockAt(locks, workerId, dayIdx);
    if (!lk) return '';
    const range = lk.start != null ? ` ${rangeCompact(lk)}` : '';
    return `🔒 ${storeName(lk.storeId)}${range}`;
  }

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
                  const locked = lockAt(locks, w.id, d);
                  return (
                    <td key={d}>
                      <button
                        type="button"
                        className={`checkcell lockcell ${locked ? 'on' : ''}`}
                        aria-label={`Lock for ${w.name}, ${labels[d]}`}
                        title={locked ? `Locked to ${storeName(locked.storeId)}` : 'Add lock'}
                        onClick={() => setTarget({ worker: w, dayIdx: d })}
                      >
                        {cellText(w.id, d)}
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
        🔒 A locked day overrides everything except store coverage itself. Tap a store to lock the whole day, or
        its ⏱ to lock an exact time range — the rest of that store&rsquo;s day stays open for someone else.
        Setting a lock clears any leave request on the same day.
      </p>

      {target && (
        <LockSheet
          worker={target.worker}
          dayIdx={target.dayIdx}
          dayLabel={labels[target.dayIdx]}
          stores={stores}
          current={lockAt(locks, target.worker.id, target.dayIdx)}
          onSet={(v) => {
            onSet(target.worker.id, target.dayIdx, v);
            setTarget(null);
          }}
          onClose={() => setTarget(null)}
        />
      )}
    </>
  );
}

function LockSheet({ worker, dayIdx, dayLabel, stores, current, onSet, onClose }) {
  const [rangeFor, setRangeFor] = useState(null); // storeId with the range editor open
  const storeName = (id) => (stores.find((s) => s.id === id) || {}).name || `Store ${id}`;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grab" />
        <h3>
          Lock {worker.name} — {dayLabel}
        </h3>
        <p className="hint">
          Guarantee {worker.name} works this day at one of their linked stores. Tap the store for a whole day,
          or ⏱ for an exact time range.
        </p>
        <ul className="picker">
          {(worker.store_ids || []).map((sid) => {
            const store = stores.find((s) => s.id === sid);
            const activeWhole = current && current.storeId === sid && current.start == null;
            const activeRange = current && current.storeId === sid && current.start != null;
            return (
              <li key={sid}>
                <div className={`pick lock-store-row ${activeWhole || activeRange ? 'pick-active' : ''}`}>
                  <button type="button" className="lock-store-name" onClick={() => onSet(sid)}>
                    <span className="pick-name">
                      {storeName(sid)}
                      {activeWhole && <span className="pick-status">locked · whole day</span>}
                      {activeRange && <span className="pick-status">locked · {rangeCompact(current)}</span>}
                    </span>
                  </button>
                  <button
                    type="button"
                    className={`mini ${rangeFor === sid || activeRange ? 'active' : ''}`}
                    title={`Lock a time range at ${storeName(sid)}`}
                    onClick={() => setRangeFor(rangeFor === sid ? null : sid)}
                  >
                    ⏱
                  </button>
                </div>
                {rangeFor === sid && store && (
                  <LockRangeEditor
                    store={store}
                    dayIdx={dayIdx}
                    current={activeRange ? current : null}
                    onApply={(start, end) => onSet({ storeId: sid, start, end })}
                  />
                )}
              </li>
            );
          })}
          {(worker.store_ids || []).length === 0 && (
            <li>
              <p className="hint">This worker isn&rsquo;t linked to any store yet — link them in Settings first.</p>
            </li>
          )}
        </ul>
        <div className="modal-actions">
          {current && (
            <button type="button" className="btn" onClick={() => onSet(null)}>
              Remove lock
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function LockRangeEditor({ store, dayIdx, current, onApply }) {
  const win = storeWindow(store, dayIdx);
  const [start, setStart] = useState(current ? minToHHMM(current.start) : minToHHMM(win.open));
  const [end, setEnd] = useState(current ? minToHHMM(current.end) : minToHHMM(win.close));

  // Validate against the store's real hours for THIS day (weekday vs weekend
  // buckets differ), and require the range to anchor to open or close.
  const check = (() => {
    if (!start || !end) return { error: 'Pick both a start and an end time.' };
    const s0 = toMin(start);
    let e0 = toMin(end);
    if (e0 <= s0) e0 += 1440; // past-midnight entry, e.g. until 2am
    if (s0 < win.open || e0 > win.close) {
      return {
        error: `${store.name} is open ${fmtMin(win.open)}–${fmtMin(win.close)} that day — the range must fit inside its hours.`,
      };
    }
    if (s0 === win.open && e0 === win.close) return { whole: true };
    if (s0 !== win.open && e0 !== win.close) {
      return {
        error:
          'The range must start at opening time or run to closing time — a day splits into two shifts around one changeover, so a middle slice can’t be locked on its own.',
      };
    }
    return {};
  })();

  return (
    <div className="lock-range-editor">
      <div className="range-fields">
        <label>
          <span>From</span>
          <input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label>
          <span>Until</span>
          <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
        </label>
      </div>
      {check.error ? (
        <p className="field-error">{check.error}</p>
      ) : check.whole ? (
        <p className="hint">That covers {store.name}&rsquo;s whole day — it will be saved as a whole-day lock.</p>
      ) : (
        <p className="hint">
          Guaranteed {fmtMin(toMin(start))}–{fmtMin(toMin(end))}; the rest of the day stays open for someone else.
        </p>
      )}
      <button
        type="button"
        className="btn btn-primary"
        disabled={!!check.error}
        onClick={() => onApply(start, end)}
      >
        Lock this range
      </button>
    </div>
  );
}
