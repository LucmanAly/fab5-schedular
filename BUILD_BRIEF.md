# ShiftBoard — Build Brief

I run a small retail group: eight shops, one "main" worker attached to each shop, plus a pool of
floating workers who cover whoever is off. Every week I have to build a roster by hand, and every
week I get it slightly wrong — someone works nine days straight, a shop opens with nobody in it, or
I forget a leave request I approved on WhatsApp.

I want a web app called **ShiftBoard** that builds next week's roster, lets me fix it by hand in
seconds on my phone, and prints something I can pin on a wall. I've had a version of this built
before, so I know what works and what doesn't. This brief tells you the shape I want and — more
importantly — *why*. Where I explain reasoning, treat it as a constraint. Where I don't, use your
judgement; I'm not going to specify every button.

---

## 1. The job to be done

Sunday evening. I open the app on my phone. It already knows my shops, my staff, and who worked
last week. I tick off this week's leave requests, tap **Generate**, and get a roster that respects
rest rules and leave. Roughly 80% of it is right. I spend five minutes tapping the wrong cells to
fix them, then print two sheets: one per worker (what each person needs to know) and one per shop
(what each shop needs to know). Next Sunday, last week is already archived and pre-filled as the
rest-day reference.

That's the whole product. Everything else is in service of it.

## 2. Domain rules — and the reasoning behind them

These came out of running the previous version for real. Please don't redesign them.

**The atomic unit is a half-day, not a day.** Store a worker's day as `{ am: storeId | null, pm:
storeId | null }`. A full day is the same store in both halves; a morning-only shift leaves `pm`
null; and a float can genuinely work `{ am: shop1, pm: shop3 }`. The naive model — a day with an
optional "is split" flag — forces a special case into every single function that touches the
schedule. Making the half the primitive means "full day" is just the common case of one uniform
representation, and split shifts, partial coverage and cross-shop floats all fall out for free with
no extra code.

**Coverage gaps are derived, never stored.** Compute open slots from the current schedule every
time you render. If you cache a gap count in a variable or a database column, it will eventually
disagree with what's on screen, and I will trust the wrong one. The rule generalises: anything you
can recompute cheaply from the schedule (gap list, days worked, similarity to last week) should be
recomputed, not persisted.

**Warnings inform; they never block.** If I assign someone who's on leave or owed a rest day, show
me a clear label next to their name — then do exactly what I asked. Real scheduling is full of
"she said she'd cover anyway." A tool that refuses my override is a tool I stop using. This also
means the generator's rules and the manual editor's rules are deliberately asymmetric: the
generator obeys them, I overrule them.

**Rest streaks cross the week boundary.** Consecutive-days-worked must count backwards past Monday
into last week's record, otherwise someone finishing a Fri–Sun run gets scheduled Monday and the
rule is worthless in exactly the case it exists for. The max-consecutive setting should be
configurable (2, 3 or 4).

**Dates are local `yyyy-mm-dd` strings, built from local date parts.** Never `toISOString()`, never
UTC. A shop owner in a negative UTC offset who picks Monday the 6th and gets Sunday the 5th stored
loses faith in the whole thing immediately. Weeks are always keyed by their Monday.

**Fairness among floats means fewest-days-worked goes first.** Simple, explainable, and I can
defend it to staff. Don't build an optimiser I can't explain.

## 3. Architecture

**A pure domain module at the centre.** All scheduling logic — generation, rest-streak counting,
availability, gap detection, date maths, shift-time formatting — lives in one module that imports
nothing: no UI framework, no network client. That module gets a test suite that runs on plain Node
with no test framework installed, and it covers: rest limits inside the week, streaks across the
week boundary, leave never scheduled, no shop double-staffed in one half, uncovered shops surfacing
as gaps, float balance within one day of each other, gaps updating after an edit, and two workers
splitting a day leaving no gap. The reason for the purity rule is that scheduling is the only part
of this app where a bug costs me money, and pure functions are the only part I can test in
milliseconds without a browser.

**One module owns all network access.** Every read and write to the database goes through a single
data-access module that exposes intention-shaped functions (`loadSetup`, `saveSetup`, `listWeeks`,
`loadWeek`, `saveWeek`). No component ever calls the database directly. It exposes an `enabled`
flag from whether credentials are present, and when they're absent the whole app still runs, just
without persistence — I want to be able to try things without a backend, and a half-configured
deploy should degrade, not crash.

**The UI renders state and raises intents.** Components take data and callbacks; they don't own
domain rules. Where a component needs a derived value, it calls the domain module.

**Stack:** React + Vite, a hosted Postgres (Supabase) reached over its REST API, deployed as static
files on Netlify with an SPA redirect. Two build-time environment variables hold the database URL
and key. Do not pull in a state-management library, a component library, or an ORM — the app is a
few thousand lines and every dependency is something I have to maintain forever. A single global
stylesheet with CSS custom properties for the palette, type and a 44px minimum tap target is enough.

**Data model.** `config` (counts and rules), `stores`, `workers` (each with `type` of main or float,
and a `store_id` for mains), `weeks` (keyed by Monday, holding status and last week's worked
record), `leaves` (one row per worker/day off), `schedule` (one row per worker/day with an
`am_store` and `pm_store`). Foreign keys and cascades on the child tables, please.

## 4. Mistakes in the last build — please don't repeat these

I'm listing these because they're the expensive ones, and most are architectural rather than
cosmetic.

- **A half-wired feature.** "Split shift time" existed as a picker, a piece of UI state, and a
  database column — but the display code had `14:00` hard-coded in three places and the value was
  never saved or read. One of the components even referenced an undefined variable, so tapping any
  cell to reassign it crashed the app to a white screen. **Rule: a feature is done when the value
  the user picks flows all the way from input → state → database → back out on reload → into every
  place it's displayed.** If you can't complete that loop in the current phase, don't ship the
  picker.
- **Destroying data to save it.** Saving setup deleted every store and worker row, then inserted
  the new ones. Any failure between the two steps leaves me with an empty roster. Use upserts, and
  delete only what was actually removed. Same for weekly saves.
- **A setup script that drops the schedule table**, documented as "safe to re-run." It wipes the
  entire archive. Migrations must be additive and idempotent.
- **A settings panel that read its initial values once at app start**, before the data had loaded
  from the network, and so showed empty lists forever. Any editing surface must take its values
  from the current state at the moment it opens.
- **A "Finalize" button that changed a status field and nothing else.** The schedule stayed fully
  editable, and any edit silently flipped it back to draft. The confirmation dialog printed "✓ All
  gaps are acceptable" as static text regardless of actual gaps. If finalizing means locked, lock
  it; if a summary claims something, compute it.
- **Writing the entire week to the database on every single tap**, unbatched and unordered, so a
  slow response could overwrite a newer edit. Debounce, and make writes ordered or idempotent.
- **Saving state immediately after setting it**, capturing the old value instead of the new one.
  Persist from the value you just computed, not from state you assume has updated.
- **Dead code left wired up:** an earlier five-step wizard was cut to three, but the removed step
  components were still imported and the week-start date picker vanished with them — so there was
  no way to build a week other than next Monday. Also five overlapping markdown docs, all stale.
  One README, kept true.
- **Security is not designed.** The database was wide open to anonymous read *and write* for
  anyone who found the URL. For my use that's a single shared login at minimum. Please put the
  simplest real gate on writes that doesn't add a backend, and tell me plainly what it does and
  doesn't protect.

## 5. Build phases

Four phases. One-shot builds of something this size come back plausible-looking and broken in the
seams, but ten micro-phases waste most of their tokens re-explaining context. Four is the smallest
number where each phase ends in something I can actually verify, and each one only depends on the
phase before it.

**Phase 1 — Domain core.** The pure scheduling module and its Node test suite. No UI, no network.
Generation, rest rules, leave, gap detection, date helpers. *Done when:* `npm test` passes the
scenarios listed in §3 and I can read the module top to bottom and recognise my business.

**Phase 2 — Persistence and schema.** Database schema with keys and constraints, the single
data-access module, the idempotent setup/migration script, and the local-only fallback path.
*Done when:* a scripted round trip saves a generated week and loads it back byte-identical, and the
app boots with no credentials configured.

**Phase 3 — The working app.** Mobile-first UI: the three-step flow (last week → leave →
schedule), the schedule view with both a by-shop and by-worker grouping and both a day and a week
layout, tap-to-reassign with AM/PM/whole-day options, live gap banner, and settings for shops,
staff and rules. Auto-save wired through Phase 2. *Done when:* I can build, edit and reload a week
on a phone without losing anything.

**Phase 4 — Publish and operate.** Print-by-worker and print-by-shop (render a clean sheet
on-screen with a Print button rather than relying on print stylesheets — it's the only approach
that works reliably on iOS), the week archive with history browsing and auto-fill of last week's
record, finalize-and-lock, and a connection diagnostics screen that shows the actual error and a
test button. *Done when:* I can print last week from my phone and hand it to staff.

## 6. Definition of done, overall

Nine out of ten Sundays I don't have to think about how the app works. It loads with my staff
already in it, it doesn't lose an edit, no button lies to me about what it did, and the printout is
readable at arm's length on a noticeboard. Build it in that spirit: fewer features, none of them
half-wired.
