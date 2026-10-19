// The `3d` project tab (architecture §7.2): the 3D view loaded on first use, so three.js lands in a chunk of its own and
// the other tabs never download it (web-stack §8).

import { Component, lazy, Suspense, type ReactElement, type ReactNode } from 'react';
import { messageOf } from '../api/client.ts';
import type { ProjectViewProps } from './project-tabs.ts';

const View3D = lazy(() => import('./View3D.tsx'));

/**
 * What the tab shows when its chunk cannot be loaded — after the planner was rebuilt while this page stayed open, the
 * old chunk is gone — or the view fails while drawing: the reason, in place of a blank page.
 */
class ViewFailed extends Component<{ children: ReactNode }, { error: string | null }> {
  override state: { error: string | null } = { error: null };

  static getDerivedStateFromError(err: unknown): { error: string } {
    return { error: messageOf(err) };
  }

  override render(): ReactNode {
    if (this.state.error === null) return this.props.children;
    return <p className="error">{`The 3D view could not be shown — reload the page to try again (${this.state.error})`}</p>;
  }
}

export function View3DTab(props: ProjectViewProps): ReactElement {
  return (
    <ViewFailed>
      <Suspense fallback="Loading the 3D view…">
        <View3D {...props} />
      </Suspense>
    </ViewFailed>
  );
}
