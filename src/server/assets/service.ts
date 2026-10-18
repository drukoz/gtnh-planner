// The loaded asset sources behind `/api/assets/*` (spec §3.8): the extracted-file index, the active export's texture
// dump and the NEI icon import, each reloaded when its file changes, so `npm run extract-assets`, `npm run export` and
// `npm run import-nei-icons` take effect without a server restart. Nothing is read until the first request.

import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { AppContext } from '../app.ts';
import { activeExportDir } from '../config.ts';
import type { StuffKey } from '../../shared/keys.ts';
import type { BlockFaces, CoverLayers, IconDescriptor } from '../../shared/types/assets.ts';
import type { BlockRef } from '../../shared/types/pack.ts';
import { emptyAssetIndex, INDEX_FILE, loadAssetIndex, type AssetIndex } from './index.ts';
import { loadNeiIndex, type NeiIndex } from './nei.ts';
import { resolveBlocks, resolveCovers, resolveIcons, type AssetSources, type PackView } from './resolve.ts';
import { loadTexturesDump, TEXTURES_FILE, type TexturesDump } from './textures-dump.ts';

export interface AssetServiceOptions {
  dataDir: string;
  /** The active export's folder, or null when there is none. */
  exportDir: () => string | null;
  /** The active pack (fallback colours), or null when none is loaded. */
  pack: () => Promise<PackView | null>;
  /** How often the files are checked for changes (1000). */
  checkEveryMs?: number;
  /** Where a failed reload is reported (console.warn). */
  log?: (line: string) => void;
}

const NEI_INDEX = join('nei', 'index.json');   // as src/server/assets/nei.ts writes it

/** A file's change signature: `mtimeMs:size`, `missing`, or the stat error code. */
async function signatureOf(file: string): Promise<string> {
  try {
    const st = await stat(file);
    return `${st.mtimeMs}:${st.size}`;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | null)?.code;
    return code === 'ENOENT' ? 'missing' : `error:${code ?? 'unknown'}`;
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class AssetService {
  /** `<dataDir>/assets`. */
  readonly assetsDir: string;
  private readonly exportDir: () => string | null;
  private readonly pack: () => Promise<PackView | null>;
  private readonly checkEveryMs: number;
  private readonly log: (line: string) => void;

  // Each part keeps the signature it last tried to load (failed loads included, so they are not retried or logged
  // again until the file changes) and the value of its last successful load.
  private indexSig: string | null = null;
  private index: AssetIndex = emptyAssetIndex();
  private dumpSig: string | null = null;
  private dump: TexturesDump | null = null;
  private neiSig: string | null = null;
  private nei: NeiIndex | null = null;

  private current: AssetSources | null = null;
  private checkedAt = 0;
  private checking: Promise<AssetSources> | null = null;

  constructor(opts: AssetServiceOptions) {
    this.assetsDir = join(opts.dataDir, 'assets');
    this.exportDir = opts.exportDir;
    this.pack = opts.pack;
    this.checkEveryMs = opts.checkEveryMs ?? 1000;
    this.log = opts.log ?? ((line) => console.warn(line));
  }

  /**
   * The current sources. At most once per `checkEveryMs` the index, the dump (and the export folder it is in) and the
   * NEI index are checked and what changed is reloaded; callers that arrive during a check share it.
   */
  sources(): Promise<AssetSources> {
    if (this.checking !== null) return this.checking;
    const now = Date.now();
    if (this.current !== null && now - this.checkedAt < this.checkEveryMs) return Promise.resolve(this.current);
    this.checkedAt = now;
    const check = this.check().finally(() => {
      if (this.checking === check) this.checking = null;
    });
    this.checking = check;
    return check;
  }

  async icons(keys: readonly StuffKey[]): Promise<IconDescriptor[]> {
    return resolveIcons(await this.sources(), keys);
  }

  async blocks(refs: readonly BlockRef[], facing?: number): Promise<BlockFaces[]> {
    return resolveBlocks(await this.sources(), refs, facing);
  }

  async covers(items: readonly StuffKey[]): Promise<CoverLayers[]> {
    return resolveCovers(await this.sources(), items);
  }

  private async check(): Promise<AssetSources> {
    const exportDir = this.exportDir();
    const [indexSig, dumpFileSig, neiSig, pack] = await Promise.all([
      signatureOf(join(this.assetsDir, INDEX_FILE)),
      exportDir === null ? Promise.resolve('') : signatureOf(join(exportDir, TEXTURES_FILE)),
      signatureOf(join(this.assetsDir, NEI_INDEX)),
      this.pack(),
    ]);
    const dumpSig = exportDir === null ? 'no-export' : `${exportDir}\n${dumpFileSig}`;

    let newIndex = false;
    if (indexSig !== this.indexSig) {
      this.indexSig = indexSig;
      try {
        this.index = await loadAssetIndex(this.assetsDir);
        newIndex = true;
      } catch (err) {
        this.log(`Assets: keeping the previous asset index: ${messageOf(err)}`);
      }
    }
    // The dump's layers are resolved against the index, so a new index rebuilds it too.
    if (dumpSig !== this.dumpSig || newIndex) {
      this.dumpSig = dumpSig;
      try {
        this.dump = exportDir === null ? null : await loadTexturesDump(exportDir, this.index);
      } catch (err) {
        this.log(`Assets: keeping the previous texture dump: ${messageOf(err)}`);
      }
    }
    if (neiSig !== this.neiSig) {
      this.neiSig = neiSig;
      try {
        this.nei = await loadNeiIndex(this.assetsDir);
      } catch (err) {
        this.log(`Assets: keeping the previous NEI icons: ${messageOf(err)}`);
      }
    }

    this.current = { index: this.index, dump: this.dump, nei: this.nei, pack };
    return this.current;
  }
}

/** The app's one asset service, kept in `app.services.assets` (created on first use). */
export function assetService(app: AppContext): AssetService {
  const existing = app.services.assets;
  if (existing instanceof AssetService) return existing;
  const service = new AssetService({
    dataDir: app.config.dataDir,
    exportDir: () => {
      try {
        return activeExportDir(app.config);
      } catch {
        return null;
      }
    },
    // Assets work before any export: no pack (503 no-export) or a failed load only loses the fallback colours.
    pack: () => app.pack().then((pack) => pack, () => null),
  });
  app.services.assets = service;
  return service;
}
