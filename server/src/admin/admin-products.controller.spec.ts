import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Tenant } from '@prisma/client';
import type { DriveService } from '../drive/drive.service';
import type { JobsService } from '../jobs/jobs.service';
import type { PrismaService } from '../prisma/prisma.service';
import { AdminProductsController } from './admin-products.controller';
import type {
  CreateProductDto,
  ReplaceBundleItemsDto,
} from './dto/product.dto';

const TENANT: Tenant = {
  id: 't1',
  slug: 'default',
  name: 'Topper Notes Institute',
  domains: ['localhost'],
  isDefault: true,
  branding: {},
  supportEmail: 'support@example.com',
  paymentMode: 'MANUAL_UPI',
  upiVpa: null,
  razorpayKeyId: null,
  razorpayKeySecretEnc: null,
  razorpayWebhookSecretEnc: null,
  driveRootFolderId: 'folder1',
  driveStatus: 'UNVERIFIED',
  status: 'ACTIVE',
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

const VALID_CREATE_DTO: CreateProductDto = {
  type: 'NOTE',
  slug: 'test-slug',
  title: 'Test title',
  classLevel: 10,
  subject: 'ENGLISH',
  pricePaise: 4900,
};

function baseProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    tenantId: TENANT.id,
    type: 'NOTE',
    slug: 'test-slug',
    title: 'Test title',
    description: '',
    classLevel: 10,
    subject: 'ENGLISH',
    chapterNo: null,
    pricePaise: 4900,
    driveFileId: null,
    coverPath: null,
    previewPaths: [] as string[],
    previewPages: [] as number[],
    status: 'DRAFT',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

/**
 * `raw` is the untyped mock object; `prisma` is the exact same object cast
 * to PrismaService so it can be passed into the controller's constructor.
 * `db` is the fake tenant-scoped client `raw.forTenant()` always returns.
 *
 * `models` is split out from `db` so the `$transaction` mock's callback can
 * hand the same per-model jest.fn references back without a circular
 * initializer (mirroring the real interactive-tx client, which also lacks
 * `$transaction` on the tx object).
 */
function mockPrisma() {
  const models = {
    product: {
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    productAlias: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    // BundleItem is EXEMPT from tenant scoping, but the controller now
    // routes its ops through the scoped client anyway (the scoper passes
    // exempt models through untouched) so they can join $transaction.
    bundleItem: { deleteMany: jest.fn(), createMany: jest.fn() },
    entitlement: {
      count: jest.fn().mockResolvedValue(0),
    },
  };
  const db = {
    ...models,
    $transaction: jest.fn((cb: (tx: typeof models) => Promise<unknown>) =>
      cb(models),
    ),
  };
  const raw = {
    forTenant: jest.fn().mockReturnValue(db),
    // OrderItem/Tenant are EXEMPT from tenant scoping and read/updated
    // outside any transaction, so the controller calls these directly off
    // the raw client (see the corresponding comments in the controller).
    orderItem: { count: jest.fn().mockResolvedValue(0) },
    tenant: { update: jest.fn() },
  };
  return { db, raw, prisma: raw as unknown as PrismaService };
}

function mockDrive() {
  return {
    verifyAccess: jest.fn().mockResolvedValue({ ok: true, name: 'file.pdf' }),
    getFileMeta: jest.fn().mockResolvedValue({
      id: 'df1',
      name: 'file.pdf',
      mimeType: 'application/pdf',
      copyRequiresWriterPermission: false,
    }),
    setCopyProtection: jest.fn().mockResolvedValue(undefined),
  } as unknown as DriveService;
}

function mockJobs() {
  return {
    enqueue: jest.fn().mockResolvedValue({ id: 'job1' }),
  } as unknown as JobsService;
}

// Deliberately NOT cast to StorageProvider — it's a plain interface, so a
// structurally-matching object is assignable where it's expected (into the
// controller's constructor) without a cast. Casting the return value here
// would widen `storage`'s inferred type to the interface's method
// signatures and trip @typescript-eslint/unbound-method on later bare
// `storage.publicUrl` references in assertions (matching the precedent in
// catalog.service.spec.ts's uncast `deps.storage`).
function mockStorage() {
  return {
    save: jest
      .fn<Promise<void>, [string, Buffer]>()
      .mockResolvedValue(undefined),
    remove: jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined),
    publicUrl: jest
      .fn<string, [string]>()
      .mockImplementation((p) => `https://cdn.test/${p}`),
  };
}

describe('AdminProductsController', () => {
  it('create: happy path — creates the product and maps coverUrl/previewUrls via the storage provider', async () => {
    const { db, prisma } = mockPrisma();
    db.product.create.mockResolvedValue(
      baseProduct({
        coverPath: 'tenants/t1/products/p1/preview-1.jpg',
        previewPaths: ['tenants/t1/products/p1/preview-1.jpg'],
      }),
    );
    const storage = mockStorage();
    const controller = new AdminProductsController(
      prisma,
      mockDrive(),
      mockJobs(),
      storage,
    );

    const result = await controller.create(TENANT, VALID_CREATE_DTO);

    expect(db.product.create).toHaveBeenCalledWith({
      data: { ...VALID_CREATE_DTO, previewPages: [], tenantId: TENANT.id },
    });
    expect(storage.publicUrl).toHaveBeenCalledWith(
      'tenants/t1/products/p1/preview-1.jpg',
    );
    expect(result.coverUrl).toBe(
      'https://cdn.test/tenants/t1/products/p1/preview-1.jpg',
    );
    expect(result.previewUrls).toEqual([
      'https://cdn.test/tenants/t1/products/p1/preview-1.jpg',
    ]);
  });

  it('create: maps a Prisma P2002 unique-slug violation to ConflictException', async () => {
    const { db, prisma } = mockPrisma();
    db.product.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on the fields: (`tenantId`,`slug`)',
        { code: 'P2002', clientVersion: '6.19.3' },
      ),
    );
    const controller = new AdminProductsController(
      prisma,
      mockDrive(),
      mockJobs(),
      mockStorage(),
    );

    await expect(controller.create(TENANT, VALID_CREATE_DTO)).rejects.toThrow(
      ConflictException,
    );
  });

  it('list: maps alias/bundleItem counts and coverUrl/previewUrls for every product', async () => {
    const { db, prisma } = mockPrisma();
    db.product.findMany.mockResolvedValue([
      {
        ...baseProduct({
          coverPath: 'tenants/t1/products/p1/preview-1.jpg',
          previewPaths: ['tenants/t1/products/p1/preview-1.jpg'],
        }),
        _count: { aliases: 2, bundleItems: 0 },
      },
    ]);
    const controller = new AdminProductsController(
      prisma,
      mockDrive(),
      mockJobs(),
      mockStorage(),
    );

    const { items } = await controller.list(TENANT);

    expect(items).toHaveLength(1);
    expect(items[0].aliasCount).toBe(2);
    expect(items[0].bundleItemCount).toBe(0);
    expect(items[0].coverUrl).toBe(
      'https://cdn.test/tenants/t1/products/p1/preview-1.jpg',
    );
    expect(items[0].previewUrls).toEqual([
      'https://cdn.test/tenants/t1/products/p1/preview-1.jpg',
    ]);
  });

  it('delete: blocked with Conflict when the product has entitlements or order history', async () => {
    const { db, raw, prisma } = mockPrisma();
    db.product.findUnique.mockResolvedValue(baseProduct());
    raw.orderItem.count.mockResolvedValue(1);
    const controller = new AdminProductsController(
      prisma,
      mockDrive(),
      mockJobs(),
      mockStorage(),
    );

    await expect(controller.remove(TENANT, 'p1')).rejects.toThrow(
      ConflictException,
    );
    expect(db.product.delete).not.toHaveBeenCalled();
    expect(db.bundleItem.deleteMany).not.toHaveBeenCalled();
  });

  it('delete: 404s on an id the tenant-scoped lookup does not resolve, BEFORE any exempt-model cleanup runs', async () => {
    const { db, prisma } = mockPrisma();
    // Cross-tenant or unknown id: the scoped findUnique comes back empty.
    db.product.findUnique.mockResolvedValue(null);
    const controller = new AdminProductsController(
      prisma,
      mockDrive(),
      mockJobs(),
      mockStorage(),
    );

    await expect(controller.remove(TENANT, 'other-tenants-id')).rejects.toThrow(
      NotFoundException,
    );
    // The critical assertion: no unscoped BundleItem (or any other) mutation
    // may have run — a cross-tenant id must not destroy another tenant's
    // bundle wiring behind the 404.
    expect(db.bundleItem.deleteMany).not.toHaveBeenCalled();
    expect(db.productAlias.deleteMany).not.toHaveBeenCalled();
    expect(db.product.delete).not.toHaveBeenCalled();
  });

  it('delete: happy path removes aliases, bundle links and the product row inside one transaction', async () => {
    const { db, prisma } = mockPrisma();
    db.product.findUnique.mockResolvedValue(baseProduct());
    const controller = new AdminProductsController(
      prisma,
      mockDrive(),
      mockJobs(),
      mockStorage(),
    );

    const result = await controller.remove(TENANT, 'p1');

    expect(result).toEqual({ ok: true });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.productAlias.deleteMany).toHaveBeenCalledWith({
      where: { productId: 'p1' },
    });
    expect(db.bundleItem.deleteMany).toHaveBeenCalledWith({
      where: { OR: [{ bundleId: 'p1' }, { noteId: 'p1' }] },
    });
    expect(db.product.delete).toHaveBeenCalledWith({ where: { id: 'p1' } });
  });

  it('aliases: replaces the full list atomically inside one transaction', async () => {
    const { db, prisma } = mockPrisma();
    db.product.findUnique.mockResolvedValue(baseProduct());
    const controller = new AdminProductsController(
      prisma,
      mockDrive(),
      mockJobs(),
      mockStorage(),
    );

    const result = await controller.replaceAliases(TENANT, 'p1', {
      aliases: ['carbon', 'ch 4'],
    });

    expect(result).toEqual({ aliases: ['carbon', 'ch 4'] });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.productAlias.deleteMany).toHaveBeenCalledWith({
      where: { productId: 'p1' },
    });
    expect(db.productAlias.createMany).toHaveBeenCalledWith({
      data: [
        { productId: 'p1', alias: 'carbon', tenantId: TENANT.id },
        { productId: 'p1', alias: 'ch 4', tenantId: TENANT.id },
      ],
    });
  });

  it('bundle-items: rejects replace when a noteId does not resolve to a NOTE in this tenant', async () => {
    const { db, raw, prisma } = mockPrisma();
    db.product.findUnique.mockResolvedValue(baseProduct({ type: 'BUNDLE' }));
    // Only one of the two requested ids resolves (wrong type / other tenant).
    db.product.findMany.mockResolvedValue([{ id: 'n1' }]);
    const controller = new AdminProductsController(
      prisma,
      mockDrive(),
      mockJobs(),
      mockStorage(),
    );
    const dto: ReplaceBundleItemsDto = { noteIds: ['n1', 'missing'] };

    await expect(
      controller.replaceBundleItems(TENANT, 'b1', dto),
    ).rejects.toThrow(BadRequestException);
    expect(db.bundleItem.deleteMany).not.toHaveBeenCalled();
    expect(raw.forTenant).toHaveBeenCalledWith(TENANT.id);
  });

  it('product verify-drive: returns copyProtection "set" when Drive accepts the flag update', async () => {
    const { db, prisma } = mockPrisma();
    db.product.findUnique.mockResolvedValue(
      baseProduct({ driveFileId: 'df1' }),
    );
    const drive = mockDrive();
    const controller = new AdminProductsController(
      prisma,
      drive,
      mockJobs(),
      mockStorage(),
    );

    const result = await controller.verifyDrive(TENANT, 'p1');

    expect(result).toEqual({
      ok: true,
      name: 'file.pdf',
      copyProtection: 'set',
    });
    // eslint-disable-next-line @typescript-eslint/unbound-method -- jest mock reference, never invoked unbound
    expect(drive.setCopyProtection).toHaveBeenCalledWith('df1');
  });

  it('product verify-drive: soft-fails to "owner_action_required" when only setCopyProtection is Forbidden', async () => {
    const { db, prisma } = mockPrisma();
    db.product.findUnique.mockResolvedValue(
      baseProduct({ driveFileId: 'df1' }),
    );
    const drive = mockDrive();
    // The meta read succeeded (mockDrive default: not yet protected) — the
    // SA can read the file; only the owner-gated flag update is refused.
    (drive.setCopyProtection as jest.Mock).mockRejectedValue(
      new ForbiddenException('owner-only flag'),
    );
    const controller = new AdminProductsController(
      prisma,
      drive,
      mockJobs(),
      mockStorage(),
    );

    const result = await controller.verifyDrive(TENANT, 'p1');

    expect(result).toEqual({
      ok: true,
      name: 'file.pdf',
      copyProtection: 'owner_action_required',
    });
  });

  it('product verify-drive: reports "set" from the file\'s actual state and skips the owner-only write when already protected', async () => {
    const { db, prisma } = mockPrisma();
    db.product.findUnique.mockResolvedValue(
      baseProduct({ driveFileId: 'df1' }),
    );
    const drive = mockDrive();
    // The owner has already toggled "Viewers can't download" — the read-back
    // state, not the SA's write attempt, must drive the signal.
    (drive.getFileMeta as jest.Mock).mockResolvedValue({
      id: 'df1',
      name: 'file.pdf',
      mimeType: 'application/pdf',
      copyRequiresWriterPermission: true,
    });
    const controller = new AdminProductsController(
      prisma,
      drive,
      mockJobs(),
      mockStorage(),
    );

    const result = await controller.verifyDrive(TENANT, 'p1');

    expect(result).toEqual({
      ok: true,
      name: 'file.pdf',
      copyProtection: 'set',
    });
    // eslint-disable-next-line @typescript-eslint/unbound-method -- jest mock reference, never invoked unbound
    expect(drive.setCopyProtection).not.toHaveBeenCalled();
  });

  it('product verify-drive: 422s with a folder-specific message when the Drive ID is a folder, and never attempts copy-protection', async () => {
    const { db, prisma } = mockPrisma();
    db.product.findUnique.mockResolvedValue(
      baseProduct({ driveFileId: 'folder-id' }),
    );
    const drive = mockDrive();
    // Real-world case: an admin pastes a folder id from a /drive/folders/
    // URL. Folders have metadata, so getFileMeta succeeds — the mimeType is
    // the only tell.
    (drive.getFileMeta as jest.Mock).mockResolvedValue({
      id: 'folder-id',
      name: '10th',
      mimeType: 'application/vnd.google-apps.folder',
      copyRequiresWriterPermission: false,
    });
    const controller = new AdminProductsController(
      prisma,
      drive,
      mockJobs(),
      mockStorage(),
    );

    const result = controller.verifyDrive(TENANT, 'p1');

    await expect(result).rejects.toThrow(UnprocessableEntityException);
    await expect(result).rejects.toThrow('FOLDER');
    // eslint-disable-next-line @typescript-eslint/unbound-method -- jest mock reference, never invoked unbound
    expect(drive.setCopyProtection).not.toHaveBeenCalled();
  });

  it('product verify-drive: 422s naming the actual mimeType when the file is not a PDF', async () => {
    const { db, prisma } = mockPrisma();
    db.product.findUnique.mockResolvedValue(
      baseProduct({ driveFileId: 'img1' }),
    );
    const drive = mockDrive();
    (drive.getFileMeta as jest.Mock).mockResolvedValue({
      id: 'img1',
      name: 'scan.png',
      mimeType: 'image/png',
      copyRequiresWriterPermission: false,
    });
    const controller = new AdminProductsController(
      prisma,
      drive,
      mockJobs(),
      mockStorage(),
    );

    const result = controller.verifyDrive(TENANT, 'p1');

    await expect(result).rejects.toThrow(UnprocessableEntityException);
    await expect(result).rejects.toThrow('image/png');
    // eslint-disable-next-line @typescript-eslint/unbound-method -- jest mock reference, never invoked unbound
    expect(drive.setCopyProtection).not.toHaveBeenCalled();
  });

  it('tenant verify-drive: sets driveStatus to ERROR and rethrows on ForbiddenException', async () => {
    const { raw, prisma } = mockPrisma();
    const drive = mockDrive();
    (drive.verifyAccess as jest.Mock).mockRejectedValue(
      new ForbiddenException('Drive access forbidden'),
    );
    const controller = new AdminProductsController(
      prisma,
      drive,
      mockJobs(),
      mockStorage(),
    );

    await expect(controller.verifyTenantDrive(TENANT)).rejects.toThrow(
      ForbiddenException,
    );
    expect(raw.tenant.update).toHaveBeenCalledWith({
      where: { id: TENANT.id },
      data: { driveStatus: 'ERROR' },
    });
  });

  it('generate-previews: 400s when the product has no driveFileId', async () => {
    const { db, prisma } = mockPrisma();
    db.product.findUnique.mockResolvedValue(baseProduct({ driveFileId: null }));
    const controller = new AdminProductsController(
      prisma,
      mockDrive(),
      mockJobs(),
      mockStorage(),
    );

    await expect(controller.generatePreviews(TENANT, 'p1')).rejects.toThrow(
      BadRequestException,
    );
  });
});
