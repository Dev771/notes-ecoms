import { PartialType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ProductStatus, ProductType, Subject } from '@prisma/client';

export class CreateProductDto {
  @IsEnum(ProductType) type!: ProductType;
  @IsString() @MaxLength(120) @Matches(/^[a-z0-9-]+$/) slug!: string;
  @IsString() @MaxLength(200) title!: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsInt() @Min(9) @Max(10) classLevel!: number;
  @IsEnum(Subject) subject!: Subject;
  @IsOptional() @IsInt() @Min(1) @Max(30) chapterNo?: number;
  @IsInt() @Min(0) @Max(10_000_000) pricePaise!: number;
  @IsOptional() @IsString() @MaxLength(120) driveFileId?: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(500, { each: true })
  @Type(() => Number)
  previewPages?: number[];
  @IsOptional() @IsEnum(ProductStatus) status?: ProductStatus;
}

// PATCH semantics via @nestjs/mapped-types: every CreateProductDto field
// becomes optional (validators still apply to whichever fields are present).
export class UpdateProductDto extends PartialType(CreateProductDto) {}

export class ReplaceAliasesDto {
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  aliases!: string[];
}

export class ReplaceBundleItemsDto {
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  // cuids are ~25 chars; 40 leaves headroom without accepting junk.
  @MaxLength(40, { each: true })
  noteIds!: string[];
}
