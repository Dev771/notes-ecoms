import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  Product,
  ProductStatus,
  ProductType,
  Subject,
  Tenant,
} from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { DriveService } from '../drive/drive.service';
import { JobsService } from '../jobs/jobs.service';
import { PrismaService } from '../prisma/prisma.service';
import { STORAGE_PROVIDER } from '../storage/storage.provider';
import type { StorageProvider } from '../storage/storage.provider';
import { CurrentTenant } from '../tenant/current-tenant.decorator';
import {
  CreateProductDto,
  ReplaceAliasesDto,
  ReplaceBundleItemsDto,
  UpdateProductDto,
} from './dto/product.dto';

/**
 * Full admin projection of a Product. Unlike the public catalog projection
 * (CatalogService.PublicProduct), this keeps internal fields (status,
 * driveFileId, previewPages) — but still resolves coverPath/previewPaths
 * (raw storage paths) to public URLs via StorageProvider rather than
 * exposing them directly, mirroring the catalog task's convention.
 */
export interface AdminProduct {
  id: string;
  type: ProductType;
  slug: string;
  title: string;
  description: string;
  classLevel: number;
  subject: Subject;
  chapterNo: number | null;
  pricePaise: number;
  driveFileId: string | null;
  previewPages: number[];
  status: ProductStatus;
  coverUrl: string | null;
  previewUrls: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminProductListItem extends AdminProduct {
  aliasCount: number;
  bundleItemCount: number;
}

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminProductsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly drive: DriveService,
    private readonly jobs: JobsService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  @Get('products')
  async list(
    @CurrentTenant() tenant: Tenant,
  ): Promise<{ items: AdminProductListItem[] }> {
    const db = this.prisma.forTenant(tenant.id);
    const products = await db.product.findMany({
      include: { _count: { select: { aliases: true, bundleItems: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return {
      items: products.map((p) => ({
        ...this.toAdminProduct(p),
        aliasCount: p._count.aliases,
        bundleItemCount: p._count.bundleItems,
      })),
    };
  }

  @Post('products')
  async create(
    @CurrentTenant() tenant: Tenant,
    @Body() dto: CreateProductDto,
  ): Promise<AdminProduct> {
    const db = this.prisma.forTenant(tenant.id);
    try {
      const product = await db.product.create({
        data: {
          ...dto,
          previewPages: dto.previewPages ?? [],
          // tenantId is also injected by the tenant-scope Prisma extension
          // at runtime; supplied here too so the literal satisfies Prisma's
          // ProductUncheckedCreateInput at compile time (harmless — same
          // value). See JobsService.enqueue / UsersService for the same
          // pattern elsewhere in this codebase.
          tenantId: tenant.id,
        },
      });
      return this.toAdminProduct(product);
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException(
          `Product slug "${dto.slug}" already exists`,
        );
      }
      throw e;
    }
  }

  @Patch('products/:id')
  async update(
    @CurrentTenant() tenant: Tenant,
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
  ): Promise<AdminProduct> {
    const db = this.prisma.forTenant(tenant.id);
    try {
      const product = await db.product.update({ where: { id }, data: dto });
      return this.toAdminProduct(product);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError) {
        if (e.code === 'P2002') {
          throw new ConflictException(
            `Product slug "${dto.slug}" already exists`,
          );
        }
        if (e.code === 'P2025') {
          throw new NotFoundException(`Product not found: ${id}`);
        }
      }
      throw e;
    }
  }

  @Delete('products/:id')
  async remove(
    @CurrentTenant() tenant: Tenant,
    @Param('id') id: string,
  ): Promise<{ ok: true }> {
    const db = this.prisma.forTenant(tenant.id);

    // Tenant-scoped existence check FIRST, before anything else runs:
    // BundleItem and OrderItem are EXEMPT from tenant scoping, so without
    // this guard a tenant-A admin calling DELETE with tenant-B's product id
    // would reach the bundle-link cleanup below and destroy B's bundle
    // wiring — then get a 404 that hides it ever happened.
    const product = await db.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException(`Product not found: ${id}`);

    const [entitlementCount, orderItemCount] = await Promise.all([
      db.entitlement.count({ where: { productId: id } }),
      // OrderItem is EXEMPT from tenant scoping (parent-scoped through
      // Order) — the raw (non-forTenant) client is used deliberately here;
      // ids are globally-unique cuids so counting by productId alone can't
      // leak or miscount across tenants.
      this.prisma.orderItem.count({ where: { productId: id } }),
    ]);
    if (entitlementCount > 0 || orderItemCount > 0) {
      throw new ConflictException(
        'Product has purchase history; archive it instead',
      );
    }

    try {
      // Aliases + bundle links + the product row go all-or-nothing: a
      // mid-sequence failure must not leave the product stripped of its
      // aliases (or with dangling bundle links) yet still present. The
      // $extends client exposes $transaction, and the tenant-scope
      // extension still applies inside the callback.
      await db.$transaction(async (tx) => {
        await tx.productAlias.deleteMany({ where: { productId: id } });
        // BundleItem is EXEMPT from tenant scoping (no tenantId column;
        // parent-scoped through Product) — the scoped client passes its
        // args through untouched, so this behaves exactly like a raw-client
        // call while still participating in the transaction. Tenant-safe
        // because the existence check above proved `id` is ours.
        await tx.bundleItem.deleteMany({
          where: { OR: [{ bundleId: id }, { noteId: id }] },
        });
        await tx.product.delete({ where: { id } });
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2025'
      ) {
        // Deleted concurrently between the existence check and the
        // transaction — same observable outcome as "never existed".
        throw new NotFoundException(`Product not found: ${id}`);
      }
      throw e;
    }
    return { ok: true };
  }

  @Put('products/:id/aliases')
  async replaceAliases(
    @CurrentTenant() tenant: Tenant,
    @Param('id') id: string,
    @Body() dto: ReplaceAliasesDto,
  ): Promise<{ aliases: string[] }> {
    const db = this.prisma.forTenant(tenant.id);
    const product = await db.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException(`Product not found: ${id}`);

    // Replace-all must be atomic: a failure after deleteMany would
    // otherwise leave the product alias-less.
    await db.$transaction(async (tx) => {
      await tx.productAlias.deleteMany({ where: { productId: id } });
      if (dto.aliases.length > 0) {
        await tx.productAlias.createMany({
          data: dto.aliases.map((alias) => ({
            productId: id,
            alias,
            // See create()'s comment — tenantId is stamped again at runtime
            // by the tenant-scope extension's createMany handling, but is
            // required here too to satisfy ProductAliasCreateManyInput.
            tenantId: tenant.id,
          })),
        });
      }
    });
    return { aliases: dto.aliases };
  }

  @Put('products/:id/bundle-items')
  async replaceBundleItems(
    @CurrentTenant() tenant: Tenant,
    @Param('id') id: string,
    @Body() dto: ReplaceBundleItemsDto,
  ): Promise<{ noteIds: string[] }> {
    const db = this.prisma.forTenant(tenant.id);
    const bundle = await db.product.findUnique({ where: { id } });
    if (!bundle) throw new NotFoundException(`Product not found: ${id}`);
    if (bundle.type !== 'BUNDLE') {
      throw new BadRequestException(
        'Only BUNDLE products can have bundle items',
      );
    }

    // Tenant-scoped lookup: a noteId belonging to another tenant, or one
    // that isn't a NOTE, simply won't come back from this query — both are
    // rejected identically below as "unresolved".
    const resolved =
      dto.noteIds.length === 0
        ? []
        : await db.product.findMany({
            where: { id: { in: dto.noteIds }, type: 'NOTE' },
            select: { id: true },
          });
    if (resolved.length !== dto.noteIds.length) {
      throw new BadRequestException(
        'One or more noteIds do not resolve to a NOTE product in this tenant',
      );
    }

    // Replace-all must be atomic (delete+create all-or-nothing). BundleItem
    // is EXEMPT from tenant scoping (no tenantId column; parent-scoped
    // through Product) — the scoped client passes its args through
    // untouched, i.e. these behave exactly like raw-client calls while
    // participating in the transaction. Tenant safety comes from the
    // bundle existence check + tenant-scoped NOTE resolution above.
    await db.$transaction(async (tx) => {
      await tx.bundleItem.deleteMany({ where: { bundleId: id } });
      if (dto.noteIds.length > 0) {
        await tx.bundleItem.createMany({
          data: dto.noteIds.map((noteId) => ({ bundleId: id, noteId })),
        });
      }
    });
    return { noteIds: dto.noteIds };
  }

  @Post('products/:id/verify-drive')
  async verifyDrive(
    @CurrentTenant() tenant: Tenant,
    @Param('id') id: string,
  ): Promise<{
    ok: true;
    name: string;
    copyProtection: 'set' | 'owner_action_required';
  }> {
    const db = this.prisma.forTenant(tenant.id);
    const product = await db.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException(`Product not found: ${id}`);
    if (!product.driveFileId) {
      throw new BadRequestException('Product has no driveFileId to verify');
    }
    // Updates nothing on the product itself. Genuine access problems
    // (file missing / not shared with the SA) propagate as 404/403 here.
    const meta = await this.drive.getFileMeta(product.driveFileId);
    // Type check BEFORE any copy-protection logic: folders (and any other
    // non-PDF) have metadata too, so getFileMeta succeeding proves nothing
    // about the id being a usable note file. A pasted /drive/folders/ id
    // would otherwise reach the flag PATCH below and die as a Google 400.
    if (meta.mimeType === 'application/vnd.google-apps.folder') {
      throw new UnprocessableEntityException(
        'This Drive ID is a FOLDER — open the PDF itself in Drive and copy the ID from its /file/d/<id>/view URL',
      );
    }
    if (meta.mimeType !== 'application/pdf') {
      throw new UnprocessableEntityException(
        `Drive file is ${meta.mimeType}, not a PDF — notes must be PDF files`,
      );
    }
    // Read-first: the copyProtection signal is derived from the file's
    // ACTUAL state, not from whether our own write succeeded — that is
    // what keeps it truthful after the owner has toggled "Viewers can't
    // download" themselves (the SA's write below would 403 forever on
    // consumer Drive, saying nothing about the flag's current value).
    if (meta.copyRequiresWriterPermission) {
      return { ok: true, name: meta.name, copyProtection: 'set' };
    }
    // Not protected yet — try to set it. copyRequiresWriterPermission is
    // an OWNER-gated flag on consumer (non-Workspace) Drive files: the
    // platform service account — an Editor at best on client-owned files
    // — gets 403 trying to set it. That is NOT an access failure (the
    // meta read just succeeded), so it must not fail the endpoint:
    // surface the state and let the file's owner flip the flag.
    let copyProtection: 'set' | 'owner_action_required' = 'set';
    try {
      await this.drive.setCopyProtection(product.driveFileId);
    } catch (e) {
      if (!(e instanceof ForbiddenException)) throw e;
      copyProtection = 'owner_action_required';
    }
    return { ok: true, name: meta.name, copyProtection };
  }

  @Post('products/:id/generate-previews')
  async generatePreviews(
    @CurrentTenant() tenant: Tenant,
    @Param('id') id: string,
  ): Promise<{ jobId: string }> {
    const db = this.prisma.forTenant(tenant.id);
    const product = await db.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException(`Product not found: ${id}`);
    if (!product.driveFileId) {
      throw new BadRequestException(
        'Product has no driveFileId to generate previews from',
      );
    }
    const job = await this.jobs.enqueue(tenant.id, 'PREVIEW_GENERATION', {
      productId: id,
    });
    return { jobId: job.id };
  }

  @Post('tenant/verify-drive')
  async verifyTenantDrive(
    @CurrentTenant() tenant: Tenant,
  ): Promise<{ ok: true; name: string }> {
    if (!tenant.driveRootFolderId) {
      throw new BadRequestException(
        'Tenant has no driveRootFolderId configured',
      );
    }
    try {
      const result = await this.drive.verifyAccess(tenant.driveRootFolderId);
      // Tenant is EXEMPT from tenant scoping — this.prisma.tenant.update
      // (the raw, non-forTenant client) is used deliberately: forTenant()'s
      // scoping would stamp a tenantId where-filter the Tenant model itself
      // doesn't carry.
      await this.prisma.tenant.update({
        where: { id: tenant.id },
        data: { driveStatus: 'VERIFIED' },
      });
      return result;
    } catch (e) {
      if (e instanceof NotFoundException || e instanceof ForbiddenException) {
        await this.prisma.tenant.update({
          where: { id: tenant.id },
          data: { driveStatus: 'ERROR' },
        });
      }
      throw e;
    }
  }

  private toAdminProduct(product: Product): AdminProduct {
    return {
      id: product.id,
      type: product.type,
      slug: product.slug,
      title: product.title,
      description: product.description,
      classLevel: product.classLevel,
      subject: product.subject,
      chapterNo: product.chapterNo,
      pricePaise: product.pricePaise,
      driveFileId: product.driveFileId,
      previewPages: product.previewPages,
      status: product.status,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
      coverUrl: product.coverPath
        ? this.storage.publicUrl(product.coverPath)
        : null,
      previewUrls: product.previewPaths.map((path) =>
        this.storage.publicUrl(path),
      ),
    };
  }
}
