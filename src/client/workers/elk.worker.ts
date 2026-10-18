// Lays out the flow diagram off the main thread (web-stack §7): one shared ELK whose layout runs in ELK's own Web
// Worker. Vite copies `elk-worker.min.js` as a plain asset and ELK starts it itself as a classic Worker.

import ELK from 'elkjs/lib/elk-api.js';
import type { ELK as ElkApi, ElkNode } from 'elkjs/lib/elk-api.js';
import elkWorkerUrl from 'elkjs/lib/elk-worker.min.js?url';

/** Created on the first layout, not on import: the constructor starts the worker, and server-side rendering has none. */
let elk: ElkApi | null = null;

export function layoutFlow(graph: ElkNode): Promise<ElkNode> {
  elk ??= new ELK({ workerUrl: elkWorkerUrl });
  return elk.layout(graph);
}
