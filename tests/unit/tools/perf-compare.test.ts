import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { compareRuns } from '../../../tools/perf/compare.ts';

let root = '';
let referenceDir = '';
let runDir = '';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'perf-'));
  referenceDir = join(root, 'reference');
  runDir = join(root, 'run');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Writes `<file>` (`<pass>/<name>`) under `dir`, making the pass folder. */
function write(dir: string, file: string, text: string): void {
  const path = join(dir, file);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
}

it('identical folders compare clean', () => {
  for (const [pass, files] of [['cold', ['plan-a.json', 'layout-a.json']], ['warm1', ['plan-a.json', 'plan-b.json']]] as const) {
    for (const name of files) {
      write(referenceDir, `${pass}/${name}`, `{"pass":"${pass}","name":"${name}"}`);
      write(runDir, `${pass}/${name}`, `{"pass":"${pass}","name":"${name}"}`);
    }
  }
  expect(compareRuns(referenceDir, runDir)).toEqual({ compared: 4, missing: [], differing: [], skippedPasses: [] });
});

it('a differing byte is found at its offset', () => {
  write(referenceDir, 'cold/plan-a.json', 'aaaaaaaa');
  write(runDir, 'cold/plan-a.json', 'aaaaaaab');
  const found = compareRuns(referenceDir, runDir);
  expect(found.compared).toBe(1);
  expect(found.missing).toEqual([]);
  expect(found.skippedPasses).toEqual([]);
  expect(found.differing).toEqual([{ file: 'cold/plan-a.json', offset: 7, reference: 'a', run: 'b' }]);
});

it('a file the run lacks is missing', () => {
  write(referenceDir, 'cold/plan-a.json', '{}');
  write(referenceDir, 'cold/layout-a.json', '{}');
  write(runDir, 'cold/plan-a.json', '{}');
  const found = compareRuns(referenceDir, runDir);
  expect(found.compared).toBe(2);
  expect(found.missing).toEqual(['cold/layout-a.json']);
  expect(found.differing).toEqual([]);
  expect(found.skippedPasses).toEqual([]);
});

it('a pass the run did not make is skipped', () => {
  write(referenceDir, 'cold/plan-a.json', '{}');
  write(referenceDir, 'restart/plan-a.json', '{}');
  write(referenceDir, 'restart/layout-a.json', '{}');
  write(runDir, 'cold/plan-a.json', '{}');
  const found = compareRuns(referenceDir, runDir);
  expect(found.compared).toBe(1);
  expect(found.skippedPasses).toEqual(['restart']);
  expect(found.missing).toEqual([]);
  expect(found.differing).toEqual([]);
});

it('files only the run has are ignored', () => {
  write(referenceDir, 'cold/plan-a.json', '{}');
  write(runDir, 'cold/plan-a.json', '{}');
  write(runDir, 'cold/plan-b.json', '{}');
  write(runDir, 'restart/plan-a.json', '{}');
  expect(compareRuns(referenceDir, runDir)).toEqual({ compared: 1, missing: [], differing: [], skippedPasses: [] });
});

it('a run file that is a prefix of the reference differs at its end', () => {
  write(referenceDir, 'warm1/plan-a.json', 'abcdefghij');
  write(runDir, 'warm1/plan-a.json', 'abcdef');
  const found = compareRuns(referenceDir, runDir);
  expect(found.differing).toEqual([{ file: 'warm1/plan-a.json', offset: 6, reference: 'ghij', run: '' }]);
});
