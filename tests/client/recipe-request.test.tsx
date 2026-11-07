// The recipe-request store (RUK-744): the page's R and U keys put a request here for the Flow view to read (RUK-T9). These cases pin the store
// outside React: nothing at first, one entry that carries the mode and a `seq` that grows with every request (so the same key twice asks twice),
// a listener told once per request and no more once unsubscribed, and `clearRecipeRequest` back to nothing.

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { clearRecipeRequest, getRecipeRequest, requestRecipes, subscribeRecipeRequest } from '../../src/client/state/recipe-request.ts';

describe('the recipe-request store', () => {
  const unsubs: Array<() => void> = [];
  const listen = (fn: () => void): void => {
    unsubs.push(subscribeRecipeRequest(fn));
  };

  beforeEach(() => {
    clearRecipeRequest();
  });
  afterEach(() => {
    while (unsubs.length > 0) unsubs.pop()!();
  });

  it('is empty until the first request', () => {
    expect(getRecipeRequest()).toBeNull();
  });

  it('keeps the mode and a seq that grows with every request, so the same mode twice asks twice', () => {
    requestRecipes('recipes');
    const first = getRecipeRequest();
    requestRecipes('recipes');
    const second = getRecipeRequest();
    expect(first?.mode).toBe('recipes'); expect(second?.mode).toBe('recipes');
    expect(second!.seq).toBeGreaterThan(first!.seq);
    requestRecipes('uses');
    expect(getRecipeRequest()).toEqual({ mode: 'uses', seq: second!.seq + 1 });
  });

  it('tells a listener once per request', () => {
    const fn = vi.fn();
    listen(fn);
    requestRecipes('recipes');
    expect(fn).toHaveBeenCalledTimes(1);
    requestRecipes('uses');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('is empty again after clearRecipeRequest', () => {
    requestRecipes('uses');
    expect(getRecipeRequest()).not.toBeNull();
    clearRecipeRequest();
    expect(getRecipeRequest()).toBeNull();
  });

  it('does not tell an unsubscribed listener', () => {
    const fn = vi.fn();
    const unsub = subscribeRecipeRequest(fn);
    requestRecipes('recipes');
    expect(fn).toHaveBeenCalledTimes(1);
    unsub();
    requestRecipes('uses');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
