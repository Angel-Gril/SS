-- CreateEnum
CREATE TYPE "InventoryRecordType" AS ENUM ('IN', 'OUT', 'ADJUST');

-- CreateTable
CREATE TABLE "inventory_items" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "cost_price" DECIMAL(12,2),
    "location" TEXT,
    "remark" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_records" (
    "id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "type" "InventoryRecordType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "cost_price" DECIMAL(12,2),
    "reason" TEXT,
    "operator" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inventory_items_user_id_idx" ON "inventory_items"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_items_user_id_sku_key" ON "inventory_items"("user_id", "sku");

-- CreateIndex
CREATE INDEX "inventory_records_item_id_idx" ON "inventory_records"("item_id");

-- CreateIndex
CREATE INDEX "inventory_records_type_idx" ON "inventory_records"("type");

-- AddForeignKey
ALTER TABLE "inventory_records" ADD CONSTRAINT "inventory_records_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "inventory_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
