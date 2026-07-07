import {
  generateSchedule,
  computeGaps,
  consecutiveBefore,
  daysWorked,
  workerAtHalf,
  worksOn,
  EMPTY_WEEK,
} from '../src/lib/scheduler.js';

let failed = 0;
function check(name, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond) failed++;
}

function setup(numStores, numFloats) {
  const stores = Array.from({ length: numStores }, (_, i) => ({ id: i + 1, name: `Store ${i + 1}` }));
  const workers = [
    ...stores.map((s) => ({ id: 100 + s.id, name: `Main ${s.id}`, type: 'main', store_id: s.id })),
    ...Array.from({ length: numFloats }, (_, i) => ({ id: 200 + i + 1, name: `Float ${i + 1}`, type: 'float', store_id: null })),
  ];
  return { stores, workers };
}

// 1. Consecutive-day limit respected within the generated week.
{
  const { stores, workers } = setup(3, 3);
  const sched = generateSchedule({ stores, workers, leaves: {}, lastWeekWorked: {}, maxConsec: 3 });
  let ok = true;
  for (const w of workers) {
    let streak = 0;
    for (let d = 0; d < 7; d++) {
      streak = worksOn(sched[w.id], d) ? streak + 1 : 0;
      if (streak > 3) ok = false;
    }
  }
  check('consecutive-day limit respected', ok);
}

// 2. Week-boundary streak: worked Fri–Sun last week, max 3 -> rest Monday.
{
  const { stores, workers } = setup(2, 2);
  const main1 = workers.find((w) => w.id === 101);
  const lastWeekWorked = { [main1.id]: [false, false, false, false, true, true, true] };
  check('streak counts across week boundary', consecutiveBefore(main1.id, 0, { [main1.id]: [] }, lastWeekWorked) === 3);
  const sched = generateSchedule({ stores, workers, leaves: {}, lastWeekWorked, maxConsec: 3 });
  check('worker owed rest not scheduled Monday', !worksOn(sched[main1.id], 0));
}

// 3. Leave respected (both halves empty).
{
  const { stores, workers } = setup(2, 2);
  const leaves = { 101: [false, false, true, true, false, false, false] };
  const sched = generateSchedule({ stores, workers, leaves, lastWeekWorked: {}, maxConsec: 4 });
  check('leave days never scheduled', !worksOn(sched[101], 2) && !worksOn(sched[101], 3));
}

// 4. No double-staffing: at most one worker per store per half per day.
{
  const { stores, workers } = setup(4, 3);
  const sched = generateSchedule({ stores, workers, leaves: {}, lastWeekWorked: {}, maxConsec: 3 });
  let ok = true;
  for (let d = 0; d < 7; d++) {
    for (const half of ['am', 'pm']) {
      const seen = new Set();
      for (const w of workers) {
        const at = sched[w.id][d][half];
        if (at != null) {
          if (seen.has(at)) ok = false;
          seen.add(at);
        }
      }
    }
  }
  check('no store double-staffed in a half', ok);
}

// 5. Understaffing surfaces as per-half gaps.
{
  const { stores, workers } = setup(5, 0);
  const leaves = { 101: [true, true, true, true, true, true, true] };
  const sched = generateSchedule({ stores, workers, leaves, lastWeekWorked: {}, maxConsec: 4 });
  const gaps = computeGaps(sched, stores, workers);
  const store1 = gaps.filter((g) => g.storeId === 1).length;
  check('uncovered store shows AM+PM gaps all week', store1 === 14);
}

// 6. Float fairness within 1 day.
{
  const { stores, workers } = setup(4, 3);
  const sched = generateSchedule({ stores, workers, leaves: {}, lastWeekWorked: {}, maxConsec: 2 });
  const counts = workers.filter((w) => w.type === 'float').map((f) => daysWorked(sched[f.id]));
  const spread = Math.max(...counts) - Math.min(...counts);
  check(`float workload balanced (${counts.join(', ')})`, spread <= 1);
}

// 7. Gaps are live: clearing a half creates exactly one new gap.
{
  const { stores, workers } = setup(2, 2);
  const sched = generateSchedule({ stores, workers, leaves: {}, lastWeekWorked: {}, maxConsec: 4 });
  const before = computeGaps(sched, stores, workers).length;
  const w = workerAtHalf(sched, workers, 1, 0, 'am');
  sched[w.id][0].am = null;
  const after = computeGaps(sched, stores, workers).length;
  check('gap detection reflects a cleared half instantly', after === before + 1);
}

// 8. Split coverage: two workers each cover a half -> store fully covered that day.
{
  const { stores, workers } = setup(2, 2);
  const sched = {};
  workers.forEach((w) => (sched[w.id] = EMPTY_WEEK()));
  sched[201][0] = { am: 1, pm: null }; // Float 1 covers store 1 morning
  sched[202][0] = { am: null, pm: 1 }; // Float 2 covers store 1 evening
  const day0Gaps = computeGaps(sched, [stores[0]], workers).filter((g) => g.dayIdx === 0);
  check('split AM/PM by two workers leaves no gap', day0Gaps.length === 0);
}

console.log(failed ? `\n${failed} test(s) failed` : '\nAll tests passed');
process.exit(failed ? 1 : 0);
