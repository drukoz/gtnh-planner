import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SwapRecipe, swapPatch } from '../../src/client/components/SwapRecipe.tsx';
import { defaultSettings } from '../../src/shared/project/apply-op.ts';
import type { PlanSettings } from '../../src/shared/types/plan.ts';

const coilA = { recipeId: 'assemble-coil', rawCost: 11, mapId: 'gt.recipe.assembler' };
const coilB = { recipeId: 'assemble-coil-b', rawCost: 12, mapId: 'gt.recipe.assembler' };

describe('swap recipe', () => {
  it('pins and unpins a recipe for one good', () => {
    const choices = { 't:a@0': 'r1' };
    expect(swapPatch(choices, 't:b@0', 'r2')).toEqual({ recipeChoice: { 't:a@0': 'r1', 't:b@0': 'r2' } });
    expect(choices).toEqual({ 't:a@0': 'r1' });                          // the settings' own pins are left as they are
    expect(swapPatch({ 't:a@0': 'r1', 't:b@0': 'r2' }, 't:b@0', null)).toEqual({ recipeChoice: { 't:a@0': 'r1' } });
  });
  it('lists the ways to make any good as the step panel does', () => {
    const html = (recipeChoice: PlanSettings['recipeChoice']): string => renderToStaticMarkup(
      <SwapRecipe good="t:coil@0" inUse="assemble-coil" alternatives={[coilA, coilB]} legend="Recipe for Cupronickel Coil Block"
        settings={{ ...defaultSettings(), recipeChoice }} nameOf={(k) => k} patch={() => {}} />);
    const gone = html({ 't:coil@0': 'gone' });
    expect(gone).toMatch(/<fieldset class="flow-panel-section" data-swap=""><legend class="flow-panel-title">Recipe for Cupronickel Coil Block<\/legend>/);
    expect(gone).toContain('Let the planner choose');
    expect([...gone.matchAll(/<label class="check swap-option" title="recipe ([^"]*)"><input type="radio"/g)].map((m) => m[1]))
      .toEqual(['assemble-coil', 'assemble-coil-b']);
    expect(gone).toMatch(/<label[^>]*title="recipe assemble-coil"[^>]*>(?:(?!<\/label>).)*<span class="badge">in use<\/span><\/label>/s);
    expect(gone).not.toMatch(/<label[^>]*title="recipe assemble-coil-b"[^>]*>(?:(?!<\/label>).)*in use(?:(?!<\/label>).)*<\/label>/s);
    expect(gone).toContain('Import it');
    expect(gone).toContain('The pinned recipe gone is not usable now, so the planner chose another.');
    // A pin among the usable ways is checked, even beside the "in use" badge of another recipe, and needs no note.
    const pinned = html({ 't:coil@0': 'assemble-coil-b' });
    expect(pinned).toMatch(/title="recipe assemble-coil-b"><input type="radio" name="[^"]*" checked=""/);
    expect(pinned).not.toContain('is not usable now');
  });
});
