// What a plan takes from beyond its own line and gives to other projects, as the client shows it (add-on 17 Task 9;
// design spec §3.10, architecture §11.45 (2), (4); rulings R18, OQ1, OQ3): "from <project>" and "from <farm>" rows of
// their own beside a bought row, tool wear, the byproducts credited to or taken by other projects, the banner's
// "This plan uses …" notes, a farm step's words in the step panel and the flow box, and the flow's "from <name>" import.

import { afterEach, describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { runRows, sourceNotes, takenRows } from '../../src/client/views/materials-model.ts';
import { MaterialsView } from '../../src/client/views/MaterialsView.tsx';
import { PlanBanner } from '../../src/client/views/ProjectPage.tsx';
import { RawPanel, StepPanel } from '../../src/client/views/StepPanel.tsx';
import { flowGraph, importWords } from '../../src/client/views/flow-model.ts';
import { defaultSettings, validateOp } from '../../src/shared/project/apply-op.ts';
import type { FarmStep } from '../../src/shared/types/farm.ts';
import type { Plan, PlanStep, RawInput } from '../../src/shared/types/plan.ts';
import type { Mark, Project } from '../../src/shared/types/project.ts';

/** What a reader sees: the markup without its tags and comments, entities decoded, runs of white space as one space. */
function text(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
}

const LATEX = 't:latex@0';
const step = (p: Partial<PlanStep> & Pick<PlanStep, 'id'>): PlanStep => ({
  recipeId: p.id, mapId: 'gt.recipe.assembler', machine: { mteId: 121, name: 'Basic Assembler', tier: 1 }, count: 1, owned: 0,
  runsPerSecond: 0.5, utilization: 0.5, euPerTick: 16, durationTicks: 100, overclocks: 0, inputs: [], outputs: [], alternatives: [],
  handCraft: false, warnings: [], ...p,
});
const raw = (p: Partial<RawInput> & Pick<RawInput, 'key'>): RawInput => ({ perSecond: 0.25, cost: 0.25, available: true, sources: [], ...p });
const planOf = (p: Partial<Plan>): Plan => ({
  settingsHash: 'h', exportId: 'e', tier: 1, reachable: [], unlocks: [], steps: [], flows: [], rawInputs: [], byproducts: [],
  power: { peakEUt: 0, averageEUt: 0, voltageTier: 1, amps: 0 }, buildList: [], buildSteps: [], warnings: [], status: 'ok', ...p,
});
const project = (marks: Record<string, Mark> = {}): Project => ({
  id: 'p1', name: 'Circuits', createdAt: '', createdBy: '', rev: 1, settings: defaultSettings(), world: { scanId: null, baseId: null }, placement: null, marks, notes: [],
});
const FROM_PROJECT = { kind: 'project' as const, id: 'p2', name: 'Rubber line' };

// A mixer taking latex, partly bought and partly from another project's surplus, and a saw worn by a tree farm.
const NAMES = {
  [LATEX]: 'Latex', 't:glue@0': 'Glue', 't:saw@0': 'Steel Saw', 't:resin@0': 'Sticky Resin', 't:rubber_sapling@0': 'Rubber Sapling',
  't:rubber_wood@0': 'Rubber Wood', 'fluid:methane': 'Methane',
};
const mixer = step({ id: 'mixer', machine: { mteId: 581, name: 'Mixer', tier: 1 }, mainOutput: 't:glue@0', inputs: [{ key: LATEX, amount: 2, chance: 1 }],
  outputs: [{ key: 't:glue@0', amount: 1, chance: 1 }] });
const shared = planOf({
  names: NAMES, steps: [mixer],
  rawInputs: [raw({ key: LATEX, perSecond: 0.75, cost: 0.75, leafClass: 'direct' }), raw({ key: LATEX, perSecond: 0.25, cost: 0, from: FROM_PROJECT }),
    raw({ key: 't:saw@0', perSecond: 0.001, cost: 0.002, leafClass: 'derived', upkeep: true })],
  flows: [{ from: 'raw', to: 'mixer', key: LATEX, perSecond: 1 }, { from: 'mixer', to: 'out', key: 't:glue@0', perSecond: 0.5 }],
});
const materials = (plan: Plan, marks: Record<string, Mark> = {}): string =>
  renderToStaticMarkup(<MaterialsView project={project(marks)} plan={plan} send={() => {}} me="Ann" />);
/** The markup of the materials row whose tick carries `row`. */
const rowOf = (html: string, row: string): string => new RegExp(`<li class="mat-row[^"]*"(?:(?!</li>).)*data-row="${row}"(?:(?!</li>).)*</li>`, 's').exec(html)?.[0] ?? '';

const TGS_FARM: FarmStep = {
  kind: 'tgs', tier: 1, footprint: [7, 7, 7], sapling: 't:rubber_sapling@0', tools: ['t:saw@0'],
  text: 'Tree Growth Simulator (LV): Rubber Sapling in the controller; Saw and Knife (Steel) in an input bus',
};
const tgs = step({ id: 'tgs-rubber', recipeId: 'farm-tgs-rubber', mapId: 'gt.recipe.treefarm', machine: { mteId: 15541, name: 'Tree Growth Simulator', tier: 1 },
  mainOutput: 't:rubber_wood@0', outputs: [{ key: 't:rubber_wood@0', amount: 25, chance: 1 }], farm: TGS_FARM });
const crop = step({ id: 'crop-cane', recipeId: 'farm-crop-cane', mapId: 'farm:crops', machine: { mteId: 28001, name: 'Basic Crop Manager', tier: 1 },
  mainOutput: 't:resin@0', outputs: [{ key: 't:resin@0', amount: 0.9, chance: 1 }],
  farm: { kind: 'crop', tier: 1, footprint: [11, 2, 11], crop: { id: 'cropsnh:stickyCane', name: 'Sticky Cane', stats: { growth: 1, gain: 1, resistance: 1 } }, sticks: 121,
    text: '1× Basic Crop Manager: 121 crop sticks of Sticky Cane (growth 1, gain 1, resistance 1) on Dirt, watering on' } });

afterEach(() => { vi.unstubAllGlobals(); });

describe('rows taken from another project or a farm the group runs', () => {
  it('gives a from row its own row id beside the bought row of the good, and says where it comes from', () => {
    const rows = runRows(shared, 'rate');
    expect(rows.map((r) => [r.row, r.badge, r.amount])).toEqual([
      ['run:t:latex@0', 'mined', '2,700/h'], ['run:t:latex@0:project:p2', 'from Rubber line', '900/h'], ['run:t:saw@0', 'tool wear', '3.6/h']]);
    expect(rows[1]).toMatchObject({ canExpand: false, isStop: false, usedBy: [] });         // the good's users are listed once, on its first row
    expect(rows[0]!.usedBy.map((u) => u.stepId)).toEqual(['mixer']);
    const html = materials(shared);
    expect(text(rowOf(html, 'run:t:latex@0:project:p2'))).toContain('from Rubber line');
    expect(text(rowOf(html, 'run:t:saw@0'))).toContain('tool wear');
    for (const row of ['run:t:latex@0', 'run:t:latex@0:project:p2']) expect(validateOp({ op: 'mark', row, on: true })).toBeNull();
  });

  it('ticks one row of the good and leaves the other unticked', () => {
    const html = materials(shared, { 'run:t:latex@0': { by: 'Ann', at: '2026-10-23T10:00:00.000Z' } });
    expect(rowOf(html, 'run:t:latex@0')).toContain('data-marked="true"');
    expect(rowOf(html, 'run:t:latex@0:project:p2')).toContain('data-marked="false"');
    const other = materials(shared, { 'run:t:latex@0:project:p2': { by: 'Ann', at: '2026-10-23T10:00:00.000Z' } });
    expect(rowOf(other, 'run:t:latex@0')).toContain('data-marked="false"');
    expect(rowOf(other, 'run:t:latex@0:project:p2')).toContain('data-marked="true"');
    expect(html.match(/data-row="run:t:latex@0(?::project:p2)?"/g)).toHaveLength(2);
  });

  it('names a farm the group runs', () => {
    const fromFarm = planOf({ names: NAMES, rawInputs: [raw({ key: 't:rubber_wood@0', cost: 0, from: { kind: 'farm', id: 'farm:0:t:rubber_wood@0', name: 'Crop manager' } })] });
    expect(runRows(fromFarm, 'rate').map((r) => [r.row, r.badge])).toEqual([['run:t:rubber_wood@0:farm:farm:0:t:rubber_wood@0', 'from Crop manager']]);
  });
});

describe('byproducts for other projects', () => {
  const credited = planOf({
    names: { ...NAMES, 't:y@0': 'Y' },
    byproducts: [{ key: 't:resin@0', amount: 0.5, chance: 1 }, { key: 'fluid:methane', amount: 2, chance: 1 }],
    credits: [{ to: 'p3', name: 'Electronic Circuit', key: 't:resin@0', perSecond: 0.25 }],
    drawnBy: [{ by: 'p4', name: 'Rubber line', key: 't:resin@0', perSecond: 0.1 }, { by: 'p3', name: 'Electronic Circuit', key: 'fluid:methane', perSecond: 1 }],
  });
  it('lists what the line is credited for and who takes its surplus, under its byproduct', () => {
    expect(takenRows(credited)).toEqual([
      { key: 't:resin@0', text: 'for Electronic Circuit', amount: '900/h' }, { key: 't:resin@0', text: 'taken by Rubber line', amount: '360/h' },
      { key: 'fluid:methane', text: 'taken by Electronic Circuit', amount: '3,600 L/h' }]);
    const left = /<h3 id="left-over-title">Left over<\/h3>.*?<\/section>/s.exec(materials(credited))?.[0] ?? '';
    const shown = text(left);
    expect(shown).toContain('Sticky Resin 1,800/h');
    expect(shown).toContain('for Electronic Circuit 900/h');
    expect(shown).toContain('taken by Rubber line 360/h');
    expect(shown.indexOf('for Electronic Circuit')).toBeGreaterThan(shown.indexOf('Sticky Resin'));
    expect(shown.indexOf('for Electronic Circuit')).toBeLessThan(shown.indexOf('Methane'));          // under its own byproduct
    expect(shown.indexOf('taken by Electronic Circuit')).toBeGreaterThan(shown.indexOf('Methane'));
    expect(takenRows(planOf({}))).toEqual([]);
  });
});

describe('the plan banner says what the plan uses beyond its line', () => {
  const sourced = planOf({
    names: NAMES, steps: [tgs, crop, mixer],
    rawInputs: [raw({ key: LATEX, cost: 0, from: FROM_PROJECT }),
      raw({ key: 't:rubber_wood@0', cost: 0, from: { kind: 'farm', id: 'farm:0:t:rubber_wood@0', name: 'Crop manager' } }),
      raw({ key: 't:resin@0', cost: 0, from: { kind: 'farm', id: 'farm:0:t:resin@0', name: 'Crop manager' } })],
  });
  it('notes each farm step, each farm the group runs and each good drawn from another project, in that order', () => {
    expect(sourceNotes(sourced)).toEqual([
      'uses a Tree Growth Simulator (Rubber Sapling)', 'uses a Sticky Cane crop farm', 'uses Crop manager', 'draws Latex from Rubber line']);
    expect(sourceNotes(planOf({ steps: [step({ id: 'c', farm: { ...crop.farm!, crop: { id: 'x', name: 'Aurelia', stats: { growth: 1, gain: 1, resistance: 1 } } } })] })))
      .toEqual(['uses an Aurelia crop farm']);
    expect(sourceNotes(shared)).toEqual(['draws Latex from Rubber line']);
    expect(sourceNotes(planOf({}))).toEqual([]);
  });
  it('lists them as "This plan …", with nothing else to warn about', () => {
    const html = renderToStaticMarkup(<PlanBanner plan={sourced} planError={null} planLoading={false} settings={defaultSettings()} send={() => {}} />);
    expect(html).toContain('class="plan-banner"');
    const shown = text(html);
    for (const note of sourceNotes(sourced)) expect(shown).toContain(`This plan ${note}`);
    expect(renderToStaticMarkup(<PlanBanner plan={planOf({})} planError={null} planLoading={false} settings={defaultSettings()} send={() => {}} />)).toBe('');
  });
  it('shows the shared-surplus warning among the others', () => {
    const warning = 'Rubber line spares 60/min of Latex; older projects take 45/min of it first (Glue line), so this line takes 15/min and makes or buys the rest';
    const html = renderToStaticMarkup(<PlanBanner plan={{ ...sourced, warnings: [{ code: 'surplus-shared', key: LATEX, text: warning }] }} planError={null} planLoading={false}
      settings={defaultSettings()} send={() => {}} />);
    expect(text(html)).toContain(warning);
  });
});

describe('farm steps and from imports in the flow', () => {
  const farmed = planOf({
    names: NAMES, steps: [tgs, mixer],
    rawInputs: [raw({ key: LATEX, cost: 0, perSecond: 1, from: FROM_PROJECT })],
    flows: [{ from: 'raw', to: 'mixer', key: LATEX, perSecond: 1 }, { from: 'mixer', to: 'out', key: 't:glue@0', perSecond: 0.5 },
      { from: 'tgs-rubber', to: 'sink', key: 't:rubber_wood@0', perSecond: 12.5 }],
  });
  it('shows a farm step\'s words in the step panel without asking the pack routes for its recipe', () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const html = renderToStaticMarkup(<StepPanel step={tgs} plan={farmed} settings={defaultSettings()} send={() => {}} onClose={() => {}} per="min" />);
    expect(text(html)).toContain(TGS_FARM.text);
    expect(html).toMatch(/<h4 class="flow-panel-title">Farm<\/h4>/);
    expect(fetch).not.toHaveBeenCalled();
    expect(renderToStaticMarkup(<StepPanel step={mixer} plan={farmed} settings={defaultSettings()} send={() => {}} onClose={() => {}} per="min" />))
      .not.toMatch(/<h4 class="flow-panel-title">Farm<\/h4>/);
  });
  it('writes a farm step\'s words in its flow box', () => {
    const box = flowGraph(farmed, 'min').nodes.find((n) => n.id === 'tgs-rubber');
    expect(box?.lines).toEqual(['LV · 16 EU/t · 1 machine · 50% busy', TGS_FARM.text]);
    expect(flowGraph(farmed, 'min').nodes.find((n) => n.id === 'mixer')?.lines).toEqual(['LV · 16 EU/t · 1 machine · 50% busy']);
  });
  it('names the import of a good taken from another project "from <project>", beside the bought kind when it is bought too', () => {
    const graph = flowGraph(farmed, 'min');
    const stub = graph.nodes.find((n) => n.id === 'import:t:latex@0@mixer');
    expect(stub?.rows.map((r) => r.name)).toEqual(['from Rubber line']);
    expect(stub?.leaf).toBeUndefined();
    expect(graph.edges.find((e) => e.from === 'import:t:latex@0@mixer')?.title).toBe('Latex · 60/min · import (from Rubber line) → Mixer (Glue)');
    const both = flowGraph(shared, 'min').nodes.find((n) => n.id === 'import:t:latex@0@mixer');
    expect(both?.rows.map((r) => r.name)).toEqual(['mined + from Rubber line']);
    expect(both?.leaf).toBe('direct');                                     // the bought row's kind, not the from row's none
    expect(importWords(shared)).toEqual(new Map([[LATEX, 'mined + from Rubber line'], ['t:saw@0', 'bought (made elsewhere)']]));
    const twoFarms = planOf({ rawInputs: [raw({ key: LATEX, from: FROM_PROJECT }), raw({ key: LATEX, from: { kind: 'farm', id: 'f', name: 'Crop manager' } }),
      raw({ key: 't:x@0' })] });
    expect(importWords(twoFarms)).toEqual(new Map([[LATEX, 'from Rubber line and Crop manager']]));
  });
  it('says in the step and raw panels where an import comes from', () => {
    const takes = text(renderToStaticMarkup(<StepPanel step={mixer} plan={shared} settings={defaultSettings()} send={() => {}} onClose={() => {}} per="min" />));
    expect(takes).toContain('from import (mined + from Rubber line) 60/min');
    const panel = text(renderToStaticMarkup(<RawPanel itemKey={LATEX} plan={shared} settings={defaultSettings()} per="min" send={() => {}} onClose={() => {}} />));
    expect(panel).toContain('Import · mined · 45/min');
    expect(panel).toContain("From Rubber line, another project's surplus · 15/min");
    const only = text(renderToStaticMarkup(<RawPanel itemKey={LATEX} plan={farmed} settings={defaultSettings()} per="min" send={() => {}} onClose={() => {}} />));
    expect(only).toContain("From Rubber line, another project's surplus · 60/min");
    expect(only).not.toContain('No known source in the pack');             // nothing is bought, so no sources to list
    expect(only).not.toContain('base material');
  });
});
