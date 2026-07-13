-- A delivery method can be reviewed independently for each immutable rule revision.
DROP INDEX "method_rule_binding_active_method_key";

CREATE UNIQUE INDEX "method_rule_binding_active_method_revision_key"
  ON "shop_delivery_method_rule_bindings"("delivery_method_id", "source_revision_id")
  WHERE "retired_at" IS NULL;
