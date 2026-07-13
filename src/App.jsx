import { useEffect, useMemo, useRef, useState } from 'react';
import {
  generateSchedule,
  computeViolations,
  computeGaps,
  violationKey,
  violationMessage,
  weekLoadFromSchedule,
  dayLabels,
  formatWeek,
  mondayOf,
  isMonday,
  nextMonday,
  DAY_NAMES,
} from './lib/scheduler';
import * as cloud from './lib/supabase';
import { auth } from './lib/auth';
import { seedStores, seedWorkers } from './lib/seed';
import CheckGrid from './components/CheckGrid';
import LockGrid from './components/LockGrid';
import ScheduleView from './components/ScheduleView';
import { DiagnosticsPanel, SaveSheet, PrintOverlay, ConfirmModal, UndoToast } from './components/Overlays';
import SettingsPage from './components/SettingsPanel';
import LoginForm from './components/LoginForm';

const WIZARD_STEPS = ['Start date', 'Preferences', 'Review & save'];

const emptyWizard = () => ({
  weekStart: nextMonday(),
  leaves: {},
  locks: {},
  schedule: null,
  splitTimes: {},
  lastWeekLoad: {},
  history: [],
  v0: null, // snapshot of the freshly generated schedule (version stack §6.3)
});

// A new week starts from each worker's permanent recurring pattern (Settings),
// copied once into that week's leaves/locks. From here on it's plain per-week
// state like anything typed into the wizard by hand — editing it for this one
// week never writes back to the worker's recurring_leaves/recurring_locks, so
// a weekly override can never touch the permanent pattern.
// worker-id-keyed lookup of a recurring_* field, for the wizard grids' visual marker.
const recurringByWorker = (workers, field) => Object.fromEntries(workers.map((w) => [w.id, w[field] || []]));

const recurringWizard = (workers) => {
  const base = emptyWizard();
  const leaves = {};
  const locks = {};
  for (const w of workers) {
    if (w.recurring_leaves && w.recurring_leaves.some((d) => d)) leaves[w.id] = [...w.recurring_leaves];
    if (w.recurring_locks && w.recurring_locks.some((d) => d != null)) locks[w.id] = [...w.recurring_locks];
  }
  return { ...base, leaves, locks };
};

const versionEntry = (schedule, splitTimes, leaves) => ({
  schedule,
  splitTimes,
  leaves,
  savedAt: new Date().toISOString(),
});

const sameVersion = (a, b) =>
  !!a &&
  !!b &&
  JSON.stringify([a.schedule, a.splitTimes, a.leaves]) === JSON.stringify([b.schedule, b.splitTimes, b.leaves]);

export default function App() {
  // 'boot' resolves to the most useful screen once data is in: current
  // schedule if one exists, otherwise the wizard, otherwise settings.
  const [route, setRoute] = useState('boot'); // boot | wizard | viewer | history | settings
  const [navOpen, setNavOpen] = useState(false);
  const [pendingNav, setPendingNav] = useState(null); // wizard exit guard: () => void

  // Without cloud keys the app is local-only — start from the default seed
  // setup instead of an empty one.
  const [stores, setStores] = useState(() => (cloud.enabled ? [] : seedStores()));
  const [workers, setWorkers] = useState(() => (cloud.enabled ? [] : seedWorkers()));
  const [weeksList, setWeeksList] = useState([]);
  const [loading, setLoading] = useState(cloud.enabled);
  const [cloudStatus, setCloudStatus] = useState(cloud.enabled ? 'idle' : 'off');
  const [overlay, setOverlay] = useState(null); // 'diag' | null
  const [printMode, setPrintMode] = useState(null);
  const [settingsPrompt, setSettingsPrompt] = useState(null);
  const [toast, setToast] = useState(null); // Tier-2 undo toast (§8): { message, undo }

  // Admin login (round 3) — only relevant when cloud is configured; local-only
  // mode never needs a session, so authChecked starts true and session stays
  // null forever in that mode.
  const [session, setSession] = useState(null);
  const [authChecked, setAuthChecked] = useState(!cloud.enabled);

  // Wizard state
  const [wStep, setWStep] = useState(0);
  const [wiz, setWiz] = useState(emptyWizard);
  const [prefTab, setPrefTab] = useState('leave'); // leave | lock
  const [genViolations, setGenViolations] = useState([]);
  const [showGenBox, setShowGenBox] = useState(false);
  const [genAttempts, setGenAttempts] = useState(0);
  const [editConflict, setEditConflict] = useState(null); // { prev, prevLeaves?, added: [violations] }
  const [generating, setGenerating] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [collisionAsk, setCollisionAsk] = useState(false); // §6.1 same-week warning

  // Viewer state — a saved week, editable (v4): version stack + Find Cover.
  const [viewing, setViewing] = useState(null);
  // { weekStart, leaves, locks, schedule, splitTimes, versions, idx, dirty, lastWeekLoad }
  const [viewConflict, setViewConflict] = useState(null); // { prev, prevLeaves, added }

  const setupReady = stores.length > 0 && workers.length > 0 && workers.length >= stores.length;
  const labels = useMemo(() => dayLabels(wiz.weekStart), [wiz.weekStart]);

  // Tracks the admin's session (sign-in, sign-out, token refresh). Fires once
  // immediately with the current session (or null) via the INITIAL_SESSION
  // event, then again on every subsequent auth change.
  useEffect(() => {
    if (!cloud.enabled || !auth) return;
    const { data: sub } = auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
      setAuthChecked(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!cloud.enabled) {
      // Local-only: land on the wizard (or settings if the seed is incomplete).
      startNewSchedule();
      return;
    }
    if (!authChecked || !session) return; // wait for sign-in before loading any data
    (async () => {
      try {
        let [{ stores: st, workers: wk }, weeks] = await Promise.all([cloud.loadSetup(), cloud.listWeeks()]);
        if (st.length === 0 && wk.length === 0) {
          // Fresh/empty database — populate the default seed setup once so the
          // admin doesn't have to enter it by hand (same data as the SQL seed).
          st = seedStores();
          wk = seedWorkers();
          await cloud.saveSetup(st, wk);
        }
        setStores(st);
        setWorkers(wk);
        setWeeksList(weeks);
        setCloudStatus('saved');
        // Land on the most useful screen (no Home page): current schedule
        // when one exists, else the wizard, else settings with guidance.
        if (weeks.length) {
          const ok = await openWeek(weeks[0].week_start, weeks);
          if (!ok) setRoute('settings');
        } else if (st.length > 0 && wk.length >= st.length) {
          setWiz(recurringWizard(wk));
          setWStep(0);
          setRoute('wizard');
        } else {
          setSettingsPrompt(
            st.length === 0
              ? 'Add your stores first, then add workers and link them to stores. After that you can create a schedule.'
              : 'Add your workers and link them to stores. After that you can create a schedule.'
          );
          setRoute('settings');
        }
      } catch (e) {
        console.error(e);
        setCloudStatus('error');
        setRoute('settings');
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authChecked, session]);

  // Settings edits now save on every interaction (blur/click), so saves are
  // serialized through a promise chain — saveSetup is delete-then-reinsert,
  // and two of those interleaving would corrupt the tables.
  const saveChain = useRef(Promise.resolve());
  function withSave(fn) {
    if (!cloud.enabled) return Promise.resolve();
    setCloudStatus('saving');
    saveChain.current = saveChain.current.then(async () => {
      try {
        await fn();
        setCloudStatus('saved');
      } catch (e) {
        console.error(e);
        setCloudStatus('error');
      }
    });
    return saveChain.current;
  }

  function showToast(message, undo) {
    setToast({ message, undo });
  }

  function go(nextRoute) {
    setRoute(nextRoute);
    setNavOpen(false);
    setPrintMode(null);
    if (nextRoute !== 'settings') setSettingsPrompt(null);
  }

  // Sidebar navigation runs through this guard: leaving the wizard past step 0
  // means unsaved progress, so confirm before discarding it.
  function guardNav(action) {
    if (route === 'wizard' && wStep > 0) {
      setNavOpen(false);
      setPendingNav(() => action);
    } else {
      action();
    }
  }

  // ---------- landing actions ----------

  function startNewSchedule() {
    if (!setupReady) {
      setSettingsPrompt(
        stores.length === 0
          ? 'Add your stores first, then add workers and link them to stores. After that you can create a schedule.'
          : workers.length === 0
            ? 'Add your workers and link them to stores. After that you can create a schedule.'
            : `You have ${workers.length} worker${workers.length === 1 ? '' : 's'} for ${stores.length} stores. You need at least as many workers as stores to build a schedule.`
      );
      go('settings');
      return;
    }
    setWiz(recurringWizard(workers));
    setWStep(0);
    setPrefTab('leave');
    setGenViolations([]);
    setShowGenBox(false);
    setGenAttempts(0);
    setEditConflict(null);
    setCollisionAsk(false);
    go('wizard');
  }

  async function openWeek(weekStart, list = weeksList) {
    if (!cloud.enabled) return false;
    try {
      const data = await cloud.loadWeek(weekStart);
      if (data) {
        // Streak context for edits: the week immediately before this one.
        let lastWeekLoad = {};
        const prior = list.find((w) => w.week_start < weekStart);
        if (prior) {
          try {
            const pdata = await cloud.loadWeek(prior.week_start);
            if (pdata) lastWeekLoad = weekLoadFromSchedule(pdata.schedule);
          } catch (e) {
            console.error(e);
          }
        }
        const versions = (data.versions || []).length
          ? data.versions
          : [versionEntry(data.schedule, data.splitTimes, data.leaves)];
        setViewing({
          weekStart,
          leaves: data.leaves,
          locks: data.locks || {},
          schedule: data.schedule,
          splitTimes: data.splitTimes || {},
          versions,
          idx: versions.length - 1,
          dirty: false,
          lastWeekLoad,
        });
        setViewConflict(null);
        go('viewer');
        return true;
      }
      return false;
    } catch (e) {
      console.error(e);
      setCloudStatus('error');
      return false;
    }
  }

  function viewCurrent() {
    if (weeksList.length) openWeek(weeksList[0].week_start);
    else if (viewing) go('viewer');
  }

  // ---------- wizard: preferences ----------

  function setLeaves(next) {
    // Tier 2 (§8): clearing a leave request gets an undo toast.
    const prevLeaves = wiz.leaves;
    for (const [wid, days] of Object.entries(prevLeaves)) {
      (days || []).forEach((on, d) => {
        if (on && !(next[wid] && next[wid][d])) {
          const worker = workers.find((x) => String(x.id) === String(wid));
          if (worker) {
            showToast(`Cleared ${worker.name}'s leave request (${DAY_NAMES[d]})`, () =>
              setWiz((cur) => ({ ...cur, leaves: prevLeaves }))
            );
          }
        }
      });
    }
    setWiz((w) => {
      // A leave and a lock on the same cell contradict each other — leave wins here.
      const locks = { ...w.locks };
      for (const [wid, days] of Object.entries(next)) {
        if (!locks[wid]) continue;
        const row = [...locks[wid]];
        let changed = false;
        (days || []).forEach((on, d) => {
          if (on && row[d] != null) {
            row[d] = null;
            changed = true;
          }
        });
        if (changed) locks[wid] = row;
      }
      return { ...w, leaves: next, locks };
    });
  }

  function setLock(workerId, dayIdx, storeId) {
    // Tier 2 (§8): removing a lock gets an undo toast.
    const prevLocks = wiz.locks;
    const prevVal = prevLocks[workerId] ? prevLocks[workerId][dayIdx] : null;
    if (storeId == null && prevVal != null) {
      const worker = workers.find((x) => String(x.id) === String(workerId));
      if (worker) {
        showToast(`Removed ${worker.name}'s lock (${DAY_NAMES[dayIdx]})`, () =>
          setWiz((cur) => ({ ...cur, locks: prevLocks }))
        );
      }
    }
    setWiz((w) => {
      const locks = { ...w.locks };
      const row = [...(locks[workerId] || [null, null, null, null, null, null, null])];
      row[dayIdx] = storeId;
      locks[workerId] = row;
      const leaves = { ...w.leaves };
      if (storeId != null && leaves[workerId] && leaves[workerId][dayIdx]) {
        const lrow = [...leaves[workerId]];
        lrow[dayIdx] = false; // a lock overrides a leave request on the same day
        leaves[workerId] = lrow;
      }
      return { ...w, locks, leaves };
    });
  }

  // ---------- wizard: generation ----------

  // §6.1: schedule identity is the calendar week — starting the wizard on an
  // existing week warns before anything is generated.
  function nextFromDate() {
    if (weeksList.some((w) => w.week_start === wiz.weekStart)) {
      setCollisionAsk(true);
      return;
    }
    setWStep(1);
  }

  async function generate() {
    setGenerating(true);
    try {
      let load = {};
      const history = [];
      if (cloud.enabled) {
        // Up to the last 2 saved weeks before this one: streak tail from the
        // nearest, off-day history (P9) needs both.
        const prior = weeksList.filter((w) => w.week_start < wiz.weekStart).slice(0, 2);
        for (const p of prior) {
          try {
            const data = await cloud.loadWeek(p.week_start);
            if (data) {
              history.push(data.schedule);
              if (!Object.keys(load).length) load = weekLoadFromSchedule(data.schedule);
            }
          } catch (e) {
            console.error('Could not load prior week:', e);
          }
        }
      }
      // generateSchedule returns the splitTimes it was built on — time-range
      // leaves/locks seed changeover overrides, so display must match.
      const { schedule, violations, splitTimes } = generateSchedule({
        stores,
        workers,
        leaves: wiz.leaves,
        locks: wiz.locks,
        lastWeekLoad: load,
        history,
      });
      setWiz((w) => ({
        ...w,
        schedule,
        lastWeekLoad: load,
        history,
        splitTimes,
        v0: versionEntry(schedule, splitTimes, w.leaves),
      }));
      setGenViolations(violations);
      setShowGenBox(violations.length > 0);
      setGenAttempts((n) => n + 1);
      setEditConflict(null);
      setWStep(2);
    } finally {
      setGenerating(false);
    }
  }

  // Generation is deterministic, so re-running it with unchanged inputs always
  // reproduces v0 — the only real effect is discarding manual edits. The
  // button says exactly that ("Reset to generated") and is disabled while the
  // schedule is still pristine.
  function resetToGenerated() {
    const { schedule, violations, splitTimes } = generateSchedule({
      stores,
      workers,
      leaves: wiz.leaves,
      locks: wiz.locks,
      lastWeekLoad: wiz.lastWeekLoad,
      history: wiz.history,
    });
    setWiz((w) => ({ ...w, schedule, splitTimes, v0: versionEntry(schedule, splitTimes, w.leaves) }));
    setGenViolations(violations);
    setShowGenBox(violations.length > 0);
    setEditConflict(null);
  }

  const wizPristine =
    wiz.v0 && wiz.schedule
      ? sameVersion(wiz.v0, versionEntry(wiz.schedule, wiz.splitTimes, wiz.leaves))
      : true;

  // ---------- wizard: manual edits ----------
  // Manual edits are never blocked. New P1–P5 violations warn + confirm;
  // P6–P9 breaks go through silently (they're simply not checked here).

  function editSchedule(next) {
    const ctx = { stores, workers, locks: wiz.locks, leaves: wiz.leaves, splitTimes: wiz.splitTimes };
    const beforeKeys = new Set(computeViolations(wiz.schedule, ctx).map(violationKey));
    const added = computeViolations(next, ctx).filter((v) => !beforeKeys.has(violationKey(v)));
    if (added.length) setEditConflict({ prev: wiz.schedule, added });
    setWiz((w) => ({ ...w, schedule: next }));
  }

  // ---------- save (wizard) ----------

  const openSlots = wiz.schedule ? computeGaps(wiz.schedule, stores, workers).length : 0;

  async function doSave() {
    setSaving(true);
    try {
      // §6.3: v0 = the freshly generated schedule; this save is the next version.
      const current = versionEntry(wiz.schedule, wiz.splitTimes, wiz.leaves);
      const versions = (wiz.v0 && !sameVersion(wiz.v0, current) ? [wiz.v0, current] : [current]).slice(
        -cloud.MAX_VERSIONS
      );
      if (cloud.enabled) {
        setCloudStatus('saving');
        await cloud.saveWeek(wiz.weekStart, {
          leaves: wiz.leaves,
          locks: wiz.locks,
          schedule: wiz.schedule,
          splitTimes: wiz.splitTimes,
          versions,
        });
        setWeeksList(await cloud.listWeeks());
        setCloudStatus('saved');
      }
      setSaveOpen(false);
      setViewing({
        weekStart: wiz.weekStart,
        leaves: wiz.leaves,
        locks: wiz.locks,
        schedule: wiz.schedule,
        splitTimes: wiz.splitTimes,
        versions,
        idx: versions.length - 1,
        dirty: false,
        lastWeekLoad: wiz.lastWeekLoad,
      });
      setViewConflict(null);
      go('viewer');
    } catch (e) {
      console.error(e);
      setCloudStatus('error');
    } finally {
      setSaving(false);
    }
  }

  function handleSaveSettings(newStores, newWorkers) {
    setStores(newStores);
    setWorkers(newWorkers);
    withSave(() => cloud.saveSetup(newStores, newWorkers));
  }

  // ---------- viewer: versions, edits, Find Cover ----------

  function gotoVersion(idx) {
    setViewing((v) => {
      const entry = v.versions[idx];
      if (!entry) return v;
      return {
        ...v,
        idx,
        schedule: entry.schedule,
        splitTimes: entry.splitTimes || {},
        leaves: entry.leaves || v.leaves,
        dirty: false,
      };
    });
    setViewConflict(null);
  }

  function viewerEdit(next, { leaves: nextLeaves } = {}) {
    setViewing((v) => {
      const ctx = { stores, workers, locks: v.locks, leaves: v.leaves, splitTimes: v.splitTimes };
      const beforeKeys = new Set(computeViolations(v.schedule, ctx).map(violationKey));
      const added = computeViolations(next, { ...ctx, leaves: nextLeaves || v.leaves }).filter(
        (x) => !beforeKeys.has(violationKey(x))
      );
      if (added.length) setViewConflict({ prev: v.schedule, prevLeaves: v.leaves, added });
      return { ...v, schedule: next, leaves: nextLeaves || v.leaves, dirty: true };
    });
  }

  async function saveViewer(view) {
    const v = view || viewing;
    if (!v) return;
    // Linear history (§6.3): saving from an earlier version discards everything
    // after it; the stack is capped at 5, oldest dropped on overflow.
    const current = versionEntry(v.schedule, v.splitTimes, v.leaves);
    let versions = v.versions.slice(0, v.idx + 1);
    if (!sameVersion(versions[versions.length - 1], current)) versions = versions.concat([current]);
    versions = versions.slice(-cloud.MAX_VERSIONS);
    setViewing({ ...v, versions, idx: versions.length - 1, dirty: false });
    setViewConflict(null);
    await withSave(async () => {
      await cloud.saveWeek(v.weekStart, {
        leaves: v.leaves,
        locks: v.locks,
        schedule: v.schedule,
        splitTimes: v.splitTimes,
        versions,
      });
      setWeeksList(await cloud.listWeeks());
    });
  }

  // Find Cover direct/chain apply (§7): swap in, record leave, re-check.
  // Applies as an UNSAVED edit like any manual change — a version is minted
  // only by an explicit Save, so any number of cover swaps, reassignments and
  // split edits batch into one new version when the admin saves.
  function applyCover({ schedule: nextSched, leaves: nextLeaves, description }) {
    const v = viewing;
    const ctx = { stores, workers, locks: v.locks, leaves: v.leaves, splitTimes: v.splitTimes };
    const beforeKeys = new Set(computeViolations(v.schedule, ctx).map(violationKey));
    const added = computeViolations(nextSched, { ...ctx, leaves: nextLeaves }).filter(
      (x) => !beforeKeys.has(violationKey(x))
    );
    setViewing({ ...v, schedule: nextSched, leaves: nextLeaves, dirty: true });
    if (added.length) {
      // P1–P5 break → warn + confirm before it lands (P6–P9 never get here).
      setViewConflict({ prev: v.schedule, prevLeaves: v.leaves, added });
    } else {
      showToast(`Applied: ${description} — save to publish`);
    }
  }

  const previewingOld = viewing && viewing.idx < viewing.versions.length - 1;

  // ---------- render ----------

  const badge = {
    off: ['badge-off', 'Local only'],
    idle: ['badge-idle', 'Cloud ready'],
    saving: ['badge-saving', 'Saving…'],
    saved: ['badge-saved', 'Saved'],
    error: ['badge-error', 'Cloud error'],
  }[cloudStatus];

  const currentWeekStart = weeksList.length ? weeksList[0].week_start : null;
  const isViewingCurrent = viewing && (currentWeekStart == null || viewing.weekStart === currentWeekStart);
  const olderWeeks = weeksList.slice(1);

  const navItems = [
    { id: 'wizard', label: 'New schedule', icon: '📅', onClick: startNewSchedule, active: route === 'wizard' },
    {
      id: 'current',
      label: 'Current schedule',
      icon: '🗂',
      onClick: viewCurrent,
      disabled: !weeksList.length && !viewing,
      active: route === 'viewer' && isViewingCurrent,
    },
    {
      id: 'history',
      label: 'History',
      icon: '🕘',
      onClick: () => go('history'),
      disabled: olderWeeks.length === 0,
      active: route === 'history' || (route === 'viewer' && !!viewing && !isViewingCurrent),
    },
    { id: 'settings', label: 'Settings', icon: '⚙️', onClick: () => go('settings'), active: route === 'settings' },
  ];

  return (
    <>
      <div className="app shell">
        <header className="topbar mobile-only">
          <button type="button" className="nav-burger" aria-label="Menu" onClick={() => setNavOpen(!navOpen)}>
            ☰
          </button>
          <div className="brand">
            <span className="brand-mark">SHIFT</span>
            <span className="brand-sub">BOARD</span>
          </div>
        </header>

        {navOpen && <div className="nav-backdrop mobile-only" onClick={() => setNavOpen(false)} />}

        <aside className={`sidebar ${navOpen ? 'open' : ''}`}>
          <div className="brand sidebar-brand">
            <span className="brand-mark">SHIFT</span>
            <span className="brand-sub">BOARD</span>
          </div>
          <nav className="sidenav" aria-label="Main">
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`sidenav-item ${item.active ? 'active' : ''}`}
                disabled={item.disabled}
                onClick={() => guardNav(item.onClick)}
              >
                <span className="sidenav-icon" aria-hidden>{item.icon}</span>
                {item.label}
              </button>
            ))}
          </nav>
          <div className="sidebar-foot">
            <button
              type="button"
              className={`badge ${badge[0]}`}
              onClick={() => cloud.enabled && setOverlay('diag')}
              title="Cloud connection details"
            >
              {badge[1]}
            </button>
          </div>
        </aside>

        <main className="main">
          {cloud.enabled && authChecked && !session ? (
            <LoginForm onSignedIn={setSession} />
          ) : loading || route === 'boot' ? (
            <div className="panel">
              <p className="hint">Loading your saved setup…</p>
            </div>
          ) : (
            <>
              {route === 'history' && (
                <div className="settings-page">
                  <h1 className="page-title">History</h1>
                  <p className="hint">
                    The two weeks before the current schedule. Saving a new week drops the oldest.
                  </p>
                  {olderWeeks.length === 0 ? (
                    <div className="panel">
                      <p className="hint">No older weeks yet — history fills in as you save more schedules.</p>
                    </div>
                  ) : (
                    <ul className="picker">
                      {olderWeeks.map((w) => (
                        <li key={w.week_start}>
                          <button type="button" className="pick pick-row" onClick={() => openWeek(w.week_start)}>
                            <span className="pick-name">Week of {formatWeek(w.week_start)}</span>
                            <span className="pick-status">view</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {route === 'settings' && (
                <SettingsPage
                  stores={stores}
                  workers={workers}
                  prompt={settingsPrompt}
                  onSave={handleSaveSettings}
                  onToast={showToast}
                />
              )}

              {route === 'viewer' && viewing && printMode && (
                <PrintOverlay
                  mode={printMode}
                  weekStart={viewing.weekStart}
                  stores={stores}
                  workers={workers}
                  schedule={viewing.schedule || {}}
                  labels={dayLabels(viewing.weekStart)}
                  splitTimes={viewing.splitTimes || {}}
                  onClose={() => setPrintMode(null)}
                />
              )}

              {route === 'viewer' && viewing && !printMode && (
                <>
                  <div className="week-stamp-bar">
                    Week of {formatWeek(viewing.weekStart)} —{' '}
                    {viewing.dirty ? 'edited (unsaved)' : previewingOld ? 'previewing' : 'saved'}
                  </div>

                  {previewingOld && !viewing.dirty && (
                    <div className="banner banner-bad">
                      Previewing version v{viewing.idx} — the published schedule is v{viewing.versions.length - 1}.
                      Saving makes this version live and discards the later ones.
                    </div>
                  )}

                  {viewConflict && (
                    <ViolationBox
                      title="This change breaks a protected rule (P1–P5)"
                      violations={viewConflict.added}
                      stores={stores}
                      workers={workers}
                      actions={[
                        {
                          label: 'Keep my change',
                          onClick: () => setViewConflict(null),
                        },
                        {
                          label: 'Undo the change',
                          ghost: true,
                          onClick: () => {
                            setViewing((v) => ({
                              ...v,
                              schedule: viewConflict.prev,
                              leaves: viewConflict.prevLeaves || v.leaves,
                            }));
                            setViewConflict(null);
                          },
                        },
                      ]}
                    />
                  )}

                  <ScheduleView
                    stores={stores}
                    workers={workers}
                    schedule={viewing.schedule}
                    leaves={viewing.leaves}
                    locks={viewing.locks || {}}
                    lastWeekLoad={viewing.lastWeekLoad || {}}
                    labels={dayLabels(viewing.weekStart)}
                    splitTimes={viewing.splitTimes || {}}
                    saved
                    onChange={viewerEdit}
                    onSplitTimesChange={(st) => setViewing((v) => ({ ...v, splitTimes: st, dirty: true }))}
                    onCoverApply={applyCover}
                    onToast={showToast}
                  />
                  <div className="actions viewer-actions">
                    {viewing.versions.length > 1 && (
                      <span className="version-nav" aria-label="Schedule versions">
                        <button
                          type="button"
                          className="version-arrow"
                          aria-label="Earlier version"
                          disabled={viewing.idx === 0}
                          onClick={() => gotoVersion(viewing.idx - 1)}
                        >
                          ◄
                        </button>
                        <span className="version-label">
                          v{viewing.idx} of v{viewing.versions.length - 1}
                        </span>
                        <button
                          type="button"
                          className="version-arrow"
                          aria-label="Later version"
                          disabled={viewing.idx >= viewing.versions.length - 1}
                          onClick={() => gotoVersion(viewing.idx + 1)}
                        >
                          ►
                        </button>
                      </span>
                    )}
                    <button type="button" className="btn" onClick={() => setPrintMode('worker')}>
                      Print by worker
                    </button>
                    <button type="button" className="btn" onClick={() => setPrintMode('store')}>
                      Print by store
                    </button>
                    {(viewing.dirty || previewingOld) && (
                      <button type="button" className="btn btn-primary" onClick={() => saveViewer()}>
                        {viewing.dirty ? '✓ Save changes' : `✓ Publish v${viewing.idx}`}
                      </button>
                    )}
                  </div>
                </>
              )}

              {route === 'wizard' && (
                <>
                  <div className="week-stamp-bar">Week of {formatWeek(wiz.weekStart)}</div>
                  <nav className="steps" aria-label="Progress">
                    {WIZARD_STEPS.map((s, i) => (
                      <button
                        key={s}
                        type="button"
                        className={`step ${i === wStep ? 'current' : ''} ${i < wStep ? 'done' : ''}`}
                        onClick={() => i < wStep && setWStep(i)}
                        disabled={i > wStep}
                      >
                        <span className="step-n">{i + 1}</span>
                        <span className="step-label">{s}</span>
                      </button>
                    ))}
                  </nav>

                  {wStep === 0 && (
                    <div className="panel">
                      <h2>Pick the start date</h2>
                      <p className="hint">Schedules always run Monday to Sunday.</p>
                      <div className="field">
                        <label>
                          <span>Week starting (Monday)</span>
                          <input
                            type="date"
                            value={wiz.weekStart}
                            onChange={(e) => {
                              const v = e.target.value;
                              if (!v) return;
                              setWiz((w) => ({ ...w, weekStart: isMonday(v) ? v : mondayOf(v) }));
                            }}
                          />
                          <small>
                            Building the week of {formatWeek(wiz.weekStart)}. Picking any other day snaps to that
                            week&rsquo;s Monday.
                          </small>
                        </label>
                      </div>
                      <div className="actions">
                        {(weeksList.length > 0 || viewing) && (
                          <button type="button" className="btn btn-ghost" onClick={viewCurrent}>
                            Cancel
                          </button>
                        )}
                        <button type="button" className="btn btn-primary" onClick={nextFromDate}>
                          Next
                        </button>
                      </div>
                    </div>
                  )}

                  {wStep === 1 && (
                    <div className="panel">
                      <h2>Preferences</h2>
                      <p className="hint">
                        Leave = days someone can&rsquo;t work. Lock = days someone is guaranteed at a specific store.
                      </p>
                      <div className="view-toggle pref-toggle" role="tablist" aria-label="Preference type">
                        <button
                          type="button"
                          role="tab"
                          aria-selected={prefTab === 'leave'}
                          className={prefTab === 'leave' ? 'active' : ''}
                          onClick={() => setPrefTab('leave')}
                        >
                          Leave requests
                        </button>
                        <button
                          type="button"
                          role="tab"
                          aria-selected={prefTab === 'lock'}
                          className={prefTab === 'lock' ? 'active' : ''}
                          onClick={() => setPrefTab('lock')}
                        >
                          Locks
                        </button>
                      </div>

                      {prefTab === 'leave' ? (
                        <CheckGrid
                          workers={workers}
                          labels={labels}
                          value={wiz.leaves}
                          onChange={setLeaves}
                          tone="leave"
                          recurringLeaves={recurringByWorker(workers, 'recurring_leaves')}
                        />
                      ) : (
                        <LockGrid
                          workers={workers}
                          stores={stores}
                          labels={labels}
                          locks={wiz.locks}
                          onSet={setLock}
                          recurringLocks={recurringByWorker(workers, 'recurring_locks')}
                        />
                      )}

                      <div className="actions">
                        <button type="button" className="btn btn-ghost" onClick={() => setWStep(0)}>
                          Back
                        </button>
                        <button type="button" className="btn btn-primary" onClick={generate} disabled={generating}>
                          {generating ? 'Generating…' : 'Generate schedule'}
                        </button>
                      </div>
                    </div>
                  )}

                  {wStep === 2 && wiz.schedule && (
                    <>
                      {showGenBox && (
                        <ViolationBox
                          title="The generator couldn't satisfy everything"
                          violations={genViolations}
                          stores={stores}
                          workers={workers}
                          exhausted={genAttempts >= 3}
                          actions={[
                            { label: 'Continue anyway', onClick: () => setShowGenBox(false) },
                            {
                              label: 'Go back & adjust preferences',
                              ghost: true,
                              onClick: () => {
                                setShowGenBox(false);
                                setWStep(1);
                              },
                            },
                          ]}
                        />
                      )}

                      {editConflict && (
                        <ViolationBox
                          title="This edit breaks a protected rule (P1–P5)"
                          violations={editConflict.added}
                          stores={stores}
                          workers={workers}
                          actions={[
                            { label: 'Keep my change', onClick: () => setEditConflict(null) },
                            {
                              label: 'Undo the change',
                              ghost: true,
                              onClick: () => {
                                setWiz((w) => ({ ...w, schedule: editConflict.prev }));
                                setEditConflict(null);
                              },
                            },
                          ]}
                        />
                      )}

                      <ScheduleView
                        stores={stores}
                        workers={workers}
                        schedule={wiz.schedule}
                        leaves={wiz.leaves}
                        locks={wiz.locks}
                        lastWeekLoad={wiz.lastWeekLoad}
                        labels={labels}
                        splitTimes={wiz.splitTimes}
                        readOnly={false}
                        onChange={editSchedule}
                        onSplitTimesChange={(st) => setWiz((w) => ({ ...w, splitTimes: st }))}
                        onToast={showToast}
                      />

                      <div className="actions">
                        <button type="button" className="btn btn-ghost" onClick={() => setWStep(1)}>
                          Back
                        </button>
                        <button
                          type="button"
                          className="btn"
                          disabled={wizPristine}
                          title={
                            wizPristine
                              ? 'No manual edits to discard — this is the generated schedule'
                              : 'Discard your manual edits and restore the auto-generated schedule'
                          }
                          onClick={resetToGenerated}
                        >
                          ↺ Reset to generated
                        </button>
                        <button type="button" className="btn btn-primary" onClick={() => setSaveOpen(true)}>
                          ✓ Save schedule
                        </button>
                      </div>
                    </>
                  )}
                </>
              )}
            </>
          )}
        </main>

        {overlay === 'diag' && (
          <DiagnosticsPanel
            status={cloudStatus}
            diag={cloud.diagnostics()}
            lastError={cloud.getLastError()}
            onTest={cloud.testConnection}
            onClose={() => setOverlay(null)}
          />
        )}

        {pendingNav && (
          <ConfirmModal
            title="Discard this schedule draft?"
            body={`Your unsaved progress on the week of ${formatWeek(wiz.weekStart)} will be lost.`}
            confirmLabel="Discard draft"
            onCancel={() => setPendingNav(null)}
            onConfirm={() => {
              const action = pendingNav;
              setPendingNav(null);
              action();
            }}
          />
        )}

        {collisionAsk && (
          <ConfirmModal
            title="A schedule already exists for this week"
            body={`The week of ${formatWeek(wiz.weekStart)} already has a saved schedule — generating a new one will replace it.`}
            confirmLabel="Replace it"
            onCancel={() => setCollisionAsk(false)}
            onConfirm={() => {
              setCollisionAsk(false);
              setWStep(1);
            }}
          />
        )}

        {saveOpen && (
          <SaveSheet
            weekStart={wiz.weekStart}
            openSlots={openSlots}
            saving={saving}
            onSave={doSave}
            onCancel={() => setSaveOpen(false)}
          />
        )}

        <UndoToast
          toast={toast}
          onUndo={() => {
            if (toast && toast.undo) toast.undo();
            setToast(null);
          }}
          onExpire={() => setToast(null)}
        />
      </div>
    </>
  );
}

function ViolationBox({ title, violations, stores, workers, exhausted, actions }) {
  return (
    <div className="violation-box" role="alert">
      <h3 className="violation-title">⚠ {title}</h3>
      <ul className="violation-list">
        {violations.map((v) => (
          <li key={violationKey(v)}>{violationMessage(v, stores, workers)}</li>
        ))}
      </ul>
      {exhausted && (
        <p className="violation-final">
          No valid schedule exists with the current stores, links, locks and leave requests — something has to give.
          Consider adding workers, extra store links, or removing a lock or leave day.
        </p>
      )}
      <div className="violation-actions">
        {actions.map((a) => (
          <button key={a.label} type="button" className={`btn ${a.ghost ? 'btn-ghost' : 'btn-primary'}`} onClick={a.onClick}>
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}
