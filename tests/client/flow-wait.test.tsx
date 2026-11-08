import { describe, expect, it } from 'vitest';
import { choiceDoneText, COUNT_FROM_SECONDS, flowWait, FlowWait, flowWaitText, waitSeconds } from '../../src/client/views/flow-wait.ts';

describe('flow wait (RUK-740 round 3)', () => {
  it('waits for the plan first, then for the layout', () => {
    expect(flowWait(false, false)).toBe(FlowWait.None);
    expect(flowWait(true, false)).toBe(FlowWait.Plan);
    expect(flowWait(true, true)).toBe(FlowWait.Plan);
    expect(flowWait(false, true)).toBe(FlowWait.Layout);
  });
  it('keeps its numbers', () => {
    expect([FlowWait.None, FlowWait.Plan, FlowWait.Layout]).toEqual([0, 1, 2]);
  });
  it('names the choice while its plan is made', () => {
    expect(flowWaitText(FlowWait.None, 'Copper Wire')).toBe('');
    expect(flowWaitText(FlowWait.Plan, null)).toBe('Re-planning…');
    expect(flowWaitText(FlowWait.Plan, 'Copper Wire')).toBe('Re-planning with your choice for Copper Wire…');
    expect(flowWaitText(FlowWait.Layout, 'Copper Wire')).toBe('Laying out the new chart…');
  });
  it('counts whole seconds from COUNT_FROM_SECONDS on', () => {
    expect(COUNT_FROM_SECONDS).toBe(2);
    expect(waitSeconds(0)).toBe('');
    expect(waitSeconds(1999)).toBe('');
    expect(waitSeconds(2000)).toBe('2 s');
    expect(waitSeconds(12_700)).toBe('12 s');
  });
  it('says the plan is updated, or why not', () => {
    expect(choiceDoneText('Copper Wire', null)).toBe('Plan updated with your choice for Copper Wire');
    expect(choiceDoneText('Copper Wire', 'The planner failed: boom')).toBe('Could not update the plan: The planner failed: boom');
  });
});
