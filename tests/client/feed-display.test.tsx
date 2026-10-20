// The structured feeding configuration in the browser (architecture §11 entry 51): the Connections view's interface boxes
// show a routed pipe's chips and an ME interface's patterns from `LayoutBlock.feed`, an ME Export Bus on a cable shows on
// the box of the machine it faces, the 3D view's hover and click info say the same words as the configure steps, and
// the map marks such a block configured.

import { describe, expect, it } from 'vitest';
import { connectionsGraph } from '../../src/client/connections/model.ts';
import { overlayShapes } from '../../src/client/map/layout-overlay.ts';
import { hoverText, pickInfo } from '../../src/client/three/scene-data.ts';
import type { Layout, LayoutBlock } from '../../src/shared/types/layout.ts';
import { connLayout, connPlan } from './connections-fixture.ts';

const EXPORT_BUS = 'appliedenergistics2:item.ItemMultiPart@260';
const IN = 't:in@0', DUST = 't:dust@0', INGOT = 't:ingot@0';

/** `layout` with each block `change` maps differently. */
function changed(layout: Layout, change: (b: LayoutBlock) => LayoutBlock): Layout {
  return { ...layout, blocks: layout.blocks.map((b) => change(structuredClone(b))) };
}

/** The routed line with structured chips instead of the chips' sentence. */
function routedWithFeed(): Layout {
  return changed(connLayout('routed'), (b) => {
    if (b.role !== 'chip_pipe') return b;
    const { config: _sentence, ...rest } = b;
    const [takes, makes] = b.label.includes('Macerator') ? [IN, DUST] : [DUST, INGOT];
    return { ...rest, feed: { chips: [{ kind: 'responder', filter: { mode: 'whitelist', keys: [takes] } },
      { kind: 'extractor', filter: { mode: 'whitelist', keys: [makes] } }] } };
  });
}

describe('the feeding configuration on screen', () => {
  it("shows a routed pipe's chips and an ME interface's patterns in the Connections view's interface boxes", () => {
    const routed = connectionsGraph(routedWithFeed(), connPlan, 'min');
    expect(routed.nodes.filter((n) => n.kind === 'interface').map((n) => n.lines)).toEqual([
      ['chips: Item Responder Chip (whitelist: Raw Input) + Item Extractor Chip (whitelist: Titanium Dust)'],
      ['chips: Item Responder Chip (whitelist: Titanium Dust) + Item Extractor Chip (whitelist: Titanium Ingot)']]);

    const ae2 = changed(connLayout('ae2'), (b) => {
      if (b.role !== 'interface') return b;
      const { config: _sentence, ...rest } = b;
      return { ...rest, feed: { interface: { patterns: [{ inputs: [{ key: IN, amount: 1 }], outputs: [{ key: DUST, amount: 1 }] }], blocking: true } } };
    });
    expect(connectionsGraph(ae2, connPlan, 'min').nodes.find((n) => n.id === 'iface:0,64,1')!.lines)
      .toEqual(['1 processing pattern', 'pattern 1× Raw Input → 1× Titanium Dust', 'blocking mode on']);
  });

  it('shows an ME Export Bus on a cable as a row of the machine it faces', () => {
    // the assembler makes only fluids now: cable with an export bus in front of it instead of an interface
    const layout = changed(connLayout('ae2'), (b) => (b.label !== 'ME Interface (Advanced Assembler)' ? b : {
      pos: b.pos, block: { id: 'ae2cable:glass', meta: 0 }, role: 'pipe', label: 'ME Glass Cable - Fluix', item: 'appliedenergistics2:item.ItemMultiPart@16',
      connections: (1 << 4) | (1 << 5), covers: [{ face: 'north', item: EXPORT_BUS, settings: { mode: 'me_export' }, filter: [DUST] }],
    }));
    const box = connectionsGraph(layout, connPlan, 'min').nodes.find((n) => n.id === 'step:b')!;
    expect(box.faces.filter((f) => f.id.includes('#cover:1,64,1:'))).toEqual([{ id: 'step:b#cover:1,64,1:north', title: 'ME Glass Cable - Fluix, north face',
      lines: [`${EXPORT_BUS} on the north face: put Titanium Dust in its filter slots`] }]);
  });

  it('says the chips in the 3D hover and click info, and marks the pipe configured on the map', () => {
    const layout = routedWithFeed();
    const i = layout.blocks.findIndex((b) => b.label === 'Routed Interface Pipe (Basic Macerator)');
    const chips = 'chips: Item Responder Chip (whitelist: Raw Input) + Item Extractor Chip (whitelist: Titanium Dust)';
    expect(pickInfo(layout, connPlan, i).lines).toContain(chips);
    expect(hoverText(layout, connPlan, i)).toBe(`Routed Interface Pipe (Basic Macerator) — ${chips}`);
    const view = { dim: 0, centerX: 0, centerZ: 0, pixelsPerBlock: 4, width: 400, height: 400, y: 255 };
    const dots = (l: Layout) => overlayShapes(l, view, null, []).filter((s) => s.kind === 'dot').length;
    const bare = changed(layout, (b) => (b.role === 'chip_pipe' ? { ...b, feed: {} } : b));
    expect(dots(layout) - dots(bare)).toBe(2);
  });
});
