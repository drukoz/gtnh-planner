// The Tree Growth Simulator as a farm model (add-on 17, architecture §11.45 (2); research docs/research/farms.md §1.3–§1.5):
// one operation at an energy tier on a `gt.recipe.treefarm` row with the tools its input bus holds, what it wears of them
// and what a tool costs. Pure; the synthetic tree farm recipes of a line are built from it.

import { VP } from '../../../shared/gt/overclock.ts';
import type { StuffKey } from '../../../shared/keys.ts';
import { TGS_MODE_ORDER, TOOL_DURABILITY, type TgsMode } from '../../../shared/types/farm.ts';
import type { Product, Recipe } from '../../../shared/types/pack.ts';
import type { PriceTable } from '../costs.ts';

/** The Tree Growth Simulator's controller (`MTETreeFarm`, farms.md §1.1). */
export const TGS_MTE_ID = 15541;
/** Every operation takes 100 ticks at any tier: no overclock, no parallel, no batch (farms.md §1.3). */
export const TGS_OP_TICKS = 100;

/** The output multiplier of energy tier `tier` (`getTierMultiplier`, farms.md §1.3): LV 5, MV 9, HV 17. */
export function tgsOutputMultiplier(tier: number): number {
  return 2 * tier * tier - 2 * tier + 5;
}

/**
 * The one basic tool per mode (farms.md §1.3, §1.5): its item, output multiplier, durability multiplier and material in ingots.
 * Logs take the Saw (its blade is 2 ingots), saplings the Branch Cutter (4 plates; it lasts a quarter as long), leaves the
 * Wire Cutter (3 plates; twice the leaves of shears), fruit the Knife (1 plate); the sticks and the screw are under 3 % of
 * a tool and left out. The electric tools (buzzsaw, chainsaw, electric wire cutter: ×2 or ×4 for 100 EU an operation)
 * and the Forestry grafter are not offered, as their recipes are UNVERIFIED (§1.5).
 */
export const TGS_TOOLS: Readonly<Record<TgsMode, { key: StuffKey; name: string; multiplier: number; durabilityMultiplier: number; units: number }>> = {
  log: { key: 'gregtech:gt.metatool.01@10', name: 'Saw', multiplier: 1, durabilityMultiplier: 1, units: 2 },
  sapling: { key: 'gregtech:gt.metatool.01@30', name: 'Branch Cutter', multiplier: 1, durabilityMultiplier: 0.25, units: 4 },
  leaves: { key: 'gregtech:gt.metatool.01@26', name: 'Wire Cutter', multiplier: 2, durabilityMultiplier: 1, units: 3 },
  fruit: { key: 'gregtech:gt.metatool.01@34', name: 'Knife', multiplier: 1, durabilityMultiplier: 1, units: 1 },
};

/**
 * The operations a tool for `mode` of `material` lasts (farms.md §1.5: each operation adds one use of damage, and GT's
 * tool breaks after `floor(durability × its durability multiplier)`). Throws for a material `TOOL_DURABILITY` lacks,
 * which the settings checks never let through.
 */
export function toolUses(mode: TgsMode, material: string): number {
  const durability = Object.hasOwn(TOOL_DURABILITY, material) ? TOOL_DURABILITY[material] : undefined;
  if (durability === undefined) throw new RangeError(`no tool durability is known for the material ${material}`);
  return Math.floor(durability * TGS_TOOLS[mode].durabilityMultiplier);
}

/** What one tool for `mode` of `material` costs: its ingots at the line's cost per ingot of that material. */
export function toolPrice(mode: TgsMode, material: string, prices: PriceTable): number {
  return TGS_TOOLS[mode].units * prices.costPerIngot(material);
}

/** One Tree Growth Simulator operation: what it makes, the share of each tool it wears out, its EU/t and its ticks. */
export interface TgsOp { outputs: Product[]; wear: Array<{ key: StuffKey; perOp: number }>; euPerTick: number; ticks: number }

/**
 * One operation of a Tree Growth Simulator at energy tier `tier` on a `gt.recipe.treefarm` row; null when no enabled tool has a product.
 * As `MTETreeFarm$1.process` runs it (farms.md §1.3): each mode whose tool is in the bus (`tools`) and whose product the
 * row has makes the row's amount × the tier's output multiplier × the tool's, whole (the machine rolls no chance), in the
 * row's order; each of those modes wears one use of its tool (`toolUses`), in mode order; the machine draws `VP[tier]`
 * EU/t for `TGS_OP_TICKS`. The mode of `row.outputs[k]` is `row.meta.tgsModes[k]` (the loader's, pack/recipes.ts), so a
 * row without it gives null too. The sapling stays in the controller and nothing else goes in.
 */
export function tgsOp(row: Recipe, tier: number, tools: Readonly<Record<TgsMode, boolean>>, material: string): TgsOp | null {
  const modes = row.meta.tgsModes;
  if (modes === undefined) return null;
  const multiplier = tgsOutputMultiplier(tier);
  const outputs: Product[] = [];
  const used = new Set<TgsMode>();
  row.outputs.forEach((p, k) => {
    const mode = modes[k];
    if (mode === undefined || !tools[mode]) return;
    outputs.push({ key: p.key, amount: p.amount * multiplier * TGS_TOOLS[mode].multiplier, chance: 1 });
    used.add(mode);
  });
  if (outputs.length === 0) return null;
  const wear = TGS_MODE_ORDER.filter((mode) => used.has(mode))
    .map((mode) => ({ key: TGS_TOOLS[mode].key, perOp: 1 / toolUses(mode, material) }));
  return { outputs, wear, euPerTick: VP[tier] as number, ticks: TGS_OP_TICKS };
}
