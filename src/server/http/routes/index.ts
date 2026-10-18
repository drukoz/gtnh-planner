// The ONLY place route modules are listed (architecture §7.1). Append-only: Plan 2 adds projects, Plan 3 assets,
// Plan 4 world, Plan 5 layout.

import type { AppContext } from '../../app.ts';
import type { Route } from '../router.ts';
import { assetRoutes } from './assets.ts';
import { authRoutes } from './auth.ts';
import { packRoutes } from './pack.ts';
import { projectRoutes } from './projects.ts';
import { worldRoutes } from './world.ts';

export const ROUTE_MODULES: Array<(app: AppContext) => Route[]> = [authRoutes, packRoutes, projectRoutes, assetRoutes, worldRoutes];
