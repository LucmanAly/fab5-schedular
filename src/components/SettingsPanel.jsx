import { useState } from 'react';

export default function SettingsPanel({ isOpen, cfg, stores, workers, onSave, onClose }) {
  const [tempCfg, setTempCfg] = useState(cfg);
  const [tempStores, setTempStores] = useState(stores);
  const [tempWorkers, setTempWorkers] = useState(workers);

  const mains = tempWorkers.filter((w) => w.type === 'main');
  const floats = tempWorkers.filter((w) => w.type === 'float');

  function renameStore(id, name) {
    setTempStores(tempStores.map((s) => (s.id === id ? { ...s, name } : s)));
  }

  function renameWorker(id, name) {
    setTempWorkers(tempWorkers.map((w) => (w.id === id ? { ...w, name } : w)));
  }

  function handleSave() {
    onSave(tempCfg, tempStores, tempWorkers);
    onClose();
  }

  function handleCancel() {
    setTempCfg(cfg);
    setTempStores(stores);
    setTempWorkers(workers);
    onClose();
  }

  if (!isOpen) return null;

  return (
    <>
      <div className="settings-backdrop" onClick={handleCancel} />
      <div className="settings-panel">
        <div className="settings-header">
          <h2>Settings</h2>
          <button type="button" className="settings-close" onClick={handleCancel} title="Close settings">
            ✕
          </button>
        </div>

        <div className="settings-content">
          {/* Configuration section */}
          <div className="settings-section">
            <h3 className="settings-section-title">Schedule Rules</h3>

            <div className="settings-field">
              <label>
                <span>Number of stores</span>
                <input
                  type="number"
                  min="1"
                  max="30"
                  value={tempCfg.numStores}
                  onChange={(e) => {
                    const newNum = Math.max(1, Number(e.target.value) || 1);
                    if (newNum !== tempCfg.numStores) {
                      // Resize stores and workers when count changes
                      const sized = resizeSetupLocal(newNum, tempCfg.numFloats, tempStores, tempWorkers);
                      setTempCfg({ ...tempCfg, numStores: newNum });
                      setTempStores(sized.stores);
                      setTempWorkers(sized.workers);
                    }
                  }}
                />
              </label>
            </div>

            <div className="settings-field">
              <label>
                <span>Floating workers</span>
                <input
                  type="number"
                  min="0"
                  max="30"
                  value={tempCfg.numFloats}
                  onChange={(e) => {
                    const newNum = Math.max(0, Number(e.target.value) || 0);
                    if (newNum !== tempCfg.numFloats) {
                      // Resize when float count changes
                      const sized = resizeSetupLocal(tempCfg.numStores, newNum, tempStores, tempWorkers);
                      setTempCfg({ ...tempCfg, numFloats: newNum });
                      setTempStores(sized.stores);
                      setTempWorkers(sized.workers);
                    }
                  }}
                />
              </label>
            </div>

            <div className="settings-field">
              <span>Max consecutive days before rest</span>
              <div className="settings-seg">
                {[2, 3, 4].map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={tempCfg.maxConsec === n ? 'active' : ''}
                    onClick={() => setTempCfg({ ...tempCfg, maxConsec: n })}
                  >
                    {n} days
                  </button>
                ))}
              </div>
              <small>After this many days, a rest day is required</small>
            </div>
          </div>

          {/* Stores section */}
          <div className="settings-section">
            <h3 className="settings-section-title">Stores</h3>
            <div className="settings-list">
              {tempStores.map((s) => {
                const main = mains.find((m) => m.store_id === s.id);
                return (
                  <div key={s.id} className="settings-list-item">
                    <div className="settings-pair">
                      <input
                        type="text"
                        value={s.name}
                        onChange={(e) => renameStore(s.id, e.target.value)}
                        placeholder={`Store ${s.id}`}
                      />
                      <span className="settings-pair-arrow">→</span>
                      <input
                        type="text"
                        value={main ? main.name : ''}
                        onChange={(e) => main && renameWorker(main.id, e.target.value)}
                        placeholder={`Main worker`}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Workers section */}
          <div className="settings-section">
            <h3 className="settings-section-title">Floating Workers</h3>
            {floats.length === 0 ? (
              <p className="settings-hint">No floating workers configured. Increase the count above to add them.</p>
            ) : (
              <div className="settings-list">
                {floats.map((f) => (
                  <div key={f.id} className="settings-list-item">
                    <input
                      type="text"
                      value={f.name}
                      onChange={(e) => renameWorker(f.id, e.target.value)}
                      placeholder={`Float ${f.id}`}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="settings-actions">
          <button type="button" className="btn btn-ghost" onClick={handleCancel}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={handleSave}>
            Save Settings
          </button>
        </div>
      </div>
    </>
  );
}

// Helper to resize setup when counts change (copied from App.jsx)
function resizeSetupLocal(numStores, numFloats, prevStores, prevWorkers) {
  const stores = Array.from({ length: numStores }, (_, i) => {
    const id = i + 1;
    return prevStores.find((s) => s.id === id) || { id, name: `Store ${id}` };
  });
  const mains = stores.map((s) => {
    const prev = prevWorkers.find((w) => w.type === 'main' && w.store_id === s.id);
    return prev || { id: 100 + s.id, name: `Main ${s.id}`, type: 'main', store_id: s.id };
  });
  const prevFloats = prevWorkers.filter((w) => w.type === 'float');
  const floats = Array.from({ length: numFloats }, (_, i) => prevFloats[i] || { id: 200 + i + 1, name: `Float ${i + 1}`, type: 'float', store_id: null });
  return { stores, workers: [...mains, ...floats] };
}
