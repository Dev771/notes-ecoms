import { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { SearchService } from './search.service';

// Shape returned by the (mocked) raw query — a superset mirroring the
// `Row` type in search.service.ts (kept private there, so duplicated here
// as a fixture, same approach as CatalogService's spec).
interface RawSearchRow {
  id: string;
  type: string;
  slug: string;
  title: string;
  description: string;
  classLevel: number;
  subject: string;
  chapterNo: number | null;
  pricePaise: number;
  coverPath: string | null;
  previewPaths: string[] | null;
  score: number;
}

function rawRow(overrides: Partial<RawSearchRow> = {}): RawSearchRow {
  return {
    id: 'prod-1',
    type: 'NOTE',
    slug: 'class-10-science-ch4-carbon',
    title: 'Carbon and its Compounds',
    description:
      'Handwritten Class 10 Science notes: Carbon and its Compounds.',
    classLevel: 10,
    subject: 'SCIENCE',
    chapterNo: 4,
    pricePaise: 7900,
    coverPath: null,
    previewPaths: [],
    score: 0.9,
    ...overrides,
  };
}

interface FakeSearchLogModel {
  create: jest.Mock<Promise<{ id: string }>, [unknown]>;
}

interface FakeDeps {
  queryRaw: jest.Mock<Promise<RawSearchRow[]>, [Prisma.Sql]>;
  forTenant: jest.Mock<{ searchLog: FakeSearchLogModel }, [string]>;
  searchLog: FakeSearchLogModel;
  storage: {
    save: jest.Mock<Promise<void>, [string, Buffer]>;
    publicUrl: jest.Mock<string, [string]>;
    remove: jest.Mock<Promise<void>, [string]>;
  };
}

function buildFakeDeps(): FakeDeps {
  const searchLog: FakeSearchLogModel = {
    create: jest
      .fn<Promise<{ id: string }>, [unknown]>()
      .mockResolvedValue({ id: 'log-1' }),
  };
  const queryRaw = jest
    .fn<Promise<RawSearchRow[]>, [Prisma.Sql]>()
    .mockResolvedValue([]);
  const forTenant = jest
    .fn<{ searchLog: FakeSearchLogModel }, [string]>()
    .mockReturnValue({ searchLog });
  const storage = {
    save: jest
      .fn<Promise<void>, [string, Buffer]>()
      .mockResolvedValue(undefined),
    publicUrl: jest
      .fn<string, [string]>()
      .mockImplementation((path) => `https://cdn.example.com/${path}`),
    remove: jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined),
  };
  return { queryRaw, forTenant, searchLog, storage };
}

function serviceFor(deps: FakeDeps): SearchService {
  const prisma = {
    $queryRaw: deps.queryRaw,
    forTenant: deps.forTenant,
  } as unknown as PrismaService;
  return new SearchService(prisma, deps.storage);
}

describe('SearchService#search', () => {
  it('(a) THE ISOLATION LOCK — sql.values sent to $queryRaw contains the tenantId, proving the manual tenant filter is still wired in', async () => {
    const deps = buildFakeDeps();

    await serviceFor(deps).search('tenant-1', 'class 10 science carbon');

    expect(deps.queryRaw).toHaveBeenCalledTimes(1);
    const sqlArg = deps.queryRaw.mock.calls[0][0];
    expect(sqlArg.values).toContain('tenant-1');
  });

  it('(a) parses and forwards classLevel/subject/chapterNo/residual as filter values', async () => {
    const deps = buildFakeDeps();

    await serviceFor(deps).search('tenant-1', 'class 10 science carbon');

    const sqlArg = deps.queryRaw.mock.calls[0][0];
    expect(sqlArg.values).toEqual(
      expect.arrayContaining(['tenant-1', 10, 'SCIENCE', 'carbon']),
    );
  });

  it('(a) a filters-only query (empty residual) still queries, scored by class/chapter/title order', async () => {
    const deps = buildFakeDeps();

    await serviceFor(deps).search('tenant-1', 'class 9');

    const sqlArg = deps.queryRaw.mock.calls[0][0];
    expect(sqlArg.values).toEqual(expect.arrayContaining(['tenant-1', 9]));
    // No non-empty residual → the ILIKE/word_similarity OR-block is never
    // pushed, so the literal SQL text has no "ILIKE" fallback clause.
    expect(sqlArg.sql).not.toContain('ILIKE');
  });

  it('(b) logs the trimmed query and resultCount to SearchLog via forTenant', async () => {
    const deps = buildFakeDeps();
    deps.queryRaw.mockResolvedValue([rawRow(), rawRow({ id: 'prod-2' })]);

    await serviceFor(deps).search('tenant-1', '  carbon  ');

    expect(deps.forTenant).toHaveBeenCalledWith('tenant-1');
    expect(deps.searchLog.create).toHaveBeenCalledWith({
      data: { tenantId: 'tenant-1', query: 'carbon', resultCount: 2 },
    });
  });

  it('(b) logs resultCount 0 for a zero-result query', async () => {
    const deps = buildFakeDeps();
    deps.queryRaw.mockResolvedValue([]);

    await serviceFor(deps).search('tenant-1', 'nonexistent xyz');

    expect(deps.searchLog.create).toHaveBeenCalledWith({
      data: {
        tenantId: 'tenant-1',
        query: 'nonexistent xyz',
        resultCount: 0,
      },
    });
  });

  it('(c) maps coverPath/previewPaths through storage.publicUrl, and omits score/coverPath/previewPaths', async () => {
    const deps = buildFakeDeps();
    deps.queryRaw.mockResolvedValue([
      rawRow({
        coverPath: 'tenants/t1/products/prod-1/cover.jpg',
        previewPaths: [
          'tenants/t1/products/prod-1/preview-1.jpg',
          'tenants/t1/products/prod-1/preview-2.jpg',
        ],
      }),
    ]);

    const [result] = await serviceFor(deps).search('tenant-1', 'carbon');

    expect(deps.storage.publicUrl).toHaveBeenCalledWith(
      'tenants/t1/products/prod-1/cover.jpg',
    );
    expect(deps.storage.publicUrl).toHaveBeenCalledWith(
      'tenants/t1/products/prod-1/preview-1.jpg',
    );
    expect(deps.storage.publicUrl).toHaveBeenCalledWith(
      'tenants/t1/products/prod-1/preview-2.jpg',
    );
    expect(result.coverUrl).toBe(
      'https://cdn.example.com/tenants/t1/products/prod-1/cover.jpg',
    );
    expect(result.previewUrls).toEqual([
      'https://cdn.example.com/tenants/t1/products/prod-1/preview-1.jpg',
      'https://cdn.example.com/tenants/t1/products/prod-1/preview-2.jpg',
    ]);
    expect(result).not.toHaveProperty('score');
    expect(result).not.toHaveProperty('coverPath');
    expect(result).not.toHaveProperty('previewPaths');
  });

  it('(c) coverUrl is null and previewUrls is empty when the product has no cover/previews', async () => {
    const deps = buildFakeDeps();
    deps.queryRaw.mockResolvedValue([
      rawRow({ coverPath: null, previewPaths: [] }),
    ]);

    const [result] = await serviceFor(deps).search('tenant-1', 'carbon');

    expect(result.coverUrl).toBeNull();
    expect(result.previewUrls).toEqual([]);
    expect(deps.storage.publicUrl).not.toHaveBeenCalled();
  });

  it('(c2) REGRESSION: tolerates NULL previewPaths from the raw query (rows created before preview generation; $queryRaw does not normalize NULL scalar lists the way model queries do)', async () => {
    const deps = buildFakeDeps();
    deps.queryRaw.mockResolvedValue([rawRow({ previewPaths: null })]);

    const [result] = await serviceFor(deps).search('tenant-1', 'carbon');

    expect(result.previewUrls).toEqual([]);
  });

  it('(d) truncates a query longer than 100 chars before parsing/filtering/logging', async () => {
    const deps = buildFakeDeps();
    const longQuery = 'a'.repeat(150);

    await serviceFor(deps).search('tenant-1', longQuery);

    expect(deps.searchLog.create).toHaveBeenCalledWith({
      data: {
        tenantId: 'tenant-1',
        query: 'a'.repeat(100),
        resultCount: 0,
      },
    });
    const sqlArg = deps.queryRaw.mock.calls[0][0];
    expect(sqlArg.values).toContain('a'.repeat(100));
    expect(sqlArg.values).not.toContain(longQuery);
  });
});
