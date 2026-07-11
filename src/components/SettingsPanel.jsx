import { useEffect, useMemo, useRef, useState } from 'react';
import { ConfirmModal } from './Overlays';

// Settings is a full page reached from the sidebar.
// Setup order: 1) add stores, 2) add workers and link them to stores.
// Names are case-insensitive: uniqueness checks and store matching ignore case.
//
// Every edit persists immediately — there is no Save button. Text/number
// fields (names, hours, max workdays) commit on blur via useBlurCommit;
// discrete actions (buttons, links, add/delete) commit on click. Deleting a
// store or worker still asks for confirmation first (Tier 1, §8) — that's
// the only "are you sure?" left in this screen.

const norm = (s) => (s || '').trim().toLowerCase();

const STORE_DEFAULTS = {
  shift_mode: 'default',
  weekday_open: '08:00',
  weekday_close: '22:00',
  weekend_open: '09:00',
  weekend_close: '22:00',
};

// Local draft that only commits (and reports validation errors) on blur, so
// typing feels normal but nothing round-trips to the parent on every
// keystroke. `commit` returns { ok:false, message } to reject and revert, or
// nothing/{ok:true} to accept.
function useBlurCommit(value, commit) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState(null);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  function onChange(e) {
    setDraft(e.target.value);
    if (error) setError(null);
  }

  function onBlur() {
    if (draft === value) {
      setError(null);
      return;
    }
    const res = commit(draft);
    if (res && res.ok === false) {
      setError(res.message);
      setDraft(value);
    } else {
      setError(null);
    }
  }

  return { value: draft, error, onChange, onBlur };
}

// Workers linked to a store, Main first, then by each worker's own link rank
// for this store (store_ids.indexOf) — reuses existing data, no new fields.
function linkedWorkersFor(store, workers) {
  return workers
    .filter((w) => (w.store_ids || []).includes(store.id))
    .map((w) => ({
      worker: w,
      rank: w.store_ids.indexOf(store.id),
      isMain: w.main_store_id === store.id,
    }))
    .sort((a, b) => (b.isMain ? 1 : 0) - (a.isMain ? 1 : 0) || a.rank - b.rank || a.worker.name.localeCompare(b.worker.name));
}

export default function SettingsPage({ stores, workers, prompt, onSave, onToast }) {
  const [storesState, setStoresState] = useState(stores);
  const [workersState, setWorkersState] = useState(workers);
  const [tab, setTab] = useState('stores'); // stores | workers
  const [newStoreName, setNewStoreName] = useState('');
  const [storeError, setStoreError] = useState(null);
  const [addingWorker, setAddingWorker] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null); // { kind: 'store'|'worker', id, name }

  // Mirrors of the latest committed state, so mutators never read a stale
  // closure when two commits happen back to back.
  const storesRef = useRef(storesState);
  storesRef.current = storesState;
  const workersRef = useRef(workersState);
  workersRef.current = workersState;

  const storeName = (id) => (storesState.find((s) => s.id === id) || {}).name || `Store ${id}`;
  const mainOf = (storeId) => workersState.find((w) => w.main_store_id === storeId) || null;

  const problems = useMemo(() => {
    const list = [];
    const storeNames = storesState.map((s) => norm(s.name));
    if (storeNames.some((n) => !n)) list.push('Every store needs a name.');
    if (new Set(storeNames).size !== storeNames.length) list.push('Store names must be unique (case doesn’t matter).');
    const workerNames = workersState.map((w) => norm(w.name));
    if (workerNames.some((n) => !n)) list.push('Every worker needs a name.');
    if (new Set(workerNames).size !== workerNames.length) list.push('Worker names must be unique (case doesn’t matter).');
    for (const w of workersState) {
      if (!w.store_ids || w.store_ids.length === 0) list.push(`${w.name || 'A worker'} isn’t linked to any store.`);
    }
    return list;
  }, [storesState, workersState]);

  const staffingShort = storesState.length > 0 && workersState.length < storesState.length;

  // ---------- the one place that persists ----------

  function commitBoth(nextStores, nextWorkers) {
    storesRef.current = nextStores;
    workersRef.current = nextWorkers;
    setStoresState(nextStores);
    setWorkersState(nextWorkers);
    onSave(nextStores, nextWorkers);
  }
  const commitStores = (next) => commitBoth(next, workersRef.current);
  const commitWorkers = (next) => commitBoth(storesRef.current, next);

  // ---------- stores ----------

  function addStore() {
    const name = newStoreName.trim();
    if (!name) return;
    if (storesState.some((s) => norm(s.name) === norm(name))) {
      setStoreError(`“${name}” already exists — store names must be unique.`);
      return;
    }
    const id = Math.max(0, ...storesState.map((s) => s.id)) + 1;
    commitStores([...storesState, { id, name, ...STORE_DEFAULTS }]);
    setNewStoreName('');
    setStoreError(null);
  }

  function renameStore(id, rawName) {
    const name = rawName.trim();
    if (!name) return { ok: false, message: 'Store name can’t be empty.' };
    if (storesState.some((s) => s.id !== id && norm(s.name) === norm(name))) {
      return { ok: false, message: `“${name}” already exists — store names must be unique.` };
    }
    commitStores(storesState.map((s) => (s.id === id ? { ...s, name } : s)));
    return { ok: true };
  }

  function commitStorePatch(id, patch) {
    commitStores(storesState.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  // Tier 1 (§8): deleting a store cascades into links — confirm modal first,
  // then persists immediately.
  function deleteStore(id) {
    const nextStores = storesState.filter((s) => s.id !== id);
    const nextWorkers = workersState.map((w) => ({
      ...w,
      store_ids: (w.store_ids || []).filter((sid) => sid !== id),
      main_store_id: w.main_store_id === id ? null : w.main_store_id,
    }));
    commitBoth(nextStores, nextWorkers);
  }

  // ---------- workers ----------

  function renameWorker(id, rawName) {
    const name = rawName.trim();
    if (!name) return { ok: false, message: 'Worker name can’t be empty.' };
    if (workersState.some((w) => w.id !== id && norm(w.name) === norm(name))) {
      return { ok: false, message: `“${name}” already exists — worker names must be unique.` };
    }
    commitWorkers(workersState.map((w) => (w.id === id ? { ...w, name } : w)));
    return { ok: true };
  }

  function commitWorkerPatch(id, patch) {
    commitWorkers(workersState.map((w) => (w.id === id ? { ...w, ...patch } : w)));
  }

  function deleteWorker(id) {
    commitWorkers(workersState.filter((w) => w.id !== id));
  }

  function linkStore(worker, storeId) {
    if ((worker.store_ids || []).includes(storeId)) return;
    commitWorkerPatch(worker.id, { store_ids: [...(worker.store_ids || []), storeId] });
  }

  // Tier 2 (§8): clearing a link applies immediately with a 5s undo toast.
  function unlinkStore(worker, storeId) {
    const before = workersState;
    const ids = (worker.store_ids || []).filter((s) => s !== storeId);
    const wasLastLink = ids.length === 0;
    commitWorkerPatch(worker.id, {
      store_ids: ids,
      // Removing the home store demotes a Main to Float.
      main_store_id: worker.main_store_id === storeId ? null : worker.main_store_id,
    });
    if (onToast) {
      onToast(
        wasLastLink
          ? `Removed ${worker.name}'s only store link — they can't be scheduled until relinked`
          : `Removed ${worker.name}'s link to ${storeName(storeId)}`,
        () => commitWorkers(before)
      );
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
    commitWorkerPatch(worker.id, { store_ids: ids });
  }

  function setRole(worker, role) {
    if (role === 'float') {
      commitWorkerPatch(worker.id, { main_store_id: null });
      return;
    }
    const home = (worker.store_ids || [])[0];
    if (home == null) return;
    const taken = mainOf(home);
    if (taken && taken.id !== worker.id) return; // UI disables this, belt and braces
    commitWorkerPatch(worker.id, { main_store_id: home });
  }

  function createWorker({ name, storeIds, role }) {
    if (workersState.some((w) => norm(w.name) === norm(name))) return false;
    const id = Math.max(0, ...workersState.map((w) => w.id)) + 1;
    commitWorkers([
      ...workersState,
      { id, name: name.trim(), store_ids: storeIds, main_store_id: role === 'main' ? storeIds[0] : null, max_workdays: 5 },
    ]);
    return true;
  }

  return (
    <div className="settings-page">
      <h1 className="page-title">Settings</h1>

      {prompt && <div className="banner banner-bad">{prompt}</div>}

      {staffingShort && (
        <div className="banner banner-bad">
          Not enough workers: {workersState.length} worker{workersState.length === 1 ? '' : 's'} for {storesState.length}{' '}
          stores. You need at least one worker per store (more is better).
        </div>
      )}

      <div className="settings-tabs">
        {[
          ['stores', `Stores (${storesState.length})`],
          ['workers', `Workers (${workersState.length})`],
        ].map(([id, label]) => (
          <button key={id} className={`settings-tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>
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
            {storesState.map((s) => (
              <StoreCard
                key={s.id}
                store={s}
                workers={workersState}
                mainOf={mainOf}
                onRenameCommit={(name) => renameStore(s.id, name)}
                onPatch={(patch) => commitStorePatch(s.id, patch)}
                onDelete={() => setConfirmDelete({ kind: 'store', id: s.id, name: s.name })}
              />
            ))}
            {storesState.length === 0 && <p className="settings-hint">No stores yet — add your first one above.</p>}
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

          {storesState.length === 0 ? (
            <p className="settings-hint">Add stores first — workers link to stores.</p>
          ) : (
            <>
              <button type="button" className="btn btn-primary" onClick={() => setAddingWorker(true)}>
                + Add worker
              </button>

              <div className="settings-list" style={{ marginTop: 12 }}>
                {workersState.map((w) => (
                  <WorkerCard
                    key={w.id}
                    worker={w}
                    stores={storesState}
                    storeName={storeName}
                    mainOf={mainOf}
                    onRenameCommit={(name) => renameWorker(w.id, name)}
                    onAllowanceCommit={(raw) => {
                      const v = Number(raw);
                      if (!Number.isFinite(v)) return { ok: false, message: 'Enter a number.' };
                      commitWorkerPatch(w.id, { max_workdays: Math.max(0.5, Math.min(7, Math.round(v * 2) / 2)) });
                      return { ok: true };
                    }}
                    onDelete={() => setConfirmDelete({ kind: 'worker', id: w.id, name: w.name })}
                    onLink={(sid) => linkStore(w, sid)}
                    onUnlink={(sid) => unlinkStore(w, sid)}
                    onMove={(sid, dir) => moveLink(w, sid, dir)}
                    onRole={(role) => setRole(w, role)}
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
          stores={storesState}
          workers={workersState}
          mainOf={mainOf}
          onCreate={(payload) => {
            if (createWorker(payload)) setAddingWorker(false);
          }}
          onClose={() => setAddingWorker(false)}
        />
      )}
    </div>
  );
}

function StoreCard({ store, workers, mainOf, onRenameCommit, onPatch, onDelete }) {
  const main = mainOf(store.id);
  const nameField = useBlurCommit(store.name, onRenameCommit);
  const weekdayOpen = useBlurCommit(store.weekday_open || '08:00', (v) => {
    if (!v) return { ok: false };
    onPatch({ weekday_open: v });
    return { ok: true };
  });
  const weekdayClose = useBlurCommit(store.weekday_close || '22:00', (v) => {
    if (!v) return { ok: false };
    onPatch({ weekday_close: v });
    return { ok: true };
  });
  const weekendOpen = useBlurCommit(store.weekend_open || '09:00', (v) => {
    if (!v) return { ok: false };
    onPatch({ weekend_open: v });
    return { ok: true };
  });
  const weekendClose = useBlurCommit(store.weekend_close || '22:00', (v) => {
    if (!v) return { ok: false };
    onPatch({ weekend_close: v });
    return { ok: true };
  });
  const linked = linkedWorkersFor(store, workers);

  return (
    <div className="settings-worker-card store-card-settings">
      <div className="worker-header">
        <input type="text" className="worker-name" value={nameField.value} onChange={nameField.onChange} onBlur={nameField.onBlur} />
        <span className="store-row-main">{main ? `Main: ${main.name}` : 'No main worker yet'}</span>
        <button type="button" className="worker-delete" title="Delete store" onClick={onDelete}>
          ✕
        </button>
      </div>
      {nameField.error && <p className="field-error">{nameField.error}</p>}

      <div className="store-settings-row shift-mode-row">
        <span className="store-settings-label">Shift mode</span>
        <div className="settings-seg shift-mode-seg">
          <button
            type="button"
            className={(store.shift_mode || 'default') === 'default' ? 'active' : ''}
            onClick={() => onPatch({ shift_mode: 'default' })}
          >
            Default
          </button>
          <button
            type="button"
            className={store.shift_mode === 'split_only' ? 'active' : ''}
            onClick={() => onPatch({ shift_mode: 'split_only' })}
          >
            Split Shift Only
          </button>
        </div>
      </div>

      <div className="store-settings-row">
        <span className="store-settings-label">Weekday hours</span>
        <span className="store-hours-pair">
          <input type="time" value={weekdayOpen.value} onChange={weekdayOpen.onChange} onBlur={weekdayOpen.onBlur} />
          –
          <input type="time" value={weekdayClose.value} onChange={weekdayClose.onChange} onBlur={weekdayClose.onBlur} />
        </span>
      </div>
      <div className="store-settings-row">
        <span className="store-settings-label">Weekend hours</span>
        <span className="store-hours-pair">
          <input type="time" value={weekendOpen.value} onChange={weekendOpen.onChange} onBlur={weekendOpen.onBlur} />
          –
          <input type="time" value={weekendClose.value} onChange={weekendClose.onChange} onBlur={weekendClose.onBlur} />
        </span>
      </div>

      <div className="store-settings-row store-linked-workers">
        <span className="store-settings-label">Linked workers</span>
        <ol className="store-linked-worker-list">
          {linked.length === 0 && <li className="store-linked-worker-empty">No workers linked yet</li>}
          {linked.map((entry, i) => (
            <li key={entry.worker.id}>
              {i + 1}. {entry.worker.name}
              {entry.isMain ? ' (Main)' : ''}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function WorkerCard({ worker, stores, storeName, mainOf, onRenameCommit, onAllowanceCommit, onDelete, onLink, onUnlink, onMove, onRole }) {
  const ids = worker.store_ids || [];
  const home = ids[0];
  const homeMain = home != null ? mainOf(home) : null;
  const mainBlocked = home == null || (homeMain && homeMain.id !== worker.id);
  const nameField = useBlurCommit(worker.name, onRenameCommit);
  const allowanceField = useBlurCommit(worker.max_workdays != null ? String(worker.max_workdays) : '5', onAllowanceCommit);

  return (
    <div className="settings-worker-card">
      <div className="worker-header">
        <input
          type="text"
          className="worker-name"
          value={nameField.value}
          placeholder="Worker name"
          onChange={nameField.onChange}
          onBlur={nameField.onBlur}
        />
        <span className={`chip chip-${worker.main_store_id != null ? 'main' : 'float'}`}>
          {worker.main_store_id != null ? `Main · ${storeName(worker.main_store_id)}` : 'Float'}
        </span>
        <button type="button" className="worker-delete" title="Delete worker" onClick={onDelete}>
          ✕
        </button>
      </div>
      {nameField.error && <p className="field-error">{nameField.error}</p>}

      <div className="store-settings-row">
        <span className="store-settings-label">Max workdays/week</span>
        <input
          type="number"
          className="allowance-input"
          min="0.5"
          max="7"
          step="0.5"
          value={allowanceField.value}
          onChange={allowanceField.onChange}
          onBlur={allowanceField.onBlur}
        />
      </div>
      {allowanceField.error && <p className="field-error">{allowanceField.error}</p>}

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
    setStoreIds((ids) => {
      const next = [...ids, sid];
      return next;
    });
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
