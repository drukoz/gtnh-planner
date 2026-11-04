// Builds data/e2e for the end-to-end web server (architecture §11.7): the Mini-GT pack as a real export in the
// exporter's wire format (Plan 1's makeExport), and a config with the shared password on 127.0.0.1:18787. Playwright
// runs this before every server start (playwright.config.ts), so each run starts from an empty project database.
// Plans 3–5 extend main() (assets, line parts) instead of starting another server (ruling R15).

import { mkdir, rm } from 'node:fs/promises';
import { saveConfig } from '../../src/server/config.ts';
import { hashPassword, newSessionSecret } from '../../src/server/http/auth.ts';
import { toExportSpec } from '../helpers/export-spec.ts';
import { withLineParts } from '../helpers/line-parts-export.ts';
import { makeExport } from '../helpers/make-export.ts';
import { MINI_GT } from '../helpers/mini-gt.ts';
import type { PackSpec } from '../helpers/pack-spec.ts';
import { prepareAssets } from './assets-fixture.ts';
import { E2E_PASSWORD } from './helpers.ts';

/**
 * The pack the e2e server plans with: Mini-GT plus crafting recipes for its Advanced Bending Machine (102: an LV hull and
 * 4 circuits, as plan 12's Task 3 tests make it) and its Basic Electric Furnace (151: an LV hull, 2 circuits and 2 tin
 * cables, as the sand fixture makes it). Plan 12 never plans a machine no recipe makes as a new one (controller Amendment
 * OQ3): plan.spec.ts's impossible target (Titanium Plate at MV) is about the titanium the Moon holds, not about the
 * bender, and flow-focus.spec.ts's "Make it here instead" on Iron Ingot is about the furnace step it adds (ruling P4).
 */
const E2E_PACK: PackSpec = {
  ...MINI_GT,
  recipes: [
    ...(MINI_GT.recipes ?? []),
    { id: 'make-102', map: 'crafting', in: [['t:hull_lv@0', 1], ['t:circuit@0', 4]], out: [['machine:102@0', 1]] },
    { id: 'make-151', map: 'crafting', in: [['t:hull_lv@0', 1], ['t:circuit@0', 2], ['t:tin_cable@0', 2]], out: [['machine:151@0', 1]] },
  ],
};

/**
 * Removes and recreates data/e2e: the e2e pack's export `e2e` with the line parts, and the config the e2e server starts
 * with, which asks for the password (the browser tests log in; tests/unit/http/server.test.ts covers the password off).
 */
async function main(): Promise<void> {
  await rm('data/e2e', { recursive: true, force: true });
  await mkdir('data/e2e', { recursive: true });
  await makeExport('data/e2e/export/e2e', withLineParts(toExportSpec(E2E_PACK)));
  saveConfig({
    port: 18787, host: '127.0.0.1', dataDir: 'data/e2e', serverFolder: null, activeExportId: 'e2e',
    passwordHash: hashPassword(E2E_PASSWORD), sessionSecret: newSessionSecret(), requirePassword: true,
  }, 'data/e2e/config.json');
  await prepareAssets('data/e2e', 'data/e2e/export/e2e');
}

if (import.meta.main) await main();
