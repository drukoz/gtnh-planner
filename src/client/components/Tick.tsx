// A row anyone in the group can tick off (spec §3.10): a checkbox, and once ticked who did it and when. The row element
// carries `data-row` (the mark's row id) and `data-marked`, so tests and later views can find it.

import type { ReactElement, ReactNode } from 'react';
import type { Mark } from '../../shared/types/project.ts';
import { localTime } from '../format.ts';

export function Tick(props: { row: string; mark: Mark | undefined; onToggle(on: boolean): void; label: string; children?: ReactNode }): ReactElement {
  const { row, mark, onToggle, label, children } = props;
  const marked = mark !== undefined;
  return (
    <div className={marked ? 'tick marked' : 'tick'} data-row={row} data-marked={marked ? 'true' : 'false'}>
      <label className="tick-check">
        <input type="checkbox" checked={marked} onChange={(e) => onToggle(e.currentTarget.checked)} />
        <span className="tick-label">{label}</span>
      </label>
      {children}
      {mark !== undefined && <span className="tick-by">{`✓ ${mark.by}, ${localTime(mark.at)}`}</span>}
    </div>
  );
}
