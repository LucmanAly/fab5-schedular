import { useEffect, useMemo, useState } from 'react';
import { generateSchedule, dayLabels, formatWeek, nextMonday, EMPTY_WEEK, worksOn } from './lib/scheduler';
import { compareWeeks } from './lib/scheduleDiff';
import * as cloud from './lib/supabase';
import { StepInit, StepConfigure } from './components/StepsSetup';
import CheckGrid from './components/CheckGrid';
import ScheduleView from './components/ScheduleView';
import { HistoryPanel, DiagnosticsPanel, FinalizePanel, PrintOverlay, LastWeekPanel } from './components/Overlays';

const STEPS = ['Set up', 'Names', 'Leave', 'Schedule'];

// Stores are resized here, but workers are never auto-created or auto-linked — that's
// done by hand in StepConfigure, since worker-store linkage is manual.
function resizeSetup(numStores, prevStores, prevWorkers) {
  const stores = Array.from({ length: numStores }, (_, i) => {
    const id = i + 1;
    return prevStores.find((s) => s.id === id) || { id, name: `Store ${id}` };
  });
  const validIds = new Set(stores.map((s) => s.id));
  const workers = prevWorkers.map((w) => ({ ...w, store_ids: (w.store_ids || []).filter((id) => validIds.has(id)) }));
  return { stores, workers };
}

export default function App() {
  const [step, setStep] = useState(0);
  const [cfg, setCfg] = useState({ numStores: 8, maxConsec: 3, splitTime: '14:00', weekStart: nextMonday() });
  const [stores, setStores] = useState([]);
  const [workers, setWorkers] = useState([]);
  const [lastWeek, setLastWeek] = useState({});
  const [lastWeekSource, setLastWeekSource] = useState(null);
  const [leaves, setLeaves] = useState({});
  const [schedule, setSchedule] = useState(null);
  const [archivedSchedule, setArchivedSchedule] = useState(null); // previous week's schedule for comparison
  const [predictability, setPredictability] = useState(null); // predictability score
  const [scheduleStatus, setScheduleStatus] = useState('draft'); // draft | finalized
  const [cloudStatus, setCloudStatus] = useState(cloud.enabled ? 'idle' : 'off');
  const [weeksList, setWeeksList] = useState([]);
  const [overlay, setOverlay] = useState(null); // 'history' | 'diag' | 'finalize'
  const [viewing, setViewing] = useState(null); // archived read-only week
  const [printMode, setPrintMode] = useState(null);
  const [loading, setLoading] = useState(cloud.enabled);
  const [finalizingWeek, setFinalizingWeek] = useState(false);

  const labels = useMemo(() => dayLabels(cfg.weekStart), [cfg.weekStart]);

  useEffect(() => {
    if (!cloud.enabled) return;
    (async () => {
      try {
        const [{ config, stores: st, workers: wk }, weeks] = await Promise.all([cloud.loadSetup(), cloud.listWeeks()]);
        if (config) {
          setCfg((c) => ({
            ...c,
            numStores: config.num_stores,
            maxConsec: config.max_consecutive,
            splitTime: config.split_time || '14:00',
          }));
        }
        if (st.length) setStores(st);
        if (wk.length) setWorkers(wk);
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

  const persistWeek = (patch = {}) =>
    withSave(async () => {
      await cloud.saveWeek(cfg.weekStart, {
        status: schedule || patch.schedule ? 'scheduled' : 'draft',
        lastWeek,
        leaves,
        schedule: schedule || {},
        ...patch,
      });
      setWeeksList(await cloud.listWeeks());
    });

  async function prefillLastWeek() {
    if (!cloud.enabled) return false;
    const prior = weeksList.find((w) => w.week_start < cfg.weekStart);
    if (!prior) return false;
    try {
      const data = await cloud.loadWeek(prior.week_start);
      if (!data) return false;
      const worked = {};
      workers.forEach((w) => {
        worked[w.id] = (data.schedule[w.id] || EMPTY_WEEK()).map((_, d) => worksOn(data.schedule[w.id], d));
      });
      setLastWeek(worked);
      setLastWeekSource(prior.week_start);
      // Store full schedule for predictability comparison
      setArchivedSchedule(data.schedule);
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  }

  function saveLastWeek() {
    setOverlay(null);
    persistWeek();
  }

  async function next() {
    if (step === 0) {
      const sized = resizeSetup(cfg.numStores, stores, workers);
      setStores(sized.stores);
      setWorkers(sized.workers);
      withSave(() => cloud.saveSetup(cfg, sized.stores, sized.workers));
      setStep(1);
    } else if (step === 1) {
      withSave(() => cloud.saveSetup(cfg, stores, workers));
      const found = await prefillLastWeek();
      if (!found) setOverlay('lastweek'); // no archived week to draw from — ask once, manually
      setStep(2);
    } else if (step === 2) {
      const fresh = generateSchedule({ stores, workers, leaves, lastWeekWorked: lastWeek, maxConsec: cfg.maxConsec });
      setSchedule(fresh);
      setScheduleStatus('draft');
      const pred = compareWeeks(archivedSchedule || {}, fresh, workers);
      setPredictability(pred);
      persistWeek({ schedule: fresh });
      setStep(3);
    }
  }

  function regenerate() {
    const fresh = generateSchedule({ stores, workers, leaves, lastWeekWorked: lastWeek, maxConsec: cfg.maxConsec });
    setSchedule(fresh);
    setScheduleStatus('draft');
    const pred = compareWeeks(archivedSchedule || {}, fresh, workers);
    setPredictability(pred);
    persistWeek({ schedule: fresh });
  }

  function editSchedule(nextSchedule) {
    setSchedule(nextSchedule);
    setScheduleStatus('draft'); // editing reverts to draft
    if (!cloud.enabled) return;
    setCloudStatus('saving');
    cloud
      .saveWeek(cfg.weekStart, { status: 'draft', lastWeek, leaves, schedule: nextSchedule })
      .then(() => setCloudStatus('saved'))
      .catch((e) => {
        console.error(e);
        setCloudStatus('error');
      });
  }

  async function openArchivedWeek(weekStart) {
    setOverlay(null);
    if (weekStart === cfg.weekStart) {
      setViewing(null);
      return;
    }
    try {
      const data = await cloud.loadWeek(weekStart);
      if (data) setViewing(data);
    } catch (e) {
      console.error(e);
      setCloudStatus('error');
    }
  }

  async function finalizeSchedule() {
    setFinalizingWeek(true);
    try {
      await cloud.saveWeek(cfg.weekStart, { status: 'finalized', lastWeek, leaves, schedule });
      setScheduleStatus('finalized');
      setWeeksList(await cloud.listWeeks());
      setOverlay(null);
    } catch (e) {
      console.error(e);
      setCloudStatus('error');
    } finally {
      setFinalizingWeek(false);
    }
  }

  const shown = viewing || { weekStart: cfg.weekStart, schedule, leaves };
  const shownLabels = viewing ? dayLabels(viewing.weekStart) : labels;

  const badge = {
    off: ['badge-off', 'Local only'],
    idle: ['badge-idle', 'Cloud ready'],
    saving: ['badge-saving', 'Saving…'],
    saved: ['badge-saved', 'Saved'],
    error: ['badge-error', 'Cloud error'],
  }[cloudStatus];

  return (
    <>
      <div className="app">
        <header className="topbar">
          <div className="brand">
            <span className="brand-mark">SHIFT</span>
            <span className="brand-sub">BOARD</span>
          </div>
          <div className="topbar-right">
            <button
              type="button"
              className={`badge ${badge[0]}`}
              onClick={() => cloud.enabled && setOverlay('diag')}
              title="Cloud connection details"
            >
              {badge[1]}
            </button>
            {cloud.enabled && (
              <button type="button" className="btn btn-ghost btn-light" onClick={() => setOverlay('history')}>
                History
              </button>
            )}
            {workers.length > 0 && (
              <button type="button" className="btn btn-ghost btn-light" onClick={() => setOverlay('lastweek')}>
                Last week
              </button>
            )}
          </div>
        </header>

        <div className="week-stamp-bar">Week of {formatWeek(shown.weekStart)}</div>

        {viewing ? (
          <main className="main">
            <div className="banner banner-archive">
              <span>Archived week of {formatWeek(viewing.weekStart)} — read-only.</span>
              <button type="button" className="btn btn-ghost" onClick={() => setViewing(null)}>
                Back to current
              </button>
            </div>
            <ScheduleView
              stores={stores}
              workers={workers}
              schedule={viewing.schedule}
              leaves={viewing.leaves}
              lastWeek={viewing.lastWeek}
              maxConsec={cfg.maxConsec}
              splitTime={cfg.splitTime}
              labels={shownLabels}
              readOnly
              onChange={() => {}}
            />
            <div className="actions">
              <button type="button" className="btn" onClick={() => setPrintMode('worker')}>
                Print by worker
              </button>
              <button type="button" className="btn" onClick={() => setPrintMode('store')}>
                Print by store
              </button>
            </div>
          </main>
        ) : (
          <main className="main">
            <nav className="steps" aria-label="Progress">
              {STEPS.map((s, i) => (
                <button
                  key={s}
                  type="button"
                  className={`step ${i === step ? 'current' : ''} ${i < step ? 'done' : ''}`}
                  onClick={() => i < step && setStep(i)}
                  disabled={i > step}
                >
                  <span className="step-n">{i + 1}</span>
                  <span className="step-label">{s}</span>
                </button>
              ))}
            </nav>

            {loading ? (
              <div className="panel">
                <p className="hint">Loading your saved setup…</p>
              </div>
            ) : (
              <>
                {step === 0 && <StepInit cfg={cfg} onChange={setCfg} />}
                {step === 1 && <StepConfigure stores={stores} workers={workers} onStores={setStores} onWorkers={setWorkers} />}
                {step === 2 && (
                  <div className="panel">
                    <h2>Leave requests</h2>
                    <p className="hint">Tick each person's days off. The generator plans around them.</p>
                    <CheckGrid workers={workers} labels={labels} value={leaves} onChange={setLeaves} tone="leave" />
                  </div>
                )}
                {step === 3 && schedule && (
                  <ScheduleView
                    stores={stores}
                    workers={workers}
                    schedule={schedule}
                    leaves={leaves}
                    lastWeek={lastWeek}
                    maxConsec={cfg.maxConsec}
                    splitTime={cfg.splitTime}
                    labels={labels}
                    readOnly={false}
                    onChange={editSchedule}
                    predictability={predictability}
                    status={scheduleStatus}
                  />
                )}

                <div className="actions">
                  {step > 0 && (
                    <button type="button" className="btn btn-ghost" onClick={() => setStep(step - 1)}>
                      Back
                    </button>
                  )}
                  {step < 3 && (
                    <button type="button" className="btn btn-primary" onClick={next}>
                      {step === 2 ? 'Generate schedule' : 'Next'}
                    </button>
                  )}
                  {step === 3 && (
                    <>
                      <button type="button" className="btn" onClick={regenerate}>
                        Regenerate
                      </button>
                      <button type="button" className="btn" onClick={() => setPrintMode('worker')}>
                        Print by worker
                      </button>
                      <button type="button" className="btn" onClick={() => setPrintMode('store')}>
                        Print by store
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => setOverlay('finalize')}
                      >
                        ✓ Finalize Schedule
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </main>
        )}

        {overlay === 'history' && (
          <HistoryPanel weeks={weeksList} currentWeek={cfg.weekStart} onLoad={openArchivedWeek} onClose={() => setOverlay(null)} />
        )}
        {overlay === 'lastweek' && (
          <LastWeekPanel
            workers={workers}
            labels={labels}
            lastWeek={lastWeek}
            source={lastWeekSource}
            onChange={setLastWeek}
            onSave={saveLastWeek}
            onClose={() => setOverlay(null)}
          />
        )}
        {overlay === 'diag' && (
          <DiagnosticsPanel
            status={cloudStatus}
            diag={cloud.diagnostics()}
            lastError={cloud.getLastError()}
            onTest={cloud.testConnection}
            onClose={() => setOverlay(null)}
          />
        )}
        {overlay === 'finalize' && (
          <FinalizePanel
            weekStart={cfg.weekStart}
            predictability={predictability}
            saving={finalizingWeek}
            onFinalize={finalizeSchedule}
            onCancel={() => setOverlay(null)}
          />
        )}
      </div>

      {printMode && (
        <PrintOverlay
          mode={printMode}
          weekStart={shown.weekStart}
          stores={stores}
          workers={workers}
          schedule={shown.schedule || {}}
          leaves={shown.leaves || {}}
          labels={shownLabels}
          onClose={() => setPrintMode(null)}
        />
      )}
    </>
  );
}
