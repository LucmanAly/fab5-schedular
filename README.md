# ShiftBoard — weekly staff scheduler (public demo build)

A mobile-first web app for scheduling main and floating workers across your stores, week by week, with split shifts.

This is the public branch: it has no backend of any kind. There's nothing to log into and no data to leak — everything lives in memory in your browser tab and resets on reload. Stores and workers start out named generically (Store 1, Main 1, Float 1, …) so you can try the scheduler without any real data.

## What's new in this version

- **Mobile-first UI** — a day-by-day card layout is the default on phones (tap a day, see each store's morning and evening at a glance). A full-week grid is one tap away on any screen.
- **Split shifts** — a store's day can be one worker all day, or split into a morning worker and an evening worker. A float can even work morning at one store and evening at another. Set the changeover time (noon–4pm) in step 1.
- **Reliable printing on phones** — printing now opens a clean on-screen sheet with a Print / Save PDF button, so it works on iOS and Android, not just laptops.

## Everyday features

- 5-step wizard: Set up → Names → Last week → Leave → Schedule
- Auto-generation respecting leave and the max-consecutive-days rest rule (2/3/4), including streaks carried over from last week
- Fair float rotation (fewest days worked go first)
- Store view and worker view, color-coded, with a live coverage banner (per half)
- Tap any slot to reassign — assign AM, PM, or the whole day; warnings inform but never block; two assigned workers swap cleanly
- Live gap detection — clearing a slot instantly shows OPEN
- Print by worker / print by store
- Auto-save at each step and on every edit, kept only in memory for the current tab

## Running locally

```bash
npm install
npm run dev
```

No setup, no keys, no accounts — it just runs.

## Deploying

Push this folder anywhere that builds a Vite app (Netlify, Vercel, GitHub Pages, etc.) — there are no environment variables to configure.

## Tests

```bash
npm test
```

Nine logic tests: rest-rule enforcement, week-boundary streaks, leave handling, no double-staffing per half, per-half gap alerts, float fairness, live gaps after edits, and split-shift coverage.

## Notes

- No backend, no login: nothing here can read or write anyone's real data. Reloading the page resets everything to the generic defaults.
- Schedule history and cloud diagnostics from the private build don't apply here, since there's no backend to archive weeks to.
- Split shifts are added by hand — generation still makes full days by default, which you then split where needed.
