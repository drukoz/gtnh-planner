// What the Flow tab says over its chart while a new plan or a new layout is on its way (RUK-740 round 3). A recipe picked in the recipe
// browser (or any other change) is planned by the server first, which takes seconds on a big line, then the chart is laid out again; the
// old chart stays up meanwhile, dimmed, under a badge that says what is going on and, after a moment, for how long. Pure: the tests call it.

/** What the chart waits for. */
export const FlowWait = { None: 0, Plan: 1, Layout: 2 } as const;
export type FlowWait = (typeof FlowWait)[keyof typeof FlowWait];

/** From how many seconds the badge counts them, so a long replan is seen to be alive after the GT arrow has stopped. */
export const COUNT_FROM_SECONDS = 2;

/** A new plan on its way comes first; then a new layout of the plan on screen. */
export function flowWait(planBusy: boolean, layoutPending: boolean): FlowWait {
  if (planBusy) return FlowWait.Plan;
  return layoutPending ? FlowWait.Layout : FlowWait.None;
}

/** The badge's words: '' for none; `choiceFor` names the good a choice in the recipe browser was made for, while that plan is made. */
export function flowWaitText(wait: FlowWait, choiceFor: string | null): string {
  if (wait === FlowWait.Plan) return choiceFor === null ? 'Re-planning…' : `Re-planning with your choice for ${choiceFor}…`;
  if (wait === FlowWait.Layout) return 'Laying out the new chart…';
  return '';
}

/** How long it has waited, as the badge shows it after its words: '' under `COUNT_FROM_SECONDS`, else whole seconds ("4 s"). */
export function waitSeconds(ms: number): string {
  const s = Math.floor(ms / 1000);
  return s < COUNT_FROM_SECONDS ? '' : `${s} s`;
}

/** The toast when the wait for a choice ends: its plan is on screen, or why it is not. */
export function choiceDoneText(choiceFor: string, planError: string | null): string {
  return planError === null ? `Plan updated with your choice for ${choiceFor}` : `Could not update the plan: ${planError}`;
}
