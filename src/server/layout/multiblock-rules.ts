// The multiblocks the line runs by hand: the one GregTech lets nothing automated fill, and the one it fills only through
// a hatch of its own, which the layout does not lay (architecture §11 entry 48; Plan 5 follow-up 8; add-on 15 rulings
// R7). Read with javap from the pack's GT 5.09.54.183 jar: of every multiblock controller in it (GT, GT++,
// BartWorks, GoodGenerator, TecTech and KekzTech classes that are structure-checked `MetaTileEntity`s) only these two
// and BartWorks' `MTEWindmill` override `allowPullStack`, `allowPutStack` or `allowCoverOnSide`. The routed, AE2 and
// EnderIO modes run these two by hand (`unitsFromPlan`'s `primitive` option); add-on 15 gives machine-to-machine mode
// the same rule. And the controllers with an Input Separation setting (architecture §11 entry 51), which the feeding
// settings turn off and the static feeding rules check where a recipe's items come through two or more input buses.

import type { Machine } from '../../shared/types/pack.ts';
import { simpleClassName } from '../world/facts.ts';
import type { ManualReason } from './arrange.ts';

/**
 * Controllers that let nothing automated move items in or out: `MTEBrickedBlastFurnace` (a plain `MetaTileEntity` with
 * no hatches; its `allowPullStack` and `allowPutStack` are false on every side, and it takes only covers allowed on
 * primitive blocks, the chest and decorative covers). It gets no buses, covers or pipes: fill and empty it by hand.
 */
export const NO_AUTOMATION: ReadonlySet<string> = new Set(['MTEBrickedBlastFurnace']);

/**
 * Controllers that take items only through a hatch of their own kind, which the planner does not lay out:
 * `MTECokeOven` (no cover fits it, `allowPutStack` takes nothing from a real side and `drain` gives nothing to one; its
 * structure's one hatch element is the Coke Oven Hatch, `MTEHatchCokeOven`, which moves items and Creosote in or out
 * every 20 ticks). Like `NO_AUTOMATION` they take no bus, energy or maintenance hatch.
 */
export const OWN_HATCH: ReadonlySet<string> = new Set(['MTECokeOven']);

/** Why a multiblock is run by hand, or null when the line's logistics can serve it. */
export function manualReasonOf(m: Pick<Machine, 'cls' | 'kind'>): ManualReason | null {
  if (m.kind !== 'multiblock') return null;
  const name = simpleClassName(m.cls) ?? '';
  return NO_AUTOMATION.has(name) ? 'no_automation' : OWN_HATCH.has(name) ? 'own_hatch' : null;
}

/**
 * Controllers that have an Input Separation setting, on when built (research machine-feeding §1.2): the concrete
 * multiblock controllers of GT 5.09.54.183's jar whose `supportsInputSeparation()` resolves to true, as
 * `IControllerWithOptionalFeatures.getDefaultInputSeparationMode()` returns it and `MTEMultiBlockBase`'s constructor
 * starts `inputSeparation` from that (69 of the jar's 290, read with javap over every controller's class chain on
 * 2026-10-20; the same list as add-on 21's `INPUT_SEPARATION_DEFAULT`, its E15). With it on, each input bus is checked
 * alone. `MTECircuitAssemblyLine` decides by its machine mode, off on a new one, and is left out. Every other
 * controller has no such setting: `MTEMultiBlockBase.supportsInputSeparation()` is false, so `inputSeparation` stays
 * false, no button or Screwdriver click switches it, and `doCheckRecipe` reads all its input buses together
 * (`getStoredInputsForColor`), so a recipe whose items come through two buses starts there.
 */
export const INPUT_SEPARATION_DEFAULT: ReadonlySet<string> = new Set([
  'MTEAdvEBF', 'MTEAdvImplosionCompressor', 'MTEAlloyBlastSmelter', 'MTEAmazonPackagerLegacy', 'MTEAutoCrafter',
  'MTEBECIONode', 'MTEBeamCrafter', 'MTEComponentAssemblyLine', 'MTECryogenicFreezer', 'MTEDEFusionCrafter',
  'MTEDigester', 'MTEDissolutionTank', 'MTEElectricBlastFurnace', 'MTEEndothermicFridge', 'MTEEntropicProcessor',
  'MTEExoFoundry', 'MTEExothermicHearth', 'MTEExoticModule', 'MTEFrothFlotationCell', 'MTEHIPCompressor',
  'MTEIndustrialArcFurnace', 'MTEIndustrialBendingMachine', 'MTEIndustrialBrewery', 'MTEIndustrialCentrifuge',
  'MTEIndustrialChemicalBath', 'MTEIndustrialChisel', 'MTEIndustrialCokeOven', 'MTEIndustrialCompressor',
  'MTEIndustrialCuttingMachine', 'MTEIndustrialElectrolyzer', 'MTEIndustrialElectromagneticSeparator',
  'MTEIndustrialExtractor', 'MTEIndustrialExtruder', 'MTEIndustrialForgeHammer', 'MTEIndustrialFormingPress',
  'MTEIndustrialLaserEngraver', 'MTEIndustrialMixer', 'MTEIndustrialMixerLegacy', 'MTEIndustrialMolecularTransformer',
  'MTEIndustrialPackager', 'MTEIndustrialRockBreaker', 'MTEIndustrialSifter', 'MTEIndustrialThermalCentrifuge',
  'MTEIndustrialWireMill', 'MTEIndustrialWireMillLegacy', 'MTELatex', 'MTEMassSolidifier', 'MTEMegaAlloyBlastSmelter',
  'MTEMegaBlastFurnaceLegacy', 'MTEMegaChemicalReactor', 'MTEMegaChemicalReactorLegacy', 'MTEMegaDistillationTower',
  'MTEMoltenModule', 'MTEMultiAutoclave', 'MTEMultiCanner', 'MTEMultiLathe', 'MTENanoForge', 'MTENeutroniumCompressor',
  'MTENuclearSaltProcessingPlant', 'MTEOreWashingPlant', 'MTEPCBFactory', 'MTEPlasmaModule', 'MTEPyrolyseOven',
  'MTEPyrolyseOvenLegacy', 'MTEQuantumForceTransformer', 'MTESmeltingModule', 'MTESolarFactory', 'MTESpinmatron',
  'MTEThermalBoiler',
]);

/** Whether a multiblock controller has an Input Separation setting, on when built (`INPUT_SEPARATION_DEFAULT`). */
export function hasInputSeparation(m: Pick<Machine, 'cls' | 'kind'> | undefined): boolean {
  return m?.kind === 'multiblock' && INPUT_SEPARATION_DEFAULT.has(simpleClassName(m.cls) ?? '');
}
