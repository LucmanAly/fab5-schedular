import { useState } from 'react';
import {
  findCoverCandidates,
  findChainSwaps,
  cloneSchedule,
  emptyDay,
  workerAtHalf,
  shiftTimeLabel,
  EMPTY_WEEK,
  HALVES,
} from '../lib/scheduler';

/**
 * Find Cover (§7) — post-publication change assistant. Opens when the admin
 * taps an assigned cell on a saved schedule. Lists linked, genuinely-free
 * candidates (schedule-off) with greyed-out requested-off workers, ranked
 * green (breaks nothing) / yellow (silent P6–P9 cost) / red (P1–P5, still
 * selectable — warn+confirm happens upstream on apply). "Run Chain Swap"
 * (§7.1) is opt-in and searches multi-hop paths, presented as sentences.
 */
export default function FindCover({
  store,
  dayIdx,
  dayLabel,
  stores,
  workers,
  schedule,
  leaves,
  locks,
  splitTimes,
  lastWeekLoad,
  onApply, // ({ schedule, leaves, description }) => void
  onEditManually,
  onClose,
}) {
  const am = workerAtHalf(schedule, workers, store.id, dayIdx, 'am');
  const pm = workerAtHalf(schedule, workers, store.id, dayIdx, 'pm');
  const assigned = [];
  if (am) assigned.push(am);
  if (pm && (!am || pm.id !== am.id)) assigned.push(pm);

  const [who, setWho] = useState(assigned.length === 1 ? assigned[0] : null);
  const [chains, setChains] = useState(null); // null = not requested yet

  const base = {
    schedule,
    stores,
    workers,
    leaves,
    locks,
    splitTimes,
    lastWeekLoad,
    storeId: store.id,
    dayIdx,
  };

  const result = who ? findCoverCandidates({ ...base, workerId: who.id }) : null;

  function applyCandidate(c) {
    const halves = result.halves;
    const next = cloneSchedule(schedule);
    if (!next[c.worker.id]) next[c.worker.id] = EMPTY_WEEK();
    next[who.id][dayIdx] = emptyDay();
    for (const h of halves) next[c.worker.id][dayIdx][h] = store.id;
    // The original worker's day is recorded as leave (§7 direct apply).
    const nextLeaves = { ...leaves, [who.id]: [...(leaves[who.id] || Array(7).fill(false))] };
    nextLeaves[who.id][dayIdx] = true;
    onApply({
      schedule: next,
      leaves: nextLeaves,
      description: `${c.worker.name} covers ${who.name} at ${store.name} on ${dayLabel}`,
    });
  }

  function runChains() {
    setChains(findChainSwaps({ ...base, workerId: who.id }));
  }

  const halvesLabel =
    result && result.halves.length === 2
      ? 'all day'
      : result
        ? shiftTimeLabel(store, dayIdx, result.halves[0], splitTimes)
        : '';

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grab" />
        <h3>
          Find cover — {store.name}, {dayLabel}
        </h3>

        {!who && (
          <>
            <p className="hint">Two workers share this day. Who needs cover?</p>
            <ul className="picker">
              {assigned.map((w) => (
                <li key={w.id}>
                  <button type="button" className="pick pick-row" onClick={() => setWho(w)}>
                    <span className="pick-name">{w.name}</span>
                    <span className="pick-status">
                      {HALVES.filter((h) => (schedule[w.id][dayIdx] || {})[h] === store.id)
                        .map((h) => shiftTimeLabel(store, dayIdx, h, splitTimes))
                        .join(' + ')}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        {who && (
          <>
            <p className="hint">
              Covering <strong>{who.name}</strong> ({halvesLabel}). {who.name}&rsquo;s day will be recorded as leave.
              Applying lands on the board as an unsaved edit — make as many changes as you need, then save once to
              publish them as a new version.
            </p>

            {result.candidates.length === 0 && (
              <p className="hint">No workers linked to {store.name} are free that day. Try a chain swap below.</p>
            )}

            <ul className="picker">
              {result.candidates.map((c) => (
                <li key={c.worker.id}>
                  <button
                    type="button"
                    className={`pick pick-row cover-${c.level} ${c.off === 'requested' ? 'cover-requested' : ''}`}
                    disabled={c.off === 'requested'}
                    onClick={() => applyCandidate(c)}
                  >
                    <span className="pick-name">
                      {c.worker.name}
                      <span className="cover-hours">{c.hours}h this week</span>
                      {c.badges.map((b) => (
                        <span key={b} className={`cover-badge cover-badge-${c.level}`}>
                          {b}
                        </span>
                      ))}
                    </span>
                    <span className={`cover-dot cover-dot-${c.level}`} aria-hidden>
                      ●
                    </span>
                  </button>
                </li>
              ))}
            </ul>

            <div className="chain-section">
              {chains === null ? (
                <button type="button" className="btn" onClick={runChains}>
                  Run Chain Swap
                </button>
              ) : chains.length === 0 ? (
                <p className="hint">No viable chain swaps found.</p>
              ) : (
                <ul className="picker">
                  {chains.map((ch, i) => (
                    <li key={i}>
                      <button
                        type="button"
                        className="pick pick-row cover-green"
                        onClick={() =>
                          onApply({ schedule: ch.schedule, leaves: ch.leaves, description: ch.sentence })
                        }
                      >
                        <span className="pick-name">{ch.sentence}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}

        <div className="modal-actions">
          <button type="button" className="btn" onClick={onEditManually}>
            Edit manually
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
