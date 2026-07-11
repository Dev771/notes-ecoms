import { BadRequestException } from '@nestjs/common';
import type { Tenant } from '@prisma/client';
import { SearchController } from './search.controller';
import type { SearchService } from './search.service';

const tenant = { id: 'tenant-1' } as unknown as Tenant;

function controllerWith(search: jest.Mock) {
  const searchService = { search } as unknown as SearchService;
  return new SearchController(searchService);
}

describe('SearchController#search', () => {
  it.each([undefined, '', '   '])(
    '400s on blank/missing q (%p) without calling SearchService',
    async (q) => {
      const search = jest.fn();
      const controller = controllerWith(search);

      await expect(controller.search(tenant, q)).rejects.toThrow(
        BadRequestException,
      );
      expect(search).not.toHaveBeenCalled();
    },
  );

  it('delegates to SearchService.search(tenant.id, q) and returns the BARE array (cross-task contract: no { items } envelope on /search)', async () => {
    const search = jest.fn().mockResolvedValue([{ id: 'prod-1' }]);
    const controller = controllerWith(search);

    const result = await controller.search(tenant, 'carbon');

    expect(search).toHaveBeenCalledWith('tenant-1', 'carbon');
    expect(result).toEqual([{ id: 'prod-1' }]);
  });
});
