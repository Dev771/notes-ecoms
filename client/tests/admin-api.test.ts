import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, apiFetch };
});

const { getAuthToken } = vi.hoisted(() => ({ getAuthToken: vi.fn() }));
vi.mock('@/lib/auth-token', () => ({ getAuthToken }));

import {
  listAdminProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  replaceAliases,
  replaceBundleItems,
  verifyDrive,
  generatePreviews,
} from '@/lib/admin-api';

function okJson(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

function errJson(status: number, body: unknown): Response {
  return { ok: false, status, json: async () => body } as Response;
}

describe('listAdminProducts (read — plain apiFetch)', () => {
  beforeEach(() => {
    apiFetch.mockReset();
  });

  it('GETs /admin/products through apiFetch', async () => {
    apiFetch.mockResolvedValue({ items: [] });

    const result = await listAdminProducts();

    expect(result).toEqual({ items: [] });
    expect(apiFetch).toHaveBeenCalledWith('/admin/products');
  });
});

describe('mutating wrappers (shared adminFetch: auth header + readable error bodies)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    getAuthToken.mockReset();
    getAuthToken.mockReturnValue('test-token');
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function lastCall(): { url: string; init: RequestInit } {
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    return { url, init };
  }

  it('createProduct: POSTs the JSON body with the bearer token attached', async () => {
    const body = {
      type: 'NOTE' as const,
      slug: 'test-slug',
      title: 'Test title',
      classLevel: 10,
      subject: 'SCIENCE' as const,
      pricePaise: 4900,
    };
    fetchMock.mockResolvedValue(okJson({ id: 'p1' }));

    const result = await createProduct(body);

    expect(result).toEqual({ id: 'p1' });
    const { url, init } = lastCall();
    expect(url).toContain('/admin/products');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify(body));
    expect((init.headers as Headers).get('Authorization')).toBe(
      'Bearer test-token',
    );
  });

  it('updateProduct: PATCHes /admin/products/:id, passing explicit nulls through to clear fields', async () => {
    fetchMock.mockResolvedValue(okJson({ id: 'p1', chapterNo: null }));

    await updateProduct('p1', { chapterNo: null, driveFileId: null });

    const { url, init } = lastCall();
    expect(url).toContain('/admin/products/p1');
    expect(init.method).toBe('PATCH');
    // JSON.stringify keeps null-valued keys (unlike undefined) — the null
    // must reach the API to null out the column.
    expect(init.body).toBe('{"chapterNo":null,"driveFileId":null}');
  });

  it('replaceAliases: PUTs the alias array', async () => {
    fetchMock.mockResolvedValue(okJson({ aliases: ['carbon', 'ch 4'] }));

    const result = await replaceAliases('p1', ['carbon', 'ch 4']);

    expect(result).toEqual({ aliases: ['carbon', 'ch 4'] });
    const { url, init } = lastCall();
    expect(url).toContain('/admin/products/p1/aliases');
    expect(init.method).toBe('PUT');
    expect(init.body).toBe(JSON.stringify({ aliases: ['carbon', 'ch 4'] }));
  });

  it('replaceBundleItems: PUTs the noteIds array', async () => {
    fetchMock.mockResolvedValue(okJson({ noteIds: ['n1'] }));

    const result = await replaceBundleItems('b1', ['n1']);

    expect(result).toEqual({ noteIds: ['n1'] });
    const { url, init } = lastCall();
    expect(url).toContain('/admin/products/b1/bundle-items');
    expect(init.method).toBe('PUT');
    expect(init.body).toBe(JSON.stringify({ noteIds: ['n1'] }));
  });

  it('verifyDrive: POSTs and passes the copyProtection shape through untouched', async () => {
    fetchMock.mockResolvedValue(
      okJson({ ok: true, name: 'file.pdf', copyProtection: 'set' }),
    );

    const result = await verifyDrive('p1');

    expect(result).toEqual({
      ok: true,
      name: 'file.pdf',
      copyProtection: 'set',
    });
    const { url, init } = lastCall();
    expect(url).toContain('/admin/products/p1/verify-drive');
    expect(init.method).toBe('POST');
  });

  it('generatePreviews: POSTs to /admin/products/:id/generate-previews', async () => {
    fetchMock.mockResolvedValue(okJson({ jobId: 'job1' }));

    const result = await generatePreviews('p1');

    expect(result).toEqual({ jobId: 'job1' });
    const { url, init } = lastCall();
    expect(url).toContain('/admin/products/p1/generate-previews');
    expect(init.method).toBe('POST');
  });

  it('deleteProduct: resolves { ok: true } on success', async () => {
    fetchMock.mockResolvedValue(okJson({ ok: true }));

    const result = await deleteProduct('p1');

    expect(result).toEqual({ ok: true });
    const { url, init } = lastCall();
    expect(url).toContain('/admin/products/p1');
    expect(init.method).toBe('DELETE');
  });

  it('surfaces the API message string on a 409 conflict', async () => {
    fetchMock.mockResolvedValue(
      errJson(409, {
        message: 'Product has purchase history; archive it instead',
        error: 'Conflict',
        statusCode: 409,
      }),
    );

    await expect(deleteProduct('p1')).rejects.toThrow(
      'Product has purchase history; archive it instead',
    );
  });

  it('joins class-validator message arrays on a 400', async () => {
    fetchMock.mockResolvedValue(
      errJson(400, {
        message: ['slug must match /^[a-z0-9-]+$/', 'pricePaise must be int'],
        error: 'Bad Request',
        statusCode: 400,
      }),
    );

    await expect(createProduct({} as never)).rejects.toThrow(
      'slug must match /^[a-z0-9-]+$/; pricePaise must be int',
    );
  });

  it('falls back to a generic message when the error body is not JSON', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error('not json');
      },
    } as unknown as Response);

    await expect(deleteProduct('p1')).rejects.toThrow(
      'API 500 on /admin/products/p1',
    );
  });
});
