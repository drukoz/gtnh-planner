import { describe, it, expect } from 'vitest';
import { mkdtemp, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeNeiDump, type NeiDumpRow } from '../../helpers/nei-dump.ts';
import { runCli } from '../../helpers/run-cli.ts';
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
  { name: 'NotEnoughItems:neiFluidDisplay', meta: 0, nbt: true, display: 'Water', fluid: 'water' },
  { name: 'minecraft:written_book', meta: 0, nbt: true, display: 'Book: "A", B' },
  { name: 't:weird', meta: 0, display: 'a/b:c*d' },
];

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'gp-nei-cli-'));
  const d = await writeNeiDump(join(dir, 'dumps'), ROWS_CS, { caseInsensitive: false });
  const config: AppConfig = { ...DEFAULT_CONFIG, dataDir: join(dir, 'data') };
  const lines: string[] = [];
  return { dir, d, lines, deps: { config, out: (l: string) => lines.push(l), err: (l: string) => lines.push(l) } };
}

describe('import-nei-icons CLI', () => {
  it('imports a dump and says how the file names matched', async () => {
    const { d, deps, lines } = await setup();
    expect(await main(['--csv', d.csv, '--png', d.pngDir, '--json', d.json], deps)).toBe(0);
    expect(lines).toEqual(['Imported 7 NEI icons (1 fluids) from 8 rows; skipped 1 rows with NBT; file names matched case-sensitively']);
  });

  it('shows the usage when a required flag is missing', async () => {
    const { d, deps, lines } = await setup();
    expect(await main(['--csv', d.csv], deps)).toBe(2);
    expect(lines.some((l) => l.startsWith('Usage: npm run import-nei-icons'))).toBe(true);
  });

  it('refuses a dump whose rows and PNGs do not line up', async () => {
    const { d, deps, lines } = await setup();
    await rename(join(d.pngDir, 'Granite.png'), join(d.pngDir, 'Andesite.png'));
    expect(await main(['--csv', d.csv, '--png', d.pngDir, '--json', d.json], deps)).toBe(1);
    expect(lines.join('\n')).toContain('Row 2 (minecraft:stone@1 "Granite") expects "Granite.png"');
  });

  it('runs as a script', async () => {
    const r = await runCli('import-nei-icons', ['--help'], { cwd: (await setup()).dir });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('Usage: npm run import-nei-icons');
  });
});
