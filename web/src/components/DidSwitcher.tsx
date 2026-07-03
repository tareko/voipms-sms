import { useStore } from '../store';

export function DidSwitcher() {
  const dids = useStore((s) => s.dids);
  const selectedDid = useStore((s) => s.selectedDid);
  const selectDid = useStore((s) => s.selectDid);

  if (dids.length <= 1) {
    return (
      <div className="did-switcher">
        <span className="did-label">
          {dids[0] ? formatDid(dids[0].did) : 'No SMS-capable DIDs'}
        </span>
      </div>
    );
  }

  return (
    <div className="did-switcher">
      <select
        value={selectedDid ?? ''}
        onChange={(e) => void selectDid(e.target.value)}
        title="Select your number"
      >
        {dids.map((d) => (
          <option key={d.did} value={d.did}>
            {formatDid(d.did)}
            {d.description ? ` — ${d.description}` : ''}
          </option>
        ))}
      </select>
    </div>
  );
}

function formatDid(d: string): string {
  const digits = d.replace(/\D/g, '').slice(-10);
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  return d;
}
