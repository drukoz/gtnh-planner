// The words of the feeding settings (architecture §11 entry 51; research docs/research/machine-feeding.md §3.7): Multi
// Stack Input off and Limiting mode on in add-on 15's words, Input Separation off in the research's, and the structured
// chips and AE2 patterns of `LayoutBlock.feed` in a builder's words, through the one formatter the configure steps, the
// 3D view and the Connections view share.

import { describe, expect, it } from 'vitest';
import { configTexts, configuredLines, feedTexts } from '../../../src/shared/layout/configure-text.ts';
import type { StuffKey } from '../../../src/shared/keys.ts';

const NAMES: Record<string, string> = {
  't:a@0': 'Alpha', 't:b@0': 'Beta', 't:c@0': 'Gamma', 't:x@0': 'Ex', 't:y@0': 'Why', 'fluid:oxygen': 'Oxygen',
};
const nameOf = (k: StuffKey): string => NAMES[k] ?? k;

describe('feeding words', () => {
  it("says how to set Multi Stack Input off and Limiting mode on in add-on 15's words, and Input Separation off in the research's", () => {
    expect(configTexts({ multiStack: false, limited: true })).toEqual([
      'Multi Stack Input off: sneak-right-click its front with a Soldering Iron (where a neighbour covers the front, the edge of the wrench grid '
        + 'toward it) until the chat says "Multi Stack Input Off"',
      'Limiting mode on: sneak-right-click it with a Screwdriver until the chat says "Limiting mode On"']);
    expect(configTexts({ multiStack: true, limited: false })).toEqual(['Multi Stack Input on', 'Limiting mode off']);
    expect(configTexts({ inputSeparation: false })).toEqual([
      'Input Separation off: the controller window\'s Input Separation button (on the EBF, a Screwdriver right-click on the controller) until '
        + 'the chat says "Input buses aren\'t separated"']);
    expect(configTexts({ inputSeparation: true })).toEqual(['Input Separation on']);
  });

  it('names every chip of a routed interface pipe with its filter mode and items, a chip slot after another', () => {
    expect(feedTexts({ chips: [
      { kind: 'responder', filter: { mode: 'whitelist', keys: ['t:a@0', 't:b@0'] } },
      { kind: 'extractor', filter: { mode: 'whitelist', keys: ['t:x@0'] } },
    ] }, nameOf)).toEqual(['chips: Item Responder Chip (whitelist: Alpha and Beta) + Item Extractor Chip (whitelist: Ex)']);
    expect(feedTexts({ chips: [{ kind: 'terminator', filter: { mode: 'whitelist', keys: ['t:x@0', 't:y@0', 't:c@0'] } }] }, nameOf))
      .toEqual(['chips: Item Terminator Chip (whitelist: Ex, Why and Gamma)']);
    // research §3.7: a new Item Broadcaster Chip is a blacklist; a Stock Keeper names its counts and request mode
    expect(feedTexts({ chips: [
      { kind: 'broadcaster', filter: { mode: 'whitelist', keys: ['t:x@0'] } },
      { kind: 'stock_keeper', stock: [{ key: 't:a@0', count: 4 }, { key: 't:b@0', count: 2 }] },
      { kind: 'extractor', filter: { mode: 'blacklist', keys: [] } },
    ] }, nameOf)).toEqual(['chips: Item Broadcaster Chip (whitelist: Ex; a new one is a blacklist, so switch its filter to whitelist) '
      + '+ Item Stock Keeper Chip (when missing): Alpha 4, Beta 2 + Item Extractor Chip (blacklist: nothing)']);
  });

  it("writes an ME interface's patterns with whole amounts and its blocking mode", () => {
    expect(feedTexts({ interface: { patterns: [{ inputs: [{ key: 't:a@0', amount: 1 }, { key: 't:b@0', amount: 4 }],
      outputs: [{ key: 't:x@0', amount: 1 }] }], blocking: true } }, nameOf))
      .toEqual(['1 processing pattern', 'pattern 1× Alpha + 4× Beta → 1× Ex', 'blocking mode on']);
    expect(feedTexts({ interface: { patterns: [
      { inputs: [{ key: 't:a@0', amount: 1 }], outputs: [{ key: 't:x@0', amount: 2 }] },
      { inputs: [{ key: 't:b@0', amount: 1_000 }], outputs: [{ key: 't:y@0', amount: 1 }] },
    ], blocking: false, lock: 'until_result' } }, nameOf)).toEqual(['2 processing patterns', 'pattern 1: 1× Alpha → 2× Ex',
      'pattern 2: 1,000× Beta → 1× Why', 'blocking mode off', 'Locking Card, Lock Crafting: Until crafting result is returned']);
    expect(feedTexts(undefined, nameOf)).toEqual([]);
  });

  it("lists a block's covers, then its settings, then its chips or patterns", () => {
    expect(configuredLines({ config: { circuit: 2, multiStack: false }, feed: { chips: [{ kind: 'extractor', filter: { mode: 'whitelist', keys: ['t:x@0'] } }] } },
      nameOf)).toEqual(['programmed circuit 2', configTexts({ multiStack: false })[0], 'chips: Item Extractor Chip (whitelist: Ex)']);
  });
});
