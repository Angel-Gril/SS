import { describe, expect, it } from 'vitest';
import {
  buildAlibaba1688PriceSuggestion,
  buildAlibaba1688CollectRecord,
  buildAlibaba1688ListingPrefill,
  buildAlibaba1688OzonListingDraftItems,
  buildCollectListWhere,
  buildAlibaba1688PreparationMetadata,
  exposeSupplyGoodsMetadata,
  getAlibaba1688SourceDataIssues,
  getAlibaba1688PreparationIssues,
  isDomesticSupplySourcePlatform,
  normalizeAlibaba1688PreparationVariants,
  normalizeAlibaba1688PreparationImages,
  parseAttributeText,
  refreshAlibaba1688SourceDataIssues,
} from '../routes/collect.js';

describe('1688 collect helpers', () => {
  it('recognizes domestic supply platforms that carry source platform SKUs', () => {
    expect(['1688', 'taobao', 'tmall', 'jd', 'pinduoduo', 'pdd'].map(isDomesticSupplySourcePlatform)).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
    ]);
    expect(['ozon', '', null, undefined].map(isDomesticSupplySourcePlatform)).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });

  it('builds collect list filters for all domestic supply platforms', () => {
    expect(buildCollectListWhere('user-1', { sourcePlatform: 'domestic-supply' })).toEqual({
      userId: 'user-1',
      sourcePlatform: { in: ['1688', 'taobao', 'tmall', 'jd', 'pinduoduo', 'pdd'] },
    });
    expect(buildCollectListWhere('user-1', { sourcePlatform: 'taobao', status: 'collected' })).toEqual({
      userId: 'user-1',
      status: 'collected',
      sourcePlatform: 'taobao',
    });
  });

  it('parses attribute text into a record', () => {
    expect(parseAttributeText('材质：棉\n风格: 休闲\n无效行')).toEqual({
      材质: '棉',
      风格: '休闲',
    });
  });

  it('normalizes 1688 payloads into collected supply goods data without listing mapping', () => {
    const record = buildAlibaba1688CollectRecord({
      title: '男士运动鞋 透气网面',
      sourceUrl: 'https://detail.1688.com/offer/734567890123.html',
      imageText: 'https://img.example.com/1.jpg\nnot-a-url\nhttps://img.example.com/2.jpg',
      priceText: '¥25.80',
      categoryPath: '鞋类 > 男鞋 > 运动鞋',
      shopName: '义乌某某工厂',
      supplierLocation: '浙江 金华',
      supplierYears: 6,
      attributesText: '材质：网布\n颜色: 黑色',
      skuItems: [
        {
          skuId: 'sku-red-42',
          attrs: { 颜色: '红色', 尺码: '42' },
          specText: '红色 / 42',
          price: '26.5',
          stock: 120,
          minOrderQty: 2,
          grossWeightGrams: 650,
          imageUrl: '//img.example.com/sku-red.jpg',
          images: ['https://img.example.com/sku-red-2.jpg', 'not-a-url'],
          ozonSku: 'ozon-sku-42',
        },
      ],
      description: '商品详情包含材质、适用场景和包装说明',
      monthlySales: 3000,
      grossWeightGrams: 650,
      lengthMm: 320,
      widthMm: 220,
      heightMm: 110,
      dimensionsText: '32x22x11cm',
      minOrderQty: 2,
      logisticsText: '广东发货，快递费按地区计算',
      shippingInfo: { text: '广东发货，快递费按地区计算' },
      customizationInfo: { supported: true, text: '支持贴牌定制' },
    });

    expect(record).toMatchObject({
      title: '男士运动鞋 透气网面',
      sourcePlatform: '1688',
      sourceProductId: '734567890123',
      sku: '734567890123',
      images: ['https://img.example.com/1.jpg', 'https://img.example.com/2.jpg'],
      priceText: '¥25.80',
      currency: 'CNY',
      metadata: {
        sourceKind: 'alibaba1688',
        offerId: '734567890123',
        description: '商品详情包含材质、适用场景和包装说明',
        categoryPath: '鞋类 > 男鞋 > 运动鞋',
        supplierName: '义乌某某工厂',
        supplierLocation: '浙江 金华',
        supplierYears: 6,
        monthlySales: 3000,
        grossWeightGrams: 650,
        lengthMm: 320,
        widthMm: 220,
        heightMm: 110,
        dimensionsText: '32x22x11cm',
        minOrderQty: 2,
        logisticsText: '广东发货，快递费按地区计算',
        shippingInfo: { text: '广东发货，快递费按地区计算' },
        customizationInfo: { supported: true, text: '支持贴牌定制' },
        attributes: { 材质: '网布', 颜色: '黑色' },
        skuCount: 1,
        sourceDataIssues: [],
        categoryMappingStatus: 'deferred_until_listing',
        listingPreparationStatus: 'collected_only',
      },
      variants: [
        {
          sku: 'sku-red-42',
          attrs: { 颜色: '红色', 尺码: '42' },
          price: '26.5',
          stock: 120,
          minOrderQty: 2,
          grossWeightGrams: 650,
          images: ['https://img.example.com/sku-red-2.jpg', 'https://img.example.com/sku-red.jpg'],
          sourceSkuId: 'sku-red-42',
          sourcePlatform: '1688',
          ozonSku: 'ozon-sku-42',
        },
      ],
    });
  });

  it('preserves explicit domestic source platforms in collected supply goods data', () => {
    const record = buildAlibaba1688CollectRecord({
      title: '淘宝货源商品',
      sourcePlatform: 'taobao',
      sourceUrl: 'https://item.taobao.com/item.htm?id=998877',
      offerId: 'tb-998877',
      priceText: '¥19.90',
      images: ['https://img.example.com/tb-main.jpg'],
      attributes: { 材质: '棉' },
      skuItems: [
        { skuId: 'tb-sku-red', specText: '红色', price: '19.9' },
      ],
      description: '淘宝商品详情',
    });

    expect(record).toMatchObject({
      sourcePlatform: 'taobao',
      sourceProductId: 'tb-998877',
      sku: 'tb-998877',
      variants: [
        expect.objectContaining({
          sourceSkuId: 'tb-sku-red',
          sourcePlatform: 'taobao',
        }),
      ],
    });
  });

  it('uses the real source platform for fallback source SKU ids', () => {
    const record = buildAlibaba1688CollectRecord({
      title: '淘宝无 SKU 货源商品',
      sourcePlatform: 'taobao',
      sourceUrl: 'https://item.taobao.com/item.htm?id=998877',
      skuItems: [
        { specText: '默认规格', price: '19.9' },
      ],
    });

    expect(record.variants).toEqual([
      expect.objectContaining({
        sku: 'taobao-1',
        sourceSkuId: 'taobao-1',
        sourcePlatform: 'taobao',
      }),
    ]);
  });

  it('normalizes source platform casing for collected supply goods and variants', () => {
    const record = buildAlibaba1688CollectRecord({
      title: '淘宝大小写平台货源商品',
      sourcePlatform: 'Taobao',
      sourceUrl: 'https://item.taobao.com/item.htm?id=998877',
      skuItems: [
        { specText: '默认规格', price: '19.9' },
      ],
    });

    expect(record.sourcePlatform).toBe('taobao');
    expect(record.variants).toEqual([
      expect.objectContaining({
        sku: 'taobao-1',
        sourceSkuId: 'taobao-1',
        sourcePlatform: 'taobao',
      }),
    ]);
  });

  it('infers source product ids from domestic supply urls when no offer id is submitted', () => {
    const cases = [
      ['taobao', 'https://item.taobao.com/item.htm?id=998877', '998877'],
      ['tmall', 'https://detail.tmall.com/item.htm?id=123456789', '123456789'],
      ['jd', 'https://item.jd.com/100012043978.html', '100012043978'],
      ['pinduoduo', 'https://mobile.yangkeduo.com/goods.html?goods_id=777888999', '777888999'],
    ] as const;

    for (const [sourcePlatform, sourceUrl, sourceProductId] of cases) {
      const record = buildAlibaba1688CollectRecord({
        title: `${sourcePlatform} 货源商品`,
        sourcePlatform,
        sourceUrl,
        priceText: '¥19.90',
      });

      expect(record.sourceProductId).toBe(sourceProductId);
      expect(record.sku).toBe(sourceProductId);
      expect(record.metadata.offerId).toBe(sourceProductId);
    }
  });

  it('infers domestic source platforms from URLs when submitted platform data is missing or invalid', () => {
    const tmallRecord = buildAlibaba1688CollectRecord({
      title: '天猫货源商品',
      sourceUrl: 'https://detail.tmall.com/item.htm?id=123456789',
      skuItems: [{ specText: '默认规格', price: '29.9' }],
    });
    const taobaoRecord = buildAlibaba1688CollectRecord({
      title: '淘宝货源商品',
      sourcePlatform: 'not-a-platform',
      sourceUrl: 'https://item.taobao.com/item.htm?id=998877',
      skuItems: [{ specText: '默认规格', price: '19.9' }],
    });

    expect(tmallRecord).toMatchObject({
      sourcePlatform: 'tmall',
      sourceProductId: '123456789',
      variants: [expect.objectContaining({ sourcePlatform: 'tmall', sourceSkuId: 'tmall-1' })],
    });
    expect(taobaoRecord).toMatchObject({
      sourcePlatform: 'taobao',
      sourceProductId: '998877',
      variants: [expect.objectContaining({ sourcePlatform: 'taobao', sourceSkuId: 'taobao-1' })],
    });
  });

  it('ignores invalid variant source platforms during domestic supply collection', () => {
    const record = buildAlibaba1688CollectRecord({
      title: '淘宝变体平台修正',
      sourcePlatform: 'taobao',
      sourceUrl: 'https://item.taobao.com/item.htm?id=998877',
      skuItems: [
        {
          sourcePlatform: 'ozon-product-123',
          sourceSkuId: 'tb-red',
          specText: '红色',
          price: '19.9',
        },
      ],
    });

    expect(record.variants).toEqual([
      expect.objectContaining({
        sourcePlatform: 'taobao',
        sourceSkuId: 'tb-red',
      }),
    ]);
  });

  it('links 1688 source SKUs to the Ozon SKU from price-check context', () => {
    const record = buildAlibaba1688CollectRecord({
      title: '核价货源',
      sourceUrl: 'https://detail.1688.com/offer/734567890123.html',
      priceText: '¥25.80',
      skuItems: [
        { skuId: 'sku-black-xl', specText: '黑色 / XL', price: '25.8' },
      ],
      raw: {
        priceCheckContext: {
          title: 'Ozon 原商品',
          productId: '123456789',
          sku: 'ozon-sku-xl',
          offerId: 'seller-offer-xl',
          sourceUrl: 'https://www.ozon.ru/product/test-123456789/',
          price: '1590',
          currency: 'RUB',
        },
      },
    });

    expect(record.variants).toEqual([
      {
        sku: 'sku-black-xl',
        attrs: { 规格: '黑色 / XL' },
        price: '25.8',
        stock: null,
        minOrderQty: null,
        grossWeightGrams: null,
        sourceSkuId: 'sku-black-xl',
        sourcePlatform: '1688',
        ozonSku: 'ozon-sku-xl',
        ozonProductId: '123456789',
        ozonOfferId: 'seller-offer-xl',
      },
    ]);
    expect(record.metadata.ozonPriceCheckContext).toMatchObject({
      productId: '123456789',
      sku: 'ozon-sku-xl',
      offerId: 'seller-offer-xl',
    });
  });

  it('keeps explicit source SKU ids separate from generic Ozon SKU fields', () => {
    const record = buildAlibaba1688CollectRecord({
      title: 'SKU 追踪货源',
      sourcePlatform: 'taobao',
      sourceUrl: 'https://item.taobao.com/item.htm?id=998877',
      skuItems: [
        {
          sourceSkuId: 'tb-source-red',
          sku: 'ozon-sku-should-not-be-source',
          ozonSku: 'ozon-sku-red',
          specText: '红色',
          price: '19.9',
        },
      ],
    });

    expect(record.variants).toEqual([
      expect.objectContaining({
        sku: 'tb-source-red',
        sourceSkuId: 'tb-source-red',
        sourcePlatform: 'taobao',
        ozonSku: 'ozon-sku-red',
      }),
    ]);
  });

  it('tracks missing 1688 source data without changing listing preparation state', () => {
    const record = buildAlibaba1688CollectRecord({
      title: '只有标题的货源',
    });

    expect(record.metadata).toMatchObject({
      sourceKind: 'alibaba1688',
      sourceDataIssues: [
        'missing_source_images',
        'missing_purchase_price',
        'missing_sku_items',
        'missing_description',
        'missing_attributes',
      ],
      categoryMappingStatus: 'deferred_until_listing',
      listingPreparationStatus: 'collected_only',
    });

    expect(getAlibaba1688SourceDataIssues({
      images: ['https://img.example.com/1.jpg'],
      priceText: '¥25.80',
      skuItems: [{ skuId: 'sku-1' }],
      description: '商品详情',
      attributes: { 材质: '棉' },
    })).toEqual([]);
  });

  it('preserves long 1688 source descriptions for later listing preparation', () => {
    const longDescription = '商品详情'.repeat(900);
    const record = buildAlibaba1688CollectRecord({
      title: '长详情货源',
      description: longDescription,
    });

    expect(record.metadata.description).toHaveLength(3600);
    expect(record.metadata.description).toBe(longDescription);

    const repaired = buildAlibaba1688PreparationMetadata(
      { sourceKind: 'alibaba1688' },
      {
        preparedTitleRu: 'Test title',
        targetPriceCny: '99',
        description: longDescription,
      },
    );

    expect(repaired.description).toHaveLength(3600);
    expect(repaired.description).toBe(longDescription);
  });

  it('refreshes 1688 source data issues after preparation images change', () => {
    const metadata = refreshAlibaba1688SourceDataIssues(
      {
        sourceKind: 'alibaba1688',
        description: '商品详情',
        attributes: { 材质: '棉' },
        sourceDataIssues: ['missing_source_images'],
        listingPreparationStatus: 'ready',
      },
      {
        images: ['https://img.example.com/ready.jpg'],
        purchasePrice: '25.80',
        variants: [{ sku: 'sku-1' }],
      },
    );

    expect(metadata).toMatchObject({
      sourceKind: 'alibaba1688',
      description: '商品详情',
      attributes: { 材质: '棉' },
      sourceDataIssues: [],
      listingPreparationStatus: 'ready',
    });
  });

  it('infers 1688 source data issues for old listing preparation records', () => {
    const item = buildAlibaba1688ListingPrefill({
      id: 'collect-1688-old',
      title: '旧货源记录',
      sourceUrl: 'https://detail.1688.com/offer/734567890123.html',
      sourceProductId: '734567890123',
      purchasePrice: null,
      currency: 'CNY',
      images: [],
      variants: [],
      notes: null,
      metadata: {
        sourceKind: 'alibaba1688',
        categoryMappingStatus: 'deferred_until_listing',
        listingPreparationStatus: 'collected_only',
      },
      createdAt: new Date('2026-06-07T12:00:00.000Z'),
    });

    expect(item.sourceDataIssues).toEqual([
      'missing_source_images',
      'missing_purchase_price',
      'missing_sku_items',
      'missing_description',
      'missing_attributes',
    ]);
  });

  it('infers source data issues for old domestic supply collect list records', () => {
    const source = {
      images: [],
      purchasePrice: null,
      purchaseCurrency: 'CNY',
      variants: [],
    };
    const metadata = exposeSupplyGoodsMetadata(null, {
      ...source,
      sourcePlatform: '1688',
    });
    const taobaoMetadata = exposeSupplyGoodsMetadata(null, {
      ...source,
      sourcePlatform: 'taobao',
    });

    expect(metadata).toMatchObject({
      sourceKind: 'alibaba1688',
      sourceDataIssues: [
        'missing_source_images',
        'missing_purchase_price',
        'missing_sku_items',
        'missing_description',
        'missing_attributes',
      ],
    });
    expect(taobaoMetadata).toMatchObject(metadata as Record<string, unknown>);
  });

  it('serializes 1688 collected records for listing preparation without executing mapping', () => {
    const item = buildAlibaba1688ListingPrefill({
      id: 'collect-1688-1',
      title: '男士运动鞋',
      sourceUrl: 'https://detail.1688.com/offer/734567890123.html',
      sourceProductId: '734567890123',
      purchasePrice: { toString: () => '25.80' },
      currency: 'CNY',
      images: ['https://img.example.com/1.jpg'],
      variants: [{ sku: 'sku-red-42', attrs: { 规格: '红色 / 42' }, price: '26.5', images: ['https://img.example.com/sku-red.jpg'], sourceSkuId: 'sku-red-42', ozonSku: 'ozon-sku-42' }],
      notes: '货源备注',
      metadata: {
        description: '商品详情包含材质、适用场景和包装说明',
        supplierName: '义乌某某工厂',
        supplierLocation: '浙江 金华',
        supplierYears: 6,
        monthlySales: 3000,
        categoryPath: '鞋类 > 男鞋 > 运动鞋',
        ozonCategoryId: 17031663,
        ozonTypeId: 971234,
        grossWeightGrams: 650,
        lengthMm: 320,
        widthMm: 220,
        heightMm: 110,
        dimensionsText: '32x22x11cm',
        minOrderQty: 2,
        logisticsText: '广东发货，快递费按地区计算',
        attributes: { 材质: '网布' },
        skuCount: 1,
        categoryMappingStatus: 'deferred_until_listing',
        listingPreparationStatus: 'collected_only',
        listingPreparationIssues: ['missing_prepared_title_ru'],
        raw: {
          priceCheckContext: {
            title: 'Ozon 男士运动鞋',
            productId: '123456789',
            sourceUrl: 'https://www.ozon.ru/product/test-123456789/',
            price: '1590',
            currency: 'RUB',
          },
        },
      },
      createdAt: new Date('2026-06-07T12:00:00.000Z'),
    });

    expect(item).toMatchObject({
      id: 'collect-1688-1',
      title: '男士运动鞋',
      sourceProductId: '734567890123',
      purchasePrice: '25.80',
      description: '商品详情包含材质、适用场景和包装说明',
      supplierName: '义乌某某工厂',
      supplierLocation: '浙江 金华',
      supplierYears: 6,
      monthlySales: 3000,
      categoryPath: '鞋类 > 男鞋 > 运动鞋',
      ozonCategoryId: '17031663',
      ozonTypeId: '971234',
      grossWeightGrams: 650,
      lengthMm: 320,
      widthMm: 220,
      heightMm: 110,
      dimensionsText: '32x22x11cm',
      minOrderQty: 2,
      logisticsText: '广东发货，快递费按地区计算',
      attributes: { 材质: '网布' },
      skuCount: 1,
      skuText: 'sku-red-42 | 红色 / 42 | 26.5 |  |  |  | https://img.example.com/sku-red.jpg | ozon-sku-42',
      categoryMappingStatus: 'deferred_until_listing',
      listingPreparationStatus: 'collected_only',
      listingPreparationIssues: ['missing_prepared_title_ru'],
      preparedTitleRu: '',
      targetPriceCny: '',
      listingNotes: '',
      ozonPriceCheckContext: {
        title: 'Ozon 男士运动鞋',
        productId: '123456789',
        sourceUrl: 'https://www.ozon.ru/product/test-123456789/',
        price: '1590',
        currency: 'RUB',
      },
      priceCheckEstimate: {
        ozonPriceRub: 1590,
        purchasePriceCny: 25.8,
        purchasePriceRub: 322.5,
        roughSpreadRub: 1267.5,
        cnyPerRub: 0.08,
        note: 'rough_source_price_only',
      },
      priceSuggestion: {
        purchasePriceCny: 25.8,
        costPlusTargetCny: 78,
        ozonPriceRub: 1590,
        ozonPriceCny: 127.2,
        cnyPerRub: 0.08,
        recommendedTargetPriceCny: 127.2,
        recommendationSource: 'ozon_price_check',
        note: 'rough_suggestion_only',
      },
      createdAt: '2026-06-07T12:00:00.000Z',
    });
  });

  it('serializes non-1688 source platforms in editable SKU text', () => {
    const item = buildAlibaba1688ListingPrefill({
      id: 'collect-taobao-1',
      title: '淘宝货源',
      sourcePlatform: 'taobao',
      sourceProductId: 'tb-998877',
      purchasePrice: { toString: () => '19.90' },
      currency: 'CNY',
      images: ['https://img.example.com/base.jpg'],
      variants: [
        {
          sku: 'tb-sku-red',
          sourceSkuId: 'tb-sku-red',
          sourcePlatform: 'taobao',
          ozonSku: 'ozon-sku-red',
          attrs: { 规格: '红色' },
          price: '19.9',
          images: ['https://img.example.com/tb-red.jpg'],
        },
      ],
      metadata: { sourceKind: 'alibaba1688' },
      createdAt: new Date('2026-06-07T12:00:00.000Z'),
    });

    expect(item.skuText).toBe('tb-sku-red | 红色 | 19.9 |  |  |  | https://img.example.com/tb-red.jpg | ozon-sku-red |  |  | taobao');
    expect(item.sourcePlatform).toBe('taobao');
  });

  it('serializes Ozon product and offer trace fields in editable SKU text', () => {
    const item = buildAlibaba1688ListingPrefill({
      id: 'collect-taobao-trace',
      title: '淘宝货源追踪',
      sourcePlatform: 'taobao',
      sourceProductId: 'tb-998877',
      purchasePrice: { toString: () => '19.90' },
      currency: 'CNY',
      images: ['https://img.example.com/base.jpg'],
      variants: [
        {
          sku: 'tb-sku-red',
          sourceSkuId: 'tb-sku-red',
          sourcePlatform: 'taobao',
          ozonSku: 'ozon-sku-red',
          ozonProductId: '123456789',
          ozonOfferId: 'seller-offer-red',
          attrs: { 规格: '红色' },
          price: '19.9',
          images: ['https://img.example.com/tb-red.jpg'],
        },
      ],
      metadata: { sourceKind: 'alibaba1688' },
      createdAt: new Date('2026-06-07T12:00:00.000Z'),
    });

    expect(item.skuText).toBe('tb-sku-red | 红色 | 19.9 |  |  |  | https://img.example.com/tb-red.jpg | ozon-sku-red | 123456789 | seller-offer-red | taobao');
  });

  it('hydrates missing variant source platforms from the collected item in listing prefill', () => {
    const item = buildAlibaba1688ListingPrefill({
      id: 'collect-taobao-legacy-variant',
      title: '淘宝旧货源',
      sourcePlatform: 'taobao',
      sourceProductId: 'tb-998877',
      purchasePrice: { toString: () => '19.90' },
      currency: 'CNY',
      images: ['https://img.example.com/base.jpg'],
      variants: [
        {
          sku: 'tb-sku-red',
          sourceSkuId: 'tb-sku-red',
          ozonSku: 'ozon-sku-red',
          attrs: { 规格: '红色' },
          price: '19.9',
        },
      ],
      metadata: { sourceKind: 'alibaba1688' },
      createdAt: new Date('2026-06-07T12:00:00.000Z'),
    });

    expect(item.variants[0]).toMatchObject({
      sourceSkuId: 'tb-sku-red',
      sourcePlatform: 'taobao',
    });
    expect(item.skuText).toBe('tb-sku-red | 红色 | 19.9 |  |  |  |  | ozon-sku-red |  |  | taobao');
  });

  it('serializes editable SKU text from the source SKU id before legacy sku', () => {
    const item = buildAlibaba1688ListingPrefill({
      id: 'collect-source-sku-1',
      title: '货源 SKU 优先',
      sourceProductId: '734567890123',
      purchasePrice: { toString: () => '19.90' },
      currency: 'CNY',
      images: ['https://img.example.com/base.jpg'],
      variants: [
        {
          sku: 'legacy-internal-sku',
          sourceSkuId: 'source-real-sku',
          sourcePlatform: '1688',
          ozonSku: 'ozon-sku-real',
          attrs: { 规格: '红色' },
          price: '19.9',
        },
      ],
      metadata: { sourceKind: 'alibaba1688' },
      createdAt: new Date('2026-06-07T12:00:00.000Z'),
    });

    expect(item.skuText).toBe('source-real-sku | 红色 | 19.9 |  |  |  |  | ozon-sku-real');
  });

  it('builds 1688 listing price suggestions without writing preparation metadata', () => {
    expect(buildAlibaba1688PriceSuggestion(
      { title: 'Ozon item', productId: '123', sourceUrl: null, price: '1590', currency: 'RUB' },
      '25.80',
      'CNY',
    )).toMatchObject({
      purchasePriceCny: 25.8,
      costPlusTargetCny: 78,
      ozonPriceRub: 1590,
      ozonPriceCny: 127.2,
      recommendedTargetPriceCny: 127.2,
      recommendationSource: 'ozon_price_check',
    });

    expect(buildAlibaba1688PriceSuggestion(null, '25.80', 'CNY')).toMatchObject({
      purchasePriceCny: 25.8,
      costPlusTargetCny: 78,
      ozonPriceRub: null,
      ozonPriceCny: null,
      recommendedTargetPriceCny: 78,
      recommendationSource: 'cost_plus_200pct',
    });
  });

  it('saves 1688 listing preparation metadata without executing category mapping', () => {
    const metadata = buildAlibaba1688PreparationMetadata(
      {
        sourceKind: 'alibaba1688',
        offerId: '734567890123',
        categoryPath: '鞋类 > 男鞋 > 运动鞋',
        categoryMappingStatus: 'deferred_until_listing',
        listingPreparationStatus: 'collected_only',
      },
      {
        preparedTitleRu: 'Мужские кроссовки',
        targetPriceCny: '199.90',
        listingNotes: '图片需要处理',
        ozonCategoryId: '17031663',
        ozonTypeId: '971234',
      },
    );

    expect(metadata).toMatchObject({
      sourceKind: 'alibaba1688',
      offerId: '734567890123',
      categoryPath: '鞋类 > 男鞋 > 运动鞋',
      preparedTitleRu: 'Мужские кроссовки',
      targetPriceCny: '199.9',
      listingNotes: '图片需要处理',
      ozonCategoryId: 17031663,
      ozonTypeId: 971234,
      categoryMappingStatus: 'manual_ready',
      listingPreparationStatus: 'ready',
    });
    expect(metadata).not.toHaveProperty('listingPreparationIssues');
  });

  it('keeps 1688 preparation drafts until Ozon category and type are supplied', () => {
    expect(getAlibaba1688PreparationIssues({
      preparedTitleRu: 'Мужские кроссовки',
      targetPriceCny: '199',
    }, { hasImages: true })).toEqual(['missing_ozon_category_id', 'missing_ozon_type_id']);

    const metadata = buildAlibaba1688PreparationMetadata(
      { sourceKind: 'alibaba1688', categoryMappingStatus: 'deferred_until_listing' },
      {
        preparedTitleRu: 'Мужские кроссовки',
        targetPriceCny: '199',
      },
      { hasImages: true },
    );

    expect(metadata).toMatchObject({
      preparedTitleRu: 'Мужские кроссовки',
      targetPriceCny: '199',
      listingPreparationStatus: 'draft',
      listingPreparationIssues: ['missing_ozon_category_id', 'missing_ozon_type_id'],
      categoryMappingStatus: 'deferred_until_listing',
    });
  });

  it('saves 1688 source repairs during listing preparation without executing mapping', () => {
    const metadata = buildAlibaba1688PreparationMetadata(
      {
        sourceKind: 'alibaba1688',
        sourceDataIssues: ['missing_description', 'missing_attributes'],
        categoryMappingStatus: 'deferred_until_listing',
        listingPreparationStatus: 'collected_only',
      },
      {
        preparedTitleRu: 'Мужские кроссовки',
        targetPriceCny: '199',
        description: '补充后的货源详情',
        attributesText: '材质：网布\n颜色：黑色',
        ozonCategoryId: '17031663',
        ozonTypeId: '971234',
      } as any,
      { hasImages: true },
    );
    const refreshed = refreshAlibaba1688SourceDataIssues(metadata, {
      images: ['https://img.example.com/ready.jpg'],
      purchasePrice: '25.80',
      variants: [{ sku: 'sku-1' }],
    });

    expect(refreshed).toMatchObject({
      sourceKind: 'alibaba1688',
      description: '补充后的货源详情',
      attributes: { 材质: '网布', 颜色: '黑色' },
      sourceDataIssues: [],
      ozonCategoryId: 17031663,
      ozonTypeId: 971234,
      categoryMappingStatus: 'manual_ready',
      listingPreparationStatus: 'ready',
    });
  });

  it('clears empty 1688 preparation draft fields while preserving deferred mapping state', () => {
    const metadata = buildAlibaba1688PreparationMetadata(
      {
        preparedTitleRu: 'old title',
        targetPriceCny: '188',
        listingNotes: 'old note',
      },
      {
        preparedTitleRu: '   ',
        targetPriceCny: 0,
        listingNotes: '',
        ozonCategoryId: '',
        ozonTypeId: '',
      },
    );

    expect(metadata).toMatchObject({
      categoryMappingStatus: 'deferred_until_listing',
      listingPreparationStatus: 'draft',
      listingPreparationIssues: ['missing_prepared_title_ru', 'missing_target_price_cny', 'missing_ozon_category_id', 'missing_ozon_type_id'],
    });
    expect(metadata).not.toHaveProperty('preparedTitleRu');
    expect(metadata).not.toHaveProperty('targetPriceCny');
    expect(metadata).not.toHaveProperty('listingNotes');
    expect(metadata).not.toHaveProperty('ozonCategoryId');
    expect(metadata).not.toHaveProperty('ozonTypeId');
  });

  it('keeps 1688 preparation drafts when the prepared title still contains Chinese text', () => {
    expect(getAlibaba1688PreparationIssues({
      preparedTitleRu: '男士 кроссовки',
      targetPriceCny: '199',
      ozonCategoryId: '17031663',
      ozonTypeId: '971234',
    })).toEqual(['prepared_title_contains_cjk']);

    const metadata = buildAlibaba1688PreparationMetadata(
      { categoryMappingStatus: 'deferred_until_listing' },
      {
        preparedTitleRu: '男士 кроссовки',
        targetPriceCny: '199',
        ozonCategoryId: '17031663',
        ozonTypeId: '971234',
      },
    );

    expect(metadata).toMatchObject({
      preparedTitleRu: '男士 кроссовки',
      targetPriceCny: '199',
      ozonCategoryId: 17031663,
      ozonTypeId: 971234,
      listingPreparationStatus: 'draft',
      listingPreparationIssues: ['prepared_title_contains_cjk'],
      categoryMappingStatus: 'manual_ready',
    });
  });

  it('keeps 1688 preparation drafts when source images are missing', () => {
    const metadata = buildAlibaba1688PreparationMetadata(
      { categoryMappingStatus: 'deferred_until_listing' },
      {
        preparedTitleRu: 'Мужские кроссовки',
        targetPriceCny: '199',
        ozonCategoryId: '17031663',
        ozonTypeId: '971234',
      },
      { hasImages: false },
    );

    expect(metadata).toMatchObject({
      preparedTitleRu: 'Мужские кроссовки',
      targetPriceCny: '199',
      ozonCategoryId: 17031663,
      ozonTypeId: 971234,
      listingPreparationStatus: 'draft',
      listingPreparationIssues: ['missing_source_images'],
      categoryMappingStatus: 'manual_ready',
    });
  });

  it('normalizes 1688 preparation image links', () => {
    expect(normalizeAlibaba1688PreparationImages([
      'https://img.example.com/1.jpg',
      'not-a-url',
      ' https://img.example.com/2.jpg ',
      'https://img.example.com/1.jpg',
    ])).toEqual([
      'https://img.example.com/1.jpg',
      'https://img.example.com/2.jpg',
    ]);

    expect(normalizeAlibaba1688PreparationImages(undefined, ['https://img.example.com/fallback.jpg'])).toEqual([
      'https://img.example.com/fallback.jpg',
    ]);
  });

  it('normalizes 1688 preparation SKU repairs while preserving fallback variants', () => {
    expect(normalizeAlibaba1688PreparationVariants(undefined, [
      { sku: 'old-sku', attrs: { 规格: '旧规格' }, price: '18.5' },
    ])).toEqual([
      { sku: 'old-sku', attrs: { 规格: '旧规格' }, price: '18.5' },
    ]);

    expect(normalizeAlibaba1688PreparationVariants([
      { skuId: 'sku-red-42', specText: '红色 / 42', price: '26.5', stock: 120, minOrderQty: 2, grossWeightGrams: 650, skuImageUrl: '//img.example.com/sku-red.jpg', ozonSku: 'ozon-sku-42' },
    ])).toEqual([
      {
        sku: 'sku-red-42',
        attrs: { 规格: '红色 / 42' },
        price: '26.5',
        stock: 120,
        minOrderQty: 2,
        grossWeightGrams: 650,
        images: ['https://img.example.com/sku-red.jpg'],
        sourceSkuId: 'sku-red-42',
        sourcePlatform: '1688',
        ozonSku: 'ozon-sku-42',
      },
    ]);

    expect(normalizeAlibaba1688PreparationVariants([
      { skuId: 'sku-red-42', specText: '红色 / 42', price: '27.5' },
    ], [
      { sku: 'sku-red-42', attrs: { 规格: '红色 / 42' }, price: '26.5', images: ['https://img.example.com/existing-sku.jpg'] },
    ])).toEqual([
      {
        sku: 'sku-red-42',
        attrs: { 规格: '红色 / 42' },
        price: '27.5',
        stock: null,
        minOrderQty: null,
        grossWeightGrams: null,
        images: ['https://img.example.com/existing-sku.jpg'],
        sourceSkuId: 'sku-red-42',
        sourcePlatform: '1688',
      },
    ]);
  });

  it('inherits existing source platform when editable SKU text omits the platform column', () => {
    expect(normalizeAlibaba1688PreparationVariants([
      { skuId: 'tb-sku-red', specText: '红色', price: '21.5' },
    ], [
      {
        sku: 'tb-sku-red',
        sourceSkuId: 'tb-sku-red',
        sourcePlatform: 'taobao',
        ozonSku: 'ozon-sku-red',
        attrs: { 规格: '红色' },
        price: '19.9',
      },
    ])).toEqual([
      {
        sku: 'tb-sku-red',
        attrs: { 规格: '红色' },
        price: '21.5',
        stock: null,
        minOrderQty: null,
        grossWeightGrams: null,
        sourceSkuId: 'tb-sku-red',
        sourcePlatform: 'taobao',
        ozonSku: 'ozon-sku-red',
      },
    ]);
  });

  it('ignores invalid inherited source platforms during listing preparation', () => {
    expect(normalizeAlibaba1688PreparationVariants([
      { skuId: 'tb-sku-red', specText: '红色', price: '21.5' },
    ], [
      {
        sku: 'tb-sku-red',
        sourceSkuId: 'tb-sku-red',
        sourcePlatform: 'ozon-product-123',
        ozonSku: 'ozon-sku-red',
        attrs: { 规格: '红色' },
        price: '19.9',
      },
    ], { sourcePlatform: 'taobao' })).toEqual([
      {
        sku: 'tb-sku-red',
        attrs: { 规格: '红色' },
        price: '21.5',
        stock: null,
        minOrderQty: null,
        grossWeightGrams: null,
        sourceSkuId: 'tb-sku-red',
        sourcePlatform: 'taobao',
        ozonSku: 'ozon-sku-red',
      },
    ]);
  });

  it('uses the collected item source platform when new editable SKU text omits the platform column', () => {
    expect(normalizeAlibaba1688PreparationVariants([
      { skuId: 'tb-sku-blue', specText: '蓝色', price: '22.5' },
    ], [], { sourcePlatform: 'taobao' } as any)).toEqual([
      {
        sku: 'tb-sku-blue',
        attrs: { 规格: '蓝色' },
        price: '22.5',
        stock: null,
        minOrderQty: null,
        grossWeightGrams: null,
        sourceSkuId: 'tb-sku-blue',
        sourcePlatform: 'taobao',
      },
    ]);
  });

  it('marks 1688 preparation ready after required images are supplied', () => {
    const images = normalizeAlibaba1688PreparationImages(['https://img.example.com/ready.jpg']);
    const metadata = buildAlibaba1688PreparationMetadata(
      { categoryMappingStatus: 'deferred_until_listing' },
      {
        preparedTitleRu: 'Мужские кроссовки',
        targetPriceCny: '199',
        ozonCategoryId: '17031663',
        ozonTypeId: '971234',
      },
      { hasImages: images.length > 0 },
    );

    expect(metadata).toMatchObject({
      preparedTitleRu: 'Мужские кроссовки',
      targetPriceCny: '199',
      ozonCategoryId: 17031663,
      ozonTypeId: 971234,
      listingPreparationStatus: 'ready',
      categoryMappingStatus: 'manual_ready',
    });
    expect(metadata).not.toHaveProperty('listingPreparationIssues');
  });

  it('keeps 1688 records out of Ozon listing drafts until preparation is ready', () => {
    const result = buildAlibaba1688OzonListingDraftItems({
      id: 'collect-1688-draft',
      title: '男士运动鞋',
      sourceProductId: '734567890123',
      purchasePrice: { toString: () => '25.80' },
      currency: 'CNY',
      images: ['https://img.example.com/ready.jpg'],
      variants: [],
      metadata: {
        sourceKind: 'alibaba1688',
        preparedTitleRu: 'Мужские кроссовки',
        targetPriceCny: '199',
        categoryMappingStatus: 'deferred_until_listing',
      },
      createdAt: new Date('2026-06-07T12:00:00.000Z'),
    });

    expect(result.items).toEqual([]);
    expect(result.issues).toEqual(['missing_ozon_category_id', 'missing_ozon_type_id']);
  });

  it('keeps already active 1688 listing records out of Ozon listing drafts', () => {
    const baseReadyItem = {
      id: 'collect-1688-ready',
      title: '男士运动鞋',
      sourceProductId: '734567890123',
      purchasePrice: { toString: () => '25.80' },
      currency: 'CNY',
      images: ['https://img.example.com/base.jpg'],
      variants: [
        {
          sku: 'sku-red-42',
          sourceSkuId: 'sku-red-42',
          sourcePlatform: '1688',
          ozonSku: 'ozon-sku-42',
          attrs: { color: 'red', size: '42' },
          stock: 120,
        },
      ],
      metadata: {
        sourceKind: 'alibaba1688',
        preparedTitleRu: 'Мужские кроссовки',
        targetPriceCny: '199',
        ozonCategoryId: 17031663,
        ozonTypeId: 971234,
        description: 'Описание товара',
        categoryMappingStatus: 'manual_ready',
        listingPreparationStatus: 'ready',
      },
      createdAt: new Date('2026-06-07T12:00:00.000Z'),
    };

    expect(buildAlibaba1688OzonListingDraftItems({
      ...baseReadyItem,
      metadata: { ...baseReadyItem.metadata, listingStatus: 'submitted' },
    } as any)).toMatchObject({
      items: [],
      issues: ['listing_already_submitted'],
      listingStatus: 'submitted',
    });

    expect(buildAlibaba1688OzonListingDraftItems({
      ...baseReadyItem,
      metadata: { ...baseReadyItem.metadata, lastListingResultStatus: 'imported' },
    } as any)).toMatchObject({
      items: [],
      issues: ['listing_already_imported'],
      listingStatus: 'imported',
    });
  });

  it('allows failed 1688 listing records to generate retry drafts', () => {
    const result = buildAlibaba1688OzonListingDraftItems({
      id: 'collect-1688-retry',
      title: '男士运动鞋',
      sourceProductId: '734567890123',
      purchasePrice: { toString: () => '25.80' },
      currency: 'CNY',
      images: ['https://img.example.com/base.jpg'],
      variants: [
        {
          sku: 'sku-red-42',
          sourceSkuId: 'sku-red-42',
          sourcePlatform: '1688',
          ozonSku: 'ozon-sku-42',
          attrs: { color: 'red', size: '42' },
          stock: 120,
        },
      ],
      status: 'listing_failed',
      metadata: {
        sourceKind: 'alibaba1688',
        preparedTitleRu: 'Мужские кроссовки',
        targetPriceCny: '199',
        ozonCategoryId: 17031663,
        ozonTypeId: 971234,
        description: 'Описание товара',
        categoryMappingStatus: 'manual_ready',
        listingPreparationStatus: 'ready',
        lastListingResultStatus: 'partial_failed',
      },
      createdAt: new Date('2026-06-07T12:00:00.000Z'),
    } as any);

    expect(result.issues).toEqual([]);
    expect(result.items).toHaveLength(1);
    expect(result.listingStatus).toBe('partial_failed');
  });

  it('retries only failed 1688 variants after a partial Ozon import', () => {
    const result = buildAlibaba1688OzonListingDraftItems({
      id: 'collect-1688-partial-retry',
      title: '男士运动鞋',
      sourceProductId: '734567890123',
      purchasePrice: { toString: () => '25.80' },
      currency: 'CNY',
      images: ['https://img.example.com/base.jpg'],
      variants: [
        {
          sku: 'sku-red-42',
          sourceSkuId: 'sku-red-42',
          sourcePlatform: '1688',
          ozonSku: 'ozon-sku-42',
          attrs: { color: 'red', size: '42' },
          stock: 120,
        },
        {
          sku: 'sku-green-43',
          sourceSkuId: 'sku-green-43',
          sourcePlatform: '1688',
          ozonSku: 'ozon-sku-43',
          attrs: { color: 'green', size: '43' },
          stock: 80,
        },
      ],
      metadata: {
        sourceKind: 'alibaba1688',
        preparedTitleRu: 'Мужские кроссовки',
        targetPriceCny: '199',
        ozonCategoryId: 17031663,
        ozonTypeId: 971234,
        description: 'Описание товара',
        categoryMappingStatus: 'manual_ready',
        listingPreparationStatus: 'ready',
        lastListingResultStatus: 'partial_failed',
        lastListingResultItems: [
          {
            offerId: 'ss1688-734567890123-sku-red-42',
            sourceSkuId: 'sku-red-42',
            status: 'imported',
          },
          {
            offerId: 'ss1688-734567890123-sku-green-43',
            sourceSkuId: 'sku-green-43',
            status: 'failed',
            errors: [{ code: 'ATTRIBUTE_ERROR', description: 'required attribute missing' }],
          },
        ],
      },
      createdAt: new Date('2026-06-07T12:00:00.000Z'),
    } as any);

    expect(result.issues).toEqual([]);
    expect(result.listingStatus).toBe('partial_failed');
    expect(result.items.map((item) => item.offerId)).toEqual(['ss1688-734567890123-sku-green-43']);
    expect(result.items[0]?.sourceTrace).toMatchObject({
      sourceSkuId: 'sku-green-43',
      ozonSku: 'ozon-sku-43',
    });
  });

  it('deduplicates Ozon offer ids when source SKUs repeat across variants', () => {
    const result = buildAlibaba1688OzonListingDraftItems({
      id: 'collect-1688-duplicate-source-sku',
      title: '男士运动鞋',
      sourceProductId: '734567890123',
      purchasePrice: { toString: () => '25.80' },
      currency: 'CNY',
      images: ['https://img.example.com/base.jpg'],
      variants: [
        {
          sku: 'same-source-sku',
          sourceSkuId: 'same-source-sku',
          sourcePlatform: '1688',
          ozonSku: 'ozon-sku-red',
          attrs: { color: 'red', size: '42' },
          stock: 120,
        },
        {
          sku: 'same-source-sku',
          sourceSkuId: 'same-source-sku',
          sourcePlatform: '1688',
          ozonSku: 'ozon-sku-blue',
          attrs: { color: 'blue', size: '43' },
          stock: 80,
        },
      ],
      metadata: {
        sourceKind: 'alibaba1688',
        preparedTitleRu: 'Мужские кроссовки',
        targetPriceCny: '199',
        ozonCategoryId: 17031663,
        ozonTypeId: 971234,
        description: 'Описание товара',
        categoryMappingStatus: 'manual_ready',
        listingPreparationStatus: 'ready',
      },
      createdAt: new Date('2026-06-07T12:00:00.000Z'),
    });

    expect(result.issues).toEqual([]);
    expect(result.items.map((item) => item.offerId)).toEqual([
      'ss1688-734567890123-same-source-sku',
      'ss1688-734567890123-same-source-sku-2',
    ]);
    expect(result.items.map((item) => item.sourceTrace)).toEqual([
      expect.objectContaining({ sourceSkuId: 'same-source-sku', ozonSku: 'ozon-sku-red' }),
      expect.objectContaining({ sourceSkuId: 'same-source-sku', ozonSku: 'ozon-sku-blue' }),
    ]);
  });

  it('separates Ozon offer ids by source platform when source SKU values match', () => {
    const result = buildAlibaba1688OzonListingDraftItems({
      id: 'collect-mixed-source-platforms',
      title: '男士运动鞋',
      sourceProductId: 'shared-product',
      purchasePrice: { toString: () => '25.80' },
      currency: 'CNY',
      images: ['https://img.example.com/base.jpg'],
      variants: [
        {
          sku: 'same-source-sku',
          sourceSkuId: 'same-source-sku',
          sourcePlatform: '1688',
          ozonSku: 'ozon-sku-1688',
          attrs: { color: 'red', size: '42' },
          stock: 120,
        },
        {
          sku: 'same-source-sku',
          sourceSkuId: 'same-source-sku',
          sourcePlatform: 'taobao',
          ozonSku: 'ozon-sku-taobao',
          attrs: { color: 'blue', size: '43' },
          stock: 80,
        },
      ],
      metadata: {
        sourceKind: 'alibaba1688',
        preparedTitleRu: 'Мужские кроссовки',
        targetPriceCny: '299',
        ozonCategoryId: 17028922,
        ozonTypeId: 93410,
        description: 'Описание товара',
      },
      createdAt: new Date('2026-06-07T12:00:00.000Z'),
    });

    expect(result.issues).toEqual([]);
    expect(result.items.map((item) => item.offerId)).toEqual([
      'ss1688-shared-product-same-source-sku',
      'sstaobao-shared-product-same-source-sku',
    ]);
    expect(result.items.map((item) => item.sourceTrace)).toEqual([
      expect.objectContaining({ sourcePlatform: '1688', sourceSkuId: 'same-source-sku', ozonSku: 'ozon-sku-1688' }),
      expect.objectContaining({ sourcePlatform: 'taobao', sourceSkuId: 'same-source-sku', ozonSku: 'ozon-sku-taobao' }),
    ]);
  });

  it('inherits the collected item source platform when draft SKU rows omit it', () => {
    const result = buildAlibaba1688OzonListingDraftItems({
      id: 'collect-taobao-ready',
      title: '淘宝货源商品',
      sourcePlatform: 'taobao',
      sourceProductId: 'tb-998877',
      purchasePrice: { toString: () => '19.90' },
      currency: 'CNY',
      images: ['https://img.example.com/base.jpg'],
      variants: [
        {
          sku: 'tb-sku-red',
          sourceSkuId: 'tb-sku-red',
          ozonSku: 'ozon-sku-red',
          attrs: { color: 'red' },
          stock: 50,
        },
      ],
      metadata: {
        sourceKind: 'alibaba1688',
        preparedTitleRu: 'Товар Taobao',
        targetPriceCny: '129',
        ozonCategoryId: 17028922,
        ozonTypeId: 93410,
        description: 'Описание товара',
        listingPreparationStatus: 'ready',
      },
      createdAt: new Date('2026-06-07T12:00:00.000Z'),
    } as any);

    expect(result.issues).toEqual([]);
    expect(result.items.map((item) => item.offerId)).toEqual(['sstaobao-tb-998877-tb-sku-red']);
    expect(result.items[0]?.sourceTrace).toMatchObject({
      sourcePlatform: 'taobao',
      sourceProductId: 'tb-998877',
      sourceSkuId: 'tb-sku-red',
      ozonSku: 'ozon-sku-red',
    });
  });

  it('retries duplicate source SKU variants by failed offer id only', () => {
    const result = buildAlibaba1688OzonListingDraftItems({
      id: 'collect-1688-duplicate-source-sku-retry',
      title: '男士运动鞋',
      sourceProductId: '734567890123',
      purchasePrice: { toString: () => '25.80' },
      currency: 'CNY',
      images: ['https://img.example.com/base.jpg'],
      variants: [
        {
          sku: 'same-source-sku',
          sourceSkuId: 'same-source-sku',
          sourcePlatform: '1688',
          ozonSku: 'ozon-sku-red',
          attrs: { color: 'red', size: '42' },
          stock: 120,
        },
        {
          sku: 'same-source-sku',
          sourceSkuId: 'same-source-sku',
          sourcePlatform: '1688',
          ozonSku: 'ozon-sku-blue',
          attrs: { color: 'blue', size: '43' },
          stock: 80,
        },
      ],
      metadata: {
        sourceKind: 'alibaba1688',
        preparedTitleRu: 'Мужские кроссовки',
        targetPriceCny: '199',
        ozonCategoryId: 17031663,
        ozonTypeId: 971234,
        description: 'Описание товара',
        categoryMappingStatus: 'manual_ready',
        listingPreparationStatus: 'ready',
        lastListingResultStatus: 'partial_failed',
        lastListingResultItems: [
          {
            offerId: 'ss1688-734567890123-same-source-sku',
            sourceSkuId: 'same-source-sku',
            status: 'imported',
          },
          {
            offerId: 'ss1688-734567890123-same-source-sku-2',
            sourceSkuId: 'same-source-sku',
            status: 'failed',
            errors: [{ code: 'ATTRIBUTE_ERROR', description: 'required attribute missing' }],
          },
        ],
      },
      createdAt: new Date('2026-06-07T12:00:00.000Z'),
    } as any);

    expect(result.issues).toEqual([]);
    expect(result.items.map((item) => item.offerId)).toEqual(['ss1688-734567890123-same-source-sku-2']);
    expect(result.items[0]?.sourceTrace).toMatchObject({
      sourceSkuId: 'same-source-sku',
      ozonSku: 'ozon-sku-blue',
    });
  });

  it('builds Ozon listing draft items from ready 1688 preparation while preserving SKU trace', () => {
    const result = buildAlibaba1688OzonListingDraftItems({
      id: 'collect-1688-ready',
      title: '男士运动鞋',
      sourceProductId: '734567890123',
      purchasePrice: { toString: () => '25.80' },
      currency: 'CNY',
      images: ['https://img.example.com/base.jpg'],
      variants: [
        {
          sku: 'sku-red-42',
          sourceSkuId: 'sku-red-42',
          sourcePlatform: '1688',
          ozonSku: 'ozon-sku-42',
          ozonProductId: '123456789',
          attrs: { color: 'red', size: '42' },
          stock: 120,
          images: ['https://img.example.com/sku-red.jpg'],
        },
      ],
      metadata: {
        sourceKind: 'alibaba1688',
        preparedTitleRu: 'Мужские кроссовки',
        targetPriceCny: '199',
        ozonCategoryId: 17031663,
        ozonTypeId: 971234,
        description: 'Описание товара',
        grossWeightGrams: 650,
        lengthMm: 320,
        widthMm: 220,
        heightMm: 110,
        categoryMappingStatus: 'manual_ready',
        listingPreparationStatus: 'ready',
      },
      createdAt: new Date('2026-06-07T12:00:00.000Z'),
    });

    expect(result.issues).toEqual([]);
    expect(result.items).toEqual([
      {
        offerId: 'ss1688-734567890123-sku-red-42',
        title: 'Мужские кроссовки',
        description: 'Описание товара',
        categoryId: 17031663,
        typeId: 971234,
        price: 199,
        oldPrice: 239,
        currency: 'CNY',
        stock: 120,
        images: ['https://img.example.com/sku-red.jpg', 'https://img.example.com/base.jpg'],
        weight: 650,
        height: 110,
        depth: 320,
        width: 220,
        sourceTrace: {
          supplyGoodsId: 'collect-1688-ready',
          sourcePlatform: '1688',
          sourceProductId: '734567890123',
          sourceSkuId: 'sku-red-42',
          ozonSku: 'ozon-sku-42',
          ozonProductId: '123456789',
        },
      },
    ]);
  });
});
