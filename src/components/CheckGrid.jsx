// Reusable per-day checkbox grid (Last Week + Leave Requests). Mobile: horizontal scroll, sticky name column.
export default function CheckGrid({ workers, labels, value, onChange, tone }) {
  function toggle(workerId, dayIdx) {
    const next = { ...value };
    const row = [...(next[workerId] || [false, false, false, false, false, false, false])];
    row[dayIdx] = !row[dayIdx];
    next[workerId] = row;
    onChange(next);
  }

  return (
    <div className="grid-wrap">
      <table className={`grid checkgrid tone-${tone}`}>
        <thead>
          <tr>
            <th className="sticky-col">Worker</th>
            {labels.map((l) => (
              <th key={l}>{l}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {workers.map((w) => (
            <tr key={w.id}>
              <td className="sticky-col name-cell">
                {w.name}
                <span className={`chip chip-${w.type}`}>{w.type}</span>
              </td>
              {labels.map((_, d) => {
                const on = value[w.id] && value[w.id][d];
                return (
                  <td key={d}>
                    <button
                      type="button"
                      className={`checkcell ${on ? 'on' : ''}`}
                      aria-pressed={!!on}
                      aria-label={`${w.name}, ${labels[d]}`}
                      onClick={() => toggle(w.id, d)}
                    >
                      {on ? '✓' : ''}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
