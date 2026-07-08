-- ShiftBoard — Supabase setup (v2: split shifts).
-- Safe to run on a fresh project OR to upgrade an existing ShiftBoard database.
-- Run in the Supabase SQL Editor: New query -> paste -> Run.

-- config (adds split_time)
create table if not exists config (
  id int primary key default 1,
  num_stores int not null default 8,
  num_floats int not null default 6,
  max_consecutive int not null default 3 check (max_consecutive in (2, 3, 4)),
  split_time text not null default '14:00'
);
alter table config add column if not exists split_time text not null default '14:00';

create table if not exists stores (
  id int primary key,
  name text not null
);

-- Worker-store linkage is manual and ordered: store_ids[0] is the worker's top
-- preference (a main's effective home store); further entries are backup stores.
-- Recreated to move off the old single store_id column.
drop table if exists workers;
create table workers (
  id int primary key,
  name text not null,
  type text not null check (type in ('main', 'float')),
  store_ids int[] not null default '{}'
);

create table if not exists weeks (
  week_start date primary key,
  status text not null default 'draft',
  last_week jsonb,
  created_at timestamptz not null default now(),
  finalized_at timestamptz
);
alter table weeks add column if not exists finalized_at timestamptz;

create table if not exists leaves (
  week_start date not null,
  worker_id int not null,
  day_index int not null check (day_index between 0 and 6),
  primary key (week_start, worker_id, day_index)
);

-- schedule now holds a morning store and an evening store per worker/day.
-- Recreated to add the am/pm columns (old full-day rows, if any, are cleared).
drop table if exists schedule;
create table schedule (
  week_start date not null,
  worker_id int not null,
  day_index int not null check (day_index between 0 and 6),
  am_store int,
  pm_store int,
  primary key (week_start, worker_id, day_index)
);

-- No-login internal tool: the anon role gets full read/write.
alter table config enable row level security;
alter table stores enable row level security;
alter table workers enable row level security;
alter table weeks enable row level security;
alter table leaves enable row level security;
alter table schedule enable row level security;

drop policy if exists anon_all_config on config;
drop policy if exists anon_all_stores on stores;
drop policy if exists anon_all_workers on workers;
drop policy if exists anon_all_weeks on weeks;
drop policy if exists anon_all_leaves on leaves;
drop policy if exists anon_all_schedule on schedule;

create policy anon_all_config on config for all to anon using (true) with check (true);
create policy anon_all_stores on stores for all to anon using (true) with check (true);
create policy anon_all_workers on workers for all to anon using (true) with check (true);
create policy anon_all_weeks on weeks for all to anon using (true) with check (true);
create policy anon_all_leaves on leaves for all to anon using (true) with check (true);
create policy anon_all_schedule on schedule for all to anon using (true) with check (true);
