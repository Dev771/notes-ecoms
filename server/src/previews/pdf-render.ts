import * as path from 'node:path';
import { Worker } from 'node:worker_threads';

// See pdf-render.worker.mjs for the full rationale: pdfjs-dist's legacy Node
// build is genuine ESM with no CJS twin (v6+) and uses top-level
// `import.meta.url`, which Jest's CJS module runtime cannot parse. A dynamic
// `import()` only works under Node's `--experimental-vm-modules`, and
// enabling that flag was verified (empirically, not assumed) to break this
// project's existing jose-based auth specs — `ReferenceError: exports is not
// defined` in tokens.spec.ts / oauth-exception.filter.spec.ts /
// auth.controller.spec.ts — so it's not an option project-wide for one
// dependency. Running pdfjs in a worker_thread isolates it: Node's native,
// non-experimental ESM loader bootstraps the worker's entry file identically
// in tests and in the built app, with zero Jest config changes.
//
// __dirname resolves to src/previews in dev/test (ts-jest/ts-node run
// straight from src/, where this .mjs already lives beside pdf-render.ts —
// no copy needed) and to dist/src/previews in the built app. That "src"
// segment inside dist/ is this project's existing tsc rootDir inference
// (compile root spans both server/src and server/prisma, so tsc mirrors the
// full relative path, not just under src/ — see dist/prisma/*.js too); it is
// NOT something introduced for previews. nest-cli.json's asset-copy entry
// targets "dist/src" specifically to land next to the compiled pdf-render.js
// — verified via `npm run build` (both files present in dist/src/previews/).
const WORKER_PATH = path.join(__dirname, 'pdf-render.worker.mjs');

interface WorkerSuccess {
  id: number;
  ok: true;
  pngs: Uint8Array[];
}
interface WorkerFailure {
  id: number;
  ok: false;
  error: string;
}
type WorkerMessage = WorkerSuccess | WorkerFailure;

interface PendingRequest {
  resolve: (msg: WorkerMessage) => void;
  reject: (err: Error) => void;
}

/** A worker thread plus the in-flight requests that belong to IT — the map
 * lives on the struct (not module-level) so that failing/retiring one worker
 * can never touch requests queued on a replacement worker spawned later. */
interface RenderWorker {
  thread: Worker;
  pending: Map<number, PendingRequest>;
}

// A render exceeding this is treated as hung (pdfjs can spin indefinitely on
// pathological input). The request — and everything else queued on the same
// worker — must reject so the surrounding job fails and takes the normal
// retry/dead-letter path, instead of sitting RUNNING forever. 60s is
// deliberately generous: the spec fixtures render in tens of milliseconds and
// a real A4 page at 1.5x stays well under a few seconds.
const RENDER_TIMEOUT_MS = 60_000;

// A single worker, created lazily and reused for every renderPdfPages call
// rather than spawned fresh per call. Repeatedly creating *and tearing down*
// a worker that loads @napi-rs/canvas's native addon was observed to
// intermittently segfault the process (reproduced empirically under Jest's
// default parallelism; never under --runInBand, and never once this module
// switched to a persistent worker) — see pdf-render.worker.mjs for the full
// note. Reusing one worker also avoids paying pdfjs's cold-start cost on
// every job.
let current: RenderWorker | undefined;
let nextRequestId = 0;

function failAll(rw: RenderWorker, err: Error): void {
  for (const { reject } of rw.pending.values()) reject(err);
  rw.pending.clear();
}

/** Drops `rw` as the singleton only if it still IS the singleton — a late
 * 'exit'/'error' event from an already-replaced worker must not clobber the
 * fresh one. */
function retire(rw: RenderWorker): void {
  if (current === rw) current = undefined;
}

function getWorker(): RenderWorker {
  if (current) return current;

  const rw: RenderWorker = {
    thread: new Worker(WORKER_PATH),
    pending: new Map(),
  };
  rw.thread.on('message', (msg: WorkerMessage) => {
    const entry = rw.pending.get(msg.id);
    if (!entry) return;
    rw.pending.delete(msg.id);
    entry.resolve(msg);
  });
  rw.thread.on('error', (err: Error) => {
    failAll(rw, err);
    retire(rw); // next call gets a fresh worker
  });
  rw.thread.on('exit', (code: number) => {
    if (code !== 0) {
      failAll(rw, new Error(`pdf-render worker exited with code ${code}`));
    }
    retire(rw);
  });
  // Don't let an idle-but-alive worker keep the process from exiting (matters
  // for tests and for graceful app shutdown); it's still fully usable while
  // referenced by an in-flight request.
  rw.thread.unref();

  current = rw;
  return rw;
}

function runInWorker(
  pdfBytes: Uint8Array,
  pages: number[],
): Promise<WorkerMessage> {
  const rw = getWorker();
  const id = nextRequestId++;

  const request = new Promise<WorkerMessage>((resolve, reject) => {
    rw.pending.set(id, { resolve, reject });
    rw.thread.postMessage({ id, pdfBytes, pages });
  });

  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // Hung render: reject every request on this worker (they die with the
      // thread), kill the thread, and retire the singleton so the next call
      // spawns a fresh worker. Note failAll also rejects THIS request's
      // `request` promise; the explicit reject below keeps the race airtight
      // even if the entry was somehow already consumed.
      const err = new Error(
        `pdf-render timed out after ${RENDER_TIMEOUT_MS}ms`,
      );
      failAll(rw, err);
      retire(rw);
      void rw.thread.terminate();
      reject(err);
    }, RENDER_TIMEOUT_MS);
    // The watchdog itself must never hold the process open.
    timer.unref();
  });

  // clearTimeout on settle either way — an uncancelled watchdog would fire
  // up to 60s later and kill a healthy (possibly mid-request) worker.
  return Promise.race([request, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Renders selected pages of a PDF to PNG buffers.
 *
 * Page numbers are 1-indexed, deduped, and silently clamped to the
 * document's actual page count — a page number outside [1, numPages] is
 * dropped rather than causing an error (the caller may pass stale
 * `previewPages` for a PDF that was replaced with fewer pages).
 *
 * The actual pdfjs-dist + @napi-rs/canvas rendering happens in
 * pdf-render.worker.mjs, run via a reused worker_thread (see that file and
 * the comments above for why). This function is the typed, tested public
 * surface; it just marshals the request in and the PNG buffers back out.
 */
export async function renderPdfPages(
  pdf: Buffer,
  pages: number[],
): Promise<Buffer[]> {
  const result = await runInWorker(new Uint8Array(pdf), pages);
  if (!result.ok) throw new Error(result.error);
  return result.pngs.map((png) => Buffer.from(png));
}

/**
 * Explicitly terminates the shared render worker, if one has been created.
 * The worker is `.unref()`'d so it never blocks a normal process exit, but
 * Jest runs each spec file's process as part of its own worker pool, and
 * tearing every OS-level Jest worker down at once occasionally raced with
 * this thread's own shutdown under the full suite's parallelism — observed
 * intermittently (~1 in 6 full-suite runs, never in isolation) as Jest's
 * "A worker process has failed to exit gracefully" warning. It never failed
 * a test (Jest force-exits and moves on regardless), but spec files that
 * call renderPdfPages should call this from an `afterAll` for a clean,
 * deterministic teardown instead of leaving it to process-exit timing.
 * Production code has no equivalent need: the app process runs indefinitely
 * and is torn down as a whole (e.g. via SIGTERM), not via a call to this.
 */
export async function closeRenderWorker(): Promise<void> {
  if (!current) return;
  const rw = current;
  current = undefined;
  failAll(rw, new Error('pdf-render worker closed'));
  await rw.thread.terminate();
}
