-- Durable Yandex offer publication journal. Yandex remains the platform owner;
-- this table only records an ERP dispatch, response and unknown outcome.
CREATE TYPE "YandexPublishState" AS ENUM ('PREPARED', 'SUBMITTING', 'SUCCEEDED', 'UNKNOWN', 'REJECTED');

CREATE TABLE "yandex_offer_publish_operations" (
    "id" TEXT NOT NULL,
    "owner_user_id" TEXT NOT NULL,
    "actor_user_id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "source_shop_id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "idempotency_key" VARCHAR(200) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "request_payload_json" JSONB NOT NULL,
    "response" JSONB,
    "state" "YandexPublishState" NOT NULL DEFAULT 'PREPARED',
    "error_message" VARCHAR(2000),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "yandex_offer_publish_operations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "yandex_offer_publish_owner_idempotency_key" ON "yandex_offer_publish_operations"("owner_user_id", "idempotency_key");
CREATE INDEX "yandex_offer_publish_shop_created_idx" ON "yandex_offer_publish_operations"("shop_id", "created_at");
CREATE INDEX "yandex_offer_publish_owner_created_idx" ON "yandex_offer_publish_operations"("owner_user_id", "created_at");

ALTER TABLE "yandex_offer_publish_operations" ADD CONSTRAINT "yandex_offer_publish_operations_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "yandex_offer_publish_operations" ADD CONSTRAINT "yandex_offer_publish_operations_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "yandex_offer_publish_operations" ADD CONSTRAINT "yandex_offer_publish_operations_shop_owner_fkey" FOREIGN KEY ("shop_id", "owner_user_id") REFERENCES "shops"("id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;
