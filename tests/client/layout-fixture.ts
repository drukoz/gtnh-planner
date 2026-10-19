// The line layout the 3D view's tests share (Plan 5 Tasks 14 and 15; spec §3.8): a macerator with a conveyor cover on
// its south face, a tin item pipe, an input bus with a circuit, a ghost of an existing stone block and a tin cable that
// belongs to the power hookup, with what the asset routes would answer for the macerator and the conveyor cover (every
// other block has no texture and falls back to a plain colour). Synthetic: nothing here comes from a game file.

import { blockKey } from '../../src/client/three/scene-data.ts';
import type { BlockFaces, CoverLayers, IconDescriptor, TextureLayer } from '../../src/shared/types/assets.ts';
import type { Layout } from '../../src/shared/types/layout.ts';

export const GT = (mteId: number) => ({ id: 'gregtech:gt.blockmachines', meta: 0, mteId });
export const L = (name: string): TextureLayer => ({ path: `gregtech/textures/blocks/${name}.png` });
export const CONV = 'gregtech:gt.metaitem.01@32630';

/** Faces of the macerator (mteId 2001) only: every other block of the layout has none and falls back to a plain colour. */
export const sampleFaces = new Map<string, BlockFaces>([[blockKey(GT(2001)), { block: GT(2001), resolved: true, fallbackColor: [1, 2, 3],
  faces: { down: [L('d')], up: [L('u')], north: [L('front')], south: [L('back')], west: [L('w')], east: [L('e')] } }]]);
export const sampleIcons = new Map<string, IconDescriptor>([[CONV, { key: CONV, layers: [L('conveyor')], source: 'gt', fallbackColor: [9, 9, 9] }]]);
export const sampleCovers = new Map<string, CoverLayers>([[CONV, { item: CONV, layers: [L('iconsets/OVERLAY_CONVEYOR')] }]]);
export const sampleNames: Record<string, string> = { [CONV]: 'Conveyor Module (LV)' };

export const sampleLayout: Layout = { dim: 0, origin: [10, 64, 20], size: [3, 2, 2], rotation: 0, mode: 'direct', status: 'ok',
  blocks: [
    { pos: [10, 64, 20], block: GT(2001), role: 'machine', label: 'Basic Macerator', stepId: 's1', facing: 3,
      covers: [{ face: 'south', item: CONV, settings: { mode: 'export', allowInput: true, rate: 0.5, unit: 'items/s' } }] },
    { pos: [10, 64, 21], block: GT(5600), role: 'pipe', label: 'Tin Item Pipe', connections: 4 | 32 },
    { pos: [11, 64, 20], block: GT(61), role: 'hatch', label: 'Input Bus (LV)', config: { circuit: 2, inputFilter: true } },
    { pos: [9, 64, 21], block: { id: 'minecraft:stone', meta: 0 }, role: 'ghost', label: 'existing Stone' },
    { pos: [9, 65, 21], block: GT(1246), role: 'cable', label: '1x Tin Cable', hookup: 0, connections: 0 },
  ],
  hookups: [{ kind: 'power', from: { pos: [9, 64, 21], dim: 0, kind: 'power', voltageTier: 1, freeAmps: 2, networkId: 'p' }, path: [[9, 65, 21]], parts: [], found: true }],
  pins: [{ n: 2, dim: 0, pos: [9, 64, 21], kind: 'power', text: 'Tap power here' }], buildSteps: [], bom: [], warnings: [] };
