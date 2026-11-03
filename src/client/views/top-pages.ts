// Top-level pages (architecture §11.10), read by the router and the header nav. Append-only: Plan 4 appends
// `{ path: '/world', label: 'World', component: WorldPage }`. The project list moved from / to /projects when / became the
// landing page (RUK-510), which is a route of its own and not a top page.

import type { ComponentType } from 'react';
import { ProjectList } from './ProjectList.tsx';
import { WorldPage } from './WorldPage.tsx';

export interface TopPage { path: string; label: string; component: ComponentType }

export const TOP_PAGES: TopPage[] = [{ path: '/projects', label: 'Projects', component: ProjectList }, { path: '/world', label: 'World', component: WorldPage }];
