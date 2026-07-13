ALTER TABLE "logistics_official_input_unit_contracts"
  ALTER COLUMN "weight_increment_g" TYPE DECIMAL(20, 9)
    USING "weight_increment_g"::DECIMAL(20, 9),
  ALTER COLUMN "dimension_increment_mm" TYPE DECIMAL(20, 9)
    USING "dimension_increment_mm"::DECIMAL(20, 9);
