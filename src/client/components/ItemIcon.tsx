// Placeholder item icon (architecture §6.5): a colored square with two letters, the same color for the same key every
// time. Plan 3 replaces the body with the real game texture and keeps this signature, the title and the size.

import type { ReactElement } from 'react';
import { isFluidKey, type StuffKey } from '../../shared/keys.ts';

const FLUID_PREFIX = 'fluid:';

/** 32-bit FNV-1a of the key. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Two capital letters from the registry name after its last ':' (a fluid: its name after 'fluid:'). */
function letters(key: StuffKey): string {
  const registryName = isFluidKey(key) ? key.slice(FLUID_PREFIX.length) : key.replace(/@[^@]*$/, '');
  const own = registryName.slice(registryName.lastIndexOf(':') + 1);
  const text = Array.from(own.replace(/[^\p{L}\p{N}]/gu, '')).slice(0, 2).join('').toUpperCase();
  return text === '' ? '?' : text;
}

export function ItemIcon(props: { itemKey: StuffKey; size?: number }): ReactElement {
  const { itemKey } = props;
  const size = props.size ?? 24;
  return (
    <span
      className="item-icon"
      role="img"
      aria-label={itemKey}
      title={itemKey}
      data-item-key={itemKey}
      style={{
        width: size, height: size, borderRadius: Math.max(2, Math.round(size / 6)), fontSize: Math.max(7, Math.round(size * 0.42)),
        background: `hsl(${hash(itemKey) % 360}, 45%, 55%)`,
      }}
    >
      {letters(itemKey)}
    </span>
  );
}
