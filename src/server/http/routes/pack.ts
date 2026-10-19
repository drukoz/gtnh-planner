// The loaded pack for the browser (architecture §7, §11.6): what it holds (with the materials an avoid list can name),
// item and fluid search, and the recipes that make or use one item or fluid.

import type { IncomingMessage } from 'node:http';
import type { AppContext } from '../../app.ts';
import { searchPack } from '../../pack/search.ts';
import { avoidableMaterials } from '../../planner/basis.ts';
import { EXCLUSION_RULES } from '../../planner/candidates.ts';
import { HttpError, sendJson, type Route } from '../router.ts';
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

export function summarizeRecipe(pack: Pack, r: Recipe): RecipeSummary {
  const summary: RecipeSummary = {
    id: r.id, source: r.source, maps: r.maps, machineName: machineNameOf(pack, r), tier: recipeTier(r.euPerTick, r.amps),
    euPerTick: r.euPerTick, durationTicks: r.durationTicks,
    inputs: r.inputs.flatMap((ing) => {
      const first = ing.options[0];
      return first === undefined ? [] : [{ key: first.key, name: pack.nameOf(first.key), amount: first.amount, consumed: ing.consumed }];
    }),
    outputs: r.outputs.map((p) => ({ key: p.key, name: pack.nameOf(p.key), amount: p.amount, chance: p.chance })),
  };
  if (r.flags.fake) summary.fake = true;
  return summary;
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
          exclusionRules: Object.keys(EXCLUSION_RULES), materials: [...avoidableMaterials(pack)],
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
  ];
}
