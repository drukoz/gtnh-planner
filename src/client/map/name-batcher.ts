// Pack names asked for in bulk (architecture §11.43(f)): the keys asked before the scheduled run go out together, each
// distinct key once, at most `max` per request, so the base's 1,536 storage keys cost 4 requests rather than one each.
// A key the pack cannot name is never asked again; the keys of a failed request are forgotten, so a later ask retries.

import type { StuffKey } from '../../shared/keys.ts';
import { ASSET_KEYS_MAX } from '../../shared/types/api.ts';

export interface NameBatcher { ask(key: StuffKey): void }

/**
 * `fetchBatch` answers its keys' names in their order (null: the pack does not hold that key); `onAnswer` runs once per
 * answered request with the keys it named. `schedule` defaults to `setTimeout(run, 0)`, so every key a render's effects
 * ask goes out in the same requests.
 */
export function createNameBatcher(
  fetchBatch: (keys: StuffKey[]) => Promise<Array<string | null>>,
  onAnswer: (names: ReadonlyMap<StuffKey, string>) => void,
  opts: { max?: number; schedule?: (run: () => void) => void } = {},
): NameBatcher {
  const max = opts.max ?? ASSET_KEYS_MAX;
  const schedule = opts.schedule ?? ((run: () => void) => { setTimeout(run, 0); });
  /** Waiting, on their way, named or unknown to the pack: never sent again. */
  const asked = new Set<StuffKey>();
  let waiting: StuffKey[] = [];

  async function send(keys: StuffKey[]): Promise<void> {
    let answer: Array<string | null>;
    try {
      answer = await fetchBatch(keys);
    } catch {
      for (const key of keys) asked.delete(key);
      return;
    }
    const names = new Map<StuffKey, string>();
    keys.forEach((key, i) => {
      const name = answer[i];
      if (typeof name === 'string') names.set(key, name);
    });
    onAnswer(names);
  }

  function run(): void {
    const keys = waiting;
    waiting = [];
    for (let start = 0; start < keys.length; start += max) void send(keys.slice(start, start + max));
  }

  return {
    ask(key) {
      if (asked.has(key)) return;
      asked.add(key);
      if (waiting.push(key) === 1) schedule(run);
    },
  };
}
