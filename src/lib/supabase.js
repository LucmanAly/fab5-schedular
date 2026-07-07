// Thin Supabase client over PostgREST — no SDK dependency.
// Keys come from Vite env vars (set as Netlify environment variables in production).

const URL = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const enabled = Boolean(URL && KEY);

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
    await sb('config?select=id&limit=1');
    return { ok: true, message: 'Connected — tables are reachable.' };
  } catch (e) {
    return { ok: false, message: lastError || e.message };
  }
}

// ---------- Setup (config + stores + workers) ----------

export async function loadSetup() {
  const [configRows, stores, workers] = await Promise.all([
    sb('config?id=eq.1'),
    sb('stores?order=id'),
    sb('workers?order=id'),
  ]);
  return { config: configRows[0] || null, stores, workers };
}

export async function saveSetup(config, stores, workers) {
  await sb('config', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=minimal',
    body: {
      id: 1,
      num_stores: config.numStores,
      num_floats: config.numFloats,
      max_consecutive: config.maxConsec,
      split_time: config.splitTime,
    },
  });
  await sb('stores?id=gte.0', { method: 'DELETE', prefer: 'return=minimal' });
  if (stores.length) await sb('stores', { method: 'POST', prefer: 'return=minimal', body: stores });
  await sb('workers?id=gte.0', { method: 'DELETE', prefer: 'return=minimal' });
  if (workers.length) await sb('workers', { method: 'POST', prefer: 'return=minimal', body: workers });
}

// ---------- Weeks (the archive) ----------

export async function listWeeks() {
  return sb('weeks?select=week_start,status&order=week_start.desc');
}

export async function saveWeek(weekStart, { status = 'draft', lastWeek = {}, leaves = {}, schedule = {} }) {
  await sb('weeks', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=minimal',
    body: { week_start: weekStart, status, last_week: lastWeek },
  });

  const leaveRows = [];
  for (const [workerId, days] of Object.entries(leaves)) {
    (days || []).forEach((on, dayIdx) => {
      if (on) leaveRows.push({ week_start: weekStart, worker_id: Number(workerId), day_index: dayIdx });
    });
  }
  await sb(`leaves?week_start=eq.${weekStart}`, { method: 'DELETE', prefer: 'return=minimal' });
  if (leaveRows.length) await sb('leaves', { method: 'POST', prefer: 'return=minimal', body: leaveRows });

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
}

export async function loadWeek(weekStart) {
  const [weekRows, leaveRows, schedRows] = await Promise.all([
    sb(`weeks?week_start=eq.${weekStart}`),
    sb(`leaves?week_start=eq.${weekStart}`),
    sb(`schedule?week_start=eq.${weekStart}`),
  ]);
  if (!weekRows.length) return null;

  const leaves = {};
  for (const r of leaveRows) {
    if (!leaves[r.worker_id]) leaves[r.worker_id] = [false, false, false, false, false, false, false];
    leaves[r.worker_id][r.day_index] = true;
  }
  const schedule = {};
  for (const r of schedRows) {
    if (!schedule[r.worker_id]) schedule[r.worker_id] = Array.from({ length: 7 }, () => ({ am: null, pm: null }));
    schedule[r.worker_id][r.day_index] = { am: r.am_store ?? null, pm: r.pm_store ?? null };
  }
  return { weekStart, status: weekRows[0].status, lastWeek: weekRows[0].last_week || {}, leaves, schedule };
}
