import { describe, it, expect, vi, beforeEach } from 'vitest';

const { apiServerFetch } = vi.hoisted(() => ({ apiServerFetch: vi.fn() }));
vi.mock('@/lib/api-server', () => ({ apiServerFetch }));

import { fetchProducts, searchProducts } from '@/lib/catalog';

const product = {
  id: '1',
  type: 'NOTE' as const,
  slug: 'carbon-and-its-compounds',
  title: 'Carbon and its Compounds',
  description: '',
  classLevel: 10,
  subject: 'SCIENCE' as const,
  chapterNo: 4,
  pricePaise: 4900,
  coverUrl: null,
  previewUrls: [],
};

describe('fetchProducts', () => {
  beforeEach(() => {
    apiServerFetch.mockReset();
  });

  it('unwraps the { items } envelope and builds a query string from set params', async () => {
    apiServerFetch.mockResolvedValue({ items: [product] });

    const result = await fetchProducts({
      classLevel: '10',
      subject: 'SCIENCE',
      sort: 'newest',
    });

    expect(result).toEqual([product]);
    expect(apiServerFetch).toHaveBeenCalledWith(
      '/products?classLevel=10&subject=SCIENCE&sort=newest',
    );
  });

  it('omits empty/undefined params instead of sending them blank', async () => {
    apiServerFetch.mockResolvedValue({ items: [] });

    await fetchProducts({
      classLevel: undefined,
      subject: '',
      sort: undefined,
    });

    expect(apiServerFetch).toHaveBeenCalledWith('/products');
  });

  it('returns [] and warns instead of throwing when the API call fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    apiServerFetch.mockRejectedValue(new Error('API 503 on /products'));

    const result = await fetchProducts();

    expect(result).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('searchProducts', () => {
  beforeEach(() => {
    apiServerFetch.mockReset();
  });

  it('returns the bare-array response as-is (no { items } envelope)', async () => {
    apiServerFetch.mockResolvedValue([product]);

    const result = await searchProducts('carbon');

    expect(result).toEqual([product]);
    expect(apiServerFetch).toHaveBeenCalledWith('/search?q=carbon');
  });

  it('returns [] and warns instead of throwing when the API call fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    apiServerFetch.mockRejectedValue(new Error('network error'));

    const result = await searchProducts('carbon');

    expect(result).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
