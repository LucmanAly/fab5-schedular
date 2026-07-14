import {
  generateSchedule,
  cloneSchedule,
  computeGaps,
  computeViolations,
  streakBefore,
  daysWorked,
  weekWorkload,
  workerAtHalf,
  worksOn,
  worksFull,
  weekLoadFromSchedule,
  offDayHistory,
  storeWindow,
  defaultSplitMin,
  shiftWindow,
  windowsOverlap,
  dayIntervals,
  workerHours,
  findCoverCandidates,
  findChainSwaps,
  EMPTY_WEEK,
  HARD_MAX_CONSEC,
} from '../src/lib/scheduler.js';

let failed = 0;
function check(name, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond) failed++;
}

// numStores stores; one Main per store (linked home-first, then every other
// store); numFloats floats linked to every store in order.
function setup(numStores, numFloats) {
  const stores = Array.from({ length: numStores }, (_, i) => ({ id: i + 1, name: `Store ${i + 1}` }));
  const all = stores.map((s) => s.id);
  const workers = [
    ...stores.map((s) => ({
      id: 100 + s.id,
      name: `Main ${s.id}`,
      store_ids: [s.id, ...all.filter((id) => id !== s.id)],
      main_store_id: s.id,
    })),
    ...Array.from({ length: numFloats }, (_, i) => ({
      id: 200 + i + 1,
      name: `Float ${i + 1}`,
      store_ids: all,
      main_store_id: null,
    })),
  ];
  return { stores, workers };
}

// 1. Full coverage when staffing is adequate (P1).
{
  const { stores, workers } = setup(3, 3);
  const { schedule, violations } = generateSchedule({ stores, workers });
  const gaps = computeGaps(schedule, stores, workers);
  check('P1: all stores covered all week with adequate staff', gaps.length === 0 && violations.length === 0);
}

// 2. Locks honoured (P4), even at the cost of other preferences.
{
  const { stores, workers } = setup(2, 2);
  const locks = { 201: [2, 2, 2, 2, 2, 2, 2] }; // Float 1 locked to store 2 every day
  const { schedule } = generateSchedule({ stores, workers, locks });
  let ok = true;
  for (let d = 0; d < 7; d++) {
    if (schedule[201][d].am !== 2 && schedule[201][d].pm !== 2) ok = false;
  }
  check('P4: locked worker gets the locked store every day', ok);
}

// 3. Linked stores respected when possible (P6).
{
  const stores = [
    { id: 1, name: 'A' },
    { id: 2, name: 'B' },
  ];
  const workers = [
    { id: 1, name: 'W1', store_ids: [1], main_store_id: 1 },
    { id: 2, name: 'W2', store_ids: [2], main_store_id: 2 },
    { id: 3, name: 'F1', store_ids: [1], main_store_id: null },
    { id: 4, name: 'F2', store_ids: [2], main_store_id: null },
  ];
  const { schedule } = generateSchedule({ stores, workers });
  let ok = true;
  for (const w of workers) {
    for (let d = 0; d < 7; d++) {
      for (const half of ['am', 'pm']) {
        const at = schedule[w.id][d][half];
        if (at != null && !w.store_ids.includes(at)) ok = false;
      }
    }
  }
  check('P6: workers only assigned to linked stores when links suffice', ok);
}

// 4. Hard consecutive ceiling: never more than 4 full days in a row (P7).
{
  const { stores, workers } = setup(4, 1); // tight staffing forces long runs
  const { schedule } = generateSchedule({ stores, workers });
  let ok = true;
  for (const w of workers) {
    let streak = 0;
    for (let d = 0; d < 7; d++) {
      streak = worksFull(schedule[w.id], d) ? streak + 1 : 0;
      if (streak > HARD_MAX_CONSEC) ok = false;
    }
  }
  check('P7: no worker exceeds 4 consecutive full days', ok);
}

// 5. Week-boundary streaks: full days last week carry into Monday.
{
  const { stores, workers } = setup(2, 2);
  const lastSchedule = { 101: EMPTY_WEEK() };
  for (const d of [4, 5, 6]) lastSchedule[101][d] = { am: 1, pm: 1 };
  const load = weekLoadFromSchedule(lastSchedule);
  check('streak counts across the week boundary', streakBefore(101, 0, { 101: EMPTY_WEEK() }, load) === 3);
  const { schedule } = generateSchedule({ stores, workers, lastWeekLoad: load });
  check('worker owed rest is not defaulted in on Monday', !worksFull(schedule[101], 0) || daysWorked(schedule[101]) < 7);
}

// 6. Leave respected (P3) — never scheduled on a leave day.
{
  const { stores, workers } = setup(2, 2);
  const leaves = { 101: [false, false, true, true, false, false, false] };
  const { schedule } = generateSchedule({ stores, workers, leaves });
  check('P3: leave days never scheduled', !worksOn(schedule[101], 2) && !worksOn(schedule[101], 3));
}

// 7. No double-booking: a worker's half is one store; a store's half is one worker.
{
  const { stores, workers } = setup(4, 3);
  const { schedule } = generateSchedule({ stores, workers });
  let ok = true;
  for (let d = 0; d < 7; d++) {
    for (const half of ['am', 'pm']) {
      const seen = new Set();
      for (const w of workers) {
        const at = schedule[w.id][d][half];
        if (at != null) {
          if (seen.has(at)) ok = false;
          seen.add(at);
        }
      }
    }
  }
  check('P1: no store double-staffed in a half', ok);
}

// 8. Impossible coverage surfaces as P1 violations, not silence.
{
  const { stores, workers } = setup(2, 0); // 2 mains only
  const leaves = { 101: [true, true, true, true, true, true, true] };
  const { violations } = generateSchedule({ stores, workers, leaves });
  const p1 = violations.filter((v) => v.priority === 1);
  check('impossible coverage reported as P1 violations', p1.length > 0);
}

// 9. Mains default to their home store.
{
  const { stores, workers } = setup(3, 3);
  const { schedule } = generateSchedule({ stores, workers });
  let homeDays = 0;
  let awayDays = 0;
  for (let d = 0; d < 7; d++) {
    const s = schedule[101][d];
    if (s.am === 1 && s.pm === 1) homeDays++;
    else if (s.am != null || s.pm != null) awayDays++;
  }
  check(`main works home store when working (${homeDays} home, ${awayDays} away)`, awayDays === 0 && homeDays > 0);
}

// 10. computeViolations flags a broken lock (P4) after a manual edit.
{
  const { stores, workers } = setup(2, 2);
  const locks = { 201: [null, 1, null, null, null, null, null] };
  const { schedule } = generateSchedule({ stores, workers, locks });
  const before = computeViolations(schedule, { stores, workers, locks });
  check('generated schedule honours the lock', before.filter((v) => v.priority === 4).length === 0);
  schedule[201][1] = { am: null, pm: null }; // manual edit removes the locked day
  const after = computeViolations(schedule, { stores, workers, locks });
  check('manual edit breaking a lock is flagged as P4', after.some((v) => v.priority === 4 && v.workerId === 201));
}

// 11. Split coverage: two workers each covering a half leaves no gap.
{
  const { stores, workers } = setup(2, 2);
  const sched = {};
  workers.forEach((w) => (sched[w.id] = EMPTY_WEEK()));
  sched[201][0] = { am: 1, pm: null };
  sched[202][0] = { am: null, pm: 1 };
  const day0Gaps = computeGaps(sched, [stores[0]], workers).filter((g) => g.dayIdx === 0);
  check('split AM/PM by two workers leaves no gap', day0Gaps.length === 0);
}

// 12. Float link priority: first-linked store preferred (§5 tie-breaker).
{
  const stores = [
    { id: 1, name: 'A' },
    { id: 2, name: 'B' },
  ];
  // Two floats, no mains. F1 prefers A, F2 prefers B.
  const workers = [
    { id: 1, name: 'F1', store_ids: [1, 2], main_store_id: null },
    { id: 2, name: 'F2', store_ids: [2, 1], main_store_id: null },
  ];
  const { schedule } = generateSchedule({ stores, workers });
  let f1AtA = 0;
  let f1AtB = 0;
  for (let d = 0; d < 7; d++) {
    if (schedule[1][d].am === 1) f1AtA++;
    if (schedule[1][d].am === 2) f1AtB++;
  }
  check(`float favours first-linked store (${f1AtA} vs ${f1AtB})`, f1AtA >= f1AtB);
}

// ---------- v4: store hours, split points, real overlap ----------

// 13. Store windows and derived split points.
{
  const a = { id: 1, name: 'A' }; // defaults: weekday 8–22, weekend 9–22
  const wd = storeWindow(a, 0);
  const we = storeWindow(a, 5);
  check('weekday default window is 8am–10pm', wd.open === 480 && wd.close === 1320);
  check('weekend default window is 9am–10pm', we.open === 540 && we.close === 1320);
  check('weekday default split is 3pm (midpoint)', defaultSplitMin(a, 0) === 900);

  const c = { id: 3, name: 'C', weekday_open: '12:00', weekday_close: '02:00' }; // past midnight
  const cw = storeWindow(c, 0);
  check('past-midnight close extends beyond 24h', cw.open === 720 && cw.close === 1560);
  check('past-midnight split is 7pm (midpoint)', defaultSplitMin(c, 0) === 1140);
}

// 14. P1 double-booking is real clock-time overlap, not AM/PM labels (§2 example).
{
  const A = { id: 1, name: 'A' }; // 8–22, split 15:00
  const C = { id: 3, name: 'C', weekday_open: '12:00', weekday_close: '02:00' }; // 12–26, split 19:00
  const stores = [A, C];
  const w = { id: 1, name: 'W', store_ids: [1, 3], main_store_id: null };

  // C's first half (12–7pm) overlaps A's second half (3–10pm) → not allowed.
  const bad = { 1: EMPTY_WEEK() };
  bad[1][0] = { am: 3, pm: 1 };
  const badV = computeViolations(bad, { stores, workers: [w] });
  check('C-am + A-pm flagged as real overlap', badV.some((v) => v.type === 'overlap'));

  // A's first half (8–3pm) + C's second half (7pm–2am) → no overlap → allowed.
  const good = { 1: EMPTY_WEEK() };
  good[1][0] = { am: 1, pm: 3 };
  const goodV = computeViolations(good, { stores, workers: [w] });
  check('A-am + C-pm (no travel buffer) is allowed', !goodV.some((v) => v.type === 'overlap'));

  // Sanity on the raw windows too.
  check(
    'shiftWindow overlap math matches the spec example',
    windowsOverlap(shiftWindow(C, 0, 'am'), shiftWindow(A, 0, 'pm')) &&
      !windowsOverlap(shiftWindow(A, 0, 'am'), shiftWindow(C, 0, 'pm'))
  );
}

// 15. Generator never books an overlapping pair even across different windows.
{
  const stores = [
    { id: 1, name: 'A' },
    { id: 2, name: 'C', weekday_open: '12:00', weekday_close: '02:00', weekend_open: '12:00', weekend_close: '02:00' },
  ];
  const workers = [
    { id: 1, name: 'W1', store_ids: [1, 2], main_store_id: null },
    { id: 2, name: 'W2', store_ids: [1, 2], main_store_id: null },
    { id: 3, name: 'W3', store_ids: [1, 2], main_store_id: null },
  ];
  const { schedule } = generateSchedule({ stores, workers });
  let ok = true;
  for (const w of workers) {
    for (let d = 0; d < 7; d++) {
      const ivs = dayIntervals(schedule[w.id][d], stores, d);
      if (ivs.length === 2 && windowsOverlap(ivs[0], ivs[1])) ok = false;
    }
  }
  check('generated schedule has no real-time overlaps', ok);
}

// 16. P2: split-only stores are always split.
{
  const stores = [{ id: 1, name: 'S', shift_mode: 'split_only' }];
  const workers = [
    { id: 1, name: 'A', store_ids: [1], main_store_id: 1 },
    { id: 2, name: 'B', store_ids: [1], main_store_id: null },
    { id: 3, name: 'C', store_ids: [1], main_store_id: null },
  ];
  const { schedule, violations } = generateSchedule({ stores, workers });
  const gaps = computeGaps(schedule, stores, workers);
  let alwaysSplit = true;
  for (let d = 0; d < 7; d++) {
    const am = workerAtHalf(schedule, workers, 1, d, 'am');
    const pm = workerAtHalf(schedule, workers, 1, d, 'pm');
    if (!am || !pm || am.id === pm.id) alwaysSplit = false;
  }
  check('P2: split-only store split every day, fully covered', alwaysSplit && gaps.length === 0 && violations.length === 0);

  // A manual full-day assignment on a split-only store is flagged as P2.
  const manual = { 1: EMPTY_WEEK(), 2: EMPTY_WEEK(), 3: EMPTY_WEEK() };
  manual[1][0] = { am: 1, pm: 1 };
  const v = computeViolations(manual, { stores, workers });
  check('P2: manual full day on split-only store is flagged', v.some((x) => x.priority === 2 && x.type === 'shift_mode'));
}

// 17. P5: day allowance respected when staffing allows; full = 1, split = 0.5.
{
  const stores = [{ id: 1, name: 'S' }];
  const workers = [
    { id: 1, name: 'A', store_ids: [1], main_store_id: null, max_workdays: 3 },
    { id: 2, name: 'B', store_ids: [1], main_store_id: null, max_workdays: 3 },
    { id: 3, name: 'C', store_ids: [1], main_store_id: null, max_workdays: 3 },
  ];
  const { schedule, violations } = generateSchedule({ stores, workers });
  const withinAllowance = workers.every((w) => weekWorkload(schedule[w.id]) <= 3);
  check('P5: nobody exceeds their allowance when capacity suffices', withinAllowance && violations.length === 0);

  const row = EMPTY_WEEK();
  row[0] = { am: 1, pm: 1 };
  row[1] = { am: 1, pm: null };
  check('workload counts full = 1, half = 0.5', weekWorkload(row) === 1.5);
}

// 18. P5 broken (and reported) only when coverage demands it.
{
  const stores = [{ id: 1, name: 'S' }];
  const workers = [
    { id: 1, name: 'A', store_ids: [1], main_store_id: null, max_workdays: 2 },
    { id: 2, name: 'B', store_ids: [1], main_store_id: null, max_workdays: 2 },
  ];
  const { schedule, violations } = generateSchedule({ stores, workers });
  const gaps = computeGaps(schedule, stores, workers);
  check(
    'P5 break preferred over a coverage gap, and reported',
    gaps.length === 0 && violations.some((v) => v.priority === 5)
  );
  const flagged = computeViolations(schedule, { stores, workers });
  check('computeViolations also flags the allowance overrun', flagged.some((v) => v.priority === 5));
}

// 18b. P5 rebalance: front-loaded greedy overruns get repaired when spare
// capacity exists elsewhere in the week (no violation reported).
{
  const stores = [{ id: 1, name: 'S' }];
  const workers = [
    { id: 1, name: 'M', store_ids: [1], main_store_id: 1, max_workdays: 5 },
    { id: 2, name: 'F', store_ids: [1], main_store_id: null, max_workdays: 5 },
  ];
  const { schedule, violations } = generateSchedule({ stores, workers });
  const gaps = computeGaps(schedule, stores, workers);
  check(
    'P5 rebalance: overruns repaired via spare capacity, nothing reported',
    gaps.length === 0 &&
      violations.length === 0 &&
      workers.every((w) => weekWorkload(schedule[w.id]) <= 5)
  );
}

// 19. P9: unique off-days — with 2 weeks of history, rotate who's off.
{
  const stores = [{ id: 1, name: 'S' }];
  const workers = [
    { id: 1, name: 'F1', store_ids: [1], main_store_id: null },
    { id: 2, name: 'F2', store_ids: [1], main_store_id: null },
  ];
  // Two saved weeks where F1 was off Monday and F2 worked it.
  const past = { 1: EMPTY_WEEK(), 2: EMPTY_WEEK() };
  for (let d = 1; d < 7; d++) past[1][d] = { am: 1, pm: 1 };
  past[2][0] = { am: 1, pm: 1 };
  const hist = offDayHistory([past, past], workers);
  check('offDayHistory counts off-days per weekday', hist[1][0] === 2 && hist[2][0] === 0);

  const { schedule } = generateSchedule({ stores, workers, history: [past, past] });
  check('P9: repeatedly-off worker gets Monday this time', worksOn(schedule[1], 0));

  // Fewer than 2 weeks of history → silently skipped, no error.
  const one = generateSchedule({ stores, workers, history: [past] });
  check('P9 no-ops with under 2 weeks of history', computeGaps(one.schedule, stores, workers).length === 0);
}

// 20. Worker hours from real windows.
{
  const stores = [{ id: 1, name: 'S' }];
  const row = EMPTY_WEEK();
  row[0] = { am: 1, pm: 1 }; // Monday full: 8–22 = 14h
  row[5] = { am: 1, pm: null }; // Saturday first shift: 9:00–15:30 = 6.5h
  check('workerHours uses store windows and split points', workerHours(row, stores) === 20.5);
}

// 21. Find Cover: linked free worker is green; requested-off is greyed out.
{
  const stores = [{ id: 1, name: 'S' }];
  const workers = [
    { id: 1, name: 'A', store_ids: [1], main_store_id: null },
    { id: 2, name: 'B', store_ids: [1], main_store_id: null },
    { id: 3, name: 'C', store_ids: [1], main_store_id: null },
  ];
  const schedule = { 1: EMPTY_WEEK(), 2: EMPTY_WEEK(), 3: EMPTY_WEEK() };
  schedule[1][0] = { am: 1, pm: 1 };
  const leaves = { 3: [true, false, false, false, false, false, false] };
  const { candidates } = findCoverCandidates({ schedule, stores, workers, leaves, storeId: 1, dayIdx: 0, workerId: 1 });
  const b = candidates.find((c) => c.worker.id === 2);
  const c = candidates.find((c) => c.worker.id === 3);
  check('free linked worker offered as green', !!b && b.level === 'green' && b.off === 'schedule');
  check('requested-off worker greyed out', !!c && c.off === 'requested');
}

// 22. Chain swap: free a busy linked worker by backfilling their store.
{
  const stores = [
    { id: 1, name: 'Ridge' },
    { id: 2, name: '2nd St' },
  ];
  const workers = [
    { id: 1, name: 'Sameer', store_ids: [1], main_store_id: null },
    { id: 2, name: 'Abdul', store_ids: [1, 2], main_store_id: null },
    { id: 3, name: 'Luqman', store_ids: [2], main_store_id: null },
  ];
  const schedule = { 1: EMPTY_WEEK(), 2: EMPTY_WEEK(), 3: EMPTY_WEEK() };
  schedule[1][0] = { am: 1, pm: 1 }; // Sameer holds Ridge
  schedule[2][0] = { am: 2, pm: 2 }; // Abdul busy at 2nd St
  // Direct candidates: nobody linked to Ridge is free.
  const direct = findCoverCandidates({ schedule, stores, workers, storeId: 1, dayIdx: 0, workerId: 1 });
  check('no direct candidates when everyone linked is busy', direct.candidates.length === 0);
  // Chain: Luqman → 2nd St frees Abdul → Ridge.
  const chains = findChainSwaps({ schedule, stores, workers, storeId: 1, dayIdx: 0, workerId: 1 });
  const ch = chains[0];
  check('chain swap found (Luqman frees Abdul)', chains.length === 1 && ch.coverWorkerId === 2 && ch.viaWorkerId === 3);
  check(
    'chain sentence reads plainly',
    !!ch && ch.sentence === 'Free Abdul from 2nd St by sending Luqman there, and Abdul will cover Sameer at Ridge.'
  );
  check(
    'chain result keeps both stores covered',
    !!ch && computeGaps(ch.schedule, stores, workers).filter((g) => g.dayIdx === 0).length === 0
  );
}

// ---------- v4.1: time-range leaves and locks ----------

// 23. A time-range lock carves out a split at its boundary and leaves the
// remainder open for normal P1 fill — it does not claim the whole day.
{
  const stores = [{ id: 1, name: 'S' }]; // weekday 8am–10pm
  const workers = [
    { id: 1, name: 'A', store_ids: [1], main_store_id: null },
    { id: 2, name: 'B', store_ids: [1], main_store_id: null },
  ];
  const locks = { 1: [{ storeId: 1, start: '14:00', end: '22:00' }, null, null, null, null, null, null] };
  const { schedule, violations, splitTimes } = generateSchedule({ stores, workers, locks });
  check('range lock seeds the store changeover to its boundary', splitTimes['1-0'] === '14:00');
  check('locked worker gets exactly their window (2nd shift)', schedule[1][0].pm === 1 && schedule[1][0].am !== 1);
  check('remainder stays open and is filled by someone else', schedule[2][0].am === 1);
  check('clean range lock generates no violations', violations.length === 0);
  const flagged = computeViolations(schedule, { stores, workers, locks, splitTimes });
  check('range lock honoured per computeViolations', !flagged.some((v) => v.type === 'lock'));
  // A manual edit that takes the locked window away is flagged as P4.
  const broken = cloneSchedule(schedule);
  broken[1][0] = { am: null, pm: null };
  broken[2][0] = { am: 1, pm: 1 };
  const after = computeViolations(broken, { stores, workers, locks, splitTimes });
  check('breaking a range lock manually is flagged as P4', after.some((v) => v.type === 'lock' && v.workerId === 1));
}

// 24. A time-range leave restricts an otherwise-full-day worker (the store's
// Main) to their available portion; the rest of the day is covered by others.
{
  const stores = [{ id: 1, name: 'S' }];
  const workers = [
    { id: 1, name: 'M', store_ids: [1], main_store_id: 1 },
    { id: 2, name: 'F', store_ids: [1], main_store_id: null },
  ];
  // M unavailable 2pm–close; F unavailable open–2pm (complementary windows).
  const leaves = {
    1: [{ start: '14:00', end: '22:00' }, false, false, false, false, false, false],
    2: [{ start: '08:00', end: '14:00' }, false, false, false, false, false, false],
  };
  const { schedule, violations, splitTimes } = generateSchedule({ stores, workers, leaves });
  check('range leave on the Main seeds their store changeover', splitTimes['1-0'] === '14:00');
  check('main works only outside their leave window', schedule[1][0].am === 1 && schedule[1][0].pm == null);
  check('rest of the day covered by the other worker', schedule[2][0].pm === 1 && schedule[2][0].am == null);
  check('partial-leave day still fully covered, no violations', violations.length === 0);
  const flagged = computeViolations(schedule, { stores, workers, leaves, splitTimes });
  check('no P3 flagged when work stays outside leave windows', !flagged.some((v) => v.type === 'leave'));
  // Manually assigning M into their leave window IS flagged as P3.
  const bad = cloneSchedule(schedule);
  bad[1][0] = { am: 1, pm: 1 };
  bad[2][0] = { am: null, pm: null };
  const after = computeViolations(bad, { stores, workers, leaves, splitTimes });
  check('working into a leave window is flagged as P3', after.some((v) => v.type === 'leave' && v.workerId === 1));
}

// 25. Range constraints that need different changeover points on the same
// store+day surface as a P4 conflict violation, not a silent winner.
{
  const stores = [{ id: 1, name: 'S' }];
  const workers = [
    { id: 1, name: 'A', store_ids: [1], main_store_id: null },
    { id: 2, name: 'B', store_ids: [1], main_store_id: null },
    { id: 3, name: 'C', store_ids: [1], main_store_id: null },
  ];
  const conflicting = {
    1: [{ storeId: 1, start: '08:00', end: '15:00' }, null, null, null, null, null, null],
    2: [{ storeId: 1, start: '14:00', end: '22:00' }, null, null, null, null, null, null],
  };
  const { violations } = generateSchedule({ stores, workers, locks: conflicting });
  check(
    'overlapping range locks surface as a P4 lock conflict',
    violations.some((v) => v.priority === 4 && v.type === 'lock_conflict')
  );

  // Complementary ranges (8–3 and 3–10) are NOT a conflict — both honoured.
  const compatible = {
    1: [{ storeId: 1, start: '08:00', end: '15:00' }, null, null, null, null, null, null],
    2: [{ storeId: 1, start: '15:00', end: '22:00' }, null, null, null, null, null, null],
  };
  const ok = generateSchedule({ stores, workers, locks: compatible });
  check(
    'complementary range locks coexist cleanly',
    ok.violations.length === 0 && ok.schedule[1][0].am === 1 && ok.schedule[2][0].pm === 1
  );
}

console.log(failed ? `\n${failed} test(s) failed` : '\nAll tests passed');
process.exit(failed ? 1 : 0);
