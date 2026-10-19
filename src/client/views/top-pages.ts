// Top-level pages (architecture §11.10), read by the router and the header nav. Append-only: Plan 4 appends
// `{ path: '/world', label: 'World', component: WorldPage }`.

import type { ComponentType } from 'react';
import { ProjectList } from './ProjectList.tsx';
import { WorldPage } from './WorldPage.tsx';

export interface TopPage { path: string; label: string; component: ComponentType }

export const TOP_PAGES: TopPage[] = [{ path: '/', label: 'Projects', component: ProjectList }, { path: '/world', label: 'World', component: WorldPage }];
