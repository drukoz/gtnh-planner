// The loaded pack for the browser (architecture §7, §11.6, §11.43(f)): what it holds (with the materials an avoid list
// can name and the machines the "Machines we have" list can), item and fluid search, the recipes that make or use one
// item or fluid, and the names of many at once.

import type { IncomingMessage } from 'node:http';
import type { AppContext } from '../../app.ts';
import { searchPack } from '../../pack/search.ts';
import { avoidableMaterials } from '../../planner/basis.ts';
import { EXCLUSION_RULES } from '../../planner/candidates.ts';
import { HttpError, readJson, sendJson, type Route } from '../router.ts';
import { keyList } from './assets.ts';
import { recipeTier } from '../../../shared/gt/tiers.ts';
import type { PackInfo, RecipeSummary, StuffInfo } from '../../../shared/types/api.ts';
import type { Pack, Recipe } from '../../../shared/types/pack.ts';

const MAX_RECIPES_PER_SIDE = 50;
const DEFAULT_SEARCH_LIMIT = 20;
const MAX_SEARCH_LIMIT = 100;

function queryOf(req: IncomingMessage): URLSearchParams {
  const url = req.url ?? '';
  const i = url.indexOf('?');
  return new URLSearchParams(i < 0 ? '' : url.slice(i + 1));
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** `Crafting table` / `Furnace` for those sources, else the lowest-tier machine of the recipe's first map. */
function machineNameOf(pack: Pack, r: Recipe): string {
  if (r.source === 'crafting') return 'Crafting table';
  if (r.source === 'furnace') return 'Furnace';
  const map = r.maps[0];
  if (map === undefined) return 'Unknown machine';
  let lowest: { name: string; tier: number; mteId: number } | null = null;
  for (const id of pack.machinesByMap.get(map) ?? []) {
    const m = pack.machines.get(id);
    if (m === undefined) continue;
    const tier = m.tier ?? 0;
    if (lowest === null || tier < lowest.tier || (tier === lowest.tier && m.mteId < lowest.mteId)) lowest = { name: m.name, tier, mteId: m.mteId };
  }
  return lowest?.name ?? pack.maps.get(map)?.name ?? map;
}

/** A recipe as the item browser shows it: each ingredient by its first option, an ore-dictionary slot with all of them. */
export function summarizeRecipe(pack: Pack, r: Recipe): RecipeSummary {
  const summary: RecipeSummary = {
    id: r.id, source: r.source, maps: r.maps, machineName: machineNameOf(pack, r), tier: recipeTier(r.euPerTick, r.amps),
    euPerTick: r.euPerTick, durationTicks: r.durationTicks,
    inputs: r.inputs.flatMap((ing) => {
      const first = ing.options[0];
      if (first === undefined) return [];
      const input: RecipeSummary['inputs'][number] = { key: first.key, name: pack.nameOf(first.key), amount: first.amount, consumed: ing.consumed };
      if (ing.options.length > 1) input.options = ing.options.map((o) => ({ key: o.key, name: pack.nameOf(o.key), amount: o.amount }));
      return [input];
    }),
    outputs: r.outputs.map((p) => ({ key: p.key, name: pack.nameOf(p.key), amount: p.amount, chance: p.chance })),
  };
  if (r.flags.fake) summary.fake = true;
  return summary;
}

function byString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The machines the "Machines we have" list can name (`PackInfo.machines`, ruling P21): the singleblocks and multiblocks
 * that run a recipe map, the only kinds `pickMachine` puts on a step (no generator, pipe or pseudo machine), by name,
 * tier (none first) and mteId.
 */
function ownableMachines(pack: Pack): NonNullable<PackInfo['machines']> {
  return [...pack.machines.values()]
    .filter((m) => (m.kind === 'basic' || m.kind === 'multiblock') && m.maps.length > 0 && m.mteId >= 0)
    .map((m) => (m.tier === undefined ? { mteId: m.mteId, name: m.name } : { mteId: m.mteId, name: m.name, tier: m.tier }))
    .sort((a, b) => byString(a.name, b.name) || (a.tier ?? -1) - (b.tier ?? -1) || a.mteId - b.mteId);
}

function summaries(pack: Pack, indices: readonly number[] | undefined): RecipeSummary[] {
  return (indices ?? []).slice(0, MAX_RECIPES_PER_SIDE).flatMap((i) => {
    const r = pack.recipes[i];
    return r === undefined ? [] : [summarizeRecipe(pack, r)];
  });
}

export function packRoutes(app: AppContext): Route[] {
  return [
    {
      method: 'GET', path: '/api/pack',
      handler: async (_req, res) => {
        const pack = await app.pack();
        const info: PackInfo = {
          manifest: pack.manifest, mapCount: pack.maps.size, recipeCount: pack.recipes.length, itemCount: pack.items.size,
          dimensions: pack.worldgen.dimensions, capabilities: pack.worldgen.capabilities,
          exclusionRules: Object.keys(EXCLUSION_RULES), materials: [...avoidableMaterials(pack)], machines: ownableMachines(pack),
        };
        sendJson(res, 200, info);
      },
    },
    {
      method: 'GET', path: '/api/pack/search',
      handler: async (req, res) => {
        const pack = await app.pack();
        const query = queryOf(req);
        const q = query.get('q') ?? '';
        const asked = Number.parseInt(query.get('limit') ?? '', 10);
        const limit = clamp(Number.isNaN(asked) ? DEFAULT_SEARCH_LIMIT : asked, 1, MAX_SEARCH_LIMIT);
        sendJson(res, 200, q.trim() === '' ? [] : searchPack(pack, q, limit));
      },
    },
    {
      method: 'GET', path: '/api/pack/stuff/:key',
      handler: async (_req, res, params) => {
        const pack = await app.pack();
        const key = params.key!;
        if (!pack.items.has(key) && !pack.fluids.has(key)) throw new HttpError(404, 'not-found', `No item or fluid ${key} in this pack`);
        const info: StuffInfo = {
          key, name: pack.nameOf(key),
          producers: summaries(pack, pack.producers.get(key)), consumers: summaries(pack, pack.consumers.get(key)),
        };
        sendJson(res, 200, info);
      },
    },
    {
      // The Map's storage list and hover tooltip name every key this way: one request per ASSET_KEYS_MAX keys.
      method: 'POST', path: '/api/pack/names',
      handler: async (req, res) => {
        const pack = await app.pack();
        const keys = keyList(await readJson<unknown>(req), 'keys', 'keys');
        sendJson(res, 200, keys.map((key) => (pack.items.has(key) || pack.fluids.has(key) ? pack.nameOf(key) : null)));
      },
    },
  ];
}
