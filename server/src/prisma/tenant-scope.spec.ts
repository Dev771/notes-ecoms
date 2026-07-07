import { applyTenantScope } from './tenant-scope';

const TID = 'tenant_1';

describe('applyTenantScope', () => {
  it('injects tenantId into findMany where', () => {
    expect(
      applyTenantScope(
        'Product',
        'findMany',
        { where: { status: 'ACTIVE' } },
        TID,
      ),
    ).toEqual({ where: { status: 'ACTIVE', tenantId: TID } });
  });

  it('creates a where clause when none exists', () => {
    expect(applyTenantScope('Product', 'findMany', undefined, TID)).toEqual({
      where: { tenantId: TID },
    });
  });

  it('injects into findUnique where (filtered unique)', () => {
    expect(
      applyTenantScope('Product', 'findUnique', { where: { id: 'p1' } }, TID),
    ).toEqual({ where: { id: 'p1', tenantId: TID } });
  });

  it('stamps create data', () => {
    expect(
      applyTenantScope('Product', 'create', { data: { title: 'X' } }, TID),
    ).toEqual({ data: { title: 'X', tenantId: TID } });
  });

  it('stamps every row in createMany', () => {
    expect(
      applyTenantScope(
        'Product',
        'createMany',
        { data: [{ title: 'A' }, { title: 'B' }] },
        TID,
      ),
    ).toEqual({
      data: [
        { title: 'A', tenantId: TID },
        { title: 'B', tenantId: TID },
      ],
    });
  });

  it('scopes update/delete/count/aggregate/groupBy through where', () => {
    for (const op of [
      'update',
      'updateMany',
      'delete',
      'deleteMany',
      'count',
      'aggregate',
      'groupBy',
    ]) {
      const out = applyTenantScope('Order', op, { where: { id: 'o1' } }, TID);
      expect(out.where).toEqual({ id: 'o1', tenantId: TID });
    }
  });

  it('scopes upsert where and create, leaves update untouched', () => {
    const out = applyTenantScope(
      'User',
      'upsert',
      {
        where: { tenantId_authId: { tenantId: TID, authId: 'a1' } },
        create: { authId: 'a1' },
        update: { name: 'N' },
      },
      TID,
    );
    expect(out).toEqual({
      where: {
        tenantId_authId: { tenantId: TID, authId: 'a1' },
        tenantId: TID,
      },
      create: { authId: 'a1', tenantId: TID },
      update: { name: 'N' },
    });
  });

  it('leaves exempt models untouched', () => {
    for (const model of ['Tenant', 'BundleItem', 'OrderItem']) {
      const args = { where: { id: 'x' } };
      expect(applyTenantScope(model, 'findMany', args, TID)).toEqual(args);
    }
  });
});
