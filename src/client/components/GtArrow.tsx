// The GT progress arrow (Phase 2 spec §11.3): the 22 x 16 pixel arrow GregTech draws between a machine's input and output slots, its white
// fill sweeping from the left in eight steps. The stylesheet runs it three times (4.8 s, within WCAG 2.2.2's 5 s), then it rests full; under
// reduced motion it shows full at once. The recipe card draws it on the panel (`tone="panel"`, its base the slot grey), the busy line on a chat
// box (`tone="chat"`, a darker base and the accent fill); `still` keeps it full and unmoving, for a recipe of no ticks. It is decoration, so
// it is hidden from assistive technology, and it holds no hooks.

import type { ReactElement } from 'react';

export function GtArrow(props: { tone: 'panel' | 'chat'; still?: boolean }): ReactElement {
  const classes = ['gt-arrow', ...(props.tone === 'chat' ? ['on-chat'] : []), ...(props.still === true ? ['still'] : [])];
  return (
    <span className={classes.join(' ')} aria-hidden="true">
      <span className="gt-arrow-fill" />
    </span>
  );
}
