// Why a molten metal the group cannot get is unusable in a swap list or an ingredient option (plan 09 follow-ups): once
// the group gets the metal itself (its dust or ingot), by any route, what is in the way is the tier at which it could
// melt that metal, never the places of its ore. Mini-GT with a Widget made from Molten Titanium alone (`widget-ti`) or
// from an Iron Plate and either Molten Titanium or Water (`widget-mix`); titanium ore is only on the Moon (HV by
// progression).

import { describe, expect, it } from 'vitest';
import { MINI_GT } from '../../helpers/mini-gt.ts';
import { packFromSpec, type PackSpec, type RecipeSpec } from '../../helpers/pack-spec.ts';
import { emptyContext, planLine } from '../../../src/server/planner/plan.ts';
import { defaultSettings } from '../../../src/shared/project/apply-op.ts';
import type { Pack } from '../../../src/shared/types/pack.ts';
import type { PlanSettings } from '../../../src/shared/types/plan.ts';

const MOLTEN_TI = 'fluid:molten.titanium';
const WIDGET = 't:widget@0';
/** Supporting lines off, as the planLine cases of plan.test.ts. */
const S = (p: Partial<PlanSettings>): PlanSettings => ({ ...defaultSettings(), routeDerived: false, ...p });

/** Mini-GT with the Widget's two recipes and `extra` machines, maps and recipes. */
function widgetPack(extra: Pick<PackSpec, 'machines' | 'maps' | 'recipes'>): Pack {
  return packFromSpec({
    ...MINI_GT,
    items: [...MINI_GT.items!, { key: WIDGET, name: 'Widget' }],
    fluids: [...MINI_GT.fluids!, { key: MOLTEN_TI, name: 'Molten Titanium' }],
    maps: [...MINI_GT.maps!, ...(extra.maps ?? [])],
    machines: [...MINI_GT.machines!, ...(extra.machines ?? [])],
    recipes: [...MINI_GT.recipes!,
      { id: 'widget-ti', map: 'gt.recipe.assembler', in: [[MOLTEN_TI, 144]], out: [[WIDGET, 1]], eut: 16 },
      { id: 'widget-mix', map: 'gt.recipe.assembler', in: [['t:iron_plate@0', 1], { any: [[MOLTEN_TI, 72], ['fluid:water', 1000]] }], out: [[WIDGET, 1]], eut: 16 },
      ...(extra.recipes ?? [])],
  });
}

/** What the Widget step's swap list (the cast) and its ingredient option say of Molten Titanium, planned at `tier`. */
async function whyNot(p: Pack, tier: number, settings: Partial<PlanSettings> = {}): Promise<{ way?: string[]; option?: string[] }> {
  const plan = await planLine(p, S({ target: WIDGET, tier, ...settings }), emptyContext());
  expect(plan.status).toBe('ok');
  const step = plan.steps.find((s) => s.mainOutput === WIDGET);
  const way = step?.alternatives.find((a) => a.recipeId === 'widget-ti')?.unusable;
  const option = step?.options?.[0]?.choices.find((c) => c.key === MOLTEN_TI)?.unusable;
  return { ...(way === undefined ? {} : { way }), ...(option === undefined ? {} : { option }) };
}

/** Titanium Dust from Iron Dust in a centrifuge at LV: the group gets titanium without its ore. */
const SIFT_TI: RecipeSpec = { id: 'sift-ti', map: 'gt.recipe.centrifuge', in: [['t:iron_dust@0', 1]], out: [['t:titanium_dust@0', 1]], eut: 30, dur: 100 };

describe('why a molten metal is unusable', () => {
  it('names the tier that melts a metal the group gets another way, not the places of its ore', async () => {
    // Review of the plan 09 follow-ups: on the 2.9 export 17 molten fluids at LV (6 at MV, 1 at HV) whose ore is out of
    // reach but whose dust or ingot the group makes some other way read as places ("Molten Antimony: needs Mars (T2
    // rocket) or Phobos (T2 rocket) or Mercury (T4 rocket) or 15 more"), though only the extractor that melts the dust
    // needs MV. Here an MV fluid extractor melts Titanium Dust, which a centrifuge makes at LV.
    const p = widgetPack({
      machines: [{ mteId: 132, name: 'Advanced Fluid Extractor', maps: ['gt.recipe.fluidextractor'], tier: 2 }],
      recipes: [SIFT_TI, { id: 'melt-ti', map: 'gt.recipe.fluidextractor', in: [['t:titanium_dust@0', 1]], out: [[MOLTEN_TI, 144]], eut: 120, dur: 40 }],
    });
    expect(await whyNot(p, 1)).toEqual({ way: ['needs MV (your tier is LV)'], option: ['needs MV (your tier is LV)'] });
    // A dust the project says it already makes (a stop item) is one the group gets too.
    const stopped = widgetPack({
      machines: [{ mteId: 132, name: 'Advanced Fluid Extractor', maps: ['gt.recipe.fluidextractor'], tier: 2 }],
      recipes: [{ id: 'melt-ti', map: 'gt.recipe.fluidextractor', in: [['t:titanium_dust@0', 1]], out: [[MOLTEN_TI, 144]], eut: 120, dur: 40 }],
    });
    expect(await whyNot(stopped, 1)).toEqual({ way: ['needs Moon (T1 rocket)'], option: ['needs Moon (T1 rocket)'] });
    expect(await whyNot(stopped, 1, { stopItems: ['t:titanium_dust@0'] })).toEqual({ way: ['needs MV (your tier is LV)'], option: ['needs MV (your tier is LV)'] });
  });

  it('names the tier at which the group can build the multiblock that melts it', async () => {
    // On the 2.9 export only the Alloy Blast Smelter melts Niobium, Vanadium, Yttrium, Palladium and Poly-Si dust: its
    // recipes fit MV's voltage, but no group builds one before HV. At MV those read as places, and at LV the lowest tier
    // of any recipe making them (MV) would not do either. Here the smelter's controller needs an HV assembler.
    const p = widgetPack({
      maps: [{ id: 'gt.recipe.alloyblastsmelter', name: 'Alloy Blast Smelter' }],
      machines: [
        { mteId: 123, name: 'Advanced Assembler II', maps: ['gt.recipe.assembler'], tier: 3 },
        { mteId: 2000, name: 'Alloy Blast Smelter', maps: ['gt.recipe.alloyblastsmelter'], kind: 'multiblock' },
      ],
      recipes: [
        SIFT_TI,
        { id: 'abs-ti', map: 'gt.recipe.alloyblastsmelter', in: [['t:titanium_dust@0', 1]], out: [[MOLTEN_TI, 144]], eut: 100, dur: 40 },
        { id: 'make-abs', map: 'gt.recipe.assembler', in: [['t:iron_plate@0', 8]], out: [['machine:2000@0', 1]], eut: 500, dur: 400 },
      ],
    });
    expect(await whyNot(p, 1)).toEqual({ way: ['needs HV (your tier is LV)'], option: ['needs HV (your tier is LV)'] });
    expect(await whyNot(p, 2)).toEqual({ way: ['needs HV (your tier is MV)'], option: ['needs HV (your tier is MV)'] });
    expect(await whyNot(p, 3)).toEqual({});
  });
});
