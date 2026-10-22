// Where GregTech takes each hatch on a multiblock (research hatch-rules.md): one row per controller class, read from
// the structure definitions of gregtech 5.09.54.183 (GT++, BartWorks and TecTech live in that jar too). A row keeps
// GT's own shape strings and the hatch elements GT's structure check (`checkPiece`) takes at each element character,
// so `elementMap` can lay them onto the exported structure: the export builds the smallest variant with the controller
// facing north (StructureLib's NORTH_NORMAL_NONE), where a shape cell (a, b, c) of a piece whose controller offset is
// (a0, b0, c0) lands on the export cell controller + (−(a − a0), −(b − b0), c − c0): a runs west, b down and c south.
// Rows are keyed by the simple class name the export gives (architecture §11.19); a structure the row does not fit
// gets no row, so the layout warns instead of guessing. An export of exporter 0.6.0 also holds GT's own rules, cell by
// cell (hatch-export.ts, architecture §11.49): `hatchRulesOf` narrows a fitting row by them, as the row adds what GT
// checks in the controller after its walk (layers, sides, casing minimums), and takes them alone where no row fits.

import type { StuffKey } from '../../shared/keys.ts';
import { posKey, type Vec3 } from '../../shared/layout/geometry.ts';
import type { HatchKind } from '../../shared/types/layout.ts';
import type { Machine, StructureInfo } from '../../shared/types/pack.ts';
import { simpleClassName } from '../world/facts.ts';
import { exportedCells, exportedPower, grownCells, type ExportedCells } from './hatch-export.ts';
import type { HatchClass } from './parts.ts';

/**
 * The hatches the layout puts on a multiblock: the planner's six (buses, fluid hatches, energy, maintenance), the
 * muffler GT needs on some, and a steam multiblock's steam input hatch. Shared with the client, which reads a placed
 * hatch's kind from `LayoutBlock.hatch`.
 */
export type { HatchKind } from '../../shared/types/layout.ts';

/**
 * GT's ordinary hatch class of each kind (a rule's `classes` may name another): what Plan 5 places for a kind, and what
 * a multiblock's build counts for it (plan 12's `hatchSet`).
 */
export const KIND_CLASS: Readonly<Record<HatchKind, HatchClass>> = {
  energy: 'MTEHatchEnergy', input_bus: 'MTEHatchInputBus', output_bus: 'MTEHatchOutputBus', input_hatch: 'MTEHatchInput',
  output_hatch: 'MTEHatchOutput', maintenance: 'MTEHatchMaintenance', muffler: 'MTEHatchMuffler', steam: 'MTEHatchCustomFluidBase',
};

/** One StructureLib piece as GT checks it. */
export interface RulePiece {
  /** GT's shape strings as its source has them (javap drops trailing spaces: a row is padded to the row's `width`). */
  shape: ReadonlyArray<readonly string[]>;
  /** Built with `StructureUtility.transpose`: `shape[b][c]` (layers from the top, rows from the front); else `shape[c][b]`. */
  transposed: boolean;
  /** The controller's place in the piece: the a, b, c offsets GT hands `checkPiece`. */
  offset: readonly [number, number, number];
  /** Checked again one layer up for every layer up to the top (the distillation tower's layers). */
  repeatUp?: true;
}

/** A casing minimum of GT's `checkCasingMin`: casings of these element characters that are no hatch. */
export interface CasingMin {
  chars: string;
  /** The minimum, or the minimum for a structure of `layers` layers. */
  min: number | ((layers: number) => number);
}

/** How a multiblock is powered: EU through an energy hatch, steam through a steam hatch, or neither. */
export type RulePower = 'eu' | 'steam' | 'none';

/** A hatch GT's structure check needs on the machine whatever the recipe moves. */
export interface HatchNeed {
  kind: HatchKind;
  /** Only on cells of these element characters (the cracker's sides and middle); default: wherever the row takes `kind`. */
  chars?: string;
  /**
   * A fluid the machine moves through a hatch of its own that no recipe names (a large boiler's water and steam): that
   * hatch is always added, for this fluid, and the group connects it by hand (`handNote`).
   */
  fluid?: StuffKey;
}

export interface HatchRule {
  /** The controller's simple class name, as the export's `cls` ends. */
  cls: string;
  /** Where in GregTech the row comes from: class, piece, offsets and checks. */
  evidence: string;
  pieces: readonly RulePiece[];
  /** Rows are padded to this width (javap drops a row's trailing spaces); default: the piece's widest row. */
  width?: number;
  /** Per element character: the hatches GT's structure check takes there (any other character takes none). */
  elements: Readonly<Record<string, readonly HatchKind[]>>;
  /**
   * Hatches GT's check needs whatever the recipe moves (`checkHasMufflerHatch`, `checkHasInputHatch`, `checkHasInputBus`,
   * the cracker's sides and middle, a steam input; energy and maintenance go by `power` and `elements`): where the
   * recipe's own hatches give none, the layout adds one, empty. A need with a `fluid` always gets a hatch of its own.
   */
  needs?: ReadonlyArray<HatchKind | HatchNeed>;
  /** What the group must do by hand for the machine to run, said whenever it is laid out (a boiler's water and steam). */
  handNote?: string;
  /** Default 'eu'. */
  power?: RulePower;
  casingMin?: readonly CasingMin[];
  /**
   * The distillation tower: every layer above the bottom holds its own output hatches and GT hands the k-th fluid output
   * of a recipe to the k-th layer (`addFluidOutputs` over `mOutputHatchesByLayer`), so each layer needs one; a recipe
   * with more fluids than the tower has layers needs a taller tower, up to `maxLayers`.
   */
  layerOutputs?: { maxLayers: number };
  /** Per fluid input slot of the recipe (0 = its first fluid): the element characters that slot's input hatch must use. */
  fluidInputSlots?: Readonly<Record<number, string>>;
  /** Hatch classes in place of GT's ordinary ones (a steam multiblock's buses and steam hatch). */
  classes?: Partial<Readonly<Record<HatchKind, string>>>;
  /** What the group does with what the multiblock takes no hatch for. */
  byHand?: string;
  // optional addition (add-on 20): the export's hatch rules this rule was made with (`hatchRulesOf`); `elementMap` then
  // gives only the cells they cover and `ruleFits` holds
  exported?: ExportedCells;
}

// ---- The rows ----

const ALL_SIX: readonly HatchKind[] = ['input_bus', 'output_bus', 'input_hatch', 'output_hatch', 'energy', 'maintenance'];

/** gregtech 5.09.54.183 (GT5u with GT++, BartWorks and TecTech merged in); every row's evidence names its class. */
export const HATCH_RULES: readonly HatchRule[] = [
  {
    cls: 'MTEElectricBlastFurnace',
    evidence: 'MTEElectricBlastFurnace: shape "main" (transposed), checkPiece("main", 1, 3, 0); b = buildHatchAdder.atLeast(InputHatch, '
      + 'OutputHatch, InputBus, OutputBus, Maintenance, Energy) or casing; f = atLeast(OutputHatch) or casing; m = Muffler.newAny; C = coils; '
      + 'checkMachine: energy, maintenance, any input, any output',
    pieces: [{ transposed: true, offset: [1, 3, 0], shape: [['fff', 'fmf', 'fff'], ['CCC', 'C-C', 'CCC'], ['CCC', 'C-C', 'CCC'], ['b~b', 'bbb', 'bbb']] }],
    elements: { b: ALL_SIX, f: ['output_hatch'], m: ['muffler'] },
    needs: ['muffler'],
  },
  {
    cls: 'MTEDistillationTower',
    evidence: 'MTEDistillationTower: checkPiece("base", 1, 0, 0), then checkPiece("layer", 1, h, 0) for h = 1 … up to 11 until the top '
      + '(mTopLayerFound: a layer whose c holds an output hatch or bus via addOutputToMachineList, a maintenance hatch or a casing, not '
      + 'air); b = atLeast(Energy, OutputBus, InputHatch, InputBus, Maintenance); l = atLeast(OutputHatch with addLayerOutputHatch) or '
      + 'energy, maintenance, casing; addFluidOutputs gives fluid k to layer k; missingOutputHatchDT for a layer without one; at least '
      + '3 layers; checkCasingMin(7 × layers − 5); checkHasEnergyHatch, checkHasMaintenanceHatch, checkHasInputHatch',
    pieces: [
      { transposed: true, offset: [1, 0, 0], shape: [['b~b', 'bbb', 'bbb']] },
      { transposed: true, offset: [1, 1, 0], shape: [['lll', 'lcl', 'lll']], repeatUp: true },
    ],
    // `c` takes no layer output (its output hatch is no layer's), so the layout puts nothing there
    elements: { b: ['energy', 'output_bus', 'input_hatch', 'input_bus', 'maintenance'], l: ['output_hatch', 'energy', 'maintenance'] },
    needs: ['input_hatch'],
    casingMin: [{ chars: 'blc', min: (layers) => 7 * layers - 5 }],
    layerOutputs: { maxLayers: 12 },
  },
  {
    cls: 'MTELargeChemicalReactor',
    evidence: 'MTELargeChemicalReactor: shape "main" (transposed), checkPiece("main", 1, 1, 0); c and x = atLeast(InputHatch, OutputHatch, '
      + 'InputBus, OutputBus, Maintenance, Energy) or PTFE casing (x also the one coil); P = PTFE pipe casing; checkCasingMin(8); '
      + 'need_exactly_one_coil; checkMachine: energy, maintenance, any input, any output',
    pieces: [{ transposed: true, offset: [1, 1, 0], shape: [['ccc', 'cxc', 'ccc'], ['c~c', 'xPx', 'cxc'], ['ccc', 'cxc', 'ccc']] }],
    elements: { c: ALL_SIX, x: ALL_SIX },
    casingMin: [{ chars: 'cx', min: 8 }],
  },
  {
    cls: 'MTEOilCracker',
    evidence: 'MTEOilCracker: shape "main" (transposed), checkPiece("main", 2, 1, 0); l = InputHatch with addLeftHatchToMachineList, Energy, '
      + 'Maintenance; r = OutputHatch with addRightHatchToMachineList, Energy, Maintenance (inputs on one side, outputs on the other); '
      + 'm = InputHatch with addMiddleInputToMachineList, InputBus, Energy, Maintenance; getStoredFluidsForColor takes only catalysts '
      + '(OilCrackerBackend: a recipe\'s second fluid input) from the middle and the rest from the side; checkCasingMin(18); checkMachine: '
      + 'missingHatch(InputHatch) and missingHatch(OutputHatch) without a side input and a side output, maintenance, energy, '
      + 'cracker_missing_middle_input_hatch',
    pieces: [{ transposed: true, offset: [2, 1, 0], shape: [['lcmcr', 'lcmcr', 'lcmcr'], ['lc~cr', 'l---r', 'lcmcr'], ['lcmcr', 'lcmcr', 'lcmcr']] }],
    elements: { l: ['input_hatch', 'energy', 'maintenance'], r: ['output_hatch', 'energy', 'maintenance'], m: ['input_hatch', 'input_bus', 'energy', 'maintenance'] },
    needs: [{ kind: 'input_hatch', chars: 'l' }, { kind: 'output_hatch', chars: 'r' }, { kind: 'input_hatch', chars: 'm' }],
    fluidInputSlots: { 0: 'l', 1: 'm' },
    casingMin: [{ chars: 'lrm', min: 18 }],
  },
  {
    cls: 'MTEVacuumFreezer',
    evidence: 'MTEVacuumFreezer: getStructureDefinition shape (transposed), checkPiece(mName, 1, 1, 0); C = atLeast(InputHatch, OutputHatch, '
      + 'InputBus, OutputBus, Maintenance, Energy) or frost proof casing; checkCasingMin(16); checkMachine: energy, maintenance, any input, '
      + 'any output',
    pieces: [{ transposed: true, offset: [1, 1, 0], shape: [['CCC', 'CCC', 'CCC'], ['C~C', 'C-C', 'CCC'], ['CCC', 'CCC', 'CCC']] }],
    elements: { C: ALL_SIX },
    casingMin: [{ chars: 'C', min: 16 }],
  },
  {
    cls: 'MTEImplosionCompressor',
    evidence: 'MTEImplosionCompressor: getStructureDefinition shape (transposed), checkPiece(mName, 1, 1, 0); C = atLeast(InputBus, OutputBus, '
      + 'Maintenance, Energy, Muffler) or solid steel casing; checkCasingMin(16); checkMachine: energy, maintenance, checkHasMufflerHatch, '
      + 'checkHasInputBus, checkHasOutputBus',
    pieces: [{ transposed: true, offset: [1, 1, 0], shape: [['CCC', 'CCC', 'CCC'], ['C~C', 'C-C', 'CCC'], ['CCC', 'CCC', 'CCC']] }],
    elements: { C: ['input_bus', 'output_bus', 'maintenance', 'energy', 'muffler'] },
    needs: ['muffler', 'input_bus', 'output_bus'],
    casingMin: [{ chars: 'C', min: 16 }],
  },
  {
    cls: 'MTEPyrolyseOven',
    evidence: 'MTEPyrolyseOven: shape "main" (not transposed), checkPiece("main", 3, 4, 0); F = atLeast(InputBus, InputHatch, Muffler) or '
      + 'pyrolyse oven casing; G = atLeast(OutputBus, OutputHatch, Energy, Maintenance) or casing; checkCasingMin(60); checkMachine: energy, '
      + 'maintenance, checkHasMufflerHatch, any input, any output',
    width: 7,
    pieces: [{
      transposed: false, offset: [3, 4, 0], shape: [
        ['', '', ' F   F', 'FBF FBF', 'DBD~DBD', 'GGGGGGG'],
        ['', '', ' C   C', 'F FFF F', 'D D D D', 'GCGGGCG'],
        ['', '', ' C   C', 'F FFF F', 'D     D', 'GCGGGCG'],
        ['', '', ' C   C', 'F FFF F', 'D D D D', 'GCGGGCG'],
        [' E   E', ' A   A', ' A   A', 'FAF FAF', 'DADDDAD', 'GGGGGGG'],
      ],
    }],
    elements: { F: ['input_bus', 'input_hatch', 'muffler'], G: ['output_bus', 'output_hatch', 'energy', 'maintenance'] },
    needs: ['muffler'],
    casingMin: [{ chars: 'DFG', min: 60 }],
  },
  {
    cls: 'MTEBioVat',
    evidence: 'bartworks MTEBioVat: shape "main" (transposed), checkPiece("main", 2, 3, 0); c = atLeast(Maintenance, InputBus, OutputBus, '
      + 'InputHatch, OutputHatch, Energy, RadioHatch) or casing; g = glass; a = bio fluid or air; checkCasingMin(19); checkMachine: at most '
      + 'one radio hatch, energy, maintenance, checkHasInputHatch, checkOneOutputHatch (exactly one)',
    pieces: [{
      transposed: true, offset: [2, 3, 0], shape: [
        ['ccccc', 'ccccc', 'ccccc', 'ccccc', 'ccccc'], ['ggggg', 'gaaag', 'gaaag', 'gaaag', 'ggggg'],
        ['ggggg', 'gaaag', 'gaaag', 'gaaag', 'ggggg'], ['cc~cc', 'ccccc', 'ccccc', 'ccccc', 'ccccc'],
      ],
    }],
    elements: { c: ALL_SIX },
    needs: ['input_hatch', 'output_hatch'],
    casingMin: [{ chars: 'c', min: 19 }],
  },
  {
    cls: 'MTESolarFactory',
    evidence: 'MTESolarFactory: shape "t1" (transposed), checkPiece("t1", 2, 4, 0); A = atLeast(InputHatch, InputBus, OutputBus, '
      + 'Maintenance, Energy) or casing (no output hatch); E = frame; G = glass; checkCasingMin(15); checkMachine: checkHasAnyEnergy, '
      + 'maintenance, checkHasInputBus, checkHasInputHatch, checkHasOutputBus',
    width: 5,
    pieces: [{
      transposed: true, offset: [2, 4, 0], shape: [
        ['EAAAE', 'AAAAA', 'AAAAA', 'AAAAA', 'EAAAE'], ['E   E', ' GGG', ' G G', ' GGG', 'E   E'], ['E   E', ' GGG', ' G G', ' GGG', 'E   E'],
        ['E   E', ' GGG', ' G G', ' GGG', 'E   E'], ['EA~AE', 'AAAAA', 'AAAAA', 'AAAAA', 'EAAAE'],
      ],
    }],
    elements: { A: ['input_hatch', 'input_bus', 'output_bus', 'maintenance', 'energy'] },
    needs: ['input_bus', 'input_hatch', 'output_bus'],
    casingMin: [{ chars: 'A', min: 15 }],
  },
  {
    cls: 'MTESteamMixer',
    evidence: 'MTESteamMixer: shape "main" (transposed), checkPiece("main", 2, 2, 0); A = steam input (buildSteamInput: MTEHatchCustomFluidBase '
      + 'with steam) or atLeast(InputBus_Steam, OutputBus_Steam, OutputHatch, InputHatch) or casing; MTESteamMultiBlockBase: steam buses '
      + 'only (MTEHatchSteamBusInput, MTEHatchSteamBusOutput), no maintenance (getDefaultHasMaintenanceChecks false); checkMachine: '
      + 'checkCasingMin(25), checkHasSteamInput, any input, any output',
    width: 5,
    pieces: [{
      transposed: true, offset: [2, 2, 0], shape: [
        ['', '  A', ' ABA', '  A', ''], ['  A', '', 'A C A', '', '  A'], [' A~A', 'A D A', 'ADBDA', 'A D A', ' AAA'], [' AAA', 'AAAAA', 'AAAAA', 'AAAAA', ' AAA'],
      ],
    }],
    elements: { A: ['steam', 'input_bus', 'output_bus', 'output_hatch', 'input_hatch'] },
    needs: ['steam'],
    power: 'steam',
    classes: { input_bus: 'MTEHatchSteamBusInput', output_bus: 'MTEHatchSteamBusOutput', steam: 'MTEHatchCustomFluidBase' },
    casingMin: [{ chars: 'A', min: 25 }],
  },
  {
    cls: 'MTELargeBoilerBronze',
    evidence: 'MTELargeBoilerBase (MTELargeBoilerBronze): createStructureDefinition shape "main" (not transposed), checkPiece("main", 2, 4, 0); '
      + 'C and F = atLeast(InputHatch, InputBus, OutputHatch, Maintenance, Muffler) or casing / firebox; P = pipe casing; '
      + 'checkCasingMin(20) casings and (5) fireboxes; checkMachine: maintenance, checkHasMufflerHatch, checkHasInputHatch, '
      + 'checkHasOutputHatch; onRunningTick boils water from its input hatches into steam (addOutputPartial) and calls explodeMultiblock '
      + 'when consumeWater fails ("Boiler had no water"); its recipes (largeboilerfakefuels) name only the fuel',
    width: 5,
    pieces: [{
      transposed: false, offset: [2, 4, 0], shape: [
        ['   C', '   C', '   C', ' CCC', 'CC~CC', 'FFFFF'], ['  CCC', '  C C', 'PPC C', 'PCC P', 'C   C', 'FFFFF'],
        ['   C', '   C', '   C', ' CCC', 'CCCCC', 'FFFFF'],
      ],
    }],
    elements: { C: ['input_hatch', 'input_bus', 'output_hatch', 'maintenance', 'muffler'], F: ['input_hatch', 'input_bus', 'output_hatch', 'maintenance', 'muffler'] },
    needs: ['muffler', { kind: 'input_hatch', fluid: 'fluid:water' }, { kind: 'output_hatch', fluid: 'fluid:steam' }],
    handNote: 'keep water in its water input hatch whenever it burns (a large boiler that runs dry explodes) and take the steam from '
      + 'its steam output hatch, both by hand',
    power: 'none',
    casingMin: [{ chars: 'C', min: 20 }, { chars: 'F', min: 5 }],
  },
  {
    cls: 'MTEBrickedBlastFurnace',
    evidence: 'MTEBrickedBlastFurnace (a MetaTileEntity, no hatches): shape "main" (transposed), checked at (1, 2, 0); c = firebricks, '
      + 'l = lava or air; allowPutStack and allowPullStack false',
    pieces: [{ transposed: true, offset: [1, 2, 0], shape: [['ccc', 'c-c', 'ccc'], ['ccc', 'clc', 'ccc'], ['c~c', 'clc', 'ccc'], ['ccc', 'ccc', 'ccc']] }],
    elements: {},
    power: 'none',
    byHand: 'load and empty it by hand',
  },
  {
    cls: 'MTECokeOven',
    evidence: 'MTECokeOven: shape "main" (transposed), checkPiece("main", 1, 1, 0); C = atLeast(MTECokeOven$HatchElement: '
      + 'MTEHatchCokeOven only) or coke oven bricks; getDefaultHasMaintenanceChecks false; allowPutStack only from no side',
    pieces: [{ transposed: true, offset: [1, 1, 0], shape: [['CCC', 'CCC', 'CCC'], ['C~C', 'C-C', 'CCC'], ['CCC', 'CCC', 'CCC']] }],
    elements: {},
    power: 'none',
    byHand: 'fit it with a Coke Oven Hatch, or load and empty it by hand',
  },
];

const BY_CLASS: ReadonlyMap<string, HatchRule> = new Map(HATCH_RULES.map((r) => [r.cls, r]));

/** The row of `m`'s controller class; null for a class without one. */
export function hatchRuleFor(m: Pick<Machine, 'cls'>): HatchRule | null {
  return BY_CLASS.get(simpleClassName(m.cls) ?? '') ?? null;
}

/** The power a row says its multiblock runs on. */
export function rulePower(rule: HatchRule): RulePower {
  return rule.power ?? 'eu';
}

/** The hatches a row says GT's check needs whatever the recipe moves, each as a `HatchNeed`. */
export function ruleNeeds(rule: HatchRule): HatchNeed[] {
  return (rule.needs ?? []).map((n): HatchNeed => (typeof n === 'string' ? { kind: n } : { ...n }));
}

// ---- The rows on an exported structure ----

/**
 * Every cell of `rule`'s pieces on a structure of `size` whose controller is at `controller`: posKey → element character.
 * A rule made with the export's hatch rules (`exported`) gives only the cells the export covers, grown with a taller
 * structure as `grownCells` grows them: a row narrowed by them keeps its pieces' characters there, and its controller's
 * `~` and air `-`; the export's rules alone (no pieces) give the export's characters. A cell the export does not cover
 * takes no hatch.
 */
export function elementMap(rule: HatchRule, controller: Vec3, size: Vec3): Map<string, string> {
  if (rule.exported === undefined) return pieceMap(rule, controller, size);
  const covered = grownCells(rule.exported, size[1] - rule.exported.height).charOf;
  if (rule.pieces.length === 0) return new Map(covered);
  return new Map([...pieceMap(rule, controller, size)].filter(([key, ch]) => ch === '~' || ch === '-' || covered.has(key)));
}

/** `elementMap` from the pieces alone. */
function pieceMap(rule: HatchRule, controller: Vec3, size: Vec3): Map<string, string> {
  const map = new Map<string, string>();
  for (const piece of rule.pieces) {
    const width = Math.max(rule.width ?? 0, ...piece.shape.flat().map((row) => row.length));
    const repeats = piece.repeatUp === true ? Math.max(1, size[1] - (controller[1] + piece.offset[1])) : 1;
    for (let k = 0; k < repeats; k++) {
      piece.shape.forEach((outer, i) => outer.forEach((text, j) => {
        const row = text.padEnd(width, ' ');
        const [b, c] = piece.transposed ? [i, j] : [j, i];
        for (let a = 0; a < row.length; a++) {
          const ch = row[a]!;
          if (ch === ' ') continue;
          const pos: Vec3 = [controller[0] - (a - piece.offset[0]), controller[1] - (b - piece.offset[1] - k), controller[2] + (c - piece.offset[2])];
          map.set(posKey(pos), ch);
        }
      }));
    }
  }
  return map;
}

/**
 * Whether `rule` describes a structure of `size` with its controller at `controller` and its blocks at `blocks`: GT's
 * controller character lands on the controller, and every block of the structure on a cell of the pieces (so a variant
 * the row was not read from gets no row). A rule made with the export's hatch rules was made for the exported
 * structure (`hatchRulesOf`), so it fits.
 */
export function ruleFits(rule: HatchRule, controller: Vec3, size: Vec3, blocks: readonly Vec3[]): boolean {
  if (rule.exported !== undefined) return true;
  const map = elementMap(rule, controller, size);
  if (map.get(posKey(controller)) !== '~') return false;
  return blocks.every((p) => map.has(posKey(p)));
}

/** The hatches `char` takes under `rule`. */
export function elementTakes(rule: HatchRule, char: string | undefined, kind: HatchKind): boolean {
  return char !== undefined && (rule.elements[char]?.includes(kind) ?? false);
}

/** Whether `rule` takes `kind` anywhere. */
export function ruleTakes(rule: HatchRule, kind: HatchKind): boolean {
  return Object.values(rule.elements).some((kinds) => kinds.includes(kind));
}

// ---- The rules of a multiblock: the export's, the table's, or both (architecture §11.49) ----

/** Where a multiblock's hatch rules come from: the export's narrowed by a fitting row, the export's alone, the row alone. */
export type HatchSource = 'both' | 'export' | 'table';

/**
 * The hatch rules of `m`. With the export's (`exportedCells`) and a row that fits the exported structure, the row
 * narrowed by the export (`'both'`): each of its characters keeps, in the row's order, the kinds the export gives on
 * every covered cell of it (a character without a covered cell keeps the row's, as `elementMap` gives none of its cells
 * and no hatch goes there), and its pieces and notes stay as they are.
 * Where the export takes more than the row (a cracker's sides, a tower's top centre) the row wins, as it holds what GT
 * checks in the controller after its walk; the layout then stays inside both. With the export's and no fitting row,
 * the export's alone (`'export'`; `rowUnfit` when there is a row and it does not fit): no needs, notes or casing
 * minimums. Without the export's, a fitting row (`'table'`); else null.
 */
export function hatchRulesOf(m: Machine): { rule: HatchRule; source: HatchSource; rowUnfit: boolean } | null {
  const st = m.structure;
  if (st === undefined) return null;
  const cells = exportedCells(m);
  const row = hatchRuleFor(m);
  const fitting = row !== null && ruleFits(row, st.controller, st.size, st.blocks.map((b) => b.pos)) ? row : null;
  if (cells === null) return fitting === null ? null : { rule: fitting, source: 'table', rowUnfit: false };
  if (fitting === null) return { rule: exportRule(m, cells), source: 'export', rowUnfit: row !== null };
  return { rule: { ...fitting, elements: narrowedElements(fitting, cells, st), exported: cells }, source: 'both', rowUnfit: false };
}

/**
 * `row`'s element lists, each narrowed to the layout kinds the export gives on every covered cell of its character:
 * one character is one element of GT's definition, so a character whose cells the export treats differently is a row
 * error (add-on 20's real-data acceptance reports it), and the layout keeps to what all of them take. A character the
 * export covers nowhere keeps the row's kinds: none of its cells is in `elementMap`, so a hatch GT needs there finds no
 * cell (`hatch_cells_short`), where a list emptied here would say GT takes it nowhere on the machine (`hatch_not_taken`).
 */
function narrowedElements(row: HatchRule, cells: ExportedCells, st: StructureInfo): Record<string, HatchKind[]> {
  const map = elementMap(row, st.controller, st.size);
  const given = new Map<string, ReadonlySet<HatchKind>>();
  for (const [key, exportedChar] of cells.charOf) {
    const ch = map.get(key);
    if (ch === undefined) continue;
    const kinds = cells.takes.get(exportedChar) ?? new Set<HatchKind>();
    const before = given.get(ch);
    given.set(ch, before === undefined ? kinds : new Set([...before].filter((kind) => kinds.has(kind))));
  }
  return Object.fromEntries(Object.entries(row.elements).map(([ch, kinds]) => {
    const taken = given.get(ch);
    return [ch, taken === undefined ? [...kinds] : kinds.filter((kind) => taken.has(kind))];
  }));
}

/** The export's rules alone: its characters with their layout kinds, the steam buses' classes and the power it implies. */
function exportRule(m: Machine, cells: ExportedCells): HatchRule {
  return {
    cls: simpleClassName(m.cls) ?? m.cls, evidence: 'exporter 0.6.0 structure elements', pieces: [],
    elements: Object.fromEntries([...cells.takes].map(([ch, kinds]) => [ch, [...kinds]])),
    classes: cells.classes, power: exportedPower(cells), exported: cells,
  };
}
