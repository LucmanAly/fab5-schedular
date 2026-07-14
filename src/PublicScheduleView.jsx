import { useEffect, useState } from 'react';
import * as cloud from './lib/supabase';
import { dayLabels, formatWeekRange } from './lib/scheduler';
import { workerDayCell, WorkerCell } from './components/Overlays';

// Permanent, unauthenticated, read-only per-worker schedule link
// (?view=TOKEN). Never mounts the authenticated app shell — no login, no
// edit paths — and shows only the one worker that token belongs to, not the
// full staff roster, even though the underlying fetch (loadSetup/loadWeek)
// necessarily returns everyone's data (RLS is table-level, not per-token; see
// ARCHITECTURE.md for that tradeoff).
export default function PublicScheduleView({ token }) {
  const [state, setState] = useState({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { stores, workers } = await cloud.loadSetup();
        const worker = workers.find((w) => w.public_token === token);
        if (!worker) {
          if (!cancelled) setState({ status: 'not-found' });
          return;
        }
        const weeks = await cloud.listWeeks();
        if (!weeks.length) {
          if (!cancelled) setState({ status: 'no-schedule', worker });
          return;
        }
        const week = await cloud.loadWeek(weeks[0].week_start);
        if (!cancelled) setState({ status: 'ready', worker, week, stores });
      } catch (e) {
        if (!cancelled) setState({ status: 'error', message: e.message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (state.status === 'loading') {
    return (
      <div className="public-view">
        <p className="hint">Loading your schedule…</p>
      </div>
    );
  }
  if (state.status === 'not-found') {
    return (
      <div className="public-view">
        <p className="hint">This link isn&rsquo;t recognized. Ask for a fresh one.</p>
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className="public-view">
        <p className="hint">Couldn&rsquo;t load your schedule right now. Try again in a bit.</p>
      </div>
    );
  }
  if (state.status === 'no-schedule') {
    return (
      <div className="public-view">
        <h1 className="print-doc-title">{state.worker.name}</h1>
        <p className="hint">No schedule has been published yet.</p>
      </div>
    );
  }

  const { worker, week, stores } = state;
  const storeName = (id) => (stores.find((s) => s.id === id) || {}).name || `Store ${id}`;
  const labels = dayLabels(week.weekStart);

  return (
    <div className="public-view">
      <div className="print-brand">ShiftBoard</div>
      <h1 className="print-doc-title">{worker.name}</h1>
      <div className="print-doc-meta">
        <span>{formatWeekRange(week.weekStart)}</span>
      </div>
      <table className="public-view-table">
        <thead>
          <tr>
            {labels.map((l) => (
              <th key={l}>{l}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {labels.map((_, d) => (
              <WorkerCell key={d} cell={workerDayCell(week.schedule, stores, storeName, worker.id, d, week.splitTimes)} />
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
