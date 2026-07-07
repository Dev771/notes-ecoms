const EXEMPT_MODELS = new Set(['Tenant', 'BundleItem', 'OrderItem']);

const WHERE_OPS = new Set([
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'findUnique',
  'findUniqueOrThrow',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
  'count',
  'aggregate',
  'groupBy',
]);

type Args = Record<string, unknown>;

export function applyTenantScope(
  model: string,
  operation: string,
  args: Args | undefined,
  tenantId: string,
): Args {
  if (EXEMPT_MODELS.has(model)) return args ?? {};
  const out: Args = { ...(args ?? {}) };

  if (WHERE_OPS.has(operation)) {
    out.where = { ...(out.where ?? {}), tenantId };
  }
  if (operation === 'create') {
    out.data = { ...(out.data ?? {}), tenantId };
  }
  if (operation === 'createMany') {
    out.data = ((out.data as Args[]) ?? []).map((d) => ({ ...d, tenantId }));
  }
  if (operation === 'upsert') {
    out.where = { ...(out.where ?? {}), tenantId };
    out.create = { ...(out.create ?? {}), tenantId };
  }
  return out;
}
