# ShiftBoard — weekly staff scheduler

A hosted, mobile-first web app for scheduling main and floating workers across your stores, week by week. Now supports split shifts, and every generated week is archived to the cloud under its start date so you can reopen and reprint any past schedule.

## What's new in this version

- **Mobile-first UI** — a day-by-day card layout is the default on phones (tap a day, see each store's morning and evening at a glance). A full-week grid is one tap away on any screen.
- **Split shifts** — a store's day can be one worker all day, or split into a morning worker and an evening worker. A float can even work morning at one store and evening at another. Set the changeover time (noon–4pm) in step 1.
- **Reliable printing on phones** — printing now opens a clean on-screen sheet with a Print / Save PDF button, so it works on iOS and Android, not just laptops.
- **Cloud diagnostics** — tap the status badge (top right) to see the connection status, the exact last error, a Test connection button, and common fixes.

## Everyday features

- 5-step wizard: Set up → Names → Last week → Leave → Schedule
- Auto-generation respecting leave and the max-consecutive-days rest rule (2/3/4), including streaks carried over from last week
- Fair float rotation (fewest days worked go first)
- Store view and worker view, color-coded, with a live coverage banner (per half)
- Tap any slot to reassign — assign AM, PM, or the whole day; warnings inform but never block; two assigned workers swap cleanly
- Live gap detection — clearing a slot instantly shows OPEN
- Print by worker / print by store
- Schedule history — every week saved under its Monday; the previous archived week auto-fills the "last week" rest reference
- Auto-save at each step and on every edit

## Updating your live site

You already deployed once, so you just push the new code and Netlify redeploys.

1. **Run the updated SQL.** In Supabase → SQL Editor → New query, paste `supabase-setup.sql` and Run. It adds the split-shift columns. (It's safe to re-run; it recreates only the `schedule` table.)
2. **Push the new code.** In this folder:
   ```bash
   git add .
   git commit -m "Split shifts + mobile UI"
   git push
   ```
   Netlify redeploys automatically.

## Cloud error? Read this first

The status badge showing **Cloud error** almost always means one of two things:

1. **Netlify built before the keys were added.** Vite bakes the keys into the site at build time. If you added `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` after the first deploy, that build doesn't have them. Fix: Netlify → **Deploys → Trigger deploy → Clear cache and deploy site**.
2. **The SQL wasn't run** (or was run in a different Supabase project), so the tables don't exist. Fix: run `supabase-setup.sql` in the correct project.

Tap the badge in the app to see the actual error and a Test connection button — that tells you which of the two it is. If the badge instead says **Local only**, the keys aren't in the build at all (redeploy after adding them).

Note on keys: use the **anon / public** key from Supabase → Settings → API Keys (Legacy API Keys tab). The app also accepts a new **publishable** key. The Project URL is under Settings → Data API.

## First-time setup (if starting fresh)

Full walkthrough: create a Supabase project and run `supabase-setup.sql`; push this folder to GitHub; import the repo on Netlify and add the two environment variables under Site settings → Environment variables; deploy.

## Running locally

```bash
npm install
cp .env.example .env    # paste your Supabase URL + anon key
npm run dev
```

Without a `.env`, the app runs in local-only mode (nothing persists).

## Tests

```bash
npm test
```

Nine logic tests: rest-rule enforcement, week-boundary streaks, leave handling, no double-staffing per half, per-half gap alerts, float fairness, live gaps after edits, and split-shift coverage.

## Notes

- No login: anyone with the URL can edit. Fine for a single owner; add Supabase Auth and per-user policies if the URL must be private.
- Split shifts are added by hand — generation still makes full days by default, which you then split where needed.
