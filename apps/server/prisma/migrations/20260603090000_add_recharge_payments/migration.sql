-- Recharge and payment gateway tables.

CREATE TABLE "payment_providers" (
  "id" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'epay',
  "name" TEXT NOT NULL,
  "is_enabled" BOOLEAN NOT NULL DEFAULT false,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "gateway_url" TEXT,
  "merchant_id" TEXT,
  "merchant_key_encrypted" TEXT,
  "supported_methods" JSONB,
  "min_amount" DECIMAL(10,2) NOT NULL DEFAULT 10,
  "max_amount" DECIMAL(10,2) NOT NULL DEFAULT 10000,
  "daily_limit" DECIMAL(12,2),
  "fee_rate" DECIMAL(6,4),
  "fee_fixed" DECIMAL(10,2),
  "fee_payer" TEXT NOT NULL DEFAULT 'platform',
  "config" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "payment_providers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "manual_payment_qrcodes" (
  "id" TEXT NOT NULL,
  "method" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "qrcode_image" TEXT NOT NULL,
  "account_name" TEXT,
  "min_amount" DECIMAL(10,2) NOT NULL DEFAULT 10,
  "max_amount" DECIMAL(10,2) NOT NULL DEFAULT 10000,
  "daily_limit" DECIMAL(12,2),
  "weight" INTEGER NOT NULL DEFAULT 100,
  "is_enabled" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "manual_payment_qrcodes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "recharge_orders" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "provider_id" TEXT NOT NULL,
  "manual_qr_code_id" TEXT,
  "order_no" TEXT NOT NULL,
  "amount" DECIMAL(10,2) NOT NULL,
  "fee" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "actual_amount" DECIMAL(10,2) NOT NULL,
  "payment_method" TEXT NOT NULL,
  "payment_type" TEXT NOT NULL,
  "platform_order_no" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "pay_url" TEXT,
  "qrcode_url" TEXT,
  "proof_image" TEXT,
  "proof_note" TEXT,
  "reviewer_id" TEXT,
  "reviewed_at" TIMESTAMP(3),
  "reject_reason" TEXT,
  "paid_at" TIMESTAMP(3),
  "expire_at" TIMESTAMP(3) NOT NULL,
  "is_processed" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "recharge_orders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payment_notify_logs" (
  "id" TEXT NOT NULL,
  "order_id" TEXT,
  "provider_id" TEXT NOT NULL,
  "raw_params" JSONB NOT NULL,
  "ip" TEXT NOT NULL,
  "user_agent" TEXT,
  "sign_valid" BOOLEAN,
  "expected_sign" TEXT,
  "received_sign" TEXT,
  "is_success" BOOLEAN NOT NULL DEFAULT false,
  "error_message" TEXT,
  "response" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "payment_notify_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "recharge_orders_order_no_key" ON "recharge_orders"("order_no");
CREATE INDEX "payment_providers_type_is_enabled_priority_idx" ON "payment_providers"("type", "is_enabled", "priority");
CREATE INDEX "manual_payment_qrcodes_method_is_enabled_idx" ON "manual_payment_qrcodes"("method", "is_enabled");
CREATE INDEX "recharge_orders_user_id_status_created_at_idx" ON "recharge_orders"("user_id", "status", "created_at");
CREATE INDEX "recharge_orders_provider_id_status_idx" ON "recharge_orders"("provider_id", "status");
CREATE INDEX "recharge_orders_platform_order_no_idx" ON "recharge_orders"("platform_order_no");
CREATE INDEX "recharge_orders_status_expire_at_idx" ON "recharge_orders"("status", "expire_at");
CREATE INDEX "recharge_orders_manual_qr_code_id_idx" ON "recharge_orders"("manual_qr_code_id");
CREATE INDEX "payment_notify_logs_order_id_idx" ON "payment_notify_logs"("order_id");
CREATE INDEX "payment_notify_logs_provider_id_created_at_idx" ON "payment_notify_logs"("provider_id", "created_at");
CREATE INDEX "payment_notify_logs_is_success_created_at_idx" ON "payment_notify_logs"("is_success", "created_at");

ALTER TABLE "recharge_orders"
  ADD CONSTRAINT "recharge_orders_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "recharge_orders"
  ADD CONSTRAINT "recharge_orders_provider_id_fkey"
  FOREIGN KEY ("provider_id") REFERENCES "payment_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "recharge_orders"
  ADD CONSTRAINT "recharge_orders_manual_qr_code_id_fkey"
  FOREIGN KEY ("manual_qr_code_id") REFERENCES "manual_payment_qrcodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "recharge_orders"
  ADD CONSTRAINT "recharge_orders_reviewer_id_fkey"
  FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "payment_notify_logs"
  ADD CONSTRAINT "payment_notify_logs_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "recharge_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "payment_notify_logs"
  ADD CONSTRAINT "payment_notify_logs_provider_id_fkey"
  FOREIGN KEY ("provider_id") REFERENCES "payment_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
