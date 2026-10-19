import { describe, it, expect } from 'vitest';
import { createNameBatcher } from '../../src/client/map/name-batcher.ts';
import { ASSET_KEYS_MAX } from '../../src/shared/types/api.ts';

describe('createNameBatcher', () => {
  it('names are batched', async () => {
    const calls: string[][] = [];
    const answers: string[][] = [];
    let down = false;
    const flush = () => new Promise((r) => setTimeout(r, 0));
    const b = createNameBatcher(async (keys) => {
      calls.push(keys);
      if (down) throw new Error('down');
      return keys.map((k) => (k === 'x:unknown@0' ? null : `Name ${k}`));
    }, (names) => answers.push([...names.keys()]), { max: 2, schedule: (run) => queueMicrotask(run) });
    for (const k of ['a:a@0', 'b:b@0', 'c:c@0', 'a:a@0', 'x:unknown@0']) b.ask(k);
    await flush();
    expect(calls).toEqual([['a:a@0', 'b:b@0'], ['c:c@0', 'x:unknown@0']]);
    expect(answers).toEqual([['a:a@0', 'b:b@0'], ['c:c@0']]);
    b.ask('a:a@0'); b.ask('x:unknown@0'); await flush();
    expect(calls).toHaveLength(2);                               // answered and unknown keys are not asked again
    down = true; b.ask('d:d@0'); await flush();
    down = false; b.ask('d:d@0'); await flush();
    expect(calls.slice(2)).toEqual([['d:d@0'], ['d:d@0']]);      // a failed key is asked again
    expect(answers.at(-1)).toEqual(['d:d@0']);
  });

  it('by default sends after the current task, at most ASSET_KEYS_MAX keys per request, and answers each request once', async () => {
    const sizes: number[] = [];
    let answered = 0;
    const b = createNameBatcher(async (keys) => {
      sizes.push(keys.length);
      return keys.map(() => null);
    }, () => { answered++; });
    for (let i = 0; i < 1536; i++) b.ask(`m:item${i}@0`);   // the base's storage list (RC13)
    await Promise.resolve();
    expect(sizes).toEqual([]);                                  // nothing goes out before the scheduled run
    await new Promise((r) => setTimeout(r, 0));
    expect(sizes).toEqual([ASSET_KEYS_MAX, ASSET_KEYS_MAX, ASSET_KEYS_MAX, 1536 - 3 * ASSET_KEYS_MAX]);
    expect(answered).toBe(4);                                   // one answer per request, even when it names nothing
  });
});
