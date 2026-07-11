import { Inject, Injectable } from '@nestjs/common';
import { DriveService } from '../drive/drive.service';
import { PrismaService } from '../prisma/prisma.service';
import { STORAGE_PROVIDER } from '../storage/storage.provider';
import type { StorageProvider } from '../storage/storage.provider';
import { renderPdfPages } from './pdf-render';
import { applyWatermark } from './watermark';

@Injectable()
export class PreviewService {
  constructor(
    private readonly drive: DriveService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Downloads the product's Drive PDF, renders its preview pages
   * (`product.previewPages`, or [1,2,3] if unset), watermarks each with the
   * tenant's name, saves them under
   * `tenants/<tenantId>/products/<productId>/preview-<n>.jpg`, and updates
   * the product's `previewPaths` (+ `coverPath` = the first one).
   *
   * Throws (rather than swallowing) on a missing product, a missing
   * driveFileId, or zero renderable pages — the caller is a JobHandler, so a
   * thrown error becomes a retry/dead-letter via JobsService, which is the
   * desired behavior for all three: they're either a bad enqueue (should be
   * fixed and retried) or a genuinely broken source PDF (surfaces via
   * FulfillmentJob.lastError after it dead-letters).
   */
  async generateForProduct(tenantId: string, productId: string): Promise<void> {
    const db = this.prisma.forTenant(tenantId);
    const product = await db.product.findUnique({
      where: { id: productId, tenantId },
    });
    if (!product)
      throw new Error(`Product ${productId} not found for tenant ${tenantId}`);
    if (!product.driveFileId)
      throw new Error(`Product ${productId} has no driveFileId`);

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });
    const pdf = await this.drive.downloadFile(product.driveFileId);
    const pages =
      product.previewPages.length > 0 ? product.previewPages : [1, 2, 3];
    const pngs = await renderPdfPages(pdf, pages);
    if (pngs.length === 0)
      throw new Error(`No renderable pages for product ${productId}`);

    const paths: string[] = [];
    for (let i = 0; i < pngs.length; i++) {
      const jpeg = await applyWatermark(
        pngs[i],
        `${tenant?.name ?? 'PREVIEW'} • PREVIEW`,
      );
      const rel = `tenants/${tenantId}/products/${productId}/preview-${i + 1}.jpg`;
      await this.storage.save(rel, jpeg);
      paths.push(rel);
    }

    await db.product.update({
      where: { id: productId, tenantId },
      data: { previewPaths: paths, coverPath: paths[0] },
    });
  }
}
