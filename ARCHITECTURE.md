# ShiftBoard — Functionality & Architecture

*Version 4 · last updated 2026-07-10*

ShiftBoard is a single-admin weekly staff scheduler for a small chain of stores. The admin defines stores and workers once, then each week picks a start date, enters leave requests and locks, auto-generates a schedule, hand-tunes it, and saves/prints it. After publication, the app helps handle real-world changes (someone calls off) with a "Find Cover" assistant. There is no login — it is an internal tool where the Supabase anon key has full read/write.

---

## 1. Tech stack & deployment

| Layer | Choice | Notes |
|---|---|---|
| UI | React 18 + Vite 5 | No router; a single `route` state string (`home / wizard / viewer / settings`) |
| Styling | One plain CSS file (`src/styles.css`) | CSS custom properties for the palette; mobile-first with a 720px desktop breakpoint |
| Backend | Supabase (PostgREST only) | No Supabase SDK — a thin `fetch` wrapper talks to `/rest/v1/` directly |
| Auth | None | RLS is enabled but every table grants the `anon` role full access |
| Hosting | Netlify (static build) | `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are baked in at build time |
| Tests | Plain Node script | `npm test` runs `tests/scheduler.test.js` (no framework; PASS/FAIL lines + exit code) |

The app degrades gracefully without Supabase keys: `cloud.enabled` is false, everything works in-memory for the session (starting from the built-in seed setup), and the sidebar badge shows "Local only".

### Scripts

```
npm run dev      # Vite dev server
npm run build    # production build to dist/
npm test         # scheduler unit tests
```

---

## 2. The toolchain — who does what

Five things cooperate to get a change from an idea to the live site:

```
 ┌─────────────────────────────── Laptop (local storage) ─────────────────────────────┐
 │                                                                                     │
 │   C:\...\shiftboard\            ← the working copy: source code, tests, SQL file    │
 │        ▲          │                                                                 │
 │        │ writes   │ git commit / git push                                           │
 │   Claude Code     ▼                                                                 │
 └────────────────── GitHub (LucmanAly/fab5-schedular, branch main) ───────────────────┘
                                    │
                                    │ push to main triggers a deploy
                                    ▼
                             Netlify (build + host)
                     npm run build → dist/ → served as static site
                     bakes VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
                     into the JS bundle at build time
                                    │
                                    │ the built app, running in the browser,
                                    │ calls the database directly over HTTPS
                                    ▼
                             Supabase (PostgreSQL + PostgREST)
                     stores · workers · weeks · leaves · locks · schedule
```

| Piece | Role | What lives there | What it does **not** do |
|---|---|---|---|
| **Laptop (local storage)** | Workbench | The only editable copy of the code (`C:\Users\zohan\Downloads\new\shiftboard`), plus `node_modules` and local builds. `npm run dev` runs the app here for testing. | It is not a backup — anything committed nowhere else exists only on this disk. There's no local `.env`, so a locally-run app is "Local only" (in-memory seed data, nothing saved). |
| **Claude Code** | Builder | Reads and edits the files on the laptop, runs the tests and builds, writes the SQL. Works from written specs (v3, v4) and conversation. | It doesn't deploy or push on its own — changes stay local until *you* commit/push (or ask it to). It has no access to the live Supabase data. |
| **GitHub** | Source of truth + trigger | The repo `LucmanAly/fab5-schedular` (branch `main`) holds the committed history. Serves as the off-laptop backup and the thing Netlify watches. | It stores code only — no schedule data, no secrets (the Supabase keys are Netlify environment variables, not files in the repo). |
| **Netlify** | Build & host | On every push to `main`, runs `npm run build` (per `netlify.toml`) and serves the static `dist/` output. Holds the two `VITE_SUPABASE_*` environment variables and bakes them into the JS at build time. The SPA redirect rule sends every URL to `index.html`. | It runs no server code — after the page loads, Netlify is out of the loop entirely. Changing an env var requires a redeploy ("Clear cache and deploy site") because the keys are baked in, not read live. |
| **Supabase** | Database | The actual data: stores, workers, saved weeks, leaves, locks, schedules, version stacks. The browser talks to it directly via PostgREST (`/rest/v1/`) using the anon key — there is no backend of ours in between. Schema changes are applied by pasting `supabase-setup.sql` into its SQL Editor. | It holds no code and knows nothing about the app. RLS is enabled but the anon role has full read/write (single-admin internal tool, no login). |

**The path of a change:** Claude edits files on the laptop → tests/build run locally → `git commit` + `git push` to GitHub → Netlify auto-builds and publishes → the browser loads the new bundle → the bundle reads/writes Supabase directly. **The path of data:** browser ↔ Supabase only; data never passes through GitHub or Netlify, and never touches the laptop unless the app is open there.

Two practical consequences worth remembering:

- **Code changes and schema changes deploy separately.** A push updates the app via Netlify, but `supabase-setup.sql` does nothing until it's manually run in the Supabase SQL Editor. A v4 app pointed at a v3 database fails on save (missing columns) — run the SQL first.
- **Local ≠ deployed data.** With no `.env` on the laptop, `npm run dev` exercises the UI against in-memory seed data; the deployed site is the only place touching the real database.

---

## 3. File map

```
supabase-setup.sql          Full replacement schema + idempotent seed data
src/
  main.jsx                  React entry point
  App.jsx                   Shell: routing, wizard, viewer, version stack, toasts
  styles.css                All styling
  lib/
    scheduler.js            ALL domain logic (pure, no React/network) — the heart
    supabase.js             PostgREST client: setup, weeks, versions, pruning
    seed.js                 Built-in default setup (same 9 stores / 16 workers
                            as the SQL seed) for local mode and fresh databases
  components/
    SettingsPanel.jsx       Stores/workers/history settings page
    CheckGrid.jsx           Generic worker×day checkbox grid (leave requests)
    LockGrid.jsx            Worker×day grid for locks (pick a linked store)
    ScheduleView.jsx        Review & Modify board + cell editor
    FindCover.jsx           Post-publication cover assistant (+ chain swaps)
    Overlays.jsx            SaveSheet, DiagnosticsPanel, PrintOverlay,
                            ConfirmModal (tier 1), UndoToast (tier 2)
tests/
  scheduler.test.js         40 unit tests over the pure logic
```

**Design rule:** everything that decides *who works where when* lives in `scheduler.js` as pure functions over plain data. Components only render and route events. This is what makes the logic testable with a bare Node script.

---

## 4. Data model

### 4.1 Domain objects (in-memory shapes)

```js
// Store
{ id, name,
  shift_mode: 'default' | 'split_only',
  weekday_open: 'HH:MM', weekday_close: 'HH:MM',   // default 08:00–22:00
  weekend_open: 'HH:MM', weekend_close: 'HH:MM' }  // default 09:00–22:00 (Sat+Sun)

// Worker
{ id, name,
  store_ids: [storeId, ...],   // ORDERED — first = 1st link (drives ranking)
  main_store_id: storeId|null, // Main of that store; always store_ids[0]
  max_workdays: number }       // weekly day allowance, 0.5 granularity, default 5

// Schedule (one week)
schedule[workerId][dayIdx] = { am: storeId|null, pm: storeId|null }
// dayIdx 0..6 = Mon..Sun. Full day = { am: X, pm: X }.
// { am: X, pm: Y } = split day bridging two stores.

// Leaves:  { workerId: [bool ×7] }        — requested days off
// Locks:   { workerId: [storeId|null ×7] } — guaranteed assignments
// splitTimes: { "storeId-dayIdx": "HH:MM" } — per-instance changeover overrides
```

Invariants enforced by the Settings UI and DB indexes:

- Store and worker names are unique **case-insensitively**.
- At most one Main per store; a worker is Main of at most one store.
- A Main's home store is always their first link.
- Total workers ≥ total stores before a schedule can be generated.

### 4.2 Supabase schema (see `supabase-setup.sql`)

| Table | Key | Purpose |
|---|---|---|
| `stores` | `id` | + shift mode and the two timing buckets |
| `workers` | `id` | + `store_ids int[]` (ordered links), `main_store_id`, `max_workdays` |
| `weeks` | `week_start date` | One row per calendar week; holds `split_times jsonb` and `versions jsonb` |
| `leaves` | (week, worker, day) | Per-week leave requests — kept with the week so Find Cover can tell "schedule-off" from "requested-off" later |
| `locks` | (week, worker, day) | Guaranteed store assignment |
| `schedule` | (week, worker, day) | `am_store` / `pm_store` per worker-day (the live/published version) |

The **calendar week is the identity**: `week_start` is the primary key, so re-saving a week upserts in place — nothing is duplicated and nothing is pushed into history by editing.

The SQL file is a full drop-and-recreate, followed by **seed data** (9 stores, 16 workers with link order and Main roles) inserted with `ON CONFLICT DO NOTHING`, so re-running never errors or duplicates.

The same seed also lives in the app (`src/lib/seed.js`): with no cloud keys the local session starts from it, and when the app connects to a completely empty database (zero stores *and* zero workers) it populates and saves the seed automatically — so the default names appear even if the SQL inserts were skipped.

---

## 5. The time model (v4)

All shift math runs on **minutes from midnight**.

- `storeWindow(store, dayIdx)` picks the weekday or weekend bucket (weekend = Sat/Sun, dayIdx ≥ 5). If `close ≤ open` the store runs past midnight and close gets +1440 — e.g. 12pm–2am → `{open: 720, close: 1560}`.
- `defaultSplitMin(store, dayIdx)` = window midpoint, snapped to the nearest 30 minutes. 8am–10pm → 3pm; 12pm–2am → 7pm.
- `splitMinFor(store, dayIdx, splitTimes)` returns the per-instance override (key `"storeId-dayIdx"`) if it falls inside the window, else the derived default. Overrides are stored **sparsely** — setting the changeover to exactly the default deletes the override.
- `shiftWindow(store, dayIdx, 'am'|'pm'|'full')` → `{start, end}` real clock interval of a half or the whole day.
- `dayIntervals(slot, stores, dayIdx, splitTimes)` → the actual intervals a worker is on the clock for one day (a full day at one store is a single interval).

**Double-booking is real overlap, not AM/PM labels.** Two assignments clash iff their intervals overlap (`a.start < b.end && b.start < a.end`). So a worker can do Store A's 8–3 first half and Store C's 7pm–2am second half back-to-back (no travel buffer), but not C's 12–7pm first half against A's 3–10pm second half.

`workerHours(row, stores, splitTimes)` sums interval durations per week — this feeds the live hours display in the Worker views and Find Cover's candidate list.

---

## 6. The priority ladder (P1–P9)

Constraints are ranked; a lower number is more protected. The split into "interactive" and "silent" tiers is the core UX decision of v4.

| # | Constraint | Tier |
|---|---|---|
| P1 | Coverage of every store/shift/day **and** no double-booking (real overlap) | interactive |
| P2 | Store Shift Mode — Split-Only stores are always split (two different workers) | interactive |
| P3 | Leave requests | interactive |
| P4 | Locks | interactive |
| P5 | Worker day allowance (`max_workdays`; full day = 1, split half = 0.5) | interactive |
| P6 | Linked stores only | silent |
| P7 | Consecutive-day ceiling — hardwired soft 3 / hard 4 **full** days (half days reset the streak) | silent |
| P8 | Prefer full shifts (split-day fallback near the P7 ceiling) | silent |
| P9 | Unique off-days — history-driven soft preference; needs ≥ 2 saved weeks, else a silent no-op | silent |

- **Generation:** the engine relaxes silently in order P9 → P8 → P7 → P6. If it still must break P1–P5, the violation is returned and the review screen shows the interactive box: *continue anyway, or go back and change preferences*. In practice the generator honors P2/P3/P4 absolutely (they're inputs it never contradicts), so only P1 and P5 can come out of generation.
- **Manual edits are never blocked.** After any edit (wizard review or saved-schedule editing), `computeViolations` re-runs; only *newly added* P1–P5 violations trigger the warn-and-confirm box (keep my change / undo). P6–P9 breaks go through silently — which is also why the worker picker always lists unlinked workers with no popup (linked-only is P6).
- **Violation identity:** each violation has a stable `violationKey`, so pre-existing problems the admin already accepted are subtracted and only the delta is surfaced.

### Store-link ranking (not a P-level)

After the ladder narrows a slot to eligible candidates, a comparator picks the winner:

1. Main at this store
2. Earlier link order (`store_ids.indexOf`)
3. Fewer days worked, then fewer halves worked (load spreading)
4. P9 tie-break: prefer whoever was off this weekday most in the last 2 weeks (rotates off-days)
5. Worker id (determinism)

This is deliberately a tie-breaker, not a constraint — it cannot be "violated".

---

## 7. The generator (`generateSchedule`)

Input: `{ stores, workers, leaves, locks, lastWeekLoad, history, splitTimes }` → `{ schedule, violations }`.

For each day Mon→Sun, three phases:

1. **Locks (P4).** Placed first, unconditionally. On a Split-Only store the locked worker gets the first half only (P2 outranks the lock's full-day *shape*; the lock — "works that store that day" — still holds, and the lock check passes on ≥ 1 half).
2. **Main defaults.** Each store's Main takes their home store (full day, or first half on Split-Only stores) unless they're locked elsewhere, on leave, at the soft streak limit, out of allowance, or the store is already covered.
3. **Fill (P1).** For every uncovered half: on default-mode stores, try one worker for the whole day first (P8); otherwise fill halves individually. Candidates must pass `canTake` (slot empty, no real-time overlap, not the same worker both halves of a Split-Only store) and are tried in relaxation tiers:
   - linked + streak < 3 + within allowance
   - linked + streak < 4 (P7 relaxed to the hard ceiling)
   - unlinked (P6 broken), streak < 3, then < 4
   - **mid-streak split (P8 break):** if a linked worker is ceiling-bound, downgrade one mid-run full day to a half (handing the other half to someone else) so their streak resets and today is legal
   - **allowance break (P5, last resort):** assign over allowance rather than leave a gap
   - nothing → a P1 coverage violation is recorded

4. **Allowance rebalance (post-pass).** The greedy loop can front-load capacity — mains burn all 5 allowance days Mon–Sat and Sunday comes up 2 workers short even though total capacity is fine. `rebalanceAllowance()` walks every over-allowance worker and hands days (latest first, never locked days) to workers with spare allowance who can legally take them. Only overruns that survive this repair are reported as P5 violations. With the v4 seed data this pass is the difference between "2 false P5 warnings every week" and a clean generation.

**Streaks across weeks:** `lastWeekLoad` (per-day 0/1/2 from the previous saved week) feeds `streakBefore`, so a worker who ended last week on 3 full days isn't defaulted in on Monday. Half days count as partial rest and reset the streak — that is exactly the P8 escape hatch.

**P9 history:** `offDayHistory` counts, per worker per weekday, how often they were fully off across the last 2 saved weeks. With < 2 weeks it's `null` and the comparator term vanishes — no errors, no effect.

---

## 8. UI flows

### 8.1 Shell & navigation

`App.jsx` owns all cross-cutting state: setup data, the wizard, the viewer, cloud status, the undo toast, and modals. The sidebar (drawer on mobile) has Home / New schedule / Last schedule / Settings, plus a cloud-status badge that opens a diagnostics panel (connection test, key type, common fixes).

### 8.2 Settings

Three tabs: **Stores**, **Workers**, **History**. All edits are staged locally (`tempStores` / `tempWorkers`) and only persisted on "Save setup", which validates (names present/unique, every worker linked) and then does a full delete-and-reinsert via `saveSetup`.

- Store cards: name, Shift Mode as two plain buttons (**Default** / **Split Shift Only** — no descriptions), Weekday and Weekend open/close time inputs.
- Worker cards: name, Main/Float segment (Main only offered if the home store's Main seat is free), **Max workdays/week** (number input, 0.5 steps, clamped 0.5–7), ordered store links with ↑/↓ reordering (a Main's home store is pinned first) and a typeahead that only accepts existing stores.
- **Destructive tiers (§8 of the spec):** deleting a store or worker opens a confirmation modal (styled like the violation box); clearing a single store link applies immediately with a ~5s undo toast.

### 8.3 New Schedule wizard (3 steps)

1. **Start date.** Any picked date snaps to that week's Monday. If a schedule already exists for that week, a confirm modal warns: *"generating a new one will replace it."*
2. **Preferences.** Two tabs: leave requests (checkbox grid) and locks (tap a cell → pick one of that worker's linked stores). Leaves and locks on the same cell are mutually exclusive (each entry clears the other). Removing a lock or clearing a leave shows an undo toast.
3. **Review & save.** Generates via `generateSchedule` (loading up to 2 prior weeks for streak carry-over and P9), then shows the board. The interactive violation box appears if generation broke P1–P5; after 3 failed attempts it adds a "something has to give" explanation. Regenerate re-rolls; Save opens a bottom sheet (warns about remaining OPEN slots) and persists.

### 8.4 Review & Modify board (`ScheduleView`)

- **Week/Day layout toggle** (day mode defaults on narrow screens) and **By store / By worker** grouping.
- Store rows show split cells with the real changeover time (e.g. `→3 PM Amir / 3 PM→ Waj`); Split-Only stores are chipped.
- Worker views show a **Days** column (workload in day-units, red when over allowance) and a live **Hours** column computed from real windows.
- Tapping a cell opens the **cell editor**: Full-shift tab (one worker all day) or Split tab (1st/2nd shift per worker, changeover time input with "store default" hint and a reset button). Every worker is always listed with a status note (Available / On leave / Locked to X / needs rest / At Y — will swap); assigning over someone swaps them out of that half. Unassigning is an undo-toast action.

### 8.5 Saved-week viewer: versions & editing

Saved weeks open in the same board, fully editable. The stamp bar shows the state (`saved` / `previewing` / `edited (unsaved)`) and the **version navigator**:

- The stack holds **v0–v4** (max 5): v0 is the freshly generated schedule, each save appends the next version; on overflow the oldest drops and the stack shifts down.
- ◄/► navigate versions as **previews** — the back arrow is hidden at v0, the forward arrow at the latest. Publishing a previewed version (or saving edits made on top of one) **discards everything after that point** — strictly linear, no branching.
- Versions are `{schedule, splitTimes, leaves, savedAt}` entries in `weeks.versions` (jsonb). Consecutive identical saves are deduplicated. Saving any week clears the stack on all *other* weeks, so a week rolling into history keeps only its final version.

Edits in the viewer run the same P1–P5 warn-and-confirm delta check as the wizard.

### 8.6 Find Cover (post-publication assistant)

Tapping an **assigned** cell on a saved schedule opens Find Cover instead of the editor (an "Edit manually" button gets you back to the raw editor; empty cells go straight to the editor). If two workers share the cell, it first asks who needs cover.

- **Candidates** are workers *linked to that store* and genuinely free for the target interval (real overlap check). They're split into schedule-off (selectable) and requested-off (greyed out, struck through).
- **Ranking:** 🟢 green = covering breaks nothing; 🟡 yellow = only silent-tier costs, with a badge naming the cost (e.g. "would be their 4th straight day", "takes a split shift"); 🔴 red = would add a P1–P5 violation — still tappable (manual changes are never blocked) but applying triggers the warn-and-confirm box. Each row shows the candidate's current week hours.
- **Apply:** the candidate takes the halves, the original worker's whole day is cleared and recorded as **leave**, the violation delta is re-checked (warn+confirm for P1–P5, silent otherwise), and the week re-saves in place — one new version on the stack.
- **Chain swaps (opt-in only):** the "Run Chain Swap" button searches multi-hop paths: find an off worker Y who can backfill busy worker X's store, freeing X (who *is* linked to the target store) to cover the original slot. Each viable chain is presented as one plain-English sentence — *"Free Abdul from 2nd St by sending Luqman there, and Abdul will cover Sameer at Ridge."* — and applies as a single save with one violation check across all affected slots. Chains are only offered when fully clean (no new P1–P5). Current implementation searches one intermediate hop (the spec's example shape); the entry point takes a `maxDepth` parameter if deeper recursion is ever needed.

### 8.7 Printing

From the viewer: **Print by worker** (a table per worker) or **Print by store** (a table per store), rendered into a print-only overlay that calls `window.print()` (print CSS hides the app shell).

---

## 9. History & retention

- **2 distinct calendar weeks** are kept (by `week_start`), enforced by `pruneWeeks()` after every save: anything older than the newest two weeks is deleted across all four week-scoped tables. Re-saving the current week never evicts anything (same primary key).
- Each saved week keeps its **leave requests** alongside the schedule — required by Find Cover to distinguish schedule-off from requested-off.
- All history consumers (streak carry-over, P9) no-op cleanly with 0 or 1 weeks of history.

---

## 10. Destructive-action policy (two tiers)

| Tier | Treatment | Actions |
|---|---|---|
| 1 | Confirmation modal (violation-box styling, Cancel/Delete) | Delete worker, delete store — rare, cascading, hard to reverse |
| 2 | Apply immediately + ~5s undo toast | Clear a store link, remove a lock, clear a leave request, unassign a cell |

The rationale: a blanket "are you sure?" on everything trains people to click through it. Tier 2 undo only has to work for a few seconds, so it needs no database history — the undo closure just restores the previous in-memory state.

---

## 11. Sync layer (`src/lib/supabase.js`)

A ~200-line `fetch` wrapper around PostgREST:

- Handles both legacy JWT anon keys (`Authorization: Bearer`) and new publishable keys (`apikey` header only).
- `loadSetup`/`saveSetup`: stores + workers, with v4 fields defaulted on read so pre-v4 rows can't produce `undefined`s. Save is delete-all-then-insert (single-admin tool; no concurrency handling by design).
- `saveWeek`: upserts the week row (`Prefer: resolution=merge-duplicates`) including `split_times` and the capped `versions` array, then replaces the leaves/locks/schedule rows for that week, clears `versions` on every other week, and prunes to 2 weeks.
- `loadWeek`: reassembles the in-memory shapes from the row tables.
- Diagnostics: last-error capture, key-type detection, and a connection test used by the sidebar badge panel.

Failure model: every cloud call flips the badge to "Cloud error" but never blocks the UI — the admin can keep working and retry by saving again.

---

## 12. Testing

`tests/scheduler.test.js` — 40 checks, zero dependencies, `node` runs it directly (`npm test`). Coverage highlights:

- P1 coverage & no double-staffing; impossible setups surface violations rather than silence
- The spec's exact overlap example (Store A 8–10pm vs Store C 12pm–2am, both directions)
- Past-midnight windows and derived split midpoints
- Split-Only stores: always split when generated; manual full-day flagged as P2
- Allowance: full=1/split=0.5 accounting, respected under capacity, rebalance repairs greedy front-loading, genuine overruns reported
- P9: off-day counting, rotation with 2 weeks of history, silent no-op with less
- Streak carry-over across the week boundary; hard 4-day ceiling
- Locks honoured and flagged when manually broken
- Find Cover: green/greyed classification; chain swap discovery, sentence text, and post-chain coverage

There are no component/UI tests — the pure core carries the correctness burden, which is why all scheduling behavior must stay in `scheduler.js`.

---

## 13. Known limits & intentional non-features

- **Single admin, no concurrency:** last write wins everywhere; no auth, no row ownership.
- **Chain swaps search one intermediate hop.** Deeper chains (3+ moves) are structurally supported (`maxDepth`) but not searched.
- Cross-midnight shifts are checked for overlap **within** a day; a 2am close is not checked against the *next* day's opening shift.
- Two locks pointing different workers at the same store/day can double-staff a half (the UI makes this hard to do; the generator doesn't detect it).
- The consecutive-day ceiling counts **full** days only — a run of half days never trips P7 (by design: half days are the pressure valve).
- No drag-and-drop, by explicit product decision — all editing is tap-a-cell.
