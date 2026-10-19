// Writes zip files for tests the way ServerUtilities backups are laid out (world-format §1.1): every entry deflated
// (method 8), local headers, then the central directory and its end record. Built on node:zlib only, independent of
// the zip reader under test.

import { mkdir, utimes, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';

export interface ZipEntrySpec { name: string; data: Uint8Array }

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIR = 0x06054b50;
const VERSION = 20;
const UTF8_NAMES = 0x0800;
const DEFLATE = 8;
// 2026-10-17 12:00:00 in MS-DOS date and time fields.
const DOS_DATE = ((2026 - 1980) << 9) | (10 << 5) | 17;
const DOS_TIME = 12 << 11;

/** A complete zip holding `entries` in order. */
export function zipBuffer(entries: ZipEntrySpec[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = deflateRawSync(entry.data);
    const crc = crc32(entry.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_HEADER, 0);
    local.writeUInt16LE(VERSION, 4);
    local.writeUInt16LE(UTF8_NAMES, 6);
    local.writeUInt16LE(DEFLATE, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(CENTRAL_HEADER, 0);
    header.writeUInt16LE(VERSION, 4);
    header.writeUInt16LE(VERSION, 6);
    header.writeUInt16LE(UTF8_NAMES, 8);
    header.writeUInt16LE(DEFLATE, 10);
    header.writeUInt16LE(DOS_TIME, 12);
    header.writeUInt16LE(DOS_DATE, 14);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(data.length, 20);
    header.writeUInt32LE(entry.data.length, 24);
    header.writeUInt16LE(name.length, 28);
    // extra length, comment length, disk number, internal and external attributes stay 0
    header.writeUInt32LE(offset, 42);

    parts.push(local, name, data);
    central.push(header, name);
    offset += local.length + name.length + data.length;
  }
  const centralDir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_OF_CENTRAL_DIR, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, centralDir, end]);
}

/**
 * Writes `zipBuffer(entries)` to `path` (creating its folder). `truncateBytes` cuts that many bytes off the end, as a
 * backup still being written would look; `mtime` sets the file's modification (and access) time.
 */
export async function writeZip(path: string, entries: ZipEntrySpec[], opts: { truncateBytes?: number; mtime?: Date } = {}): Promise<void> {
  const bytes = zipBuffer(entries);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, opts.truncateBytes === undefined ? bytes : bytes.subarray(0, Math.max(0, bytes.length - opts.truncateBytes)));
  if (opts.mtime !== undefined) await utimes(path, opts.mtime, opts.mtime);
}
