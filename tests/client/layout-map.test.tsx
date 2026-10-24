import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { overlayShapes, layoutMarkers, combinedMarkers, draggedOrigin, rotatedPlacement, insideLine, layoutOverlay, PIN_COLORS, CONFIGURED_COLOR,
  type Drag } from '../../src/client/map/layout-overlay.ts';
import { lineSummary, LinePanel } from '../../src/client/map/LinePanel.tsx';
import { layoutInputKey, createLayoutLoader } from '../../src/client/state/use-layout.ts';
import { focusPin, getFocusedPin } from '../../src/client/state/pin-focus.ts';
import { StepsView } from '../../src/client/views/StepsView.tsx';
import { hookupNetworkKind } from '../../src/shared/layout/enderio.ts';
import type { ConduitFace, Layout } from '../../src/shared/types/layout.ts';
import type { Plan } from '../../src/shared/types/plan.ts';
import type { Project } from '../../src/shared/types/project.ts';
import { bundle, bundleLayout } from './enderio-fixture.ts';
// for the tests after the plan's own
import { ApiError } from '../../src/client/api/client.ts';
import { subscribePinFocus } from '../../src/client/state/pin-focus.ts';
import type { LayoutState } from '../../src/client/state/use-layout.ts';

const GT = (mteId: number) => ({ id: 'gregtech:gt.blockmachines', meta: 0, mteId });
const layout: Layout = { dim: 0, origin: [10, 64, 20], size: [3, 1, 2], rotation: 0, mode: 'direct', status: 'ok',
  blocks: [
    { pos: [10, 64, 20], block: GT(2001), role: 'machine', label: 'Basic Macerator', stepId: 's1', facing: 3,
      covers: [{ face: 'south', item: 'gregtech:gt.metaitem.01@32630', settings: { mode: 'export', allowInput: true, rate: 0.5, unit: 'items/s' } }] },
    { pos: [11, 64, 20], block: GT(2002), role: 'machine', label: 'Advanced Assembler', stepId: 's2', facing: 3 },
    { pos: [10, 64, 21], block: GT(5600), role: 'pipe', label: 'Tin Item Pipe' },
    { pos: [9, 64, 21], block: GT(1246), role: 'cable', label: '1x Tin Cable', hookup: 0 },
  ],
  hookups: [{ kind: 'power', from: { pos: [8, 64, 21], dim: 0, kind: 'power', voltageTier: 1, freeAmps: 2, networkId: 'p' }, path: [[9, 64, 21]], parts: [], found: true }],
  pins: [{ n: 2, dim: 0, pos: [8, 64, 21], kind: 'power', text: 'Tap power here' }, { n: 1, dim: 0, pos: [11, 64, 20], kind: 'site', text: 'Build the line here' }],
  buildSteps: [], bom: [], warnings: [],
  power: { peakEUt: 150, averageEUt: 150, voltageTier: 2, amps: 2, fits: 'tight', detail: 'Needs 150 EU/t', suggestions: ['Add battery storage'] } };
const view = { dim: 0, centerX: 10, centerZ: 20, pixelsPerBlock: 4, width: 400, height: 400, y: 255 };
const plan = { steps: [{ id: 's1', count: 3, owned: 2, handCraft: false }, { id: 's2', count: 1, owned: 0, handCraft: false }],
  power: { peakEUt: 150, averageEUt: 150, voltageTier: 2, amps: 2 },
  buildSteps: [{ id: 'layout:site', order: 1, text: 'Clear a spot', kind: 'place', pin: 1 }] } as unknown as Plan;
const panel = (l: Layout) => renderToStaticMarkup(<LinePanel layout={l} plan={plan} loading={false} error={null} moving={false}
  onToggleMove={() => {}} onRotate={() => {}} onAutoPlace={() => {}} onPin={() => {}} />);

describe('the line on the map', () => {
  it('draws machines solid, hookups dashed and an arrow between steps', () => {
    const shapes = overlayShapes(layout, view, null, [{ from: 's1', to: 's2', key: 'k', perSecond: 1 }]);
    expect(shapes).toContainEqual({ kind: 'rect', x: 200, y: 200, w: 4, h: 4, fill: '#90caf9', stroke: null, dash: [] });
    expect(shapes).toContainEqual({ kind: 'rect', x: 200, y: 204, w: 4, h: 4, fill: '#ffb300', stroke: null, dash: [] });
    expect(shapes).toContainEqual({ kind: 'rect', x: 200, y: 200, w: 12, h: 8, fill: null, stroke: '#ffffff', dash: [] });
    expect(shapes).toContainEqual({ kind: 'path', points: [[198, 206]], stroke: '#3fa34d', dash: [6, 4], width: 2 });
    expect(shapes).toContainEqual({ kind: 'arrow', from: [202, 202], to: [206, 202], color: '#ffffff' });
    expect(overlayShapes(layout, view, { dx: 5, dz: 0 }, [])).toContainEqual({ kind: 'rect', x: 220, y: 200, w: 4, h: 4, fill: '#90caf9', stroke: null, dash: [] });
    expect(overlayShapes(layout, { ...view, dim: -1 }, null, [])).toEqual([]);
  });

  it('marks configured blocks', () => {
    const dots = overlayShapes(layout, view, null, []).filter((s) => s.kind === 'dot');
    expect(dots).toEqual([{ kind: 'dot', x: 202, y: 202, r: 2, color: CONFIGURED_COLOR }]);   // only the macerator has covers or config
    const withConfig: Layout = { ...layout, blocks: layout.blocks.map((b) => b.label === 'Tin Item Pipe' ? { ...b, config: { circuit: 1 } } : b) };
    expect(overlayShapes(withConfig, view, null, []).filter((s) => s.kind === 'dot')).toHaveLength(2);
  });

  it('note and layout markers never share a label', () => {
    const notes = [{ n: 1, pos: [0, 64, 0] as [number, number, number], color: '#ffb300', label: 'Build here' },
      { n: 2, pos: [3, 64, 3] as [number, number, number], color: '#ffb300', label: 'Tap' }];
    const markers = combinedMarkers(notes, layout);
    expect(markers.map((m) => m.text ?? String(m.n))).toEqual(['N1', 'N2', '1', '2']);
    expect(new Set(markers.map((m) => m.text ?? String(m.n))).size).toBe(markers.length);
    expect(combinedMarkers(notes, null).map((m) => m.text)).toEqual(['N1', 'N2']);
  });

  it('turns pins into numbered markers and moves the line by dragging', () => {
    expect(layoutMarkers(layout)).toEqual([
      { n: 1, pos: [11, 64, 20], color: PIN_COLORS.site, label: 'Pin 1: Build the line here' },
      { n: 2, pos: [8, 64, 21], color: PIN_COLORS.power, label: 'Pin 2: Tap power here' }]);
    expect([insideLine(layout, 12, 21), insideLine(layout, 13, 21)]).toEqual([true, false]);
    expect(draggedOrigin(layout, { x: 11, z: 20 }, { x: 16, z: 18 })).toEqual([15, 64, 18]);
    expect(rotatedPlacement({ ...layout, rotation: 270 })).toEqual({ origin: [10, 64, 20], rotation: 0 });
    const drops: number[][] = [];
    let drag: Drag | null = null;
    const overlay = () => layoutOverlay(layout, { moving: true, drag, flows: [], onDrag: (d) => { drag = d; }, onDrop: (o) => drops.push(o) });
    expect(overlay().onPointer!({ kind: 'down', x: 11, z: 20 })).toBe(true);
    expect(overlay().onPointer!({ kind: 'move', x: 14, z: 20 })).toBe(true);
    expect(overlay().onPointer!({ kind: 'up', x: 14, z: 20 })).toBe(true);
    expect(drops).toEqual([[13, 64, 20]]);
    expect(drag).toBeNull();
    expect(layoutOverlay(layout, { moving: false, drag: null, flows: [], onDrag: () => {}, onDrop: () => {} }).onPointer!({ kind: 'down', x: 11, z: 20 })).toBe(false);
  });

  it('counts an owned machine three steps share once, and draws flows from and to a shared machine (plan 12)', () => {
    // One owned macerator serving three steps (`reused.units` [0] each) is one machine reused; steps that do not say which
    // owned machines they run on count their owned machines as before.
    const shared = (units: boolean) => ({ ...plan, steps: ['a', 'b', 'c'].map((id) => ({ id, machine: { mteId: 2001, name: 'Basic Macerator', tier: 1 },
      count: 1, owned: 1, handCraft: false, ...(units ? { reused: { count: 1, where: [], units: [0] } } : {}) })) }) as unknown as Plan;
    expect(lineSummary(layout, shared(true)).reused).toBe(1);
    expect(lineSummary(layout, shared(false)).reused).toBe(3);
    // Owned machines of another tier beside a step's own count once each too.
    const others = { ...plan, steps: [
      { id: 'a', machine: { mteId: 2001, name: 'Basic Macerator', tier: 1 }, count: 2, owned: 1, handCraft: false,
        reused: { count: 1, where: [], units: [0], others: [{ mteId: 2002, name: 'Advanced Macerator', tier: 2, count: 1, units: [0], where: [], euPerTick: 8, runsPerSecondPerMachine: 1 }] } },
      { id: 'b', machine: { mteId: 2002, name: 'Advanced Macerator', tier: 2 }, count: 1, owned: 1, handCraft: false, reused: { count: 1, where: [], units: [0] } }] } as unknown as Plan;
    expect(lineSummary(layout, others).reused).toBe(2);
    // One macerator block runs s1 and s2, the assembler s3: the flow from s2 starts on the macerator, and s1 → s2 stays inside it.
    const pooled: Layout = { ...layout, blocks: [
      { ...layout.blocks[0]!, stepId: 's1', stepIds: ['s1', 's2'] }, { ...layout.blocks[1]!, stepId: 's3' }, ...layout.blocks.slice(2)] };
    const arrows = overlayShapes(pooled, view, null, [{ from: 's1', to: 's2', key: 'k', perSecond: 1 }, { from: 's2', to: 's3', key: 'j', perSecond: 1 }])
      .filter((s) => s.kind === 'arrow');
    expect(arrows).toEqual([{ kind: 'arrow', from: [202, 202], to: [206, 202], color: '#ffffff' }]);
  });

  it('sums up the line and lists its pins', () => {
    expect(lineSummary(layout, plan)).toEqual({ newMachines: 2, reused: 2, footprint: '3×2×1', peak: '150 EU/t', fits: 'Tight in rain', fitsClass: 'tight' });
    const html = panel(layout);
    expect(html).toContain('data-testid="line-panel"');
    expect(html).toContain('data-testid="pin-1"');
    expect(html).toContain('Add battery storage');
    expect(panel({ ...layout, status: 'no-world' })).toContain('Pick a world scan and base to place the line');
  });

  it('refetches when the plan or the placement changes, and ignores late answers', async () => {
    vi.useFakeTimers();
    const answers: Array<(l: Layout) => void> = [];
    const loader = createLayoutLoader(() => new Promise<Layout>((r) => answers.push(r)), () => {});
    const planA = {} as Plan;
    const planB = {} as Plan;
    loader.request('P1', planA, 'k1');
    loader.request('P1', planA, 'k1');
    await vi.advanceTimersByTimeAsync(100);
    loader.request('P1', planB, 'k1');
    await vi.advanceTimersByTimeAsync(100);
    expect(answers).toHaveLength(2);
    answers[1]!({ ...layout, origin: [1, 1, 1] });
    await vi.advanceTimersByTimeAsync(0);
    answers[0]!({ ...layout, origin: [9, 9, 9] });
    await vi.advanceTimersByTimeAsync(0);
    expect(loader.state().layout!.origin).toEqual([1, 1, 1]);
    vi.useRealTimers();
    expect(layoutInputKey({ placement: null, settings: { logistics: 'direct' }, world: { scanId: 'S1', baseId: 'B' } } as unknown as Project))
      .toBe('{"placement":null,"logistics":"direct","scanId":"S1","baseId":"B"}');
  });

  it('links build steps to map pins', () => {
    focusPin(3);
    expect(getFocusedPin()).toBe(3);
    focusPin(null);
    const project = { id: 'P1', name: 'T', createdAt: '', createdBy: 'a', rev: 1, settings: {}, world: { scanId: null, baseId: null },
      placement: null, marks: {}, notes: [] } as unknown as Project;
    expect(renderToStaticMarkup(<StepsView project={project} plan={plan} send={() => {}} me="Ann" />)).toContain('data-pin="1"');
  });

  it('draws an EnderIO line in the EnderIO colour with a dot on its configured conduits', () => {
    const hookup = { kind: 'logistics' as const, from: { pos: [8, 64, 20] as [number, number, number], dim: 0, kind: 'pipe' as const, networkId: 'enderio:0:0' },
      path: [[8, 64, 20], [9, 64, 20]] as Array<[number, number, number]>, parts: [] };
    const shapes = overlayShapes({ ...bundleLayout, hookups: [hookup] }, view, null, []);
    expect(shapes.find((s) => s.kind === 'rect' && s.fill !== null)).toMatchObject({ fill: '#26c6da' });
    expect(shapes.filter((s) => s.kind === 'dot')).toHaveLength(1);
    expect(shapes.find((s) => s.kind === 'path')).toMatchObject({ stroke: '#26c6da' });
    expect([hookupNetworkKind(hookup, 'direct'), hookupNetworkKind({ ...hookup, from: { ...hookup.from, networkId: 'e:item:0:1' } }, 'direct'),
      hookupNetworkKind({ ...hookup, kind: 'power' }, 'enderio')]).toEqual(['gtpipe', 'enderio', null]);
  });

  it('draws an area kept for a farm as a dashed box in the farm colour that moves with the line (add-on 17)', () => {
    const farmed: Layout = { ...layout, reserved: [{ stepId: 'tgs', pos: [14, 64, 20], size: [7, 7, 5], pin: 3, text: 'Farm: Tree Growth Simulator' }] };
    const dashed = (l: Layout, drag: { dx: number; dz: number } | null) =>
      overlayShapes(l, view, drag, []).filter((s) => s.kind === 'rect' && s.dash.length > 0);
    expect(dashed(layout, null)).toEqual([]);
    // the area's world bounds, x 14–20 and z 20–24, in view pixels
    expect(dashed(farmed, null)).toEqual([{ kind: 'rect', x: 216, y: 200, w: 28, h: 20, fill: null, stroke: PIN_COLORS.farm, dash: expect.any(Array) }]);
    expect(dashed(farmed, { dx: 5, dz: -1 })).toEqual([{ kind: 'rect', x: 236, y: 196, w: 28, h: 20, fill: null, stroke: PIN_COLORS.farm, dash: expect.any(Array) }]);
    expect(overlayShapes({ ...farmed, dim: -1 }, view, null, [])).toEqual([]);
    expect(layoutMarkers({ ...farmed, pins: [{ n: 3, dim: 0, pos: [17, 64, 22], kind: 'farm', text: 'Farm: Tree Growth Simulator' }] }))
      .toEqual([{ n: 3, pos: [17, 64, 22], color: PIN_COLORS.farm, label: 'Pin 3: Farm: Tree Growth Simulator' }]);
  });

  it('sums up and moves a line whose only new machines are farms (the final review of add-on 17)', () => {
    // every other machine owned: no block to place, one area kept for the new Tree Growth Simulator, and the layout `ok`
    const farmsOnly: Layout = {
      ...layout, blocks: [], hookups: [], size: [7, 7, 7], origin: [30, 64, 30],
      pins: [{ n: 1, dim: 0, pos: [18, 64, 18], kind: 'reuse', text: 'Reuse your 1× Basic Macerator' }, { n: 2, dim: 0, pos: [33, 64, 33], kind: 'farm', text: 'Farm: Tree Growth Simulator' }],
      reserved: [{ stepId: 'tgs', pos: [30, 64, 30], size: [7, 7, 7], pin: 2, text: 'Farm: Tree Growth Simulator' }],
    };
    expect(lineSummary(farmsOnly, null)).toMatchObject({ newMachines: 1, footprint: '7×7×7' });
    // and a line with farms counts each area beside its machine blocks
    expect(lineSummary({ ...layout, reserved: farmsOnly.reserved }, plan).newMachines).toBe(3);
    const html = panel(farmsOnly);
    expect(html).not.toContain('Nothing new to build');
    for (const text of ['Machines: 1 new', 'Move line', 'Rotate 90°', 'Auto place', '2. Farm: Tree Growth Simulator']) expect(html).toContain(text);
  });
});

describe('the line on the map: the rules in detail', () => {
  it('colours a column by its most important block and leaves hookup blocks and ghosts to the paths', () => {
    const stacked: Layout = { ...layout, blocks: [
      { pos: [10, 64, 20], block: GT(1246), role: 'cable', label: '1x Tin Cable' },
      { pos: [10, 65, 20], block: GT(2001), role: 'machine', label: 'Basic Macerator', stepId: 's1' },
      { pos: [12, 64, 21], block: GT(1), role: 'ghost', label: 'Existing cable' },
      { pos: [9, 64, 21], block: GT(1246), role: 'cable', label: '1x Tin Cable', hookup: 0, config: { note: 'tap end' } },
    ] };
    const shapes = overlayShapes(stacked, view, { dx: 1, dz: 0 }, []);
    expect(shapes.filter((s) => s.kind === 'rect' && s.fill !== null)).toEqual([{ kind: 'rect', x: 204, y: 200, w: 4, h: 4, fill: '#90caf9', stroke: null, dash: [] }]);
    expect(shapes.filter((s) => s.kind === 'dot')).toEqual([{ kind: 'dot', x: 198, y: 206, r: 2, color: CONFIGURED_COLOR }]);   // a hookup end stays put
    expect(shapes.at(-1)?.kind).toBe('dot');   // marks are drawn last
  });

  it('draws each hookup in its network colour and arrows only between two different steps', () => {
    const tap = { pos: [8, 64, 21] as [number, number, number], dim: 0, networkId: 'n' };
    const hooked: Layout = { ...layout, hookups: [
      { kind: 'logistics', from: { ...tap, kind: 'pipe' }, path: [[9, 64, 21], [9, 64, 22]], parts: [] },
      { kind: 'logistics', from: { ...tap, kind: 'ae2' }, path: [[9, 64, 21]], parts: [] },
      { kind: 'power', from: { ...tap, kind: 'power' }, path: [[9, 64, 21]], parts: [] },
      { kind: 'logistics', from: { ...tap, kind: 'routed' }, path: [], parts: [] },
    ] };
    const flows = [{ from: 'raw', to: 's1', key: 'k', perSecond: 1 }, { from: 's2', to: 'out', key: 'k', perSecond: 1 }, { from: 's1', to: 's1', key: 'k', perSecond: 1 }];
    const shapes = overlayShapes(hooked, view, null, flows);
    expect(shapes.filter((s) => s.kind === 'path').map((s) => s.kind === 'path' && [s.points, s.stroke])).toEqual([
      [[[198, 206], [198, 210]], '#9ccc65'], [[[198, 206]], '#7e57c2'], [[[198, 206]], '#8a8a8a']]);
    expect(shapes.filter((s) => s.kind === 'arrow')).toEqual([]);
    expect(overlayShapes({ ...layout, size: [0, 0, 0], blocks: [], hookups: [] }, view, null, [])).toEqual([]);   // nothing to build: no outline
  });

  it('takes a drag block by block and leaves presses outside the line to the map', () => {
    const calls: Array<Drag | null> = [];
    const dragging = layoutOverlay(layout, { moving: true, drag: { from: { x: 11, z: 20 }, to: { x: 14, z: 20 } }, flows: [], onDrag: (d) => calls.push(d), onDrop: () => {} });
    expect(dragging.onPointer!({ kind: 'move', x: 14, z: 20 })).toBe(true);   // the same block: nothing new
    expect(calls).toEqual([]);
    expect(dragging.onPointer!({ kind: 'down', x: 30, z: 30 })).toBe(false);  // a drag the browser cut short ends
    expect(calls).toEqual([null]);
    const idle = layoutOverlay(layout, { moving: true, drag: null, flows: [], onDrag: (d) => calls.push(d), onDrop: () => {} });
    expect([idle.onPointer!({ kind: 'move', x: 11, z: 20 }), idle.onPointer!({ kind: 'up', x: 11, z: 20 }), idle.onPointer!({ kind: 'down', x: 30, z: 30 })])
      .toEqual([false, false, false]);
    expect(calls).toEqual([null]);
  });

  it('sums up without a plan and leaves hand-crafted steps out of the reused machines', () => {
    expect(lineSummary({ ...layout, power: undefined }, null)).toEqual({ newMachines: 2, reused: 0, footprint: '3×2×1', peak: 'Unknown', fits: 'Unknown', fitsClass: 'unknown' });
    expect(lineSummary(layout, null).peak).toBe('150 EU/t');
    const crafted = { ...plan, steps: [...plan.steps, { id: 's3', count: 1, owned: 5, handCraft: true }] } as unknown as Plan;
    expect(lineSummary(layout, crafted).reused).toBe(2);
  });

  it('says what it cannot show yet, and marks the pin the map was sent to', () => {
    const base = { layout, plan, loading: false, error: null, moving: false, onToggleMove() {}, onRotate() {}, onAutoPlace() {}, onPin() {} };
    const html = (over: Partial<typeof base> & { layout?: Layout | null; error?: string | null; focusedPin?: number }) =>
      renderToStaticMarkup(<LinePanel {...base} {...over} />);
    expect(html({ layout: null, loading: true })).toContain('Laying out the line…');
    expect(html({ error: 'The line layout failed: boom' })).toContain('The line layout failed: boom');
    expect(html({ layout: { ...layout, status: 'empty' } })).toContain('Nothing new to build — every step runs on machines you own');
    expect(html({ layout: { ...layout, status: 'empty' }, plan: { ...plan, steps: [] } as unknown as Plan })).toContain('Nothing to lay out yet — the plan makes nothing');
    expect(html({ layout: { ...layout, status: 'no-world' } })).not.toContain('Move line');
    expect(html({ moving: true })).toMatch(/aria-pressed="true"[^>]*>Move line</);
    expect(html({ focusedPin: 2 })).toContain('<li data-testid="pin-2" class="focused" aria-current="true">');
    expect(html({})).not.toContain('aria-current');
  });

  it('fetches once per burst of changes, keeps the last layout when a fetch fails and stops when closed', async () => {
    vi.useFakeTimers();
    let fetches = 0;
    let fail = false;
    const states: LayoutState[] = [];
    const loader = createLayoutLoader(async () => {
      fetches++;
      if (fail) throw new ApiError(500, 'layout-failed', 'The line layout failed: boom');
      return layout;
    }, (s) => states.push(s));
    loader.request('P1', null, 'a');
    expect(loader.state().loading).toBe(true);
    await vi.advanceTimersByTimeAsync(50);
    loader.request('P1', null, 'b');
    await vi.advanceTimersByTimeAsync(50);
    expect(fetches).toBe(1);
    expect(loader.state()).toEqual({ layout, loading: false, error: null });
    fail = true;
    loader.request('P1', null, 'c');
    await vi.advanceTimersByTimeAsync(100);
    expect(loader.state()).toEqual({ layout, loading: false, error: 'The line layout failed: boom' });
    fail = false;
    loader.request('P2', null, 'c');   // another project, same inputs
    await vi.advanceTimersByTimeAsync(100);
    expect([fetches, loader.state().error]).toEqual([3, null]);
    const reported = states.length;
    loader.close();
    loader.request('P2', null, 'd');
    await vi.advanceTimersByTimeAsync(100);
    expect([fetches, states.length]).toEqual([3, reported]);
    vi.useRealTimers();
  });

  it('tells subscribers when the focused pin changes, and gives build steps without a pin no link', () => {
    const seen: Array<number | null> = [];
    const stop = subscribePinFocus(() => seen.push(getFocusedPin()));
    focusPin(4);
    focusPin(4);
    focusPin(null);
    stop();
    focusPin(5);
    focusPin(null);
    expect(seen).toEqual([4, null]);
    const project = { id: 'P1', name: 'T', createdAt: '', createdBy: 'a', rev: 1, settings: {}, world: { scanId: null, baseId: null },
      placement: null, marks: {}, notes: [] } as unknown as Project;
    const withGather = { ...plan, buildSteps: [...plan.buildSteps, { id: 'gather', order: 2, text: 'Gather', kind: 'gather' }] } as unknown as Plan;
    const html = renderToStaticMarkup(<StepsView project={project} plan={withGather} send={() => {}} me="Ann" />);
    expect(html).toMatch(/data-row="step:layout:site"[^]*<button type="button" class="pin-link" data-pin="1"[^>]*>pin 1<\/button>/);
    expect(html.match(/class="pin-link"/g)).toHaveLength(1);
  });

  it('gives a conduit column the EnderIO colour only when a conduit colours it, and dots only conduits with faces', () => {
    const fills = (l: Layout) => overlayShapes(l, view, null, []).filter((s) => s.kind === 'rect' && s.fill !== null).map((s) => s.kind === 'rect' && s.fill);
    const machineAbove = { pos: [10, 65, 20] as [number, number, number], block: GT(2001), role: 'machine' as const, label: 'Basic Macerator', stepId: 's1' };
    expect(fills({ ...bundleLayout, blocks: [bundle, machineAbove] })).toEqual(['#90caf9']);   // the machine wins the column
    const cell = (faces: ConduitFace[]) => ({ ...bundle, label: 'Item Conduit', conduits: [{ ...bundle.conduits![0]!, faces }] });
    const dots = (l: Layout) => overlayShapes(l, view, null, []).filter((s) => s.kind === 'dot').length;
    expect([dots({ ...bundleLayout, blocks: [cell([])] }), dots({ ...bundleLayout, blocks: [cell([{ face: 'south', mode: 'disabled', target: 'Basic Macerator' }])] })])
      .toEqual([0, 1]);   // links alone set nothing; a Disabled face is still set by hand
    expect(fills({ ...bundleLayout, blocks: [cell([])] })).toEqual(['#26c6da']);
  });

  it('keeps a routed or AE2 tap its own kind in any mode', () => {
    const from = { pos: [8, 64, 20] as [number, number, number], dim: 0, networkId: 'e:item:0:1' };
    expect((['routed', 'ae2'] as const).map((kind) => hookupNetworkKind({ kind: 'logistics', from: { ...from, kind }, path: [], parts: [] }, 'enderio')))
      .toEqual(['routed', 'ae2']);
  });
});
