// Deleting and restoring projects (architecture §11.24): anyone may delete one; it stays restorable from "Recently
// deleted" for 7 days.

import type { DeletedProjectSummary } from '../../shared/types/api.ts';
import type { Project } from '../../shared/types/project.ts';
import { apiDelete, apiGet, apiPost } from './client.ts';

function projectPath(id: string): string {
  return `/api/projects/${encodeURIComponent(id)}`;
}

/** Deletes the project for everyone; its open tabs are told and go back to the list. */
export function deleteProject(id: string): Promise<void> {
  return apiDelete(projectPath(id));
}

/** Brings a deleted project back as it was. */
export function restoreProject(id: string): Promise<Project> {
  return apiPost<Project>(`${projectPath(id)}/restore`, {});
}

/** The deleted projects not purged yet, newest deletion first. */
export function listDeletedProjects(): Promise<DeletedProjectSummary[]> {
  return apiGet<DeletedProjectSummary[]>('/api/projects?deleted=1');
}
