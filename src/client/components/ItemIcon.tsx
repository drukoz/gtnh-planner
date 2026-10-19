// Item and fluid icon (architecture §6.5, spec §3.8): the game's own texture once it is loaded, composited from the
// server's layers; until then, and for anything without a texture, a plain-colour square with two letters, the same
// colour for the same key every time (the server's fallback colour once it has answered).

import type { ReactElement } from 'react';
import { isFluidKey, type StuffKey } from '../../shared/keys.ts';
import { hashColor } from '../../shared/types/assets.ts';
import { useItemIcon } from '../assets/icons.ts';

const FLUID_PREFIX = 'fluid:';

/** Two capital letters or digits from the registry name after its last ':' (a fluid: its name after 'fluid:'). */
export function placeholderLetters(key: StuffKey): string {
  const text = Array.from(ownName(key).replace(/[^\p{L}\p{N}]/gu, '')).slice(0, 2).join('').toUpperCase();
  return text === '' ? '?' : text;
}

function ownName(key: StuffKey): string {
  if (isFluidKey(key)) return key.slice(FLUID_PREFIX.length);
  const registryName = key.replace(/@[^@]*$/, '');
  return registryName.slice(registryName.lastIndexOf(':') + 1);
}

/**
 * The icon of `itemKey`; `name` (an optional addition to architecture §6.5's props, fix spec §6.4) is the good's name
 * for its tooltip and accessible name, which show the key when no name is given.
 */
export function ItemIcon(props: { itemKey: StuffKey; size?: number; name?: string }): ReactElement {
  const { itemKey } = props;
  const size = props.size ?? 24;
  const label = props.name ?? itemKey;
  const { desc, url } = useItemIcon(itemKey, size);
  const [r, g, b] = desc?.fallbackColor ?? hashColor(itemKey);
  return (
    <span
      className="item-icon"
      role="img"
      aria-label={label}
      title={label}
      data-item-key={itemKey}
      data-icon-source={desc?.source ?? 'loading'}
      style={{
        display: 'inline-flex', width: size, height: size,
        borderRadius: Math.max(2, Math.round(size / 6)), fontSize: Math.max(7, Math.round(size * 0.42)),
        ...(url === null ? { background: `rgb(${r}, ${g}, ${b})` } : {}),
      }}
    >
      {url === null
        ? placeholderLetters(itemKey)
        : <img src={url} width={size} height={size} alt="" style={{ imageRendering: 'pixelated' }} />}
    </span>
  );
}
