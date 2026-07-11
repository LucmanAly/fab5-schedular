import { useEffect, useState } from 'react';
import { DAY_NAMES, workerAtHalf, formatWeek } from '../lib/scheduler';

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
          Saving commits the week of {formatWeek(weekStart)}, enables printing, and archives it. Only the two most
          recent weeks are kept — saving replaces the oldest.
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

function daySummaryByWorker(schedule, storeName, wId, d, leaves) {
  const s = (schedule[wId] && schedule[wId][d]) || { am: null, pm: null };
  if (s.am == null && s.pm == null) return leaves[wId] && leaves[wId][d] ? 'LEAVE' : '—';
  if (s.am != null && s.am === s.pm) return storeName(s.am);
  const a = s.am != null ? storeName(s.am) : '—';
  const p = s.pm != null ? storeName(s.pm) : '—';
  return `AM ${a} / PM ${p}`;
}

function daySummaryByStore(schedule, workers, storeId, d) {
  const am = workerAtHalf(schedule, workers, storeId, d, 'am');
  const pm = workerAtHalf(schedule, workers, storeId, d, 'pm');
  if (am && pm && am.id === pm.id) return am.name;
  const a = am ? am.name : 'OPEN';
  const p = pm ? pm.name : 'OPEN';
  if (!am && !pm) return 'OPEN';
  return `AM ${a} / PM ${p}`;
}

export function PrintOverlay({ mode, weekStart, stores, workers, schedule, leaves, labels, onClose }) {
  const storeName = (id) => (stores.find((s) => s.id === id) || {}).name || `Store ${id}`;
  const title = `Week of ${formatWeek(weekStart)}`;

  return (
    <div className="print-overlay">
      <div className="print-toolbar">
        <span>{mode === 'worker' ? 'Print by worker' : 'Print by store'} — {title}</span>
        <div className="print-toolbar-btns">
          <button type="button" className="btn btn-primary" onClick={() => window.print()}>
            Print / Save PDF
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>

      <div className="print-sheet">
        {mode === 'worker' ? (
          <>
            <h1>Staff schedule — {title}</h1>
            {workers.map((w) => (
              <section key={w.id} className="print-block">
                <h2>
                  {w.name}{' '}
                  <em>({w.main_store_id != null ? `main — ${storeName(w.main_store_id)}` : 'float'})</em>
                </h2>
                <table>
                  <thead>
                    <tr>{labels.map((l) => <th key={l}>{l}</th>)}</tr>
                  </thead>
                  <tbody>
                    <tr>
                      {DAY_NAMES.map((_, d) => (
                        <td key={d}>{daySummaryByWorker(schedule, storeName, w.id, d, leaves)}</td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </section>
            ))}
          </>
        ) : (
          <>
            <h1>Store coverage — {title}</h1>
            {stores.map((s) => (
              <section key={s.id} className="print-block">
                <h2>{s.name}</h2>
                <table>
                  <thead>
                    <tr>{labels.map((l) => <th key={l}>{l}</th>)}</tr>
                  </thead>
                  <tbody>
                    <tr>
                      {DAY_NAMES.map((_, d) => (
                        <td key={d}>{daySummaryByStore(schedule, workers, s.id, d)}</td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </section>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
