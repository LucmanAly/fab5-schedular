import { useEffect, useState } from 'react';
import { DAY_NAMES, workerAtHalf, formatWeek, formatWeekRange, shiftTimeCompact } from '../lib/scheduler';

/**
 * Tier 1 destructive confirmation (§8) — for rare, hard-to-reverse deletes
 * (whole worker / whole store). Reuses the violation-box styling so it reads
 * as native, not a browser popup.
 */
export function ConfirmModal({ title, body, confirmLabel = 'Delete', onConfirm, onCancel }) {
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="violation-box confirm-modal" role="alertdialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h3 className="violation-title">⚠ {title}</h3>
        <p className="confirm-body">{body}</p>
        <div className="violation-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn btn-danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Tier 2 (§8) — undo toast for frequent low-stakes removals. The action has
 * already been applied; the toast offers a ~5s window to reverse it.
 */
export function UndoToast({ toast, onUndo, onExpire }) {
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(onExpire, 5000);
    return () => clearTimeout(t);
  }, [toast, onExpire]);
  if (!toast) return null;
  return (
    <div className="undo-toast" role="status">
      <span className="undo-toast-msg">{toast.message}</span>
      {toast.undo && (
        <button type="button" className="undo-toast-btn" onClick={onUndo}>
          Undo
        </button>
      )}
    </div>
  );
}

export function SaveSheet({ weekStart, openSlots, saving, onSave, onCancel }) {
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grab" />
        <h3>Save this schedule?</h3>
        <p className="hint">
          Saving commits the week of {formatWeek(weekStart)}, enables printing, and archives it. Only the three most
          recent weeks are kept — saving a fourth drops the oldest.
        </p>
        {openSlots > 0 && (
          <p className="hint" style={{ color: 'var(--gap)', fontWeight: 600 }}>
            ⚠ {openSlots} shift slot{openSlots > 1 ? 's are' : ' is'} still OPEN. You can save anyway and fill them on
            paper, or go back and assign someone.
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={saving}>
            Keep editing
          </button>
          <button type="button" className="btn btn-primary" onClick={onSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save schedule'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function DiagnosticsPanel({ status, diag, lastError, onTest, onClose }) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState(null);

  async function runTest() {
    setTesting(true);
    setResult(null);
    const r = await onTest();
    setResult(r);
    setTesting(false);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grab" />
        <h3>Cloud connection</h3>

        <dl className="diag">
          <div>
            <dt>Status</dt>
            <dd className={status === 'error' ? 'diag-bad' : status === 'saved' ? 'diag-good' : ''}>{status}</dd>
          </div>
          <div>
            <dt>Project URL</dt>
            <dd>{diag.hasUrl ? diag.url : 'missing — not in this build'}</dd>
          </div>
          <div>
            <dt>API key</dt>
            <dd>{diag.hasKey ? diag.keyType : 'missing — not in this build'}</dd>
          </div>
          {lastError && (
            <div>
              <dt>Last error</dt>
              <dd className="diag-bad">{lastError}</dd>
            </div>
          )}
        </dl>

        <button type="button" className="btn btn-primary" onClick={runTest} disabled={testing}>
          {testing ? 'Testing…' : 'Test connection'}
        </button>
        {result && <p className={`diag-result ${result.ok ? 'diag-good' : 'diag-bad'}`}>{result.message}</p>}

        <details className="diag-help">
          <summary>Common fixes</summary>
          <ol>
            <li>
              After adding the two keys in Netlify, you must redeploy: <strong>Deploys → Trigger deploy → Clear cache
              and deploy site</strong>. Keys are baked in at build time, so a build from before you added them won't
              have them.
            </li>
            <li>
              Run <strong>supabase-setup.sql</strong> in Supabase (SQL Editor → New query → paste → Run). A
              missing-table error means this step was skipped or run in a different project.
            </li>
            <li>Check the two variable names are exactly <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>.</li>
            <li>Confirm the URL and key come from the same Supabase project (Settings → Data API for the URL, Settings → API Keys for the key).</li>
          </ol>
        </details>

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// Structured (not string) so the printed cell can lay out name/time on their own
// lines instead of one elongated line, and so a lone half-day shift renders plainly
// instead of as a fake "— / Shop 3pm–10pm" split. Leave and a plain day off print
// identically ("OFF") — the distinction isn't useful to whoever reads the sheet.
function workerDayCell(schedule, stores, storeName, wId, d, splitTimes) {
  const s = (schedule[wId] && schedule[wId][d]) || { am: null, pm: null };
  const byId = (id) => stores.find((st) => st.id === id);
  if (s.am == null && s.pm == null) return { kind: 'off' };
  if (s.am != null && s.am === s.pm) {
    return { kind: 'full', shifts: [{ name: storeName(s.am), time: shiftTimeCompact(byId(s.am), d, 'full', splitTimes) }] };
  }
  const shifts = [];
  if (s.am != null) shifts.push({ half: 'AM', name: storeName(s.am), time: shiftTimeCompact(byId(s.am), d, 'am', splitTimes) });
  if (s.pm != null) shifts.push({ half: 'PM', name: storeName(s.pm), time: shiftTimeCompact(byId(s.pm), d, 'pm', splitTimes) });
  return { kind: shifts.length > 1 ? 'split' : 'shift', shifts };
}

function WorkerCell({ cell }) {
  if (cell.kind === 'off') {
    return (
      <td className="print-off-cell">
        <span className="print-off-tag">OFF</span>
      </td>
    );
  }
  return (
    <td className={cell.kind === 'split' ? 'print-split-cell' : undefined}>
      {cell.shifts.map((sh, i) => (
        <div className="shift-entry" key={sh.half || i}>
          {cell.kind === 'split' && <span className="shift-half">{sh.half}</span>}
          <span className="shift-store">{sh.name}</span>
          <span className="shift-time">{sh.time}</span>
        </div>
      ))}
    </td>
  );
}

function daySummaryByStore(schedule, workers, store, d, splitTimes) {
  const am = workerAtHalf(schedule, workers, store.id, d, 'am');
  const pm = workerAtHalf(schedule, workers, store.id, d, 'pm');
  if (am && pm && am.id === pm.id) return `${am.name} ${shiftTimeCompact(store, d, 'full', splitTimes)}`;
  if (!am && !pm) return 'OPEN';
  const a = `${am ? am.name : 'OPEN'} ${shiftTimeCompact(store, d, 'am', splitTimes)}`;
  const p = `${pm ? pm.name : 'OPEN'} ${shiftTimeCompact(store, d, 'pm', splitTimes)}`;
  return `${a} / ${p}`;
}

export function PrintOverlay({ mode, weekStart, stores, workers, schedule, labels, splitTimes = {}, onClose }) {
  const storeName = (id) => (stores.find((s) => s.id === id) || {}).name || `Store ${id}`;
  const title = `Week of ${formatWeek(weekStart)}`;
  const weekRange = formatWeekRange(weekStart);
  const printedOn = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  // 'all' (default) or a single worker/store id — the collective print stays
  // the default; one person's/store's sheet is a toolbar pick away.
  const [only, setOnly] = useState('all');
  const shownWorkers = only === 'all' ? workers : workers.filter((w) => String(w.id) === only);
  const shownStores = only === 'all' ? stores : stores.filter((s) => String(s.id) === only);

  // Rendered inside the app shell (not a fixed overlay) so the sidebar stays
  // reachable while previewing; @media print hides all chrome around .print-sheet.
  return (
    <div className="print-view">
      <div className="print-toolbar">
        <span>{mode === 'worker' ? 'Print by worker' : 'Print by store'} — {title}</span>
        <div className="print-toolbar-btns">
          <select
            className="print-scope"
            value={only}
            onChange={(e) => setOnly(e.target.value)}
            aria-label={mode === 'worker' ? 'Which workers to print' : 'Which stores to print'}
          >
            <option value="all">{mode === 'worker' ? 'All workers' : 'All stores'}</option>
            {(mode === 'worker' ? workers : stores).map((x) => (
              <option key={x.id} value={String(x.id)}>
                {x.name}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn-primary" onClick={() => window.print()}>
            Print / Save PDF
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>

      <div className="print-sheet">
        <header className="print-letterhead">
          <div className="print-brand">ShiftBoard</div>
          <h1 className="print-doc-title">
            {mode === 'worker'
              ? only === 'all'
                ? 'Staff Schedule'
                : 'Employee Schedule'
              : only === 'all'
                ? 'Store Coverage Schedule'
                : 'Store Coverage'}
          </h1>
          <div className="print-doc-meta">
            <span>{weekRange}</span>
            <span className="print-doc-meta-dot" aria-hidden="true">•</span>
            <span>Printed {printedOn}</span>
          </div>
        </header>

        {mode === 'worker'
          ? shownWorkers.map((w) => (
              <section key={w.id} className="print-block">
                <h2 className="print-block-name">{w.name}</h2>
                <table>
                  <thead>
                    <tr>{labels.map((l) => <th key={l}>{l}</th>)}</tr>
                  </thead>
                  <tbody>
                    <tr>
                      {DAY_NAMES.map((_, d) => (
                        <WorkerCell key={d} cell={workerDayCell(schedule, stores, storeName, w.id, d, splitTimes)} />
                      ))}
                    </tr>
                  </tbody>
                </table>
              </section>
            ))
          : shownStores.map((s) => (
              <section key={s.id} className="print-block">
                <h2 className="print-block-name">{s.name}</h2>
                <table>
                  <thead>
                    <tr>{labels.map((l) => <th key={l}>{l}</th>)}</tr>
                  </thead>
                  <tbody>
                    <tr>
                      {DAY_NAMES.map((_, d) => (
                        <td key={d}>{daySummaryByStore(schedule, workers, s, d, splitTimes)}</td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </section>
            ))}

        <footer className="print-footer">Generated by ShiftBoard</footer>
      </div>
    </div>
  );
}
