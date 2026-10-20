// Farms as renewable sources (add-on 17, docs/superpowers/plans/2026-10-20-17-objectives.md; farms.md).
// Pure TypeScript shared by server and browser: nothing from node:* may be imported here.

/** The Tree Growth Simulator's modes in the order of a `gt.recipe.treefarm` row's item slots, `out` (farms.md §1.6). */
export const TGS_MODE_ORDER = ['log', 'sapling', 'leaves', 'fruit'] as const;   // the export's output positions
export type TgsMode = (typeof TGS_MODE_ORDER)[number];
