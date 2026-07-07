CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "Product_title_trgm_idx" ON "Product" USING GIN ("title" gin_trgm_ops);
CREATE INDEX "ProductAlias_alias_trgm_idx" ON "ProductAlias" USING GIN ("alias" gin_trgm_ops);
