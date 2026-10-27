// The tabs of a project page (architecture §7.2). Append-only registry: Task 17 puts `flow` first, Task 18 puts
// `materials` between flow and notes, Plan 4 inserts `map` first and Plan 5 inserts `3d` after it. Plan 11 inserts
// `connections` after `3d` ("EnderIO conduits, granted change requests (add-on 11)").

import type { ComponentType } from 'react';
import type { Plan } from '../../shared/types/plan.ts';
import type { Project, ProjectOp } from '../../shared/types/project.ts';
import type { ProjectStore } from '../state/project-store.ts';
import { ConnectionsView } from './ConnectionsView.tsx';
import { FlowView } from './FlowView.tsx';
import { MapTab } from './MapTab.tsx';
import { MaterialsView } from './MaterialsView.tsx';
import { NotesView } from './NotesView.tsx';
import { View3DTab } from './View3DTab.tsx';

export interface ProjectViewProps {
  project: Project; plan: Plan | null; send: (ops: ProjectOp[]) => void; me: string;
  // optional addition
  /** The plan a settings change replaced (`ProjectViewState.previousPlan`), for the "What changed" note (fix spec §6.4). */
  previousPlan?: Plan | null;
  /**
   * Sends ops later, through the page's store (Phase 2 spec §12.2): a deleted note, posted once the Undo of its toast has gone. Without it a
   * view sends at once.
   */
  sendLater?: ProjectStore['sendLater'];
}
export interface ProjectTab { id: 'map' | '3d' | 'connections' | 'flow' | 'materials' | 'notes'; label: string; component: ComponentType<ProjectViewProps> }

export const PROJECT_TABS: ProjectTab[] = [
  { id: 'map', label: 'Map', component: MapTab },
  { id: '3d', label: '3D', component: View3DTab },
  { id: 'connections', label: 'Connections', component: ConnectionsView },
  { id: 'flow', label: 'Flow', component: FlowView },
  { id: 'materials', label: 'Materials & steps', component: MaterialsView },
  { id: 'notes', label: 'Notes', component: NotesView },
];

/** The tab `#<id>` names, else the first tab (the default view). */
export function tabFromHash(hash: string): ProjectTab['id'] {
  return PROJECT_TABS.find((tab) => `#${tab.id}` === hash)?.id ?? PROJECT_TABS[0]!.id;
}
