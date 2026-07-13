// Pure scheduling logic — no React, no network. Covered by tests/scheduler.test.js.
//
// Schedule model (split-shift aware):
//   schedule[workerId][dayIdx] = { am: storeId|null, pm: storeId|null }
// A full day is { am: X, pm: X }. { am: X, pm: Y } is a worker bridging two stores.
//
// Store model (v4):
//   { id, name, shift_mode: 'default'|'split_only',
//     weekday_open, weekday_close, weekend_open, weekend_close }  ('HH:MM')
// Weekday default 08:00–22:00, weekend (Sat+Sun) default 09:00–22:00.
// A close at or before the open time means past midnight (e.g. 12pm–2am).
//
// Worker model:
//   { id, name, store_ids: [storeId, ...], main_store_id: storeId|null,
//     max_workdays: number (0.5 granularity, default 5) }
// store_ids is ordered: first = first-linked (highest float preference). A Main
// worker's home store is always store_ids[0] and equals main_store_id.
//
// Priority ladder (v4 — 1 = most protected, 9 = most disposable):
//   P1  Coverage every store/shift/day + no double-booking (real time overlap).
//   P2  Store Shift Mode — split-only stores are always split.
//   P3  Leave Requests.
//   P4  Locks.
//   P5  Worker Day Allowance (max workdays/week; full = 1, split half = 0.5).
//   P6  Linked stores only.
//   P7  Consecutive-day ceiling (hardwired: soft 3, hard 4).
//   P8  Prefer full shifts (split-day fallback near the P7 ceiling).
//   P9  Unique off-days (soft, history-driven; needs 2 saved weeks).
// The generator auto-breaks P9 → P8 → P7 → P6 silently. P1–P5 problems are
// returned as violations for the UI's interactive box.
//
// Store-link ranking (not a P-level): after the ladder narrows a slot to
// eligible candidates, Main-at-this-store wins, then earlier link order.

export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const HALVES = ['am', 'pm'];

// Priority 7 — hardwired, not user-configurable.
export const SOFT_MAX_CONSEC = 3;
export const HARD_MAX_CONSEC = 4;

export const DEFAULT_MAX_WORKDAYS = 5;

export const emptyDay = () => ({ am: null, pm: null });
export const EMPTY_WEEK = () => Array.from({ length: 7 }, emptyDay);

export function cloneSchedule(schedule) {
  const out = {};
  for (const id of Object.keys(schedule)) {
    out[id] = (schedule[id] || EMPTY_WEEK()).map((s) => ({ am: s ? s.am : null, pm: s ? s.pm : null }));
  }
  return out;
}

// ---------- Store hours & shift windows (v4) ----------

export function toMin(hhmm) {
  if (typeof hhmm === 'number') return hhmm;
  const [h, m] = String(hhmm).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function minToHHMM(min) {
  const m = ((min % 1440) + 1440) % 1440;
  const p = (n) => String(n).padStart(2, '0');
  return `${p(Math.floor(m / 60))}:${p(m % 60)}`;
}

export const isWeekend = (dayIdx) => dayIdx >= 5; // Mon-start week: Sat=5, Sun=6

export function isSplitOnly(store) {
  return !!store && store.shift_mode === 'split_only';
}

/**
 * Opening window for a store on a day, in minutes from midnight.
 * close may exceed 1440 when the store runs past midnight (12pm–2am → 720–1560).
 */
export function storeWindow(store, dayIdx) {
  const wknd = isWeekend(dayIdx);
  const open = toMin((wknd ? store.weekend_open : store.weekday_open) || (wknd ? '09:00' : '08:00'));
  let close = toMin((wknd ? store.weekend_close : store.weekday_close) || '22:00');
  if (close <= open) close += 1440;
  return { open, close };
}

/** Default split point = window midpoint, snapped to the nearest half hour. */
export function defaultSplitMin(store, dayIdx) {
  const { open, close } = storeWindow(store, dayIdx);
  return Math.round((open + close) / 2 / 30) * 30;
}

/**
 * Effective split point for one store/day instance. splitTimes holds
 * per-instance overrides keyed "storeId-dayIdx" as 'HH:MM'; anything outside
 * the window falls back to the derived default.
 */
export function splitMinFor(store, dayIdx, splitTimes = {}) {
  const raw = splitTimes[`${store.id}-${dayIdx}`];
  if (raw) {
    const { open, close } = storeWindow(store, dayIdx);
    let t = toMin(raw);
    if (t <= open) t += 1440; // past-midnight override, e.g. 01:00 on a 12pm–2am store
    if (t > open && t < close) return t;
  }
  return defaultSplitMin(store, dayIdx);
}

/** Real clock window of one half (or the whole day for 'full'). */
export function shiftWindow(store, dayIdx, half, splitTimes = {}) {
  const { open, close } = storeWindow(store, dayIdx);
  if (half === 'full') return { start: open, end: close };
  const split = splitMinFor(store, dayIdx, splitTimes);
  return half === 'am' ? { start: open, end: split } : { start: split, end: close };
}

export const windowsOverlap = (a, b) => a.start < b.end && b.start < a.end;

/**
 * The real time intervals a worker is on the clock for on one day.
 * A full day at one store is one interval; split assignments are separate.
 */
export function dayIntervals(slot, stores, dayIdx, splitTimes = {}) {
  if (!slot) return [];
  const byId = (id) => stores.find((s) => s.id === id);
  if (slot.am != null && slot.am === slot.pm) {
    const st = byId(slot.am);
    return st ? [{ storeId: slot.am, half: 'full', ...shiftWindow(st, dayIdx, 'full', splitTimes) }] : [];
  }
  const out = [];
  for (const half of HALVES) {
    const id = slot[half];
    if (id == null) continue;
    const st = byId(id);
    if (st) out.push({ storeId: id, half, ...shiftWindow(st, dayIdx, half, splitTimes) });
  }
  return out;
}

/** Hours (decimal) a worker is scheduled for across the week. */
export function workerHours(row, stores, splitTimes = {}) {
  let mins = 0;
  for (let d = 0; d < 7; d++) {
    for (const iv of dayIntervals(row && row[d], stores, d, splitTimes)) mins += iv.end - iv.start;
  }
  return Math.round((mins / 60) * 10) / 10;
}

// ---------- Basic accessors ----------

/** Does this worker work at all on day d (either half)? */
export function worksOn(row, d) {
  const s = row && row[d];
  return !!s && (s.am != null || s.pm != null);
}

/** Full day = both halves assigned (possibly at two different stores). */
export function worksFull(row, d) {
  const s = row && row[d];
  return !!s && s.am != null && s.pm != null;
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

/** P5 load in workday units: full day = 1, single half = 0.5. */
export function weekWorkload(row) {
  let n = 0;
  for (let d = 0; d < 7; d++) {
    const s = row && row[d];
    if (!s) continue;
    if (s.am != null && s.pm != null) n += 1;
    else if (s.am != null || s.pm != null) n += 0.5;
  }
  return n;
}

export function maxWorkdays(worker) {
  const v = Number(worker && worker.max_workdays);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_MAX_WORKDAYS;
}

/**
 * Per-day load for a week: 0 = off, 1 = half day, 2 = full day.
 * Used to carry last week's tail into this week's streak counting.
 */
export function weekLoadFromSchedule(schedule) {
  const out = {};
  for (const id of Object.keys(schedule)) {
    out[id] = (schedule[id] || EMPTY_WEEK()).map((s) => {
      if (!s || (s.am == null && s.pm == null)) return 0;
      return s.am != null && s.pm != null ? 2 : 1;
    });
  }
  return out;
}

/**
 * Consecutive FULL working days immediately before dayIdx, spilling into last
 * week. A half day counts as a partial rest and resets the streak — that is
 * exactly the Priority-8 escape hatch for an unavoidable extra day.
 */
export function streakBefore(workerId, dayIdx, schedule, lastWeekLoad) {
  let streak = 0;
  const row = schedule[workerId] || [];
  for (let d = dayIdx - 1; d >= 0; d--) {
    if (worksFull(row, d)) streak++;
    else return streak;
  }
  const last = (lastWeekLoad && lastWeekLoad[workerId]) || [];
  for (let d = 6; d >= 0; d--) {
    if (last[d] === 2 || last[d] === true) streak++; // `true` accepts legacy boolean arrays
    else break;
  }
  return streak;
}

export function isMain(worker) {
  return worker.main_store_id != null;
}

export function isLinked(worker, storeId) {
  return Array.isArray(worker.store_ids) && worker.store_ids.includes(storeId);
}

/** 0 = first-linked store; large number = not linked. */
export function linkRank(worker, storeId) {
  const i = Array.isArray(worker.store_ids) ? worker.store_ids.indexOf(storeId) : -1;
  return i === -1 ? 999 : i;
}

// ---------- Leave / lock accessors (v4.1: optional time ranges) ----------
// A leave cell is false | true (whole day) | { start:'HH:MM', end:'HH:MM' }.
// A lock cell is null | storeId (whole day) | { storeId, start, end }.
// Ranges use the same minutes-from-midnight model as store windows, including
// past-midnight handling (end <= start rolls into the next day).

/** Normalized leave: null, { full:true }, or { full:false, start, end } (minutes). */
export function leaveAt(leaves, workerId, dayIdx) {
  const row = leaves && leaves[workerId];
  const v = row ? row[dayIdx] : null;
  if (!v) return null;
  if (v === true) return { full: true };
  if (typeof v === 'object' && v.start && v.end) {
    const start = toMin(v.start);
    let end = toMin(v.end);
    if (end <= start) end += 1440;
    return { full: false, start, end };
  }
  return { full: true };
}

function fullLeave(leaves, workerId, dayIdx) {
  const lv = leaveAt(leaves, workerId, dayIdx);
  return !!(lv && lv.full);
}

/** Normalized lock: null or { storeId, start?, end? } (minutes when ranged). */
export function lockAt(locks, workerId, dayIdx) {
  const row = locks && locks[workerId];
  const v = row ? row[dayIdx] : null;
  if (v == null) return null;
  if (typeof v === 'object') {
    const out = { storeId: v.storeId };
    if (v.start && v.end) {
      out.start = toMin(v.start);
      out.end = toMin(v.end);
      if (out.end <= out.start) out.end += 1440;
    }
    return out;
  }
  return { storeId: v };
}

/**
 * Which half of a (possibly seeded) store day a range corresponds to:
 * 'am' (range is a prefix ending at the changeover), 'pm' (suffix starting at
 * it), 'full' (covers the whole window), or null (unanchored — the two-halves
 * model can't represent a middle slice; input validation prevents this).
 */
export function rangeHalfFor(store, dayIdx, range, splitTimes = {}) {
  const { open, close } = storeWindow(store, dayIdx);
  if (range.start <= open && range.end >= close) return 'full';
  const split = splitMinFor(store, dayIdx, splitTimes);
  if (range.start <= open && range.end === split) return 'am';
  if (range.start === split && range.end >= close) return 'pm';
  return null;
}

/**
 * Pre-generation seeding (§ time-range constraints): a time-range lock — or a
 * range leave on a store's Main — sets that store+day's changeover to the
 * range boundary, reusing the existing per-instance override mechanism, so
 * the generator's two halves line up with the constraint and the remainder
 * stays open for normal P1 fill.
 * Returns { splitTimes, conflicts }: conflicts are P4 violations for
 * store+days where two ranges demand different changeover points.
 */
export function seedSplitTimes({ stores, workers, leaves = {}, locks = {}, splitTimes = {} }) {
  const out = { ...splitTimes };
  const seeded = {}; // key -> { boundary, workerId } (first claim wins; mismatches conflict)
  const conflicts = [];

  const boundaryOf = (store, dayIdx, range) => {
    const { open, close } = storeWindow(store, dayIdx);
    if (range.start <= open && range.end >= close) return null; // whole day, nothing to seed
    if (range.start <= open && range.end < close) return range.end; // prefix
    if (range.start > open && range.end >= close) return range.start; // suffix
    return undefined; // unanchored middle slice
  };

  const claim = (store, dayIdx, range, workerId, hard) => {
    const b = boundaryOf(store, dayIdx, range);
    if (b === null || b === undefined) return; // nothing to seed (whole-day or unanchored)
    const key = `${store.id}-${dayIdx}`;
    if (seeded[key] !== undefined) {
      if (seeded[key].boundary !== b && hard) {
        conflicts.push({
          priority: 4,
          type: 'lock_conflict',
          storeId: store.id,
          dayIdx,
          workerId,
          otherWorkerId: seeded[key].workerId,
          boundaryA: seeded[key].boundary,
          boundaryB: b,
        });
      }
      return; // first claim keeps the changeover (soft claims never fight)
    }
    seeded[key] = { boundary: b, workerId };
    out[key] = minToHHMM(b);
  };

  // Locks first (hard claims), then Main leaves (soft convenience claims).
  for (const w of workers) {
    for (let d = 0; d < 7; d++) {
      const lk = lockAt(locks, w.id, d);
      if (lk && lk.start != null) {
        const st = stores.find((s) => s.id === lk.storeId);
        if (st) claim(st, d, lk, w.id, true);
      }
    }
  }
  for (const w of workers) {
    if (w.main_store_id == null) continue;
    const st = stores.find((s) => s.id === w.main_store_id);
    if (!st) continue;
    for (let d = 0; d < 7; d++) {
      const lv = leaveAt(leaves, w.id, d);
      if (lv && !lv.full) {
        // Seed the complement: the worker is available OUTSIDE the leave
        // window, so the changeover should sit at the leave boundary.
        claim(st, d, lv, w.id, false);
      }
    }
  }

  return { splitTimes: out, conflicts };
}

/**
 * P9 helper — offDayHistory: for each worker, how many of the last saved weeks
 * they were fully off on each day. historyWeeks is an array of week schedules
 * (newest first is fine; order doesn't matter).
 */
export function offDayHistory(historyWeeks, workers) {
  const out = {};
  for (const w of workers) out[w.id] = [0, 0, 0, 0, 0, 0, 0];
  for (const sched of historyWeeks || []) {
    for (const w of workers) {
      const row = sched && sched[w.id];
      for (let d = 0; d < 7; d++) if (!worksOn(row, d)) out[w.id][d]++;
    }
  }
  return out;
}

// ---------- Generator ----------

/**
 * Generate the week. Returns { schedule, violations, splitTimes }.
 * Violations are only Priority 1–5 problems the engine could not solve;
 * P6–P9 are relaxed internally without reporting.
 *
 * leaves:  { workerId: [(bool | {start,end}) x7] } — ranges are partial leaves
 * locks:   { workerId: [(storeId | {storeId,start,end} | null) x7] }
 * lastWeekLoad: { workerId: [0|1|2 x7] } from weekLoadFromSchedule()
 * history: array of the last saved week schedules (for P9; needs >= 2 to act)
 * splitTimes: per-instance split overrides. Time-range locks/leaves seed
 *   additional overrides (seedSplitTimes) — the merged map is returned so the
 *   caller can display and persist the changeovers the schedule was built on.
 */
export function generateSchedule({
  stores,
  workers,
  leaves = {},
  locks = {},
  lastWeekLoad = {},
  history = [],
  splitTimes: splitTimesIn = {},
}) {
  const schedule = {};
  workers.forEach((w) => (schedule[w.id] = EMPTY_WEEK()));
  const violations = [];

  // Time-range constraints line the store's changeover up with their boundary
  // before anything is placed; irreconcilable range pairs surface as P4.
  const { splitTimes, conflicts } = seedSplitTimes({ stores, workers, leaves, locks, splitTimes: splitTimesIn });
  violations.push(...conflicts);

  const storeById = (id) => stores.find((s) => s.id === id);
  const streak = (w, d) => streakBefore(w.id, d, schedule, lastWeekLoad);

  // P9 only acts with at least 2 saved weeks of history; otherwise a no-op.
  const hist = (history || []).length >= 2 ? offDayHistory(history, workers) : null;

  const coveredAt = (storeId, d, half) =>
    workers.some((w) => schedule[w.id][d][half] === storeId);

  /**
   * Can w take `half` ('am'|'pm'|'full') at store on day d without breaking
   * P1 (slot taken / real time overlap), P2 (split-only same-worker day), or
   * P3 (a partial leave window — checked with the same real-interval math)?
   */
  function canTake(w, d, half, store) {
    const slot = schedule[w.id][d];
    const lv = leaveAt(leaves, w.id, d);
    const clearOfLeave = (win) => !lv || lv.full || !windowsOverlap(win, lv);
    if (half === 'full') {
      return (
        slot.am == null &&
        slot.pm == null &&
        !isSplitOnly(store) &&
        clearOfLeave(shiftWindow(store, d, 'full', splitTimes))
      );
    }
    if (slot[half] != null) return false;
    if (!clearOfLeave(shiftWindow(store, d, half, splitTimes))) return false;
    const other = half === 'am' ? 'pm' : 'am';
    if (isSplitOnly(store) && slot[other] === store.id) return false; // P2
    if (slot[other] != null) {
      const otherStore = storeById(slot[other]);
      if (otherStore) {
        const a = shiftWindow(store, d, half, splitTimes);
        const b = shiftWindow(otherStore, d, other, splitTimes);
        if (windowsOverlap(a, b)) return false; // P1: real clock-time overlap
      }
    }
    return true;
  }

  /** Would assigning `half` on day d keep w within their day allowance (P5)? */
  function allowanceOK(w, d, half) {
    const slot = schedule[w.id][d];
    const delta = half === 'full' ? 1 : slot[half === 'am' ? 'pm' : 'am'] != null ? 0.5 : 0.5;
    return weekWorkload(schedule[w.id]) + delta <= maxWorkdays(w);
  }

  // Rank candidates for a specific store (the §5 tie-breaker): its Main first,
  // then link order, then spread the load evenly, then P9 (prefer working
  // someone who was off this weekday in recent history, rotating off-days).
  const rankFor = (storeId, d) => (a, b) =>
    Number(b.main_store_id === storeId) - Number(a.main_store_id === storeId) ||
    linkRank(a, storeId) - linkRank(b, storeId) ||
    daysWorked(schedule[a.id]) - daysWorked(schedule[b.id]) ||
    halvesWorked(schedule[a.id]) - halvesWorked(schedule[b.id]) ||
    (hist ? hist[b.id][d] - hist[a.id][d] : 0) ||
    a.id - b.id;

  // Run length worker v would sit in if day m became a full day for them.
  function fullRunIfFilled(v, m) {
    const behind = streakBefore(v.id, m, schedule, lastWeekLoad);
    let ahead = 0;
    for (let i = m + 1; i < 7; i++) {
      if (worksFull(schedule[v.id], i)) ahead++;
      else break;
    }
    return behind + 1 + ahead;
  }

  // P8 break: worker w is at the hard ceiling before day d. Downgrade one of
  // the middle days of the current run to a half shift, handing the matching
  // half to another available worker, so w's streak resets and day d is legal.
  function tryMidStreakSplit(w, d) {
    const row = schedule[w.id];
    const runDays = [];
    for (let m = d - 1; m >= 0; m--) {
      if (worksFull(row, m)) runDays.push(m);
      else break;
    }
    const usable = runDays.filter((m) => m >= d - HARD_MAX_CONSEC);
    usable.sort((a, b) => Number(a === d - 1) - Number(b === d - 1) || a - b);
    for (const m of usable) {
      if (lockAt(locks, w.id, m) != null) continue; // locked days stay whole
      if (row[m].am !== row[m].pm) continue; // must be one store all day
      const storeX = storeById(row[m].am);
      if (!storeX) continue;
      for (const half of ['pm', 'am']) {
        const other = half === 'pm' ? 'am' : 'pm';
        const takers = workers
          .filter(
            (v) =>
              v.id !== w.id &&
              !fullLeave(leaves, v.id, m) &&
              canTake(v, m, half, storeX) &&
              allowanceOK(v, m, half) &&
              (schedule[v.id][m][other] == null ? true : fullRunIfFilled(v, m) <= HARD_MAX_CONSEC)
          )
          .sort(
            (a, b) =>
              Number(!isLinked(a, storeX.id)) - Number(!isLinked(b, storeX.id)) ||
              rankFor(storeX.id, m)(a, b)
          );
        if (takers.length) {
          schedule[takers[0].id][m][half] = storeX.id;
          row[m][half] = null; // w keeps the other half — a genuine split day
          return true;
        }
      }
    }
    return false;
  }

  // Pick the best worker for store s on day d. mode: 'full' | 'am' | 'pm'.
  // Silent relaxation order: P7 soft→hard, then P6 (unlinked), then the P8
  // mid-streak split. Breaking P5 (allowance) is last and is reported.
  function pick(store, d, mode) {
    // Full-day leaves exclude outright; partial leaves are window-checked in canTake.
    const base = workers.filter((w) => !fullLeave(leaves, w.id, d) && canTake(w, d, mode, store));
    const tiers = [
      (w) => isLinked(w, store.id) && streak(w, d) < SOFT_MAX_CONSEC && allowanceOK(w, d, mode),
      (w) => isLinked(w, store.id) && streak(w, d) < HARD_MAX_CONSEC && allowanceOK(w, d, mode), // P7 → ceiling
      (w) => !isLinked(w, store.id) && streak(w, d) < SOFT_MAX_CONSEC && allowanceOK(w, d, mode), // P6 break
      (w) => !isLinked(w, store.id) && streak(w, d) < HARD_MAX_CONSEC && allowanceOK(w, d, mode),
    ];
    for (const tier of tiers) {
      const c = base.filter(tier).sort(rankFor(store.id, d));
      if (c.length) return { worker: c[0] };
    }
    // P8 break: free a ceiling-bound linked worker via a mid-run split day.
    const stuck = base.filter((w) => isLinked(w, store.id) && allowanceOK(w, d, mode)).sort(rankFor(store.id, d));
    for (const w of stuck) {
      if (tryMidStreakSplit(w, d)) return { worker: w };
    }
    // P5 break: exceed someone's day allowance rather than leave a gap. The
    // rebalance pass afterwards tries to repair it; leftovers are reported.
    const overAllowance = base.filter((w) => streak(w, d) < HARD_MAX_CONSEC).sort(rankFor(store.id, d));
    if (overAllowance.length) return { worker: overAllowance[0] };
    return null;
  }

  function place(w, store, d, mode) {
    if (mode === 'full') schedule[w.id][d] = { am: store.id, pm: store.id };
    else schedule[w.id][d][mode] = store.id;
  }

  // P5 repair pass. The greedy day loop can front-load capacity (mains burn
  // their allowance Mon–Sat and Sunday comes up short) even when a schedule
  // within everyone's allowance exists. Hand days from over-allowance workers
  // to workers with spare allowance; whatever remains is a genuine P5 break.
  function rebalanceAllowance() {
    for (const w of workers) {
      let guard = 0;
      while (weekWorkload(schedule[w.id]) > maxWorkdays(w) && guard++ < 14) {
        let moved = false;
        // Latest day first: keeps the front of a Main's week at their store.
        for (let m = 6; m >= 0 && !moved; m--) {
          const slot = schedule[w.id][m];
          if (slot.am == null && slot.pm == null) continue;
          if (lockAt(locks, w.id, m) != null) continue; // locked days stay put
          if (slot.am != null && slot.am === slot.pm) {
            const store = storeById(slot.am);
            if (!store) continue;
            const takers = workers
              .filter(
                (v) =>
                  v.id !== w.id &&
                  !fullLeave(leaves, v.id, m) &&
                  canTake(v, m, 'full', store) &&
                  allowanceOK(v, m, 'full') &&
                  fullRunIfFilled(v, m) <= HARD_MAX_CONSEC
              )
              .sort(rankFor(store.id, m));
            if (takers.length) {
              schedule[w.id][m] = emptyDay();
              schedule[takers[0].id][m] = { am: store.id, pm: store.id };
              moved = true;
            }
          } else {
            for (const half of HALVES) {
              if (slot[half] == null) continue;
              const store = storeById(slot[half]);
              if (!store) continue;
              const takers = workers
                .filter(
                  (v) =>
                    v.id !== w.id &&
                    !fullLeave(leaves, v.id, m) &&
                    canTake(v, m, half, store) &&
                    allowanceOK(v, m, half)
                )
                .sort(rankFor(store.id, m));
              if (takers.length) {
                slot[half] = null;
                schedule[takers[0].id][m][half] = store.id;
                moved = true;
                break;
              }
            }
          }
        }
        if (!moved) break;
      }
    }
  }

  for (let d = 0; d < 7; d++) {
    // --- P4: locks are placed first. A time-range lock takes exactly the half
    // its window maps to (the changeover was seeded to its boundary) — the
    // other half stays open for normal P1 fill. On a split-only store a
    // whole-day lock gets one half (P2 outranks the lock's full-day shape;
    // the lock itself — "works that store that day" — is still honoured).
    for (const w of workers) {
      const lk = lockAt(locks, w.id, d);
      if (lk == null) continue;
      const st = storeById(lk.storeId);
      if (st && lk.start != null) {
        const half = rangeHalfFor(st, d, lk, splitTimes);
        if (half === 'am' || half === 'pm') {
          schedule[w.id][d][half] = lk.storeId;
          continue;
        }
        // 'full' (range covers the whole window) or unanchored (input
        // validation prevents; defensively treated as whole-day below).
      }
      if (st && isSplitOnly(st)) schedule[w.id][d].am = lk.storeId;
      else schedule[w.id][d] = { am: lk.storeId, pm: lk.storeId };
    }

    // --- Mains default to their home store on days they can work ---
    // A store may have up to 2 Mains (backup/redundancy, not a workload
    // split): whichever is available covers; if both are, the fairness
    // tie-break in rankFor (fewest days/halves worked) picks one; if neither
    // is, this store falls through unchanged to the P1 fill loop below.
    for (const store of stores) {
      const mode = isSplitOnly(store) ? 'am' : 'full';
      if (coveredAt(store.id, d, 'am') && (mode === 'am' || coveredAt(store.id, d, 'pm'))) continue;

      const candidates = workers
        .filter((w) => w.main_store_id === store.id)
        .filter((main) => lockAt(locks, main.id, d) == null)
        .filter((main) => !fullLeave(leaves, main.id, d))
        .filter((main) => streak(main, d) < SOFT_MAX_CONSEC) // rest them if a float can cover
        .sort(rankFor(store.id, d));

      for (const main of candidates) {
        if (!canTake(main, d, mode, store) || !allowanceOK(main, d, mode)) continue; // try the other Main
        place(main, store, d, mode);
        break;
      }
    }

    // --- P1: fill every remaining half ---
    for (const store of stores) {
      const needAm = !coveredAt(store.id, d, 'am');
      const needPm = !coveredAt(store.id, d, 'pm');
      if (!needAm && !needPm) continue;

      // P8: prefer one worker all day — but never on a split-only store (P2).
      if (needAm && needPm && !isSplitOnly(store)) {
        const got = pick(store, d, 'full');
        if (got) {
          place(got.worker, store, d, 'full');
          continue;
        }
      }
      for (const half of HALVES) {
        if (half === 'am' ? !needAm : !needPm) continue;
        if (coveredAt(store.id, d, half)) continue;
        const got = pick(store, d, half);
        if (got) place(got.worker, store, d, half);
        else violations.push({ priority: 1, type: 'coverage', storeId: store.id, dayIdx: d, half });
      }
    }
  }

  // P5: repair allowance overruns where spare capacity exists; report the rest.
  rebalanceAllowance();
  for (const w of workers) {
    const load = weekWorkload(schedule[w.id]);
    if (load > maxWorkdays(w)) {
      violations.push({ priority: 5, type: 'allowance', workerId: w.id, load, max: maxWorkdays(w) });
    }
  }

  return { schedule, violations, splitTimes };
}

// ---------- Live P1–P5 checks (review screen + manual edits) ----------

/**
 * Compute every P1–P5 violation in a schedule. P6–P9 are the silent tier and
 * are never reported here — manual edits at those levels go through quietly.
 *
 * ctx: { stores, workers, locks, leaves, splitTimes }
 */
export function computeViolations(schedule, { stores, workers, locks = {}, leaves = {}, splitTimes = {} }) {
  const out = [];

  // P1a: coverage — every store, both halves, all week.
  for (const store of stores) {
    for (let d = 0; d < 7; d++) {
      for (const half of HALVES) {
        const covered = workers.some(
          (w) => schedule[w.id] && schedule[w.id][d] && schedule[w.id][d][half] === store.id
        );
        if (!covered) out.push({ priority: 1, type: 'coverage', storeId: store.id, dayIdx: d, half });
      }
    }
  }

  for (const w of workers) {
    const row = schedule[w.id];
    if (!row) continue;
    for (let d = 0; d < 7; d++) {
      const slot = row[d] || emptyDay();

      // P1b: double-booking by real clock-time overlap.
      const ivs = dayIntervals(slot, stores, d, splitTimes);
      if (ivs.length === 2 && windowsOverlap(ivs[0], ivs[1])) {
        out.push({
          priority: 1,
          type: 'overlap',
          workerId: w.id,
          dayIdx: d,
          storeA: ivs[0].storeId,
          storeB: ivs[1].storeId,
        });
      }

      // P2: split-only store staffed by one worker all day.
      if (slot.am != null && slot.am === slot.pm) {
        const st = stores.find((s) => s.id === slot.am);
        if (isSplitOnly(st)) {
          out.push({ priority: 2, type: 'shift_mode', workerId: w.id, storeId: slot.am, dayIdx: d });
        }
      }

      // P3: assigned during a requested leave. A whole-day leave means any
      // assignment violates; a range leave violates only when an assigned
      // interval genuinely overlaps the leave window (same real-time math as
      // double-booking).
      const lv = leaveAt(leaves, w.id, d);
      if (lv) {
        const working = slot.am != null || slot.pm != null;
        const clash = lv.full ? working : ivs.some((iv) => windowsOverlap(iv, lv));
        if (clash) out.push({ priority: 3, type: 'leave', workerId: w.id, dayIdx: d });
      }
    }

    // P4: locks. A whole-day lock is honoured when the worker holds at least
    // one half at that store; a time-range lock needs an assigned interval at
    // that store covering the whole locked window.
    for (let d = 0; d < 7; d++) {
      const lk = lockAt(locks, w.id, d);
      if (lk == null) continue;
      const s = row[d] || emptyDay();
      let honoured;
      if (lk.start != null) {
        honoured = dayIntervals(s, stores, d, splitTimes).some(
          (iv) => iv.storeId === lk.storeId && iv.start <= lk.start && iv.end >= lk.end
        );
      } else {
        honoured = s.am === lk.storeId || s.pm === lk.storeId;
      }
      if (!honoured) {
        out.push({ priority: 4, type: 'lock', workerId: w.id, storeId: lk.storeId, dayIdx: d });
      }
    }

    // P5: over the weekly day allowance.
    const load = weekWorkload(row);
    if (load > maxWorkdays(w)) {
      out.push({ priority: 5, type: 'allowance', workerId: w.id, load, max: maxWorkdays(w) });
    }
  }

  return out;
}

export function violationKey(v) {
  switch (v.type) {
    case 'coverage':
      return `c|${v.storeId}|${v.dayIdx}|${v.half}`;
    case 'overlap':
      return `o|${v.workerId}|${v.dayIdx}`;
    case 'shift_mode':
      return `m|${v.storeId}|${v.dayIdx}`;
    case 'leave':
      return `v|${v.workerId}|${v.dayIdx}`;
    case 'lock':
      return `l|${v.workerId}|${v.storeId}|${v.dayIdx}`;
    case 'lock_conflict':
      return `lc|${v.storeId}|${v.dayIdx}|${v.workerId}|${v.otherWorkerId}`;
    case 'allowance':
      return `a|${v.workerId}|${v.dayIdx != null ? v.dayIdx : 'wk'}`;
    default:
      return JSON.stringify(v);
  }
}

export function violationMessage(v, stores, workers) {
  const storeName = (id) => (stores.find((s) => s.id === id) || {}).name || `Store ${id}`;
  const workerName = (id) => (workers.find((w) => w.id === id) || {}).name || `Worker ${id}`;
  switch (v.type) {
    case 'coverage':
      return `P1 · Coverage: ${storeName(v.storeId)} has no one for the ${v.half === 'am' ? 'first' : 'second'} shift on ${DAY_NAMES[v.dayIdx]}.`;
    case 'overlap':
      return `P1 · Double-booking: ${workerName(v.workerId)}'s shifts at ${storeName(v.storeA)} and ${storeName(v.storeB)} overlap in real time on ${DAY_NAMES[v.dayIdx]}.`;
    case 'shift_mode':
      return `P2 · Shift Mode: ${storeName(v.storeId)} is Split-Shift-Only, but ${workerName(v.workerId)} is assigned the whole day on ${DAY_NAMES[v.dayIdx]}.`;
    case 'leave':
      return `P3 · Leave: ${workerName(v.workerId)} requested ${DAY_NAMES[v.dayIdx]} off but is scheduled to work.`;
    case 'lock':
      return `P4 · Lock: ${workerName(v.workerId)} was locked to ${storeName(v.storeId)} on ${DAY_NAMES[v.dayIdx]} but isn't scheduled there.`;
    case 'lock_conflict':
      return `P4 · Lock conflict: ${workerName(v.workerId)}'s and ${workerName(v.otherWorkerId)}'s time-range constraints at ${storeName(v.storeId)} on ${DAY_NAMES[v.dayIdx]} need different changeover points (${fmtMin(v.boundaryB)} vs ${fmtMin(v.boundaryA)}) — one of them can't be honoured as entered.`;
    case 'allowance':
      return `P5 · Day Allowance: ${workerName(v.workerId)} is over their weekly limit${v.load != null ? ` (${v.load} of ${v.max} days)` : ''}.`;
    default:
      return 'Unknown violation.';
  }
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

// ---------- Find Cover (post-publication change assistant) ----------

/**
 * Candidates to cover workerId's shift(s) at storeId on dayIdx.
 * Only workers linked to the store are considered (per spec). Each candidate:
 *   { worker, off: 'schedule'|'requested', level: 'green'|'yellow'|'red',
 *     badges: [text], hours }
 * green = breaks nothing; yellow = breaks only silent P6–P9 (badge names the
 * cost); red = would add a P1–P5 violation (still selectable — manual edits
 * are never blocked — but warn+confirm happens on apply).
 * Returns { halves, candidates }.
 */
export function findCoverCandidates({
  schedule,
  stores,
  workers,
  leaves = {},
  locks = {},
  splitTimes = {},
  lastWeekLoad = {},
  storeId,
  dayIdx,
  workerId,
}) {
  const row = schedule[workerId] || EMPTY_WEEK();
  const halves = HALVES.filter((h) => row[dayIdx] && row[dayIdx][h] === storeId);
  if (!halves.length) return { halves, candidates: [] };
  const store = stores.find((s) => s.id === storeId);
  const ctx = { stores, workers, locks, leaves, splitTimes };
  const baseKeys = new Set(computeViolations(schedule, ctx).map(violationKey));

  const candidates = [];
  for (const w of workers) {
    if (w.id === workerId) continue;
    if (!isLinked(w, storeId)) continue;

    // Requested-off = a whole-day leave, or a range leave overlapping the
    // window(s) that need covering.
    const lv = leaveAt(leaves, w.id, dayIdx);
    const requestedOff =
      !!lv &&
      (lv.full ||
        halves.some((h) => store && windowsOverlap(shiftWindow(store, dayIdx, h, splitTimes), lv)));
    // Free that day = every target half is takeable without a real-time clash.
    const wRow = schedule[w.id] || EMPTY_WEEK();
    const free = halves.every((h) => {
      if (wRow[dayIdx] && wRow[dayIdx][h] != null) return false;
      const other = h === 'am' ? 'pm' : 'am';
      const otherId = wRow[dayIdx] ? wRow[dayIdx][other] : null;
      if (otherId != null && store) {
        const otherStore = stores.find((s) => s.id === otherId);
        if (otherStore && windowsOverlap(shiftWindow(store, dayIdx, h, splitTimes), shiftWindow(otherStore, dayIdx, other, splitTimes))) {
          return false;
        }
      }
      return true;
    });
    if (!free) continue;

    const hours = workerHours(wRow, stores, splitTimes);
    if (requestedOff) {
      candidates.push({ worker: w, off: 'requested', level: 'red', badges: ['requested this day off'], hours });
      continue;
    }

    // Simulate the cover: candidate takes the halves, original worker's whole
    // day is cleared (they're going on leave).
    const sim = cloneSchedule(schedule);
    if (!sim[w.id]) sim[w.id] = EMPTY_WEEK();
    sim[workerId][dayIdx] = emptyDay();
    for (const h of halves) sim[w.id][dayIdx][h] = storeId;
    const simLeaves = { ...leaves, [workerId]: [...(leaves[workerId] || Array(7).fill(false))] };
    simLeaves[workerId][dayIdx] = true;
    const added = computeViolations(sim, { ...ctx, leaves: simLeaves }).filter((x) => !baseKeys.has(violationKey(x)));

    const badges = [];
    let level = 'green';
    if (added.length) {
      level = 'red';
      badges.push(...added.map((x) => violationMessage(x, stores, workers)));
    } else {
      // Silent-tier costs (P7/P8/P9-ish) get a yellow badge.
      const s = streakBefore(w.id, dayIdx, sim, lastWeekLoad);
      if (halves.length === 2 && s >= SOFT_MAX_CONSEC) {
        level = 'yellow';
        badges.push(`P7 · would be their ${s + 1}th straight day`);
      }
      if (halves.length === 1) {
        level = level === 'green' ? 'yellow' : level;
        badges.push('P8 · takes a split shift');
      }
    }
    candidates.push({ worker: w, off: 'schedule', level, badges, hours });
  }

  // Green first, then yellow, then red; fewer hours first inside a band.
  const bandRank = { green: 0, yellow: 1, red: 2 };
  candidates.sort((a, b) => bandRank[a.level] - bandRank[b.level] || a.hours - b.hours);
  return { halves, candidates };
}

/**
 * Chain swaps (§7.1, opt-in): multi-hop paths that free up a linked-but-busy
 * worker to cover the original slot. Returns up to `limit` chains, each:
 *   { moves: [{ workerId, dayIdx, set: {am?, pm?} } ...], steps: [text-parts] }
 * where steps describe each hop for the plain-English sentence.
 * A hop: off worker Y takes over X's assignment at store S2, freeing X to
 * cover the original slot (or to free someone else, up to maxDepth hops).
 */
export function findChainSwaps({
  schedule,
  stores,
  workers,
  leaves = {},
  locks = {},
  splitTimes = {},
  storeId,
  dayIdx,
  workerId,
  maxDepth = 2,
  limit = 5,
}) {
  const row = schedule[workerId] || EMPTY_WEEK();
  const halves = HALVES.filter((h) => row[dayIdx] && row[dayIdx][h] === storeId);
  if (!halves.length) return [];
  const byId = (id) => workers.find((w) => w.id === id);
  const storeName = (id) => (stores.find((s) => s.id === id) || {}).name || `Store ${id}`;
  const ctx = { stores, workers, locks, leaves, splitTimes };
  const baseKeys = new Set(computeViolations(schedule, ctx).map(violationKey));

  const results = [];

  // Try each linked-but-busy worker X as the coverer, freeing them via a chain.
  for (const X of workers) {
    if (results.length >= limit) break;
    if (X.id === workerId || !isLinked(X, storeId)) continue;
    if (leaveAt(leaves, X.id, dayIdx)) continue; // any leave blocks chain hops (conservative)
    const xSlot = (schedule[X.id] || EMPTY_WEEK())[dayIdx];
    if (!xSlot || (xSlot.am == null && xSlot.pm == null)) continue; // free → direct candidate, not a chain
    if (lockAt(locks, X.id, dayIdx) != null) continue; // don't unpick locks
    // X must currently be at a single store (simple hop); freeing means
    // someone off takes X's assignment there.
    const xStores = new Set([xSlot.am, xSlot.pm].filter((v) => v != null));
    if (xStores.size !== 1) continue;
    const s2 = [...xStores][0];
    if (s2 === storeId) continue;
    const xHalves = HALVES.filter((h) => xSlot[h] === s2);

    // Find Y: off that day, linked to s2, allowance/overlap-clean.
    for (const Y of workers) {
      if (results.length >= limit) break;
      if (Y.id === X.id || Y.id === workerId) continue;
      if (!isLinked(Y, s2)) continue;
      if (leaveAt(leaves, Y.id, dayIdx)) continue; // any leave blocks chain hops (conservative)
      const ySlot = (schedule[Y.id] || EMPTY_WEEK())[dayIdx];
      if (ySlot && (ySlot.am != null || ySlot.pm != null)) continue; // deeper chains: skip (kept shallow on purpose)

      // Simulate the whole chain in one shot.
      const sim = cloneSchedule(schedule);
      if (!sim[Y.id]) sim[Y.id] = EMPTY_WEEK();
      sim[workerId][dayIdx] = emptyDay();
      for (const h of xHalves) {
        sim[X.id][dayIdx][h] = null;
        sim[Y.id][dayIdx][h] = s2;
      }
      for (const h of halves) sim[X.id][dayIdx][h] = storeId;
      // X's remaining halves must not clash in real time.
      const xIvs = dayIntervals(sim[X.id][dayIdx], stores, dayIdx, splitTimes);
      if (xIvs.length === 2 && windowsOverlap(xIvs[0], xIvs[1])) continue;

      const simLeaves = { ...leaves, [workerId]: [...(leaves[workerId] || Array(7).fill(false))] };
      simLeaves[workerId][dayIdx] = true;
      const added = computeViolations(sim, { ...ctx, leaves: simLeaves }).filter((k) => !baseKeys.has(violationKey(k)));
      if (added.length) continue; // chains are only offered clean

      results.push({
        coverWorkerId: X.id,
        viaWorkerId: Y.id,
        viaStoreId: s2,
        schedule: sim,
        leaves: simLeaves,
        sentence: `Free ${X.name} from ${storeName(s2)} by sending ${Y.name} there, and ${X.name} will cover ${(byId(workerId) || {}).name || 'the shift'} at ${storeName(storeId)}.`,
      });
      break; // one Y per X is enough to offer the chain
    }
  }
  return results;
}

// ---------- Shift-time display ----------

export function fmtTime(hhmm) {
  if (hhmm == null || hhmm === '') return '';
  return fmtMin(typeof hhmm === 'number' ? hhmm : toMin(hhmm));
}

export function fmtMin(min) {
  const m = ((min % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  const ap = h >= 12 ? 'PM' : 'AM';
  const h12 = ((h + 11) % 12) + 1;
  return mm ? `${h12}:${String(mm).padStart(2, '0')} ${ap}` : `${h12} ${ap}`;
}

/** Compact clock time for dense cells: "8am", "3:30pm". */
export function fmtMinCompact(min) {
  const m = ((min % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  const ap = h >= 12 ? 'pm' : 'am';
  const h12 = ((h + 11) % 12) + 1;
  return mm ? `${h12}:${String(mm).padStart(2, '0')}${ap}` : `${h12}${ap}`;
}

/** Compact "8am–3pm" range for a half (or 'full') at a store on a day. */
export function shiftTimeCompact(store, dayIdx, half, splitTimes = {}) {
  if (!store) return '';
  const w = shiftWindow(store, dayIdx, half, splitTimes);
  return `${fmtMinCompact(w.start)}–${fmtMinCompact(w.end)}`;
}

/** Compact "2pm–10pm" from a normalized {start,end} minutes range. */
export function rangeCompact(range) {
  if (!range || range.start == null) return '';
  return `${fmtMinCompact(range.start)}–${fmtMinCompact(range.end)}`;
}

/** "8 AM–3 PM" style label for a half at a store on a day. */
export function shiftTimeLabel(store, dayIdx, half, splitTimes = {}) {
  if (!store) return half === 'am' ? 'First shift' : 'Second shift';
  const w = shiftWindow(store, dayIdx, half, splitTimes);
  return `${fmtMin(w.start)}–${fmtMin(w.end)}`;
}

export function halfLabel(half, store, dayIdx, splitTimes = {}) {
  const name = half === 'am' ? 'First shift' : 'Second shift';
  return store ? `${name} · ${shiftTimeLabel(store, dayIdx, half, splitTimes)}` : name;
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
export function isMonday(iso) {
  return fromISODate(iso).getDay() === 1;
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
