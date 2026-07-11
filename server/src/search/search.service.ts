import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ProductType, Subject } from '@prisma/client';
import type { PublicProduct } from '../catalog/catalog.service';
import { PrismaService } from '../prisma/prisma.service';
import { STORAGE_PROVIDER } from '../storage/storage.provider';
import type { StorageProvider } from '../storage/storage.provider';
import { parseAcademicQuery } from './query-parser';

/**
 * Shape of a row from the raw trigram-search SELECT below. `$queryRaw`'s
 * generic parameter is a compile-time assertion only (Prisma does not
 * validate it at runtime), so `type`/`subject` are typed as the real Prisma
 * enums — the SELECTed columns really are those Postgres enum types.
 */
type Row = {
  id: string;
  type: ProductType;
  slug: string;
  title: string;
  description: string;
  classLevel: number;
  subject: Subject;
  chapterNo: number | null;
  pricePaise: number;
  coverPath: string | null;
  // Raw queries return the naked column value: rows created before preview
  // generation have NULL here (no DB default), which Prisma's model queries
  // normalize to [] but $queryRaw does not.
  previewPaths: string[] | null;
  score: number;
};

@Injectable()
export class SearchService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  /**
   * Typo-tolerant academic search: parses class/subject/chapter hints out of
   * the query, trigram-ranks the remaining text against title + aliases,
   * logs the query to SearchLog, and maps results to the public shape.
   *
   * RAW SQL — bypasses PrismaService's tenant-scoping extension by design
   * (trigram ranking needs Postgres functions Prisma can't express as a
   * model query). `tenantId` is included MANUALLY in the WHERE clause below.
   * This is the ONE sanctioned raw-SQL exception in the codebase; the
   * isolation spec case in search.service.spec.ts guards it — if the manual
   * tenant filter is ever removed, that test fails.
   */
  async search(tenantId: string, rawQ: string): Promise<PublicProduct[]> {
    const q = rawQ.trim().slice(0, 100);
    const parsed = parseAcademicQuery(q);
    const residual = parsed.residual;

    const filters: Prisma.Sql[] = [
      Prisma.sql`p."tenantId" = ${tenantId}`,
      Prisma.sql`p.status = 'ACTIVE'`,
    ];
    if (parsed.classLevel)
      filters.push(Prisma.sql`p."classLevel" = ${parsed.classLevel}`);
    if (parsed.subject)
      filters.push(Prisma.sql`p.subject = ${parsed.subject}::"Subject"`);
    if (parsed.chapterNo !== undefined)
      filters.push(Prisma.sql`p."chapterNo" = ${parsed.chapterNo}`);
    if (residual.length > 0) {
      filters.push(Prisma.sql`(
        word_similarity(${residual}, p.title) > 0.2
        OR p.title ILIKE '%' || ${residual} || '%'
        OR EXISTS (
          SELECT 1 FROM "ProductAlias" a
          WHERE a."productId" = p.id
            AND (word_similarity(${residual}, a.alias) > 0.25 OR a.alias ILIKE '%' || ${residual} || '%')
        )
      )`);
    }

    const rows = await this.prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT p.id, p.type, p.slug, p.title, p.description, p."classLevel",
             p.subject, p."chapterNo", p."pricePaise", p."coverPath", p."previewPaths",
             GREATEST(
               word_similarity(${residual}, p.title),
               COALESCE((SELECT MAX(word_similarity(${residual}, a.alias))
                         FROM "ProductAlias" a WHERE a."productId" = p.id), 0)
             ) AS score
      FROM "Product" p
      WHERE ${Prisma.join(filters, ' AND ')}
      ORDER BY score DESC, p."classLevel" ASC, p."chapterNo" ASC NULLS LAST, p.title ASC
      LIMIT 20
    `);

    // tenantId is also injected by the tenant-scope Prisma extension at
    // runtime; it's supplied here too so the literal satisfies Prisma's
    // SearchLogUncheckedCreateInput at compile time (harmless — same value;
    // see UsersService.ensureUserRecord for the same pattern).
    // Analytics logging must never fail a user's search — one lost log row
    // is acceptable; a 500 on valid results is not.
    await this.prisma
      .forTenant(tenantId)
      .searchLog.create({
        data: { tenantId, query: q, resultCount: rows.length },
      })
      .catch((e: unknown) => {
        Logger.warn(
          `SearchLog write failed: ${e instanceof Error ? e.message : String(e)}`,
          SearchService.name,
        );
      });

    // Explicit field mapping (rather than destructure-and-spread the raw
    // row) mirrors CatalogService#toPublicProduct: drops `score` and maps
    // `coverPath`/`previewPaths` to public URLs via bound arrow functions
    // (`(p) => this.storage.publicUrl(p)` — a bare method reference loses
    // `this` inside `LocalDiskStorage.publicUrl`).
    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      slug: row.slug,
      title: row.title,
      description: row.description,
      classLevel: row.classLevel,
      subject: row.subject,
      chapterNo: row.chapterNo,
      pricePaise: row.pricePaise,
      coverUrl: row.coverPath ? this.storage.publicUrl(row.coverPath) : null,
      previewUrls: (row.previewPaths ?? []).map((p) =>
        this.storage.publicUrl(p),
      ),
    }));
  }
}
