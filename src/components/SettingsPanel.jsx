import { useEffect, useRef, useState } from 'react';
import { ConfirmModal } from './Overlays';
import { DAY_NAMES } from '../lib/scheduler';

// Settings is a full page reached from the sidebar.
// Setup order: 1) add stores, 2) add workers and link them to stores.
// Names are case-insensitive: uniqueness checks and store matching ignore case.
//
// Every edit persists immediately: text/number/time fields commit on blur
// (invalid values snap back), buttons/links/toggles commit on click. There is
// no staged draft and no Save button — App serializes the resulting saves.

const norm = (s) => (s || '').trim().toLowerCase();

const STORE_DEFAULTS = {
  shift_mode: 'default',
  weekday_open: '08:00',
  weekday_close: '22:00',
  weekend_open: '09:00',
  weekend_close: '22:00',
};

/**
 * Input that buffers keystrokes locally and commits on blur (Enter blurs).
 * If `validate` rejects the trimmed value, the field reverts to the last
 * committed value instead of saving.
 */
function BlurField({ value, onCommit, validate, ...rest }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <input
      {...rest}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      onBlur={() => {
        const next = typeof v === 'string' ? v.trim() : v;
        if (validate && !validate(next)) {
          setV(value);
          return;
        }
        if (next !== value) onCommit(next);
        else setV(value);
      }}
    />
  );
}

export default function SettingsPage({ stores, workers, prompt, onSave, onToast }) {
  const [tab, setTab] = useState('stores'); // stores | workers
  const [newStoreName, setNewStoreName] = useState('');
  const [storeError, setStoreError] = useState(null);
  const [addingWorker, setAddingWorker] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null); // { kind: 'store'|'worker', id, name }
  const [showBackToTop, setShowBackToTop] = useState(false);

  // Long Stores/Workers lists otherwise force a manual scroll back to the top
  // just to switch tabs or reach "+ Add" — the sticky tab bar (CSS) handles
  // switching tabs; this handles jumping back to the top from anywhere.
  useEffect(() => {
    const onScroll = () => setShowBackToTop(window.scrollY > 300);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const storeName = (id) => (stores.find((s) => s.id === id) || {}).name || `Store ${id}`;
  const mainOf = (storeId) => workers.find((w) => w.main_store_id === storeId) || null;

  const problems = (() => {
    const list = [];
    for (const w of workers) {
      if (!w.store_ids || w.store_ids.length === 0) list.push(`${w.name || 'A worker'} isn’t linked to any store.`);
    }
    return list;
  })();

  const staffingShort = stores.length > 0 && workers.length < stores.length;

  // ---------- stores ----------

  function addStore() {
    const name = newStoreName.trim();
    if (!name) return;
    if (stores.some((s) => norm(s.name) === norm(name))) {
      setStoreError(`“${name}” already exists — store names must be unique.`);
      return;
    }
    const id = Math.max(0, ...stores.map((s) => s.id)) + 1;
    onSave([...stores, { id, name, ...STORE_DEFAULTS }], workers);
    setNewStoreName('');
    setStoreError(null);
  }

  function patchStore(id, patch) {
    onSave(
      stores.map((s) => (s.id === id ? { ...s, ...patch } : s)),
      workers
    );
  }

  // Tier 1 (§8): deleting a store cascades into links — confirm modal first.
  function deleteStore(id) {
    onSave(
      stores.filter((s) => s.id !== id),
      workers.map((w) => ({
        ...w,
        store_ids: (w.store_ids || []).filter((sid) => sid !== id),
        main_store_id: w.main_store_id === id ? null : w.main_store_id,
      }))
    );
  }

  // ---------- workers ----------

  function patchWorker(id, patch) {
    onSave(
      stores,
      workers.map((w) => (w.id === id ? { ...w, ...patch } : w))
    );
  }

  function deleteWorker(id) {
    onSave(
      stores,
      workers.filter((w) => w.id !== id)
    );
  }

  function linkStore(worker, storeId) {
    if ((worker.store_ids || []).includes(storeId)) return;
    patchWorker(worker.id, { store_ids: [...(worker.store_ids || []), storeId] });
  }

  // Tier 2 (§8): clearing a link applies immediately with a 5s undo toast.
  function unlinkStore(worker, storeId) {
    const before = workers;
    const ids = (worker.store_ids || []).filter((s) => s !== storeId);
    patchWorker(worker.id, {
      store_ids: ids,
      // Removing the home store demotes a Main to Float.
      main_store_id: worker.main_store_id === storeId ? null : worker.main_store_id,
    });
    if (onToast) {
      onToast(`Removed ${worker.name}'s link to ${storeName(storeId)}`, () => onSave(stores, before));
    }
  }

  function moveLink(worker, storeId, dir) {
    const ids = [...(worker.store_ids || [])];
    const i = ids.indexOf(storeId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    // A Main's home store stays first.
    if (worker.main_store_id != null && (i === 0 || j === 0)) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    patchWorker(worker.id, { store_ids: ids });
  }

  function setRole(worker, role) {
    if (role === 'float') {
      patchWorker(worker.id, { main_store_id: null });
      return;
    }
    const home = (worker.store_ids || [])[0];
    if (home == null) return;
    const taken = mainOf(home);
    if (taken && taken.id !== worker.id) return; // UI disables this, belt and braces
    patchWorker(worker.id, { main_store_id: home });
  }

  function createWorker({ name, storeIds, role }) {
    if (workers.some((w) => norm(w.name) === norm(name))) return false;
    const id = Math.max(0, ...workers.map((w) => w.id)) + 1;
    onSave(stores, [
      ...workers,
      {
        id,
        name: name.trim(),
        store_ids: storeIds,
        main_store_id: role === 'main' ? storeIds[0] : null,
        max_workdays: 5,
        recurring_leaves: [false, false, false, false, false, false, false],
        recurring_locks: [null, null, null, null, null, null, null],
        public_token: crypto.randomUUID(),
      },
    ]);
    return true;
  }

  return (
    <div className="settings-page">
      <h1 className="page-title">Settings</h1>
      <p className="hint">Changes save automatically.</p>

      {prompt && <div className="banner banner-bad">{prompt}</div>}

      {staffingShort && (
        <div className="banner banner-bad">
          Not enough workers: {workers.length} worker{workers.length === 1 ? '' : 's'} for {stores.length}{' '}
          stores. You need at least one worker per store (more is better).
        </div>
      )}

      <div className="settings-tabs">
        {[
          ['stores', `Stores (${stores.length})`],
          ['workers', `Workers (${workers.length})`],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`settings-tab ${tab === id ? 'active' : ''}`}
            onClick={() => {
              setTab(id);
              // Stores/Workers lists differ in length — without this, switching
              // tabs deep in a long list can strand the viewport mid-way into
              // the (possibly shorter) other list instead of showing its top.
              scrollToTop();
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'stores' && (
        <div className="panel settings-section">
          <h3 className="settings-section-title">Step 1 — Stores</h3>
          <p className="settings-hint">Name each location. Store names must be unique (case doesn’t matter).</p>

          <div className="settings-add-row">
            <input
              type="text"
              value={newStoreName}
              placeholder="New store name"
              aria-label="New store name"
              onChange={(e) => {
                setNewStoreName(e.target.value);
                setStoreError(null);
              }}
              onKeyDown={(e) => e.key === 'Enter' && addStore()}
            />
            <button type="button" className="btn btn-primary" onClick={addStore} disabled={!newStoreName.trim()}>
              Add store
            </button>
          </div>
          {storeError && <p className="field-error">{storeError}</p>}

          <div className="settings-list">
            {stores.map((s) => (
              <StoreCard
                key={s.id}
                store={s}
                stores={stores}
                workers={workers}
                mainOf={mainOf}
                onPatch={(patch) => patchStore(s.id, patch)}
                onDelete={() => setConfirmDelete({ kind: 'store', id: s.id, name: s.name })}
              />
            ))}
            {stores.length === 0 && <p className="settings-hint">No stores yet — add your first one above.</p>}
          </div>
        </div>
      )}

      {tab === 'workers' && (
        <div className="panel settings-section">
          <h3 className="settings-section-title">Step 2 — Workers</h3>
          <p className="settings-hint">
            Link each worker to the stores they can work at. The first store is their favourite — a float’s priority
            drops with every store further down the list. Each store can have one Main worker.
          </p>

          {stores.length === 0 ? (
            <p className="settings-hint">Add stores first — workers link to stores.</p>
          ) : (
            <>
              <button type="button" className="btn btn-primary" onClick={() => setAddingWorker(true)}>
                + Add worker
              </button>

              <div className="settings-list" style={{ marginTop: 12 }}>
                {workers.map((w) => (
                  <WorkerCard
                    key={w.id}
                    worker={w}
                    workers={workers}
                    storeName={storeName}
                    mainOf={mainOf}
                    onRename={(name) => patchWorker(w.id, { name })}
                    onAllowance={(days) => patchWorker(w.id, { max_workdays: days })}
                    onDelete={() => setConfirmDelete({ kind: 'worker', id: w.id, name: w.name })}
                    onLink={(sid) => linkStore(w, sid)}
                    onUnlink={(sid) => unlinkStore(w, sid)}
                    onMove={(sid, dir) => moveLink(w, sid, dir)}
                    onRole={(role) => setRole(w, role)}
                    onRecurringLeave={(days) => patchWorker(w.id, { recurring_leaves: days })}
                    onRecurringLock={(days) => patchWorker(w.id, { recurring_locks: days })}
                    onGenerateToken={() => patchWorker(w.id, { public_token: crypto.randomUUID() })}
                    onToast={onToast}
                    stores={stores}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {problems.length > 0 && (
        <div className="banner banner-bad">
          <ul className="violation-list">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      {confirmDelete && (
        <ConfirmModal
          title={`Delete ${confirmDelete.name}?`}
          body={
            confirmDelete.kind === 'store'
              ? `This removes ${confirmDelete.name} from every worker's links and from future schedules. It can't be undone.`
              : `This removes ${confirmDelete.name} from all store links and can't be undone.`
          }
          confirmLabel="Delete"
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => {
            if (confirmDelete.kind === 'store') deleteStore(confirmDelete.id);
            else deleteWorker(confirmDelete.id);
            setConfirmDelete(null);
          }}
        />
      )}

      {addingWorker && (
        <AddWorkerSheet
          stores={stores}
          workers={workers}
          mainOf={mainOf}
          onCreate={(payload) => {
            if (createWorker(payload)) setAddingWorker(false);
          }}
          onClose={() => setAddingWorker(false)}
        />
      )}

      {showBackToTop && (
        <button type="button" className="settings-back-to-top" aria-label="Back to top" title="Back to top" onClick={scrollToTop}>
          ↑
        </button>
      )}
    </div>
  );
}

function StoreCard({ store: s, stores, workers, mainOf, onPatch, onDelete }) {
  const main = mainOf(s.id);
  // Read-only roster: Main first, then everyone linked to this store ordered
  // by how high this store sits in their own preference list.
  const linked = workers
    .filter((w) => (w.store_ids || []).includes(s.id) && (!main || w.id !== main.id))
    .sort((a, b) => (a.store_ids || []).indexOf(s.id) - (b.store_ids || []).indexOf(s.id));

  const hoursField = (key, fallback) => (
    <BlurField
      type="time"
      value={s[key] || fallback}
      validate={(v) => !!v}
      onCommit={(v) => onPatch({ [key]: v })}
    />
  );

  return (
    <div className="settings-worker-card store-card-settings">
      <div className="worker-header">
        <BlurField
          type="text"
          className="worker-name"
          aria-label="Store name"
          value={s.name}
          validate={(v) => !!v && !stores.some((o) => o.id !== s.id && norm(o.name) === norm(v))}
          onCommit={(v) => onPatch({ name: v })}
        />
        <span className="store-row-main">{main ? `Main: ${main.name}` : 'No main worker yet'}</span>
        <button type="button" className="worker-delete" title="Delete store" aria-label={`Delete ${s.name}`} onClick={onDelete}>
          ✕
        </button>
      </div>

      <div className="store-settings-row">
        <span className="store-settings-label">Shift mode</span>
        <div className="settings-seg shift-mode-seg">
          <button
            type="button"
            className={(s.shift_mode || 'default') === 'default' ? 'active' : ''}
            onClick={() => onPatch({ shift_mode: 'default' })}
          >
            Default
          </button>
          <button
            type="button"
            className={s.shift_mode === 'split_only' ? 'active' : ''}
            onClick={() => onPatch({ shift_mode: 'split_only' })}
          >
            Split Shift Only
          </button>
        </div>
      </div>

      <div className="store-settings-row">
        <span className="store-settings-label">Weekday hours</span>
        <span className="store-hours-pair">
          {hoursField('weekday_open', '08:00')}
          –
          {hoursField('weekday_close', '22:00')}
        </span>
      </div>
      <div className="store-settings-row">
        <span className="store-settings-label">Weekend hours</span>
        <span className="store-hours-pair">
          {hoursField('weekend_open', '09:00')}
          –
          {hoursField('weekend_close', '22:00')}
        </span>
      </div>

      <div className="store-settings-row store-linked-workers">
        <span className="store-settings-label">Linked workers</span>
        {main == null && linked.length === 0 ? (
          <span className="settings-hint-inline">No workers linked yet</span>
        ) : (
          <span className="linked-worker-list">
            {main && <span className="linked-worker linked-worker-main">{main.name} · main</span>}
            {linked.map((w) => (
              <span key={w.id} className="linked-worker">
                {w.name}
              </span>
            ))}
          </span>
        )}
      </div>
    </div>
  );
}

function WorkerCard({
  worker,
  workers,
  stores,
  storeName,
  mainOf,
  onRename,
  onAllowance,
  onDelete,
  onLink,
  onUnlink,
  onMove,
  onRole,
  onRecurringLeave,
  onRecurringLock,
  onGenerateToken,
  onToast,
}) {
  const ids = worker.store_ids || [];
  const home = ids[0];
  const homeMain = home != null ? mainOf(home) : null;
  const mainBlocked = home == null || (homeMain && homeMain.id !== worker.id);
  const recLeave = worker.recurring_leaves || [false, false, false, false, false, false, false];
  const recLock = worker.recurring_locks || [null, null, null, null, null, null, null];

  function toggleRecurringLeave(i) {
    const next = [...recLeave];
    next[i] = !next[i];
    onRecurringLeave(next);
  }
  // Cycles a day through: no lock -> each linked store in link order -> no lock.
  function cycleRecurringLock(i) {
    if (!ids.length) return;
    const cur = recLock[i];
    const idx = cur == null ? -1 : ids.indexOf(cur);
    const next = [...recLock];
    next[i] = idx + 1 >= ids.length ? null : ids[idx + 1];
    onRecurringLock(next);
  }

  return (
    <div className="settings-worker-card">
      <div className="worker-header">
        <BlurField
          type="text"
          className="worker-name"
          aria-label="Worker name"
          placeholder="Worker name"
          value={worker.name}
          validate={(v) => !!v && !workers.some((o) => o.id !== worker.id && norm(o.name) === norm(v))}
          onCommit={onRename}
        />
        <span className={`chip chip-${worker.main_store_id != null ? 'main' : 'float'}`}>
          {worker.main_store_id != null ? `Main · ${storeName(worker.main_store_id)}` : 'Float'}
        </span>
        <button type="button" className="worker-delete" title="Delete worker" aria-label={`Delete ${worker.name}`} onClick={onDelete}>
          ✕
        </button>
      </div>

      <div className="store-settings-row">
        <span className="store-settings-label">Public link</span>
        {worker.public_token ? (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              const url = `${window.location.origin}/?view=${worker.public_token}`;
              navigator.clipboard.writeText(url);
              if (onToast) onToast(`Copied ${worker.name}'s schedule link`);
            }}
          >
            Copy link
          </button>
        ) : (
          <button type="button" className="btn btn-ghost" onClick={onGenerateToken}>
            Generate link
          </button>
        )}
      </div>

      <div className="store-settings-row">
        <span className="store-settings-label">Max workdays/week</span>
        <BlurField
          type="number"
          className="allowance-input"
          min="0.5"
          max="7"
          step="0.5"
          value={String(worker.max_workdays != null ? worker.max_workdays : 5)}
          validate={(v) => v !== '' && Number.isFinite(Number(v))}
          onCommit={(v) => onAllowance(Math.max(0.5, Math.min(7, Math.round(Number(v) * 2) / 2)))}
        />
      </div>

      <div className="store-settings-row recurring-row">
        <span className="store-settings-label" title="A permanent default — pre-fills the wizard's leave grid, but any week can still override it just for that week.">
          Recurring days off
        </span>
        <div className="recurring-days recurring-leaves">
          {DAY_NAMES.map((d, i) => (
            <button
              key={d}
              type="button"
              className={`day-toggle ${recLeave[i] ? 'on' : ''}`}
              title={recLeave[i] ? `Always off ${d} — tap to clear` : `Tap to mark always off ${d}`}
              onClick={() => toggleRecurringLeave(i)}
            >
              {d[0]}
            </button>
          ))}
        </div>
      </div>

      <div className="store-settings-row recurring-row">
        <span className="store-settings-label" title="A permanent default — pre-fills the wizard's lock grid, but any week can still override it just for that week.">
          Recurring lock
        </span>
        <div className="recurring-days recurring-locks">
          {DAY_NAMES.map((d, i) => (
            <button
              key={d}
              type="button"
              className={`day-toggle ${recLock[i] != null ? 'on' : ''}`}
              disabled={!ids.length}
              title={
                !ids.length
                  ? 'Link a store first'
                  : recLock[i] != null
                    ? `Always locked to ${storeName(recLock[i])} on ${d} — tap to cycle`
                    : `Tap to lock ${d} to a store`
              }
              onClick={() => cycleRecurringLock(i)}
            >
              {recLock[i] != null ? storeName(recLock[i]).slice(0, 2) : d[0]}
            </button>
          ))}
        </div>
      </div>

      {ids.length > 0 && (
        <div className="settings-seg role-seg">
          <button
            type="button"
            className={worker.main_store_id != null ? 'active' : ''}
            disabled={mainBlocked}
            title={mainBlocked && homeMain ? `${storeName(home)} already has a Main: ${homeMain.name}` : undefined}
            onClick={() => onRole('main')}
          >
            Main at {home != null ? storeName(home) : '—'}
          </button>
          <button type="button" className={worker.main_store_id == null ? 'active' : ''} onClick={() => onRole('float')}>
            Float
          </button>
        </div>
      )}

      <div className="worker-store-links">
        <div className="store-link-label">Works at (first = favourite):</div>
        <div className="store-link-list">
          {ids.map((sid, idx) => (
            <div key={sid} className="store-link">
              <span className="store-link-name">
                {idx === 0 ? '⭐ ' : ''}
                {storeName(sid)}
                {worker.main_store_id === sid ? <span className="store-link-note">home</span> : null}
              </span>
              <div className="store-link-btns">
                {idx > 0 && !(worker.main_store_id != null && idx === 1) && (
                  <button type="button" className="mini-btn" title="Move up" onClick={() => onMove(sid, -1)}>
                    ↑
                  </button>
                )}
                {idx < ids.length - 1 && !(worker.main_store_id != null && idx === 0) && (
                  <button type="button" className="mini-btn" title="Move down" onClick={() => onMove(sid, +1)}>
                    ↓
                  </button>
                )}
                <button type="button" className="mini-btn mini-delete" title="Remove" onClick={() => onUnlink(sid)}>
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
        <StoreTypeahead stores={stores} excludeIds={ids} onPick={onLink} placeholder="Link a store…" />
      </div>
    </div>
  );
}

function AddWorkerSheet({ stores, workers, mainOf, onCreate, onClose }) {
  const [name, setName] = useState('');
  const [storeIds, setStoreIds] = useState([]);
  const [role, setRole] = useState(null); // asked on first link: 'main' | 'float'

  const home = storeIds[0];
  const homeMain = home != null ? mainOf(home) : null;
  const nameTaken = workers.some((w) => norm(w.name) === norm(name));
  const canCreate = name.trim() && !nameTaken && storeIds.length > 0 && role != null;

  function pickStore(sid) {
    setStoreIds((ids) => [...ids, sid]);
  }

  function removeStore(sid) {
    setStoreIds((ids) => {
      const next = ids.filter((s) => s !== sid);
      if (next.length === 0) setRole(null);
      return next;
    });
  }

  const storeName = (id) => (stores.find((s) => s.id === id) || {}).name || `Store ${id}`;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grab" />
        <h3>Add worker</h3>
        <p className="hint">Name the worker, then link them to the stores they can work at.</p>

        <div className="settings-field">
          <label>
            <span>Worker name</span>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Alice" autoFocus />
          </label>
          {nameTaken && <p className="field-error">That name is already taken (case doesn’t matter).</p>}
        </div>

        <div className="settings-field">
          <span>Stores (add in preference order — first = favourite)</span>
          {storeIds.length > 0 && (
            <div className="store-link-list" style={{ margin: '8px 0' }}>
              {storeIds.map((sid, idx) => (
                <div key={sid} className="store-link">
                  <span className="store-link-name">
                    {idx === 0 ? '⭐ ' : ''}
                    {storeName(sid)}
                  </span>
                  <div className="store-link-btns">
                    <button type="button" className="mini-btn mini-delete" onClick={() => removeStore(sid)}>
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <StoreTypeahead stores={stores} excludeIds={storeIds} onPick={pickStore} placeholder="Type a store name…" />
        </div>

        {home != null && (
          <div className="settings-field mainfloat-ask">
            <span>
              Is {name.trim() || 'this worker'} <strong>Main</strong> or <strong>Float</strong> for {storeName(home)}?
            </span>
            <div className="settings-seg">
              <button
                type="button"
                className={role === 'main' ? 'active' : ''}
                disabled={!!homeMain}
                title={homeMain ? `${storeName(home)} already has a Main: ${homeMain.name}` : undefined}
                onClick={() => setRole('main')}
              >
                Main{homeMain ? ` (taken: ${homeMain.name})` : ''}
              </button>
              <button type="button" className={role === 'float' ? 'active' : ''} onClick={() => setRole('float')}>
                Float
              </button>
            </div>
            <small>
              Main = the store’s default worker (one per store). Float = rotates between their linked stores.
            </small>
          </div>
        )}

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canCreate}
            onClick={() => onCreate({ name, storeIds, role })}
          >
            Create worker
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Store picker fed only by existing store names — no free-typed store names,
 * so no case mismatches or typos. Matching is case-insensitive.
 */
function StoreTypeahead({ stores, excludeIds, onPick, placeholder }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const blurTimer = useRef(null);

  const matches = stores.filter(
    (s) => !excludeIds.includes(s.id) && norm(s.name).includes(norm(q))
  );

  function pick(id) {
    onPick(id);
    setQ('');
    setOpen(false);
  }

  return (
    <div className="typeahead">
      <input
        type="text"
        value={q}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          blurTimer.current = setTimeout(() => setOpen(false), 150);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            const exact = matches.find((s) => norm(s.name) === norm(q));
            if (exact) pick(exact.id);
            else if (matches.length === 1) pick(matches[0].id);
          }
          if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && matches.length > 0 && (
        <ul className="typeahead-list" onMouseDown={() => clearTimeout(blurTimer.current)}>
          {matches.map((s) => (
            <li key={s.id}>
              <button type="button" onClick={() => pick(s.id)}>
                {s.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && q.trim() && matches.length === 0 && (
        <ul className="typeahead-list">
          <li className="typeahead-empty">No matching store — stores must be created first.</li>
        </ul>
      )}
    </div>
  );
}
