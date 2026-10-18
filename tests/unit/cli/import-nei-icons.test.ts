import { describe, it, expect } from 'vitest';
import { mkdtemp, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeExport } from '../../helpers/make-export.ts';
import { writeNeiDump, type NeiDumpRow } from '../../helpers/nei-dump.ts';
import { runCli } from '../../helpers/run-cli.ts';
import { sampleExportSpec } from '../../helpers/sample-export.ts';
import { main } from '../../../src/server/cli/import-nei-icons.ts';
import { DEFAULT_CONFIG, type AppConfig } from '../../../src/server/config.ts';

// The rows of tests/unit/assets/nei.test.ts with Ruling R3's row 5 ("Iron Ingot", so the case-sensitive dump can be
// written on the Mac's case-insensitive temp disk).
const ROWS_CS: NeiDumpRow[] = [
  { name: 'minecraft:stone', meta: 0, display: 'Stone' },
  { name: 'minecraft:stone', meta: 1, display: 'Granite' },
  { name: 'gregtech:gt.metaitem.01', meta: 11032, display: 'Iron Ingot' },
  { name: 't:iron_ingot', meta: 0, display: 'Iron Ingot' },
  { name: 't:iron', meta: 0, display: 'Iron Ingot' },
  { name: 'NotEnoughItems:neiFluidDisplay', meta: 0, nbt: true, display: 'Water' },
  { name: 'minecraft:written_book', meta: 0, nbt: true, display: 'Book: "A", B' },
  { name: 't:weird', meta: 0, display: 'a/b:c*d' },
];
// Ruling R17: fluid rows are matched by Display Name against the pack's fluid names.
const FLUIDS = [{ key: 'fluid:water', name: 'Water' }];
const SUCCESS = 'Imported 7 NEI icons (1 fluids) from 8 rows; skipped 1 rows with NBT; file names matched case-sensitively';

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'gp-nei-cli-'));
  const d = await writeNeiDump(join(dir, 'dumps'), ROWS_CS, { caseInsensitive: false });
  const config: AppConfig = { ...DEFAULT_CONFIG, dataDir: join(dir, 'data') };
  const lines: string[] = [];
  const io = { out: (l: string) => lines.push(l), err: (l: string) => lines.push(l) };
  return { dir, d, lines, config, io, deps: { config, fluids: FLUIDS, ...io } };
}

describe('import-nei-icons CLI', () => {
  it('imports a dump and says how the file names matched', async () => {
    const { d, deps, lines } = await setup();
    expect(await main(['--csv', d.csv, '--png', d.pngDir], deps)).toBe(0);
    expect(lines).toEqual([SUCCESS]);
  });

  it('matches fluid rows against the active export', async () => {
    const { dir, d, config, io, lines } = await setup();
    await makeExport(join(dir, 'data', 'export', 'sample'), sampleExportSpec());
    expect(await main(['--csv', d.csv, '--png', d.pngDir], { config: { ...config, activeExportId: 'sample' }, ...io })).toBe(0);
    expect(lines).toEqual([SUCCESS]);
  });

  it('skips fluid rows when there is no active export', async () => {
    const { d, config, io, lines } = await setup();
    expect(await main(['--csv', d.csv, '--png', d.pngDir], { config, ...io })).toBe(0);
    expect(lines).toEqual([
      'NEI fluid rows are skipped: No active export. Run `npm run export` first.',
      'Imported 6 NEI icons (0 fluids) from 8 rows; skipped 2 rows with NBT; file names matched case-sensitively',
    ]);
  });

  it('shows the usage when a required flag is missing or --json is given', async () => {
    const { d, deps, lines } = await setup();
    expect(await main(['--csv', d.csv], deps)).toBe(2);
    expect(lines.some((l) => l.startsWith('Usage: npm run import-nei-icons'))).toBe(true);
    lines.length = 0;
    expect(await main(['--csv', d.csv, '--png', d.pngDir, '--json', join(d.pngDir, '..', 'itempanel.json')], deps)).toBe(2);
    expect(lines.some((l) => l.startsWith('Usage: npm run import-nei-icons'))).toBe(true);
  });

  it('refuses a dump whose rows and PNGs do not line up', async () => {
    const { d, deps, lines } = await setup();
    await rename(join(d.pngDir, 'Granite.png'), join(d.pngDir, 'Andesite.png'));
    expect(await main(['--csv', d.csv, '--png', d.pngDir], deps)).toBe(1);
    expect(lines.join('\n')).toContain('Row 2 (minecraft:stone@1 "Granite") expects "Granite.png"');
  });

  it('runs as a script', async () => {
    const r = await runCli('import-nei-icons', ['--help'], { cwd: (await setup()).dir });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('Usage: npm run import-nei-icons');
  });
});
