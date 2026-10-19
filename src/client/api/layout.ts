// The project's line layout (architecture §6.7, §7: `GET /api/projects/:id/layout`), through Plan 2's apiGet (name
// header, 401 → login, ApiError).

import type { Layout } from '../../shared/types/layout.ts';
import { apiGet } from './client.ts';

export function fetchLayout(projectId: string): Promise<Layout> {
  return apiGet<Layout>(`/api/projects/${encodeURIComponent(projectId)}/layout`);
}
