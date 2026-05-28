-- AlterEnum
ALTER TYPE "SyncJobType" ADD VALUE 'RETURN_PULL';

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "domestic_carrier" TEXT,
ADD COLUMN     "domestic_status" TEXT DEFAULT 'pending',
ADD COLUMN     "domestic_tracking_number" TEXT,
ADD COLUMN     "fee_deducted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "inspection_note" TEXT,
ADD COLUMN     "inspection_photos" JSONB,
ADD COLUMN     "inspection_status" TEXT,
ADD COLUMN     "international_carrier" TEXT,
ADD COLUMN     "international_status" TEXT DEFAULT 'pending',
ADD COLUMN     "international_tracking_number" TEXT,
ADD COLUMN     "purchase_amount" DECIMAL(12,2),
ADD COLUMN     "purchase_order_id" TEXT,
ADD COLUMN     "purchase_platform" TEXT,
ADD COLUMN     "service_fee" DECIMAL(10,2),
ADD COLUMN     "service_tags" JSONB,
ADD COLUMN     "shipping_fee" DECIMAL(10,2),
ADD COLUMN     "solo_fee" DECIMAL(10,2),
ADD COLUMN     "solo_fee_billed_at" TIMESTAMP(3),
ADD COLUMN     "user_color_tags" JSONB;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "commission_rate" DECIMAL(5,2),
ADD COLUMN     "min_price" DECIMAL(12,2),
ADD COLUMN     "model_id" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "active_portal" TEXT NOT NULL DEFAULT 'user',
ADD COLUMN     "can_invite" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "can_publish_address" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "custom_color_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "invite_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "invite_limit" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "is_transit_provider" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "per_order_fee" DECIMAL(10,2),
ADD COLUMN     "platform_fee" DECIMAL(10,2),
ADD COLUMN     "provider_fee" DECIMAL(10,2),
ADD COLUMN     "tenant_type" TEXT NOT NULL DEFAULT 'transit';

-- CreateTable
CREATE TABLE "returns" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "platform_return_id" TEXT NOT NULL,
    "posting_number" TEXT,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "reason_code" TEXT,
    "product" JSONB,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "amount" DECIMAL(12,2),
    "currency" TEXT NOT NULL DEFAULT 'RUB',
    "returned_to_warehouse" BOOLEAN NOT NULL DEFAULT false,
    "accepted_at" TIMESTAMP(3),
    "returned_at" TIMESTAMP(3),
    "raw" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "express_issues" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "order_id" TEXT,
    "posting_number" TEXT,
    "tracking_number" TEXT,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "resolution" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "express_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supply_goods" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "source_url" TEXT,
    "source_platform" TEXT,
    "supplier" TEXT,
    "purchase_price" DECIMAL(12,2),
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "sku" TEXT,
    "images" JSONB,
    "variants" JSONB,
    "model_id" TEXT,
    "mapped_product_id" TEXT,
    "notes" TEXT,
    "metadata" JSONB,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supply_goods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT,
    "link" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_tag_configs" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "description" TEXT,
    "fee" DECIMAL(10,2) NOT NULL,
    "need_inspection" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_tag_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouse_logs" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "operation_type" TEXT NOT NULL,
    "operator_id" TEXT,
    "tracking_number" TEXT,
    "note" TEXT,
    "photos" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "warehouse_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "balance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "credit_limit" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "billing_mode" TEXT NOT NULL DEFAULT 'prepaid',
    "frozen_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "balance_after" DECIMAL(12,2) NOT NULL,
    "order_id" TEXT,
    "description" TEXT,
    "operator" TEXT,
    "ip" TEXT,
    "module" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "logistics_bills" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "order_id" TEXT,
    "tracking_number" TEXT NOT NULL,
    "weight" INTEGER,
    "fee" DECIMAL(10,2) NOT NULL,
    "country" TEXT,
    "shipping_method" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "settled_at" TIMESTAMP(3),
    "remark" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "logistics_bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cainiao_packages" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "tracking_number" TEXT NOT NULL,
    "carrier" TEXT,
    "carrier_code" TEXT,
    "status" TEXT,
    "status_desc" TEXT,
    "update_time" TEXT,
    "sender" TEXT,
    "receiver" TEXT,
    "bound_to_order_id" TEXT,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cainiao_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shop_analytics_snapshots" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "period" TEXT NOT NULL DEFAULT '30d',
    "data" JSONB NOT NULL,
    "product_count" INTEGER NOT NULL DEFAULT 0,
    "total_sales" DECIMAL(14,2),
    "total_orders" INTEGER,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shop_analytics_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shop_billing_configs" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "per_order_fee" DECIMAL(10,2) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shop_billing_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "solo_billing_snapshots" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "order_count" INTEGER NOT NULL DEFAULT 0,
    "total_fee" DECIMAL(12,2) NOT NULL,
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "solo_billing_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_clients" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "fee_override" DECIMAL(10,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "domestic_address_templates" (
    "id" TEXT NOT NULL,
    "host_user_id" TEXT,
    "name" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "zip_code" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "domestic_address_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_configs" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "label" TEXT,
    "group" TEXT NOT NULL DEFAULT 'general',
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "watermark_templates" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'text',
    "text" TEXT,
    "image_url" TEXT,
    "position" TEXT NOT NULL DEFAULT 'bottom-right',
    "opacity" INTEGER NOT NULL DEFAULT 50,
    "font_size" INTEGER,
    "font_color" TEXT DEFAULT '#ffffff',
    "scale" INTEGER DEFAULT 25,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "shop_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "watermark_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_service_tags" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_service_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouse_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "delivery_method_payload" JSONB NOT NULL,
    "ozon_official_pickup_id" TEXT,
    "coverage_regions" JSONB,
    "is_recommended" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "warehouse_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouse_update_commands" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "operation_id" TEXT,
    "result" JSONB,
    "error_message" TEXT,
    "created_by" TEXT NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "warehouse_update_commands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fee" DECIMAL(10,2) NOT NULL,
    "description" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fee_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ozon_pickup_points" (
    "id" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "province" TEXT,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "contact" TEXT,
    "phone" TEXT,
    "working_hours" TEXT,
    "note" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ozon_pickup_points_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "returns_shop_id_idx" ON "returns"("shop_id");

-- CreateIndex
CREATE INDEX "returns_status_idx" ON "returns"("status");

-- CreateIndex
CREATE INDEX "returns_posting_number_idx" ON "returns"("posting_number");

-- CreateIndex
CREATE UNIQUE INDEX "returns_shop_id_platform_return_id_key" ON "returns"("shop_id", "platform_return_id");

-- CreateIndex
CREATE INDEX "express_issues_shop_id_idx" ON "express_issues"("shop_id");

-- CreateIndex
CREATE INDEX "express_issues_status_idx" ON "express_issues"("status");

-- CreateIndex
CREATE INDEX "express_issues_type_idx" ON "express_issues"("type");

-- CreateIndex
CREATE INDEX "supply_goods_user_id_idx" ON "supply_goods"("user_id");

-- CreateIndex
CREATE INDEX "supply_goods_status_idx" ON "supply_goods"("status");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_idx" ON "notifications"("user_id", "read");

-- CreateIndex
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "warehouse_logs_order_id_idx" ON "warehouse_logs"("order_id");

-- CreateIndex
CREATE INDEX "warehouse_logs_operation_type_idx" ON "warehouse_logs"("operation_type");

-- CreateIndex
CREATE INDEX "warehouse_logs_created_at_idx" ON "warehouse_logs"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "user_accounts_user_id_key" ON "user_accounts"("user_id");

-- CreateIndex
CREATE INDEX "transactions_account_id_idx" ON "transactions"("account_id");

-- CreateIndex
CREATE INDEX "transactions_order_id_idx" ON "transactions"("order_id");

-- CreateIndex
CREATE INDEX "transactions_created_at_idx" ON "transactions"("created_at");

-- CreateIndex
CREATE INDEX "transactions_module_idx" ON "transactions"("module");

-- CreateIndex
CREATE INDEX "logistics_bills_shop_id_idx" ON "logistics_bills"("shop_id");

-- CreateIndex
CREATE INDEX "logistics_bills_order_id_idx" ON "logistics_bills"("order_id");

-- CreateIndex
CREATE INDEX "logistics_bills_tracking_number_idx" ON "logistics_bills"("tracking_number");

-- CreateIndex
CREATE INDEX "logistics_bills_status_idx" ON "logistics_bills"("status");

-- CreateIndex
CREATE INDEX "cainiao_packages_user_id_bound_to_order_id_idx" ON "cainiao_packages"("user_id", "bound_to_order_id");

-- CreateIndex
CREATE INDEX "cainiao_packages_synced_at_idx" ON "cainiao_packages"("synced_at");

-- CreateIndex
CREATE UNIQUE INDEX "cainiao_packages_user_id_tracking_number_key" ON "cainiao_packages"("user_id", "tracking_number");

-- CreateIndex
CREATE INDEX "shop_analytics_snapshots_shop_id_synced_at_idx" ON "shop_analytics_snapshots"("shop_id", "synced_at");

-- CreateIndex
CREATE UNIQUE INDEX "shop_billing_configs_shop_id_key" ON "shop_billing_configs"("shop_id");

-- CreateIndex
CREATE INDEX "solo_billing_snapshots_user_id_idx" ON "solo_billing_snapshots"("user_id");

-- CreateIndex
CREATE INDEX "solo_billing_snapshots_month_idx" ON "solo_billing_snapshots"("month");

-- CreateIndex
CREATE UNIQUE INDEX "solo_billing_snapshots_user_id_month_key" ON "solo_billing_snapshots"("user_id", "month");

-- CreateIndex
CREATE INDEX "provider_clients_provider_id_idx" ON "provider_clients"("provider_id");

-- CreateIndex
CREATE INDEX "provider_clients_client_id_idx" ON "provider_clients"("client_id");

-- CreateIndex
CREATE UNIQUE INDEX "provider_clients_provider_id_client_id_key" ON "provider_clients"("provider_id", "client_id");

-- CreateIndex
CREATE INDEX "domestic_address_templates_host_user_id_idx" ON "domestic_address_templates"("host_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "system_configs_key_key" ON "system_configs"("key");

-- CreateIndex
CREATE INDEX "system_configs_group_idx" ON "system_configs"("group");

-- CreateIndex
CREATE INDEX "watermark_templates_user_id_idx" ON "watermark_templates"("user_id");

-- CreateIndex
CREATE INDEX "watermark_templates_shop_id_idx" ON "watermark_templates"("shop_id");

-- CreateIndex
CREATE INDEX "user_service_tags_user_id_idx" ON "user_service_tags"("user_id");

-- CreateIndex
CREATE INDEX "warehouse_update_commands_shop_id_status_idx" ON "warehouse_update_commands"("shop_id", "status");

-- CreateIndex
CREATE INDEX "warehouse_update_commands_status_idx" ON "warehouse_update_commands"("status");

-- CreateIndex
CREATE INDEX "ozon_pickup_points_city_idx" ON "ozon_pickup_points"("city");

-- CreateIndex
CREATE INDEX "ozon_pickup_points_is_active_idx" ON "ozon_pickup_points"("is_active");

-- CreateIndex
CREATE INDEX "orders_domestic_tracking_number_idx" ON "orders"("domestic_tracking_number");

-- CreateIndex
CREATE INDEX "orders_international_tracking_number_idx" ON "orders"("international_tracking_number");

-- CreateIndex
CREATE INDEX "products_model_id_idx" ON "products"("model_id");

-- AddForeignKey
ALTER TABLE "returns" ADD CONSTRAINT "returns_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "express_issues" ADD CONSTRAINT "express_issues_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply_goods" ADD CONSTRAINT "supply_goods_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_logs" ADD CONSTRAINT "warehouse_logs_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_accounts" ADD CONSTRAINT "user_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "user_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_service_tags" ADD CONSTRAINT "user_service_tags_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_update_commands" ADD CONSTRAINT "warehouse_update_commands_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "warehouse_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
