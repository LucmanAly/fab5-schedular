import { useState } from 'react';
import {
  workerAtHalf,
  cloneSchedule,
  weekWorkload,
  maxWorkdays,
  workerHours,
  streakBefore,
  computeGaps,
  halfLabel,
  shiftTimeLabel,
  shiftTimeCompact,
  rangeCompact,
  leaveAt,
  lockAt,
  splitMinFor,
  defaultSplitMin,
  minToHHMM,
  fmtMin,
  isSplitOnly,
  DAY_NAMES,
  HALVES,
  EMPTY_WEEK,
  SOFT_MAX_CONSEC,
} from '../lib/scheduler';
import FindCover from './FindCover';

// Review & Modify board.
// Week mode: the main review table — days across, stores down, workers in cells.
// Day mode: one day at a time as cards (mobile-friendly).
// Tap any cell to reassign: full shift = one worker, split = first + second shift.
// On a saved schedule (`saved`), tapping an assigned cell offers Find Cover first.

export default function ScheduleView({
  stores,
  workers,
  schedule,
  leaves = {},
  locks = {},
  lastWeekLoad = {},
  labels,
  splitTimes = {},
  readOnly,
  saved = false,
  onChange,
  onSplitTimesChange,
  onCoverApply,
  onToast,
}) {
  const [mode, setMode] = useState(() =>
    typeof window !== 'undefined' && window.innerWidth < 768 ? 'day' : 'week'
  );
  const [group, setGroup] = useState('store'); // store | worker
  const [activeDay, setActiveDay] = useState(0);
  const [target, setTarget] = useState(null); // { storeId, dayIdx } — manual editor
  const [cover, setCover] = useState(null); // { storeId, dayIdx } — Find Cover sheet

  const gaps = computeGaps(schedule, stores, workers);
  const storeName = (id) => (stores.find((s) => s.id === id) || {}).name || `Store ${id}`;
  const storeById = (id) => stores.find((s) => s.id === id);
  const slot = (wId, d) => (schedule[wId] && schedule[wId][d]) || { am: null, pm: null };
  const lockedStore = (wId, d) => {
    const lk = lockAt(locks, wId, d);
    return lk ? lk.storeId : null;
  };

  function openCell(storeId, dayIdx) {
    const hasAnyone = HALVES.some((h) => workerAtHalf(schedule, workers, storeId, dayIdx, h));
    if (saved && hasAnyone && onCoverApply) setCover({ storeId, dayIdx });
    else setTarget({ storeId, dayIdx });
  }

  // ----- editing -----
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
      next[occupant.id][dayIdx][half] = wPrev != null ? wPrev : null; // two-way swap for that half
    }
    next[wId][dayIdx][half] = storeId;
    onChange(next);
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
    onChange(next);
  }
  // Unassignment is Tier 2 (§8): applies immediately, undo via toast.
  function clearHalf(storeId, dayIdx, half, { silent = false } = {}) {
    const prev = schedule;
    const next = cloneSchedule(schedule);
    const occupant = workerAtHalf(next, workers, storeId, dayIdx, half);
    if (!occupant) return;
    next[occupant.id][dayIdx][half] = null;
    onChange(next);
    if (!silent && onToast) {
      onToast(`Unassigned ${occupant.name} from ${storeName(storeId)} (${DAY_NAMES[dayIdx]})`, () => onChange(prev));
    }
  }
  function clearDay(storeId, dayIdx) {
    const prev = schedule;
    const next = cloneSchedule(schedule);
    const names = new Set();
    for (const half of HALVES) {
      const occupant = workerAtHalf(next, workers, storeId, dayIdx, half);
      if (occupant) {
        next[occupant.id][dayIdx][half] = null;
        names.add(occupant.name);
      }
    }
    if (!names.size) return;
    onChange(next);
    if (onToast) {
      onToast(`Unassigned ${[...names].join(' & ')} from ${storeName(storeId)} (${DAY_NAMES[dayIdx]})`, () =>
        onChange(prev)
      );
    }
  }

  function workerNote(w, dayIdx) {
    const lv = leaveAt(leaves, w.id, dayIdx);
    if (lv) return { kind: 'leave', label: lv.full ? 'On leave' : `On leave ${rangeCompact(lv)}` };
    const lockStore = lockedStore(w.id, dayIdx);
    if (lockStore != null) return { kind: 'lock', label: `Locked to ${storeName(lockStore)}` };
    const streak = streakBefore(w.id, dayIdx, schedule, lastWeekLoad);
    if (streak >= SOFT_MAX_CONSEC) return { kind: 'rest', label: `${streak} days straight — needs rest` };
    const s = slot(w.id, dayIdx);
    if (s.am != null || s.pm != null) {
      const at = s.am != null ? s.am : s.pm;
      return { kind: 'busy', label: `At ${storeName(at)} — will swap` };
    }
    return { kind: 'ok', label: 'Available' };
  }

  // ----- cell rendering -----
  // Every occupied cell shows the worker's name (primary) and the real
  // clock window they're on for (secondary), from the same shift-window
  // math the generator uses.
  function CellContent({ storeId, dayIdx }) {
    const store = storeById(storeId);
    const am = workerAtHalf(schedule, workers, storeId, dayIdx, 'am');
    const pm = workerAtHalf(schedule, workers, storeId, dayIdx, 'pm');

    if (am && pm && am.id === pm.id) {
      const kind = am.main_store_id === storeId ? 'main' : 'float';
      const locked = lockedStore(am.id, dayIdx) === storeId;
      return (
        <button
          type="button"
          className={`cell cell-${kind}`}
          disabled={readOnly}
          onClick={() => openCell(storeId, dayIdx)}
        >
          <span className="cell-name">
            {locked ? '🔒 ' : ''}
            {am.name}
          </span>
          <span className="cell-time">{shiftTimeCompact(store, dayIdx, 'full', splitTimes)}</span>
        </button>
      );
    }

    const anyOpen = !am || !pm;
    const halfBlock = (w, half) => (
      <span className={`cell-half ${w ? '' : 'cell-half-open'}`}>
        <span className="cell-name">
          {w && lockedStore(w.id, dayIdx) === storeId ? '🔒 ' : ''}
          {w ? w.name : 'OPEN'}
        </span>
        <span className="cell-time">{shiftTimeCompact(store, dayIdx, half, splitTimes)}</span>
      </span>
    );
    return (
      <button
        type="button"
        className={`cell ${anyOpen ? 'cell-gap' : 'cell-split'}`}
        disabled={readOnly}
        onClick={() => openCell(storeId, dayIdx)}
      >
        <span className="cell-halves">
          {halfBlock(am, 'am')}
          {halfBlock(pm, 'pm')}
        </span>
      </button>
    );
  }

  function WorkerDayText({ w, dayIdx }) {
    const s = slot(w.id, dayIdx);
    if (s.am == null && s.pm == null) {
      const lv = leaveAt(leaves, w.id, dayIdx);
      if (lv) {
        return (
          <span className="cell cell-leave cell-static">
            <span className="cell-name">Leave</span>
            {!lv.full && <span className="cell-time">{rangeCompact(lv)}</span>}
          </span>
        );
      }
      return <span className="cell cell-off cell-static">Off</span>;
    }
    if (s.am != null && s.am === s.pm) {
      return (
        <span className="cell cell-work cell-static">
          <span className="cell-name">{storeName(s.am)}</span>
          <span className="cell-time">{shiftTimeCompact(storeById(s.am), dayIdx, 'full', splitTimes)}</span>
        </span>
      );
    }
    const storeHalf = (sid, half) => (
      <span className={`cell-half ${sid != null ? '' : 'cell-half-open'}`}>
        <span className="cell-name">{sid != null ? storeName(sid) : '—'}</span>
        {sid != null && (
          <span className="cell-time">{shiftTimeCompact(storeById(sid), dayIdx, half, splitTimes)}</span>
        )}
      </span>
    );
    return (
      <span className="cell cell-work cell-static cell-halves">
        {storeHalf(s.am, 'am')}
        {storeHalf(s.pm, 'pm')}
      </span>
    );
  }

  const hoursOf = (wId) => workerHours(schedule[wId], stores, splitTimes);

  // ----- banner -----
  const bannerText = (() => {
    if (gaps.length === 0) return 'All stores covered, both shifts, all week.';
    const byCell = {};
    for (const g of gaps) {
      const key = `${g.storeId}|${g.dayIdx}`;
      byCell[key] = byCell[key] || [];
      byCell[key].push(g.half);
    }
    const parts = Object.entries(byCell).map(([key, halves]) => {
      const [sid, d] = key.split('|');
      const when = halves.length === 2 ? 'all day' : halves[0] === 'am' ? 'first shift' : 'second shift';
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
        <div className="view-toggle" role="tablist" aria-label="Layout">
          <button type="button" role="tab" aria-selected={mode === 'week'} className={mode === 'week' ? 'active' : ''} onClick={() => setMode('week')}>
            Week
          </button>
          <button type="button" role="tab" aria-selected={mode === 'day'} className={mode === 'day' ? 'active' : ''} onClick={() => setMode('day')}>
            Day
          </button>
        </div>
        <div className="view-toggle" role="tablist" aria-label="Group by">
          <button type="button" role="tab" aria-selected={group === 'store'} className={group === 'store' ? 'active' : ''} onClick={() => setGroup('store')}>
            By store
          </button>
          <button type="button" role="tab" aria-selected={group === 'worker'} className={group === 'worker' ? 'active' : ''} onClick={() => setGroup('worker')}>
            By worker
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
                  <div className="store-card-head">
                    {s.name}
                    <span className="store-card-hours">
                      {shiftTimeLabel(s, activeDay, 'full', splitTimes)}
                      {isSplitOnly(s) ? ' · split only' : ''}
                    </span>
                  </div>
                  <div className="store-card-halves">
                    <CellContent storeId={s.id} dayIdx={activeDay} />
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
                    <span className="worker-hours">{hoursOf(w.id)}h</span>
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
                  <td className="sticky-col name-cell">
                    {s.name}
                    {isSplitOnly(s) && <span className="chip chip-split">split only</span>}
                  </td>
                  {labels.map((_, d) => (
                    <td key={d}>
                      <CellContent storeId={s.id} dayIdx={d} />
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
                <th>Hours</th>
              </tr>
            </thead>
            <tbody>
              {workers.map((w) => {
                const load = weekWorkload(schedule[w.id]);
                const over = load > maxWorkdays(w);
                return (
                  <tr key={w.id}>
                    <td className="sticky-col name-cell">{w.name}</td>
                    {labels.map((_, d) => (
                      <td key={d}>
                        <WorkerDayText w={w} dayIdx={d} />
                      </td>
                    ))}
                    <td className={`days-total ${over ? 'days-over' : ''}`} title={`Allowance: ${maxWorkdays(w)}`}>
                      {load}
                    </td>
                    <td className="days-total">{hoursOf(w.id)}h</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="legend">
        <span className="cell cell-main cell-static">Main at home store</span>
        <span className="cell cell-float cell-static">Float / covering</span>
        <span className="cell cell-gap cell-static">OPEN</span>
        <span className="cell cell-leave cell-static">Leave</span>
        <span className="cell cell-static">🔒 Locked</span>
      </div>

      {cover && saved && !readOnly && (
        <FindCover
          store={storeById(cover.storeId)}
          dayIdx={cover.dayIdx}
          dayLabel={labels[cover.dayIdx]}
          stores={stores}
          workers={workers}
          schedule={schedule}
          leaves={leaves}
          locks={locks}
          splitTimes={splitTimes}
          lastWeekLoad={lastWeekLoad}
          onApply={(payload) => {
            setCover(null);
            onCoverApply(payload);
          }}
          onEditManually={() => {
            setTarget({ storeId: cover.storeId, dayIdx: cover.dayIdx });
            setCover(null);
          }}
          onClose={() => setCover(null)}
        />
      )}

      {target && !readOnly && (
        <CellEditor
          store={storeById(target.storeId)}
          dayIdx={target.dayIdx}
          dayLabel={labels[target.dayIdx]}
          workers={workers}
          schedule={schedule}
          workerNote={workerNote}
          splitTimes={splitTimes}
          onSplitTime={(t) => {
            const key = `${target.storeId}-${target.dayIdx}`;
            const next = { ...splitTimes };
            // Storing the derived default is a no-op — keep overrides sparse.
            const store = storeById(target.storeId);
            if (t && store && t !== minToHHMM(defaultSplitMin(store, target.dayIdx))) next[key] = t;
            else delete next[key];
            onSplitTimesChange(next);
          }}
          onAssignHalf={assignHalf}
          onAssignDay={assignDay}
          onClearHalf={clearHalf}
          onClearDay={clearDay}
          onClose={() => setTarget(null)}
        />
      )}
    </div>
  );
}

/**
 * The cell editor. Full shift = pick one worker for the whole day.
 * Split shift = pick a first-shift and a second-shift worker; the changeover
 * time defaults to the store's window midpoint (§2) and can be overridden for
 * this one day/store instance only.
 * Every worker is always listed, linked or not (§4) — Linked-stores-only is
 * P6, the silent tier, so no warning popup for unlinked picks.
 */
function CellEditor({
  store,
  dayIdx,
  dayLabel,
  workers,
  schedule,
  workerNote,
  splitTimes,
  onSplitTime,
  onAssignHalf,
  onAssignDay,
  onClearHalf,
  onClearDay,
  onClose,
}) {
  const am = workerAtHalf(schedule, workers, store.id, dayIdx, 'am');
  const pm = workerAtHalf(schedule, workers, store.id, dayIdx, 'pm');
  const isSplit = !!(am || pm) && !(am && pm && am.id === pm.id);
  const splitOnly = isSplitOnly(store);
  const [shiftMode, setShiftMode] = useState(splitOnly || isSplit ? 'split' : 'full');

  const overrideKey = `${store.id}-${dayIdx}`;
  const hasOverride = !!splitTimes[overrideKey];
  const splitValue = minToHHMM(splitMinFor(store, dayIdx, splitTimes));
  const defaultValue = minToHHMM(defaultSplitMin(store, dayIdx));

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grab" />
        <h3>
          {store.name} — {dayLabel}
        </h3>
        <p className="hint cell-hours-hint">
          Open {shiftTimeLabel(store, dayIdx, 'full', splitTimes)}
          {splitOnly ? ' · Split Shift Only store' : ''}
        </p>

        <div className="settings-seg shift-mode-seg">
          <button type="button" className={shiftMode === 'full' ? 'active' : ''} onClick={() => setShiftMode('full')}>
            Full shift{splitOnly ? ' ⚠' : ''}
          </button>
          <button type="button" className={shiftMode === 'split' ? 'active' : ''} onClick={() => setShiftMode('split')}>
            Split shift
          </button>
        </div>
        {splitOnly && shiftMode === 'full' && (
          <p className="hint">This store is Split-Shift-Only (P2) — a full-day assignment will raise a warning.</p>
        )}

        {shiftMode === 'full' ? (
          <>
            <p className="hint">One worker covers the whole day. Tap a name to assign.</p>
            <div className="current-halves">
              <div className={`cur ${am && pm && am.id === pm.id ? '' : 'cur-open'}`}>
                <span className="cur-tag">All day</span>
                <span className="cur-name">{am && pm && am.id === pm.id ? am.name : am || pm ? 'Split / partial' : 'OPEN'}</span>
                {(am || pm) && (
                  <button type="button" className="cur-clear" onClick={() => onClearDay(store.id, dayIdx)}>
                    clear day
                  </button>
                )}
              </div>
            </div>
            <ul className="picker">
              {workers.map((w) => {
                const note = workerNote(w, dayIdx);
                const active = am && pm && am.id === pm.id && am.id === w.id;
                return (
                  <li key={w.id}>
                    <button
                      type="button"
                      className={`pick pick-${note.kind} pick-row ${active ? 'pick-active' : ''}`}
                      onClick={() => {
                        onAssignDay(w.id, store.id, dayIdx);
                        onClose();
                      }}
                    >
                      <span className="pick-name">
                        {w.name}
                        <span className="pick-status">{note.label}</span>
                      </span>
                      {active && <span aria-hidden>✓</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <>
            <p className="hint">
              Two workers share the day — first shift, then second shift.
            </p>
            <div className="split-time-picker">
              <label className="split-time-label">
                <span>
                  Changeover time {hasOverride ? '(custom for this day)' : `(store default ${fmtMin(defaultSplitMin(store, dayIdx))})`}
                </span>
                <span className="split-time-controls">
                  <input type="time" value={splitValue} onChange={(e) => onSplitTime(e.target.value)} />
                  {hasOverride && (
                    <button type="button" className="mini-btn" title="Reset to store default" onClick={() => onSplitTime(null)}>
                      reset
                    </button>
                  )}
                </span>
              </label>
            </div>
            <div className="current-halves">
              <div className={`cur ${am ? '' : 'cur-open'}`}>
                <span className="cur-tag">{halfLabel('am', store, dayIdx, splitTimes)}</span>
                <span className="cur-name">{am ? am.name : 'OPEN'}</span>
                {am && (
                  <button type="button" className="cur-clear" onClick={() => onClearHalf(store.id, dayIdx, 'am')}>
                    clear
                  </button>
                )}
              </div>
              <div className={`cur ${pm ? '' : 'cur-open'}`}>
                <span className="cur-tag">{halfLabel('pm', store, dayIdx, splitTimes)}</span>
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
                const note = workerNote(w, dayIdx);
                return (
                  <li key={w.id}>
                    <div className={`pick pick-${note.kind}`}>
                      <span className="pick-name">
                        {w.name}
                        <span className="pick-status">{note.label}</span>
                      </span>
                      <span className="pick-btns">
                        <button
                          type="button"
                          className={`mini ${am && am.id === w.id ? 'active' : ''}`}
                          onClick={() => onAssignHalf(w.id, store.id, dayIdx, 'am')}
                        >
                          1st
                        </button>
                        <button
                          type="button"
                          className={`mini ${pm && pm.id === w.id ? 'active' : ''}`}
                          onClick={() => onAssignHalf(w.id, store.id, dayIdx, 'pm')}
                        >
                          2nd
                        </button>
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
