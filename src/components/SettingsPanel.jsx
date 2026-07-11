import { useMemo, useRef, useState } from 'react';
import { ConfirmModal } from './Overlays';

// Settings is a full page reached from the sidebar.
// Setup order: 1) add stores, 2) add workers and link them to stores.
// Names are case-insensitive: uniqueness checks and store matching ignore case.

const norm = (s) => (s || '').trim().toLowerCase();

const STORE_DEFAULTS = {
  shift_mode: 'default',
  weekday_open: '08:00',
  weekday_close: '22:00',
  weekend_open: '09:00',
  weekend_close: '22:00',
};

export default function SettingsPage({ stores, workers, prompt, onSave, onToast }) {
  const [tempStores, setTempStores] = useState(stores);
  const [tempWorkers, setTempWorkers] = useState(workers);
  const [tab, setTab] = useState('stores'); // stores | workers
  const [newStoreName, setNewStoreName] = useState('');
  const [storeError, setStoreError] = useState(null);
  const [addingWorker, setAddingWorker] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null); // { kind: 'store'|'worker', id, name }

  const storeName = (id) => (tempStores.find((s) => s.id === id) || {}).name || `Store ${id}`;
  const mainOf = (storeId) => tempWorkers.find((w) => w.main_store_id === storeId) || null;

  const problems = useMemo(() => {
    const list = [];
    const storeNames = tempStores.map((s) => norm(s.name));
    if (storeNames.some((n) => !n)) list.push('Every store needs a name.');
    if (new Set(storeNames).size !== storeNames.length) list.push('Store names must be unique (case doesn’t matter).');
    const workerNames = tempWorkers.map((w) => norm(w.name));
    if (workerNames.some((n) => !n)) list.push('Every worker needs a name.');
    if (new Set(workerNames).size !== workerNames.length) list.push('Worker names must be unique (case doesn’t matter).');
    for (const w of tempWorkers) {
      if (!w.store_ids || w.store_ids.length === 0) list.push(`${w.name || 'A worker'} isn’t linked to any store.`);
    }
    return list;
  }, [tempStores, tempWorkers]);

  const staffingShort = tempStores.length > 0 && tempWorkers.length < tempStores.length;

  // ---------- stores ----------

  function addStore() {
    const name = newStoreName.trim();
    if (!name) return;
    if (tempStores.some((s) => norm(s.name) === norm(name))) {
      setStoreError(`“${name}” already exists — store names must be unique.`);
      return;
    }
    const id = Math.max(0, ...tempStores.map((s) => s.id)) + 1;
    setTempStores([...tempStores, { id, name, ...STORE_DEFAULTS }]);
    setNewStoreName('');
    setStoreError(null);
    setDirty(true);
  }

  function patchStore(id, patch) {
    setTempStores(tempStores.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    setDirty(true);
  }

  // Tier 1 (§8): deleting a store cascades into links — confirm modal first.
  function deleteStore(id) {
    setTempStores(tempStores.filter((s) => s.id !== id));
    setTempWorkers(
      tempWorkers.map((w) => ({
        ...w,
        store_ids: (w.store_ids || []).filter((sid) => sid !== id),
        main_store_id: w.main_store_id === id ? null : w.main_store_id,
      }))
    );
    setDirty(true);
  }

  // ---------- workers ----------

  function patchWorker(id, patch) {
    setTempWorkers(tempWorkers.map((w) => (w.id === id ? { ...w, ...patch } : w)));
    setDirty(true);
  }

  function deleteWorker(id) {
    setTempWorkers(tempWorkers.filter((w) => w.id !== id));
    setDirty(true);
  }

  function linkStore(worker, storeId) {
    if ((worker.store_ids || []).includes(storeId)) return;
    patchWorker(worker.id, { store_ids: [...(worker.store_ids || []), storeId] });
  }

  // Tier 2 (§8): clearing a link applies immediately with a 5s undo toast.
  function unlinkStore(worker, storeId) {
    const before = tempWorkers;
    const ids = (worker.store_ids || []).filter((s) => s !== storeId);
    patchWorker(worker.id, {
      store_ids: ids,
      // Removing the home store demotes a Main to Float.
      main_store_id: worker.main_store_id === storeId ? null : worker.main_store_id,
    });
    if (onToast) {
      onToast(`Removed ${worker.name}'s link to ${storeName(storeId)}`, () => {
        setTempWorkers(before);
        setDirty(true);
      });
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
    if (tempWorkers.some((w) => norm(w.name) === norm(name))) return false;
    const id = Math.max(0, ...tempWorkers.map((w) => w.id)) + 1;
    setTempWorkers([
      ...tempWorkers,
      { id, name: name.trim(), store_ids: storeIds, main_store_id: role === 'main' ? storeIds[0] : null, max_workdays: 5 },
    ]);
    setDirty(true);
    return true;
  }

  function handleSave() {
    onSave(tempStores, tempWorkers);
    setDirty(false);
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 2000);
  }

  return (
    <div className="settings-page">
      <h1 className="page-title">Settings</h1>

      {prompt && <div className="banner banner-bad">{prompt}</div>}

      {staffingShort && (
        <div className="banner banner-bad">
          Not enough workers: {tempWorkers.length} worker{tempWorkers.length === 1 ? '' : 's'} for {tempStores.length}{' '}
          stores. You need at least one worker per store (more is better).
        </div>
      )}

      <div className="settings-tabs">
        {[
          ['stores', `Stores (${tempStores.length})`],
          ['workers', `Workers (${tempWorkers.length})`],
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
            {tempStores.map((s) => {
              const main = mainOf(s.id);
              return (
                <div key={s.id} className="settings-worker-card store-card-settings">
                  <div className="worker-header">
                    <input
                      type="text"
                      className="worker-name"
                      value={s.name}
                      onChange={(e) => patchStore(s.id, { name: e.target.value })}
                    />
                    <span className="store-row-main">{main ? `Main: ${main.name}` : 'No main worker yet'}</span>
                    <button
                      type="button"
                      className="worker-delete"
                      title="Delete store"
                      onClick={() => setConfirmDelete({ kind: 'store', id: s.id, name: s.name })}
                    >
                      ✕
                    </button>
                  </div>

                  <div className="store-settings-row">
                    <span className="store-settings-label">Shift mode</span>
                    <div className="settings-seg shift-mode-seg">
                      <button
                        type="button"
                        className={(s.shift_mode || 'default') === 'default' ? 'active' : ''}
                        onClick={() => patchStore(s.id, { shift_mode: 'default' })}
                      >
                        Default
                      </button>
                      <button
                        type="button"
                        className={s.shift_mode === 'split_only' ? 'active' : ''}
                        onClick={() => patchStore(s.id, { shift_mode: 'split_only' })}
                      >
                        Split Shift Only
                      </button>
                    </div>
                  </div>

                  <div className="store-settings-row">
                    <span className="store-settings-label">Weekday hours</span>
                    <span className="store-hours-pair">
                      <input
                        type="time"
                        value={s.weekday_open || '08:00'}
                        onChange={(e) => e.target.value && patchStore(s.id, { weekday_open: e.target.value })}
                      />
                      –
                      <input
                        type="time"
                        value={s.weekday_close || '22:00'}
                        onChange={(e) => e.target.value && patchStore(s.id, { weekday_close: e.target.value })}
                      />
                    </span>
                  </div>
                  <div className="store-settings-row">
                    <span className="store-settings-label">Weekend hours</span>
                    <span className="store-hours-pair">
                      <input
                        type="time"
                        value={s.weekend_open || '09:00'}
                        onChange={(e) => e.target.value && patchStore(s.id, { weekend_open: e.target.value })}
                      />
                      –
                      <input
                        type="time"
                        value={s.weekend_close || '22:00'}
                        onChange={(e) => e.target.value && patchStore(s.id, { weekend_close: e.target.value })}
                      />
                    </span>
                  </div>
                </div>
              );
            })}
            {tempStores.length === 0 && <p className="settings-hint">No stores yet — add your first one above.</p>}
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

          {tempStores.length === 0 ? (
            <p className="settings-hint">Add stores first — workers link to stores.</p>
          ) : (
            <>
              <button type="button" className="btn btn-primary" onClick={() => setAddingWorker(true)}>
                + Add worker
              </button>

              <div className="settings-list" style={{ marginTop: 12 }}>
                {tempWorkers.map((w) => (
                  <WorkerCard
                    key={w.id}
                    worker={w}
                    stores={tempStores}
                    storeName={storeName}
                    mainOf={mainOf}
                    onRename={(name) => patchWorker(w.id, { name })}
                    onAllowance={(days) => patchWorker(w.id, { max_workdays: days })}
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
      <div className="actions">
        <button type="button" className="btn btn-primary" onClick={handleSave} disabled={problems.length > 0 || !dirty}>
          {savedFlash ? '✓ Saved' : 'Save setup'}
        </button>
      </div>

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
          stores={tempStores}
          workers={tempWorkers}
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

function WorkerCard({ worker, stores, storeName, mainOf, onRename, onAllowance, onDelete, onLink, onUnlink, onMove, onRole }) {
  const ids = worker.store_ids || [];
  const home = ids[0];
  const homeMain = home != null ? mainOf(home) : null;
  const mainBlocked = home == null || (homeMain && homeMain.id !== worker.id);

  return (
    <div className="settings-worker-card">
      <div className="worker-header">
        <input
          type="text"
          className="worker-name"
          value={worker.name}
          placeholder="Worker name"
          onChange={(e) => onRename(e.target.value)}
        />
        <span className={`chip chip-${worker.main_store_id != null ? 'main' : 'float'}`}>
          {worker.main_store_id != null ? `Main · ${storeName(worker.main_store_id)}` : 'Float'}
        </span>
        <button type="button" className="worker-delete" title="Delete worker" onClick={onDelete}>
          ✕
        </button>
      </div>

      <div className="store-settings-row">
        <span className="store-settings-label">Max workdays/week</span>
        <input
          type="number"
          className="allowance-input"
          min="0.5"
          max="7"
          step="0.5"
          value={worker.max_workdays != null ? worker.max_workdays : 5}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v)) onAllowance(Math.max(0.5, Math.min(7, Math.round(v * 2) / 2)));
          }}
        />
        <small className="settings-hint-inline">Full day = 1 · split day = 0.5</small>
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
