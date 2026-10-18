import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { SseHub } from '../../../src/server/http/sse.ts';

/** Just enough of a ServerResponse for the hub: writeHead, write, end and the 'close' event. */
class FakeResponse extends EventEmitter {
  status: number | null = null;
  headers: Record<string, string> | null = null;
  chunks: string[] = [];
  writableEnded = false;
  destroyed = false;
  writeHead(status: number, headers: Record<string, string>): this {
    this.status = status;
    this.headers = headers;
    return this;
  }
  write(chunk: string): boolean {
    this.chunks.push(chunk);
    return true;
  }
  end(): this {
    this.writableEnded = true;
    this.emit('close');
    return this;
  }
}

function connect(hub: SseHub, channel: string, first = { event: 'snapshot', data: { id: channel, rev: 0 }, id: 0 }) {
  const req = new EventEmitter();
  const res = new FakeResponse();
  hub.open(channel, req as unknown as IncomingMessage, res as unknown as ServerResponse, first);
  return { req, res };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('SseHub', () => {
  it('opens a stream, sends events and heartbeats, and forgets a closed request', () => {
    const hub = new SseHub();
    const { req, res } = connect(hub, 'p1');
    expect(res.status).toBe(200);
    expect(res.headers).toEqual({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    expect(res.chunks).toEqual(['retry: 2000\n\n', 'event: snapshot\nid: 0\ndata: {"id":"p1","rev":0}\n\n']);
    expect(hub.count('p1')).toBe(1);

    expect(hub.send('p1', 'op', { rev: 1 }, 1)).toBe(1);
    expect(res.chunks.at(-1)).toBe('event: op\nid: 1\ndata: {"rev":1}\n\n');

    vi.advanceTimersByTime(19_999);
    expect(res.chunks.at(-1)).not.toBe(': hb\n\n');
    vi.advanceTimersByTime(1);
    expect(res.chunks.at(-1)).toBe(': hb\n\n');

    req.emit('close');
    expect(hub.count('p1')).toBe(0);
    expect(hub.send('p1', 'op', { rev: 2 }, 2)).toBe(0);
    const written = res.chunks.length;
    vi.advanceTimersByTime(60_000);
    expect(res.chunks.length).toBe(written);
  });

  it('omits the id line when an event has no id and keeps channels apart', () => {
    const hub = new SseHub({ heartbeatMs: 1000 });
    const a = connect(hub, 'a');
    const b = connect(hub, 'b');
    expect(hub.send('a', 'plan', { rev: 3 })).toBe(1);
    expect(a.res.chunks.at(-1)).toBe('event: plan\ndata: {"rev":3}\n\n');
    expect(b.res.chunks).toHaveLength(2);
    expect(hub.count('nobody')).toBe(0);
    expect(hub.send('nobody', 'plan', { rev: 3 })).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(b.res.chunks.at(-1)).toBe(': hb\n\n');
  });

  it('forgets a response that closes on its own and skips one already destroyed', () => {
    const hub = new SseHub();
    const one = connect(hub, 'p');
    const two = connect(hub, 'p');
    expect(hub.count('p')).toBe(2);
    one.res.emit('close');
    expect(hub.count('p')).toBe(1);
    two.res.destroyed = true;
    expect(hub.send('p', 'op', { rev: 1 }, 1)).toBe(0);
    expect(two.res.chunks).toHaveLength(2);
  });

  it('does not keep a stream whose client left before it opened', () => {
    const hub = new SseHub();
    const res = new FakeResponse();
    res.destroyed = true;
    hub.open('p', new EventEmitter() as unknown as IncomingMessage, res as unknown as ServerResponse, { event: 'snapshot', data: {}, id: 0 });
    expect(hub.count('p')).toBe(0);
    vi.advanceTimersByTime(60_000);
    expect(res.chunks).not.toContain(': hb\n\n');
  });

  it('closeAll ends every stream and stops the heartbeats', () => {
    const hub = new SseHub();
    const a = connect(hub, 'a');
    const b = connect(hub, 'b');
    hub.closeAll();
    expect(a.res.writableEnded && b.res.writableEnded).toBe(true);
    expect(hub.count('a') + hub.count('b')).toBe(0);
    const written = a.res.chunks.length;
    vi.advanceTimersByTime(60_000);
    expect(a.res.chunks.length).toBe(written);
  });
});
