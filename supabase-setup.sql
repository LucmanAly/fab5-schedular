-- ============================================================================
-- ShiftBoard — Supabase setup (v4: shift modes, store hours, day allowance,
-- version stack, seed data; v4.2/v4.3: three-week retention + save-batched
-- versions — comment-only changes, the schema is identical to v4/v4.1 and
-- re-running is NOT required if those tables already exist. Retention count
-- lives in the app: WEEKS_KEPT in src/lib/supabase.js. Round 3: worker
-- recurring leave/lock pattern + public-link token columns — see the
-- "Workers" table below.)
-- FULL REPLACEMENT: drops and recreates every ShiftBoard table.
-- Existing schedule data will be lost — this version changes the data model.
-- Run in the Supabase SQL Editor: New query -> paste -> Run.
-- An EXISTING install that wants round 3's worker columns without losing
-- current schedule data should run supabase-migration-001-recurring-patterns.sql
-- instead of re-running this file.
-- ============================================================================

-- Old tables (including the retired config table) are removed entirely.
drop table if exists schedule;
drop table if exists leaves;
drop table if exists locks;
drop table if exists weeks;
drop table if exists workers;
drop table if exists stores;
drop table if exists config;

-- ---------------------------------------------------------------------------
-- Stores. Names are unique case-insensitively ("Downtown" == "downtown").
-- v4: shift_mode ('default' = full days normally, split occasionally;
-- 'split_only' = every shift split) and two timing buckets — Weekday and
-- Weekend (Sat+Sun) opening hours. A close at or before the open time means
-- the store runs past midnight (e.g. 12:00 -> 02:00).
-- ---------------------------------------------------------------------------
create table stores (
  id            int primary key,
  name          text not null,
  shift_mode    text not null default 'default'
                check (shift_mode in ('default', 'split_only')),
  weekday_open  text not null default '08:00',
  weekday_close text not null default '22:00',
  weekend_open  text not null default '09:00',
  weekend_close text not null default '22:00'
);
create unique index stores_name_ci on stores (lower(name));

-- ---------------------------------------------------------------------------
-- Workers. store_ids is the ORDERED list of linked stores (first = 1st link;
-- link order drives the tie-breaker ranking after Main preference).
-- main_store_id marks the worker as Main of that store (their home store,
-- always the first entry of store_ids). At most one Main per store, and a
-- worker can be Main at only one store — both enforced below.
-- v4: max_workdays = weekly day allowance (P5); full day = 1, split = 0.5.
-- Round 3: recurring_leaves/recurring_locks are a permanent default for the
-- per-week leave/lock grid — same 7-element (Mon-Sun) value shapes as the
-- per-week cells (see leaveAt/lockAt in src/lib/scheduler.js). The wizard
-- copies these into that week's leaves/locks once, at wizard-start; a
-- one-off override for a single week never writes back here.
-- public_token is a permanent random token for the read-only "?view=TOKEN"
-- per-worker schedule link.
-- ---------------------------------------------------------------------------
create table workers (
  id               int primary key,
  name             text not null,
  store_ids        int[] not null default '{}'::int[],
  main_store_id    int,
  max_workdays     numeric(3,1) not null default 5
                   check (max_workdays > 0 and max_workdays <= 7),
  recurring_leaves jsonb not null default '[false,false,false,false,false,false,false]'::jsonb,
  recurring_locks  jsonb not null default '[null,null,null,null,null,null,null]'::jsonb,
  public_token     text default gen_random_uuid()::text
);
create unique index workers_name_ci on workers (lower(name));
create unique index workers_one_main_per_store on workers (main_store_id)
  where main_store_id is not null;
create unique index workers_public_token_uq on workers (public_token)
  where public_token is not null;

-- ---------------------------------------------------------------------------
-- Weeks archive. Identity = calendar week (week_start date is the key). The
-- app keeps only the three most recent distinct weeks (the current schedule
-- plus two weeks of history): saving a new week automatically deletes the
-- oldest (see pruneWeeks / WEEKS_KEPT in the app — not enforced in SQL).
-- split_times: { "storeId-dayIndex": "HH:MM" } per-instance changeover
--   overrides; anything absent uses the derived default (window midpoint).
-- versions: the intra-week version stack (v0..v4, max 5 entries) — an array
--   of { schedule, splitTimes, leaves, savedAt }. ONE ENTRY PER EXPLICIT SAVE:
--   edits (manual reassignments, split changes, Find Cover applies) accumulate
--   as unsaved changes in the app and batch into a single new version when the
--   admin saves; v0 is the freshly generated schedule. Only the current week
--   keeps a stack; the app clears it on every other week when saving, so a
--   week rolling into history carries only its final saved version.
-- ---------------------------------------------------------------------------
create table weeks (
  week_start  date primary key,
  status      text not null default 'saved',
  split_times jsonb not null default '{}'::jsonb,
  versions    jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  saved_at    timestamptz
);

-- Leave requests: worker is unavailable that day (P3). Stored per week so a
-- saved week keeps its leave context (Find Cover needs schedule-off vs
-- requested-off). start/end_time NULL = whole-day leave; set = unavailable
-- only during that window ('HH:MM', v4.1).
create table leaves (
  week_start date not null,
  worker_id  int  not null,
  day_index  int  not null check (day_index between 0 and 6),
  start_time text,
  end_time   text,
  primary key (week_start, worker_id, day_index)
);

-- Locks: the inverse of a leave — a guaranteed assignment of a worker to a
-- store on a given day (P4). start/end_time NULL = whole day; set = the
-- worker is guaranteed exactly that window, the rest of the store's day
-- stays open for normal fill ('HH:MM', v4.1).
create table locks (
  week_start date not null,
  worker_id  int  not null,
  day_index  int  not null check (day_index between 0 and 6),
  store_id   int  not null,
  start_time text,
  end_time   text,
  primary key (week_start, worker_id, day_index)
);

-- The generated/edited schedule: one first-shift store and one second-shift
-- store per worker per day. A full day has am_store = pm_store; a split day
-- differs.
create table schedule (
  week_start date not null,
  worker_id  int  not null,
  day_index  int  not null check (day_index between 0 and 6),
  am_store   int,
  pm_store   int,
  primary key (week_start, worker_id, day_index)
);

-- ---------------------------------------------------------------------------
-- No-login internal tool: the anon role gets full read/write.
-- ---------------------------------------------------------------------------
alter table stores   enable row level security;
alter table workers  enable row level security;
alter table weeks    enable row level security;
alter table leaves   enable row level security;
alter table locks    enable row level security;
alter table schedule enable row level security;

create policy anon_all_stores   on stores   for all to anon using (true) with check (true);
create policy anon_all_workers  on workers  for all to anon using (true) with check (true);
create policy anon_all_weeks    on weeks    for all to anon using (true) with check (true);
create policy anon_all_leaves   on leaves   for all to anon using (true) with check (true);
create policy anon_all_locks    on locks    for all to anon using (true) with check (true);
create policy anon_all_schedule on schedule for all to anon using (true) with check (true);

-- ===========================================================================
-- Seed data (§9) — one-time convenience population. Written to be safe to
-- re-run: every insert skips silently if the row (by id or unique name)
-- already exists, so nothing errors or duplicates. The admin can still add,
-- edit, or remove any of this through Settings like hand-entered data.
-- ===========================================================================

-- Stores (9). Default shift mode and hours apply to all.
insert into stores (id, name) values
  (1, 'Ridge Ave'),
  (2, '2nd Street'),
  (3, '4th Street'),
  (4, '5th Street'),
  (5, '7th Street'),
  (6, '9th Street'),
  (7, '10th Street'),
  (8, '14th Street'),
  (9, 'Smoke Shop')
on conflict do nothing;

-- Workers (16). store_ids is in link order (1st link first) — it drives the
-- tie-breaker ranking. Each Main's home store is their 1st link.
insert into workers (id, name, store_ids, main_store_id) values
  ( 1, 'Luqman',   '{1,2,4}',   1),    -- Main @ Ridge Ave · 2nd St · 5th St
  ( 2, 'Amir',     '{1,5,6}',   null), -- Float: Ridge Ave · 7th St · 9th St
  ( 3, 'Abdul',    '{2,3,4}',   2),    -- Main @ 2nd Street · 4th St · 5th St
  ( 4, 'Fouad',    '{2,3,5,1}', null), -- Float: 2nd St · 4th St · 7th St · Ridge Ave
  ( 5, 'Karim',    '{3,2,4}',   3),    -- Main @ 4th Street · 2nd St · 5th St
  ( 6, 'Saqib',    '{4,3,5}',   4),    -- Main @ 5th Street · 4th St · 7th St
  ( 7, 'Taha',     '{4,5}',     null), -- Float: 5th St · 7th St
  ( 8, 'Mo',       '{5,4,6}',   5),    -- Main @ 7th Street · 5th St · 9th St
  ( 9, 'Waj',      '{5,6}',     null), -- Float: 7th St · 9th St
  (10, 'Afsar',    '{6,5,7}',   6),    -- Main @ 9th Street · 7th St · 10th St
  (11, 'Mansour',  '{6,7,8}',   null), -- Float: 9th St · 10th St · 14th St
  (12, 'Mushahid', '{7,6,8}',   7),    -- Main @ 10th Street · 9th St · 14th St
  (13, 'Salman',   '{7,8,9}',   null), -- Float: 10th St · 14th St · Smoke Shop
  (14, 'Sidaqat',  '{8,7,9}',   8),    -- Main @ 14th Street · 10th St · Smoke Shop
  (15, 'Johnny',   '{9,8}',     9),    -- Main @ Smoke Shop · 14th St
  (16, 'Jash',     '{9}',       null)  -- Float: Smoke Shop
on conflict do nothing;
