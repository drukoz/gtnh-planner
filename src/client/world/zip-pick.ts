// A world zip read in the browser (spec §3.4, ruling R15): there is no zip upload, so the browser lists the zip's
// central directory itself and extracts only the entries an upload sends (or that the smart upload reads locally).
// zip.js reads the picked File through `Blob.slice`, so a ~1 GB zip is never loaded whole.

import { BlobReader, BlobWriter, ZipReader, type Entry, type FileEntry } from '@zip.js/zip.js';
import type { PickedEntry } from './pick-files.ts';

export interface ZipWorld {
  /** The zip's files in directory order; `size` is the uncompressed size. */
  entries: Array<PickedEntry & { read(): Promise<Blob> }>;
  close(): Promise<void>;
}

/** Folders hold no data, and a symbolic link's data is the path it points to, not a world file. */
function isFile(entry: Entry): entry is FileEntry {
  return !entry.directory && !entry.symlink;
}

/** Lists `file`'s entries (rejects when it is not a readable zip); each entry is extracted only when read. */
export async function openZipInBrowser(file: Blob): Promise<ZipWorld> {
  const reader = new ZipReader(new BlobReader(file));
  let all: Entry[];
  try {
    all = await reader.getEntries();
  } catch (err) {
    await reader.close().catch(() => {});
    throw err;
  }
  return {
    entries: all.filter(isFile).map((entry) => ({
      path: entry.filename,
      size: entry.uncompressedSize,
      read: () => entry.getData(new BlobWriter()),
    })),
    close: () => reader.close(),
  };
}
