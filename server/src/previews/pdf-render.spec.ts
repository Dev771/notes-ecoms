import { PDFDocument, rgb } from 'pdf-lib';
import { closeRenderWorker, renderPdfPages } from './pdf-render';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

/** 4-page, 200x200pt fixture; each page gets a distinct-colored rect so a
 * human inspecting the rendered PNGs (outside this spec) can tell pages
 * apart. The specs below only assert count/format, not pixel content. */
async function buildFixturePdf(pageCount = 4): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    const page = doc.addPage([200, 200]);
    page.drawRectangle({
      x: 20,
      y: 20,
      width: 100,
      height: 100,
      color: rgb((i + 1) / (pageCount + 1), 0.3, 0.6),
    });
  }
  return Buffer.from(await doc.save());
}

describe('renderPdfPages', () => {
  jest.setTimeout(30000); // pdfjs + native canvas cold start can be slow

  let fixture: Buffer;

  beforeAll(async () => {
    fixture = await buildFixturePdf(4);
  });

  afterAll(async () => {
    // Deterministic teardown of the shared render worker — see
    // closeRenderWorker's doc comment for why this matters under Jest.
    await closeRenderWorker();
  });

  it('(a) renders each requested page to a PNG buffer', async () => {
    const pages = await renderPdfPages(fixture, [1, 2]);

    expect(pages).toHaveLength(2);
    for (const png of pages) {
      expect(png.subarray(0, 4)).toEqual(PNG_MAGIC);
    }
  });

  it('(b) drops out-of-range page numbers instead of throwing', async () => {
    const pages = await renderPdfPages(fixture, [3, 99]);

    expect(pages).toHaveLength(1);
    expect(pages[0].subarray(0, 4)).toEqual(PNG_MAGIC);
  });

  it('(c) dedupes repeated page numbers', async () => {
    const pages = await renderPdfPages(fixture, [1, 1, 2]);

    expect(pages).toHaveLength(2);
  });

  it('(d) throws on a buffer that is not a PDF', async () => {
    const garbage = Buffer.from('definitely not a pdf');

    await expect(renderPdfPages(garbage, [1])).rejects.toThrow();
  });
});
