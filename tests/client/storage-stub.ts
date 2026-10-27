// What the client tests put in place of a browser's localStorage (ledger ruling P2-R40: one copy for every test of a per-browser setting).
// The client project runs in node, so a test that needs storage stubs it with `vi.stubGlobal('localStorage', …)`.

/** A localStorage that keeps what it is given in `store`. */
export function keepIn(store: Map<string, string>): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => { store.set(key, value); },
    removeItem: (key) => { store.delete(key); },
  };
}

/** A storage call of a browser that refuses storage (a private window, disabled site data): it throws. */
export const refuse = (): never => { throw new Error('storage is disabled'); };
