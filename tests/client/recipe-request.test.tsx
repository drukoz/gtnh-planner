// The recipe-request store (RUK-744): the page's R and U keys put a request here for the Flow view to read (RUK-T9). These cases pin the store
// outside React: nothing at first, one entry that carries the mode and a `seq` that grows with every request (so the same key twice asks twice),
// a listener told once per request and no more once unsubscribed, and `clearRecipeRequest` back to nothing.

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { RecipeMode, clearRecipeRequest, getRecipeRequest, requestRecipes, subscribeRecipeRequest } from '../../src/client/state/recipe-request.ts';

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
    requestRecipes(RecipeMode.Recipes);
    const first = getRecipeRequest();
    requestRecipes(RecipeMode.Recipes);
    const second = getRecipeRequest();
    expect(first?.mode).toBe(RecipeMode.Recipes); expect(second?.mode).toBe(RecipeMode.Recipes);
    expect(second!.seq).toBeGreaterThan(first!.seq);
    requestRecipes(RecipeMode.Uses);
    expect(getRecipeRequest()).toEqual({ mode: RecipeMode.Uses, seq: second!.seq + 1 });
  });

  it('tells a listener once per request', () => {
    const fn = vi.fn();
    listen(fn);
    requestRecipes(RecipeMode.Recipes);
    expect(fn).toHaveBeenCalledTimes(1);
    requestRecipes(RecipeMode.Uses);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('is empty again after clearRecipeRequest', () => {
    requestRecipes(RecipeMode.Uses);
    expect(getRecipeRequest()).not.toBeNull();
    clearRecipeRequest();
    expect(getRecipeRequest()).toBeNull();
  });

  it('does not tell an unsubscribed listener', () => {
    const fn = vi.fn();
    const unsub = subscribeRecipeRequest(fn);
    requestRecipes(RecipeMode.Recipes);
    expect(fn).toHaveBeenCalledTimes(1);
    unsub();
    requestRecipes(RecipeMode.Uses);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
