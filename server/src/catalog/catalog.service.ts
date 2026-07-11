import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, Product, ProductType, Subject } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { STORAGE_PROVIDER } from '../storage/storage.provider';
import type { StorageProvider } from '../storage/storage.provider';
import type { ListProductsDto, ProductSort } from './dto/list-products.dto';

/**
 * Public projection of a Product — deliberately excludes `status`,
 * `driveFileId`, `coverPath`/`previewPaths` (raw storage paths) and any other
 * internal field. `coverPath`/`previewPaths` are resolved to public URLs via
 * StorageProvider instead of being exposed directly.
 */
export interface PublicProduct {
  id: string;
  type: ProductType;
  slug: string;
  title: string;
  description: string;
  classLevel: number;
  subject: Subject;
  chapterNo: number | null;
  pricePaise: number;
  coverUrl: string | null;
  previewUrls: string[];
}

export interface PublicBundleItem {
  slug: string;
  title: string;
  chapterNo: number | null;
}

export interface PublicInBundle {
  slug: string;
  title: string;
  pricePaise: number;
}

export interface PublicProductDetail extends PublicProduct {
  /** Notes contained in this product, when it's a bundle — ACTIVE only. */
  bundleItems: PublicBundleItem[];
  /** Bundles this product (a note) is upsold in — ACTIVE only. */
  inBundles: PublicInBundle[];
}

const SORT_TO_ORDER_BY: Record<
  ProductSort,
  Prisma.ProductOrderByWithRelationInput
> = {
  newest: { createdAt: 'desc' },
  price_asc: { pricePaise: 'asc' },
  price_desc: { pricePaise: 'desc' },
};

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  /** Public catalog listing — ACTIVE products only, optionally filtered. */
  async list(tenantId: string, dto: ListProductsDto): Promise<PublicProduct[]> {
    const { classLevel, subject, type, sort } = dto;
    const db = this.prisma.forTenant(tenantId);
    const products = await db.product.findMany({
      where: {
        status: 'ACTIVE',
        ...(classLevel && { classLevel }),
        ...(subject && { subject }),
        ...(type && { type }),
      },
      orderBy: SORT_TO_ORDER_BY[sort ?? 'newest'],
    });
    return products.map((product) => this.toPublicProduct(product));
  }

  /**
   * Public product detail by slug, plus upsell data (sibling notes for a
   * bundle, or bundles a note is sold inside). 404s for a missing product,
   * a product belonging to another tenant, or a non-ACTIVE product —
   * DRAFT/ARCHIVED products must be indistinguishable from "doesn't exist"
   * to unauthenticated storefront visitors.
   */
  async bySlug(tenantId: string, slug: string): Promise<PublicProductDetail> {
    const db = this.prisma.forTenant(tenantId);
    const product = await db.product.findUnique({
      where: { tenantId_slug: { tenantId, slug } },
      include: {
        bundleItems: {
          include: {
            note: {
              select: {
                slug: true,
                title: true,
                chapterNo: true,
                status: true,
              },
            },
          },
        },
        inBundles: {
          include: {
            bundle: {
              select: {
                slug: true,
                title: true,
                pricePaise: true,
                status: true,
              },
            },
          },
        },
      },
    });

    if (!product || product.status !== 'ACTIVE') {
      throw new NotFoundException(`Product not found: ${slug}`);
    }

    return {
      ...this.toPublicProduct(product),
      bundleItems: product.bundleItems
        .filter((item) => item.note.status === 'ACTIVE')
        .map((item) => ({
          slug: item.note.slug,
          title: item.note.title,
          chapterNo: item.note.chapterNo,
        })),
      inBundles: product.inBundles
        .filter((item) => item.bundle.status === 'ACTIVE')
        .map((item) => ({
          slug: item.bundle.slug,
          title: item.bundle.title,
          pricePaise: item.bundle.pricePaise,
        })),
    };
  }

  private toPublicProduct(product: Product): PublicProduct {
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
      coverUrl: product.coverPath
        ? this.storage.publicUrl(product.coverPath)
        : null,
      previewUrls: product.previewPaths.map((path) =>
        this.storage.publicUrl(path),
      ),
    };
  }
}
