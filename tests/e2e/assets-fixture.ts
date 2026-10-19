// Synthetic textures for the end-to-end server (spec §3.12: nothing game-made): Task 8's GT sample files plus one plain
// mod texture for the Mini-GT iron ingot, extracted into `<dataDir>/assets`, and the matching `textures.json.gz` in the
// export folder. prepare.ts calls it after the export and config exist, all under the gitignored data/e2e.

import { writeAssetsDir } from '../helpers/assets-dir.ts';
import { GT_SAMPLE_ASSETS, gtSampleFile } from '../helpers/gt-sample.ts';
import { writeTexturesDump } from '../helpers/textures-dump.ts';

/** The iron ingot's texture colour, which the search result's icon shows at its centre pixel. */
export const E2E_INGOT_RGBA: [number, number, number, number] = [200, 60, 60, 255];

/** Writes `<dataDir>/assets` and `<exportDir>/textures.json.gz`: the item `t:iron_ingot` draws `t:iron_ingot`'s texture. */
export async function prepareAssets(dataDir: string, exportDir: string): Promise<void> {
  await writeAssetsDir(dataDir, { ...GT_SAMPLE_ASSETS, 't/textures/items/iron_ingot.png': { color: E2E_INGOT_RGBA } });
  await writeTexturesDump(exportDir, { ...gtSampleFile(), textureNames: { blocks: {}, items: { 't:iron_ingot': 't:iron_ingot' } } });
}
