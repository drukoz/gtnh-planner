// The project's settings beside its views (spec §3.2–§3.3b, §3.6, §3.11): what to make and how much, what to plan for
// (the planning mode, what build cost is counted against and how much a machine weighs against raw material: add-on
// 17), the tier, where the group can mine, how the line is fed, what materials cost, which materials to avoid, which
// recipe groups to skip, the planner's options (supporting lines, the tier new machines are built at and when a
// multiblock is, reusing the machines the group has), the farms the planner may build or reuse and those the group runs,
// taking other projects' surplus, the machines it has that no world scan shows, and the lists the panels fill: what the
// group already makes, makes itself, already has a supply of, and the ingredient options it pinned.
// Everyone sees the same settings: every change sends one `settings` op carrying whole field values, and nothing is
// sent for an amount, a cost or a farm number that would be refused.

import { useEffect, useId, useRef, useState, type FormEvent, type ReactElement } from 'react';
import type { StuffKey } from '../../shared/keys.ts';
import { COIL_HEATS } from '../../shared/gt/overclock.ts';
import { TIER_NAMES, tierName } from '../../shared/gt/tiers.ts';
import { MAX_CROP_LAYERS, MAX_CROP_MANAGER_TIER, MAX_LIKED_TAGS } from '../../shared/project/apply-op.ts';
import type { PackInfo } from '../../shared/types/api.ts';
import { FERTILIZER_CHOICES, TOOL_MATERIALS, type CropStats, type FarmKind, type FarmSettings, type RunningFarm } from '../../shared/types/farm.ts';
import type { SearchHit } from '../../shared/types/pack.ts';
import { LogisticsMode, type Plan, type PlanSettings } from '../../shared/types/plan.ts';
import { AvoidPicker } from '../components/AvoidPicker.tsx';
import { focusMain, focusOn } from '../components/focus.ts';
import { ItemIcon } from '../components/ItemIcon.tsx';
import { ItemSearch } from '../components/ItemSearch.tsx';
import { OwnedMachinesEditor } from '../components/OwnedMachinesEditor.tsx';
import { TierPicker } from '../components/TierPicker.tsx';
import { formatNumber } from '../format.ts';
import { haveSupplyPatch, optionPatch } from './flow-model.ts';
import type { ProjectViewProps } from './project-tabs.ts';
import {
  BUILD_HORIZON_PRESETS, EXCLUSION_LABELS, FERTILIZER_LABELS, MULTIBLOCK_CHOICES, OBJECTIVE_CHOICES, TGS_TOOL_CHOICES, buildTierOptions, buildTierPatch,
  dimOverridePatch, dimRows, farmKindsWith, farmTierOptions, farmsOf, farmsPatch, groupDimRows, hasCropTable, horizonChoice, horizonPatch, isStuffKey,
  multiblocksPatch, objectivePatch, optionPinRows, parseAmount, parseCost, parsePerMinute, parseStat, planningMode, runningFarmRows, runningFarmWith,
  runningFarmWithout, stepChargeOf, stepChargeOptions, stepChargePatch, toggleList,
} from './settings-model.ts';

/** Typing pauses this long before the amount is sent (one plan per pause, not one per keystroke). */
const AMOUNT_DELAY_MS = 500;
/** The highest tier a Tree Growth Simulator's energy hatch can be (MAX). */
const TOP_TIER = TIER_NAMES.length - 1;
/** The layers of crop sticks and the liked biome tags a Crop Manager's settings offer (validateOp's limits). */
const LAYER_CHOICES: readonly number[] = Array.from({ length: MAX_CROP_LAYERS }, (_, i) => i + 1);
const LIKED_TAG_CHOICES: readonly number[] = Array.from({ length: MAX_LIKED_TAGS + 1 }, (_, i) => i);

type Patch = (patch: Partial<PlanSettings>) => void;
type Send = ProjectViewProps['send'];
type NameOf = (key: string) => string;

const MODES: ReadonlyArray<{ value: PlanSettings['mode']; label: string }> = [
  { value: 'rate', label: 'Rate' },
  { value: 'makeN', label: 'Make N (batch)' },   // the spec still calls this mode "Batch" (§3.2, §3.10, §7)
];
const PERS: ReadonlyArray<{ value: PlanSettings['per']; label: string }> = [
  { value: 'min', label: 'per minute' },
  { value: 'hour', label: 'per hour' },
];
const POLICIES: ReadonlyArray<{ value: PlanSettings['dims']['policy']; label: string }> = [
  { value: 'progression', label: 'By progression' },
  { value: 'visited', label: 'Only where we have been' },
];
const LOGISTICS: ReadonlyArray<{ value: LogisticsMode; label: string }> = [
  { value: LogisticsMode.Direct, label: 'Machine to machine' },
  { value: LogisticsMode.Routed, label: 'Project Red routed' },
  { value: LogisticsMode.AE2, label: 'AE2' },
  { value: LogisticsMode.EnderIO, label: 'EnderIO conduits' },
];
const DIM_STATES = ['auto', 'on', 'off'] as const;

function byString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** One choice out of a few, as radio buttons; `heading` shows the legend as the section's title. */
function Choice<T extends string>(props: {
  legend: string; heading?: boolean; value: T; options: ReadonlyArray<{ value: T; label: string }>; onChange(value: T): void;
}): ReactElement {
  const { legend, heading, value, options, onChange } = props;
  const name = useId();
  return (
    <fieldset className="choice">
      <legend className={heading === true ? 'settings-title' : undefined}>{legend}</legend>
      {options.map((o) => (
        <label key={o.value} className="check">
          <input type="radio" name={name} value={o.value} checked={o.value === value} onChange={() => onChange(o.value)} />
          {o.label}
        </label>
      ))}
    </fieldset>
  );
}

function AmountField(props: { settings: PlanSettings; patch: Patch }): ReactElement {
  const { settings, patch } = props;
  const { amount, mode, per } = settings;
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);   // null: show the shared amount
  const input = useRef<HTMLInputElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ amount, mode, patch });   // what a pending send uses: the settings it fires against
  useEffect(() => {
    latest.current = { amount, mode, patch };
  });
  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current);
  }, []);

  const stopTimer = (): void => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  /** Sends `text` when it is a valid amount that differs from the shared one; true when it is valid. */
  const commit = (text: string): boolean => {
    stopTimer();
    const now = latest.current;
    const parsed = parseAmount(text, now.mode);
    if (!('amount' in parsed)) return false;
    if (parsed.amount !== now.amount) now.patch({ amount: parsed.amount });
    return true;
  };

  useEffect(() => {
    // A left-behind draft the old mode refused (2.5 in Make N) may suit the new one (Rate): send it now.
    if (draft !== null && document.activeElement !== input.current && commit(draft)) setDraft(null);
  }, [mode]);   // only a mode change re-checks the draft; `commit` reads the settings through `latest`

  const parsed = draft === null ? null : parseAmount(draft, mode);
  const error = parsed !== null && 'error' in parsed ? parsed.error : null;
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>Amount</label>
      <div className="row">
        <input
          id={id}
          ref={input}
          className="amount-input"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={draft ?? String(amount)}
          aria-invalid={error !== null}
          aria-describedby={error !== null ? `${id}-error` : undefined}
          onChange={(e) => {
            const text = e.currentTarget.value;
            setDraft(text);
            stopTimer();
            if ('amount' in parseAmount(text, mode)) timer.current = setTimeout(() => commit(text), AMOUNT_DELAY_MS);
          }}
          onBlur={(e) => {
            if (draft !== null && commit(e.currentTarget.value)) setDraft(null);
          }}
          onKeyDown={(e) => {
            // a held Enter's repeat that landed here is not a commit (P2-R69a)
            if (e.key === 'Enter' && draft !== null && !e.nativeEvent.defaultPrevented) commit(e.currentTarget.value);
            // one layer per press: a key a layer above has handled (the shared tooltip's, hiding its tip) is not this one's (P2-R21b)
            if (e.key === 'Escape' && !e.nativeEvent.defaultPrevented) {
              stopTimer();
              setDraft(null);
            }
          }}
        />
        {mode === 'rate' && (
          <select aria-label="Rate unit" value={per} onChange={(e) => patch({ per: PERS.find((p) => p.value === e.currentTarget.value)?.value ?? 'min' })}>
            {PERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        )}
      </div>
      {error !== null && <p className="field-error error" id={`${id}-error`} role="alert">{error}</p>}
    </div>
  );
}

function MakeSection(props: { settings: PlanSettings; patch: Patch; nameOf: NameOf; remember(hit: SearchHit): void }): ReactElement {
  const { settings, patch, nameOf, remember } = props;
  const { target, amount } = settings;
  const setMode = (mode: PlanSettings['mode']): void => {
    if (mode === settings.mode) return;
    // Make N takes whole crafts only, so a rate such as 2.5 becomes the nearest whole amount in the same op.
    if (mode === 'makeN' && !Number.isInteger(amount)) patch({ mode, amount: Math.max(1, Math.round(amount)) });
    else patch({ mode });
  };
  // Clear goes with the target it clears, so it hands the focus first to the item search, the next thing to do, drawn in both states (ledger
  // ruling P2-R78); else to the page's main. A focus elsewhere is left where it is.
  const clear = (button: HTMLButtonElement): void => {
    if (document.activeElement === button && !focusOn(button.closest('.settings-section')?.querySelector('.item-search input'))) focusMain();
    patch({ target: null });
  };
  return (
    <section className="settings-section">
      <h3>Make</h3>
      {target === null ? (
        <p className="muted">Nothing picked yet</p>
      ) : (
        <div className="settings-target">
          <ItemIcon itemKey={target} size={28} name={nameOf(target)} />
          <span className="settings-target-name">{nameOf(target)}</span>
          <button type="button" onClick={(e) => clear(e.currentTarget)}>Clear</button>
        </div>
      )}
      <ItemSearch
        shortcut="/"
        onPick={(hit) => {
          remember(hit);
          if (hit.key !== target) patch({ target: hit.key });
        }}
      />
      <Choice legend="Mode" value={settings.mode} options={MODES} onChange={setMode} />
      <AmountField settings={settings} patch={patch} />
    </section>
  );
}

function TierSection(props: { settings: PlanSettings; plan: Plan | null; patch: Patch }): ReactElement {
  const { settings, plan, patch } = props;
  return (
    <section className="settings-section">
      <label className="field">
        <span className="settings-title">Tier</span>
        <TierPicker value={settings.tier} onChange={(tier) => patch({ tier })} />
      </label>
      {settings.tier === null && plan !== null && <p className="muted">{`Planning at ${tierName(plan.tier)}`}</p>}
    </section>
  );
}

function DimsSection(props: { info: PackInfo | null; settings: PlanSettings; plan: Plan | null; patch: Patch }): ReactElement {
  const { info, settings, plan, patch } = props;
  const rows = info === null ? [] : dimRows(info, settings, plan);
  const reachable = rows.filter((r) => r.reachable).length;
  return (
    <details className="settings-section">
      <summary>
        <h3>Reachable dimensions</h3>
        {plan !== null && rows.length > 0 && <span className="muted">{`${reachable} of ${rows.length} reachable`}</span>}
      </summary>
      <Choice legend="Count as reachable" value={settings.dims.policy} options={POLICIES} onChange={(policy) => patch({ dims: { ...settings.dims, policy } })} />
      {info === null ? (
        <p className="muted">The pack is not loaded yet.</p>
      ) : (
        groupDimRows(rows).map(({ group, rows: list }) => (
          <div key={group} className="dim-group">
            <h4>{group}</h4>
            <ul className="dim-rows">
              {list.map((row) => (
                <li key={row.key} className={row.reachable ? 'dim-row reachable' : 'dim-row'} data-dim-key={row.key}>
                  <span className="dim-name">{row.name}</span>
                  <select aria-label={row.name} value={row.state} onChange={(e) => {
                    const state = DIM_STATES.find((s) => s === e.currentTarget.value) ?? 'auto';
                    patch(dimOverridePatch(settings, row.key, state));
                  }}>
                    {DIM_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <span className="dim-label muted">{row.label}</span>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </details>
  );
}

function CostRow(props: { costKey: string; name: string; value: number; onChange(cost: number): void; onRemove(): void }): ReactElement {
  const { costKey, name, value, onChange, onRemove } = props;
  const [draft, setDraft] = useState<string | null>(null);
  const parsed = draft === null ? null : parseCost(draft);
  const error = parsed !== null && 'error' in parsed ? parsed.error : null;
  const commit = (text: string): void => {
    const p = parseCost(text);
    if (!('cost' in p)) return;
    if (p.cost !== value) onChange(p.cost);
    setDraft(null);
  };
  return (
    <tr data-cost-key={costKey}>
      <td>
        <span className="cost-name" title={costKey}>
          {isStuffKey(costKey) && <ItemIcon itemKey={costKey} size={18} name={name} tip={false} />}
          {name}
        </span>
      </td>
      <td>
        <input
          className="cost-input"
          type="text"
          inputMode="decimal"
          aria-label={`Cost of ${name}`}
          aria-invalid={error !== null}
          title={error ?? undefined}
          value={draft ?? String(value)}
          onChange={(e) => setDraft(e.currentTarget.value)}
          onBlur={(e) => commit(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.defaultPrevented) commit(e.currentTarget.value);   // not a held Enter's repeat (P2-R69a)
            if (e.key === 'Escape' && !e.nativeEvent.defaultPrevented) setDraft(null);   // one layer per press
          }}
        />
        {error !== null && <span className="field-error error" role="alert">{error}</span>}
      </td>
      <td>
        <button type="button" className="small" aria-label={`Remove ${name}`} onClick={onRemove}>Remove</button>
      </td>
    </tr>
  );
}

function CostsSection(props: { settings: PlanSettings; patch: Patch; nameOf: NameOf; remember(hit: SearchHit): void }): ReactElement {
  const { settings, patch, nameOf, remember } = props;
  const overrides = settings.costOverrides;
  const [material, setMaterial] = useState('');
  const [item, setItem] = useState<SearchHit | null>(null);
  const [cost, setCost] = useState('');
  const [error, setError] = useState<string | null>(null);
  const set = (key: string, value: number): void => patch({ costOverrides: { ...overrides, [key]: value } });
  const remove = (key: string): void => {
    const next = { ...overrides };
    delete next[key];
    patch({ costOverrides: next });
  };
  const add = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const key = item?.key ?? material.trim();
    if (key === '') {
      setError('Enter a material name or pick an item');
      return;
    }
    const parsed = parseCost(cost);
    if (!('cost' in parsed)) {
      setError(parsed.error);
      return;
    }
    set(key, parsed.cost);
    setMaterial('');
    setItem(null);
    setCost('');
    setError(null);
  };
  const keys = Object.keys(overrides).sort(byString);
  return (
    <section className="settings-section">
      <h3>Material costs</h3>
      <p className="muted small">Every base item counts 1; 144 L of molten metal is one ingot.</p>
      {keys.length > 0 && (
        <table className="cost-table">
          <thead>
            <tr><th scope="col">Material or item</th><th scope="col">Cost</th><th scope="col"><span className="visually-hidden">Remove</span></th></tr>
          </thead>
          <tbody>
            {keys.map((key) => (
              <CostRow key={key} costKey={key} name={nameOf(key)} value={overrides[key]!} onChange={(v) => set(key, v)} onRemove={() => remove(key)} />
            ))}
          </tbody>
        </table>
      )}
      <form className="cost-add" onSubmit={add}>
        {item === null ? (
          <>
            <label className="field">
              <span>Material</span>
              <input value={material} placeholder="e.g. Silver" onChange={(e) => setMaterial(e.currentTarget.value)} />
            </label>
            <ItemSearch
              placeholder="…or pick an item"
              onPick={(hit) => {
                remember(hit);
                setItem(hit);
              }}
            />
          </>
        ) : (
          <div className="settings-target">
            <ItemIcon itemKey={item.key} size={20} name={item.name} />
            <span className="settings-target-name">{item.name}</span>
            <button type="button" className="small" onClick={() => setItem(null)}>Change</button>
          </div>
        )}
        <div className="row">
          <label className="field cost-field">
            <span>Cost</span>
            <input type="text" inputMode="decimal" value={cost} onChange={(e) => setCost(e.currentTarget.value)} />
          </label>
          <button type="submit">Add</button>
        </div>
        {error !== null && <p className="field-error error" role="alert">{error}</p>}
      </form>
    </section>
  );
}

function AvoidSection(props: {
  info: PackInfo | null; settings: PlanSettings; send: ProjectViewProps['send']; nameOf: NameOf; remember(hit: SearchHit): void;
}): ReactElement {
  const { info, settings, send, nameOf, remember } = props;
  return (
    <section className="settings-section">
      <h3>Avoid materials</h3>
      <p className="muted small">
        Kept out of every step of the line; a step that cannot do without one at this tier is flagged. The machines you
        build may still contain them.
      </p>
      <AvoidPicker avoid={settings.avoid ?? []} materials={info?.materials ?? []} nameOf={nameOf} send={send} remember={remember} />
    </section>
  );
}

function SkipSection(props: { info: PackInfo | null; settings: PlanSettings; patch: Patch }): ReactElement {
  const { info, settings, patch } = props;
  const excluded = settings.excludedCategories;
  return (
    <section className="settings-section">
      <h3>Skip recipe groups</h3>
      {info === null ? (
        <p className="muted">The pack is not loaded yet.</p>
      ) : (
        info.exclusionRules.map((rule) => (
          <label key={rule} className="check">
            <input
              type="checkbox"
              checked={excluded.includes(rule)}
              onChange={(e) => patch({ excludedCategories: toggleList(excluded, rule, e.currentTarget.checked) })}
            />
            {EXCLUSION_LABELS[rule] ?? rule}
          </label>
        ))
      )}
    </section>
  );
}

/**
 * "Machines vs raw material" (fix spec §3, §6.4; ruling S17, formerly "Steps vs raw material"): the presets as "<name>
 * (<n>%)", and a stored value that is none of them as "Custom (<n>%)"; picking one sends `stepCharge`. What the share
 * weighs follows the mode: in least raw material a recipe step must save it, in the modes that count build cost each new
 * machine costs it over the horizon (the batch in Make N).
 */
export function StepChargeField(props: { settings: PlanSettings; patch: Patch }): ReactElement {
  const { settings, patch } = props;
  const charge = stepChargeOf(settings);
  const hint = planningMode(settings) === 'least-raw'
    ? "A recipe step is built only when it saves this share of the line's least raw material."
    : `Each new machine costs this share of the line's least raw material over the ${settings.mode === 'makeN' ? 'batch' : 'horizon'}, on top of its build.`;
  return (
    <label className="field">
      <span>Machines vs raw material</span>
      <select
        aria-label="Machines vs raw material"
        value={String(charge)}
        onChange={(e) => {
          const next = stepChargePatch(e.currentTarget.value);
          if (next !== null && next.stepCharge !== charge) patch(next);
        }}
      >
        {stepChargeOptions(charge).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <span className="muted small">{hint}</span>
    </label>
  );
}

/**
 * "Count build cost against" (plan 12 Task 7, design spec §3.3): the hours of running the build cost of new machines is
 * weighed against, as a preset ("24 hours" for a project stored before the setting) or a stored value no preset names as
 * "Custom (<n> h)"; picking one sends `buildHorizonHours`. In Make N, which always counts the build cost against the batch
 * (controller ruling OQ6), a note takes its place. "Plan for" shows it for the modes that count build cost only.
 */
export function BuildHorizonField(props: { settings: PlanSettings; patch: Patch }): ReactElement {
  const { settings, patch } = props;
  if (settings.mode === 'makeN') return <p className="muted small">Make N counts the build cost of new machines against the batch itself.</p>;
  const choice = horizonChoice(settings.buildHorizonHours);
  const options = BUILD_HORIZON_PRESETS.map((p): { value: string; label: string } => ({ value: p.value, label: p.label }));
  if (!BUILD_HORIZON_PRESETS.some((p) => p.value === choice.value)) options.push(choice);
  return (
    <label className="field">
      <span>Count build cost against</span>
      <select
        aria-label="Count build cost against"
        value={choice.value}
        onChange={(e) => {
          const next = horizonPatch(e.currentTarget.value);
          if ('buildHorizonHours' in next && e.currentTarget.value !== choice.value) patch(next);
        }}
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

/**
 * "Build machines at" (the user's ruling 224): the cheapest tier (the default) or a tier from LV up to the project's,
 * at which every step's new machines are built where a machine of that tier runs its recipe; picking one sends
 * `buildTier`. The project's tier is the setting's, else the plan's (the world scan's tier, as the planner resolved
 * it); with neither yet the tiers wait for the plan (`buildTierOptions`).
 */
export function BuildTierField(props: { settings: PlanSettings; plan?: Plan | null; patch: Patch }): ReactElement {
  const { settings, plan, patch } = props;
  const stored = settings.buildTier ?? null;
  const value = stored === null ? '' : String(stored);
  return (
    <label className="field">
      <span>Build machines at</span>
      <select
        aria-label="Build machines at"
        value={value}
        onChange={(e) => {
          const next = buildTierPatch(e.currentTarget.value);
          if (next !== null && e.currentTarget.value !== value) patch(next);
        }}
      >
        {buildTierOptions(settings.tier ?? plan?.tier ?? null, stored).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

/**
 * "Multiblocks" (the user's ruling 224): use them where cheaper (the default), or build a new one only where nothing
 * else can do it; picking one sends `multiblocks`. With build cost ignored nothing weighs a machine, and it says so.
 */
export function MultiblocksField(props: { settings: PlanSettings; patch: Patch }): ReactElement {
  const { settings, patch } = props;
  const value = settings.multiblocks ?? 'allow';
  const ignored = settings.mode === 'rate' && settings.buildHorizonHours === null && value === 'only-required';
  return (
    <label className="field">
      <span>Multiblocks</span>
      <select
        aria-label="Multiblocks"
        value={value}
        onChange={(e) => {
          const next = multiblocksPatch(e.currentTarget.value);
          if (next !== null && e.currentTarget.value !== value) patch(next);
        }}
      >
        {MULTIBLOCK_CHOICES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
      </select>
      {ignored && <span className="muted small">With build cost ignored, a recipe only a multiblock runs is weighed by its raw material alone.</span>}
    </label>
  );
}

/**
 * "Reuse machines we have" (design spec §3.3, architecture §11.29): on (the default, also for a project stored before
 * the switch), a step runs first on the machines the group owns; off, every machine is planned new.
 */
export function ReuseOwnedField(props: { settings: PlanSettings; patch: Patch }): ReactElement {
  const { settings, patch } = props;
  return (
    <label className="check">
      <input type="checkbox" name="reuseOwned" checked={settings.reuseOwned !== false} onChange={(e) => patch({ reuseOwned: e.currentTarget.checked })} />
      Reuse machines we have (off: plan every machine new)
    </label>
  );
}

/**
 * "Plan for" (add-on 17, design spec §3.3, architecture §11.45 (1)): the planning modes as radios, each with what it
 * counts, the project's mode as the planner reads it checked (`planningMode`); below them, for the modes that count build
 * cost, what that cost is counted against (the horizon in rate mode, the batch in Make N), and "Machines vs raw material"
 * (ruling S17), shown in every mode as it was before. Picking a mode sends `objectivePatch`.
 */
export function PlanForSection(props: { settings: PlanSettings; send: Send }): ReactElement {
  const { settings, send } = props;
  const patch: Patch = (p) => send([{ op: 'settings', patch: p }]);
  const mode = planningMode(settings);
  return (
    <section className="settings-section">
      <fieldset className="choice">
        <legend className="settings-title">Plan for</legend>
        {OBJECTIVE_CHOICES.map((c) => (
          <div key={c.value} className="objective-choice">
            <label className="check">
              <input
                type="radio" name="objective" value={c.value} checked={c.value === mode} aria-describedby={`objective-hint-${c.value}`}
                onChange={() => send([{ op: 'settings', patch: objectivePatch(c.value, settings) }])}
              />
              {c.label}
            </label>
            <p id={`objective-hint-${c.value}`} className="choice-hint muted small">{c.hint}</p>
          </div>
        ))}
      </fieldset>
      {mode !== 'least-raw' && <BuildHorizonField settings={settings} patch={patch} />}
      <StepChargeField settings={settings} patch={patch} />
    </section>
  );
}

/**
 * The planner's options: supporting lines, the tier new machines are built at and when a multiblock is built (plan 12
 * Task 7, the user's ruling 224), reusing the machines the group has, and the EBF coil. What the line plans for and how
 * much a machine weighs are under "Plan for". Crafting-table steps always run on an Auto Workbench, so there is no switch
 * for them (the user's ruling 180).
 */
function OptionsSection(props: { settings: PlanSettings; plan: Plan | null; patch: Patch }): ReactElement {
  const { settings, plan, patch } = props;
  const { coilHeat } = settings;
  const coils = COIL_HEATS.map((c) => ({ heat: c.heat, label: `${c.name} (${c.heat} K)` }));
  if (coilHeat !== null && !coils.some((c) => c.heat === coilHeat)) coils.push({ heat: coilHeat, label: `${coilHeat} K` });
  return (
    <section className="settings-section">
      <h3>Options</h3>
      <label className="check">
        <input type="checkbox" checked={settings.routeDerived} onChange={(e) => patch({ routeDerived: e.currentTarget.checked })} />
        Plan supporting lines for alloys, plastics and chemicals (off: buy the shallow ones)
      </label>
      <BuildTierField settings={settings} plan={plan} patch={patch} />
      <MultiblocksField settings={settings} patch={patch} />
      <ReuseOwnedField settings={settings} patch={patch} />
      <label className="field">
        <span>EBF coil</span>
        <select
          value={coilHeat === null ? '' : String(coilHeat)}
          onChange={(e) => patch({ coilHeat: e.currentTarget.value === '' ? null : Number(e.currentTarget.value) })}
        >
          <option value="">Auto</option>
          {coils.map((c) => <option key={c.heat} value={String(c.heat)}>{c.label}</option>)}
        </select>
      </label>
    </section>
  );
}

/**
 * "Farms" (add-on 17, design spec §3.3, architecture §11.45 (2)): the farms the planner may build or reuse — the Tree
 * Growth Simulator, with its energy hatch, the tools in its input bus and their material; CropsNH crop sticks under a
 * Crop Manager, with its tier, the seeds' stats, the layers, the liked biome tags, open sky and fertilizer — each kind's
 * fields shown while it is on. While the active export has no crop table (ruling R10), the Crop Manager part says that
 * crop farms need a newer export instead: the one place this is said. Every change sends the farm settings whole.
 */
export function FarmsSection(props: { info: PackInfo | null; settings: PlanSettings; plan: Plan | null; patch: Patch }): ReactElement {
  const { info, settings, plan, patch } = props;
  const farms = farmsOf(settings);
  // The project's tier, else the plan's (the world's, as the planner resolved it); unknown until the plan says it.
  const projectTier = settings.tier ?? plan?.tier ?? null;
  const kind = (k: FarmKind, label: string): ReactElement => (
    <label className="check">
      <input
        type="checkbox" name={`farm-${k}`} checked={farms.kinds.includes(k)}
        onChange={(e) => {
          const on = e.currentTarget.checked;
          patch(farmsPatch(settings, (f) => ({ ...f, kinds: farmKindsWith(f.kinds, k, on) })));
        }}
      />
      {label}
    </label>
  );
  return (
    <section className="settings-section">
      <h3>Farms</h3>
      <p className="muted small">Farms the planner may build, or reuse where you have them, as renewable sources.</p>
      {kind('tgs', 'Tree Growth Simulator')}
      {farms.kinds.includes('tgs') && <TreeFarmFields settings={settings} projectTier={projectTier} patch={patch} />}
      {kind('crop-manager', 'CropsNH Crop Manager')}
      {hasCropTable(info) === false
        ? <p className="muted small">Crop farms need the crop table of a newer recipe export (exporter 0.5.1 or later).</p>
        : farms.kinds.includes('crop-manager') && <CropFarmFields settings={settings} projectTier={projectTier} patch={patch} />}
    </section>
  );
}

/**
 * One select of the farm settings, as elements (no state, so the panel's tests reach its select): `label` above it (its
 * accessible name too), `options`, the value it has, `onPick` for another one, and a hint below it.
 */
function farmSelect(props: {
  label: string; value: string; options: ReadonlyArray<{ value: string; label: string }>; onPick(value: string): void; hint?: string;
}): ReactElement {
  const { label, value, options, onPick, hint } = props;
  return (
    <label className="field">
      <span>{label}</span>
      <select aria-label={label} value={value} onChange={(e) => { if (e.currentTarget.value !== value) onPick(e.currentTarget.value); }}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {hint !== undefined && <span className="muted small">{hint}</span>}
    </label>
  );
}

/** Whole numbers as the options of a farm select. */
function numberOptions(values: readonly number[]): Array<{ value: string; label: string }> {
  return values.map((n) => ({ value: String(n), label: String(n) }));
}

/**
 * A Tree Growth Simulator's settings: its energy hatch (from LV up to the project's tier), the tools its input bus holds,
 * one per mode, and their material.
 */
export function TreeFarmFields(props: { settings: PlanSettings; projectTier: number | null; patch: Patch }): ReactElement {
  const { settings, projectTier, patch } = props;
  const { tgs } = farmsOf(settings);
  const change = (next: Partial<FarmSettings['tgs']>): void => patch(farmsPatch(settings, (f) => ({ ...f, tgs: { ...f.tgs, ...next } })));
  return (
    <div className="farm-fields">
      {farmSelect({
        label: 'Energy hatch', value: String(tgs.tier), options: farmTierOptions(projectTier, tgs.tier, TOP_TIER), onPick: (v) => change({ tier: Number(v) }),
      })}
      <fieldset className="choice">
        <legend>Tools in its input bus</legend>
        {TGS_TOOL_CHOICES.map((t) => (
          <label key={t.mode} className="check">
            <input type="checkbox" checked={tgs.tools[t.mode]} onChange={(e) => change({ tools: { ...tgs.tools, [t.mode]: e.currentTarget.checked } })} />
            {t.label}
          </label>
        ))}
      </fieldset>
      {farmSelect({
        label: 'Tool material', value: tgs.toolMaterial, options: TOOL_MATERIALS.map((m) => ({ value: m, label: m })), onPick: (v) => change({ toolMaterial: v }),
      })}
    </div>
  );
}

/**
 * A Crop Manager's settings: its tier (from LV up to the project's tier, at most UMV), the seeds' growth, gain and
 * resistance, the layers of crop sticks under it, how many of the crop's liked biome tags the farm's biome has, open sky
 * and fertilizer.
 */
export function CropFarmFields(props: { settings: PlanSettings; projectTier: number | null; patch: Patch }): ReactElement {
  const { settings, projectTier, patch } = props;
  const { crops } = farmsOf(settings);
  const change = (next: Partial<FarmSettings['crops']>): void => patch(farmsPatch(settings, (f) => ({ ...f, crops: { ...f.crops, ...next } })));
  const stat = (name: keyof CropStats, label: string): ReactElement => (
    <StatField key={name} label={label} value={crops.stats[name]} onValue={(value) => change({ stats: { ...crops.stats, [name]: value } })} />
  );
  return (
    <div className="farm-fields">
      {farmSelect({
        label: 'Crop Manager voltage', value: String(crops.tier), options: farmTierOptions(projectTier, crops.tier, MAX_CROP_MANAGER_TIER),
        onPick: (v) => change({ tier: Number(v) }),
      })}
      <div className="row">{stat('growth', 'Growth')}{stat('gain', 'Gain')}{stat('resistance', 'Resistance')}</div>
      {farmSelect({
        label: 'Layers', value: String(crops.layers), options: numberOptions(LAYER_CHOICES), onPick: (v) => change({ layers: Number(v) }),
        hint: 'Only the top layer sees the sky; with more than one, every layer is planned without it',
      })}
      {farmSelect({
        label: 'Liked biome tags', value: String(crops.likedTags), options: numberOptions(LIKED_TAG_CHOICES), onPick: (v) => change({ likedTags: Number(v) }),
      })}
      <label className="check">
        <input type="checkbox" name="crop-sky" checked={crops.sky} onChange={(e) => change({ sky: e.currentTarget.checked })} />
        Open sky
      </label>
      {farmSelect({
        label: 'Fertilizer', value: crops.fertilizer, options: FERTILIZER_CHOICES.map((f) => ({ value: f, label: FERTILIZER_LABELS[f] })),
        onPick: (v) => {
          const fertilizer = FERTILIZER_CHOICES.find((f) => f === v);
          if (fertilizer !== undefined) change({ fertilizer });
        },
      })}
    </div>
  );
}

/** A crop seed's stat as typed, with what is being typed kept here until it is sent or dropped (`StatInput`). */
function StatField(props: { label: string; value: number; onValue(value: number): void }): ReactElement {
  const [draft, setDraft] = useState<string | null>(null);   // null: show the shared value
  return <StatInput {...props} draft={draft} onDraft={setDraft} />;
}

/**
 * A crop seed's growth, gain or resistance: `draft` while one is typed, sent (`onValue`) on Enter or leaving the field
 * when it is a whole number from 1 to 31 that differs; anything else says so and sends nothing. Escape drops the draft.
 */
export function StatInput(props: {
  label: string; value: number; draft: string | null; onDraft(text: string | null): void; onValue(value: number): void;
}): ReactElement {
  const { label, value, draft, onDraft, onValue } = props;
  const parsed = draft === null ? null : parseStat(draft);
  const error = parsed !== null && 'error' in parsed ? parsed.error : null;
  const commit = (text: string): void => {
    const p = parseStat(text);
    if (!('value' in p)) return;
    if (p.value !== value) onValue(p.value);
    onDraft(null);
  };
  return (
    <label className="field">
      <span>{label}</span>
      <input
        className="stat-input" type="text" inputMode="numeric" autoComplete="off" aria-label={label} aria-invalid={error !== null}
        value={draft ?? String(value)}
        onChange={(e) => onDraft(e.currentTarget.value)}
        onBlur={(e) => commit(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.defaultPrevented) commit(e.currentTarget.value);   // not a held Enter's repeat (P2-R69a)
          if (e.key === 'Escape' && !e.nativeEvent.defaultPrevented) onDraft(null);   // one layer per press
        }}
      />
      {error !== null && <span className="field-error error" role="alert">{error}</span>}
    </label>
  );
}

/**
 * "Farms we already run" (add-on 17, architecture §11.45 (2); ruling S20): the farms the group runs — Forestry farms and
 * any other — as what each gives a minute, which a running line takes free up to that rate. A project setting: each
 * project that should use the group's farm lists it. One row per output with its remove button, and a form that adds a
 * farm: its name, the item it gives and how many a minute.
 */
function RunningFarmsSection(props: { settings: PlanSettings; patch: Patch; nameOf: NameOf; remember(hit: SearchHit): void }): ReactElement {
  const { settings, patch, nameOf, remember } = props;
  const { running } = farmsOf(settings);
  const rows = runningFarmRows(running);
  const send = (next: RunningFarm[]): void => patch(farmsPatch(settings, (f) => ({ ...f, running: next })));
  const add = (farm: { name: string; key: StuffKey; perMinute: number }): string | null => {
    const next = runningFarmWith(running, farm);
    if ('error' in next) return next.error;
    send(next.running);
    return null;
  };
  return (
    <section className="settings-section">
      <h3>Farms we already run</h3>
      <p className="muted small">Forestry farms and any other farm the group runs: a running line takes what they give free, up to the rate given here.</p>
      {settings.mode === 'makeN' && <p className="muted small">A Make N batch takes nothing from them.</p>}
      {rows.length === 0 ? (
        <p className="muted">Nothing yet.</p>
      ) : (
        <ul className="key-list">
          {rows.map((row) => {
            const item = nameOf(row.key);
            return (
              <li key={row.id} data-running-farm={row.id}>
                <ItemIcon itemKey={row.key} size={20} name={item} />
                <span className="key-name" title={row.key}>{`${row.name}: ${item} · ${formatNumber(row.perMinute)}/min`}</span>
                <button
                  type="button" className="small" aria-label={`Remove ${row.name}: ${item}`}
                  onClick={() => send(runningFarmWithout(running, row.farm, row.output))}
                >
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <AddRunningFarm onAdd={add} remember={remember} />
    </section>
  );
}

/** Adds a farm the group runs: its name, the item it gives (`ItemSearch`) and how many a minute; `onAdd` says why it could not (null once sent). */
function AddRunningFarm(props: {
  onAdd(farm: { name: string; key: StuffKey; perMinute: number }): string | null; remember(hit: SearchHit): void;
}): ReactElement {
  const { onAdd, remember } = props;
  const [name, setName] = useState('');
  const [item, setItem] = useState<SearchHit | null>(null);
  const [rate, setRate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const perMinute = parsePerMinute(rate);
    const problem = item === null ? 'Pick the item it gives' : 'error' in perMinute ? perMinute.error : onAdd({ name, key: item.key, perMinute: perMinute.value });
    setError(problem);
    if (problem === null) {
      setName('');
      setItem(null);
      setRate('');
    }
  };
  return (
    <form className="cost-add" aria-label="Add a farm" onSubmit={submit}>
      <label className="field">
        <span>Farm</span>
        <input value={name} placeholder="e.g. Rubber tree farm" autoComplete="off" onChange={(e) => setName(e.currentTarget.value)} />
      </label>
      {item === null ? (
        <ItemSearch
          placeholder="Item it gives"
          onPick={(hit) => {
            remember(hit);
            setItem(hit);
          }}
        />
      ) : (
        <div className="settings-target">
          <ItemIcon itemKey={item.key} size={20} name={item.name} />
          <span className="settings-target-name">{item.name}</span>
          <button type="button" className="small" onClick={() => setItem(null)}>Change</button>
        </div>
      )}
      <div className="row">
        <label className="field cost-field">
          <span>How many a minute</span>
          <input type="text" inputMode="decimal" autoComplete="off" value={rate} onChange={(e) => setRate(e.currentTarget.value)} />
        </label>
        <button type="submit">Add a farm</button>
      </div>
      {error !== null && <p className="field-error error" role="alert">{error}</p>}
    </form>
  );
}

/**
 * "Use other projects' surplus" (add-on 17, architecture §11.45 (4)): on (the default, also for a project stored before
 * the switch), a running line takes what the group's other projects make and do not need, up to their surplus, before it
 * buys or makes it. A Make N batch neither takes nor offers surplus, so the switch shows in rate mode only.
 */
export function SurplusSection(props: { settings: PlanSettings; patch: Patch }): ReactElement | null {
  const { settings, patch } = props;
  if (settings.mode !== 'rate') return null;
  return (
    <section className="settings-section">
      <label className="check">
        <input type="checkbox" name="useSurplus" checked={settings.useSurplus !== false} onChange={(e) => patch({ useSurplus: e.currentTarget.checked })} />
        Use other projects&apos; surplus
      </label>
      <p className="muted small">The line takes what the group&apos;s other projects make and do not need, up to their surplus, before it buys or makes it.</p>
    </section>
  );
}

/**
 * "Machines we have" (architecture §11.28–§11.29): machines the group owns that the linked world scan does not show,
 * which the line runs on like the scan's while "Reuse machines we have" is on; the list stays when it is off.
 */
function OwnedMachinesSection(props: { info: PackInfo | null; settings: PlanSettings; patch: Patch }): ReactElement {
  const { info, settings, patch } = props;
  return (
    <section className="settings-section">
      <h3>Machines we have</h3>
      <p className="muted small">
        Machines the group owns outside the linked world&apos;s base, or with no world linked: steps run on them before
        new ones are built.
      </p>
      {settings.reuseOwned === false && <p className="muted small">Reuse machines we have is off: the line plans every machine new.</p>}
      <OwnedMachinesEditor
        owned={settings.ownedManual ?? []}
        machines={info === null ? undefined : (info.machines ?? [])}
        onChange={(ownedManual) => patch({ ownedManual })}
      />
    </section>
  );
}

function KeyListSection(props: { title: string; keys: readonly StuffKey[]; empty: string; nameOf: NameOf; onRemove(key: StuffKey): void }): ReactElement {
  const { title, keys, empty, nameOf, onRemove } = props;
  return (
    <section className="settings-section">
      <h3>{title}</h3>
      {keys.length === 0 ? (
        <p className="muted">{empty}</p>
      ) : (
        <ul className="key-list">
          {keys.map((key) => (
            <li key={key} data-item-row={key}>
              <ItemIcon itemKey={key} size={20} name={nameOf(key)} />
              <span className="key-name" title={key}>{nameOf(key)}</span>
              <button type="button" className="small" aria-label={`Remove ${nameOf(key)}`} onClick={() => onRemove(key)}>Remove</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The free inputs the group already supplies (`haveSupply`, fix spec R2): the line plans no generator for them. */
export function HaveSupplySection(props: { settings: PlanSettings; nameOf: NameOf; patch: Patch }): ReactElement {
  const { settings, nameOf, patch } = props;
  return (
    <KeyListSection
      title="We already have a supply"
      keys={settings.haveSupply ?? []}
      empty="Nothing yet. “We already have a supply” on a generator step adds it here."
      nameOf={nameOf}
      onRemove={(key) => patch(haveSupplyPatch(settings, key, false))}
    />
  );
}

/** The ingredient options the group pinned (`optionChoice`, fix spec R9), by the step that takes them; each can be removed. */
export function OptionPinsSection(props: { settings: PlanSettings; plan: Plan | null; nameOf: NameOf; patch: Patch }): ReactElement {
  const { settings, plan, nameOf, patch } = props;
  const rows = optionPinRows(settings, plan, nameOf);
  return (
    <section className="settings-section">
      <h3>Pinned ingredient options</h3>
      {rows.length === 0 ? (
        <p className="muted">Nothing yet. A step&apos;s ingredient options can pin one.</p>
      ) : (
        <ul className="key-list">
          {rows.map((row) => (
            <li key={row.pin} data-option-pin={row.pin}>
              <ItemIcon itemKey={row.option} size={20} name={row.optionName} />
              <span className="key-name" title={row.pin}>{row.label}</span>
              <button
                type="button" className="small" aria-label={`Remove the pin of ${row.optionName}`}
                onClick={() => patch(optionPatch(settings, row.recipeId, row.slot, null))}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** How the panel names a key, and how it learns the name of what was just picked in one of its search boxes. */
export interface PickedNames { nameOf: NameOf; remember(hit: SearchHit): void }

/**
 * The names of what was picked in the settings' search boxes, kept until the plan (which names every key it uses) arrives, so that
 * what was just picked is named at once. The page that draws the panel keeps them and hands them to it, since the Settings button
 * of the head says what the project makes in the same words; a panel that is given none keeps its own.
 */
export function usePickedNames(plan: Plan | null): PickedNames {
  const [picked, setPicked] = useState<Record<string, string>>({});
  const remember = (hit: SearchHit): void => setPicked((names) => (names[hit.key] === hit.name ? names : { ...names, [hit.key]: hit.name }));
  const nameOf: NameOf = (key) => plan?.names?.[key] ?? picked[key] ?? key;
  return { nameOf, remember };
}

export function SettingsPanel(props: ProjectViewProps & { info: PackInfo | null; names?: PickedNames }): ReactElement {
  const { project, plan, send, info } = props;
  const { settings } = project;
  const own = usePickedNames(plan);
  const { nameOf, remember } = props.names ?? own;
  const patch: Patch = (p) => send([{ op: 'settings', patch: p }]);
  return (
    <div className="settings">
      <MakeSection settings={settings} patch={patch} nameOf={nameOf} remember={remember} />
      <PlanForSection settings={settings} send={send} />
      <TierSection settings={settings} plan={plan} patch={patch} />
      <DimsSection info={info} settings={settings} plan={plan} patch={patch} />
      <section className="settings-section">
        <Choice legend="Logistics" heading value={settings.logistics} options={LOGISTICS} onChange={(logistics) => patch({ logistics })} />
      </section>
      <CostsSection settings={settings} patch={patch} nameOf={nameOf} remember={remember} />
      <AvoidSection info={info} settings={settings} send={send} nameOf={nameOf} remember={remember} />
      <SkipSection info={info} settings={settings} patch={patch} />
      <OptionsSection settings={settings} plan={plan} patch={patch} />
      <FarmsSection info={info} settings={settings} plan={plan} patch={patch} />
      <RunningFarmsSection settings={settings} patch={patch} nameOf={nameOf} remember={remember} />
      <SurplusSection settings={settings} patch={patch} />
      <OwnedMachinesSection info={info} settings={settings} patch={patch} />
      <KeyListSection
        title="We already make"
        keys={settings.stopItems}
        empty="Nothing yet. A step's “We already make this” adds it here."
        nameOf={nameOf}
        onRemove={(key) => patch({ stopItems: toggleList(settings.stopItems, key, false) })}
      />
      <KeyListSection
        title="We make ourselves"
        keys={settings.expandItems}
        empty="Nothing yet. A base material's “We'll make it ourselves” adds it here."
        nameOf={nameOf}
        onRemove={(key) => patch({ expandItems: toggleList(settings.expandItems, key, false) })}
      />
      <HaveSupplySection settings={settings} nameOf={nameOf} patch={patch} />
      <OptionPinsSection settings={settings} plan={plan} nameOf={nameOf} patch={patch} />
    </div>
  );
}
