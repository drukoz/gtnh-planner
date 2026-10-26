// focus.ts's held-Enter guard (ledger ruling P2-R69a): a repeated Enter is prevented when its target is not where the press began, and let be
// where it is; a key's release starts it again; other keys are not its business; and it stops when asked. The client tests have no DOM, so the
// guard is given a stand-in for the document, and plain events.

import { describe, it, expect } from 'vitest';
import { guardHeldEnter } from '../../src/client/components/focus.ts';

type Listener = (e: KeyboardEvent) => void;

/** A stand-in for the document: the capture listeners added to it, and a way to send them a key; `send` says whether it was prevented. */
function standIn(): { doc: Document; send(type: 'keydown' | 'keyup', key: string, target: object, repeat?: boolean): boolean; listening(): number } {
  const listeners = new Map<string, Set<Listener>>();
  const doc = {
    addEventListener(type: string, listener: Listener, capture: boolean): void {
      expect(capture, 'in the capture phase').toBe(true);
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener(type: string, listener: Listener, capture: boolean): void {
      expect(capture, 'in the capture phase').toBe(true);
      listeners.get(type)?.delete(listener);
    },
  };
  const send = (type: 'keydown' | 'keyup', key: string, target: object, repeat = false): boolean => {
    let prevented = false;
    const event = { key, target, repeat, preventDefault: () => { prevented = true; } };
    for (const listener of listeners.get(type) ?? []) listener(event as unknown as KeyboardEvent);
    return prevented;
  };
  return { doc: doc as unknown as Document, send, listening: () => [...listeners.values()].reduce((n, set) => n + set.size, 0) };
}

describe('a held Enter acts once (ledger ruling P2-R69a)', () => {
  it('prevents a repeat that lands somewhere other than where the press began, and lets one held where it began repeat', () => {
    const { doc, send } = standIn();
    guardHeldEnter(doc);
    const [deleteButton, nextDelete, field] = [{ name: 'Delete' }, { name: 'next Delete' }, { name: 'field' }];
    expect(send('keydown', 'Enter', deleteButton), 'the press itself').toBe(false);
    expect(send('keydown', 'Enter', nextDelete, true), 'a repeat on the next Delete, where the press handed the focus').toBe(true);
    expect(send('keydown', 'Enter', field, true), 'and on whatever has it next').toBe(true);
    send('keyup', 'Enter', field);
    expect(send('keydown', 'Enter', field), 'a new press').toBe(false);
    expect(send('keydown', 'Enter', field, true), 'held where it began: a line break each time').toBe(false);
    expect(send('keydown', 'Enter', field, true)).toBe(false);
  });

  it('starts again from a key\'s release, and from nothing prevents every repeat', () => {
    const { doc, send } = standIn();
    guardHeldEnter(doc);
    const [a, b] = [{ name: 'a' }, { name: 'b' }];
    expect(send('keydown', 'Enter', a, true), 'a repeat with no press seen (the press began before the page listened)').toBe(true);
    send('keydown', 'Enter', a);
    send('keyup', 'Enter', a);
    expect(send('keydown', 'Enter', a, true), 'the release forgot where the last press began').toBe(true);
    send('keydown', 'Enter', b);
    expect(send('keydown', 'Enter', b, true), 'held where the new press began').toBe(false);
  });

  it('leaves every other key alone, held or not, and a release of another key does not end a held Enter', () => {
    const { doc, send } = standIn();
    guardHeldEnter(doc);
    const [a, b] = [{ name: 'a' }, { name: 'b' }];
    send('keydown', 'Enter', a);
    for (const key of [' ', 'Escape', 'a', 'ArrowDown']) {
      expect(send('keydown', key, b), key).toBe(false);
      expect(send('keydown', key, b, true), `${key} held`).toBe(false);
      send('keyup', key, b);
    }
    expect(send('keydown', 'Enter', b, true), 'the Enter held since a still began there').toBe(true);
  });

  it('stops listening when asked: both listeners go', () => {
    const { doc, send, listening } = standIn();
    const stop = guardHeldEnter(doc);
    expect(listening()).toBe(2);
    send('keydown', 'Enter', { name: 'a' });
    stop();
    expect(listening()).toBe(0);
    expect(send('keydown', 'Enter', { name: 'b' }, true), 'no guard left to prevent it').toBe(false);
  });
});
