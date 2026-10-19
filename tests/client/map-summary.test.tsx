import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FoundPanel } from '../../src/client/map/FoundPanel.tsx';
import { summarize, type FoundSummary } from '../../src/client/map/summary.ts';
import type { Note } from '../../src/shared/types/project.ts';
import type { WorldScan } from '../../src/shared/types/world.ts';
import { EMPTY_SCAN, manyItems, SCAN_FIXTURE } from '../helpers/scan-fixture.ts';

const NOTHING: FoundSummary = {
  machineCount: 0, topTier: null, machines: [], power: [], logistics: [],
  storage: { blocks: [], barrelBanks: [], items: [] }, dims: [], prospected: [], scanNotes: [],
};
/** SCAN_FIXTURE as a scan that could not read everything: two warnings and three skipped chunks. */
const DEGRADED: WorldScan = {
  ...SCAN_FIXTURE, warnings: ['Scanned without a recipe export: machines are unknown (run npm run export, then scan again)', '2 boilers with unknown steam output'],
  skippedChunks: 3,
};

describe('summarize', () => {
  it('summarizes what was found at the base', () => {
    const s = summarize(SCAN_FIXTURE, '0:0:0');
    expect(s.machines).toEqual([{ name: 'Basic Macerator', tier: 1, count: 2 }, { name: 'Basic Steam Turbine', tier: 1, count: 1 }, { name: 'Unknown machine #31999', tier: null, count: 1 }]);
    expect(s.power[0]).toMatchObject({ voltageTier: 1, storedEU: 101_000, capacityEU: 102_048 });
    expect(s.power[0]!.spare).toBeCloseTo(4.444, 3);
    expect(s.logistics).toEqual([{ id: 'r:0:0:65:10', kind: 'routed', nodes: 2, channels: null, parts: null }]);
    expect(s.storage.blocks).toEqual([{ kind: 'drawer', count: 2, unknown: 1 }, { kind: 'barrel', count: 2, unknown: 0 }, { kind: 'chest', count: 1, unknown: 0 }]);
    expect(s.storage.barrelBanks).toEqual([{ barrels: 2, pos: [5, 64, 10] }]);
    expect(s.storage.items).toEqual([{ key: 'minecraft:iron_ingot@0', total: 1030, reachable: 1000, where: [
      { kind: 'drawer', pos: [1, 64, 10], count: 1000, reachable: true }, { kind: 'chest', pos: [6, 64, 10], count: 30, reachable: false }] }]);
    expect(summarize(SCAN_FIXTURE, '0:0:0', 'ae2').storage.items[0]!.reachable).toBe(0);   // the project's logistics mode decides reach
    expect(s.prospected).toEqual([{ vein: 'ore.mix.copper', x: -40, z: 88, distance: 94 }]);
  });

  it('counts the machines, takes the base top tier and lists the power figures and dimensions', () => {
    const s = summarize(SCAN_FIXTURE, '0:0:0', 'direct');
    expect([s.machineCount, s.topTier]).toEqual([4, 1]);
    expect(s.power).toEqual([{ id: 'p:0:2:64:0', voltageTier: 1, clear: 7.037, rain: 0, average: 6.444, storedEU: 101_000, capacityEU: 102_048, spare: s.power[0]!.spare }]);
    expect(s.dims).toEqual([{ name: 'Overworld', visited: true, evidence: ['InhabitedTime'] }, { name: 'Twilight Forest', visited: false, evidence: [] }]);
    expect(s.storage.items[0]!.reachable).toBe(1000);   // machine to machine: any request network counts
  });

  it('shows AE2 channels and what a network is made of', () => {
    const scan: WorldScan = {
      ...SCAN_FIXTURE, logistics: [
        { id: 'a:0:9:64:9', baseId: '0:0:0', kind: 'ae2', nodes: 5, taps: [], channelsUsed: 3, channelsMax: 8, parts: { drive: 1, cable: 4 } },
        { id: 'r:0:0:65:10', baseId: '0:0:0', kind: 'routed', nodes: 4, taps: [], parts: { request: 1, interface: 1, 'chip:responder': 2 } },
        { id: 'e:item:0:0:0', baseId: null, kind: 'enderio', nodes: 3, taps: [] },   // outside every base
      ],
    };
    expect(summarize(scan, '0:0:0').logistics).toEqual([
      { id: 'a:0:9:64:9', kind: 'ae2', nodes: 5, channels: '3 / 8', parts: '4 cable, 1 drive' },
      { id: 'r:0:0:65:10', kind: 'routed', nodes: 4, channels: null, parts: '2 chip:responder, 1 interface, 1 request' },
    ]);
  });

  it('groups face-adjacent barrels into banks, the largest first', () => {
    const barrel = (x: number, y: number, z: number) => ({ id: `s:0:${x}:${y}:${z}`, dim: 0, pos: [x, y, z] as [number, number, number], kind: 'barrel' as const, baseId: '0:0:0', networkId: null, contents: [] });
    const scan: WorldScan = { ...SCAN_FIXTURE, storage: [barrel(9, 60, 0), barrel(2, 61, 2), barrel(2, 60, 2), barrel(3, 60, 2), barrel(4, 61, 3)] };
    expect(summarize(scan, '0:0:0').storage.barrelBanks).toEqual([{ barrels: 3, pos: [2, 60, 2] }, { barrels: 1, pos: [4, 61, 3] }, { barrels: 1, pos: [9, 60, 0] }]);
  });

  it('has no top tier when no machine at the base has a known tier', () => {
    const unknown: WorldScan = { ...SCAN_FIXTURE, machines: SCAN_FIXTURE.machines.filter((m) => m.tier === undefined), bases: [{ ...SCAN_FIXTURE.bases[0]!, topTier: 0 }] };
    const s = summarize(unknown, '0:0:0');
    expect([s.machineCount, s.topTier]).toEqual([1, null]);
    expect(renderToStaticMarkup(<FoundPanel summary={s} notes={[]} onFocusNote={() => {}} />)).toContain('Top tier: unknown');
  });

  it('finds the base by its old anchor after a rescan moved it', () => {
    const moved: WorldScan = {
      ...SCAN_FIXTURE, bases: [{ ...SCAN_FIXTURE.bases[0]!, id: '0:-1:0', bbox: { ...SCAN_FIXTURE.bases[0]!.bbox, minX: -16 } }],
      machines: SCAN_FIXTURE.machines.map((m) => ({ ...m, baseId: '0:-1:0' })),
    };
    expect(summarize(moved, '0:0:0').machineCount).toBe(4);
  });

  it('keeps the nearest ten prospected veins of the base dimension', () => {
    const veins = Array.from({ length: 12 }, (_, i) => ({ dim: 0, x: 4 + 10 * (12 - i), z: 5, vein: `ore.mix.v${i}` }));
    const scan: WorldScan = { ...SCAN_FIXTURE, prospected: [{ dim: -1, x: 4, z: 5, vein: 'ore.mix.nether' }, ...veins] };
    const near = summarize(scan, '0:0:0').prospected;
    expect(near).toHaveLength(10);
    expect(near[0]).toEqual({ vein: 'ore.mix.v11', x: 14, z: 5, distance: 10 });
    expect(near.map((v) => v.vein)).not.toContain('ore.mix.nether');
    expect(near.map((v) => v.vein)).not.toContain('ore.mix.v0');
  });

  it('lists every item and every place it sits, without caps', () => {
    // manyItems(12, 7) = SCAN_FIXTURE plus chests at base 0:0:0 holding 12 different items, the first of them spread over 7 chests
    const s = summarize(manyItems(12, 7), '0:0:0');
    expect([s.storage.items.length, s.storage.items.find((i) => i.key === 'test:item@0')!.where.length]).toEqual([13, 7]);   // 12 + iron
    expect(s.storage.items.map((i) => i.total)).toEqual([...s.storage.items.map((i) => i.total)].sort((a, b) => b - a));
    const html = renderToStaticMarkup(<FoundPanel summary={s} notes={[]} onFocusNote={() => {}} />);
    expect(html).toContain('Show all 13 items');
    expect(html.match(/data-key="/g)).toHaveLength(10);   // ITEMS_PAGE rows until "Show all"
  });

  it('passes on what the scan could not read or work out, world-wide, then the skipped chunks', () => {
    const notes = [...DEGRADED.warnings!, '3 chunks could not be read and were left out'];
    expect([summarize(DEGRADED, '0:0:0').scanNotes, summarize(DEGRADED, null).scanNotes]).toEqual([notes, notes]);   // no base: still the scan's
    expect(summarize({ ...SCAN_FIXTURE, skippedChunks: 1 }, '0:0:0').scanNotes).toEqual(['1 chunk could not be read and was left out']);
    expect(summarize({ ...SCAN_FIXTURE, warnings: [], skippedChunks: 0 }, '0:0:0').scanNotes).toEqual([]);
    expect(summarize(SCAN_FIXTURE, '0:0:0').scanNotes).toEqual([]);   // older scans may have neither field
  });

  it('says nothing was found for an empty base', () => {
    expect(summarize(EMPTY_SCAN, null)).toEqual(NOTHING);
    expect(summarize(SCAN_FIXTURE, null)).toEqual({ ...NOTHING, dims: summarize(SCAN_FIXTURE, '0:0:0').dims });   // no base: nothing is at it
    expect(summarize(SCAN_FIXTURE, '5:9:9')).toEqual({ ...NOTHING, dims: summarize(SCAN_FIXTURE, '0:0:0').dims });
    const html = renderToStaticMarkup(<FoundPanel summary={NOTHING} notes={[]} onFocusNote={() => {}} />);
    for (const section of ['Machines', 'Power', 'Logistics', 'Storage', 'Dimensions', 'Prospected veins', 'Notes']) expect(html).toContain(`>${section}<`);
    expect(html.match(/None found/g)).toHaveLength(7);
    expect(html).not.toContain('Show all');
  });
});

describe('FoundPanel', () => {
  const s = summarize(SCAN_FIXTURE, '0:0:0');
  const pinned: Note[] = [
    { id: 'a', text: 'Build here', by: 'Ann', at: 't', pin: { dim: 0, x: 4, y: 63, z: 5 } },
    { id: 'b', text: 'not pinned', by: 'Ann', at: 't' },
    { id: 'c', text: 'Nether portal', by: 'Bo', at: 't', pin: { dim: -1, x: 0, y: 70, z: 0 } },
  ];
  const html = renderToStaticMarkup(<FoundPanel summary={s} notes={pinned} onFocusNote={() => {}} focusedNote={2} onShowOnMap={() => {}} />);

  it('shows the machines, their count and the top tier', () => {
    expect(html).toContain('data-testid="found-panel"');
    expect(html).toMatch(/data-testid="machine-count"[^>]*>4</);
    expect(html).toContain('Top tier: LV');
    expect(html).toContain('Basic Macerator');
    expect(html).toContain('Unknown machine #31999');
  });

  it('shows the power figures rounded, with the rain caveat', () => {
    for (const text of ['7 EU/t', '0 EU/t', '6.4 EU/t', '101,000', '102,048', '4.4 EU/t', 'solar boilers stop ≈7 min into rain']) expect(html).toContain(text);
  });

  it('names the logistics kind and lists storage, banks and items', () => {
    expect(html).toContain('Routed network');
    expect(html).toContain('JABBA bank: 2 barrels');
    expect(html).toMatch(/data-key="minecraft:iron_ingot@0"[^]*1,030[^]*1,000 reachable/);
    expect(html).toContain('1,000 in drawer at 1 64 10');
    expect(html).toContain('30 in chest at 6 64 10');
    expect(html).toContain('show on map');
    expect(html).not.toContain('Show all');
  });

  it('lists the dimensions, the prospected veins and the pinned notes by number', () => {
    expect(html).toContain('Twilight Forest');
    expect(html).toContain('ore.mix.copper');
    expect(html).toContain('94 blocks');
    expect(html).toMatch(/data-testid="note-1"[^]*Build here/);
    expect(html).toMatch(/data-testid="note-2"[^]*Nether portal/);
    expect(html).toMatch(/id="found-note-2" data-testid="note-2" aria-current="true"/);   // the note whose marker was clicked
    expect(html).not.toContain('not pinned');
  });

  it('offers "show on map" only when the map can show a place', () => {
    expect(renderToStaticMarkup(<FoundPanel summary={s} notes={[]} onFocusNote={() => {}} />)).not.toContain('show on map');
  });

  it('shows the scan notes first, and no such section when the scan read everything', () => {
    const degraded = renderToStaticMarkup(<FoundPanel summary={summarize(DEGRADED, '0:0:0')} notes={[]} onFocusNote={() => {}} />);
    expect(degraded.indexOf('>Scan notes<')).toBeGreaterThan(-1);
    expect(degraded.indexOf('>Scan notes<')).toBeLessThan(degraded.indexOf('>Machines<'));
    expect(degraded).toMatch(/data-testid="scan-notes"[^]*Scanned without a recipe export[^]*2 boilers with unknown steam output[^]*3 chunks could not be read/);
    expect(degraded).not.toMatch(/aria-label="[^"]*[Nn]ote/);   // the note dialog's field stays the only "Note" label (ruling M-R5)
    expect(html).not.toContain('Scan notes');
  });
});
