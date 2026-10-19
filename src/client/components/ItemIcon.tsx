// Item and fluid icon (architecture §6.5, spec §3.8): the game's own texture once it is loaded, composited from the
// server's layers; until then, and for anything without a texture, a plain-colour square with two letters, the same
// colour for the same key every time (the server's fallback colour once it has answered). A placeholder has a thin
// border, and dark letters when its colour is too light for white ones (architecture §11.43).

import type { ReactElement } from 'react';
import { isFluidKey, type StuffKey } from '../../shared/keys.ts';
import { hashColor, type Rgb } from '../../shared/types/assets.ts';
import { useItemIcon } from '../assets/icons.ts';

const FLUID_PREFIX = 'fluid:';

/** From this luma (0..255) up a placeholder's white letters would not read; every `hashColor` stays below 181. */
const LIGHT_LUMA = 200;

/** `'dark'` letters on a light placeholder colour (luma 0.299 r + 0.587 g + 0.114 b at 200 or more), else `'light'`. */
export function placeholderInk(rgb: Rgb): 'dark' | 'light' {
  const [r, g, b] = rgb;
  // Thousandths, so a colour exactly on the threshold is not decided by floating-point rounding.
  return 299 * r + 587 * g + 114 * b >= LIGHT_LUMA * 1000 ? 'dark' : 'light';
}

/** The classes of a placeholder in `rgb`: `item-icon placeholder`, plus `ink-dark` when its letters are dark. */
export function placeholderClass(rgb: Rgb): string {
  return placeholderInk(rgb) === 'dark' ? 'item-icon placeholder ink-dark' : 'item-icon placeholder';
}

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

export function ItemIcon(props: { itemKey: StuffKey; size?: number }): ReactElement {
  const { itemKey } = props;
  const size = props.size ?? 24;
  const { desc, url } = useItemIcon(itemKey, size);
  const color = desc?.fallbackColor ?? hashColor(itemKey);
  const [r, g, b] = color;
  return (
    <span
      className={url === null ? placeholderClass(color) : 'item-icon'}
      role="img"
      aria-label={itemKey}
      title={itemKey}
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
