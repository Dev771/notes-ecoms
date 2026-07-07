const EXEMPT_MODELS = new Set(['Tenant', 'BundleItem', 'OrderItem']);

const WHERE_OPS = new Set([
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'findUnique',
  'findUniqueOrThrow',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
  'count',
  'aggregate',
  'groupBy',
]);

const CREATE_MANY_OPS = new Set(['createMany', 'createManyAndReturn']);

// All Prisma model operations this function knows how to scope. Anything
// else reaching $allModels.$allOperations for a non-exempt model is refused
// below (default-deny) rather than allowed to pass through unscoped.
const KNOWN_OPS = new Set<string>([
  ...WHERE_OPS,
  'create',
  ...CREATE_MANY_OPS,
  'upsert',
]);

type Args = Record<string, unknown>;

/**
 * Injects/stamps `tenantId` into the args of a Prisma model operation.
 * Exempt models (`Tenant`, `BundleItem`, `OrderItem`) pass through untouched,
 * including for operations this function doesn't otherwise recognize.
 *
 * DEFAULT-DENY: for non-exempt models, any operation not in `KNOWN_OPS`
 * throws instead of passing through unscoped. Unknown future Prisma
 * operations (e.g. a new bulk op) must be explicitly taught to this
 * function before they can be used — they must never silently bypass
 * tenant scoping.
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

  if (!KNOWN_OPS.has(operation)) {
    throw new Error(
      `applyTenantScope: unhandled Prisma operation "${operation}" on ${model} — add scoping rules before use`,
    );
  }

  const out: Args = { ...(args ?? {}) };

  if (WHERE_OPS.has(operation)) {
    out.where = { ...(out.where ?? {}), tenantId };
  }
  if (operation === 'create') {
    out.data = { ...(out.data ?? {}), tenantId };
  }
  if (CREATE_MANY_OPS.has(operation)) {
    out.data = ((out.data as Args[]) ?? []).map((d) => ({ ...d, tenantId }));
  }
  if (operation === 'upsert') {
    out.where = { ...(out.where ?? {}), tenantId };
    out.create = { ...(out.create ?? {}), tenantId };
  }
  return out;
}
