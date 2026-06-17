import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function loadVariantSpec() {
  const source = fs.readFileSync('extensions/ss-erp/shared/ozon/variant-spec.js', 'utf8');
  const sandbox = { console };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox, { filename: 'variant-spec.js' });
  return sandbox.SS_ERP_OZON_VARIANT_SPEC;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('repairs Chinese Ozon variant attrs from seller attributes', () => {
  const spec = loadVariantSpec();
  const variant = {
    sku: '123456789',
    attrs: {
      '颜色': '咖啡色',
      'Размер': '52 RU / XL',
    },
    ozonAttributes: [
      {
        attribute_id: 10096,
        attribute_name: 'Цвет',
        values: [{ value: 'бежевый', dictionary_value_id: 61574 }],
      },
      {
        attribute_id: 4295,
        attribute_name: 'Российский размер',
        values: [{ value: '52 RU / XL' }],
      },
    ],
  };

  const repaired = spec.sanitizeOzonVariantAttrs(variant);

  assert.deepEqual(plain(repaired.attrs), {
    'Цвет': 'бежевый',
    'Российский размер': '52 RU / XL',
  });
  assert.equal(repaired._variantAttrsWarning, undefined);
});

test('drops Chinese Ozon variant attrs when seller attributes cannot repair them', () => {
  const spec = loadVariantSpec();
  const variant = {
    sku: '123456789',
    attrs: {
      '颜色': '未知花色',
      'Размер': '52 RU / XL',
    },
  };

  const repaired = spec.sanitizeOzonVariantAttrs(variant);

  assert.deepEqual(plain(repaired.attrs), {
    'Размер': '52 RU / XL',
  });
  assert.equal(repaired._variantAttrsWarning, '变体属性含中文，已移除无法自动修复的字段');
});

test('translates common Chinese public Ozon color attrs before saving variants', () => {
  const spec = loadVariantSpec();
  const variant = {
    sku: '3558932214',
    attrs: {
      'Цвет': '蓝色',
      'Размер': '54 RU / XXL系列',
    },
  };

  const repaired = spec.sanitizeOzonVariantAttrs(variant);

  assert.deepEqual(plain(repaired.attrs), {
    'Цвет': 'синий',
    'Размер': '54 RU / XXL',
  });
  assert.equal(repaired._variantAttrsWarning, undefined);
});

test('prefers official seller variable attrs over translated public attrs', () => {
  const spec = loadVariantSpec();
  const variant = {
    sku: '3558929476',
    attrs: {
      'Цвет': '蓝色',
      'Размер': '54 RU / XXL系列',
    },
    ozonAttributes: [
      {
        attribute_id: '10096',
        values: [{ value: 'синий', dictionary_value_id: '61574' }],
      },
      {
        attribute_id: '4295',
        values: [{ value: '54', dictionary_value_id: '35434' }],
      },
      {
        attribute_id: '9533',
        values: [{ value: 'XXL', dictionary_value_id: '0' }],
      },
    ],
  };

  const repaired = spec.sanitizeOzonVariantAttrs(variant);

  assert.deepEqual(plain(repaired.attrs), {
    'Цвет': 'синий',
    'Российский размер': '54',
    'Размер производителя': 'XXL',
  });
  assert.equal(repaired._variantAttrsWarning, undefined);
});

test('sanitizes Ozon variant attrs before ERP collection payload is saved', () => {
  const source = fs.readFileSync('extensions/ss-erp/background/collect-background.js', 'utf8');

  assert.match(source, /function\s+sanitizeCollectedOzonVariantAttrs\(/);
  assert.match(
    source,
    /productData\.variants\s*=\s*sanitizeCollectedOzonVariantAttrs\(productData\.variants\);[\s\S]*collected\.push\(productData\);/
  );
});

test('fetches seller variant details in quick mode when Ozon public variant attrs are translated', () => {
  const source = fs.readFileSync('extensions/ss-erp/background/collect-background.js', 'utf8');

  assert.match(source, /collectedOzonVariantsNeedSellerRepair/);
  assert.match(
    source,
    /collectPolicy\.fetchVariantSellerInsights\s*\|\|\s*collectedOzonVariantsNeedSellerRepair\(productData\.variants\)/
  );
});
