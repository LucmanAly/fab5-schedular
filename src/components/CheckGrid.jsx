import { useState } from 'react';
import { leaveAt, rangeCompact, toMin, fmtMin } from '../lib/scheduler';

// Leave-request grid. Tapping a cell toggles a whole-day leave (the simple,
// default case). An active cell grows a small ⏱ affordance to optionally
// limit the leave to a time range — e.g. "unavailable 2pm–10pm" — instead of
// the whole day. Cell values: false | true | { start:'HH:MM', end:'HH:MM' }.
export default function CheckGrid({ workers, labels, value, onChange, tone }) {
  const [editing, setEditing] = useState(null); // { worker, dayIdx }

  function setCell(workerId, dayIdx, v) {
    const next = { ...value };
    const row = [...(next[workerId] || [false, false, false, false, false, false, false])];
    row[dayIdx] = v;
    next[workerId] = row;
    onChange(next);
  }

  function toggle(workerId, dayIdx) {
    const cur = value[workerId] && value[workerId][dayIdx];
    setCell(workerId, dayIdx, cur ? false : true);
  }

  function cellLabel(w, d) {
    const lv = leaveAt(value, w.id, d);
    if (!lv) return '';
    return lv.full ? '✓' : rangeCompact(lv);
  }

  return (
    <div className="grid-wrap">
      <table className={`grid checkgrid tone-${tone}`}>
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
                const on = value[w.id] && value[w.id][d];
                return (
                  <td key={d} className="range-td">
                    <button
                      type="button"
                      className={`checkcell ${on ? 'on' : ''} ${on && on !== true ? 'checkcell-range' : ''}`}
                      aria-pressed={!!on}
                      aria-label={`${w.name}, ${labels[d]}`}
                      onClick={() => toggle(w.id, d)}
                    >
                      {cellLabel(w, d)}
                    </button>
                    {!!on && (
                      <button
                        type="button"
                        className="range-btn"
                        title="Limit this leave to a time range"
                        aria-label={`Set a time range for ${w.name}, ${labels[d]}`}
                        onClick={() => setEditing({ worker: w, dayIdx: d })}
                      >
                        ⏱
                      </button>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="settings-hint">
        Tap a day to mark a whole-day leave. Tap the ⏱ on a marked day to limit the leave to a time range —
        the worker stays available for the rest of that day.
      </p>

      {editing && (
        <LeaveRangeSheet
          worker={editing.worker}
          dayLabel={labels[editing.dayIdx]}
          current={value[editing.worker.id] && value[editing.worker.id][editing.dayIdx]}
          onWholeDay={() => {
            setCell(editing.worker.id, editing.dayIdx, true);
            setEditing(null);
          }}
          onRange={(start, end) => {
            setCell(editing.worker.id, editing.dayIdx, { start, end });
            setEditing(null);
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function LeaveRangeSheet({ worker, dayLabel, current, onWholeDay, onRange, onClose }) {
  const initial = current && current !== true ? current : { start: '14:00', end: '22:00' };
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);

  // Leaves are worker-level (not tied to one store's hours), so the only
  // validation is a sane, same-day, non-empty window.
  const error = (() => {
    if (!start || !end) return 'Pick both a start and an end time.';
    if (toMin(end) <= toMin(start)) return 'End must be after start (leaves can’t cross midnight).';
    return null;
  })();

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grab" />
        <h3>
          {worker.name} — leave on {dayLabel}
        </h3>
        <p className="hint">
          Unavailable only during this window; the schedule can still use {worker.name} outside it.
        </p>
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
        {error ? (
          <p className="field-error">{error}</p>
        ) : (
          <p className="hint">
            Off {fmtMin(toMin(start))}–{fmtMin(toMin(end))}, available the rest of the day.
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onWholeDay}>
            Whole day instead
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={!!error} onClick={() => onRange(start, end)}>
            Save time range
          </button>
        </div>
      </div>
    </div>
  );
}
