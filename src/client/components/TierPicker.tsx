// The group's voltage tier (spec §3.2): detected from the world scan unless someone picks one by hand. Label it with a
// wrapping <label>.

import type { ReactElement } from 'react';
import { TIER_NAMES } from '../../shared/gt/tiers.ts';

const FROM_WORLD = '';

export function TierPicker(props: { value: number | null; onChange(t: number | null): void }): ReactElement {
  const { value, onChange } = props;
  return (
    <select
      className="tier-picker"
      value={value === null ? FROM_WORLD : String(value)}
      onChange={(e) => {
        const picked = e.currentTarget.value;
        onChange(picked === FROM_WORLD ? null : Number(picked));
      }}
    >
      <option value={FROM_WORLD}>From world (LV until a world scan exists)</option>
      {TIER_NAMES.map((name, t) => <option key={name} value={String(t)}>{name}</option>)}
    </select>
  );
}
