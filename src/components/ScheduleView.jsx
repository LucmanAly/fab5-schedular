import { useState } from 'react';
import {
  computeGaps,
  workerAtHalf,
  cloneSchedule,
  daysWorked,
  consecutiveBefore,
  halfLabel,
  DAY_NAMES,
  HALVES,
  EMPTY_WEEK,
} from '../lib/scheduler';

export default function ScheduleView({ stores, workers, schedule, leaves, lastWeek, maxConsec, splitTime, labels, readOnly, onChange }) {
  const [group, setGroup] = useState('store'); // store | worker
  const [mode, setMode] = useState('day'); // day | week  (day is the mobile-first default)
  const [activeDay, setActiveDay] = useState(0);
  const [target, setTarget] = useState(null); // { storeId, dayIdx }

  const gaps = computeGaps(schedule, stores, workers); // always live
  const storeName = (id) => (stores.find((s) => s.id === id) || {}).name || `Store ${id}`;
  const slot = (wId, d) => (schedule[wId] && schedule[wId][d]) || { am: null, pm: null };

  // ----- editing -----
  function commit(next) {
    onChange(next);
  }
  function ensure(next, wId) {
    if (!next[wId]) next[wId] = EMPTY_WEEK();
    return next;
  }
  function assignHalf(wId, storeId, dayIdx, half) {
    const next = cloneSchedule(schedule);
    ensure(next, wId);
    const occupant = workerAtHalf(next, workers, storeId, dayIdx, half);
    const wPrev = next[wId][dayIdx][half];
    if (occupant && String(occupant.id) !== String(wId)) {
      next[occupant.id][dayIdx][half] = wPrev != null ? wPrev : null; // clean two-way swap for that half
    }
    next[wId][dayIdx][half] = storeId;
    commit(next);
  }
  function assignDay(wId, storeId, dayIdx) {
    const next = cloneSchedule(schedule);
    ensure(next, wId);
    for (const half of HALVES) {
      const occupant = workerAtHalf(next, workers, storeId, dayIdx, half);
      const wPrev = next[wId][dayIdx][half];
      if (occupant && String(occupant.id) !== String(wId)) {
        next[occupant.id][dayIdx][half] = wPrev != null ? wPrev : null;
      }
      next[wId][dayIdx][half] = storeId;
    }
    commit(next);
  }
  function clearHalf(storeId, dayIdx, half) {
    const next = cloneSchedule(schedule);
    const occupant = workerAtHalf(next, workers, storeId, dayIdx, half);
    if (occupant) next[occupant.id][dayIdx][half] = null;
    commit(next);
  }

  function statusFor(w, dayIdx) {
    if (leaves[w.id] && leaves[w.id][dayIdx]) return { kind: 'leave', label: 'On leave' };
    if (consecutiveBefore(w.id, dayIdx, schedule, lastWeek) >= maxConsec) return { kind: 'rest', label: 'Owed a rest day' };
    return { kind: 'ok', label: 'Available' };
  }

  // ----- render helpers -----
  function HalfSlot({ storeId, dayIdx, half }) {
    const w = workerAtHalf(schedule, workers, storeId, dayIdx, half);
    const kind = !w ? 'gap' : w.type === 'main' && w.store_id === storeId ? 'main' : 'float';
    return (
      <button
        type="button"
        className={`half half-${kind}`}
        disabled={readOnly}
        onClick={() => setTarget({ storeId, dayIdx })}
      >
        <span className="half-tag">{half === 'am' ? 'AM' : 'PM'}</span>
        <span className="half-who">{w ? w.name : 'OPEN'}</span>
      </button>
    );
  }

  function StoreDayBlock({ storeId, dayIdx }) {
    const am = workerAtHalf(schedule, workers, storeId, dayIdx, 'am');
    const pm = workerAtHalf(schedule, workers, storeId, dayIdx, 'pm');
    const full = am && pm && am.id === pm.id;
    if (full) {
      const kind = am.type === 'main' && am.store_id === storeId ? 'main' : 'float';
      return (
        <button type="button" className={`cell cell-${kind}`} disabled={readOnly} onClick={() => setTarget({ storeId, dayIdx })}>
          {am.name}
        </button>
      );
    }
    return (
      <div className="split-cell">
        <HalfSlot storeId={storeId} dayIdx={dayIdx} half="am" />
        <HalfSlot storeId={storeId} dayIdx={dayIdx} half="pm" />
      </div>
    );
  }

  function WorkerDayText({ w, dayIdx }) {
    const s = slot(w.id, dayIdx);
    if (s.am == null && s.pm == null) {
      if (leaves[w.id] && leaves[w.id][dayIdx]) return <span className="cell cell-leave cell-static">Leave</span>;
      return <span className="cell cell-off cell-static">Off</span>;
    }
    if (s.am != null && s.am === s.pm) return <span className="cell cell-work cell-static">{storeName(s.am)}</span>;
    return (
      <span className="cell cell-work cell-static split-text">
        <span>{s.am != null ? `AM ${storeName(s.am)}` : 'AM —'}</span>
        <span>{s.pm != null ? `PM ${storeName(s.pm)}` : 'PM —'}</span>
      </span>
    );
  }

  // ----- banner text -----
  const bannerText = (() => {
    if (gaps.length === 0) return 'All stores covered, morning and evening, all week.';
    const byCell = {};
    for (const g of gaps) {
      const key = `${g.storeId}|${g.dayIdx}`;
      byCell[key] = byCell[key] || [];
      byCell[key].push(g.half);
    }
    const parts = Object.entries(byCell).map(([key, halves]) => {
      const [sid, d] = key.split('|');
      const when = halves.length === 2 ? 'all day' : halves[0] === 'am' ? 'AM' : 'PM';
      return `${storeName(Number(sid))} · ${DAY_NAMES[d]} ${when}`;
    });
    return `${parts.length} open slot${parts.length > 1 ? 's' : ''}: ${parts.join('  ·  ')}`;
  })();

  return (
    <div className="panel schedule">
      <div className={`banner ${gaps.length ? 'banner-bad' : 'banner-good'}`} role="status">
        {bannerText}
      </div>

      <div className="sched-controls">
        <div className="view-toggle" role="tablist" aria-label="Group by">
          <button type="button" role="tab" aria-selected={group === 'store'} className={group === 'store' ? 'active' : ''} onClick={() => setGroup('store')}>
            By store
          </button>
          <button type="button" role="tab" aria-selected={group === 'worker'} className={group === 'worker' ? 'active' : ''} onClick={() => setGroup('worker')}>
            By worker
          </button>
        </div>
        <div className="view-toggle" role="tablist" aria-label="Layout">
          <button type="button" role="tab" aria-selected={mode === 'day'} className={mode === 'day' ? 'active' : ''} onClick={() => setMode('day')}>
            Day
          </button>
          <button type="button" role="tab" aria-selected={mode === 'week'} className={mode === 'week' ? 'active' : ''} onClick={() => setMode('week')}>
            Week
          </button>
        </div>
      </div>

      {mode === 'day' && (
        <>
          <div className="day-strip" role="tablist" aria-label="Day">
            {labels.map((l, d) => (
              <button key={l} type="button" role="tab" aria-selected={activeDay === d} className={`day-tab ${activeDay === d ? 'active' : ''}`} onClick={() => setActiveDay(d)}>
                {l}
              </button>
            ))}
          </div>

          {group === 'store' ? (
            <div className="card-list">
              {stores.map((s) => (
                <div className="store-card" key={s.id}>
                  <div className="store-card-head">{s.name}</div>
                  <div className="store-card-halves">
                    <div className="sch-row">
                      <span className="sch-time">Morning · {halfLabel(activeDay, 'am', splitTime)}</span>
                      <HalfSlot storeId={s.id} dayIdx={activeDay} half="am" />
                    </div>
                    <div className="sch-row">
                      <span className="sch-time">Evening · {halfLabel(activeDay, 'pm', splitTime)}</span>
                      <HalfSlot storeId={s.id} dayIdx={activeDay} half="pm" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="card-list">
              {workers.map((w) => (
                <div className="worker-card" key={w.id}>
                  <div className="worker-card-head">
                    {w.name}
                    <span className={`chip chip-${w.type}`}>{w.type}</span>
                  </div>
                  <WorkerDayText w={w} dayIdx={activeDay} />
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {mode === 'week' && group === 'store' && (
        <div className="grid-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th className="sticky-col">Store</th>
                {labels.map((l) => (
                  <th key={l}>{l}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stores.map((s) => (
                <tr key={s.id}>
                  <td className="sticky-col name-cell">{s.name}</td>
                  {labels.map((_, d) => (
                    <td key={d}>
                      <StoreDayBlock storeId={s.id} dayIdx={d} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {mode === 'week' && group === 'worker' && (
        <div className="grid-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th className="sticky-col">Worker</th>
                {labels.map((l) => (
                  <th key={l}>{l}</th>
                ))}
                <th>Days</th>
              </tr>
            </thead>
            <tbody>
              {workers.map((w) => (
                <tr key={w.id}>
                  <td className="sticky-col name-cell">
                    {w.name}
                    <span className={`chip chip-${w.type}`}>{w.type}</span>
                  </td>
                  {labels.map((_, d) => (
                    <td key={d}>
                      <WorkerDayText w={w} dayIdx={d} />
                    </td>
                  ))}
                  <td className="days-total">{daysWorked(schedule[w.id])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="legend">
        <span className="cell cell-main cell-static">Main on duty</span>
        <span className="cell cell-float cell-static">Float covering</span>
        <span className="half half-gap cell-static"><span className="half-who">OPEN</span></span>
        <span className="cell cell-leave cell-static">Leave</span>
      </div>

      {target && !readOnly && (
        <ReassignSheet
          store={stores.find((s) => s.id === target.storeId)}
          dayIdx={target.dayIdx}
          dayLabel={labels[target.dayIdx]}
          splitTime={splitTime}
          storeName={storeName}
          workers={workers}
          schedule={schedule}
          statusFor={statusFor}
          onAssignHalf={assignHalf}
          onAssignDay={assignDay}
          onClearHalf={clearHalf}
          onClose={() => setTarget(null)}
        />
      )}
    </div>
  );
}

function ReassignSheet({ store, dayIdx, dayLabel, splitTime, storeName, workers, schedule, statusFor, onAssignHalf, onAssignDay, onClearHalf, onClose }) {
  const am = workerAtHalf(schedule, workers, store.id, dayIdx, 'am');
  const pm = workerAtHalf(schedule, workers, store.id, dayIdx, 'pm');
  const whereElse = (w, half) => {
    const s = (schedule[w.id] && schedule[w.id][dayIdx]) || {};
    const at = s[half];
    return at != null && at !== store.id ? storeName(at) : null;
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grab" />
        <h3>
          {store.name} — {dayLabel}
        </h3>
        <p className="hint">
          Assign a whole day, or split it: morning {halfLabel(dayIdx, 'am', splitTime)}, evening {halfLabel(dayIdx, 'pm', splitTime)}.
          Warnings never block your choice.
        </p>

        <div className="current-halves">
          <div className={`cur ${am ? '' : 'cur-open'}`}>
            <span className="cur-tag">Morning</span>
            <span className="cur-name">{am ? am.name : 'OPEN'}</span>
            {am && (
              <button type="button" className="cur-clear" onClick={() => onClearHalf(store.id, dayIdx, 'am')}>
                clear
              </button>
            )}
          </div>
          <div className={`cur ${pm ? '' : 'cur-open'}`}>
            <span className="cur-tag">Evening</span>
            <span className="cur-name">{pm ? pm.name : 'OPEN'}</span>
            {pm && (
              <button type="button" className="cur-clear" onClick={() => onClearHalf(store.id, dayIdx, 'pm')}>
                clear
              </button>
            )}
          </div>
        </div>

        <ul className="picker">
          {workers.map((w) => {
            const st = statusFor(w, dayIdx);
            const amElse = whereElse(w, 'am');
            const pmElse = whereElse(w, 'pm');
            const note = st.kind !== 'ok' ? st.label : amElse || pmElse ? `At ${amElse || pmElse} — will swap` : 'Available';
            return (
              <li key={w.id}>
                <div className={`pick pick-${st.kind}`}>
                  <span className="pick-name">
                    {w.name}
                    <span className={`chip chip-${w.type}`}>{w.type}</span>
                    <span className="pick-status">{note}</span>
                  </span>
                  <span className="pick-btns">
                    <button type="button" className="mini" onClick={() => onAssignHalf(w.id, store.id, dayIdx, 'am')}>
                      AM
                    </button>
                    <button type="button" className="mini" onClick={() => onAssignHalf(w.id, store.id, dayIdx, 'pm')}>
                      PM
                    </button>
                    <button type="button" className="mini mini-day" onClick={() => onAssignDay(w.id, store.id, dayIdx)}>
                      Day
                    </button>
                  </span>
                </div>
              </li>
            );
          })}
        </ul>

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
