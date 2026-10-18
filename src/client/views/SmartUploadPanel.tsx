// The smart upload's preview (spec §3.4, architecture §11.12): while the browser reads the picked world, how far it
// has got; then the areas it would send, the radius around each spot (adjustable) and the total, before anything is
// sent. Only level.dat and the trimmed region files go; player files stay on the friend's computer.

import type { ReactElement } from 'react';
import { dimLabel } from '../world/pick-files.ts';
import { formatSize, plural, SMART_RADIUS, type SmartPlan } from '../world/smart.ts';

const BLOCKS_PER_CHUNK = 16;

export function SmartUploadPanel(props: {
  reading: { done: number; total: number } | null; plan: SmartPlan | null; radius: number; busy: boolean;
  onRadius(r: number): void; onUpload(): void;
}): ReactElement {
  const { reading, plan, radius, busy, onRadius, onUpload } = props;
  const hasRegion = plan !== null && plan.items.some((i) => i.rel !== 'level.dat');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <h3 style={{ margin: 0 }}>Smart upload (recommended)</h3>
      <p className="muted" style={{ margin: 0 }}>
        Sends only the chunks around players, the spawn, claimed chunks and chunks people have spent time in.
      </p>
      {reading !== null && <p className="muted" role="status" style={{ margin: 0 }}>{`Reading your world… ${reading.done} / ${reading.total} region files`}</p>}
      {reading === null && plan === null && <p className="muted" style={{ margin: 0 }}>Working out what to send…</p>}
      {plan !== null && (plan.areas.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          No players, spawn, claims or lived-in chunks were found in the picked region files. Use “Advanced: whole dimensions” below instead.
        </p>
      ) : (
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          {plan.areas.map((a) => (
            <li key={`${a.dim}:${a.x}:${a.z}`} data-testid="smart-area">
              {`${dimLabel(a.dim)} around ${a.x}, ${a.z} — ${a.why} — ${plural(a.chunks, 'chunk')}`}
            </li>
          ))}
        </ul>
      ))}
      <div className="row" style={{ gap: 12 }}>
        <input
          type="range" min={SMART_RADIUS.min} max={SMART_RADIUS.max} step={1} value={radius} aria-label="Radius in chunks" disabled={busy}
          onChange={(e) => onRadius(Number(e.currentTarget.value))}
        />
        <span>{`${plural(radius, 'chunk')} (${radius * BLOCKS_PER_CHUNK} blocks) around each spot`}</span>
      </div>
      {plan !== null && <p data-testid="smart-total" style={{ margin: 0 }}>{`To send: ${plural(plan.chunks, 'chunk')}, ${formatSize(plan.bytes)}`}</p>}
      <p className="muted" style={{ margin: 0 }}>Only level.dat and the trimmed region files are sent; player files stay on your computer.</p>
      <div>
        <button type="button" className="primary" disabled={reading !== null || busy || !hasRegion} data-testid="upload-button" onClick={onUpload}>
          Upload and scan
        </button>
      </div>
    </div>
  );
}
