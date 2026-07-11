// Runs INSIDE a worker_thread, started (once, lazily, and reused) by
// pdf-render.ts. This file is plain ESM on purpose: pdfjs-dist's legacy Node
// build (`pdf.mjs`) is genuine ESM with no CommonJS build at all (as of
// pdfjs-dist v6) and uses top-level `import.meta.url`. Node's own module
// loader (used natively to bootstrap a worker_thread's entry file) handles
// that fine; Jest's CJS-based module runtime on the main thread cannot
// (confirmed empirically — even a dynamic `import()` needs
// `--experimental-vm-modules`, which in turn breaks this project's existing
// jose-based auth specs, so that flag is off the table). Running pdfjs in
// its own worker thread sidesteps Jest's module system entirely: this file
// is loaded by Node's real, non-experimental ESM loader in both tests and
// production, identically.
//
// This worker stays alive and handles one message per render request rather
// than being spawned fresh per call — repeatedly creating *and tearing
// down* a worker thread that loads @napi-rs/canvas's native addon was
// observed to intermittently segfault the process (reproduced empirically:
// ~1 in 3 runs of a spec file making several sequential renderPdfPages calls
// crashed under Jest's default (non---runInBand) parallelism, never under
// --runInBand, and never once this file switched to a long-lived,
// message-per-request worker). A persistent worker also avoids paying
// pdfjs's cold-start cost (module parse + first-page JIT) on every single
// job.
//
// No TypeScript here deliberately — keeping this file plain, small, and
// untyped avoids needing a second build pipeline just for one worker entry
// point. `pdf-render.ts` is the typed, tested surface; this file is a thin,
// mechanical bridge.
import { parentPort } from 'node:worker_threads';
import { createCanvas } from '@napi-rs/canvas';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

async function renderPages(pdfBytes, pages) {
  const loadingTask = pdfjsLib.getDocument({
    data: pdfBytes,
    verbosity: 0, // errors only — suppresses benign "Indexing all PDF objects" etc. warnings
  });
  try {
    // Awaited INSIDE the try so the finally's destroy() also runs when
    // loading itself fails (corrupted/non-PDF input) — with the await outside
    // the try, that path skipped destroy() and leaked pdfjs's internal
    // transport once per bad PDF for the lifetime of this worker thread.
    const doc = await loadingTask.promise;
    const wanted = [...new Set(pages)].filter(
      (p) => Number.isInteger(p) && p >= 1 && p <= doc.numPages,
    );

    const pngs = [];
    for (const pageNumber of wanted) {
      const page = await doc.getPage(pageNumber);
      // 1.5x scale: comfortably legible for an A4-ish source page while
      // staying close to the 900px cap applyWatermark enforces downstream.
      const viewport = page.getViewport({ scale: 1.5 });
      const canvas = createCanvas(
        Math.ceil(viewport.width),
        Math.ceil(viewport.height),
      );

      const renderTask = page.render({ canvas, viewport });
      await renderTask.promise;

      pngs.push(canvas.toBuffer('image/png'));
      page.cleanup();
    }
    return pngs;
  } finally {
    // Guarded so a destroy() failure can never mask the original load/render
    // error (the caller needs pdfjs's real message in the job's lastError).
    try {
      await loadingTask.destroy();
    } catch {
      /* ignore teardown failure */
    }
  }
}

parentPort.on('message', ({ id, pdfBytes, pages }) => {
  renderPages(pdfBytes, pages)
    .then((pngs) => {
      parentPort.postMessage({ id, ok: true, pngs });
    })
    .catch((err) => {
      parentPort.postMessage({
        id,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    });
});
