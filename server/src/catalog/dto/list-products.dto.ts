import { ProductType, Subject } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export type ProductSort = 'newest' | 'price_asc' | 'price_desc';

export const PRODUCT_SORTS: ProductSort[] = [
  'newest',
  'price_asc',
  'price_desc',
];

/**
 * Query params for `GET /products`. Validation only actually *runs* once a
 * global `ValidationPipe` is registered (arrives with Task 6) — until then
 * Nest passes `req.query` through as plain strings without invoking
 * class-validator/class-transformer. The shape below is correct for when
 * that pipe lands: `@Type(() => Number)` coerces `classLevel` from the raw
 * query string, and `@IsOptional` lets every field be omitted.
 */
export class ListProductsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(9)
  @Max(10)
  classLevel?: number;

  @IsOptional()
  @IsEnum(Subject)
  subject?: Subject;

  @IsOptional()
  @IsEnum(ProductType)
  type?: ProductType;

  @IsOptional()
  @IsIn(PRODUCT_SORTS)
  sort?: ProductSort;
}
