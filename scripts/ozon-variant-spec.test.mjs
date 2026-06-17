import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function loadHelpers() {
  const source = fs.readFileSync('extensions/ss-erp/shared/ozon/variant-spec.js', 'utf8');
  const sandbox = { console };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox, { filename: 'variant-spec.js' });
  return sandbox.SS_ERP_OZON_VARIANT_SPEC;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('parses Ozon variant specs from product links', () => {
  const helpers = loadHelpers();

  assert.deepEqual(
    plain(helpers.parseOzonVariantSpecFromText('/product/qiwu-forma-dlya-lda-4-yach-1-sht-4038902924/?from_sku=2404317485')),
    { cells: '4', pack: '1' },
  );
  assert.deepEqual(
    plain(helpers.parseOzonVariantSpecFromText('/product/qiwu-forma-dlya-lda-55-yach-2-sht-3527970132/?from_sku=2404317485')),
    { cells: '55', pack: '2' },
  );
});

test('enriches collected Ozon variant attrs with cells and pack without losing color', () => {
  const helpers = loadHelpers();

  assert.deepEqual(
    plain(helpers.enrichOzonVariantAttrs(
      { 'Цвет': 'желтый' },
      { link: '/product/qiwu-forma-dlya-lda-4-yach-1-sht-4038902924/?from_sku=2404317485' },
    )),
    {
      'Цвет': 'желтый',
      'Количество ячеек, шт': '4',
      'Количество в упаковке, шт': '1',
    },
  );
});

test('fills only missing Ozon variant spec attrs', () => {
  const helpers = loadHelpers();

  assert.deepEqual(
    plain(helpers.enrichOzonVariantAttrs(
      { 'Цвет': 'желтый, красный', 'Количество в упаковке, шт': '2' },
      { link: '/product/qiwu-forma-dlya-lda-6-yach-2-sht-3978217968/?from_sku=2404317485' },
    )),
    {
      'Цвет': 'желтый, красный',
      'Количество ячеек, шт': '6',
      'Количество в упаковке, шт': '2',
    },
  );
});

test('builds Ozon variants from all webAspects without collapsing composite colors', () => {
  const helpers = loadHelpers();

  const variants = helpers.buildOzonVariantsFromWebAspects({
    aspects: [
      {
        aspectName: 'Цвет',
        variants: [
          {
            sku: '3461699244',
            link: '/product/qiwu-forma-dlya-lda-4-yach-1-sht-3461699244/?from_sku=2404317485',
            active: true,
            availability: 'inStock',
            data: {
              textRs: [{ type: 'text', content: 'бирюзовый, салатовый' }],
              coverImage: 'https://ir.ozone.ru/s3/multimedia-1-x/wc140/11428663785.jpg',
              price: '54,40 ¥',
              title: 'QIWU Форма для льда, 4 яч, 1 шт',
            },
            price: 577,
          },
        ],
      },
      {
        aspectName: 'Количество ячеек, шт',
        variants: [
          {
            sku: '3461699244',
            data: { textRs: [{ type: 'text', content: '4' }] },
          },
        ],
      },
      {
        aspectName: 'Количество в упаковке, шт',
        variants: [
          {
            sku: '3461699244',
            data: { textRs: [{ type: 'text', content: '1' }] },
          },
        ],
      },
    ],
  });

  assert.deepEqual(plain(variants), [
    {
      sku: '3461699244',
      attrs: {
        'Цвет': 'бирюзовый, салатовый',
        'Количество ячеек, шт': '4',
        'Количество в упаковке, шт': '1',
      },
      priceText: '54,40 ¥',
      ozonInternalPrice: 577,
      images: ['https://ir.ozone.ru/s3/multimedia-1-x/wc140/11428663785.jpg'],
      availability: 'inStock',
      active: true,
      title: 'QIWU Форма для льда, 4 яч, 1 шт',
      link: '/product/qiwu-forma-dlya-lda-4-yach-1-sht-3461699244/?from_sku=2404317485',
    },
  ]);
});

test('keeps Ozon public color names that are phrases but not product descriptions', () => {
  const helpers = loadHelpers();

  assert.deepEqual(
    plain(helpers.sanitizeOzonVariantAttrs({
      sku: '2912066495',
      attrs: { 'Цвет': 'Цвет пасты из красной фасоли' },
      images: ['https://cdn.example.com/red-bean.jpg'],
    })),
    {
      sku: '2912066495',
      attrs: { 'Цвет': 'Цвет пасты из красной фасоли' },
      images: ['https://cdn.example.com/red-bean.jpg'],
    },
  );
});

test('merges recursively discovered Ozon variants by real sku without losing attrs', () => {
  const helpers = loadHelpers();

  const result = helpers.mergeOzonVariantLists(
    [
      {
        sku: '2404317485',
        attrs: { 'Цвет': 'желтый' },
        images: [],
        link: '/product/qiwu-forma-dlya-lda-4-yach-1-sht-4038902924/?from_sku=2404317485',
      },
      {
        sku: '2404317486',
        attrs: { 'Цвет': 'красный' },
        images: ['https://cdn.example.com/red.jpg'],
      },
    ],
    [
      {
        sku: '2404317485',
        attrs: { 'Количество ячеек, шт': '4' },
        images: ['https://cdn.example.com/yellow.jpg'],
        priceText: '100 ₽',
      },
      {
        sku: '2404317487',
        attrs: { 'Цвет': 'синий' },
        images: ['https://cdn.example.com/blue.jpg'],
        link: '/product/qiwu-forma-dlya-lda-55-yach-2-sht-3527970132/?from_sku=2404317487',
      },
    ],
  );

  assert.equal(result.addedCount, 1);
  assert.equal(result.mergedCount, 1);
  assert.deepEqual(
    plain(result.variants.map((variant) => ({ sku: variant.sku, attrs: variant.attrs, images: variant.images }))),
    [
      {
        sku: '2404317485',
        attrs: {
          'Цвет': 'желтый',
          'Количество ячеек, шт': '4',
          'Количество в упаковке, шт': '1',
        },
        images: ['https://cdn.example.com/yellow.jpg'],
      },
      {
        sku: '2404317486',
        attrs: { 'Цвет': 'красный' },
        images: ['https://cdn.example.com/red.jpg'],
      },
      {
        sku: '2404317487',
        attrs: {
          'Цвет': 'синий',
          'Количество ячеек, шт': '55',
          'Количество в упаковке, шт': '2',
        },
        images: ['https://cdn.example.com/blue.jpg'],
      },
    ],
  );
});

test('builds a deduped recursive discovery queue from concrete Ozon variant skus', () => {
  const helpers = loadHelpers();

  const refs = helpers.collectOzonVariantDiscoveryRefs(
    [
      {
        sku: '2404317485',
        link: '/product/qiwu-forma-dlya-lda-1-yach-1-sht-3249600683/?from_sku=2404317485',
      },
      {
        sku: '2404317485',
        link: '/product/duplicate-3249600683/?from_sku=2404317485',
      },
      {
        sku: '3399297127',
        link: 'https://www.ozon.ru/product/robot-pylesos-robot-cleaner-svetlo-rozovyy-3399297127/?from_sku=3399297127',
      },
      {
        sku: '',
        link: '/product/qiwu-forma-dlya-lda-55-yach-2-sht-3527970132/',
      },
      {
        sku: 'not-a-sku',
        link: '',
      },
    ],
    {
      excludeSkus: ['2404317485'],
      seenSkus: ['3399297127'],
    },
  );

  assert.deepEqual(plain(refs), [
    {
      fetchId: '3527970132',
      sku: '3527970132',
      productId: '3527970132',
      link: '/product/qiwu-forma-dlya-lda-55-yach-2-sht-3527970132/',
    },
  ]);
});

test('does not skip a new concrete sku just because its product page id was visited', () => {
  const helpers = loadHelpers();

  const refs = helpers.collectOzonVariantDiscoveryRefs(
    [
      {
        sku: '2222222222',
        link: '/product/ozon-item-9999999999/?from_sku=2222222222',
      },
    ],
    {
      seenProductIds: ['9999999999'],
      seenSkus: ['1111111111'],
    },
  );

  assert.deepEqual(plain(refs), [
    {
      fetchId: '2222222222',
      sku: '2222222222',
      productId: '9999999999',
      link: '/product/ozon-item-9999999999/?from_sku=2222222222',
    },
  ]);
});
