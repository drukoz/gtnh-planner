// Power networks and the clear-weather / rain / 24-hour-average power estimate (Plan 4 Task 9; spec §3.5,
// architecture §11.19, gt-mechanics §3.2 and §4.1–§4.3). GT cables form sub-networks; machines join them through cable
// bits and emitter output faces, and sub-networks that share a machine are one network. Steam from boilers, and from
// multiblock boilers through their output hatches, reaches basic turbines through GT fluid pipes and tanks (plan 10
// Task 1), and each turbine's EU/t counts toward its own network. Floating-point figures are left unrounded (the UI
// rounds).

import { V } from '../../shared/gt/tiers.ts';
import type { PowerNetwork, TapPoint } from '../../shared/types/world.ts';
import type { GtMachineRec, GtPipeRec } from './classify/gt.ts';
import type { TankRec } from './classify/tanks.ts';
import { ENERGY_HATCH_RE, simpleClassName, type ScanPackFacts } from './facts.ts';
import { comparePos, majority, MAX_TAPS_PER_NETWORK, pickTaps, smallestPos, UnionFind } from './graph.ts';
import { DIRS, OPPOSITE, posKey, step, type Vec3 } from './model.ts';

export { MAX_TAPS_PER_NETWORK } from './graph.ts';

/**
 * The two solar boilers (gt-mechanics §4.2; the pack keeps the `MachineStats` defaults): output while clean (`max`) and
 * fully calcified (`min`) in L/s, the producing ticks before calcification starts, and the share of a clear Minecraft
 * day the boiler is hot (above 100 °C) at the tick phase most boilers run in.
 */
export const SOLAR_BOILERS = Object.freeze({
  MTEBoilerSolar: Object.freeze({ max: 120, min: 40, calcTicks: 1_080_000, hotFraction: 16_843 / 24_000 }),
  MTEBoilerSolarSteel: Object.freeze({ max: 360, min: 120, calcTicks: 1_080_000, hotFraction: 22_577 / 24_000 }),
});

/**
 * Vanilla 1.7.10 weather (`World.updateWeatherBody`): rain lasts 12,000–23,999 ticks and clear spells 12,000–179,999,
 * so on average 18,000 and 96,000; a hot HP solar boiler keeps making steam for 8,399 ticks into rain (gt-mechanics §4.2).
 */
export const WEATHER = Object.freeze({ meanRainTicks: 18_000, meanClearTicks: 96_000, solarRainHoldTicks: 8_399 });

/** How long the battery buffers must carry a network through rain: the mean rain spell less the boiler's hold, ≈ 8 min. */
export const RAIN_OUTAGE_SECONDS = 480;

/** The share of time solar boilers make no steam because of rain: (18,000 − 8,399) / (18,000 + 96,000). */
export const RAIN_OUTAGE_FRACTION = 9_601 / 114_000;

/**
 * A running multiblock's load lands on the nearest energy hatch at most this far away (Chebyshev distance), and a fluid
 * output hatch belongs to the nearest multiblock controller this close.
 */
export const HATCH_LINK_RANGE = 8;

/**
 * Multiblock steam producers by the simple name of their class: GT's large boilers and GT++'s thermal boiler, legacy
 * ones included (plan 10, ruling R6).
 */
const STEAM_MULTIBLOCK_RE = /^MTE(LargeBoiler|ThermalBoiler)/;

export interface PowerInput {
  machines: GtMachineRec[];
  pipes: GtPipeRec[];
  /** Blocks that hold fluid and pass steam between the pipes and machines touching them (rule 4). */
  tanks: TankRec[];
  facts: ScanPackFacts;
  baseOf: (dim: number, pos: Vec3) => string | null;
  occupied: (dim: number, pos: Vec3) => boolean;
}

export interface PowerResult {
  networks: PowerNetwork[];
  cableNetwork: Map<string, string> /* posKey → network id */;
  cableTier: Map<string, number> /* posKey → voltage tier on that cable */;
  unknownBoilers: number /* boilers and multiblock steam producers whose steam output the export does not give (rule 5) */;
  /** The networks with steam turbines no steam producer is connected to (rule 4), in `networks` order, and how many each has. */
  unfedTurbines: Array<{ networkId: string; turbines: number }>;
}

/**
 * The solar boiler a machine is, by the simple name of its fully qualified class (architecture §11.19). Only a machine
 * without a class falls back to its mteId (105 simple, 114 high pressure); a known class that is not a solar boiler
 * gives null whatever the id.
 */
export function solarBoilerOf(m: Pick<GtMachineRec, 'mteId' | 'cls'>): (typeof SOLAR_BOILERS)[keyof typeof SOLAR_BOILERS] | null {
  if (m.cls === null) return m.mteId === 105 ? SOLAR_BOILERS.MTEBoilerSolar : m.mteId === 114 ? SOLAR_BOILERS.MTEBoilerSolarSteel : null;
  const name = simpleClassName(m.cls);
  return name === 'MTEBoilerSolar' || name === 'MTEBoilerSolarSteel' ? SOLAR_BOILERS[name] : null;
}

/**
 * Steam output in L/s after `runTime` producing ticks (`MTEBoilerSolar`, integer maths): `max` up to `calcTicks`, then
 * falling linearly, never below `min`.
 */
export function solarOutput(b: { max: number; min: number; calcTicks: number }, runTime: number): number {
  if (runTime <= b.calcTicks) return b.max;
  return Math.max(b.min, b.max - Math.floor((b.max * (runTime - b.calcTicks)) / b.calcTicks));
}

/** EU an emitter of tier `t` pays per amp on top of the voltage it sends (gt-mechanics §3.2). */
function emitterLoss(t: number): number {
  return 2 ** Math.max(0, t - 1);
}

function voltsOf(t: number): number {
  const v = V[t];
  if (v === undefined) throw new RangeError(`tier must be an integer from 0 to ${V.length - 1}, got ${t}`);
  return v;
}

/** Steam in L/s a basic steam turbine of `tier` needs for its full 1 A of `V[tier]`, emitter loss included (gt-mechanics §4.1). */
export function turbineSteamForFull(tier: number): number {
  return ((voltsOf(tier) + emitterLoss(tier)) * (6 + tier) * 20) / 3;
}

/** EU/t a basic steam turbine of `tier` sends with `steamLps` L/s of steam: 3 EU per 6 + tier L, less emitter loss, at most `V[tier]`. */
export function turbineEUt(tier: number, steamLps: number): number {
  const v = voltsOf(tier);
  return Math.min(v, (steamLps * 3 * v) / (20 * (6 + tier) * (v + emitterLoss(tier))));
}

// ---- buildPower ----

interface Figures { clear: number; rain: number; average: number }

const ZERO: Readonly<Figures> = Object.freeze({ clear: 0, rain: 0, average: 0 });
const SIDES = [0, 1, 2, 3, 4, 5] as const;
const MAX_TIER = V.length - 1;

const keyOf = (r: { dim: number; pos: Vec3 }): string => posKey(r.dim, r.pos[0], r.pos[1], r.pos[2]);
const keyAt = (dim: number, p: Vec3): string => posKey(dim, p[0], p[1], p[2]);
const hasBit = (bits: number, side: number): boolean => (bits & (1 << side)) !== 0;
const isSide = (s: number): boolean => Number.isInteger(s) && s >= 0 && s < DIRS.length;
/** A tier `V` has a voltage for. */
const knownTier = (t: number | null): t is number => t !== null && V[t] !== undefined;

/** A boiler in the steam graph: a solar boiler (by class, or by id without one) or any other machine of kind `boiler`. */
const isBoiler = (m: GtMachineRec): boolean => solarBoilerOf(m) !== null || m.kind === 'boiler';
/** A multiblock steam producer's controller (ruling R6); its steam leaves through its fluid output hatches. */
const isSteamMultiblock = (m: GtMachineRec): boolean => m.multiblock && STEAM_MULTIBLOCK_RE.test(simpleClassName(m.cls) ?? '');
const isSteamProducer = (m: GtMachineRec): boolean => isBoiler(m) || isSteamMultiblock(m);
/** A fluid output hatch (ruling R6): it sends its multiblock's fluid out of its front. */
const isOutputHatch = (m: GtMachineRec): boolean => m.kind === 'hatch' && simpleClassName(m.cls) === 'MTEHatchOutput';
const isTurbine = (m: GtMachineRec): boolean => m.kind === 'turbine';
const isGenerator = (m: GtMachineRec): boolean => m.kind === 'turbine' || m.kind === 'generator';
const isEmitter = (m: GtMachineRec): boolean => isGenerator(m) || m.kind === 'battery_buffer' || m.kind === 'transformer';
const isEnergyHatch = (m: GtMachineRec): boolean => m.kind === 'hatch' && ENERGY_HATCH_RE.test(simpleClassName(m.cls) ?? '');
const isConsumer = (m: GtMachineRec): boolean => m.kind === 'basic' || isEnergyHatch(m);

/** The faces an emitter sends EU out of: the front, or a working (step-down) transformer's other 5 faces. */
function outputSides(m: GtMachineRec): number[] {
  if (!isSide(m.facing)) return [];
  return m.kind === 'transformer' && m.works ? SIDES.filter((s) => s !== m.facing) : [m.facing];
}

/** The tier an emitter sends at: its own, one higher for a step-up (disabled) transformer; null when unknown. */
function outputTier(m: GtMachineRec): number | null {
  if (!knownTier(m.tier)) return null;
  return m.kind === 'transformer' && !m.works ? Math.min(m.tier + 1, MAX_TIER) : m.tier;
}

/**
 * The factor k of a battery buffer's own store, k × V[tier] × slots (GT's `maxEUStore()`), by the simple name of its
 * class (plan 10, ruling R15): 256 for a charger, 6,144 for a turbo charger and 64 for every other buffer
 * (`MTEBasicBatteryBuffer`, gt-mechanics §4.3; `MTETeslaCoil` inherits it).
 */
function bufferStoreFactor(cls: string | null): number {
  const name = simpleClassName(cls);
  return name === 'MTECharger' ? 256 : name === 'MTETurboCharger' ? 6144 : 64;
}

/**
 * A steam producer's steam in L/s per figure (rule 5): a solar boiler's from its calcification and hot share of the day,
 * any other's (a multiblock's too) the export's `steamPerSecondMax`; null when the export does not give it (unknown,
 * never 0).
 */
function boilerSteam(m: GtMachineRec, facts: ScanPackFacts): (Figures & { solar: boolean }) | null {
  const solar = solarBoilerOf(m);
  if (solar !== null) {
    const clear = solarOutput(solar, m.boiler?.runTime ?? 0) * solar.hotFraction;
    return { clear, rain: 0, average: clear * (1 - RAIN_OUTAGE_FRACTION), solar: true };
  }
  const max = facts.machines.get(m.mteId)?.steamPerSecondMax;
  return typeof max === 'number' ? { clear: max, rain: max, average: max, solar: false } : null;
}

/** A turbine's EU/t per figure, the solar part of its clear-weather EU/t, and whether no steam producer is connected to it. */
interface TurbineOutput { eut: Figures; solarClear: number; unfed: boolean }

/** `items` grouped by dimension, each group in input order. */
function byDim<T extends { dim: number }>(items: readonly T[]): Map<number, T[]> {
  const out = new Map<number, T[]>();
  for (const x of items) {
    const list = out.get(x.dim);
    if (list === undefined) out.set(x.dim, [x]);
    else list.push(x);
  }
  return out;
}

/** Of `candidates`, the nearest to `pos` within `HATCH_LINK_RANGE` (Chebyshev; ties go to the smallest position), or null. */
function nearestInRange<T extends { pos: Vec3 }>(pos: Vec3, candidates: readonly T[]): T | null {
  let best: T | null = null, bestDist = Infinity;
  for (const c of candidates) {
    const d = Math.max(Math.abs(c.pos[0] - pos[0]), Math.abs(c.pos[1] - pos[1]), Math.abs(c.pos[2] - pos[2]));
    if (d > HATCH_LINK_RANGE) continue;
    if (d < bestDist || (d === bestDist && best !== null && comparePos(c.pos, best.pos) < 0)) {
      best = c;
      bestDist = d;
    }
  }
  return best;
}

/**
 * The fluid output hatches of each multiblock steam producer, by the producer's key (ruling R6): every output hatch
 * belongs to the nearest multiblock controller of its dimension within `HATCH_LINK_RANGE`.
 */
function steamHatches(machines: GtMachineRec[]): Map<string, GtMachineRec[]> {
  const controllersByDim = byDim(machines.filter((m) => m.multiblock));
  const out = new Map<string, GtMachineRec[]>();
  for (const h of machines) {
    if (!isOutputHatch(h)) continue;
    const owner = nearestInRange(h.pos, controllersByDim.get(h.dim) ?? []);
    if (owner === null || !isSteamMultiblock(owner)) continue;
    const list = out.get(keyOf(owner));
    if (list === undefined) out.set(keyOf(owner), [h]);
    else list.push(h);
  }
  return out;
}

/**
 * Rule 4: steam components over fluid pipes (either bit), tanks, boilers (through the block in front), multiblock steam
 * producers (through the block in front of each of their output hatches) and turbines. A pipe joins the pipe, tank or
 * turbine its bit points at; a boiler or output hatch, the one its front touches; a tank, every turbine touching one of
 * its blocks, and Railcraft parts the parts they touch face to face (one tank). Each component's supply is shared among
 * its turbines in proportion to the steam each needs for full output, capped at full; the turbines of a component with
 * no steam producer at all are unfed.
 */
function steamTurbines(
  machineAt: Map<string, GtMachineRec>, fluidAt: Map<string, GtPipeRec>, tanks: TankRec[], hatches: Map<string, GtMachineRec[]>, facts: ScanPackFacts,
): Map<string, TurbineOutput> {
  const uf = new UnionFind();
  const tankAt = new Map<string, TankRec>();
  for (const t of tanks) tankAt.set(keyOf(t), t);
  const turbineAt = (k: string): boolean => {
    const m = machineAt.get(k);
    return m !== undefined && isTurbine(m);
  };
  const steamNodeAt = (k: string): boolean => fluidAt.has(k) || tankAt.has(k) || turbineAt(k);
  /** Joins `k` with the steam node `front`'s front face touches (a boiler's, or an output hatch's). */
  const joinFront = (k: string, front: GtMachineRec): void => {
    if (!isSide(front.facing)) return;
    const nk = keyAt(front.dim, step(front.pos, front.facing));
    if (steamNodeAt(nk)) uf.union(k, nk);
  };
  for (const [k, p] of fluidAt) {
    uf.find(k);
    for (const s of SIDES) {
      if (!hasBit(p.connections, s)) continue;
      const nk = keyAt(p.dim, step(p.pos, s));
      if (steamNodeAt(nk)) uf.union(k, nk);
    }
  }
  for (const [k, t] of tankAt) {
    uf.find(k);
    for (const s of SIDES) {
      const nk = keyAt(t.dim, step(t.pos, s));
      if (turbineAt(nk) || (t.kind === 'railcraft' && tankAt.get(nk)?.kind === 'railcraft')) uf.union(k, nk);
    }
  }
  for (const [k, m] of machineAt) {
    if (isTurbine(m)) uf.find(k);
    else if (isBoiler(m)) {
      uf.find(k);
      joinFront(k, m);
    } else if (isSteamMultiblock(m)) {
      uf.find(k);
      for (const h of hatches.get(k) ?? []) joinFront(k, h);
    }
  }
  const out = new Map<string, TurbineOutput>();
  for (const members of uf.groups().values()) {
    const supply: Figures = { clear: 0, rain: 0, average: 0 };
    let solarClear = 0, producers = 0;
    const turbines: Array<{ key: string; tier: number; full: number }> = [];
    for (const k of members) {
      const m = machineAt.get(k);
      if (m === undefined) continue;
      if (isTurbine(m)) {
        if (knownTier(m.tier)) turbines.push({ key: k, tier: m.tier, full: turbineSteamForFull(m.tier) });
      } else if (isSteamProducer(m)) {
        producers++;
        const steam = boilerSteam(m, facts);
        if (steam === null) continue;
        supply.clear += steam.clear;
        supply.rain += steam.rain;
        supply.average += steam.average;
        if (steam.solar) solarClear += steam.clear;
      }
    }
    const demand = turbines.reduce((sum, t) => sum + t.full, 0);
    const solarRatio = supply.clear > 0 ? solarClear / supply.clear : 0;
    for (const t of turbines) {
      const eutOf = (lps: number): number => turbineEUt(t.tier, Math.min(t.full, (lps * t.full) / demand));
      const eut: Figures = { clear: eutOf(supply.clear), rain: eutOf(supply.rain), average: eutOf(supply.average) };
      out.set(t.key, { eut, solarClear: eut.clear * solarRatio, unfed: producers === 0 });
    }
  }
  return out;
}

/**
 * Rule 7: each running multiblock controller's recipe EU/t, keyed by the nearest energy hatch of its dimension within
 * `HATCH_LINK_RANGE` (Chebyshev; ties go to the smallest position).
 */
function multiblockLoads(machines: GtMachineRec[]): Map<string, number> {
  const hatchesByDim = byDim(machines.filter(isEnergyHatch));
  const loads = new Map<string, number>();
  for (const m of machines) {
    if (!m.multiblock || !m.running) continue;
    const best = nearestInRange(m.pos, hatchesByDim.get(m.dim) ?? []);
    if (best !== null) loads.set(keyOf(best), (loads.get(keyOf(best)) ?? 0) + m.recipeEUt);
  }
  return loads;
}

/**
 * Builds the power networks of a scan (rules 1–8 of the plan): cable sub-networks, emitter attachments, the steam
 * chains, each network's clear / rain / average generation, load, storage and taps.
 */
export function buildPower(input: PowerInput): PowerResult {
  const { facts } = input;
  const machineAt = new Map<string, GtMachineRec>();
  for (const m of input.machines) machineAt.set(keyOf(m), m);
  const cableAt = new Map<string, GtPipeRec>(), fluidAt = new Map<string, GtPipeRec>();
  for (const p of input.pipes) {
    if (p.pipeKind === 'cable') cableAt.set(keyOf(p), p);
    else if (p.pipeKind === 'fluid') fluidAt.set(keyOf(p), p);
  }
  /** A machine that can take part in a power network: any GT machine but a boiler, which is only in the steam graph. */
  const powerMachineAt = (k: string): GtMachineRec | undefined => {
    const m = machineAt.get(k);
    return m === undefined || isBoiler(m) ? undefined : m;
  };

  // Rule 1: cable sub-networks (`subnets`) and, with the machines the cables point at, the power graph (`power`).
  const subnets = new UnionFind(), power = new UnionFind();
  for (const [k, p] of cableAt) {
    subnets.find(k);
    power.find(k);
    for (const s of SIDES) {
      if (!hasBit(p.connections, s)) continue;
      const nk = keyAt(p.dim, step(p.pos, s));
      if (cableAt.has(nk)) {
        subnets.union(k, nk);
        power.union(k, nk);
      } else if (powerMachineAt(nk) !== undefined) power.union(k, nk);
    }
  }
  // Rule 2: emitter output faces attach the machines they touch and feed the sub-networks of cables pointing back.
  const fedTier = new Map<string, number>();   // sub-network representative → highest tier fed into it
  for (const [k, m] of machineAt) {
    if (!isEmitter(m)) continue;
    const tier = outputTier(m);
    for (const s of outputSides(m)) {
      const nk = keyAt(m.dim, step(m.pos, s));
      const cable = cableAt.get(nk);
      if (cable !== undefined) {
        if (tier !== null && hasBit(cable.connections, OPPOSITE[s]!)) {
          const root = subnets.find(nk);
          fedTier.set(root, Math.max(fedTier.get(root) ?? tier, tier));
        }
      } else if (powerMachineAt(nk) !== undefined) power.union(k, nk);
    }
  }

  const turbineOut = steamTurbines(machineAt, fluidAt, input.tanks, steamHatches(input.machines), facts);
  const hatchLoads = multiblockLoads(input.machines);
  const unknownBoilers = input.machines.filter((m) => isSteamProducer(m) && solarBoilerOf(m) === null && boilerSteam(m, facts) === null).length;

  // Rule 3: one candidate network per connected group; rules 5–8 give its figures.
  const built: Array<{ dim: number; pos: Vec3; network: PowerNetwork; cables: GtPipeRec[]; spareEUt: number; unfedTurbines: number }> = [];
  for (const members of power.groups().values()) {
    const cables: GtPipeRec[] = [], machines: GtMachineRec[] = [];
    for (const k of members) {
      const cable = cableAt.get(k);
      if (cable !== undefined) cables.push(cable);
      else {
        const m = machineAt.get(k);
        if (m !== undefined) machines.push(m);
      }
    }
    if (!machines.some((m) => isGenerator(m) || m.kind === 'battery_buffer' || isConsumer(m))) continue;

    const nodes = [...cables, ...machines];
    const dim = nodes[0]!.dim;
    const pos = smallestPos(nodes.map((n) => n.pos));
    const id = `p:${posKey(dim, pos[0], pos[1], pos[2])}`;

    // Rule 6: voltage tier and storage.
    const emitterTiers = machines.filter(isEmitter).map(outputTier).filter((t): t is number => t !== null);
    const cableTiers = cables.map((c) => c.voltageTier).filter((t): t is number => t !== undefined);
    const voltageTier = emitterTiers.length > 0 ? Math.max(...emitterTiers) : cableTiers.length > 0 ? Math.max(...cableTiers) : 0;
    let storedEU = 0, capacityEU = 0;
    for (const m of machines) {
      if (m.kind !== 'battery_buffer') continue;
      const slots = facts.machines.get(m.mteId)?.batterySlots;
      // The buffer's own store, k × V × slots with k by class (ruling R15), takes up to one packet more (gt-mechanics
      // §4.3); a store of known size caps the charge counted, so the overshoot never shows (plan 10, ruling R12).
      const own = knownTier(m.tier) && slots !== undefined ? V[m.tier]! * bufferStoreFactor(m.cls) * slots : 0;
      storedEU += own > 0 ? Math.min(m.storedEU, own) : m.storedEU;
      capacityEU += own;
      for (const b of m.batteries ?? []) {
        storedEU += b.charge;
        capacityEU += facts.electric.get(b.key)?.maxCharge ?? 0;
      }
    }

    // Rule 5: generation; rule 7: consumers and load.
    const gen: Figures = { ...ZERO };
    let solarClear = 0, consumersMaxEUt = 0, loadEUt = 0, unfedTurbines = 0;
    for (const m of machines) {
      const k = keyOf(m);
      if (isTurbine(m)) {
        const t = turbineOut.get(k);
        if (t !== undefined) {
          gen.clear += t.eut.clear;
          gen.rain += t.eut.rain;
          gen.average += t.eut.average;
          solarClear += t.solarClear;
          if (t.unfed) unfedTurbines++;
        }
      } else if (m.kind === 'generator' && knownTier(m.tier)) {
        const eut = V[m.tier]! * (facts.machines.get(m.mteId)?.amps ?? 1);
        gen.clear += eut;
        gen.rain += eut;
        gen.average += eut;
      }
      if (m.kind === 'basic') {
        if (knownTier(m.tier)) consumersMaxEUt += V[m.tier]!;
        if (m.running) loadEUt += m.recipeEUt;
      } else if (isEnergyHatch(m) && knownTier(m.tier)) consumersMaxEUt += 2 * V[m.tier]!;
      loadEUt += hatchLoads.get(k) ?? 0;
    }

    const network: PowerNetwork = {
      id, baseId: majority(nodes.map((n) => input.baseOf(n.dim, n.pos))), voltageTier, generatorEUt: gen,
      consumersMaxEUt, storedEU, capacityEU, taps: [], loadEUt, solarShare: gen.clear > 0 ? solarClear / gen.clear : 0,
    };
    built.push({ dim, pos, network, cables, spareEUt: gen.average - loadEUt, unfedTurbines });
  }

  // Rule 8: cable tiers, network ids per cable and taps, for the networks that are kept.
  const cableNetwork = new Map<string, string>(), cableTier = new Map<string, number>();
  for (const { dim, network, cables, spareEUt } of built) {
    const tapCable = new Map<string, GtPipeRec>();
    for (const c of cables) {
      const k = keyOf(c);
      cableNetwork.set(k, network.id);
      const tier = fedTier.get(subnets.find(k)) ?? c.voltageTier;
      if (tier !== undefined) cableTier.set(k, tier);
      if (SIDES.some((s) => !hasBit(c.connections, s) && !input.occupied(dim, step(c.pos, s)))) tapCable.set(k, c);
    }
    network.taps = pickTaps([...tapCable.values()].map((c) => c.pos), MAX_TAPS_PER_NETWORK).map((p): TapPoint => {
      const k = keyAt(dim, p);
      const tier = cableTier.get(k), amps = cableAt.get(k)?.cable?.amps;
      const tap: TapPoint = { pos: [p[0], p[1], p[2]], dim, kind: 'power', networkId: network.id };
      if (tier !== undefined) {
        tap.voltageTier = tier;
        if (amps !== undefined) tap.freeAmps = Math.min(amps, Math.max(0, Math.floor(spareEUt / V[tier]!)));
      }
      return tap;
    });
  }

  built.sort((a, b) => a.dim - b.dim || comparePos(a.pos, b.pos));
  return {
    networks: built.map((b) => b.network), cableNetwork, cableTier, unknownBoilers,
    unfedTurbines: built.filter((b) => b.unfedTurbines > 0).map((b) => ({ networkId: b.network.id, turbines: b.unfedTurbines })),
  };
}
