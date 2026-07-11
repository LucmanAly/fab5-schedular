# Graph Report - .  (2026-07-10)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 130 nodes · 325 edges · 8 communities
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 4 edges (avg confidence: 0.5)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `1a113f30`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- scheduler.js
- App.jsx
- package.json
- ScheduleView.jsx
- Overlays.jsx
- supabase.js
- supabase-setup.sql

## God Nodes (most connected - your core abstractions)
1. `findCoverCandidates()` - 16 edges
2. `generateSchedule()` - 14 edges
3. `findChainSwaps()` - 13 edges
4. `computeViolations()` - 12 edges
5. `App()` - 10 edges
6. `ScheduleView()` - 10 edges
7. `EMPTY_WEEK()` - 10 edges
8. `CellEditor()` - 9 edges
9. `shiftTimeLabel()` - 9 edges
10. `formatWeek()` - 9 edges

## Surprising Connections (you probably didn't know these)
- `App()` --calls--> `computeGaps()`  [EXTRACTED]
  src/App.jsx → src/lib/scheduler.js
- `App()` --calls--> `formatWeek()`  [EXTRACTED]
  src/App.jsx → src/lib/scheduler.js
- `ViolationBox()` --calls--> `violationKey()`  [EXTRACTED]
  src/App.jsx → src/lib/scheduler.js
- `FindCover()` --calls--> `shiftTimeLabel()`  [EXTRACTED]
  src/components/FindCover.jsx → src/lib/scheduler.js
- `FindCover()` --calls--> `workerAtHalf()`  [EXTRACTED]
  src/components/FindCover.jsx → src/lib/scheduler.js

## Import Cycles
- None detected.

## Communities (8 total, 0 thin omitted)

### Community 0 - "scheduler.js"
Cohesion: 0.21
Nodes (23): FindCover(), cloneSchedule(), computeViolations(), dayIntervals(), daysWorked(), EMPTY_WEEK(), emptyDay(), findChainSwaps() (+15 more)

### Community 1 - "App.jsx"
Cohesion: 0.15
Nodes (17): App(), emptyWizard(), ViolationBox(), WIZARD_STEPS, CheckGrid(), LockGrid(), addDays(), dayLabels() (+9 more)

### Community 2 - "package.json"
Cohesion: 0.10
Nodes (19): dependencies, react, react-dom, devDependencies, vite, @vitejs/plugin-react, name, private (+11 more)

### Community 3 - "ScheduleView.jsx"
Cohesion: 0.23
Nodes (18): CellEditor(), ScheduleView(), computeGaps(), defaultSplitMin(), fmtMin(), fmtTime(), halfLabel(), HALVES (+10 more)

### Community 4 - "Overlays.jsx"
Cohesion: 0.18
Nodes (15): ConfirmModal(), daySummaryByStore(), daySummaryByWorker(), DiagnosticsPanel(), PrintOverlay(), SaveSheet(), UndoToast(), AddWorkerSheet() (+7 more)

### Community 5 - "supabase.js"
Cohesion: 0.30
Nodes (9): enabled, listWeeks(), loadSetup(), loadWeek(), pruneWeeks(), saveSetup(), saveWeek(), sb() (+1 more)

### Community 6 - "supabase-setup.sql"
Cohesion: 0.29
Nodes (6): leaves, locks, schedule, stores, weeks, workers

## Knowledge Gaps
- **22 isolated node(s):** `name`, `private`, `version`, `type`, `dev` (+17 more)
  These have ≤1 connection - possible missing edges or undocumented components.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `generateSchedule()` connect `scheduler.js` to `App.jsx`, `ScheduleView.jsx`?**
  _High betweenness centrality (0.020) - this node is a cross-community bridge._
- **Why does `computeViolations()` connect `scheduler.js` to `App.jsx`, `ScheduleView.jsx`?**
  _High betweenness centrality (0.015) - this node is a cross-community bridge._
- **Why does `ScheduleView()` connect `ScheduleView.jsx` to `scheduler.js`, `App.jsx`?**
  _High betweenness centrality (0.008) - this node is a cross-community bridge._
- **What connects `name`, `private`, `version` to the rest of the system?**
  _22 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `App.jsx` be split into smaller, more focused modules?**
  _Cohesion score 0.14855072463768115 - nodes in this community are weakly interconnected._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.1 - nodes in this community are weakly interconnected._