// The tabs of a project page (architecture §7.2). Append-only registry: Task 17 puts `flow` first, Task 18 puts
// `materials` between flow and notes, Plan 4 inserts `map` first and Plan 5 inserts `3d` after it.

import type { ComponentType } from 'react';
import type { Plan } from '../../shared/types/plan.ts';
import type { Project, ProjectOp } from '../../shared/types/project.ts';
import { FlowView } from './FlowView.tsx';
import { MaterialsView } from './MaterialsView.tsx';
import { NotesView } from './NotesView.tsx';

export interface ProjectViewProps { project: Project; plan: Plan | null; send: (ops: ProjectOp[]) => void; me: string }
export interface ProjectTab { id: 'map' | '3d' | 'flow' | 'materials' | 'notes'; label: string; component: ComponentType<ProjectViewProps> }

export const PROJECT_TABS: ProjectTab[] = [
  { id: 'flow', label: 'Flow', component: FlowView },
  { id: 'materials', label: 'Materials & steps', component: MaterialsView },
  { id: 'notes', label: 'Notes', component: NotesView },
];

/** The tab `#<id>` names, else the first tab (the default view). */
export function tabFromHash(hash: string): ProjectTab['id'] {
  return PROJECT_TABS.find((tab) => `#${tab.id}` === hash)?.id ?? PROJECT_TABS[0]!.id;
}
