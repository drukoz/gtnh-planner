// The tabs of a project page (architecture §7.2). Append-only registry: Task 17 puts `flow` first, Task 18 puts
// `materials` between flow and notes, Plan 4 inserts `map` first and Plan 5 inserts `3d` after it. Plan 11 inserts
// `connections` after `3d` ("EnderIO conduits, granted change requests (add-on 11)"); until Plan 5's `3d` tab is
// merged it follows `map` (plan 11, ruling R6).

import type { ComponentType } from 'react';
import type { Plan } from '../../shared/types/plan.ts';
import type { Project, ProjectOp } from '../../shared/types/project.ts';
import { ConnectionsView } from './ConnectionsView.tsx';
import { FlowView } from './FlowView.tsx';
import { MapTab } from './MapTab.tsx';
import { MaterialsView } from './MaterialsView.tsx';
import { NotesView } from './NotesView.tsx';

export interface ProjectViewProps { project: Project; plan: Plan | null; send: (ops: ProjectOp[]) => void; me: string }
export interface ProjectTab { id: 'map' | '3d' | 'connections' | 'flow' | 'materials' | 'notes'; label: string; component: ComponentType<ProjectViewProps> }

export const PROJECT_TABS: ProjectTab[] = [
  { id: 'map', label: 'Map', component: MapTab },
  { id: 'connections', label: 'Connections', component: ConnectionsView },
  { id: 'flow', label: 'Flow', component: FlowView },
  { id: 'materials', label: 'Materials & steps', component: MaterialsView },
  { id: 'notes', label: 'Notes', component: NotesView },
];

/** The tab `#<id>` names, else the first tab (the default view). */
export function tabFromHash(hash: string): ProjectTab['id'] {
  return PROJECT_TABS.find((tab) => `#${tab.id}` === hash)?.id ?? PROJECT_TABS[0]!.id;
}
