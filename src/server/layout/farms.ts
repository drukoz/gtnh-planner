// Farms in the layout (add-on 17, architecture §11 entry 45 (7)): a farm step (`PlanStep.farm`) is not laid out block by
// block. Each of its new machines (its count less the owned ones, which Plan 5's reuse pins already name) gets an area
// kept for it beside the line on +x, the areas stacked along z by step id, with a pin and one plain build step that says
// what to build or plant there, what goes in its buses, which hatch, and how to connect it. The site search finds the
// line and its areas clear together (`farmExtent`); the line's power and logistics hookups go round the areas and never
// reach them, and the 3D view, the Connections view and the ghost projector show no farm blocks: there are none.

import { tierName } from '../../shared/gt/tiers.ts';
import { fmtInt } from '../../shared/layout/format.ts';
import type { Vec3 } from '../../shared/layout/geometry.ts';
import type { ReservedArea } from '../../shared/types/layout.ts';
import type { Plan, PlanStep } from '../../shared/types/plan.ts';

/** Blocks between the line and its farms, and between two farms. */
export const FARM_GAP = 2;

/** A layer of a crop farm: a soil block and the crop stick on it (the planner makes a crop farm 2 × its layers high). */
const CROP_LAYER_HEIGHT = 2;

/** An area kept for one new farm machine, in the line's own frame. */
export interface FarmArea { stepId: string; local: Vec3 /* min corner in the line's frame */; size: Vec3; text: string }

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * One area per new farm machine (count − owned) of every farm step, beside the line on +x, stacked along z, by step id:
 * the first at x = the line's width + `FARM_GAP` (0 without a line: `lineSize[0]` 0, every other machine owned), y 0,
 * z 0, each next one `FARM_GAP` past the previous one's far side; its size the step's `farm.footprint` (x, height, z),
 * its text `Farm: <farm.text>`.
 */
export function farmAreas(plan: Plan, lineSize: Vec3): FarmArea[] {
  const x = lineSize[0] === 0 ? 0 : lineSize[0] + FARM_GAP;
  const areas: FarmArea[] = [];
  let z = 0;
  for (const s of [...plan.steps].sort((a, b) => compareText(a.id, b.id))) {
    const farm = s.farm;
    if (farm === undefined) continue;
    for (let i = 0; i < s.count - s.owned; i++) {
      const size: Vec3 = [farm.footprint[0], farm.footprint[1], farm.footprint[2]];
      areas.push({ stepId: s.id, local: [x, 0, z], size, text: `Farm: ${farm.text}` });
      z += size[2] + FARM_GAP;
    }
  }
  return areas;
}

/** The box the site search must find clear: the line's own box and every area, from the line's min corner. */
export function farmExtent(lineSize: Vec3, areas: readonly FarmArea[]): Vec3 {
  return areas.reduce<Vec3>((box, a) => [
    Math.max(box[0], a.local[0] + a.size[0]), Math.max(box[1], a.local[1] + a.size[1]), Math.max(box[2], a.local[2] + a.size[2]),
  ], [lineSize[0], lineSize[1], lineSize[2]]);
}

/**
 * The build step of `area`, kept for a machine of farm step `step` (W, L and H its footprint's x, z and height), with
 * ` at pin <n>` only when it has a pin. A Tree Growth Simulator: `Build the Tree Growth Simulator in the <W×L×H> area at
 * pin <n> as NEI shows its structure: <farm.text>; one <tier name> energy hatch, a maintenance hatch, a muffler hatch, an
 * input bus and an output bus. Connect the energy hatch to your power and bring what the output bus fills to the line.`
 * A crop farm: `Lay out the <W×L> area at pin <n>: <farm.text>, with the Crop Manager in the middle and water in its
 * tank. Connect it to your power and bring what it harvests to the line.`, a farm of more than one layer with
 * `, <layers> layers of soil and sticks stacked inside the Crop Manager's reach` after `<farm.text>`.
 */
export function farmBuildText(step: PlanStep, area: FarmArea, pin?: number): string {
  const farm = step.farm;
  if (farm === undefined) throw new RangeError(`step ${step.id} has no farm`);
  const [w, h, l] = area.size;
  const at = pin === undefined ? '' : ` at pin ${pin}`;
  if (farm.kind === 'tgs') {
    return `Build the Tree Growth Simulator in the ${fmtInt(w)}×${fmtInt(l)}×${fmtInt(h)} area${at} as NEI shows its structure: ${farm.text}; `
      + `one ${tierName(farm.tier)} energy hatch, a maintenance hatch, a muffler hatch, an input bus and an output bus. `
      + 'Connect the energy hatch to your power and bring what the output bus fills to the line.';
  }
  const layers = Math.floor(h / CROP_LAYER_HEIGHT);
  const stacked = layers > 1 ? `, ${fmtInt(layers)} layers of soil and sticks stacked inside the Crop Manager's reach` : '';
  return `Lay out the ${fmtInt(w)}×${fmtInt(l)} area${at}: ${farm.text}${stacked}, with the Crop Manager in the middle and water in its tank. `
    + 'Connect it to your power and bring what it harvests to the line.';
}

/**
 * `area` in the world (`Layout.reserved`, before its pin is known): `toWorld`, the frame's own transform, takes the
 * area's two corners into the world; the min corner is kept, and the size as the area lies there (x, height, z).
 */
export function reservedArea(area: FarmArea, toWorld: (local: Vec3) => Vec3): ReservedArea {
  const a = toWorld(area.local);
  const b = toWorld([area.local[0] + area.size[0] - 1, area.local[1] + area.size[1] - 1, area.local[2] + area.size[2] - 1]);
  return {
    stepId: area.stepId, pos: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])],
    size: [Math.abs(a[0] - b[0]) + 1, Math.abs(a[1] - b[1]) + 1, Math.abs(a[2] - b[2]) + 1], text: area.text,
  };
}

/** Where the pin of an area kept for a farm stands: the middle of its floor. */
export function farmPinPos(area: ReservedArea): Vec3 {
  return [area.pos[0] + Math.floor(area.size[0] / 2), area.pos[1], area.pos[2] + Math.floor(area.size[2] / 2)];
}
