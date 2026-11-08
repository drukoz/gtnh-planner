// The Flow tab's Full view (RUK-740 round 2): the project's banners hidden so the chart fills the window under the tabs, and whether the
// planner (the settings panel) is hidden beside it. One value each for this browser, kept in localStorage as Pause pipes is (browser-choice.ts).

import { createBrowserChoice } from './browser-choice.ts';

export const FLOW_FULL_VIEW_KEY = 'gtnh-planner:flow-full-view';
export const PLANNER_HIDDEN_KEY = 'gtnh-planner:planner-hidden';

/** On is `'1'` in storage, off `'0'`; anything else, or nothing stored, is off. */
const onOff = (key: string) => createBrowserChoice<boolean>({ key, read: (stored) => stored === '1', write: (on) => (on ? '1' : '0') });
const fullView = onOff(FLOW_FULL_VIEW_KEY);
const plannerHidden = onOff(PLANNER_HIDDEN_KEY);

/** Turns the Flow tab's Full view on or off in this browser. */
export function setFlowFullView(on: boolean): void {
  fullView.set(on);
}

/** Whether Full view is on, re-rendering when it changes. */
export function useFlowFullView(): boolean {
  return fullView.use();
}

/** Hides or shows the planner beside the Flow chart in Full view. */
export function setPlannerHidden(hidden: boolean): void {
  plannerHidden.set(hidden);
}

/** Whether the planner is hidden in Full view, re-rendering when it changes. */
export function usePlannerHidden(): boolean {
  return plannerHidden.use();
}
