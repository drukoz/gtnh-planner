// The panel beside the flow diagram (spec §3.9): click a step to reuse the group's machines or not (spec §3.3 "suggests
// reusing them. The group decides."), see its overclock math, swap its recipe (alternatives by raw material use), mark
// its product "we already make this" and read its warnings; click a raw material to see where it comes from and, for
// a base material, plan it in the line instead. Every choice sends one `settings` op with whole field values.

import { useId, useState, type ReactElement } from 'react';
import type { StuffKey } from '../../shared/keys.ts';
import type { LeafClass, Plan, PlanSettings, PlanStep, RawInput, SourceInfo } from '../../shared/types/plan.ts';
import { ItemIcon } from '../components/ItemIcon.tsx';
import { formatNumber, formatRate, ocLines, reusePatch } from './flow-model.ts';
import type { ProjectViewProps } from './project-tabs.ts';
import { toggleList } from './settings-model.ts';

type Send = ProjectViewProps['send'];
type NameOf = (key: string) => string;

/** Found spots listed per source before the rest is summed up. */
const MAX_FOUND_AT = 3;
/** Swap options shown before "more…" (the one in use and a pinned one always show). */
const SWAP_SHOWN = 5;

const LEAF_TEXT: Record<LeafClass, string> = {
  free: 'Free: water, air, cobblestone and lava cost nothing',
  direct: 'Base material: mined directly',
  byproduct: 'Base material: an ore-processing byproduct',
  derived: 'Base material: made from other materials, counted as bought',
  natural: 'Gathered from the world',
  stop: 'We already make this: counted at its cost',
  unavailable: 'Not reachable at this tier with these dimensions',
};

/** The leaf kinds that are base materials, which the group may choose to make in the line instead. */
const BASE_MATERIALS: ReadonlySet<LeafClass> = new Set<LeafClass>(['direct', 'byproduct', 'derived']);

const SOURCE_TEXT: Record<SourceInfo['kind'], string> = {
  vein: 'Ore vein', small_ore: 'Small ore', byproduct: 'Byproduct', fluid: 'Fluid', capability: 'Capability',
  craft: 'Crafted', natural: 'Natural', derived: 'Derived', unknown: 'Unknown',
};

function namesOf(plan: Plan): NameOf {
  return (key) => plan.names?.[key] ?? key;
}

function settingsSender(send: Send): (patch: Partial<PlanSettings>) => void {
  return (patch) => send([{ op: 'settings', patch }]);
}

/** A recipe map id in words: `gt.recipe.assembler` → `Assembler`, for a plan whose names have no `map:` entry. */
function mapLabel(mapId: string): string {
  const words = mapId.replace(/^.*?recipe\./, '').replace(/[._-]+/g, ' ').trim();
  return words === '' ? mapId : words.charAt(0).toUpperCase() + words.slice(1);
}

type Alternative = PlanStep['alternatives'][number];

/** "2× Copper Wire, Redstone": a list of goods with their amounts per run. */
function partsText(parts: Alternative['inputs'], nameOf: NameOf): string {
  return (parts ?? []).map((p) => `${p.key.startsWith('fluid:') ? `${formatNumber(p.amount)} L ` : p.amount === 1 ? '' : `${formatNumber(p.amount)}× `}${nameOf(p.key)}`).join(', ');
}

/** One swap option in words: its machine, what a run takes and makes, and its raw material use. */
function alternativeText(a: Alternative, nameOf: NameOf): string {
  const machine = nameOf(`map:${a.mapId}`) === `map:${a.mapId}` ? mapLabel(a.mapId) : nameOf(`map:${a.mapId}`);
  const takes = partsText(a.inputs, nameOf);
  const makes = partsText(a.outputs, nameOf);
  const what = takes === '' && makes === '' ? '' : `: ${takes === '' ? 'nothing' : takes} → ${makes}`;
  return `${machine}${what} · ${formatNumber(a.rawCost)} raw/unit`;
}

function PanelHead(props: { itemKey: StuffKey | null; title: string; onClose(): void }): ReactElement {
  const { itemKey, title, onClose } = props;
  return (
    <header className="flow-panel-head">
      {itemKey !== null && <ItemIcon itemKey={itemKey} size={24} />}
      <h3>{title}</h3>
      <button type="button" className="small" aria-label="Close the panel" onClick={onClose}>Close</button>
    </header>
  );
}

function ReuseSection(props: { step: PlanStep; settings: PlanSettings; patch(p: Partial<PlanSettings>): void }): ReactElement | null {
  const { step, settings, patch } = props;
  const { mteId, name } = step.machine;
  const declined = (settings.declineReuse ?? []).includes(mteId);
  if (step.owned <= 0 && !declined) return null;
  return (
    <section className="flow-panel-section">
      <h4 className="flow-panel-title">Reuse</h4>
      <label className="check">
        <input type="checkbox" name="reuse" checked={!declined} onChange={(e) => patch(reusePatch(settings, mteId, e.currentTarget.checked))} />
        {declined ? `Reuse your ${name} machines` : `Reuse your ${step.owned}× ${name}`}
      </label>
    </section>
  );
}

function SwapSection(props: { step: PlanStep; settings: PlanSettings; nameOf: NameOf; patch(p: Partial<PlanSettings>): void }): ReactElement {
  const { step, settings, nameOf, patch } = props;
  const group = useId();
  const [expanded, setExpanded] = useState(false);
  const main = step.mainOutput;
  if (main === undefined) {
    return (
      <section className="flow-panel-section">
        <h4 className="flow-panel-title">Swap recipe</h4>
        <p className="muted">This step has no main product to pin a recipe for.</p>
      </section>
    );
  }
  const choices = settings.recipeChoice;
  const pinned = Object.hasOwn(choices, main) ? choices[main] : undefined;
  const choose = (recipeId: string | null): void => {
    const next = { ...choices };
    if (recipeId === null) delete next[main];
    else next[main] = recipeId;
    patch({ recipeChoice: next });
  };
  const listed = pinned === undefined || step.alternatives.some((a) => a.recipeId === pinned);
  // Sorted by raw material use already (server); the first few, plus the one in use and a pinned one wherever they are.
  const shown = expanded ? step.alternatives
    : step.alternatives.filter((a, i) => i < SWAP_SHOWN || a.recipeId === step.recipeId || a.recipeId === pinned);
  const hidden = step.alternatives.length - shown.length;
  return (
    <fieldset className="flow-panel-section">
      <legend className="flow-panel-title">Swap recipe</legend>
      <label className="check">
        <input type="radio" name={group} checked={pinned === undefined} onChange={() => choose(null)} />
        Let the planner choose
      </label>
      {shown.map((a) => (
        <label key={a.recipeId} className="check swap-option" title={`recipe ${a.recipeId}`}>
          <input type="radio" name={group} checked={pinned === a.recipeId} onChange={() => choose(a.recipeId)} />
          <span className="swap-text">{alternativeText(a, nameOf)}</span>
          {a.recipeId === step.recipeId && <span className="badge">in use</span>}
        </label>
      ))}
      {hidden > 0 && (
        <div className="row">
          <button type="button" className="small" onClick={() => setExpanded(true)}>{`${hidden} more…`}</button>
        </div>
      )}
      {!listed && <p className="muted small">{`The pinned recipe ${pinned} is not usable now, so the planner chose another.`}</p>}
      {step.alternatives.length <= 1 && <p className="muted small">{`No other recipe for ${nameOf(main)} is usable here.`}</p>}
    </fieldset>
  );
}

function StopSection(props: { step: PlanStep; settings: PlanSettings; nameOf: NameOf; patch(p: Partial<PlanSettings>): void }): ReactElement {
  const { step, settings, nameOf, patch } = props;
  const main = step.mainOutput;
  let body: ReactElement;
  if (main === undefined) body = <p className="muted">This step has no main product to mark.</p>;
  else if (main === settings.target) body = <p className="muted">This step makes the target itself.</p>;
  else if (settings.stopItems.includes(main)) body = <p className="muted">{`${nameOf(main)} is marked already; the plan is catching up.`}</p>;
  else {
    body = (
      <>
        <p className="muted small">{`Stops the chain here: ${nameOf(main)} becomes an input of the line, counted at its cost.`}</p>
        <div className="row">
          <button type="button" onClick={() => patch({ stopItems: toggleList(settings.stopItems, main, true) })}>{`We already make ${nameOf(main)}`}</button>
        </div>
      </>
    );
  }
  return (
    <section className="flow-panel-section">
      <h4 className="flow-panel-title">We already make this</h4>
      {body}
    </section>
  );
}

export function StepPanel(props: { step: PlanStep; plan: Plan; settings: PlanSettings; send: Send; onClose(): void }): ReactElement {
  const { step, plan, settings, send, onClose } = props;
  const nameOf = namesOf(plan);
  const patch = settingsSender(send);
  const warnings = [...new Set([...step.warnings, ...plan.warnings.filter((w) => w.stepId === step.id).map((w) => w.text)])];
  return (
    <aside className="flow-panel" aria-label={`Step: ${step.count}× ${step.machine.name}`}>
      <PanelHead itemKey={step.mainOutput ?? null} title={`${step.count}× ${step.machine.name}`} onClose={onClose} />
      {step.mainOutput !== undefined && (
        <p className="muted">{`makes ${nameOf(step.mainOutput)}${step.handCraft ? ' · by hand' : ''}`}</p>
      )}
      <ReuseSection step={step} settings={settings} patch={patch} />
      <section className="flow-panel-section">
        <h4 className="flow-panel-title">Overclock</h4>
        <ul className="oc-lines">
          {ocLines(step).map((line) => <li key={line}>{line}</li>)}
        </ul>
      </section>
      <SwapSection step={step} settings={settings} nameOf={nameOf} patch={patch} />
      <StopSection step={step} settings={settings} nameOf={nameOf} patch={patch} />
      {warnings.length > 0 && (
        <section className="flow-panel-section">
          <h4 className="flow-panel-title">Warnings</h4>
          <ul className="warnings">
            {warnings.map((text) => <li key={text}>{text}</li>)}
          </ul>
        </section>
      )}
    </aside>
  );
}

/** `Ore vein: <detail> — Moon, Mars`; dimensions by name (`dim:<key>` in Plan.names), else by key. */
function sourceText(source: SourceInfo, names: Plan['names']): string {
  const dims = source.dims.map((key) => names?.[`dim:${key}`] ?? key);
  const detail = source.detail === '' ? SOURCE_TEXT[source.kind] : `${SOURCE_TEXT[source.kind]}: ${source.detail}`;
  return dims.length > 0 ? `${detail} — ${dims.join(', ')}` : detail;
}

/** Where the group found it: the first few spots, their dimension by name (`dimId:<n>` in Plan.names) else `DIM<n>`. */
function foundText(spots: NonNullable<SourceInfo['foundAt']>, names: Plan['names']): string {
  const listed = spots.slice(0, MAX_FOUND_AT).map((s) => `found at ${s.x} ${s.z} (${names?.[`dimId:${s.dim}`] ?? `DIM${s.dim}`})`);
  const more = spots.length > MAX_FOUND_AT ? ` and ${spots.length - MAX_FOUND_AT} more` : '';
  return `${listed.join('; ')}${more}`;
}

/** The panel of a raw-material box: its rate, what kind of leaf it is, where it comes from and what is in storage. */
export function RawPanel(props: { itemKey: StuffKey; plan: Plan; settings: PlanSettings; per: 'min' | 'hour'; send: Send; onClose(): void }): ReactElement {
  const { itemKey, plan, settings, per, send, onClose } = props;
  const nameOf = namesOf(plan);
  const patch = settingsSender(send);
  const input: RawInput | undefined = plan.rawInputs.find((r) => r.key === itemKey);
  const sources = input?.sources ?? [];
  const leaf = input?.leafClass;
  const canExpand = leaf !== undefined && BASE_MATERIALS.has(leaf) && !settings.expandItems.includes(itemKey);
  return (
    <aside className="flow-panel" aria-label={`Raw material: ${nameOf(itemKey)}`}>
      <PanelHead itemKey={itemKey} title={nameOf(itemKey)} onClose={onClose} />
      {input !== undefined && (
        <p className="muted">
          {`raw · ${formatRate(input.perSecond, per)}`}
          {input.total !== undefined && ` · ${Number(input.total.toFixed(2))} for the whole run`}
        </p>
      )}
      {leaf !== undefined && <p>{LEAF_TEXT[leaf]}</p>}
      {input !== undefined && !input.available && leaf !== 'unavailable' && <p className="error">{LEAF_TEXT.unavailable}</p>}
      {input?.have !== undefined && (
        <p className="muted">{`In storage: ${input.have.total} (${input.have.reachable} reachable by the line)`}</p>
      )}
      <section className="flow-panel-section">
        <h4 className="flow-panel-title">Sources</h4>
        {sources.length === 0 ? (
          <p className="muted">No known source in the pack.</p>
        ) : (
          <ul className="sources">
            {sources.map((source, i) => (
              <li key={`${source.kind}:${i}`}>
                {sourceText(source, plan.names)}
                {source.foundAt !== undefined && source.foundAt.length > 0 && (
                  <span className="muted small">{` · ${foundText(source.foundAt, plan.names)}`}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      {canExpand && (
        <section className="flow-panel-section">
          <p className="muted small">Plan its own recipe in this line instead of counting it as a base material.</p>
          <div className="row">
            <button type="button" onClick={() => patch({ expandItems: toggleList(settings.expandItems, itemKey, true) })}>We'll make it ourselves</button>
          </div>
        </section>
      )}
    </aside>
  );
}
