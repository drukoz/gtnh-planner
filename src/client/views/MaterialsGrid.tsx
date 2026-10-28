// "To build (once)" as an inventory grid (Phase 2 spec §9, D9): the build list's top-level lines as Minecraft slots in their groups, each
// item split into stacks of 64 (at most nine drawn, then a slot that says how many more), opted into with the Grid / List toggle in the
// section's head, where the meter of the stacks gathered sits in Grid. One mark per row: the first stack of an item is its one control, a
// native button with role checkbox and a label that never changes, and its other stacks are hidden copies, out of the tab order, that tick
// the same row; so the grid has one tab stop and one checkbox an item, as the List has, and every stack shows the row's state. A marked
// row's slots are dimmed and ticked. Every stack shows the item's NEI tip (its name, what the build needs, why, the avoid marker's words,
// who marked it and when, and its mod), its icon none of its own. A tap ticks; a long press or the focus shows the tip (D11).

import type { CSSProperties, ReactElement } from 'react';
import type { Mark } from '../../shared/types/project.ts';
import { ItemIcon } from '../components/ItemIcon.tsx';
import { modName } from '../components/mod-names.ts';
import { tipText } from '../components/tooltip-model.ts';
import { formatNumber, localTime } from '../format.ts';
import { setMaterialsView, type MaterialsViewMode } from '../state/materials-view.ts';
import { stackText } from './flow-model.ts';
import { MAX_STACKS_SHOWN, slotTipLines, STACK_SIZE, stillNeeded, type SlotGroup, type SlotItem } from './materials-model.ts';
import type { ProjectViewProps } from './project-tabs.ts';

type Send = ProjectViewProps['send'];

/** A slot's item icon: 32 px, which the icon's 2 px of slot round it make the 36 px slot. */
const SLOT_ICON_SIZE = 32;
/** The id of the meter's word, which names its progress bar; the page has one "To build" section. */
const METER_LABEL_ID = 'mat-gathered-label';

/**
 * The head's Grid / List toggle: two small buttons with fixed words, the one in use pressed. The choice is this browser's (no op is sent),
 * so it outlives the tab panel's remount.
 */
export function ViewToggle(props: { view: MaterialsViewMode }): ReactElement {
  const { view } = props;
  return (
    <div className="mat-view-toggle" role="group" aria-label="Show the build list as">
      <button type="button" className="small" aria-pressed={view === 'grid'} onClick={() => setMaterialsView('grid')}>Grid</button>
      <button type="button" className="small" aria-pressed={view === 'list'} onClick={() => setMaterialsView('list')}>List</button>
    </div>
  );
}

/**
 * The stacks gathered, in Grid: a progress bar whose fill grows on its transform (--done), named by its word and read as "2 of 4 stacks
 * gathered", its figures written as the List writes them ("1,563 of 10,000 stacks").
 */
export function GatherMeter(props: { done: number; total: number }): ReactElement {
  const { done, total } = props;
  const count = `${formatNumber(done)} of ${formatNumber(total)} ${total === 1 ? 'stack' : 'stacks'}`;
  return (
    <div className="mat-meter-box">
      <div className="mat-meter-label"><span id={METER_LABEL_ID}>Gathered</span><span>{count}</span></div>
      <div
        className="mat-meter" role="progressbar" aria-labelledby={METER_LABEL_ID} aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}
        aria-valuetext={`${count} gathered`}
      >
        <span className="mat-meter-fill" style={{ '--done': total > 0 ? done / total : 0 } as CSSProperties} />
      </div>
    </div>
  );
}

/** What the slot past the ninth stack says: how many stacks more, rolled up past 999 as a stack count is (`+1.5k`), so it stays in its slot. */
function moreText(item: SlotItem, more: number): string {
  return `+${more < 1000 ? more : stackText(item.key, more)}`;
}

/**
 * The build list as slots, under a hint: each group's head ("Machines · 3 of 11 still needed") over its slots, each item's stacks one after
 * another in the group's grid. No hooks, and it draws the slot buttons itself, so a test can call it and press them.
 */
export function BuildGrid(props: { groups: readonly SlotGroup[]; marks: Readonly<Record<string, Mark>>; send: Send }): ReactElement {
  const { groups, marks, send } = props;
  const slots = (group: SlotGroup, item: SlotItem): ReactElement[] => {
    const mark = marks[item.row];
    const marked = mark !== undefined;
    const toggle = (): void => send([{ op: 'mark', row: item.row, on: !marked }]);
    const tip = tipText([item.name, ...slotTipLines(item, mark, localTime)]);
    const mod = modName(item.key) ?? undefined;
    const n = item.stackCount;
    const label = item.fluid ? `${item.name}, ${item.amount}` : `${item.name}, ${item.amount} in ${formatNumber(n)} ${n === 1 ? 'stack' : 'stacks'}`;
    const face = marked ? 'mat-slot marked' : 'mat-slot';
    const out = item.stacks.slice(0, MAX_STACKS_SHOWN).map((stack, i) => {
      const key = `${group.id}:${item.row}#${i}`;
      const inside = (
        <>
          <ItemIcon itemKey={item.key} size={SLOT_ICON_SIZE} name={item.name} tip={false} />
          {stack > 1 && <span className="stack-count" aria-hidden="true">{String(stack)}</span>}
          {marked && <span className="mat-slot-tick" aria-hidden="true" />}
        </>
      );
      return i === 0 ? (
        <button
          key={key} type="button" className={face} role="checkbox" aria-checked={marked} aria-label={label} data-row={item.row}
          data-marked={marked ? 'true' : 'false'} data-tip={tip} data-tip-mod={mod} onClick={toggle}
        >
          {inside}
        </button>
      ) : (
        <button key={key} type="button" className={face} aria-hidden="true" tabIndex={-1} data-stack-of={item.row} data-tip={tip} data-tip-mod={mod} onClick={toggle}>
          {inside}
        </button>
      );
    });
    if (n > MAX_STACKS_SHOWN) {
      out.push(
        <button
          key={`${group.id}:${item.row}#${MAX_STACKS_SHOWN}`} type="button" className={`${face} mat-slot-more`} aria-hidden="true" tabIndex={-1}
          data-stack-of={item.row} data-tip={tip} data-tip-mod={mod} onClick={toggle}
        >
          <span className="stack-count" aria-hidden="true">{moreText(item, n - MAX_STACKS_SHOWN)}</span>
          {marked && <span className="mat-slot-tick" aria-hidden="true" />}
        </button>,
      );
    }
    return out;
  };
  return (
    <div className="mat-grid">
      <p className="mat-grid-hint muted">{`Click a stack to mark it as in your chests. Stacks split at ${STACK_SIZE}, like in game.`}</p>
      {groups.map((group) => (
        <div key={group.id} className="mat-grid-group">
          <h4 id={`slots-${group.id}`}>{`${group.label} `}<span className="mat-grid-left">{`· ${stillNeeded(group.items, marks)}`}</span></h4>
          <div className="mat-slots" role="group" aria-labelledby={`slots-${group.id}`}>
            {group.items.flatMap((item) => slots(group, item))}
          </div>
        </div>
      ))}
    </div>
  );
}
