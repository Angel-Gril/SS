-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'USER', 'STAFF');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'PENDING');

-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('OZON', 'YANDEX', 'KASPI', 'WILDBERRIES');

-- CreateEnum
CREATE TYPE "ShopStatus" AS ENUM ('ACTIVE', 'DISABLED', 'ERROR');

-- CreateEnum
CREATE TYPE "SyncJobType" AS ENUM ('PRODUCT_PULL', 'PRODUCT_PUSH', 'ORDER_PULL', 'STOCK_PUSH', 'IMAGE_RESIZE', 'RETURN_PULL');

-- CreateEnum
CREATE TYPE "SyncJobStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "BalanceLogType" AS ENUM ('RECHARGE', 'CONSUME', 'REFUND', 'ADJUST');

-- CreateEnum
CREATE TYPE "InventoryRecordType" AS ENUM ('IN', 'OUT', 'ADJUST');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "password_hash" TEXT NOT NULL,
    "nickname" TEXT,
    "avatar" TEXT,
    "account_code" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "balance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "parent_id" TEXT,
    "can_invite" BOOLEAN NOT NULL DEFAULT false,
    "invite_limit" INTEGER NOT NULL DEFAULT 0,
    "invite_count" INTEGER NOT NULL DEFAULT 0,
    "tenant_type" TEXT NOT NULL DEFAULT 'transit',
    "per_order_fee" DECIMAL(10,2),
    "custom_color_enabled" BOOLEAN NOT NULL DEFAULT false,
    "active_portal" TEXT NOT NULL DEFAULT 'user',
    "is_transit_provider" BOOLEAN NOT NULL DEFAULT false,
    "can_publish_address" BOOLEAN NOT NULL DEFAULT false,
    "provider_fee" DECIMAL(10,2),
    "platform_fee" DECIMAL(10,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "last_login_at" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "user_agent" TEXT,
    "ip" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shops" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "name" TEXT NOT NULL,
    "client_id" TEXT,
    "api_key_encrypted" TEXT NOT NULL,
    "api_secret_encrypted" TEXT,
    "status" "ShopStatus" NOT NULL DEFAULT 'ACTIVE',
    "balance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "last_sync_at" TIMESTAMP(3),
    "error_message" TEXT,
    "config" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouses" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "platform_warehouse_id" TEXT,
    "name" TEXT NOT NULL,
    "type" TEXT,
    "status" TEXT,
    "phone" TEXT,
    "country_code" TEXT,
    "city" TEXT,
    "street" TEXT,
    "zip_code" TEXT,
    "building" TEXT,
    "block" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "first_mile_type" TEXT,
    "drop_off_point_id" TEXT,
    "drop_off_timeslot_id" INTEGER,
    "cut_in_time" INTEGER,
    "is_kgt" BOOLEAN NOT NULL DEFAULT false,
    "is_rfbs" BOOLEAN NOT NULL DEFAULT false,
    "working_days" JSONB,
    "warehouse_options" JSONB,
    "template_id" TEXT,
    "return_recipient" TEXT,
    "return_phone" TEXT,
    "raw_data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shop_delivery_methods" (
    "id" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "platform_method_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT,
    "provider_id" INTEGER,
    "cutoff" TEXT,
    "sla_cut_in" INTEGER,
    "tpl_integration_type" TEXT,
    "drop_off_point_address" TEXT,
    "drop_off_point_name" TEXT,
    "raw_data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shop_delivery_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "platform_product_id" TEXT,
    "sku" TEXT,
    "offer_id" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category_id" TEXT,
    "price" DECIMAL(12,2),
    "old_price" DECIMAL(12,2),
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "stock" INTEGER NOT NULL DEFAULT 0,
    "weight" INTEGER,
    "images" JSONB,
    "attributes" JSONB,
    "variants" JSONB,
    "model_id" TEXT,
    "status" TEXT,
    "visibility" TEXT,
    "sync_status" TEXT,
    "commission_rate" DECIMAL(5,2),
    "min_price" DECIMAL(12,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "platform_order_id" TEXT NOT NULL,
    "posting_number" TEXT,
    "status" TEXT NOT NULL,
    "sub_status" TEXT,
    "total_amount" DECIMAL(12,2),
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "buyer_info" JSONB,
    "shipping_info" JSONB,
    "items" JSONB,
    "tracking_number" TEXT,
    "shipping_method" TEXT,
    "warehouse_id" TEXT,
    "in_process_at" TIMESTAMP(3),
    "shipment_date" TIMESTAMP(3),
    "delivering_date" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "domestic_tracking_number" TEXT,
    "domestic_carrier" TEXT,
    "domestic_status" TEXT DEFAULT 'pending',
    "international_tracking_number" TEXT,
    "international_carrier" TEXT,
    "international_status" TEXT DEFAULT 'pending',
    "purchase_order_id" TEXT,
    "purchase_platform" TEXT,
    "purchase_amount" DECIMAL(12,2),
    "service_tags" JSONB,
    "service_fee" DECIMAL(10,2),
    "shipping_fee" DECIMAL(10,2),
    "fee_deducted" BOOLEAN NOT NULL DEFAULT false,
    "inspection_status" TEXT,
    "inspection_photos" JSONB,
    "inspection_note" TEXT,
    "solo_fee" DECIMAL(10,2),
    "solo_fee_billed_at" TIMESTAMP(3),
    "user_color_tags" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_tracking_events" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "substatus" TEXT NOT NULL,
    "status_text" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'ozon',
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_tracking_events_pkey" PRIMARY KEY ("id")
);

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
    "currency" TEXT NOT NULL DEFAULT 'CNY',
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
    "original_price" DECIMAL(12,2),
    "original_currency" TEXT,
    "exchange_rate_used" DECIMAL(12,6),
    "price_needs_review" BOOLEAN NOT NULL DEFAULT false,
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
CREATE TABLE "sync_jobs" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "type" "SyncJobType" NOT NULL,
    "status" "SyncJobStatus" NOT NULL DEFAULT 'PENDING',
    "payload" JSONB,
    "result" JSONB,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "balance_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "BalanceLogType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "balance_before" DECIMAL(12,2) NOT NULL,
    "balance_after" DECIMAL(12,2) NOT NULL,
    "description" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "balance_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notices" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'INFO',
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notices_pkey" PRIMARY KEY ("id")
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
    "warehouse_type" TEXT NOT NULL DEFAULT 'fbs',
    "phone" TEXT NOT NULL,
    "country_code" TEXT NOT NULL DEFAULT 'CN',
    "city" TEXT,
    "street" TEXT,
    "zip_code" TEXT,
    "building" TEXT,
    "block" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "min_working_days" INTEGER NOT NULL DEFAULT 5,
    "working_days" JSONB NOT NULL DEFAULT '["MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY"]',
    "working_hour_from" TEXT NOT NULL DEFAULT '09:00',
    "working_hour_to" TEXT NOT NULL DEFAULT '18:00',
    "holidays" JSONB,
    "return_policy" TEXT NOT NULL DEFAULT 'send_back',
    "return_carrier" TEXT,
    "return_address_same" BOOLEAN NOT NULL DEFAULT true,
    "return_phone_same" BOOLEAN NOT NULL DEFAULT true,
    "return_recipient" TEXT,
    "return_method" TEXT,
    "return_zip_code" TEXT,
    "first_mile_type" TEXT NOT NULL DEFAULT 'DROP_OFF',
    "drop_off_point_id" TEXT,
    "cut_in_time" INTEGER NOT NULL DEFAULT 0,
    "timeslot_id" INTEGER NOT NULL DEFAULT 0,
    "return_point_id" TEXT,
    "is_kgt" BOOLEAN NOT NULL DEFAULT false,
    "warehouse_options" JSONB,
    "delivery_method_payload" JSONB,
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
    "command_type" TEXT NOT NULL DEFAULT 'create_warehouse',
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

-- CreateTable
CREATE TABLE "exchange_rates" (
    "date" DATE NOT NULL,
    "from_currency" TEXT NOT NULL,
    "to_currency" TEXT NOT NULL DEFAULT 'CNY',
    "rate" DECIMAL(12,6) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("date","from_currency","to_currency")
);

-- CreateTable
CREATE TABLE "ozon_finance_transactions" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "operation_id" TEXT NOT NULL,
    "operation_type" TEXT NOT NULL,
    "operation_type_name" TEXT,
    "category" TEXT NOT NULL,
    "posting_number" TEXT,
    "order_id" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "amount_cny" DECIMAL(14,2) NOT NULL,
    "exchange_rate" DECIMAL(12,6) NOT NULL,
    "operation_date" TIMESTAMP(3) NOT NULL,
    "raw" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ozon_finance_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_cost_snapshots" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "account_code" TEXT,
    "year_month" TEXT NOT NULL,
    "order_date" TIMESTAMP(3) NOT NULL,
    "order_status" TEXT NOT NULL,
    "exchange_rate_used" DECIMAL(12,6),
    "sale_amount_cny" DECIMAL(12,2),
    "commission_cny" DECIMAL(12,2),
    "purchase_cost_cny" DECIMAL(12,2),
    "package_fee_cny" DECIMAL(12,2),
    "shipping_domestic_cny" DECIMAL(12,2),
    "shipping_last_mile_cny" DECIMAL(12,2),
    "shipping_intl_cny" DECIMAL(12,2),
    "shipping_post_cny" DECIMAL(12,2),
    "ad_cny" DECIMAL(12,2),
    "penalty_cny" DECIMAL(12,2),
    "other_fee_cny" DECIMAL(12,2),
    "profit_cny" DECIMAL(12,2),
    "margin_pct" DECIMAL(6,2),
    "status" TEXT NOT NULL DEFAULT 'provisional',
    "finalized_at" TIMESTAMP(3),
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_cost_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_monthly_stats" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "account_code" TEXT,
    "shop_id" TEXT,
    "year_month" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "metrics" JSONB NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_monthly_stats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_account_code_key" ON "users"("account_code");

-- CreateIndex
CREATE INDEX "users_parent_id_idx" ON "users"("parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_key" ON "sessions"("token");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE INDEX "shops_user_id_idx" ON "shops"("user_id");

-- CreateIndex
CREATE INDEX "shops_platform_idx" ON "shops"("platform");

-- CreateIndex
CREATE INDEX "warehouses_shop_id_idx" ON "warehouses"("shop_id");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_shop_id_platform_warehouse_id_key" ON "warehouses"("shop_id", "platform_warehouse_id");

-- CreateIndex
CREATE INDEX "shop_delivery_methods_warehouse_id_idx" ON "shop_delivery_methods"("warehouse_id");

-- CreateIndex
CREATE UNIQUE INDEX "shop_delivery_methods_warehouse_id_platform_method_id_key" ON "shop_delivery_methods"("warehouse_id", "platform_method_id");

-- CreateIndex
CREATE INDEX "products_shop_id_idx" ON "products"("shop_id");

-- CreateIndex
CREATE INDEX "products_sku_idx" ON "products"("sku");

-- CreateIndex
CREATE INDEX "products_model_id_idx" ON "products"("model_id");

-- CreateIndex
CREATE UNIQUE INDEX "products_shop_id_platform_product_id_key" ON "products"("shop_id", "platform_product_id");

-- CreateIndex
CREATE UNIQUE INDEX "products_shop_id_offer_id_key" ON "products"("shop_id", "offer_id");

-- CreateIndex
CREATE INDEX "orders_shop_id_idx" ON "orders"("shop_id");

-- CreateIndex
CREATE INDEX "orders_status_idx" ON "orders"("status");

-- CreateIndex
CREATE INDEX "orders_posting_number_idx" ON "orders"("posting_number");

-- CreateIndex
CREATE INDEX "orders_domestic_tracking_number_idx" ON "orders"("domestic_tracking_number");

-- CreateIndex
CREATE INDEX "orders_international_tracking_number_idx" ON "orders"("international_tracking_number");

-- CreateIndex
CREATE UNIQUE INDEX "orders_shop_id_platform_order_id_key" ON "orders"("shop_id", "platform_order_id");

-- CreateIndex
CREATE INDEX "order_tracking_events_order_id_occurred_at_idx" ON "order_tracking_events"("order_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "order_tracking_events_order_id_substatus_key" ON "order_tracking_events"("order_id", "substatus");

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
CREATE INDEX "sync_jobs_shop_id_idx" ON "sync_jobs"("shop_id");

-- CreateIndex
CREATE INDEX "sync_jobs_status_idx" ON "sync_jobs"("status");

-- CreateIndex
CREATE INDEX "sync_jobs_type_idx" ON "sync_jobs"("type");

-- CreateIndex
CREATE INDEX "balance_logs_user_id_idx" ON "balance_logs"("user_id");

-- CreateIndex
CREATE INDEX "balance_logs_type_idx" ON "balance_logs"("type");

-- CreateIndex
CREATE INDEX "notices_published_at_idx" ON "notices"("published_at");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_idx" ON "notifications"("user_id", "read");

-- CreateIndex
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "inventory_items_user_id_idx" ON "inventory_items"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_items_user_id_sku_key" ON "inventory_items"("user_id", "sku");

-- CreateIndex
CREATE INDEX "inventory_records_item_id_idx" ON "inventory_records"("item_id");

-- CreateIndex
CREATE INDEX "inventory_records_type_idx" ON "inventory_records"("type");

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
CREATE INDEX "exchange_rates_from_currency_date_idx" ON "exchange_rates"("from_currency", "date");

-- CreateIndex
CREATE INDEX "ozon_finance_transactions_shop_id_operation_date_idx" ON "ozon_finance_transactions"("shop_id", "operation_date");

-- CreateIndex
CREATE INDEX "ozon_finance_transactions_category_operation_date_idx" ON "ozon_finance_transactions"("category", "operation_date");

-- CreateIndex
CREATE INDEX "ozon_finance_transactions_order_id_idx" ON "ozon_finance_transactions"("order_id");

-- CreateIndex
CREATE INDEX "ozon_finance_transactions_posting_number_idx" ON "ozon_finance_transactions"("posting_number");

-- CreateIndex
CREATE UNIQUE INDEX "ozon_finance_transactions_shop_id_operation_id_key" ON "ozon_finance_transactions"("shop_id", "operation_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_cost_snapshots_order_id_key" ON "order_cost_snapshots"("order_id");

-- CreateIndex
CREATE INDEX "order_cost_snapshots_user_id_year_month_idx" ON "order_cost_snapshots"("user_id", "year_month");

-- CreateIndex
CREATE INDEX "order_cost_snapshots_shop_id_year_month_idx" ON "order_cost_snapshots"("shop_id", "year_month");

-- CreateIndex
CREATE INDEX "order_cost_snapshots_account_code_year_month_idx" ON "order_cost_snapshots"("account_code", "year_month");

-- CreateIndex
CREATE INDEX "account_monthly_stats_year_month_idx" ON "account_monthly_stats"("year_month");

-- CreateIndex
CREATE INDEX "account_monthly_stats_user_id_year_month_idx" ON "account_monthly_stats"("user_id", "year_month");

-- CreateIndex
CREATE UNIQUE INDEX "account_monthly_stats_user_id_account_code_shop_id_year_mon_key" ON "account_monthly_stats"("user_id", "account_code", "shop_id", "year_month");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shops" ADD CONSTRAINT "shops_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_delivery_methods" ADD CONSTRAINT "shop_delivery_methods_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_tracking_events" ADD CONSTRAINT "order_tracking_events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "returns" ADD CONSTRAINT "returns_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "express_issues" ADD CONSTRAINT "express_issues_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply_goods" ADD CONSTRAINT "supply_goods_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "balance_logs" ADD CONSTRAINT "balance_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_records" ADD CONSTRAINT "inventory_records_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "inventory_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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

-- AddForeignKey
ALTER TABLE "ozon_finance_transactions" ADD CONSTRAINT "ozon_finance_transactions_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
