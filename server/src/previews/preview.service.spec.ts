import { PDFDocument, rgb } from 'pdf-lib';
import type { DriveService } from '../drive/drive.service';
import type { PrismaService } from '../prisma/prisma.service';
import { closeRenderWorker } from './pdf-render';
import { PreviewService } from './preview.service';

jest.setTimeout(30000); // real render (worker thread) + real sharp watermark per case

const JPEG_MAGIC = Buffer.from([0xff, 0xd8]);

async function buildFixturePdf(pageCount: number): Promise<Buffer> {
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

interface FakeDeps {
  drive: { downloadFile: jest.Mock<Promise<Buffer>, [string]> };
  storage: {
    save: jest.Mock<Promise<void>, [string, Buffer]>;
    publicUrl: jest.Mock<string, [string]>;
    remove: jest.Mock<Promise<void>, [string]>;
  };
  productModel: { findUnique: jest.Mock; update: jest.Mock };
  tenantModel: { findUnique: jest.Mock };
  prisma: { forTenant: jest.Mock; tenant: { findUnique: jest.Mock } };
}

function buildFakeDeps(overrides: {
  previewPages?: number[];
  driveFileId?: string | null;
  tenantName?: string;
}): FakeDeps {
  const product = {
    id: 'prod-1',
    tenantId: 'tenant-1',
    driveFileId:
      overrides.driveFileId === undefined
        ? 'drive-file-1'
        : overrides.driveFileId,
    previewPages: overrides.previewPages ?? [],
  };

  const productModel = {
    findUnique: jest.fn().mockResolvedValue(product),
    update: jest.fn().mockResolvedValue(product),
  };
  const tenantModel = {
    findUnique: jest.fn().mockResolvedValue({
      id: 'tenant-1',
      name: overrides.tenantName ?? 'Acme Tuition Centre',
    }),
  };
  const forTenant = jest.fn().mockReturnValue({ product: productModel });

  return {
    drive: { downloadFile: jest.fn<Promise<Buffer>, [string]>() },
    storage: {
      save: jest
        .fn<Promise<void>, [string, Buffer]>()
        .mockResolvedValue(undefined),
      publicUrl: jest.fn<string, [string]>(),
      remove: jest.fn<Promise<void>, [string]>(),
    },
    productModel,
    tenantModel,
    prisma: { forTenant, tenant: tenantModel },
  };
}

function serviceFor(deps: FakeDeps): PreviewService {
  return new PreviewService(
    deps.drive as unknown as DriveService,
    deps.storage,
    deps.prisma as unknown as PrismaService,
  );
}

describe('PreviewService#generateForProduct', () => {
  afterAll(async () => {
    // Deterministic teardown of the shared render worker (renderPdfPages
    // runs for real in this spec) — see closeRenderWorker's doc comment.
    await closeRenderWorker();
  });

  it('(a) uses pages [1,2,3] when product.previewPages is empty', async () => {
    const fixture = await buildFixturePdf(5);
    const deps = buildFakeDeps({ previewPages: [] });
    deps.drive.downloadFile.mockResolvedValue(fixture);

    await serviceFor(deps).generateForProduct('tenant-1', 'prod-1');

    expect(deps.storage.save).toHaveBeenCalledTimes(3);
    const savedPaths = deps.storage.save.mock.calls.map((call) => call[0]);
    expect(savedPaths).toEqual([
      'tenants/tenant-1/products/prod-1/preview-1.jpg',
      'tenants/tenant-1/products/prod-1/preview-2.jpg',
      'tenants/tenant-1/products/prod-1/preview-3.jpg',
    ]);
  });

  it('(b) saves under the tenant/product path convention and updates previewPaths + coverPath', async () => {
    const fixture = await buildFixturePdf(2);
    const deps = buildFakeDeps({ previewPages: [1, 2] });
    deps.drive.downloadFile.mockResolvedValue(fixture);

    await serviceFor(deps).generateForProduct('tenant-1', 'prod-1');

    expect(deps.productModel.update).toHaveBeenCalledWith({
      where: { id: 'prod-1', tenantId: 'tenant-1' },
      data: {
        previewPaths: [
          'tenants/tenant-1/products/prod-1/preview-1.jpg',
          'tenants/tenant-1/products/prod-1/preview-2.jpg',
        ],
        coverPath: 'tenants/tenant-1/products/prod-1/preview-1.jpg',
      },
    });
  });

  it('(c) throws when the product has no driveFileId (job retries/dead-letters, never touches Drive)', async () => {
    const deps = buildFakeDeps({ driveFileId: null });

    await expect(
      serviceFor(deps).generateForProduct('tenant-1', 'prod-1'),
    ).rejects.toThrow(/has no driveFileId/);
    expect(deps.drive.downloadFile).not.toHaveBeenCalled();
    expect(deps.storage.save).not.toHaveBeenCalled();
  });

  // (d) "tenant name lands in the watermark call": applyWatermark is a plain
  // function import, not a class — there's no instance to spy on, and
  // jest.mock('./watermark') would replace it entirely, which would only
  // prove PreviewService calls the mock, not that a real image reflects the
  // tenant's name. applyWatermark's own spec (watermark.spec.ts) already
  // covers compositing behavior generically. So instead of mocking it or
  // eyeballing/OCR-ing pixels, this drives the REAL render+watermark
  // pipeline twice with two different tenant names off the same fixture PDF
  // and asserts the two saved JPEGs differ — the only way the output can
  // differ, given everything else held constant, is that the tenant name
  // actually reached applyWatermark's `text` argument and changed the
  // composited pixels. This is strictly stronger than checking "storage.save
  // received *a* JPEG" (which would pass even if the tenant name were
  // silently dropped), while still not mocking applyWatermark.
  it('(d) different tenant names produce different watermarked bytes (tenant name reaches applyWatermark)', async () => {
    const fixture = await buildFixturePdf(1);

    const runWithTenantName = async (tenantName: string): Promise<Buffer> => {
      const deps = buildFakeDeps({ previewPages: [1], tenantName });
      deps.drive.downloadFile.mockResolvedValue(fixture);
      await serviceFor(deps).generateForProduct('tenant-1', 'prod-1');
      expect(deps.tenantModel.findUnique).toHaveBeenCalledWith({
        where: { id: 'tenant-1' },
      });
      const [, savedBuffer] = deps.storage.save.mock.calls[0];
      expect(savedBuffer.subarray(0, 2)).toEqual(JPEG_MAGIC);
      return savedBuffer;
    };

    const bufferA = await runWithTenantName('Acme Tuition Centre');
    const bufferB = await runWithTenantName('Zenith Learning Hub');

    expect(Buffer.compare(bufferA, bufferB)).not.toBe(0);
  });
});
