import { describe, expect, it } from 'vitest';
import {
  buildAlibaba1688PriceSuggestion,
  buildAlibaba1688CollectRecord,
  buildAlibaba1688ListingPrefill,
  buildAlibaba1688PreparationMetadata,
  getAlibaba1688PreparationIssues,
  normalizeAlibaba1688PreparationImages,
  parseAttributeText,
} from '../routes/collect.js';

describe('1688 collect helpers', () => {
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
        { skuId: 'sku-red-42', attrs: { 颜色: '红色', 尺码: '42' }, specText: '红色 / 42', price: '26.5', stock: 120, minOrderQty: 2 },
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
          grossWeightGrams: null,
          sourceSkuId: 'sku-red-42',
        },
      ],
    });
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
      variants: [{ sku: 'sku-red-42', attrs: { 规格: '红色 / 42' }, price: '26.5' }],
      notes: '货源备注',
      metadata: {
        description: '商品详情包含材质、适用场景和包装说明',
        supplierName: '义乌某某工厂',
        supplierLocation: '浙江 金华',
        supplierYears: 6,
        monthlySales: 3000,
        categoryPath: '鞋类 > 男鞋 > 运动鞋',
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
      },
    );

    expect(metadata).toMatchObject({
      sourceKind: 'alibaba1688',
      offerId: '734567890123',
      categoryPath: '鞋类 > 男鞋 > 运动鞋',
      preparedTitleRu: 'Мужские кроссовки',
      targetPriceCny: '199.9',
      listingNotes: '图片需要处理',
      categoryMappingStatus: 'deferred_until_listing',
      listingPreparationStatus: 'ready',
    });
    expect(metadata).not.toHaveProperty('listingPreparationIssues');
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
      },
    );

    expect(metadata).toMatchObject({
      categoryMappingStatus: 'deferred_until_listing',
      listingPreparationStatus: 'draft',
      listingPreparationIssues: ['missing_prepared_title_ru', 'missing_target_price_cny'],
    });
    expect(metadata).not.toHaveProperty('preparedTitleRu');
    expect(metadata).not.toHaveProperty('targetPriceCny');
    expect(metadata).not.toHaveProperty('listingNotes');
  });

  it('keeps 1688 preparation drafts when the prepared title still contains Chinese text', () => {
    expect(getAlibaba1688PreparationIssues({
      preparedTitleRu: '男士 кроссовки',
      targetPriceCny: '199',
    })).toEqual(['prepared_title_contains_cjk']);

    const metadata = buildAlibaba1688PreparationMetadata(
      { categoryMappingStatus: 'deferred_until_listing' },
      {
        preparedTitleRu: '男士 кроссовки',
        targetPriceCny: '199',
      },
    );

    expect(metadata).toMatchObject({
      preparedTitleRu: '男士 кроссовки',
      targetPriceCny: '199',
      listingPreparationStatus: 'draft',
      listingPreparationIssues: ['prepared_title_contains_cjk'],
      categoryMappingStatus: 'deferred_until_listing',
    });
  });

  it('keeps 1688 preparation drafts when source images are missing', () => {
    const metadata = buildAlibaba1688PreparationMetadata(
      { categoryMappingStatus: 'deferred_until_listing' },
      {
        preparedTitleRu: 'Мужские кроссовки',
        targetPriceCny: '199',
      },
      { hasImages: false },
    );

    expect(metadata).toMatchObject({
      preparedTitleRu: 'Мужские кроссовки',
      targetPriceCny: '199',
      listingPreparationStatus: 'draft',
      listingPreparationIssues: ['missing_source_images'],
      categoryMappingStatus: 'deferred_until_listing',
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

  it('marks 1688 preparation ready after required images are supplied', () => {
    const images = normalizeAlibaba1688PreparationImages(['https://img.example.com/ready.jpg']);
    const metadata = buildAlibaba1688PreparationMetadata(
      { categoryMappingStatus: 'deferred_until_listing' },
      {
        preparedTitleRu: 'Мужские кроссовки',
        targetPriceCny: '199',
      },
      { hasImages: images.length > 0 },
    );

    expect(metadata).toMatchObject({
      preparedTitleRu: 'Мужские кроссовки',
      targetPriceCny: '199',
      listingPreparationStatus: 'ready',
      categoryMappingStatus: 'deferred_until_listing',
    });
    expect(metadata).not.toHaveProperty('listingPreparationIssues');
  });
});
