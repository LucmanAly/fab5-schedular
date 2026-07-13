// Thin Supabase client over PostgREST — no SDK dependency.
// Keys come from Vite env vars (set as Netlify environment variables in production).

const URL = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const enabled = Boolean(URL && KEY);

// Only the three most recent saved weeks are kept (current + two weeks of
// history); saving a new week automatically evicts the oldest.
export const WEEKS_KEPT = 3;

// Legacy anon keys are JWTs (start with "eyJ") and go in the Authorization header.
// New publishable keys (sb_publishable_...) authenticate via the apikey header only.
const isJwt = typeof KEY === 'string' && KEY.startsWith('eyJ');

let lastError = null;
export function getLastError() {
  return lastError;
}
export function diagnostics() {
  return {
    hasUrl: Boolean(URL),
    url: URL || '(none)',
    hasKey: Boolean(KEY),
    keyType: !KEY ? 'none' : isJwt ? 'legacy anon (JWT)' : 'publishable / other',
  };
}

async function sb(path, { method = 'GET', body, prefer } = {}) {
  const headers = { apikey: KEY, 'Content-Type': 'application/json', Prefer: prefer || 'return=representation' };
  if (isJwt) headers.Authorization = `Bearer ${KEY}`;

  let res;
  try {
    res = await fetch(`${URL}/rest/v1/${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    lastError = `Network error reaching Supabase (${e.message}). Check that the Project URL is correct.`;
    throw new Error(lastError);
  }
  if (!res.ok) {
    const t = await res.text();
    lastError = `HTTP ${res.status} — ${t.slice(0, 260)}`;
    throw new Error(lastError);
  }
  lastError = null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export async function testConnection() {
  if (!enabled) return { ok: false, message: 'No Supabase URL/key found in this build. Add them in Netlify and redeploy.' };
  try {
    await sb('stores?select=id&limit=1');
    return { ok: true, message: 'Connected — tables are reachable.' };
  } catch (e) {
    return { ok: false, message: lastError || e.message };
  }
}

// ---------- Setup (stores + workers) ----------

export async function loadSetup() {
  const [stores, workers] = await Promise.all([sb('stores?order=id'), sb('workers?order=id')]);
  return {
    stores: (stores || []).map((s) => ({
      ...s,
      shift_mode: s.shift_mode || 'default',
      weekday_open: s.weekday_open || '08:00',
      weekday_close: s.weekday_close || '22:00',
      weekend_open: s.weekend_open || '09:00',
      weekend_close: s.weekend_close || '22:00',
    })),
    workers: (workers || []).map((w) => ({
      ...w,
      store_ids: w.store_ids || [],
      main_store_id: w.main_store_id ?? null,
      max_workdays: w.max_workdays != null ? Number(w.max_workdays) : 5,
      recurring_leaves: w.recurring_leaves || [false, false, false, false, false, false, false],
      recurring_locks: w.recurring_locks || [null, null, null, null, null, null, null],
      public_token: w.public_token || null,
    })),
  };
}

export async function saveSetup(stores, workers) {
  await sb('workers?id=gte.0', { method: 'DELETE', prefer: 'return=minimal' });
  await sb('stores?id=gte.0', { method: 'DELETE', prefer: 'return=minimal' });
  if (stores.length) {
    await sb('stores', {
      method: 'POST',
      prefer: 'return=minimal',
      body: stores.map((s) => ({
        id: s.id,
        name: s.name,
        shift_mode: s.shift_mode || 'default',
        weekday_open: s.weekday_open || '08:00',
        weekday_close: s.weekday_close || '22:00',
        weekend_open: s.weekend_open || '09:00',
        weekend_close: s.weekend_close || '22:00',
      })),
    });
  }
  if (workers.length) {
    await sb('workers', {
      method: 'POST',
      prefer: 'return=minimal',
      body: workers.map((w) => ({
        id: w.id,
        name: w.name,
        store_ids: w.store_ids || [],
        main_store_id: w.main_store_id ?? null,
        max_workdays: w.max_workdays != null ? w.max_workdays : 5,
        recurring_leaves: w.recurring_leaves || [false, false, false, false, false, false, false],
        recurring_locks: w.recurring_locks || [null, null, null, null, null, null, null],
        public_token: w.public_token || null,
      })),
    });
  }
}

// ---------- Weeks (the three-week archive) ----------

export async function listWeeks() {
  return (await sb('weeks?select=week_start,status,saved_at&order=week_start.desc')) || [];
}

// Intra-week version stack (v0..v4): stored as jsonb on the week row. One
// entry per explicit Save — edits (manual, split, Find Cover) accumulate as
// unsaved changes and batch into a single new version when saved. Only the
// current week keeps a stack — saving clears every other week's stack, so a
// week rolling into history carries only its final saved version.
export const MAX_VERSIONS = 5;

export async function saveWeek(weekStart, { leaves = {}, locks = {}, schedule = {}, splitTimes = {}, versions = [] }) {
  await sb('weeks', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=minimal',
    body: {
      week_start: weekStart,
      status: 'saved',
      split_times: splitTimes,
      versions: versions.slice(-MAX_VERSIONS),
      saved_at: new Date().toISOString(),
    },
  });
  // Version stacks live on the current week only (§6.3).
  await sb(`weeks?week_start=neq.${weekStart}`, {
    method: 'PATCH',
    prefer: 'return=minimal',
    body: { versions: [] },
  });

  const leaveRows = [];
  for (const [workerId, days] of Object.entries(leaves)) {
    (days || []).forEach((on, dayIdx) => {
      if (!on) return;
      // true = whole-day leave; { start, end } = time-range leave (v4.1).
      const ranged = on !== true && on.start && on.end;
      leaveRows.push({
        week_start: weekStart,
        worker_id: Number(workerId),
        day_index: dayIdx,
        start_time: ranged ? on.start : null,
        end_time: ranged ? on.end : null,
      });
    });
  }
  await sb(`leaves?week_start=eq.${weekStart}`, { method: 'DELETE', prefer: 'return=minimal' });
  if (leaveRows.length) await sb('leaves', { method: 'POST', prefer: 'return=minimal', body: leaveRows });

  const lockRows = [];
  for (const [workerId, days] of Object.entries(locks)) {
    (days || []).forEach((lock, dayIdx) => {
      if (lock == null) return;
      // storeId = whole-day lock; { storeId, start, end } = time-range lock (v4.1).
      const ranged = typeof lock === 'object';
      lockRows.push({
        week_start: weekStart,
        worker_id: Number(workerId),
        day_index: dayIdx,
        store_id: ranged ? lock.storeId : lock,
        start_time: ranged && lock.start ? lock.start : null,
        end_time: ranged && lock.end ? lock.end : null,
      });
    });
  }
  await sb(`locks?week_start=eq.${weekStart}`, { method: 'DELETE', prefer: 'return=minimal' });
  if (lockRows.length) await sb('locks', { method: 'POST', prefer: 'return=minimal', body: lockRows });

  const schedRows = [];
  for (const [workerId, days] of Object.entries(schedule)) {
    (days || []).forEach((slot, dayIdx) => {
      const am = slot ? slot.am : null;
      const pm = slot ? slot.pm : null;
      if (am != null || pm != null) {
        schedRows.push({ week_start: weekStart, worker_id: Number(workerId), day_index: dayIdx, am_store: am, pm_store: pm });
      }
    });
  }
  await sb(`schedule?week_start=eq.${weekStart}`, { method: 'DELETE', prefer: 'return=minimal' });
  if (schedRows.length) await sb('schedule', { method: 'POST', prefer: 'return=minimal', body: schedRows });

  await pruneWeeks();
}

/** Keep only the newest WEEKS_KEPT weeks; delete everything older. */
export async function pruneWeeks() {
  const weeks = await listWeeks();
  const stale = weeks.slice(WEEKS_KEPT);
  for (const w of stale) {
    const ws = w.week_start;
    await sb(`schedule?week_start=eq.${ws}`, { method: 'DELETE', prefer: 'return=minimal' });
    await sb(`leaves?week_start=eq.${ws}`, { method: 'DELETE', prefer: 'return=minimal' });
    await sb(`locks?week_start=eq.${ws}`, { method: 'DELETE', prefer: 'return=minimal' });
    await sb(`weeks?week_start=eq.${ws}`, { method: 'DELETE', prefer: 'return=minimal' });
  }
}

export async function loadWeek(weekStart) {
  const [weekRows, leaveRows, lockRows, schedRows] = await Promise.all([
    sb(`weeks?week_start=eq.${weekStart}`),
    sb(`leaves?week_start=eq.${weekStart}`),
    sb(`locks?week_start=eq.${weekStart}`),
    sb(`schedule?week_start=eq.${weekStart}`),
  ]);
  if (!weekRows || !weekRows.length) return null;

  const leaves = {};
  for (const r of leaveRows || []) {
    if (!leaves[r.worker_id]) leaves[r.worker_id] = [false, false, false, false, false, false, false];
    leaves[r.worker_id][r.day_index] = r.start_time && r.end_time ? { start: r.start_time, end: r.end_time } : true;
  }
  const locks = {};
  for (const r of lockRows || []) {
    if (!locks[r.worker_id]) locks[r.worker_id] = [null, null, null, null, null, null, null];
    locks[r.worker_id][r.day_index] =
      r.start_time && r.end_time ? { storeId: r.store_id, start: r.start_time, end: r.end_time } : r.store_id;
  }
  const schedule = {};
  for (const r of schedRows || []) {
    if (!schedule[r.worker_id]) schedule[r.worker_id] = Array.from({ length: 7 }, () => ({ am: null, pm: null }));
    schedule[r.worker_id][r.day_index] = { am: r.am_store ?? null, pm: r.pm_store ?? null };
  }
  return {
    weekStart,
    status: weekRows[0].status,
    splitTimes: weekRows[0].split_times || {},
    versions: weekRows[0].versions || [],
    leaves,
    locks,
    schedule,
  };
}
