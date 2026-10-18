// Batched icon lookups (plan 03 "long lists"): every key asked for before the scheduled run goes out in one request per
// `max` keys (the server refuses more), each distinct key once, and the answer is kept for the life of the page.

import type { StuffKey } from '../../shared/keys.ts';
import { ASSET_KEYS_MAX } from '../../shared/types/api.ts';
import { hashColor, type IconDescriptor } from '../../shared/types/assets.ts';

export interface IconBatcher { get(key: StuffKey): Promise<IconDescriptor> }

interface Waiter { resolve(desc: IconDescriptor): void; reject(err: unknown): void }

/** What a key the server did not answer for shows: spec §3.8's stable plain colour. */
function fallbackDescriptor(key: StuffKey): IconDescriptor {
  return { key, layers: [], source: 'fallback', fallbackColor: hashColor(key) };
}

export function createIconBatcher(
  fetchBatch: (keys: StuffKey[]) => Promise<IconDescriptor[]>,
  opts?: { max?: number; schedule?: (run: () => void) => void },
): IconBatcher {
  const max = opts?.max ?? ASSET_KEYS_MAX;
  if (!Number.isSafeInteger(max) || max < 1) throw new RangeError(`max must be a positive integer, got ${max}`);
  const schedule = opts?.schedule ?? ((run: () => void) => { setTimeout(run, 0); });
  const cache = new Map<StuffKey, Promise<IconDescriptor>>();
  let queued = new Map<StuffKey, Waiter>();
  let scheduled = false;

  /** One request for `chunk`; a failure (or an answer that is not a list) rejects and forgets every key of it. */
  async function settle(chunk: StuffKey[], waiters: Map<StuffKey, Waiter>): Promise<void> {
    let byKey: Map<StuffKey, IconDescriptor>;
    try {
      const descs = await fetchBatch(chunk);
      byKey = new Map(descs.map((d) => [d.key, d]));
    } catch (err) {
      for (const key of chunk) {
        cache.delete(key); // forgotten before the rejection is seen, so a retry in a catch handler asks again
        waiters.get(key)!.reject(err);
      }
      return;
    }
    for (const key of chunk) waiters.get(key)!.resolve(byKey.get(key) ?? fallbackDescriptor(key));
  }

  function run(): void {
    scheduled = false;
    const waiters = queued;
    queued = new Map();
    const keys = [...waiters.keys()];
    for (let i = 0; i < keys.length; i += max) void settle(keys.slice(i, i + max), waiters);
  }

  return {
    get(key) {
      const known = cache.get(key);
      if (known) return known;
      const promise = new Promise<IconDescriptor>((resolve, reject) => { queued.set(key, { resolve, reject }); });
      cache.set(key, promise);
      if (!scheduled) {
        scheduled = true;
        schedule(run);
      }
      return promise;
    },
  };
}
