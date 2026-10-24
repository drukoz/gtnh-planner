// The shared end-to-end harness (architecture §11.7; Plans 3–5 use it too): log a page's browser context in, give it a
// display name and a look, and open a new project. All of it works before the first navigation, because the request context of
// `page.context()` resolves relative URLs against `use.baseURL` and shares the browser context's cookie jar, so the
// page and its EventSource send `gp_session` (web-stack §10).

import { expect, type Page } from '@playwright/test';
import type { Plan, PlanSettings } from '../../src/shared/types/plan.ts';
import type { Project } from '../../src/shared/types/project.ts';

/** The shared password `prepare.ts` sets for the e2e server. */
export const E2E_PASSWORD = 'pw';

/** Where the client keeps the display name (src/client/state/name.ts). */
const NAME_STORAGE_KEY = 'gp.name';

/** Logs the page's whole browser context in; throws unless the server answers 204. */
export async function login(page: Page, password: string = E2E_PASSWORD): Promise<void> {
  const res = await page.context().request.post('/api/login', { data: { password } });
  if (res.status() !== 204) throw new Error(`POST /api/login answered ${res.status()}: ${await res.text()}`);
}

/** Runs in the page: stores the name, then tells the open app (if any) that it changed. */
function storeName([key, name]: [string, string]): void {
  try {
    localStorage.setItem(key, name);
    dispatchEvent(new StorageEvent('storage', { key, newValue: name }));
  } catch {
    // storage refused (an opaque origin): the client asks for the name itself
  }
}

/**
 * Gives every later document of the page's context this display name, so the name prompt never covers the page and the
 * client's ops carry `X-Planner-Name`; a page that already shows the app gets it at once.
 */
export async function setName(page: Page, name: string): Promise<void> {
  await page.context().addInitScript(storeName, [NAME_STORAGE_KEY, name] as [string, string]);
  if (page.url() !== 'about:blank') await page.evaluate(storeName, [NAME_STORAGE_KEY, name] as [string, string]);
}

/** Where the client keeps the look this browser chose (src/client/state/theme.ts). */
const THEME_STORAGE_KEY = 'gtnh-planner:theme';

/** Runs in the page before its own scripts: stores a look, as the Theme button would. */
function storeTheme([key, choice]: [string, string]): void {
  try {
    localStorage.setItem(key, choice);
  } catch {
    // storage refused (an opaque origin): the page shows Auto
  }
}

/**
 * Gives every later document of the page's context this look (Phase 2 spec §4.11): stored before the head script of index.html reads it,
 * so the page is drawn in it from its first paint, whatever the context's colorScheme.
 */
export async function setTheme(page: Page, choice: 'auto' | 'dark' | 'light'): Promise<void> {
  await page.context().addInitScript(storeTheme, [THEME_STORAGE_KEY, choice] as [string, string]);
}

/**
 * A target the e2e pack plans: 30 Basic Circuits a minute at LV. At 900 px or less a project with no target opens the settings drawer by
 * itself (the Make-picker fix), so a test on a narrow window gives its project this, unless that drawer is what it tests.
 */
export const LV_CIRCUITS: Partial<PlanSettings> = { target: 't:circuit@0', amount: 30, per: 'min', tier: 1 };

/**
 * The Settings button of a narrow window, by its name: "Settings" and then what the line makes ("Settings · Make: Basic Circuit", "Settings
 * · Make: nothing yet"); "Close settings" does not start with it.
 */
export const SETTINGS_BUTTON = /^Settings/;

/** Creates a project through the API (throws unless 201), opens its Flow tab and returns its id. */
export async function createProject(page: Page, name: string, settings?: Partial<PlanSettings>): Promise<string> {
  const res = await page.context().request.post('/api/projects', { headers: { 'X-Planner-Name': 'e2e' }, data: { name, settings } });
  if (res.status() !== 201) throw new Error(`POST /api/projects answered ${res.status()}: ${await res.text()}`);
  const { id } = (await res.json()) as Project;
  await page.goto(`/p/${id}#flow`);
  return id;
}

/**
 * Opens a new project whose plan, every time the page asks for one, is `plan` (a fixture of fixtures/plans.ts), and waits for its Flow
 * boxes; returns the project id. Its settings default to LV_CIRCUITS: a project with no target opens the drawer by itself below 900 px.
 */
export async function openWithPlan(page: Page, plan: Plan, settings: Partial<PlanSettings> = LV_CIRCUITS): Promise<string> {
  await page.route('**/api/projects/*/plan', (route) => route.fulfill({ json: plan }));
  await login(page); await setName(page, 'Ann');
  const id = await createProject(page, 'Flow focus', settings);
  await expect(page.locator('svg.flow-canvas [data-step-id]')).toHaveCount(plan.steps.length);
  return id;
}
