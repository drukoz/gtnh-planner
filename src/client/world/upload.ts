// Sends picked world files as one upload and starts its scan (spec §3.4, §6; architecture §6.6): level.dat first, then
// the rest two at a time, then "complete". Everything the server would refuse is refused here first, before a single
// byte is sent: a path outside the allow-list, a missing level.dat, a file or an upload over UPLOAD_LIMITS.

import { UPLOAD_LIMITS } from '../../shared/types/world-api.ts';
import { messageOf } from '../api/client.ts';
import type { worldApi } from '../map/api.ts';
import { uploadRel } from './pick-files.ts';

export interface UploadItem { rel: string /* world-relative */; size: number; blob: () => Promise<Blob> }
/** `current` is the file most recently started. */
export interface UploadProgress { done: number; total: number; bytesDone: number; bytesTotal: number; current: string }
type UploadApi = Pick<typeof worldApi, 'createUpload' | 'putFile' | 'completeUpload'>;

const LEVEL_DAT = 'level.dat';
const IN_FLIGHT = 2;
const MiB = 1024 ** 2;

const count = (n: number): string => n.toLocaleString('en-US');
const limitText = (bytes: number): string => (bytes >= 1024 * MiB ? `${bytes / (1024 * MiB)} GiB` : `${bytes / MiB} MiB`);

function abortError(): DOMException {
  return new DOMException('The upload was stopped', 'AbortError');
}

/** Throws, naming the file, when the server would refuse the upload. */
function checkItems(items: readonly UploadItem[]): void {
  if (!items.some((i) => i.rel === LEVEL_DAT)) throw new Error('The upload needs level.dat, which names the world and its blocks');
  for (const { rel, size } of items) {
    if (uploadRel(rel) !== rel) throw new Error(`${rel} cannot be uploaded: only level.dat and region files are sent`);
    const [limit, what] = rel === LEVEL_DAT ? [UPLOAD_LIMITS.levelDat, 'level.dat'] : [UPLOAD_LIMITS.region, 'a region file'];
    if (size > limit) throw new Error(`${rel} is larger than ${limitText(limit)}, the most the server takes for ${what}`);
  }
  if (items.length > UPLOAD_LIMITS.files) {
    throw new Error(`The upload would have ${count(items.length)} files; the server takes at most ${count(UPLOAD_LIMITS.files)}`);
  }
  if (items.reduce((n, i) => n + i.size, 0) > UPLOAD_LIMITS.total) {
    throw new Error(`The upload would be larger than ${limitText(UPLOAD_LIMITS.total)}, the most the server takes`);
  }
}

/** `work`, or an AbortError as soon as `signal` aborts (what is in flight then finishes unseen). */
function untilAborted<T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) return work;
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/**
 * Uploads `items` and answers the scan id of the completed upload. Rejects before sending anything when the server
 * would refuse the upload; with an AbortError when `signal` aborts (no file is started after that and the upload is
 * not completed); with "<rel>: <reason>" when a file cannot be read or stored (no file is started after that).
 */
export async function uploadWorld(items: UploadItem[], api: UploadApi, onProgress: (p: UploadProgress) => void, signal?: AbortSignal): Promise<string> {
  checkItems(items);
  if (signal?.aborted === true) throw abortError();
  const level = items.find((i) => i.rel === LEVEL_DAT)!;
  const rest = items.filter((i) => i !== level);
  const progress: UploadProgress = { done: 0, total: items.length, bytesDone: 0, bytesTotal: items.reduce((n, i) => n + i.size, 0), current: '' };
  let failed = false;
  const halted = (): boolean => failed || signal?.aborted === true;
  const report = (): void => {
    if (!halted()) onProgress({ ...progress });
  };

  const send = async (uploadId: string, item: UploadItem): Promise<void> => {
    progress.current = item.rel;
    report();
    try {
      await api.putFile(uploadId, item.rel, await item.blob());
    } catch (err) {
      failed = true;
      throw new Error(`${item.rel}: ${messageOf(err)}`, { cause: err });
    }
    progress.done += 1;
    progress.bytesDone += item.size;
    report();
  };

  const run = async (): Promise<string> => {
    const uploadId = await api.createUpload();
    if (halted()) throw abortError();
    await send(uploadId, level);   // the scan needs it, and the server completes no upload without it
    let next = 0;
    const lane = async (): Promise<void> => {
      while (!halted() && next < rest.length) await send(uploadId, rest[next++]!);
    };
    await Promise.all(Array.from({ length: IN_FLIGHT }, lane));
    if (halted()) throw abortError();
    return api.completeUpload(uploadId);
  };
  return untilAborted(run(), signal);
}
