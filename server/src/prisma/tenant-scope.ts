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

/**
 * Injects/stamps `tenantId` into the args of a Prisma model operation.
 * Exempt models (`Tenant`, `BundleItem`, `OrderItem`) pass through untouched.
 *
 * BOUNDARY WARNING — this scoping does NOT cover:
 * - Raw SQL: `$queryRaw` / `$executeRaw` bypass model operations entirely and
 *   are never intercepted. Raw queries must scope by tenant manually.
 * - Nested relational writes: only the top-level `where` / `data` / `create`
 *   are scoped. e.g. `data: { relation: { create: {...} } }` is untouched —
 *   nested creates must carry `tenantId` explicitly.
 *
 * This is the platform's tenant-isolation mechanism; callers relying on it
 * must keep these blind spots in mind.
 */
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
