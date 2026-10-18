// Synthetic jars (zip files) for the asset tests: every entry deflated (method 8) with `node:zlib`, local headers,
// central directory and end record written by hand, so no zip library is needed (Global Constraints).

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';

/** Entry name → content; a string is written as UTF-8. */
export type JarEntries = Record<string, Uint8Array | string>;

const UTF8_NAMES = 0x0800;   // general purpose flag bit 11: the entry name is UTF-8
const DOS_DATE_1980_01_01 = (0 << 9) | (1 << 5) | 1;

/**
 * The bytes of a jar holding `entries` in the given order. Entries named in `opts.corrupt` keep their CRC-32 and
 * sizes but get their compressed bytes replaced by as many `0xff` bytes, so inflating them fails while the central
 * directory stays valid.
 */
export function jarBytes(entries: JarEntries, opts: { corrupt?: string[] } = {}): Buffer {
  const corrupt = new Set(opts.corrupt ?? []);
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const fileName = Buffer.from(name, 'utf8');
    const data = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
    const crc = crc32(data);
    let packed = deflateRawSync(data);
    if (corrupt.has(name)) packed = Buffer.alloc(packed.length, 0xff);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);                    // version needed to extract
    local.writeUInt16LE(UTF8_NAMES, 6);
    local.writeUInt16LE(8, 8);                     // deflate
    local.writeUInt16LE(0, 10);                    // time
    local.writeUInt16LE(DOS_DATE_1980_01_01, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(fileName.length, 26);
    local.writeUInt16LE(0, 28);                    // extra field length

    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);                   // version made by
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(UTF8_NAMES, 8);
    header.writeUInt16LE(8, 10);
    header.writeUInt16LE(0, 12);
    header.writeUInt16LE(DOS_DATE_1980_01_01, 14);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(packed.length, 20);
    header.writeUInt32LE(data.length, 24);
    header.writeUInt16LE(fileName.length, 28);
    // 30 extra length, 32 comment length, 34 disk, 36 internal and 38 external attributes stay 0
    header.writeUInt32LE(offset, 42);

    parts.push(local, fileName, packed);
    central.push(header, fileName);
    offset += local.length + fileName.length + packed.length;
  }
  const directory = Buffer.concat(central);
  const count = Object.keys(entries).length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(count, 8);                     // records on this disk
  end.writeUInt16LE(count, 10);                    // records in total
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, end]);
}

/** Writes `jarBytes(entries, opts)` to `file`, creating its folder if needed, and returns `file`. */
export async function makeJar(file: string, entries: JarEntries, opts: { corrupt?: string[] } = {}): Promise<string> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, jarBytes(entries, opts));
  return file;
}
