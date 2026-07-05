CREATE TABLE "product_selection_rules" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "tag" TEXT NOT NULL,
  "color" TEXT NOT NULL DEFAULT '#2563eb',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "auto_favorite" BOOLEAN NOT NULL DEFAULT false,
  "conditions" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "product_selection_rules_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "product_selection_rules_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "product_selection_rules_user_id_enabled_idx" ON "product_selection_rules"("user_id", "enabled");
CREATE INDEX "product_selection_rules_user_id_updated_at_idx" ON "product_selection_rules"("user_id", "updated_at");
