-- ============================================================================
-- ShiftBoard migration 002: read-only anon + admin authentication.
-- This is a security-boundary change, kept separate from migration 001's
-- additive schema change so it's independently auditable/revertable.
--
-- Prerequisite: run this BEFORE handing out any per-worker public schedule
-- link (round 3, phase C) — until this runs, the anon key baked into the
-- client bundle has full read/write on every table.
--
-- After this runs, the admin must sign in (Supabase Auth, email/password) to
-- create/edit/save anything. Create the one admin account once via the
-- Supabase Dashboard: Authentication -> Users -> Add user. There is no
-- signup flow in the app.
-- ============================================================================

drop policy if exists anon_all_stores   on stores;
drop policy if exists anon_all_workers  on workers;
drop policy if exists anon_all_weeks    on weeks;
drop policy if exists anon_all_leaves   on leaves;
drop policy if exists anon_all_locks    on locks;
drop policy if exists anon_all_schedule on schedule;

-- anon (unauthenticated — includes the public per-worker schedule link) gets
-- read-only SELECT. locks are intentionally NOT exposed: they're an internal
-- scheduling constraint, not something a public link recipient needs.
create policy anon_read_stores   on stores   for select to anon using (true);
create policy anon_read_workers  on workers  for select to anon using (true);
create policy anon_read_weeks    on weeks    for select to anon using (true);
create policy anon_read_leaves   on leaves   for select to anon using (true);
create policy anon_read_schedule on schedule for select to anon using (true);

-- authenticated (the signed-in admin) keeps full CRUD on everything.
create policy auth_all_stores   on stores   for all to authenticated using (true) with check (true);
create policy auth_all_workers  on workers  for all to authenticated using (true) with check (true);
create policy auth_all_weeks    on weeks    for all to authenticated using (true) with check (true);
create policy auth_all_leaves   on leaves   for all to authenticated using (true) with check (true);
create policy auth_all_locks    on locks    for all to authenticated using (true) with check (true);
create policy auth_all_schedule on schedule for all to authenticated using (true) with check (true);
