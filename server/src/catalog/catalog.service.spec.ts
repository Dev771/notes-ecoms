import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { CatalogService } from './catalog.service';
import type { ListProductsDto } from './dto/list-products.dto';

interface RawBundleItem {
  note: {
    slug: string;
    title: string;
    chapterNo: number | null;
    status: string;
  };
}

interface RawInBundle {
  bundle: {
    slug: string;
    title: string;
    pricePaise: number;
    status: string;
  };
}

// Shape returned by the (mocked) Prisma client — a superset of the real
// `Product` model plus the `bundleItems`/`inBundles` relations `bySlug`
// requests. Using one fixture shape for both `list` and `bySlug` tests is
// harmless: `list`'s mapping never reads the relation fields.
interface RawProduct {
  id: string;
  tenantId: string;
  type: string;
  slug: string;
  title: string;
  description: string;
  classLevel: number;
  subject: string;
  chapterNo: number | null;
  pricePaise: number;
  driveFileId: string | null;
  coverPath: string | null;
  previewPaths: string[];
  previewPages: number[];
  status: string;
  createdAt: Date;
  updatedAt: Date;
  bundleItems: RawBundleItem[];
  inBundles: RawInBundle[];
}

function rawProduct(overrides: Partial<RawProduct> = {}): RawProduct {
  return {
    id: 'prod-1',
    tenantId: 'tenant-1',
    type: 'NOTE',
    slug: 'class-10-maths-ch1-real-numbers',
    title: 'Real Numbers',
    description: 'Handwritten Class 10 Maths notes: Real Numbers.',
    classLevel: 10,
    subject: 'MATHS',
    chapterNo: 1,
    pricePaise: 7900,
    driveFileId: 'drive-file-1',
    coverPath: null,
    previewPaths: [],
    previewPages: [],
    status: 'ACTIVE',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    bundleItems: [],
    inBundles: [],
    ...overrides,
  };
}

interface FakeProductModel {
  findMany: jest.Mock<Promise<RawProduct[]>, [unknown]>;
  findUnique: jest.Mock<Promise<RawProduct | null>, [unknown]>;
}

interface FakeDeps {
  productModel: FakeProductModel;
  forTenant: jest.Mock<{ product: FakeProductModel }, [string]>;
  storage: {
    save: jest.Mock<Promise<void>, [string, Buffer]>;
    publicUrl: jest.Mock<string, [string]>;
    remove: jest.Mock<Promise<void>, [string]>;
  };
}

function buildFakeDeps(): FakeDeps {
  const productModel: FakeProductModel = {
    findMany: jest.fn<Promise<RawProduct[]>, [unknown]>().mockResolvedValue([]),
    findUnique: jest
      .fn<Promise<RawProduct | null>, [unknown]>()
      .mockResolvedValue(null),
  };
  const forTenant = jest
    .fn<{ product: FakeProductModel }, [string]>()
    .mockReturnValue({ product: productModel });
  const storage = {
    save: jest
      .fn<Promise<void>, [string, Buffer]>()
      .mockResolvedValue(undefined),
    publicUrl: jest
      .fn<string, [string]>()
      .mockImplementation((path) => `https://cdn.example.com/${path}`),
    remove: jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined),
  };
  return { productModel, forTenant, storage };
}

function serviceFor(deps: FakeDeps): CatalogService {
  return new CatalogService(
    { forTenant: deps.forTenant } as unknown as PrismaService,
    deps.storage,
  );
}

describe('CatalogService#list', () => {
  it('(a) always filters status ACTIVE and applies classLevel+subject+type filters when given', async () => {
    const deps = buildFakeDeps();
    const dto: ListProductsDto = {
      classLevel: 10,
      subject: 'MATHS',
      type: 'NOTE',
    };

    await serviceFor(deps).list('tenant-1', dto);

    expect(deps.forTenant).toHaveBeenCalledWith('tenant-1');
    expect(deps.productModel.findMany).toHaveBeenCalledWith({
      where: {
        status: 'ACTIVE',
        classLevel: 10,
        subject: 'MATHS',
        type: 'NOTE',
      },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('(a) omits classLevel/subject/type from the where clause when not given, but still injects status ACTIVE', async () => {
    const deps = buildFakeDeps();

    await serviceFor(deps).list('tenant-1', {});

    expect(deps.productModel.findMany).toHaveBeenCalledWith({
      where: { status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('(b) sort=price_asc maps to orderBy { pricePaise: "asc" }', async () => {
    const deps = buildFakeDeps();

    await serviceFor(deps).list('tenant-1', { sort: 'price_asc' });

    expect(deps.productModel.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { pricePaise: 'asc' } }),
    );
  });

  it('(b) sort=price_desc maps to orderBy { pricePaise: "desc" }', async () => {
    const deps = buildFakeDeps();

    await serviceFor(deps).list('tenant-1', { sort: 'price_desc' });

    expect(deps.productModel.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { pricePaise: 'desc' } }),
    );
  });

  it('(b) sort=newest maps to orderBy { createdAt: "desc" }', async () => {
    const deps = buildFakeDeps();

    await serviceFor(deps).list('tenant-1', { sort: 'newest' });

    expect(deps.productModel.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: 'desc' } }),
    );
  });

  it('(b) defaults to newest (createdAt desc) when sort is omitted', async () => {
    const deps = buildFakeDeps();

    await serviceFor(deps).list('tenant-1', {});

    expect(deps.productModel.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: 'desc' } }),
    );
  });

  it('(d) maps coverPath/previewPaths through storage.publicUrl, and omits status/driveFileId', async () => {
    const deps = buildFakeDeps();
    deps.productModel.findMany.mockResolvedValue([
      rawProduct({
        coverPath: 'tenants/t1/products/prod-1/preview-1.jpg',
        previewPaths: [
          'tenants/t1/products/prod-1/preview-1.jpg',
          'tenants/t1/products/prod-1/preview-2.jpg',
        ],
      }),
    ]);

    const [result] = await serviceFor(deps).list('tenant-1', {});

    expect(deps.storage.publicUrl).toHaveBeenCalledWith(
      'tenants/t1/products/prod-1/preview-1.jpg',
    );
    expect(deps.storage.publicUrl).toHaveBeenCalledWith(
      'tenants/t1/products/prod-1/preview-2.jpg',
    );
    expect(result.coverUrl).toBe(
      'https://cdn.example.com/tenants/t1/products/prod-1/preview-1.jpg',
    );
    expect(result.previewUrls).toEqual([
      'https://cdn.example.com/tenants/t1/products/prod-1/preview-1.jpg',
      'https://cdn.example.com/tenants/t1/products/prod-1/preview-2.jpg',
    ]);
    expect(result).not.toHaveProperty('status');
    expect(result).not.toHaveProperty('driveFileId');
    expect(result).not.toHaveProperty('coverPath');
    expect(result).not.toHaveProperty('previewPaths');
  });

  it('(d) coverUrl is null and previewUrls is empty when the product has no cover/previews', async () => {
    const deps = buildFakeDeps();
    deps.productModel.findMany.mockResolvedValue([
      rawProduct({ coverPath: null, previewPaths: [] }),
    ]);

    const [result] = await serviceFor(deps).list('tenant-1', {});

    expect(result.coverUrl).toBeNull();
    expect(result.previewUrls).toEqual([]);
    expect(deps.storage.publicUrl).not.toHaveBeenCalled();
  });
});

describe('CatalogService#bySlug', () => {
  it('(c) throws NotFoundException when no product matches the slug', async () => {
    const deps = buildFakeDeps();
    deps.productModel.findUnique.mockResolvedValue(null);

    const result = serviceFor(deps).bySlug('tenant-1', 'missing-slug');

    await expect(result).rejects.toThrow(NotFoundException);
    await expect(result).rejects.toThrow('missing-slug');
  });

  it('(c) throws NotFoundException when the product exists but is not ACTIVE (DRAFT)', async () => {
    const deps = buildFakeDeps();
    deps.productModel.findUnique.mockResolvedValue(
      rawProduct({ status: 'DRAFT' }),
    );

    const result = serviceFor(deps).bySlug('tenant-1', 'draft-slug');

    await expect(result).rejects.toThrow(NotFoundException);
  });

  it('(c) throws NotFoundException when the product exists but is not ACTIVE (ARCHIVED)', async () => {
    const deps = buildFakeDeps();
    deps.productModel.findUnique.mockResolvedValue(
      rawProduct({ status: 'ARCHIVED' }),
    );

    const result = serviceFor(deps).bySlug('tenant-1', 'archived-slug');

    await expect(result).rejects.toThrow(NotFoundException);
  });

  it('looks the product up by the tenantId_slug compound key, scoped via forTenant', async () => {
    const deps = buildFakeDeps();
    deps.productModel.findUnique.mockResolvedValue(rawProduct());

    await serviceFor(deps).bySlug(
      'tenant-1',
      'class-10-maths-ch1-real-numbers',
    );

    expect(deps.forTenant).toHaveBeenCalledWith('tenant-1');
    expect(deps.productModel.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId_slug: {
            tenantId: 'tenant-1',
            slug: 'class-10-maths-ch1-real-numbers',
          },
        },
      }),
    );
  });

  it('(d) detail response omits status/driveFileId', async () => {
    const deps = buildFakeDeps();
    deps.productModel.findUnique.mockResolvedValue(rawProduct());

    const result = await serviceFor(deps).bySlug(
      'tenant-1',
      'class-10-maths-ch1-real-numbers',
    );

    expect(result).not.toHaveProperty('status');
    expect(result).not.toHaveProperty('driveFileId');
  });

  it('(e) filters bundleItems to ACTIVE notes only, mapped to {slug,title,chapterNo}', async () => {
    const deps = buildFakeDeps();
    deps.productModel.findUnique.mockResolvedValue(
      rawProduct({
        type: 'BUNDLE',
        slug: 'class-10-science-complete-bundle',
        bundleItems: [
          {
            note: {
              slug: 'note-active',
              title: 'Active Note',
              chapterNo: 2,
              status: 'ACTIVE',
            },
          },
          {
            note: {
              slug: 'note-draft',
              title: 'Draft Note',
              chapterNo: 3,
              status: 'DRAFT',
            },
          },
        ],
      }),
    );

    const result = await serviceFor(deps).bySlug(
      'tenant-1',
      'class-10-science-complete-bundle',
    );

    expect(result.bundleItems).toEqual([
      { slug: 'note-active', title: 'Active Note', chapterNo: 2 },
    ]);
  });

  it('(e) filters inBundles to ACTIVE bundles only, mapped to {slug,title,pricePaise}', async () => {
    const deps = buildFakeDeps();
    deps.productModel.findUnique.mockResolvedValue(
      rawProduct({
        inBundles: [
          {
            bundle: {
              slug: 'bundle-active',
              title: 'Active Bundle',
              pricePaise: 49900,
              status: 'ACTIVE',
            },
          },
          {
            bundle: {
              slug: 'bundle-archived',
              title: 'Archived Bundle',
              pricePaise: 39900,
              status: 'ARCHIVED',
            },
          },
        ],
      }),
    );

    const result = await serviceFor(deps).bySlug(
      'tenant-1',
      'class-10-maths-ch1-real-numbers',
    );

    expect(result.inBundles).toEqual([
      { slug: 'bundle-active', title: 'Active Bundle', pricePaise: 49900 },
    ]);
  });

  it('(e) returns empty bundleItems/inBundles arrays when there are none', async () => {
    const deps = buildFakeDeps();
    deps.productModel.findUnique.mockResolvedValue(rawProduct());

    const result = await serviceFor(deps).bySlug(
      'tenant-1',
      'class-10-maths-ch1-real-numbers',
    );

    expect(result.bundleItems).toEqual([]);
    expect(result.inBundles).toEqual([]);
  });
});
