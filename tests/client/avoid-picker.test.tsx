import { describe, it, expect, vi } from 'vitest';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AvoidPicker, type AvoidPickerProps } from '../../src/client/components/AvoidPicker.tsx';
import { ItemSearch } from '../../src/client/components/ItemSearch.tsx';
import { SettingsPanel } from '../../src/client/views/SettingsPanel.tsx';
import { avoidLabel, avoidWith, avoidWithout, materialFor, materialSuggestions } from '../../src/client/views/settings-model.ts';
import { defaultSettings, validateOp } from '../../src/shared/project/apply-op.ts';
import type { PackInfo } from '../../src/shared/types/api.ts';

const materials = [
  { name: 'Copper', label: 'Copper' }, { name: 'AnnealedCopper', label: 'Annealed Copper' }, { name: 'Silver', label: 'Silver' },
  { name: 'StainlessSteel', label: 'Stainless Steel' }, { name: 'Tin', label: 'Tin' },
].sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
const names: Record<string, string> = { 't:tin_cable@0': '1x Tin Cable', 'fluid:molten.silver': 'Molten Silver' };
const nameOf = (key: string): string => names[key] ?? key;

function props(p: Partial<AvoidPickerProps>): AvoidPickerProps {
  return { avoid: [], materials, nameOf, send: () => {}, remember: () => {}, ...p };
}

/** Every element in `node` (a tree of unrendered elements) that `match` accepts, depth first. */
function findAll(node: ReactNode, match: (e: ReactElement<Record<string, unknown>>) => boolean): Array<ReactElement<Record<string, unknown>>> {
  if (Array.isArray(node)) return node.flatMap((n: ReactNode) => findAll(n, match));
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [...(match(node) ? [node] : []), ...findAll(node.props.children as ReactNode, match)];
}

describe('avoid model', () => {
  it('suggests materials by name or display name, ignoring case, exact and starting matches first', () => {
    expect(materialSuggestions(materials, 'copper').map((m) => m.name)).toEqual(['Copper', 'AnnealedCopper']);
    expect(materialSuggestions(materials, 'stainless s').map((m) => m.name)).toEqual(['StainlessSteel']);
    expect(materialSuggestions(materials, 'STAINLESSSTEEL').map((m) => m.name)).toEqual(['StainlessSteel']);
    expect(materialSuggestions(materials, 't').map((m) => m.name)).toEqual(['Tin', 'StainlessSteel']);   // starting with it, then holding it
    expect(materialSuggestions(materials, 'e', 2)).toHaveLength(2);
    expect(materialSuggestions(materials, ' ')).toEqual([]);
    expect(materialFor(materials, 'stainless steel')?.name).toBe('StainlessSteel');
    expect(materialFor(materials, 'Stainless')).toBeUndefined();
  });
  it('adds an entry once, at the end, within the limits the server takes, and removes one', () => {
    expect(avoidWith(['Tin'], ' Silver ')).toEqual(['Tin', 'Silver']);
    expect(avoidWith(['Tin'], 'Tin')).toBeNull();
    expect(avoidWith(['Tin'], '   ')).toBeNull();
    expect(avoidWith([], 'x'.repeat(301))).toBeNull();
    expect(avoidWith(Array.from({ length: 50 }, (_, i) => `t:x@${i}`), 'Tin')).toBeNull();
    expect(avoidWithout(['Tin', 'Silver', 't:x@0'], 'Silver')).toEqual(['Tin', 't:x@0']);
    for (const avoid of [avoidWith(Array.from({ length: 49 }, (_, i) => `t:x@${i}`), 'x'.repeat(300)), avoidWithout(['Tin'], 'Tin')]) {
      expect(validateOp({ op: 'settings', patch: { avoid } })).toBeNull();
    }
  });
  it('labels a material by its display name and an item or fluid by its own', () => {
    expect([avoidLabel('StainlessSteel', materials, nameOf), avoidLabel('t:tin_cable@0', materials, nameOf), avoidLabel('Unobtainium', materials, nameOf)])
      .toEqual(['Stainless Steel', '1x Tin Cable', 'Unobtainium']);
  });
});

describe('AvoidPicker', () => {
  it('shows one chip per entry, each with a remove button', () => {
    const html = renderToStaticMarkup(<AvoidPicker {...props({ avoid: ['StainlessSteel', 't:tin_cable@0', 'fluid:molten.silver', 'Unobtainium'] })} />);
    const chips = [...html.matchAll(/<li[^>]*data-avoid-entry="([^"]*)"[^>]*>.*?<\/li>/g)];
    expect(chips.map((m) => m[1])).toEqual(['StainlessSteel', 't:tin_cable@0', 'fluid:molten.silver', 'Unobtainium']);
    for (const label of ['Stainless Steel', '1x Tin Cable', 'Molten Silver', 'Unobtainium']) expect(html).toContain(`aria-label="Remove ${label}"`);
    expect(chips[1]?.[0]).toContain('data-item-key="t:tin_cable@0"');   // items and fluids show their icon
    expect(chips[0]?.[0]).not.toContain('data-item-key');
    expect(renderToStaticMarkup(<AvoidPicker {...props({})} />)).not.toContain('data-avoid-entry');
  });
  it('removing a chip sends one settings op with the rest of the list', () => {
    const send = vi.fn();
    const picker = AvoidPicker(props({ avoid: ['Tin', 't:tin_cable@0', 'Silver'], send }));
    const remove = findAll(picker, (e) => e.type === 'button' && String(e.props['aria-label']).startsWith('Remove '));
    expect(remove.map((b) => b.props['aria-label'])).toEqual(['Remove Tin', 'Remove 1x Tin Cable', 'Remove Silver']);
    (remove[1]!.props.onClick as () => void)();
    expect(send).toHaveBeenCalledWith([{ op: 'settings', patch: { avoid: ['Tin', 'Silver'] } }]);
  });
  it('adds a material (by its exact name, however typed) or an item at the end of the list, and nothing listed already', () => {
    const send = vi.fn();
    const remember = vi.fn();
    const picker = AvoidPicker(props({ avoid: ['Tin'], send, remember }));
    const [box] = findAll(picker, (e) => typeof e.props.onAdd === 'function');
    expect((box!.props.materials as typeof materials).map((m) => m.name)).toEqual(['AnnealedCopper', 'Copper', 'Silver', 'StainlessSteel']);
    const onAdd = box!.props.onAdd as (entry: string) => boolean;
    expect(onAdd('Silver')).toBe(true);
    expect(onAdd('stainless steel')).toBe(true);
    expect(onAdd('tin')).toBe(false);                                   // the listed Tin, spelled otherwise
    expect(onAdd('Unobtainium')).toBe(true);                            // as typed: the plan says it matches nothing
    const [search] = findAll(picker, (e) => e.type === ItemSearch);
    const hit = { key: 't:tin_cable@0', name: '1x Tin Cable', kind: 'item' as const, produced: true };
    (search!.props.onPick as (h: typeof hit) => void)(hit);
    expect(remember).toHaveBeenCalledWith(hit);
    expect(send.mock.calls.map(([ops]) => ops[0].patch.avoid)).toEqual([
      ['Tin', 'Silver'], ['Tin', 'StainlessSteel'], ['Tin', 'Unobtainium'], ['Tin', 't:tin_cable@0']]);
    expect(send.mock.calls.every(([ops]) => ops.length === 1 && ops[0].op === 'settings')).toBe(true);
  });
  it('sits in the settings panel under "Avoid materials", with the pack\'s materials', () => {
    const info: PackInfo = { manifest: {} as never, mapCount: 0, recipeCount: 0, itemCount: 0, dimensions: [], capabilities: [], exclusionRules: [], materials };
    const project = { id: 'p', name: 'x', createdAt: '', createdBy: '', rev: 0, settings: { ...defaultSettings(), avoid: ['StainlessSteel'] },
      world: { scanId: null, baseId: null }, placement: null, marks: {}, notes: [] };
    const html = renderToStaticMarkup(<SettingsPanel info={info} project={project} plan={null} send={() => {}} me="Ann" />);
    expect(html).toContain('<h3>Avoid materials</h3>');
    // What the list covers, and what it does not (final review): the line's steps, not the machines' own build.
    expect(html).toContain('Kept out of every step of the line; a step that cannot do without one at this tier is flagged. The machines you build may still contain them.');
    expect(html).toContain('aria-label="Remove Stainless Steel"');
    expect(html).toContain('aria-label="Avoid a material"');
  });
});
