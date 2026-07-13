-- ============================================================================
-- ShiftBoard migration 001: recurring leave/lock patterns + per-worker
-- public-link tokens.
-- ADDITIVE ONLY — safe to run against a live database with existing data.
-- Does not touch weeks/leaves/locks/schedule. Idempotent: uses IF NOT EXISTS
-- guards throughout, so re-running it is harmless.
-- Run in the Supabase SQL Editor: New query -> paste -> Run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Recurring pattern (§ worker "weekly pattern"): a permanent default for the
-- per-week leave/lock grid. Same value shapes as the per-week cells (see
-- leaveAt/lockAt in src/lib/scheduler.js), just stored as one 7-element
-- (Mon-Sun) jsonb array per worker instead of one row per week/day:
--   recurring_leaves[d]: false | true | {"start":"HH:MM","end":"HH:MM"}
--   recurring_locks[d]:  null  | storeId | {"storeId":int,"start":"HH:MM","end":"HH:MM"}
-- The wizard copies this into that week's leaves/locks once, at wizard-start;
-- editing the week never writes back here, so a one-off override for a
-- single week never touches the permanent pattern.
-- ---------------------------------------------------------------------------
alter table workers add column if not exists recurring_leaves jsonb not null
  default '[false,false,false,false,false,false,false]'::jsonb;
alter table workers add column if not exists recurring_locks jsonb not null
  default '[null,null,null,null,null,null,null]'::jsonb;

-- ---------------------------------------------------------------------------
-- Public-link token (round 3): a permanent, random per-worker token used by
-- the read-only "?view=TOKEN" schedule link. Generated once on worker
-- creation by the app (crypto.randomUUID()); backfilled below for any
-- worker that predates this column.
-- ---------------------------------------------------------------------------
alter table workers add column if not exists public_token text;
create unique index if not exists workers_public_token_uq
  on workers (public_token) where public_token is not null;

update workers set public_token = gen_random_uuid()::text
where public_token is null;
