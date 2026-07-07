// Pure scheduling logic — no React, no network. Covered by tests/scheduler.test.js.
//
// Schedule model (now split-shift aware):
//   schedule[workerId][dayIdx] = { am: storeId|null, pm: storeId|null }
// A full day is { am: X, pm: X }. A morning-only worker is { am: X, pm: null }.
// A worker can even be { am: store1, pm: store2 } (a float bridging two stores).

export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const HALVES = ['am', 'pm'];
export const CLOSE_TIME = '22:00';

export const emptyDay = () => ({ am: null, pm: null });
export const EMPTY_WEEK = () => Array.from({ length: 7 }, emptyDay);

export function cloneSchedule(schedule) {
  const out = {};
  for (const id of Object.keys(schedule)) {
    out[id] = (schedule[id] || EMPTY_WEEK()).map((s) => ({ am: s ? s.am : null, pm: s ? s.pm : null }));
  }
  return out;
}

/** Does this worker work at all on day d (either half)? */
export function worksOn(row, d) {
  const s = row && row[d];
  return !!s && (s.am != null || s.pm != null);
}

/** Consecutive working days immediately before dayIdx, spilling into last week's record. */
export function consecutiveBefore(workerId, dayIdx, schedule, lastWeekWorked) {
  let streak = 0;
  const row = schedule[workerId] || [];
  for (let d = dayIdx - 1; d >= 0; d--) {
    if (worksOn(row, d)) streak++;
    else return streak;
  }
  const last = (lastWeekWorked && lastWeekWorked[workerId]) || [];
  for (let d = 6; d >= 0; d--) {
    if (last[d]) streak++;
    else break;
  }
  return streak;
}

/** Informational only — manual overrides ignore this. */
export function availability(worker, dayIdx, schedule, leaves, lastWeekWorked, maxConsec) {
  if (leaves[worker.id] && leaves[worker.id][dayIdx]) return { ok: false, reason: 'leave' };
  if (consecutiveBefore(worker.id, dayIdx, schedule, lastWeekWorked) >= maxConsec) return { ok: false, reason: 'rest' };
  return { ok: true };
}

export function daysWorked(row) {
  let n = 0;
  for (let d = 0; d < 7; d++) if (worksOn(row, d)) n++;
  return n;
}

export function halvesWorked(row) {
  let n = 0;
  for (let d = 0; d < 7; d++) {
    const s = row && row[d];
    if (s) {
      if (s.am != null) n++;
      if (s.pm != null) n++;
    }
  }
  return n;
}

/**
 * Build the week Monday→Sunday, full days only (splits are added by hand afterward).
 * 1. Main at their own store unless on leave / owed rest.
 * 2. Floats, fewest days first, fill uncovered stores.
 * 3. Leftovers stay open — surfaced live by computeGaps.
 */
export function generateSchedule({ stores, workers, leaves, lastWeekWorked, maxConsec }) {
  const schedule = {};
  workers.forEach((w) => (schedule[w.id] = EMPTY_WEEK()));
  const mains = workers.filter((w) => w.type === 'main');
  const floats = workers.filter((w) => w.type === 'float');

  for (let d = 0; d < 7; d++) {
    const uncovered = [];
    for (const store of stores) {
      const main = mains.find((m) => m.store_id === store.id);
      if (main && availability(main, d, schedule, leaves, lastWeekWorked, maxConsec).ok) {
        schedule[main.id][d] = { am: store.id, pm: store.id };
      } else {
        uncovered.push(store.id);
      }
    }
    const available = floats
      .filter((f) => availability(f, d, schedule, leaves, lastWeekWorked, maxConsec).ok)
      .sort((a, b) => daysWorked(schedule[a.id]) - daysWorked(schedule[b.id]));
    let i = 0;
    for (const storeId of uncovered) {
      if (i < available.length) {
        schedule[available[i].id][d] = { am: storeId, pm: storeId };
        i++;
      }
    }
  }
  return schedule;
}

/** Live per-half gap detection — never from a stored snapshot. */
export function computeGaps(schedule, stores, workers) {
  const gaps = [];
  for (const store of stores) {
    for (let d = 0; d < 7; d++) {
      for (const half of HALVES) {
        const covered = workers.some(
          (w) => schedule[w.id] && schedule[w.id][d] && schedule[w.id][d][half] === store.id
        );
        if (!covered) gaps.push({ storeId: store.id, dayIdx: d, half });
      }
    }
  }
  return gaps;
}

export function workerAtHalf(schedule, workers, storeId, dayIdx, half) {
  return (
    workers.find((w) => schedule[w.id] && schedule[w.id][dayIdx] && schedule[w.id][dayIdx][half] === storeId) || null
  );
}

// ---------- Shift-time display ----------

export function openTime(dayIdx) {
  return dayIdx >= 5 ? '9:00' : '8:00'; // Sat=5, Sun=6 open at 9
}

export function fmtTime(hhmm) {
  const [h] = hhmm.split(':').map(Number);
  const ap = h >= 12 ? 'PM' : 'AM';
  const h12 = ((h + 11) % 12) + 1;
  return `${h12} ${ap}`;
}

export function halfLabel(dayIdx, half, splitTime) {
  return half === 'am'
    ? `${fmtTime(openTime(dayIdx))}–${fmtTime(splitTime)}`
    : `${fmtTime(splitTime)}–${fmtTime(CLOSE_TIME)}`;
}

// ---------- Date helpers (local-time, ISO yyyy-mm-dd) ----------

export function toISODate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export function fromISODate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function mondayOf(iso) {
  const d = fromISODate(iso);
  const offset = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - offset);
  return toISODate(d);
}
export function nextMonday(from = new Date()) {
  const d = new Date(from);
  const diff = (8 - d.getDay()) % 7 || 7;
  d.setDate(d.getDate() + diff);
  return toISODate(d);
}
export function addDays(iso, n) {
  const d = fromISODate(iso);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}
export function dayLabels(weekStartISO) {
  return DAY_NAMES.map((name, i) => `${name} ${fromISODate(addDays(weekStartISO, i)).getDate()}`);
}
export function formatWeek(weekStartISO) {
  return fromISODate(weekStartISO).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
