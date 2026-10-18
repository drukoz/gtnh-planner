// A minimal server-sent-events reader for tests: it reads the `fetch` body stream, parses `event:`/`id:`/`data:` frames
// (comments such as `: hb` and the `retry:` frame dispatch nothing) and queues every event until a `next` takes it.

export interface SseEvent { event: string; id?: string; data: unknown; receivedAt: number }

export interface SseClient {
  /** The oldest event named `event` not yet taken (events of other names stay queued); rejects after `timeoutMs` (2000). */
  next(event: string, timeoutMs?: number): Promise<SseEvent>;
  close(): void;
}

interface Waiter { event: string; resolve(e: SseEvent): void; reject(err: Error): void; timer: NodeJS.Timeout }

const DEFAULT_TIMEOUT_MS = 2000;

/** One frame's fields; null when it dispatches nothing (no `data:` line). JSON data is parsed, anything else kept as text. */
function parseFrame(text: string, receivedAt: number): SseEvent | null {
  let event = 'message';
  let id: string | undefined;
  const data: string[] = [];
  for (const line of text.split('\n')) {
    if (line === '' || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    else if (field === 'id') id = value;
    else if (field === 'data') data.push(value);
  }
  if (data.length === 0) return null;
  const raw = data.join('\n');
  let parsed: unknown = raw;
  try {
    parsed = JSON.parse(raw);
  } catch { /* not JSON: keep the text */ }
  const e: SseEvent = { event, data: parsed, receivedAt };
  if (id !== undefined) e.id = id;
  return e;
}

/** Opens `url` with the session `cookie`; rejects when the server answers anything but 200. */
export async function openSse(url: string, cookie: string): Promise<SseClient> {
  const abort = new AbortController();
  const res = await fetch(url, { headers: { cookie, accept: 'text/event-stream' }, signal: abort.signal });
  if (res.status !== 200 || res.body === null) {
    abort.abort();
    throw new Error(`openSse: ${url} answered ${res.status}`);
  }

  const queue: SseEvent[] = [];
  const waiters = new Set<Waiter>();
  let ended: string | null = null;

  const finish = (reason: string): void => {
    if (ended !== null) return;
    ended = reason;
    for (const w of waiters) {
      clearTimeout(w.timer);
      w.reject(new Error(`openSse: no "${w.event}" event: ${reason}`));
    }
    waiters.clear();
  };

  const dispatch = (e: SseEvent): void => {
    for (const w of waiters) {
      if (w.event !== e.event) continue;
      waiters.delete(w);
      clearTimeout(w.timer);
      w.resolve(e);
      return;
    }
    queue.push(e);
  };

  const read = async (body: ReadableStream<Uint8Array>): Promise<void> => {
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of body) {
      buffer += decoder.decode(chunk, { stream: true });
      // A frame ends at a blank line (the hub writes "\n" line ends).
      for (let end = buffer.indexOf('\n\n'); end >= 0; end = buffer.indexOf('\n\n')) {
        const e = parseFrame(buffer.slice(0, end), Date.now());
        buffer = buffer.slice(end + 2);
        if (e !== null) dispatch(e);
      }
    }
  };
  read(res.body).then(
    () => finish('the stream ended'),
    (err: unknown) => finish(abort.signal.aborted ? 'the client was closed' : `the stream failed (${String(err)})`),
  );

  return {
    next(event, timeoutMs = DEFAULT_TIMEOUT_MS) {
      const i = queue.findIndex((e) => e.event === event);
      if (i >= 0) return Promise.resolve(queue.splice(i, 1)[0]!);
      if (ended !== null) return Promise.reject(new Error(`openSse: no "${event}" event: ${ended}`));
      return new Promise<SseEvent>((resolve, reject) => {
        const w: Waiter = {
          event, resolve, reject,
          timer: setTimeout(() => {
            waiters.delete(w);
            reject(new Error(`openSse: no "${event}" event within ${timeoutMs} ms`));
          }, timeoutMs),
        };
        waiters.add(w);
      });
    },
    close() {
      finish('the client was closed');
      abort.abort();
    },
  };
}
