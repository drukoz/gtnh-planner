import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { settingsHash as serverHash } from '../../../src/server/planner/basis.ts';
import { settingsHash, sha1Hex } from '../../../src/shared/project/settings-hash.ts';
import { defaultSettings } from '../../../src/shared/project/apply-op.ts';
import type { PlanSettings } from '../../../src/shared/types/plan.ts';

it('is SHA-1 as node:crypto computes it, across block edges and in UTF-8', () => {
  const texts = ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(63), 'a'.repeat(64), 'a'.repeat(119), 'b'.repeat(1000),
    'Molten Lötzinn — 鉛 🔥', '{"avoid":["Silver"],"recipeChoice":{"gregtech:gt.metaitem.01@32702":"c0106c4cb6b4b041"}}'];
  for (const text of texts) expect(sha1Hex(text), JSON.stringify(text)).toBe(createHash('sha1').update(text).digest('hex'));
});

it("hashes settings as the server does, so the client knows a plan of the settings it shows", () => {
  const S = (p: Partial<PlanSettings>): PlanSettings => ({ ...defaultSettings(), ...p });
  const all: PlanSettings[] = [
    defaultSettings(),
    S({ target: 'IC2:itemPartCircuit@0', tier: 2, amount: 3, per: 'hour' }),
    S({ avoid: ['Silver', 'gregtech:gt.metaitem.01@11057'] }),
    S({ recipeChoice: { 't:h_cell@0': 'water', 'fluid:oxygen': 'electrolyze' }, optionChoice: { 'ca#100': 'fluid:molten.tin' } }),
    S({ dims: { policy: 'progression', overrides: { moon: 'on', nether: 'off' } }, costOverrides: { 'Molten Lötzinn': 2.5 }, coilHeat: 2701 }),
  ];
  for (const s of all) expect(settingsHash(s), JSON.stringify(s)).toBe(serverHash(s));
  // Key order plays no part, and an empty avoid list hashes as none (a project stored before the list existed).
  const { avoid: _avoid, ...old } = defaultSettings();
  expect(settingsHash(old as PlanSettings)).toBe(settingsHash(defaultSettings()));
  expect(settingsHash(Object.fromEntries(Object.entries(all[1]!).reverse()) as unknown as PlanSettings)).toBe(settingsHash(all[1]!));
  expect(settingsHash(S({ recipeChoice: { 't:h_cell@0': 'water' } }))).not.toBe(settingsHash(defaultSettings()));
});
