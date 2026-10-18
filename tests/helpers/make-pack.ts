// The in-memory pack of architecture §10 (`makePack(spec)`, owned by Plan 1, §11.7): the loader's own conversion over
// a synthetic export, without writing files. Tests that need real files (raw lines, gzip damage) use makeExport + loadPack.

import { buildPack, memorySource } from '../../src/server/pack/load.ts';
import type { Pack } from '../../src/shared/types/pack.ts';
import { specToFiles, type ExportSpec } from './make-export.ts';

/** `buildPack` over `spec` held in memory; the manifest's exportId is 'memory'. */
export async function makePack(spec: ExportSpec): Promise<Pack> {
  const { manifest, files, raw } = specToFiles(spec, 'memory');
  if (Object.keys(raw).length > 0) throw new Error('makePack cannot load rawLines; write the spec with makeExport and use loadPack');
  return buildPack(memorySource(manifest, files));
}
