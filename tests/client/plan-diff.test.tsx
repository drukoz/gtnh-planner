// Ruling P16: a .tsx file, as the client vitest project runs only tests/client/**/*.test.tsx.
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { changeLines, planChange } from '../../src/client/views/plan-diff.ts';
import { dismissChange, WhatChanged } from '../../src/client/views/WhatChanged.tsx';
import { FlowView } from '../../src/client/views/FlowView.tsx';
import { MaterialsView } from '../../src/client/views/MaterialsView.tsx';
import type { Plan, PlanStep } from '../../src/shared/types/plan.ts';

/** What a reader sees: the markup without its tags and comments, entities decoded. */
function text(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, '')
    .replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

const step = (p: Partial<PlanStep> & Pick<PlanStep, 'id'>): PlanStep => ({
  recipeId: p.id, mapId: 'gt.recipe.assembler', machine: { mteId: 121, name: 'Basic Assembler', tier: 1 }, count: 1, owned: 0,
  runsPerSecond: 0.5, utilization: 0.5, euPerTick: 16, durationTicks: 100, overclocks: 0, inputs: [], outputs: [], alternatives: [],
  handCraft: false, warnings: [], ...p,
});
const planOf = (p: Partial<Plan>): Plan => ({
  settingsHash: 'h', exportId: 'e', tier: 2, reachable: [], unlocks: [], steps: [], flows: [], rawInputs: [], byproducts: [],
  power: { peakEUt: 0, averageEUt: 0, voltageTier: 2, amps: 0 }, buildList: [], buildSteps: [], warnings: [], status: 'ok', ...p,
});
const names = { 'fluid:ethylene': 'Ethylene', 't:pe_bar@0': 'PE Bar', 'fluid:molten.polyethylene': 'Molten Polyethylene', 't:board@0': 'Circuit Board', 'fluid:glue': 'Glue' };
const PE = 'fluid:molten.polyethylene';
const board = (inputs: PlanStep['inputs']): PlanStep => step({ id: 'board', mainOutput: 't:board@0', inputs, outputs: [{ key: 't:board@0', amount: 1, chance: 1 }] });

// Before: a reactor makes molten PE from bought ethylene. After: the line buys PE bars and melts them, and its board step
// now takes glue nothing supplies.
const reactor = step({ id: 'reactor-ethylene', machine: { mteId: 421, name: 'Chemical Reactor', tier: 2 }, mainOutput: PE,
  inputs: [{ key: 'fluid:ethylene', amount: 144, chance: 1 }], outputs: [{ key: PE, amount: 144, chance: 1 }] });
const before = planOf({
  settingsHash: 'a', names, steps: [reactor, board([{ key: PE, amount: 144, chance: 1 }])],
  rawInputs: [{ key: 'fluid:ethylene', perSecond: 72, cost: 0.072, available: true, sources: [], leafClass: 'derived' }],
  flows: [{ from: 'raw', to: 'reactor-ethylene', key: 'fluid:ethylene', perSecond: 72 }, { from: 'reactor-ethylene', to: 'board', key: PE, perSecond: 72 },
    { from: 'board', to: 'out', key: 't:board@0', perSecond: 0.5 }],
});
const extract = step({ id: 'extract-pe', machine: { mteId: 511, name: 'Fluid Extractor', tier: 2 }, mainOutput: PE,
  inputs: [{ key: 't:pe_bar@0', amount: 1, chance: 1 }], outputs: [{ key: PE, amount: 144, chance: 1 }] });
const after = planOf({
  settingsHash: 'b', names, steps: [board([{ key: PE, amount: 144, chance: 1 }, { key: 'fluid:glue', amount: 100, chance: 1 }]), extract],
  rawInputs: [{ key: 't:pe_bar@0', perSecond: 0.5, cost: 0.5, available: true, sources: [], leafClass: 'derived' }],
  flows: [{ from: 'raw', to: 'extract-pe', key: 't:pe_bar@0', perSecond: 0.5 }, { from: 'extract-pe', to: 'board', key: PE, perSecond: 72 },
    { from: 'board', to: 'out', key: 't:board@0', perSecond: 0.5 }],
});

describe('what changed between two plans', () => {
  it('lists the imports and steps that came and went, and the new problems', () => {
    const change = planChange(before, after);
    expect(change).toMatchObject({ importsAdded: ['t:pe_bar@0'], importsRemoved: ['fluid:ethylene'], stepsAdded: ['extract-pe'], stepsRemoved: ['reactor-ethylene'] });
    expect(change.issuesNew).toMatchObject([{ code: 'orphan-input', key: 'fluid:glue', stepId: 'board' }]);
    expect(planChange(after, after)).toEqual({ importsAdded: [], importsRemoved: [], stepsAdded: [], stepsRemoved: [], issuesNew: [] });
    expect(planChange(after, before).issuesNew).toEqual([]);                 // a problem that went away is no new problem
  });
  it('says it in words, naming each step by its machine and product', () => {
    expect(changeLines(before, after, planChange(before, after))).toEqual([
      'New imports: PE Bar',
      'No longer imported: Ethylene',
      'New steps: Fluid Extractor (Molten Polyethylene)',
      'Steps no longer needed: Chemical Reactor (Molten Polyethylene)',
      'New problem: Nothing supplies Glue to Basic Assembler (Circuit Board): it needs 180,000 L/h and the plan neither makes nor buys it.',
    ]);
    const served = { ...after, warnings: [{ code: 'orphan-input', key: 'fluid:glue', stepId: 'board', text: 'The server says glue is missing.' }] };
    expect(changeLines(before, served, planChange(before, served)).at(-1)).toBe('New problem: The server says glue is missing.');
  });
  it('shows a dismissible note above the flow and the materials, and none when nothing changed', () => {
    const note = text(renderToStaticMarkup(<WhatChanged previous={before} plan={after} />));
    expect(note).toContain('What changed');
    expect(note).toContain('New steps: Fluid Extractor (Molten Polyethylene)');
    expect(note).toContain('Dismiss');
    expect(renderToStaticMarkup(<WhatChanged previous={null} plan={after} />)).toBe('');
    expect(renderToStaticMarkup(<WhatChanged previous={after} plan={after} />)).toBe('');
    const project = { id: 'p', name: 'x', createdAt: '', createdBy: '', rev: 3, settings: { mode: 'rate', per: 'hour', stopItems: [], expandItems: [] },
      world: { scanId: null, baseId: null }, placement: null, notes: [], marks: {} } as never;
    expect(text(renderToStaticMarkup(<FlowView project={project} plan={after} previousPlan={before} send={() => {}} me="Ann" />))).toContain('No longer imported: Ethylene');
    expect(text(renderToStaticMarkup(<MaterialsView project={project} plan={after} previousPlan={before} send={() => {}} me="Ann" />))).toContain('No longer imported: Ethylene');
    expect(text(renderToStaticMarkup(<MaterialsView project={project} plan={after} send={() => {}} me="Ann" />))).not.toContain('What changed');
  });
  it('says nothing for the first plan of a target', () => {
    // Plan 09's final review: the project's first target pick replaced a plan of nothing, so every step read as new.
    // Nor is a plan of a new target a change of the old one, or one that plans at last.
    const target = { target: 't:board@0' };
    const noTarget = planOf({ settingsHash: 'none', status: 'empty' });
    expect(renderToStaticMarkup(<WhatChanged previous={noTarget} plan={{ ...after, ...target }} />)).toBe('');
    const blocked = planOf({ settingsHash: 'lv', status: 'infeasible', ...target });
    expect(renderToStaticMarkup(<WhatChanged previous={blocked} plan={{ ...after, ...target }} />)).toBe('');
    expect(renderToStaticMarkup(<WhatChanged previous={{ ...before, target: 't:wire@0' }} plan={{ ...after, ...target }} />)).toBe('');
    // The same target: what changed, as before.
    expect(text(renderToStaticMarkup(<WhatChanged previous={{ ...before, ...target }} plan={{ ...after, ...target }} />))).toContain('New steps: Fluid Extractor');
  });
  it('hides a dismissed change until the next one, also when the same settings come round again', () => {
    // Dismissals were keyed by "<old hash>><new hash>", so a setting switched on, off and on again (or the same change in
    // another project) never showed its note again. They follow the plan a change replaced.
    const shown = (previous: Plan, plan: Plan): boolean => text(renderToStaticMarkup(<WhatChanged previous={previous} plan={plan} />)).includes('What changed');
    const [first, second] = [{ ...before }, { ...after }];
    expect(shown(first, second)).toBe(true);
    dismissChange(first);
    expect(shown(first, second)).toBe(false);
    expect(shown(first, { ...after })).toBe(false);                 // the same change, refetched: still dismissed
    expect(shown(second, { ...before })).toBe(true);                // switched back: a new change
    expect(shown({ ...before }, { ...after })).toBe(true);          // and on again, or the same change elsewhere
  });
});
