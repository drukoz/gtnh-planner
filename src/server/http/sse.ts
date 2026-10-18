// Server-sent events (architecture §8, web-stack §4.3): one stream per open project tab, grouped by channel (a project
// id). Each stream starts with `retry: 2000` and a first event (the project snapshot), then gets the events sent to its
// channel and a `: hb` comment every heartbeat so idle NAT and proxy timers stay open.

import type { IncomingMessage, ServerResponse } from 'node:http';

interface Listener { res: ServerResponse; heartbeat: NodeJS.Timeout }

function frame(event: string, data: unknown, id?: number): string {
  const idLine = id === undefined ? '' : `id: ${id}\n`;
  // JSON.stringify escapes line breaks inside strings, so the data always fits on one `data:` line.
  return `event: ${event}\n${idLine}data: ${JSON.stringify(data) ?? 'null'}\n\n`;
}

function writable(res: ServerResponse): boolean {
  return !res.writableEnded && !res.destroyed;
}

export class SseHub {
  readonly #heartbeatMs: number;
  readonly #channels = new Map<string, Set<Listener>>();

  constructor(opts: { heartbeatMs?: number } = {}) {
    this.#heartbeatMs = opts.heartbeatMs ?? 20_000;
  }

  /** Answers `req` with an event stream on `channel` that starts with `first`; it leaves the channel when it closes. */
  open(channel: string, req: IncomingMessage, res: ServerResponse, first: { event: string; data: unknown; id?: number }): void {
    if (!writable(res)) return;   // the client left before its handler got here: 'close' has already fired
    // A write racing a client abort reports an error on the response; the 'close' below cleans up either way.
    res.on('error', () => {});
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 2000\n\n');
    res.write(frame(first.event, first.data, first.id));
    const heartbeat = setInterval(() => {
      if (writable(res)) res.write(': hb\n\n');
    }, this.#heartbeatMs);
    heartbeat.unref();
    const listener: Listener = { res, heartbeat };
    let listeners = this.#channels.get(channel);
    if (listeners === undefined) {
      listeners = new Set();
      this.#channels.set(channel, listeners);
    }
    listeners.add(listener);
    const leave = (): void => this.#remove(channel, listener);
    req.on('close', leave);
    res.on('close', leave);
  }

  /** Writes one event to every open stream of `channel`; returns how many streams it reached. */
  send(channel: string, event: string, data: unknown, id?: number): number {
    const listeners = this.#channels.get(channel);
    if (listeners === undefined) return 0;
    const text = frame(event, data, id);
    let reached = 0;
    for (const listener of listeners) {
      if (!writable(listener.res)) continue;
      listener.res.write(text);
      reached++;
    }
    return reached;
  }

  count(channel: string): number {
    return this.#channels.get(channel)?.size ?? 0;
  }

  /** Ends every stream (a server stops only once its event streams are gone, web-stack §4.2). */
  closeAll(): void {
    const all = [...this.#channels.values()].flatMap((listeners) => [...listeners]);
    this.#channels.clear();
    for (const { res, heartbeat } of all) {
      clearInterval(heartbeat);
      if (writable(res)) res.end();
    }
  }

  #remove(channel: string, listener: Listener): void {
    clearInterval(listener.heartbeat);
    const listeners = this.#channels.get(channel);
    if (listeners === undefined || !listeners.delete(listener)) return;
    if (listeners.size === 0) this.#channels.delete(channel);
  }
}
