-- CreateTable
CREATE TABLE "source_candidates" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "ozon_product_id" TEXT,
    "ozon_url" TEXT,
    "ozon_title" TEXT,
    "ozon_price" DECIMAL(12,2),
    "ozon_currency" TEXT NOT NULL DEFAULT 'RUB',
    "supply_goods_id" TEXT,
    "source_platform" TEXT NOT NULL,
    "source_product_id" TEXT,
    "source_sku" TEXT,
    "source_url" TEXT,
    "source_title" TEXT,
    "source_shop_name" TEXT,
    "source_price" DECIMAL(12,2),
    "source_shipping" DECIMAL(12,2),
    "source_total_cost" DECIMAL(12,2),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_quotes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "candidate_id" TEXT,
    "supply_goods_id" TEXT,
    "key" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'selected_for_costing',
    "ozon_product_id" TEXT,
    "ozon_url" TEXT,
    "ozon_title" TEXT,
    "ozon_price" DECIMAL(12,2),
    "ozon_currency" TEXT NOT NULL DEFAULT 'RUB',
    "source_platform" TEXT NOT NULL,
    "source_product_id" TEXT,
    "source_sku" TEXT,
    "source_url" TEXT,
    "source_title" TEXT,
    "cost_cny" DECIMAL(12,2),
    "source_unit_price" DECIMAL(12,2),
    "source_shipping_cny" DECIMAL(12,2),
    "profit_cny" DECIMAL(12,2),
    "margin_pct" DECIMAL(10,2),
    "quote_payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "source_candidates_user_id_key_key" ON "source_candidates"("user_id", "key");

-- CreateIndex
CREATE INDEX "source_candidates_user_id_ozon_product_id_idx" ON "source_candidates"("user_id", "ozon_product_id");

-- CreateIndex
CREATE INDEX "source_candidates_user_id_source_platform_source_product_id_idx" ON "source_candidates"("user_id", "source_platform", "source_product_id");

-- CreateIndex
CREATE INDEX "source_candidates_supply_goods_id_idx" ON "source_candidates"("supply_goods_id");

-- CreateIndex
CREATE UNIQUE INDEX "source_quotes_user_id_key_key" ON "source_quotes"("user_id", "key");

-- CreateIndex
CREATE INDEX "source_quotes_user_id_ozon_product_id_idx" ON "source_quotes"("user_id", "ozon_product_id");

-- CreateIndex
CREATE INDEX "source_quotes_user_id_source_platform_source_product_id_idx" ON "source_quotes"("user_id", "source_platform", "source_product_id");

-- CreateIndex
CREATE INDEX "source_quotes_candidate_id_idx" ON "source_quotes"("candidate_id");

-- CreateIndex
CREATE INDEX "source_quotes_supply_goods_id_idx" ON "source_quotes"("supply_goods_id");

-- AddForeignKey
ALTER TABLE "source_candidates" ADD CONSTRAINT "source_candidates_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_candidates" ADD CONSTRAINT "source_candidates_supply_goods_id_fkey" FOREIGN KEY ("supply_goods_id") REFERENCES "supply_goods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_quotes" ADD CONSTRAINT "source_quotes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_quotes" ADD CONSTRAINT "source_quotes_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "source_candidates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_quotes" ADD CONSTRAINT "source_quotes_supply_goods_id_fkey" FOREIGN KEY ("supply_goods_id") REFERENCES "supply_goods"("id") ON DELETE SET NULL ON UPDATE CASCADE;
