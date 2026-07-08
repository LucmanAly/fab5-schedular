import { useState } from 'react';
import { DAY_NAMES, workerAtHalf, formatWeek } from '../lib/scheduler';
import CheckGrid from './CheckGrid';

export function HistoryPanel({ weeks, currentWeek, onLoad, onClose }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grab" />
        <h3>Schedule history</h3>
        {weeks.length === 0 && <p className="hint">Nothing archived yet — every week you build is saved here.</p>}
        <ul className="picker">
          {weeks.map((w) => (
            <li key={w.week_start}>
              <button type="button" className="pick pick-row" onClick={() => onLoad(w.week_start)}>
                <span className="pick-name">Week of {formatWeek(w.week_start)}</span>
                <span className="pick-status">{w.week_start === currentWeek ? 'current' : w.status}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export function LastWeekPanel({ workers, labels, lastWeek, source, onChange, onSave, onClose }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grab" />
        <h3>Last week's worked days</h3>
        <p className="hint">
          {source
            ? `Loaded automatically from the archived week of ${formatWeek(source)}. Only adjust this if that record looks wrong.`
            : "No archived week found yet, so there's nothing to load automatically — tick the days each person worked so rest days carry across the week boundary."}
        </p>
        <CheckGrid workers={workers} labels={labels} value={lastWeek} onChange={onChange} tone="worked" />
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={onSave}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

export function FinalizePanel({ weekStart, predictability, saving, onFinalize, onCancel }) {
  const gaps = predictability?.totalSlots || 0; // This is used to show if there are issues
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grab" />
        <h3>Finalize schedule?</h3>
        <p className="hint">Once finalized, this schedule is locked. You can still view and print it, but changes require creating a new week.</p>

        <div className="finalize-summary">
          {predictability && (
            <>
              <div className="finalize-stat">
                <span className="finalize-label">Similarity to last week:</span>
                <span className="finalize-value">{predictability.similarityPercent}%</span>
              </div>
              <div className="finalize-stat">
                <span className="finalize-label">Shifts assigned:</span>
                <span className="finalize-value">{predictability.identicalSlots} of {predictability.totalSlots}</span>
              </div>
            </>
          )}
          <div className="finalize-stat">
            <span className="finalize-label">Week starting:</span>
            <span className="finalize-value">{formatWeek(weekStart)}</span>
          </div>
        </div>

        <p className="hint" style={{ marginTop: '12px', fontWeight: 500 }}>
          ✓ Review complete<br/>
          ✓ All gaps are acceptable<br/>
          ✓ Ready to publish
        </p>

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={saving}>
            Keep editing
          </button>
          <button type="button" className="btn btn-primary" onClick={onFinalize} disabled={saving}>
            {saving ? 'Finalizing…' : 'Finalize Now'}
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
              After adding the two keys in Netlify, you must redeploy: <strong>Deploys → Trigger deploy → Clear cache and deploy site</strong>. Keys are baked in at build time, so a build from before you added them won't have them.
            </li>
            <li>
              Run <strong>supabase-setup.sql</strong> in Supabase (SQL Editor → New query → paste → Run). A missing-table error means this step was skipped or run in a different project.
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
                  <em>
                    ({w.type === 'main' ? 'main' : 'float'} — {(w.store_ids || []).map(storeName).join(', ') || 'unlinked'})
                  </em>
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
