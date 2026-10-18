import { describe, expect, it } from 'vitest';
import { claimHints, dimSummaries, LOCATION_QUESTS, playerHints, questVisits, visitedKeys } from '../../../src/server/world/dims.ts';
import type { ChunkStat } from '../../../src/server/world/model.ts';
import { comp, int, list, parseTag } from '../../helpers/nbt-write.ts';
import { testFacts } from '../../helpers/world-facts.ts';

const stat = (dim: number, cx: number, cz: number, inhabitedTime: number): ChunkStat =>
  ({ dim, cx, cz, inhabitedTime, timestamp: 0, teCount: 0, oreTes: 0 });

describe('dimSummaries and visitedKeys', () => {
  it('judges visits by InhabitedTime, players, quests and prospecting — never by region files alone', () => {
    const chunks = [stat(0, 0, 0, 500), stat(7, 0, 0, 0), stat(7, 1, 0, 0), stat(7, 2, 0, 0), stat(-1, 0, 0, 0)];
    const hints = [{ dim: -1, why: 'player location' }, { dim: 28, why: 'quest: Moon Arrival' }, { dim: 64, why: 'team prospecting' }, { dim: 64, why: 'team prospecting' }];
    const s = dimSummaries(chunks, hints, testFacts().dimensions);
    expect(s.map((d) => [d.dim, d.keys, d.chunks, d.inhabitedChunks, d.visited, d.visitEvidence])).toEqual([
      [-1, ['nether'], 1, 0, true, ['player location']], [0, ['overworld'], 1, 1, true, ['inhabited chunks: 1']],
      [7, ['twilightforest'], 3, 0, false, []], [28, ['moon'], 0, 0, true, ['quest: Moon Arrival']],
      [64, ['ross128b'], 0, 0, true, ['team prospecting (×2)']]]);
    expect(visitedKeys(s)).toEqual(['nether', 'overworld', 'moon', 'ross128b']);
  });

  it('a visited DIM 1 marks both End keys', () => expect(visitedKeys(dimSummaries([stat(1, 0, 0, 5)], [], testFacts().dimensions))).toEqual(['theend', 'endasteroid']));

  it('names dimensions from the pack, else Overworld or DIM<id>, and lists evidence in first-seen order', () => {
    const hints = [{ dim: 99, why: 'portal use' }, { dim: 0, why: 'player location' }, { dim: 0, why: 'bed spawn' }, { dim: 0, why: 'player location' }];
    const chunks = [stat(0, 0, 0, 1), stat(0, 1, 0, 2), stat(0, 2, 0, 0), stat(1, 0, 0, 0)];
    const s = dimSummaries(chunks, hints, testFacts().dimensions);
    expect(s.map((d) => [d.dim, d.name, d.keys, d.chunks, d.inhabitedChunks, d.visited, d.visitEvidence])).toEqual([
      [0, 'Overworld', ['overworld'], 3, 2, true, ['inhabited chunks: 2', 'player location (×2)', 'bed spawn']],
      [1, 'The End', ['theend', 'endasteroid'], 1, 0, false, []],
      [99, 'DIM99', [], 0, 0, true, ['portal use']]]);
    expect(dimSummaries([stat(0, 0, 0, 0)], [], [])).toEqual([{ dim: 0, keys: [], name: 'Overworld', chunks: 1, inhabitedChunks: 0, visited: false, visitEvidence: [] }]);
    expect(visitedKeys(s)).toEqual(['overworld']);
  });
});

describe('playerHints', () => {
  it('reads player location, bed spawns and portal use', () => {
    const p = parseTag(comp({ Dimension: int(-1), Spawns: list('compound', [comp({ Dim: int(7), SpawnX: int(5), SpawnY: int(70), SpawnZ: int(-9) })]),
      ForgeData: comp({ PlayerPersisted: comp({ ReturnPortals: list('compound', [comp({ FromDim: int(0), ToDim: int(-1) })]) }) }) }));
    expect(playerHints(p)).toEqual({ visits: [{ dim: -1, why: 'player location' }, { dim: 7, why: 'bed spawn' }, { dim: 0, why: 'portal use' }, { dim: -1, why: 'portal use' }],
      beds: [{ dim: 7, x: 5, z: -9 }] });
  });

  it('reads the Overworld bed from the root SpawnX/SpawnZ, where Forge keeps it', () => {
    const p = parseTag(comp({ Dimension: int(0), SpawnX: int(-20), SpawnY: int(64), SpawnZ: int(33),
      Spawns: list('compound', [comp({ Dim: int(-1), SpawnX: int(1), SpawnY: int(70), SpawnZ: int(2) })]) }));
    expect(playerHints(p)).toEqual({ visits: [{ dim: 0, why: 'player location' }, { dim: 0, why: 'bed spawn' }, { dim: -1, why: 'bed spawn' }],
      beds: [{ dim: 0, x: -20, z: 33 }, { dim: -1, x: 1, z: 2 }] });
  });

  it('gives nothing for a player file without those fields, and skips incomplete entries', () => {
    expect(playerHints({})).toEqual({ visits: [], beds: [] });
    const p = parseTag(comp({ Spawns: list('compound', [comp({ SpawnX: int(1), SpawnZ: int(2) }), comp({ Dim: int(7) })]),
      ForgeData: comp({ PlayerPersisted: comp({ ReturnPortals: list('compound', [comp({ ToDim: int(-1) })]) }) }) }));
    expect(playerHints(p)).toEqual({ visits: [{ dim: 7, why: 'bed spawn' }, { dim: -1, why: 'portal use' }], beds: [] });
  });
});

describe('questVisits', () => {
  it('knows the six location quests', () => {
    expect(Object.entries(LOCATION_QUESTS).map(([id, q]) => [Number(id), q.dim])).toEqual([[225, 7], [479, -1], [986, 1], [1072, 28], [2311, 64], [2634, 227]]);
  });

  it('counts only completed location quests', () => {
    const progress = { 'questProgress:9': {
      '0:10': { 'questIDHigh:4': 0, 'questIDLow:4': 1072, 'completed:9': { '0:10': { 'uuid:8': 'x', 'timestamp:4': 1 } } },
      '1:10': { 'questIDHigh:4': 0, 'questIDLow:4': 479, 'completed:9': {} },
      '2:10': { 'questIDHigh:4': 0, 'questIDLow:4': 88, 'completed:9': [{ 'uuid:8': 'x' }] } } };
    expect(questVisits(progress)).toEqual([{ dim: 28, why: 'quest: Moon Arrival' }]);
  });

  it('reads array lists, ignores quests with another questIDHigh and anything that is not progress JSON', () => {
    const progress = { 'questProgress:9': [
      { 'questIDHigh:4': 0, 'questIDLow:4': 479, 'completed:9': [{ 'uuid:8': 'x' }] },
      { 'questIDHigh:4': 7, 'questIDLow:4': 1072, 'completed:9': [{ 'uuid:8': 'x' }] },
      { 'questIDHigh:4': 0, 'questIDLow:4': 2311, 'completed:9': [] },
      { 'questIDHigh:4': 0, 'questIDLow:4': 2634 },
      null, 'junk'] };
    expect(questVisits(progress)).toEqual([{ dim: -1, why: 'quest: THE NETHER' }]);
    expect([questVisits(null), questVisits('x'), questVisits([]), questVisits({ 'questProgress:9': 5 })]).toEqual([[], [], [], []]);
  });
});

describe('claimHints', () => {
  it('lists every claimed chunk with its team and dimension', () => {
    const claims = parseTag(comp({ ClaimedChunks: comp({
      '0': list('compound', [comp({ x: int(1), z: int(-2) }), comp({ x: int(3), z: int(4) })]),
      '-1': list('compound', [comp({ x: int(-5), z: int(6) }), comp({ z: int(1) })]),
      junk: list('compound', [comp({ x: int(9), z: int(9) })]) }) }));
    expect(claimHints('Alpha', claims)).toEqual([{ team: 'Alpha', dim: 0, cx: 1, cz: -2 }, { team: 'Alpha', dim: 0, cx: 3, cz: 4 },
      { team: 'Alpha', dim: -1, cx: -5, cz: 6 }]);
    expect(claimHints('Alpha', {})).toEqual([]);
  });
});
