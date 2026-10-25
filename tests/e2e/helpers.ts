// The shared end-to-end harness (architecture §11.7; Plans 3–5 use it too): log a page's browser context in, give it a
// display name and a look, open a new project (or one with an EnderIO line laid out on the sample world, on its Connections tab),
// hold its plan on the way (a replan's busy line), and move the views under its banners (a spacer). All of it but the last two works before
// the first navigation,
// because the request context of `page.context()` resolves relative URLs against `use.baseURL` and shares the browser context's
// cookie jar, so the page and its EventSource send `gp_session` (web-stack §10).

import { expect, type Locator, type Page, type Route } from '@playwright/test';
import type { Plan, PlanSettings } from '../../src/shared/types/plan.ts';
import type { Project } from '../../src/shared/types/project.ts';
import { uploadSampleWorld } from './world-upload.ts';

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

/**
 * Marks <html> (`data-test-tip-seen`) when the page holds a shared tip whose words contain `words` once a task's DOM changes have settled:
 * a tip drawn for a frame, or one that fades, is caught; a box inserted and taken away again before the page is painted is not (Task 3a's,
 * shared since Task 6a's fix round).
 */
export const markTips = (page: Page, words = ''): Promise<void> => page.evaluate((w) => {
  new MutationObserver(() => {
    const tip = document.querySelector('.nei-tooltip');
    if (tip !== null && (tip.textContent ?? '').includes(w)) document.documentElement.setAttribute('data-test-tip-seen', '');
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
}, words);

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

/** Opens a new project with an EnderIO line laid out on the sample world's base, on its Connections tab (connections.spec.ts). */
export async function openConnections(page: Page): Promise<Locator> {
  await login(page);
  await setName(page, 'E2E');
  const scanId = await uploadSampleWorld(page);
  const id = await createProject(page, 'Pipes conduits');
  const ops = [{ op: 'settings', patch: { target: 't:iron_plate@0', amount: 24, per: 'min', logistics: 'enderio' } }, { op: 'world', scanId, baseId: '0:0:0' }];
  expect((await page.request.post(`/api/projects/${id}/ops`, { data: { ops }, headers: { 'X-Planner-Name': 'E2E' } })).ok()).toBe(true);
  await expect.poll(async () => (await (await page.request.get(`/api/projects/${id}/layout`)).json()).status, { timeout: 30_000 }).toBe('ok');
  const view = page.getByTestId('connections');
  // the layout's warnings can still be coming in above the tabs and move them: click again until the tab shows
  await expect(async () => {
    await page.getByRole('tab', { name: 'Connections' }).click();
    await expect(view).toBeVisible({ timeout: 2_000 });
  }).toPass();
  await expect(view).toContainText('2× Basic Bending Machine');
  return view;
}

/** A hold on a page's requests for a plan (`holdPlans`). */
export interface PlanHold {
  /** Whether a request came while held. */
  asked(): boolean;
  /** Lets every held request through (each goes on, as if never held: to the server, or to an earlier route), then takes the hold down. */
  release(): Promise<void>;
}

/**
 * Holds every request the page makes for the plan of project `id`, or of any project when no `id` is given, until `release`, so a test can see
 * the page while its plan is on its way (Phase 2 Task 7's fix rounds: the strip's place, a unit's or an amount's change; Task 8's skeletons).
 * A request that comes after `release` goes straight on.
 */
export async function holdPlans(page: Page, id?: string): Promise<PlanHold> {
  let open = (): void => {};
  const held = new Promise<void>((resolve) => {
    open = resolve;
  });
  let asked = false;
  const passing: Promise<void>[] = [];
  const plans = (url: URL): boolean =>
    (id === undefined ? /^\/api\/projects\/[^/]+\/plan$/.test(url.pathname) : url.pathname === `/api/projects/${id}/plan`);
  const hold = async (route: Route): Promise<void> => {
    asked = true;
    const passed = held.then(() => route.fallback());
    passing.push(passed);
    await passed;
  };
  await page.route(plans, hold);
  return {
    asked: () => asked,
    release: async () => {
      open();
      await Promise.all(passing);
      await page.unroute(plans, hold);
    },
  };
}

/**
 * Shows "Updating the plan…" on project `id`'s page, and keeps it there until the returned function is called (ledger ruling P2-R16). The page
 * hears a `plan` event whenever the server replans the project (anyone's change to it) or another project's summary changes what it reads, and
 * shows that line until it has fetched the plan again. It once moved every view under the banner down the page while it showed (24.3 px under
 * the banner's other lines, a whole banner's height alone); since ledger ruling P2-R18 it hangs over the end of the tab strip and moves nothing.
 * Here the server replans the project with its own settings (a settings op that changes nothing), and the page's fetches of its plan wait
 * (`holdPlans`). Resolves once the page has asked and the line shows; the function lets the plan through, which comes back the same (from the
 * server, or from an earlier route such as `openWithPlan`'s), takes the hold down, so no later fetch goes through it, and resolves once the line
 * has gone again.
 */
export async function holdReplan(page: Page, id: string): Promise<() => Promise<void>> {
  const hold = await holdPlans(page, id);
  const res = await page.request.post(`/api/projects/${id}/ops`, { data: { ops: [{ op: 'settings', patch: {} }] }, headers: { 'X-Planner-Name': 'e2e' } });
  if (!res.ok()) throw new Error(`POST /api/projects/${id}/ops answered ${res.status()}: ${await res.text()}`);
  await expect.poll(() => hold.asked(), { message: 'the page asks for the plan again' }).toBe(true);
  const busy = page.getByText('Updating the plan…');
  await expect(busy).toBeVisible();
  return async () => {
    await hold.release();
    await expect(busy).toHaveCount(0);
  };
}

/**
 * Moves every view under the banners `px` down the page until the returned function takes it back up (ledger rulings P2-R16, P2-R18): a
 * spacer above `.project-banners` that none of the page's own markup draws. It is the layout shift a test makes while the pointer is down, as
 * anything that changes height above the tabs makes one (a plan event's busy line did, until P2-R18), without depending on what the page draws.
 */
export async function shiftViews(page: Page, px: number): Promise<() => Promise<void>> {
  await page.evaluate((height) => {
    const spacer = document.createElement('div');
    spacer.setAttribute('data-test-shift', '');
    spacer.style.height = `${height}px`;
    document.querySelector('.project-banners')!.before(spacer);
  }, px);
  return async () => {
    await page.evaluate(() => document.querySelector('[data-test-shift]')?.remove());
  };
}
