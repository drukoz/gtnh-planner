export * from '../../shared/world/level-dat.ts';

// Server side of the shared level.dat reader: the file as it is on disk (gzip'd).

import { levelInfoFromNbt, type LevelInfo } from '../../shared/world/level-dat.ts';
import { readGzipNbt } from './nbt.ts';

export function readLevelDat(buf: Uint8Array): LevelInfo {
  return levelInfoFromNbt(readGzipNbt(buf));
}
