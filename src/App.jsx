import { useEffect, useMemo, useState } from 'react';
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
import { seedStores, seedWorkers } from './lib/seed';
import CheckGrid from './components/CheckGrid';
import LockGrid from './components/LockGrid';
import ScheduleView from './components/ScheduleView';
import { DiagnosticsPanel, SaveSheet, PrintOverlay, ConfirmModal, UndoToast } from './components/Overlays';
import SettingsPage from './components/SettingsPanel';

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
  const [route, setRoute] = useState('home'); // home | wizard | viewer | settings
  const [navOpen, setNavOpen] = useState(false);

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
  const [viewConflict, setViewConflict] = useState(null); // { prev, prevLeaves, added, thenSave }

  const setupReady = stores.length > 0 && workers.length > 0 && workers.length >= stores.length;
  const labels = useMemo(() => dayLabels(wiz.weekStart), [wiz.weekStart]);

  useEffect(() => {
    if (!cloud.enabled) return;
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
      } catch (e) {
        console.error(e);
        setCloudStatus('error');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function withSave(fn) {
    if (!cloud.enabled) return;
    setCloudStatus('saving');
    try {
      await fn();
      setCloudStatus('saved');
    } catch (e) {
      console.error(e);
      setCloudStatus('error');
    }
  }

  function showToast(message, undo) {
    setToast({ message, undo });
  }

  function go(nextRoute) {
    setRoute(nextRoute);
    setNavOpen(false);
    if (nextRoute !== 'settings') setSettingsPrompt(null);
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
    setWiz(emptyWizard());
    setWStep(0);
    setPrefTab('leave');
    setGenViolations([]);
    setShowGenBox(false);
    setGenAttempts(0);
    setEditConflict(null);
    setCollisionAsk(false);
    go('wizard');
  }

  async function openWeek(weekStart) {
    if (!cloud.enabled) return;
    try {
      const data = await cloud.loadWeek(weekStart);
      if (data) {
        // Streak context for edits: the week immediately before this one.
        let lastWeekLoad = {};
        const prior = weeksList.find((w) => w.week_start < weekStart);
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
      }
    } catch (e) {
      console.error(e);
      setCloudStatus('error');
    }
  }

  function viewLast() {
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
      const { schedule, violations } = generateSchedule({
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
        splitTimes: {},
        v0: versionEntry(schedule, {}, w.leaves),
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

  function regenerate() {
    const { schedule, violations } = generateSchedule({
      stores,
      workers,
      leaves: wiz.leaves,
      locks: wiz.locks,
      lastWeekLoad: wiz.lastWeekLoad,
      history: wiz.history,
    });
    setWiz((w) => ({ ...w, schedule, splitTimes: {}, v0: versionEntry(schedule, {}, w.leaves) }));
    setGenViolations(violations);
    setShowGenBox(violations.length > 0);
    setGenAttempts((n) => n + 1);
    setEditConflict(null);
  }

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

  // Find Cover direct/chain apply (§7): swap in, record leave, re-check, re-save.
  function applyCover({ schedule: nextSched, leaves: nextLeaves, description }) {
    const v = viewing;
    const ctx = { stores, workers, locks: v.locks, leaves: v.leaves, splitTimes: v.splitTimes };
    const beforeKeys = new Set(computeViolations(v.schedule, ctx).map(violationKey));
    const added = computeViolations(nextSched, { ...ctx, leaves: nextLeaves }).filter(
      (x) => !beforeKeys.has(violationKey(x))
    );
    const nextView = { ...v, schedule: nextSched, leaves: nextLeaves, dirty: true };
    setViewing(nextView);
    if (added.length) {
      // P1–P5 break → warn + confirm before it lands (P6–P9 never get here).
      setViewConflict({ prev: v.schedule, prevLeaves: v.leaves, added, thenSave: true });
    } else {
      showToast(`Applied: ${description}`);
      saveViewer(nextView);
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

  const navItems = [
    { id: 'home', label: 'Home', icon: '🏠' },
    { id: 'wizard', label: 'New schedule', icon: '📅', onClick: startNewSchedule },
    { id: 'viewer', label: 'Last schedule', icon: '🗂', onClick: viewLast, disabled: !weeksList.length && !viewing },
    { id: 'settings', label: 'Settings', icon: '⚙️' },
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
                className={`sidenav-item ${route === item.id ? 'active' : ''}`}
                disabled={item.disabled}
                onClick={() => (item.onClick ? item.onClick() : go(item.id))}
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
          {loading ? (
            <div className="panel">
              <p className="hint">Loading your saved setup…</p>
            </div>
          ) : (
            <>
              {route === 'home' && (
                <div className="home">
                  <h1 className="home-title">What would you like to do?</h1>
                  <div className="home-cards">
                    <button
                      type="button"
                      className="home-card"
                      disabled={!weeksList.length && !viewing}
                      onClick={viewLast}
                    >
                      <span className="home-card-icon" aria-hidden>🗂</span>
                      <span className="home-card-title">View last generated schedule</span>
                      <span className="home-card-sub">
                        {weeksList.length
                          ? `Week of ${formatWeek(weeksList[0].week_start)}`
                          : 'Nothing saved yet'}
                      </span>
                    </button>
                    <button type="button" className="home-card home-card-primary" onClick={startNewSchedule}>
                      <span className="home-card-icon" aria-hidden>✏️</span>
                      <span className="home-card-title">Create new schedule</span>
                      <span className="home-card-sub">
                        {setupReady
                          ? 'Pick a week, set leave & locks, review, save'
                          : 'Set up stores & workers first — we’ll take you there'}
                      </span>
                    </button>
                  </div>
                </div>
              )}

              {route === 'settings' && (
                <SettingsPage
                  stores={stores}
                  workers={workers}
                  prompt={settingsPrompt}
                  weeksList={weeksList}
                  onOpenWeek={openWeek}
                  onSave={handleSaveSettings}
                  onToast={showToast}
                />
              )}

              {route === 'viewer' && viewing && (
                <>
                  <div className="week-stamp-bar viewer-stamp">
                    <span>
                      Week of {formatWeek(viewing.weekStart)} —{' '}
                      {viewing.dirty ? 'edited (unsaved)' : previewingOld ? 'previewing' : 'saved'}
                    </span>
                    <span className="version-nav">
                      {viewing.idx > 0 && (
                        <button
                          type="button"
                          className="version-arrow"
                          aria-label="Earlier version"
                          onClick={() => gotoVersion(viewing.idx - 1)}
                        >
                          ◄
                        </button>
                      )}
                      <span className="version-label">v{viewing.idx}</span>
                      {viewing.idx < viewing.versions.length - 1 && (
                        <button
                          type="button"
                          className="version-arrow"
                          aria-label="Later version"
                          onClick={() => gotoVersion(viewing.idx + 1)}
                        >
                          ►
                        </button>
                      )}
                    </span>
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
                          label: viewConflict.thenSave ? 'Apply anyway & save' : 'Keep my change',
                          onClick: () => {
                            const willSave = viewConflict.thenSave;
                            setViewConflict(null);
                            if (willSave) saveViewer();
                          },
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
                  <div className="actions">
                    <button type="button" className="btn btn-ghost" onClick={() => go('home')}>
                      Back to home
                    </button>
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
                        <button type="button" className="btn btn-ghost" onClick={() => go('home')}>
                          Cancel
                        </button>
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
                        <CheckGrid workers={workers} labels={labels} value={wiz.leaves} onChange={setLeaves} tone="leave" />
                      ) : (
                        <LockGrid
                          workers={workers}
                          stores={stores}
                          labels={labels}
                          locks={wiz.locks}
                          onSet={setLock}
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
                        <button type="button" className="btn" onClick={regenerate}>
                          Regenerate
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

      {printMode && viewing && (
        <PrintOverlay
          mode={printMode}
          weekStart={viewing.weekStart}
          stores={stores}
          workers={workers}
          schedule={viewing.schedule || {}}
          leaves={viewing.leaves || {}}
          labels={dayLabels(viewing.weekStart)}
          onClose={() => setPrintMode(null)}
        />
      )}
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
