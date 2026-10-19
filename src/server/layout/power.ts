// Power rules of a line layout (Plan 5 Task 3; spec §3.5; gt-mechanics §3.1–§3.3, §3.6, §4.1–§4.2): machines grouped
// by tier with their amps, step-down transformer banks from the supply tier, cable loss, the power fit against the
// base's network, and the generators to suggest when the line does not fit. Generators are only suggested, never
// placed (spec §4). Figures are left unrounded; texts round through `fmtInt`.

import { tierName, V } from '../../shared/gt/tiers.ts';
import { fmtInt } from '../../shared/layout/format.ts';
import type { LayoutPowerContext } from '../../shared/types/layout.ts';
import type { Machine, Pack } from '../../shared/types/pack.ts';
import type { BomLine, PlanContext, PowerSummary } from '../../shared/types/plan.ts';
import { simpleClassName } from '../world/facts.ts';
import { RAIN_OUTAGE_FRACTION, solarBoilerOf, turbineSteamForFull } from '../world/power.ts';

const TICKS_PER_SECOND = 20;
/** A step-down transformer gives at most 4 A on its output faces and takes at most 2 A on its front (gt-mechanics §3.6). */
const TRANSFORMER_AMPS_OUT = 4;
const TRANSFORMER_AMPS_IN = 2;

/** A cable run that loses more than this share of its volts is flagged (`cable_loss_high`). */
export const LOSS_WARN_FRACTION = 0.1;

function voltsOf(tier: number): number {
  const v = V[tier];
  if (v === undefined) throw new RangeError(`tier must be an integer from 0 to ${V.length - 1}, got ${tier}`);
  return v;
}

/** EU an emitter of tier `t` pays per amp on top of the volts it sends (gt-mechanics §3.2). */
function emitterLoss(tier: number): number {
  return 2 ** Math.max(0, tier - 1);
}

// ---- Tier groups and transformer stages ----

/**
 * The volts a packet still has after losing `lossVolts` on its way (gt-mechanics §3.3); at least 1, so a run that loses
 * everything (flagged `cable_loss_high`) counts each EU as one amp instead of dividing by zero.
 */
export function deliveredVolts(volts: number, lossVolts: number): number {
  return Math.max(1, volts - lossVolts);
}

/**
 * The machines of one tier: their EU/t in input order, the sum, and Σ `ceil(EU/t ÷ (V[tier] − loss))` amps.
 * `lossVolts` (per machine, in input order) is there only when the caller gave a loss for some machine.
 */
export interface TierGroup { tier: number; euPerTick: number[]; peakEUt: number; amps: number; lossVolts?: number[] }

/**
 * One group per tier, highest tier first; each machine counts `ceil(EU/t ÷ delivered volts)` amps, where delivered
 * volts = `V[tier]` less the volts its packets lose on the way (`lossVolts`, default 0; gt-mechanics §3.1, §3.3).
 */
export function tierGroups(units: ReadonlyArray<{ tier: number; euPerTick: number; lossVolts?: number }>): TierGroup[] {
  const byTier = new Map<number, TierGroup>();
  const lossGiven = units.some((u) => u.lossVolts !== undefined);
  for (const u of units) {
    let group = byTier.get(u.tier);
    if (group === undefined) {
      group = { tier: u.tier, euPerTick: [], peakEUt: 0, amps: 0, ...(lossGiven ? { lossVolts: [] } : {}) };
      byTier.set(u.tier, group);
    }
    const loss = u.lossVolts ?? 0;
    group.euPerTick.push(u.euPerTick);
    group.lossVolts?.push(loss);
    group.peakEUt += u.euPerTick;
    group.amps += Math.ceil(u.euPerTick / deliveredVolts(voltsOf(u.tier), loss));
  }
  return [...byTier.values()].sort((a, b) => b.tier - a.tier);
}

/** A bank of `count` step-down transformers from `fromTier` to `toTier` = `fromTier − 1`. */
export interface Stage { fromTier: number; toTier: number; count: number; ampsIn: number; ampsOut: number }
/** `under`: groups above the supply tier, fed the supply voltage (the caller warns). */
export interface Stages { supplyTier: number; stages: Stage[] /* from the supply downwards */; supplyAmps: number; lossEUt: number; under: TierGroup[] }

/**
 * Step-down banks from `supplyTier` to every lower group tier, one tier per bank (gt-mechanics §3.6). Working up from
 * the lowest group, each bank gives the amps needed at its tier and takes `ceil(out × (V[k] + loss) / (V[k+1] − lost))`
 * amps from the tier above, where `lost` = `bankLossVolts(k + 1)` is what the packets lose on the tier-above run before
 * they reach the bank (default 0); that adds them to that tier's need. Every bank pays the emitter loss per amp out.
 * Machines above the supply tier draw from the supply run at the supply volts less their own `lossVolts`.
 */
export function transformerStages(groups: readonly TierGroup[], supplyTier: number, bankLossVolts: (fromTier: number) => number = () => 0): Stages {
  const supplyVolts = voltsOf(supplyTier);
  const under = groups.filter((g) => g.tier > supplyTier);
  const fed = groups.filter((g) => g.tier <= supplyTier);
  const need = new Map<number, number>();
  for (const g of fed) need.set(g.tier, (need.get(g.tier) ?? 0) + g.amps);
  const upwards: Stage[] = [];
  let lossEUt = 0;
  const lowest = fed.length === 0 ? supplyTier : Math.min(...fed.map((g) => g.tier));
  for (let k = lowest; k < supplyTier; k++) {
    const ampsOut = need.get(k) ?? 0;
    if (ampsOut <= 0) continue;
    const loss = emitterLoss(k);
    const ampsIn = Math.ceil((ampsOut * (voltsOf(k) + loss)) / deliveredVolts(voltsOf(k + 1), bankLossVolts(k + 1)));
    const count = Math.max(Math.ceil(ampsOut / TRANSFORMER_AMPS_OUT), Math.ceil(ampsIn / TRANSFORMER_AMPS_IN));
    need.set(k + 1, (need.get(k + 1) ?? 0) + ampsIn);
    lossEUt += ampsOut * loss;
    upwards.push({ fromTier: k + 1, toTier: k, count, ampsIn, ampsOut });
  }
  let supplyAmps = need.get(supplyTier) ?? 0;
  for (const g of under) {
    g.euPerTick.forEach((euPerTick, i) => {
      supplyAmps += Math.ceil(euPerTick / deliveredVolts(supplyVolts, g.lossVolts?.[i] ?? 0));
    });
  }
  return { supplyTier, stages: upwards.reverse(), supplyAmps, lossEUt, under };
}

/** EU/t the banks' emitters pay on top of what they send: `ampsOut × 2^max(0, toTier − 1)` each (gt-mechanics §3.2). */
export function bankLossEUt(stages: readonly Stage[]): number {
  return stages.reduce((sum, s) => sum + s.ampsOut * emitterLoss(s.toTier), 0);
}

/** EU/t a cable run loses: every amp loses `lossPerBlock` volts per block (gt-mechanics §3.3). */
export function lineLossEUt(amps: number, blocks: number, lossPerBlock: number): number {
  return amps * blocks * lossPerBlock;
}

/**
 * The volts a line's supply run is sized to have lost already on the hookup: `LOSS_WARN_FRACTION` of the supply volts,
 * the most a hookup loses before it is flagged `cable_loss_high` (spec §3.5 never overload a cable).
 */
export function hookupAllowanceVolts(supplyTier: number): number {
  return LOSS_WARN_FRACTION * voltsOf(supplyTier);
}

// ---- Power fit ----

export interface FitInput { power: PowerSummary; ctx: PlanContext; extraLossEUt: number; pack: Pack; tier: number /* suggestions when there is no network */ }

/**
 * Spec §3.5: the line fits (`yes`) when the network's spare EU/t covers the line's average plus losses and the buffers
 * ride out a rain outage; `tight` when only the spare covers it; `no` otherwise (and without a network). During rain
 * the buffers carry the base's own load as well as the line, less what still generates (a missing `rainEUt` counts
 * as 0). Generator suggestions go to `optional` as build-list lines.
 */
export function fitPower(input: FitInput): { power: PowerSummary; optional: BomLine[] } {
  const { power, extraLossEUt, pack } = input;
  const need = power.averageEUt + extraLossEUt;
  const network = input.ctx.power as LayoutPowerContext | undefined;
  if (network === undefined) {
    // a line that needs nothing gets no "add 0× …" suggestion
    const generators = need > 0 ? generatorSuggestion(pack, need, input.tier) : null;
    return {
      power: { ...power, fits: 'no', detail: `No power network found at this base; the line needs ${fmtInt(need)} EU/t on average`,
        suggestions: generators === null ? [] : [generators.text] },
      optional: generators?.lines ?? [],
    };
  }
  const baseLoad = network.averageEUt - network.spareEUt;
  const rainNeed = Math.max(0, need + baseLoad - (network.rainEUt ?? 0)) * TICKS_PER_SECOND * network.rainOutageSeconds;
  const fits = network.spareEUt >= need ? (network.storedEU >= rainNeed ? 'yes' : 'tight') : 'no';
  let detail = `Needs ${fmtInt(need)} EU/t on average (${fmtInt(power.averageEUt)} + ${fmtInt(extraLossEUt)} loss); ${fmtInt(network.spareEUt)} EU/t spare`;
  if (network.rainOutageSeconds > 0) detail += `; buffers hold ${fmtInt(network.storedEU)} EU, rain needs ${fmtInt(rainNeed)} EU`;
  const suggestions: string[] = [];
  let optional: BomLine[] = [];
  if (fits === 'no') {
    const generators = generatorSuggestion(pack, need - network.spareEUt, network.voltageTier);
    suggestions.push(generators.text);
    optional = generators.lines;
  } else if (fits === 'tight') {
    suggestions.push(`Add battery storage: about ${fmtInt(rainNeed - network.storedEU)} EU more to ride out ${fmtInt(network.rainOutageSeconds / 60)} min of rain`);
  }
  return { power: { ...power, fits, detail, suggestions }, optional };
}

// ---- Generator suggestions ----

function lowestMteId(pack: Pack, keep: (m: Machine) => boolean): Machine | null {
  let best: Machine | null = null;
  for (const m of pack.machines.values()) if (keep(m) && (best === null || m.mteId < best.mteId)) best = m;
  return best;
}

/** Average L/s of steam a boiler makes: a solar boiler loses the rain outage and the cool part of the day (gt-mechanics §4.2). */
function averageSteam(boiler: Machine, steamPerSecondMax: number): number {
  const solar = solarBoilerOf(boiler);
  return solar === null ? steamPerSecondMax : steamPerSecondMax * solar.hotFraction * (1 - RAIN_OUTAGE_FRACTION);
}

/**
 * The boiler to suggest: the HP solar boiler first, then the most average steam, then mteId. Boilers whose output the
 * export does not give (architecture §11.19: missing means unknown) are skipped.
 */
function chooseBoiler(pack: Pack): { boiler: Machine; steam: number } | null {
  const rank = (m: Machine) => (simpleClassName(m.cls) === 'MTEBoilerSolarSteel' ? 0 : 1);
  const boilers: Array<{ boiler: Machine; steam: number }> = [];
  for (const m of pack.machines.values()) {
    if (m.kind === 'boiler' && m.steamPerSecondMax !== undefined && m.steamPerSecondMax > 0) {
      boilers.push({ boiler: m, steam: averageSteam(m, m.steamPerSecondMax) });
    }
  }
  boilers.sort((a, b) => rank(a.boiler) - rank(b.boiler) || b.steam - a.steam || a.boiler.mteId - b.boiler.mteId);
  return boilers[0] ?? null;
}

/**
 * What to add for `shortfallEUt` at `tier` (spec §3.5 "or other generators available at their tier"): boilers and
 * basic steam turbines of that tier, else the lowest-id generator of that tier, else a plain sentence. A steam turbine
 * without a boiler of known output makes no power, so it falls through to generators.
 */
export function generatorSuggestion(pack: Pack, shortfallEUt: number, tier: number): { text: string; lines: BomLine[] } {
  const volts = voltsOf(tier);
  const shortfall = fmtInt(shortfallEUt);
  const why = `optional: covers a ${shortfall} EU/t power shortfall`;
  const line = (m: Machine, amount: number): BomLine => ({ key: m.itemKey, amount, why, group: 'power' });
  const turbine = lowestMteId(pack, (m) => m.kind === 'turbine' && m.tier === tier);
  const steam = turbine === null ? null : chooseBoiler(pack);
  if (turbine !== null && steam !== null) {
    const turbines = Math.ceil(shortfallEUt / volts);
    const boilers = Math.ceil(((shortfallEUt / volts) * turbineSteamForFull(tier)) / steam.steam);
    return {
      text: `Add about ${boilers}× ${steam.boiler.name} and ${turbines}× ${turbine.name} to cover ${shortfall} EU/t`,
      lines: [line(steam.boiler, boilers), line(turbine, turbines)],
    };
  }
  const generator = lowestMteId(pack, (m) => m.kind === 'generator' && m.tier === tier);
  if (generator !== null) {
    const count = Math.ceil(shortfallEUt / (volts * (generator.amps ?? 1)));
    return { text: `Add about ${count}× ${generator.name} to cover ${shortfall} EU/t`, lines: [line(generator, count)] };
  }
  return { text: `Add generators for about ${shortfall} EU/t at ${tierName(tier)}`, lines: [] };
}
