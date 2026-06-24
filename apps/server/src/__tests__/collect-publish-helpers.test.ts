import { describe, expect, it } from 'vitest';
import {
  calcPublishPrice,
  containsCjkText,
  enrichOzonVariantAttrsFromLink,
  enrichOzonVariantSpecs,
  getVariantOverridePrice,
  resolveVariantPublishPriceCny,
  findFallbackRecreateConflicts,
  groupPublishItemsByCategory,
  hasOwnPublishCategory,
  hasOzonVideoMediaAttributes,
  appendCollectedOzonVideoMediaAttributes,
  hasSuspiciousPublishName,
  recordPictureUploadDiagnostic,
  recordOfferPublishImages,
  removeVariantsBySkus,
  planFallbackPictureUploads,
  suggestNeutralOzonPublishTitle,
  resolvePublishDescription,
  resolveOzonDictionaryAttributeValues,
  resolveBasePublishImages,
  resolveItemPublishCategory,
  resolvePublishOfferId,
  resolvePublishName,
  findVariantAttributeConflicts,
  resolveVariantPublishImages,
  setVariantWatermarkedImages,
  shouldApplyCollectedVariantAttrOverride,
  buildCollectedGoodsMetadata,
  buildSourceStandardOzonAttributePlan,
  sourceCategorySignature,
  buildSourceOzonCategoryCandidates,
  resolveCollectedDisplayTitle,
  syncOzonCoreTextAttributes,
  syncOzonTitleAttribute,
  sanitizePublishDescription,
  sanitizeVariantAttrSetsForOzonPublish,
  sanitizeOzonVariantPublishAttributes,
  sanitizeOzonVariantPublishAttributeSets,
  sanitizeVariantAttrsForPublish,
  sanitizeVariantAttrsForOzonPublish,
  syncOzonVariantGroupingAttributes,
  normalizeOzonOriginCountryForChinaSeller,
  normalizeCollectedSourceVideos,
} from '../routes/collect.js';

describe('collect publish helpers', () => {
  it('calculates publish price with percentage markup and fixed amount', () => {
    expect(calcPublishPrice(50.16, 200, 10)).toBe(161);
    expect(calcPublishPrice(100, 0, 9.5)).toBe(110);
  });

  it('does not add markup by default when users leave publish markup empty', () => {
    expect(calcPublishPrice(100)).toBe(100);
    expect(calcPublishPrice(100, Number.NaN, 0)).toBe(100);
  });

  it('detects official Ozon video media attributes in publish payloads', () => {
    expect(hasOzonVideoMediaAttributes([
      { id: 21842, values: [{ value: 'https://ir.ozone.ru/s3/video-64/demo/cover/cover.jpg' }] },
    ])).toBe(true);
    expect(hasOzonVideoMediaAttributes([
      { id: 21837, complex_id: 100001, values: [{ value: 'demo.mp4' }] },
      { id: 22964, complex_id: 100001, values: [{ value: 'true' }] },
      { id: 23255, complex_id: 100001, values: [{ value: '1.78' }] },
    ])).toBe(true);
    expect(hasOzonVideoMediaAttributes([
      { attribute_id: '21846', values: [{ value: 'https://cdnvideo.v.ozone.ru/vod/video-64/demo/master.m3u8' }] },
    ])).toBe(true);
    expect(hasOzonVideoMediaAttributes([
      { id: 999001, values: [{ value: 'https://cdnvideo.v.ozone.ru/vod/video-64/demo/master.m3u8' }] },
    ])).toBe(false);
  });

  it('appends generated Ozon video media attributes when collected videos are publishable CDN videos', () => {
    const result = appendCollectedOzonVideoMediaAttributes([
      { id: 4180, complex_id: 0, values: [{ value: 'Название' }] },
    ], [
      {
        url: 'https://cdnvideo.v.ozone.ru/vod/video-64/01KF0S7TY54CCQ9SZCCMQAM1RS/asset_0_h264.mp4?type=pdp',
        coverUrl: 'https://ir.ozone.ru/s3/video-64/01KF0S7TY54CCQ9SZCCMQAM1RS/cover/cover.jpg',
      },
    ]);

    expect(result.generatedCount).toBe(7);
    expect(result.attributes.some((attr) => attr.id === 21846)).toBe(true);
    expect(result.attributes.find((attr) => attr.id === 4180)).toEqual({
      id: 4180,
      complex_id: 0,
      values: [{ value: 'Название' }],
    });
  });

  it('does not append generated Ozon video media attributes over existing official video attributes', () => {
    const existing = [
      { id: 21842, complex_id: 100002, values: [{ value: 'https://ir.ozone.ru/s3/video-64/demo/cover/cover.jpg' }] },
    ];

    expect(appendCollectedOzonVideoMediaAttributes(existing, [
      { url: 'https://cdnvideo.v.ozone.ru/vod/video-64/01KF0S7TY54CCQ9SZCCMQAM1RS/asset_0_h264.mp4?type=pdp' },
    ])).toEqual({
      attributes: existing,
      generatedCount: 0,
    });
  });

  it('detects Chinese text in publish names', () => {
    expect(containsCjkText('Чехол для iPad')).toBe(false);
    expect(containsCjkText('保护套 для iPad')).toBe(true);
  });

  it('does not persist Chinese collected titles as Russian publish titles', () => {
    expect(buildCollectedGoodsMetadata({
      title: '中国风墙面装饰',
      publishTitle: '中国风墙面装饰',
      sourceTitleRaw: '中国风墙面装饰',
      sourceLocale: 'ru',
    })).toMatchObject({
      titleNeedsReview: true,
      sourceTitleRaw: '中国风墙面装饰',
    });
    expect(buildCollectedGoodsMetadata({
      title: '中国风墙面装饰',
      publishTitle: '中国风墙面装饰',
      sourceTitleRaw: '中国风墙面装饰',
      sourceLocale: 'ru',
    })).not.toHaveProperty('publishTitleRu');
  });

  it('persists Ozon description fetch diagnostics for collected goods', () => {
    const diagnostics = {
      enabled: true,
      found: true,
      attempts: [{ api: 'entrypoint', ok: true, descriptionKeyCount: 1 }],
    };

    expect(buildCollectedGoodsMetadata({
      title: 'Дорожка для стола',
      publishTitle: 'Дорожка для стола',
      sourceTitleRaw: 'Дорожка для стола',
      sourceLocale: 'ru',
      descriptionFetchDiagnostics: diagnostics,
    })).toMatchObject({
      publishTitleRu: 'Дорожка для стола',
      descriptionFetchDiagnostics: diagnostics,
    });
  });

  it('persists domestic source product metadata for future 1688 listing preparation', () => {
    const metadata = buildCollectedGoodsMetadata({
      title: '智能保温杯批发',
      sourceTitleRaw: '智能保温杯批发',
      sourceLocale: 'zh-CN',
      sourcePlatform: '1688',
      description: '双层真空保温，适合跨境上架。',
      sourceMainImages: ['https://img.example.com/main.jpg'],
      sourceDetailImages: ['https://img.example.com/detail-1.jpg'],
      sourcePackagingRows: [{
        color: '红色',
        size: '500ml',
        lengthMm: 80,
        widthMm: 80,
        heightMm: 220,
        volumeCm3: 1408,
        weightG: 350,
      }],
      sourceRichContentDraft: {
        status: 'raw_source_requires_processing',
        source: '1688',
        locale: 'zh-CN',
        blocks: [
          { type: 'text', text: '双层真空保温，适合跨境上架。' },
          { type: 'image', url: 'https://img.example.com/detail-1.jpg' },
        ],
      },
      priceText: '¥18.80 ~ ¥22.50',
      unitPriceText: '¥18.80',
      shippingCny: 5,
      totalCostCny: 23.8,
      priceSourceType: 'rangeHigh',
      weightG: 350,
      lengthMm: 80,
      widthMm: 80,
      heightMm: 220,
      categoryPath: ['日用百货', '杯具', '保温杯'],
      categoryName: '保温杯',
      attributes: [
        { name: '材质', value: '316不锈钢' },
        { name: '容量', value: '500ml' },
      ],
      selectedSku: { skuId: 'red-500', price: 18.8, attrs: { 颜色: '红色' } },
      skuItems: [{ skuId: 'red-500', price: 18.8, images: ['https://img.example.com/red.jpg'] }],
      sourceVideos: [{ url: 'https://video.example.com/a.mp4', coverUrl: 'https://img.example.com/video.jpg' }],
      rawSourceProduct: { offerId: '744455566677' },
      extractionDiagnostics: {
        titleFound: true,
        imageCount: 2,
        skuCount: 1,
        attributeCount: 2,
        descriptionFound: true,
        videoCount: 1,
      },
    });

    expect(metadata).toMatchObject({
      titleNeedsReview: true,
      sourceTitleRaw: '智能保温杯批发',
      sourceLocale: 'zh-CN',
      sourcePlatform: '1688',
      sourceDescriptionRaw: '双层真空保温，适合跨境上架。',
      sourceMainImages: ['https://img.example.com/main.jpg'],
      sourceDetailImages: ['https://img.example.com/detail-1.jpg'],
      sourcePackagingRows: [{
        color: '红色',
        size: '500ml',
        lengthMm: 80,
        widthMm: 80,
        heightMm: 220,
        volumeCm3: 1408,
        weightG: 350,
      }],
      sourceRichContentDraft: {
        status: 'raw_source_requires_processing',
        source: '1688',
        locale: 'zh-CN',
        blocks: [
          { type: 'text', text: '双层真空保温，适合跨境上架。' },
          { type: 'image', url: 'https://img.example.com/detail-1.jpg' },
        ],
      },
      priceText: '¥18.80 ~ ¥22.50',
      unitPriceText: '¥18.80',
      shippingCny: 5,
      totalCostCny: 23.8,
      priceSourceType: 'rangeHigh',
      weightG: 350,
      lengthMm: 80,
      widthMm: 80,
      heightMm: 220,
      categoryPath: ['日用百货', '杯具', '保温杯'],
      categoryName: '保温杯',
      sourceAttributes: [
        { name: '材质', value: '316不锈钢' },
        { name: '容量', value: '500ml' },
      ],
      sourceStandardAttributes: {
        brand: { value: '', isBrandless: false },
        colors: ['红色'],
        sizes: [],
        materials: ['316不锈钢'],
        gender: { value: '' },
        seasons: [],
        packageDimensionsMm: { length: 80, width: 80, height: 220 },
        packageWeightG: 350,
        categoryHints: ['日用百货', '杯具', '保温杯'],
        missingForOzon: ['品牌/无品牌', '颜色尺码变体', '性别/季节'],
      },
      selectedSku: { skuId: 'red-500', price: 18.8, attrs: { 颜色: '红色' } },
      skuItems: [{ skuId: 'red-500', price: 18.8, images: ['https://img.example.com/red.jpg'] }],
      sourceVideos: [{ url: 'https://video.example.com/a.mp4', coverUrl: 'https://img.example.com/video.jpg' }],
      rawSourceProduct: { offerId: '744455566677' },
      extractionDiagnostics: {
        titleFound: true,
        imageCount: 2,
        skuCount: 1,
        attributeCount: 2,
        descriptionFound: true,
        videoCount: 1,
      },
    });
    expect(metadata).not.toHaveProperty('sourceDescriptionRu');
  });

  it('does not keep Chinese Ozon translated titles as collected display titles', () => {
    expect(resolveCollectedDisplayTitle({
      title: '室内装饰品',
      publishTitle: '室内装饰品',
      sourceTitleRaw: '室内装饰品',
      sourceUrl: 'https://www.ozon.ru/product/6-rafiya-ruchnoy-rabotydekor-na-stenu-dlya-interera-1616509508/',
      sourceProductId: '1616509508',
    })).toBe('Rafiya ruchnoy rabotydekor na stenu dlya interera');

    expect(resolveCollectedDisplayTitle({
      title: '室内装饰品',
      sourceProductId: '1616509508',
    })).toBe('Ozon SKU 1616509508');
  });

  it('keeps domestic source titles for source collection records', () => {
    expect(resolveCollectedDisplayTitle({
      title: '智能保温杯批发',
      sourceTitleRaw: '智能保温杯批发',
      sourcePlatform: '1688',
      sourceProductId: '744455566677',
    })).toBe('智能保温杯批发');
  });

  it('flags repeated keyword spam titles before Ozon rejects the card', () => {
    expect(hasSuspiciousPublishName('Автовизитка, автовизитка в машину, номер телефона в автомобиль')).toBe(true);
    expect(hasSuspiciousPublishName('Защитный чехол для AirPods Pro 3 вязание')).toBe(false);
  });

  it('uses Russian publish title from metadata before display title', () => {
    const name = resolvePublishName({
      title: '中文商品名',
      metadata: { publishTitleRu: 'Чехол для iPad' },
    }, { Цвет: 'серый' });
    expect(name).toBe('Чехол для iPad серый');
  });

  it('does not append browser-translated Chinese variant values to Ozon publish titles', () => {
    const name = resolvePublishName({
      title: 'Бюстгальтер Top Bra',
      metadata: {},
    }, {
      '颜色': '咖啡色',
      '尺码': '52 RU / XL',
    });

    expect(name).toBe('Бюстгальтер Top Bra, 52 RU, XL');
    expect(containsCjkText(name)).toBe(false);
  });

  it('drops Chinese variant attributes before publishing Ozon attributes', () => {
    expect(sanitizeVariantAttrsForPublish({
      'Цвет': '咖啡色',
      '颜色': 'бежевый',
      'Размер': '52 RU / XL',
    })).toEqual({
      'Размер': '52 RU / XL',
    });
  });

  it('deduplicates repeated color words when appending variant attributes to publish names', () => {
    const name = resolvePublishName({
      title: 'Панама Zara черный',
      metadata: {},
    }, { Цвет: 'черный сапфир' });

    expect(name).toBe('Панама Zara черный сапфир');
    expect(hasSuspiciousPublishName(name)).toBe(false);
  });

  it('cleans Ozon publish names that have leading counts, glued Russian words, and multi-word variants', () => {
    const name = resolvePublishName({
      title: '6 Рафия ручной работыдекор на стену для интерьера',
      metadata: {},
    }, { Материал: 'Деревянные шарики' });

    expect(name).toBe('Рафия ручной работы декор на стену для интерьера, деревянные шарики');
    expect(name).not.toMatch(/^\d+\s/);
    expect(name).not.toContain('работыдекор');
    expect(hasSuspiciousPublishName(name)).toBe(false);
  });

  it('keeps punctuation and shortens long multi-variant publish names', () => {
    const name = resolvePublishName({
      title: 'Форма для льда QIWU форма для льда 1 яч 1 шт',
      metadata: {},
    }, {
      'Цвет': 'бирюзовый, салатовый',
      'Количество ячеек, шт': '1',
      'Количество в упаковке, шт': '4',
    });

    expect(name).toBe('Форма для льда QIWU, бирюзовый, салатовый, 1, 4');
    expect(name.length).toBeLessThan(80);
  });

  it('normalizes repeated table runner base titles before appending color variants', () => {
    const name = resolvePublishName({
      title: 'Carte Blanche Скатерть-дорожка на стол 90x300 см, кухонная дорожка сервировочная',
      metadata: {},
    }, {
      'Цвет': 'красный, салатовый, светло-желтый, желтый',
    });

    expect(name).toBe('Скатерть-дорожка на стол Carte Blanche, 90x300 см, красный, салатовый, светло-желтый');
    expect(hasSuspiciousPublishName(name)).toBe(false);
  });

  it('drops redundant shade color-name parts from publish titles', () => {
    const name = resolvePublishName({
      title: 'Carte Blanche Скатерть-дорожка на стол 90x300 см, кухонная дорожка сервировочная',
      metadata: {},
    }, {
      'Цвет': 'красный, светло-розовый',
      'Название цвета': 'розовый луг',
    });

    expect(name).toBe('Скатерть-дорожка на стол Carte Blanche, 90x300 см, красный, светло-розовый');
    expect(name).not.toContain('розовый луг');
    expect(hasSuspiciousPublishName(name)).toBe(false);
  });

  it('neutralizes color-name variants that repeat the base color family before publish', () => {
    expect(sanitizeVariantAttrSetsForOzonPublish([
      { 'Цвет': 'красный, светло-розовый', 'Название цвета': 'розовый луг' },
      { 'Цвет': 'красный, светло-розовый', 'Название цвета': 'розовый жемчуг' },
    ])).toEqual([
      { 'Цвет': 'красный, светло-розовый', 'Название цвета': 'Тип 1' },
      { 'Цвет': 'красный, светло-розовый', 'Название цвета': 'Тип 2' },
    ]);
  });

  it('turns repeated keyword spam titles into short publish names with variant color', () => {
    const name = resolvePublishName({
      title: 'Автовизитка, автовизитка в машину, номер телефона в автомобиль,Ретро-парковочная плата для автомобиля',
      metadata: {},
    }, { Цвет: 'коричнево-красный' });

    expect(name).toBe('Автовизитка для автомобиля коричнево-красный цвет');
    expect(hasSuspiciousPublishName(name)).toBe(false);
  });

  it('drops duplicated numeric variant suffixes when they make the publish title spammy', () => {
    const name = resolvePublishName({
      title: "Мист для тела и волос парфюмированный Eclat d'arpege Mi Comimi 100 мл",
      metadata: {},
    }, { 'Объем, мл': '100.1' });

    expect(name).toBe("Мист для тела и волос парфюмированный Eclat d'arpege Mi Comimi 100 мл");
    expect(name).not.toContain('100.1');
    expect(hasSuspiciousPublishName(name)).toBe(false);
  });

  it('suggests a neutral title for risky collectible figurine names without changing publish name automatically', () => {
    const item = {
      title: 'Фигурка девочки-лисицы в прозрачной юбке высотой 26 см',
      metadata: {},
    };

    expect(resolvePublishName(item)).toBe('Фигурка девочки-лисицы в прозрачной юбке высотой 26 см');
    expect(suggestNeutralOzonPublishTitle(item)).toEqual({
      suggestedTitle: 'Коллекционная декоративная фигурка, 26 см',
      reasons: ['标题含可能触发 Ozon 审核的敏感/营销词，建议改成中性商品名'],
    });
  });

  it('suggests a neutral title for perfumed body and hair mist titles', () => {
    expect(suggestNeutralOzonPublishTitle({
      title: "Мист для тела и волос парфюмированный Eclat d'arpege Mi Comimi 100 мл",
      metadata: {},
    })).toEqual({
      suggestedTitle: 'Парфюмированный мист для тела и волос, 100 мл',
      reasons: ['标题含品牌/变体后缀或疑似堆词，建议改成中性商品名'],
    });
  });

  it('replaces cloned Ozon title attribute with the final cleaned publish name', () => {
    const attrs = syncOzonTitleAttribute([
      {
        id: 4180,
        complex_id: 0,
        values: [{ value: 'Автовизитка, автовизитка в машину, номер телефона в автомобиль' }],
      },
      {
        id: 85,
        complex_id: 0,
        values: [{ value: 'Без бренда', dictionary_value_id: 97021 }],
      },
    ], 'Автовизитка ретро для автомобиля');

    expect(attrs.filter((attr) => attr.id === 4180)).toEqual([{
      id: 4180,
      complex_id: 0,
      values: [{ value: 'Автовизитка ретро для автомобиля' }],
    }]);
    expect(attrs.find((attr) => attr.id === 85)?.values[0]?.value).toBe('Без бренда');
  });

  it('replaces cloned Ozon title and description attributes with final publish text', () => {
    const attrs = syncOzonCoreTextAttributes([
      {
        id: 4180,
        complex_id: 0,
        values: [{ value: 'Старое название' }],
      },
      {
        id: 4191,
        complex_id: 0,
        values: [{ value: 'Старое описание из исходной карточки' }],
      },
      {
        id: 85,
        complex_id: 0,
        values: [{ value: 'Без бренда', dictionary_value_id: 97021 }],
      },
    ], 'Новое название', '<p>Новое описание</p>');

    expect(attrs.filter((attr) => attr.id === 4180)).toEqual([{
      id: 4180,
      complex_id: 0,
      values: [{ value: 'Новое название' }],
    }]);
    expect(attrs.filter((attr) => attr.id === 4191)).toEqual([{
      id: 4191,
      complex_id: 0,
      values: [{ value: 'Новое описание' }],
    }]);
    expect(attrs.find((attr) => attr.id === 85)?.values[0]?.value).toBe('Без бренда');
  });

  it('uses collected source descriptions as sanitized publish descriptions', () => {
    expect(sanitizePublishDescription('<p>Описание&nbsp;товара</p><script>bad()</script><br>Характеристики')).toBe(
      'Описание товара\nХарактеристики',
    );

    expect(sanitizePublishDescription('Хлопок Проверено Оригинальный Белый')).toBe(
      'Хлопок Белый',
    );

    expect(resolvePublishDescription({
      notes: 'old note',
      metadata: {
        sourceDescriptionRu: '<p>Подробное описание товара</p>',
      },
    })).toBe('Подробное описание товара');
    expect(resolvePublishDescription({
      notes: '重量: 500g\n  Краткое описание из заметок  ',
      metadata: {},
    })).toBe('Краткое описание из заметок');
  });

  it('normalizes collected source video metadata without keeping invalid rows', () => {
    expect(normalizeCollectedSourceVideos([
      {
        videoUrl: ' https://cdn.example.com/video/demo.mp4 ',
        coverUrl: 'https://cdn.example.com/video/demo-cover.jpg',
        title: 'Обзор товара',
      },
      {
        url: 'https://cdn.example.com/video/demo.mp4',
        cover: 'https://cdn.example.com/video/duplicate-cover.jpg',
      },
      {
        coverUrl: 'https://cdn.example.com/video/no-video.jpg',
      },
    ])).toEqual([{
      url: 'https://cdn.example.com/video/demo.mp4',
      coverUrl: 'https://cdn.example.com/video/demo-cover.jpg',
      title: 'Обзор товара',
    }]);
  });

  it('keeps composite Ozon dictionary values as multiple values instead of collapsing to the first color', () => {
    const dict = [
      { id: 101, value: 'бирюзовый' },
      { id: 102, value: 'салатовый' },
      { id: 103, value: 'лазурный' },
    ];

    expect(resolveOzonDictionaryAttributeValues('бирюзовый, салатовый', dict)).toEqual({
      values: [
        { value: 'бирюзовый', dictionary_value_id: 101 },
        { value: 'салатовый', dictionary_value_id: 102 },
      ],
      matched: true,
      matchType: 'split',
    });
  });

  it('uses raw composite text instead of cloned stale values when an Ozon dictionary value is incomplete', () => {
    const result = resolveOzonDictionaryAttributeValues('бирюзовый, редкий оттенок', [
      { id: 101, value: 'бирюзовый' },
    ]);

    expect(result).toEqual({
      values: [{ value: 'бирюзовый, редкий оттенок', dictionary_value_id: 0 }],
      matched: false,
      matchType: 'text-fallback',
    });
  });

  it('does not collapse near-color variant values into a broader Ozon dictionary entry', () => {
    const result = resolveOzonDictionaryAttributeValues('светло-голубой', [
      { id: 101, value: 'голубой' },
      { id: 102, value: 'синий' },
    ]);

    expect(result).toEqual({
      values: [{ value: 'светло-голубой', dictionary_value_id: 0 }],
      matched: false,
      matchType: 'text-fallback',
    });
  });

  it('does not treat long collected color sentences as Ozon color dictionary values', () => {
    const result = resolveOzonDictionaryAttributeValues(
      '50х50 Сатин Мойка для кухни нержавеющая с PVD покрытием',
      [
        { id: 101, value: 'сатин' },
        { id: 102, value: 'графит' },
        { id: 103, value: 'серебристый' },
      ],
    );

    expect(result).toEqual({
      values: [],
      matched: false,
      matchType: 'empty',
    });
  });

  it('extracts safe color tokens from mixed marketing color phrases', () => {
    const result = resolveOzonDictionaryAttributeValues(
      'Хлопок Проверено Оригинальный Белый',
      [
        { id: 101, value: 'белый' },
        { id: 102, value: 'черный' },
      ],
    );

    expect(result).toEqual({
      values: [{ value: 'белый', dictionary_value_id: 101 }],
      matched: true,
      matchType: 'split',
    });
  });

  it('rewrites cloned Russian origin country to China for China seller publishing', () => {
    const attrs = normalizeOzonOriginCountryForChinaSeller([{
      id: 4389,
      complex_id: 0,
      values: [{ value: 'Россия', dictionary_value_id: 643 }],
    }, {
      id: 85,
      complex_id: 0,
      values: [{ value: 'Без бренда', dictionary_value_id: 97021 }],
    }], [
      { id: 643, value: 'Россия' },
      { id: 156, value: 'Китай' },
    ]);

    expect(attrs).toContainEqual({
      id: 4389,
      complex_id: 0,
      values: [{ value: 'Китай', dictionary_value_id: 156 }],
    });
    expect(attrs).toContainEqual({
      id: 85,
      complex_id: 0,
      values: [{ value: 'Без бренда', dictionary_value_id: 97021 }],
    });
  });

  it('keeps official SKU variant attributes instead of overwriting them with collected web aspects', () => {
    expect(shouldApplyCollectedVariantAttrOverride([{
      id: 10096,
      complex_id: 0,
      values: [{ value: 'голубой', dictionary_value_id: 101 }],
    }], 10096)).toBe(false);

    expect(shouldApplyCollectedVariantAttrOverride([{
      id: 10096,
      complex_id: 0,
      values: [{ value: 'голубой', dictionary_value_id: 101 }],
    }], 10097)).toBe(false);
  });

  it('detects duplicate collected variant signatures before Ozon rejects merged variants', () => {
    expect(findVariantAttributeConflicts([
      { sku: '1945889349', attrs: { 'Цвет': 'коричневый' } },
      { sku: '1945889350', attrs: { 'Цвет': 'коричневый' } },
      { sku: '1945889351', attrs: { 'Цвет': 'хаки' } },
    ])).toEqual([{
      skus: ['1945889349', '1945889350'],
      attrs: { 'Цвет': 'коричневый' },
    }]);
  });

  it('ignores long descriptive color sentences when checking variant conflicts', () => {
    expect(findVariantAttributeConflicts([
      {
        sku: '2159287264',
        attrs: { 'Цвет': 'Держатель для инструмента серебристый 50*50см толщиной 3,0 мм' },
      },
      {
        sku: '2303472839',
        attrs: { 'Цвет': 'Держатель для инструментов черный 50*50 см толщина 3,0 мм' },
      },
    ])).toEqual([]);
  });

  it('drops marketing words from mixed color attrs before using them in publish title', () => {
    expect(sanitizeVariantAttrsForPublish({
      'Цвет': 'Хлопок Проверено Оригинальный Белый',
    })).toEqual({
      'Цвет': 'Белый',
    });

    expect(resolvePublishName({
      title: 'Футболка женская',
      metadata: {},
    }, {
      'Цвет': 'Хлопок Проверено Оригинальный Белый',
    })).toBe('Футболка женская белый');
  });

  it('preserves compound color prefixes so distinct shades do not collapse', () => {
    expect(sanitizeVariantAttrsForPublish({
      'Цвет': 'коричнево красный',
    })).toEqual({
      'Цвет': 'коричнево-красный',
    });

    expect(resolveOzonDictionaryAttributeValues('коричнево красный', [
      { id: 101, value: 'коричнево-красный' },
      { id: 102, value: 'коричневый' },
    ])).toEqual({
      values: [{ value: 'коричнево-красный', dictionary_value_id: 101 }],
      matched: true,
      matchType: 'exact',
    });

    expect(findVariantAttributeConflicts([
      { sku: 'a', attrs: { 'Цвет': 'коричнево красный' } },
      { sku: 'b', attrs: { 'Цвет': 'коричневый' } },
    ])).toEqual([]);
  });

  it('keeps short Ozon color-name variants so same base colors stay distinct', () => {
    expect(sanitizeVariantAttrsForPublish({
      'Цвет': 'красный',
      'Название цвета': 'Тип 1',
    })).toEqual({
      'Цвет': 'красный',
      'Название цвета': 'Тип 1',
    });

    expect(findVariantAttributeConflicts([
      { sku: '2300714578', attrs: { 'Цвет': 'красный', 'Название цвета': 'изысканный' } },
      { sku: '3048351087', attrs: { 'Цвет': 'красный', 'Название цвета': 'Тип 1' } },
      { sku: '3048353403', attrs: { 'Цвет': 'красный', 'Название цвета': 'Тип 2' } },
    ])).toEqual([]);
  });

  it('does not append subjective Ozon color-name phrases to publish titles', () => {
    const elegantName = resolvePublishName({
      title: 'Скатертью-дорожка на стол дорожка сервировочная',
      metadata: {},
    }, {
      'Цвет': 'светло-бежевый',
      'Название цвета': 'изысканный',
    });

    expect(elegantName).toBe('Дорожка на стол сервировочная светло-бежевый');
    expect(elegantName).not.toContain('изысканный');
    expect(hasSuspiciousPublishName(elegantName)).toBe(false);

    const descriptiveName = resolvePublishName({
      title: 'Скатертью-дорожка на стол дорожка сервировочная',
      metadata: {},
    }, {
      'Цвет': 'светло-зеленый',
      'Название цвета': 'красивых зеленых кусочков',
    });

    expect(descriptiveName).toBe('Дорожка на стол сервировочная светло-зеленый');
    expect(descriptiveName).not.toContain('красивых');
    expect(descriptiveName).not.toContain('кусочков');
    expect(hasSuspiciousPublishName(descriptiveName)).toBe(false);
  });

  it('turns unsafe Ozon color-name publish attrs into neutral variant labels', () => {
    expect(sanitizeVariantAttrsForOzonPublish({
      'Цвет': 'светло-бежевый',
      'Название цвета': 'изысканный',
    }, { variantIndex: 0 })).toEqual({
      'Цвет': 'светло-бежевый',
      'Название цвета': 'Тип 1',
    });

    expect(sanitizeVariantAttrsForOzonPublish({
      'Цвет': 'светло-зеленый',
      'Название цвета': 'красивых зеленых кусочков',
    }, { variantIndex: 1 })).toEqual({
      'Цвет': 'светло-зеленый',
      'Название цвета': 'Тип 2',
    });

    expect(sanitizeVariantAttrsForOzonPublish({
      'Цвет': 'светло-бежевый',
      'Название цвета': '90*180cm',
    }, { variantIndex: 2 })).toEqual({
      'Цвет': 'светло-бежевый',
      'Название цвета': '90x180 см',
    });
  });

  it('normalizes descriptive composite colors for Ozon color dictionary publishing', () => {
    expect(sanitizeVariantAttrSetsForOzonPublish([
      {
        'Цвет': 'белый',
        'Название цвета': 'Тип 1',
        'Российский размер': '44',
      },
      {
        'Цвет': 'белый, бежевый нейтральный',
        'Российский размер': '44',
      },
    ])).toEqual([
      {
        'Цвет': 'белый',
        'Название цвета': 'Тип 1',
        'Российский размер': '44',
      },
      {
        'Цвет': 'белый, бежевый',
        'Название цвета': 'Тип 2',
        'Российский размер': '44',
      },
    ]);
  });

  it('does not send raw text fallback for strict Ozon color dictionaries', () => {
    expect(resolveOzonDictionaryAttributeValues(
      'белый, бежевый нейтральный',
      [{ id: 101, value: 'белый' }],
      { allowTextFallback: false, allowPartialDictionaryValues: true },
    )).toEqual({
      values: [{ value: 'белый', dictionary_value_id: 101 }],
      matched: true,
      matchType: 'partial',
    });
  });

  it('avoids neutral color-name labels that collide with existing structured variants', () => {
    expect(sanitizeVariantAttrSetsForOzonPublish([
      { 'Цвет': 'красный', 'Название цвета': 'изысканный' },
      { 'Цвет': 'красный', 'Название цвета': 'Тип 1' },
      { 'Цвет': 'красный', 'Название цвета': 'Тип 2' },
    ])).toEqual([
      { 'Цвет': 'красный', 'Название цвета': 'Тип 3' },
      { 'Цвет': 'красный', 'Название цвета': 'Тип 1' },
      { 'Цвет': 'красный', 'Название цвета': 'Тип 2' },
    ]);
  });

  it('uses neutralized color-name labels in publish titles to avoid duplicate same-color names', () => {
    const safeVariantAttrs = sanitizeVariantAttrSetsForOzonPublish([
      { 'Цвет': 'светло-бежевый', 'Название цвета': 'изысканный' },
      { 'Цвет': 'светло-бежевый', 'Название цвета': 'Тип 1' },
    ]);

    expect(resolvePublishName({
      title: 'Скатертью-дорожка на стол дорожка сервировочная',
      metadata: {},
    }, safeVariantAttrs[0])).toBe('Дорожка на стол сервировочная, светло-бежевый, тип 2');

    expect(resolvePublishName({
      title: 'Скатертью-дорожка на стол дорожка сервировочная',
      metadata: {},
    }, safeVariantAttrs[1])).toBe('Дорожка на стол сервировочная, светло-бежевый, тип 1');
  });

  it('neutralizes cloned Ozon color-name attributes before sending import payloads', () => {
    expect(sanitizeOzonVariantPublishAttributes([
      {
        id: 10097,
        complex_id: 0,
        values: [{ value: 'изысканный', dictionary_value_id: 123 }],
      },
      {
        id: 10096,
        complex_id: 0,
        values: [{ value: 'светло-бежевый', dictionary_value_id: 456 }],
      },
    ], { variantIndex: 0 })).toEqual([
      {
        id: 10097,
        complex_id: 0,
        values: [{ value: 'Тип 1', dictionary_value_id: 0 }],
      },
      {
        id: 10096,
        complex_id: 0,
        values: [{ value: 'светло-бежевый', dictionary_value_id: 456 }],
      },
    ]);
  });

  it('preserves cloned multi-value Ozon color dictionary ids instead of collapsing to text', () => {
    expect(sanitizeOzonVariantPublishAttributes([
      {
        id: 10096,
        complex_id: 0,
        values: [
          { value: 'бежевый', dictionary_value_id: 61573 },
          { value: 'красный', dictionary_value_id: 61579 },
          { value: 'зеленый', dictionary_value_id: 61583 },
          { value: 'оранжевый', dictionary_value_id: 61585 },
        ],
      },
    ], { variantIndex: 0 })).toEqual([
      {
        id: 10096,
        complex_id: 0,
        values: [
          { value: 'бежевый', dictionary_value_id: 61573 },
          { value: 'красный', dictionary_value_id: 61579 },
          { value: 'зеленый', dictionary_value_id: 61583 },
          { value: 'оранжевый', dictionary_value_id: 61585 },
        ],
      },
    ]);
  });

  it('avoids cloned Ozon color-name collisions across a variant batch', () => {
    expect(sanitizeOzonVariantPublishAttributeSets([
      [
        {
          id: 10097,
          complex_id: 0,
          values: [{ value: 'изысканный', dictionary_value_id: 0 }],
        },
      ],
      [
        {
          id: 10097,
          complex_id: 0,
          values: [{ value: 'Тип 1', dictionary_value_id: 61571 }],
        },
      ],
    ])).toEqual([
      [
        {
          id: 10097,
          complex_id: 0,
          values: [{ value: 'Тип 2', dictionary_value_id: 0 }],
        },
      ],
      [
        {
          id: 10097,
          complex_id: 0,
          values: [{ value: 'Тип 1', dictionary_value_id: 61571 }],
        },
      ],
    ]);
  });

  it('still appends structured Ozon color-name variants to publish titles', () => {
    expect(resolvePublishName({
      title: 'Дорожка на стол сервировочная',
      metadata: {},
    }, {
      'Цвет': 'светло-бежевый',
      'Название цвета': 'Тип 1',
    })).toBe('Дорожка на стол сервировочная, светло-бежевый, тип 1');

    expect(resolvePublishName({
      title: 'Дорожка на стол сервировочная',
      metadata: {},
    }, {
      'Цвет': 'светло-бежевый',
      'Название цвета': '90*180cm',
    })).toBe('Дорожка на стол сервировочная, светло-бежевый, 90x180 см');
  });

  it('still drops long descriptive Ozon color-name values before publish', () => {
    expect(sanitizeVariantAttrsForPublish({
      'Цвет': 'зеленый',
      'Название цвета': 'Изысканный зеленый цвет в соответствии с рождественской сценой',
    })).toEqual({
      'Цвет': 'зеленый',
    });
  });

  it('keeps valid prefixed and less-common Ozon colors instead of dropping variant attrs', () => {
    expect(sanitizeVariantAttrsForPublish({
      'Цвет': 'Светло-фиолетовый',
    })).toEqual({
      'Цвет': 'Светло-фиолетовый',
    });

    expect(sanitizeVariantAttrsForPublish({
      'Цвет': 'Темно-синий',
    })).toEqual({
      'Цвет': 'Темно-синий',
    });

    expect(sanitizeVariantAttrsForPublish({
      'Цвет': 'Темно-винно-красный',
    })).toEqual({
      'Цвет': 'Темно-винно-красный',
    });

    expect(sanitizeVariantAttrsForPublish({
      'Цвет': 'Крем',
    })).toEqual({
      'Цвет': 'Крем',
    });

    expect(sanitizeVariantAttrsForPublish({
      'Цвет': 'Верблюд',
    })).toEqual({
      'Цвет': 'Верблюд',
    });
  });

  it('resolves valid prefixed colors to dictionary values when Ozon provides those values', () => {
    expect(resolveOzonDictionaryAttributeValues('Светло-фиолетовый', [
      { id: 101, value: 'Светло-фиолетовый' },
      { id: 102, value: 'Фиолетовый' },
    ])).toEqual({
      values: [{ value: 'Светло-фиолетовый', dictionary_value_id: 101 }],
      matched: true,
      matchType: 'exact',
    });

    expect(resolveOzonDictionaryAttributeValues('Темно-винно-красный', [
      { id: 101, value: 'Темно-винно-красный' },
      { id: 102, value: 'Бордовый' },
    ])).toEqual({
      values: [{ value: 'Темно-винно-красный', dictionary_value_id: 101 }],
      matched: true,
      matchType: 'exact',
    });
  });

  it('does not collapse distinct valid shade names into empty variant signatures', () => {
    expect(findVariantAttributeConflicts([
      { sku: '2912064172', attrs: { 'Цвет': 'Светло-фиолетовый' } },
      { sku: '2912067487', attrs: { 'Цвет': 'Темно-синий' } },
      { sku: '2912066933', attrs: { 'Цвет': 'Крем' } },
      { sku: '2912066564', attrs: { 'Цвет': 'Верблюд' } },
      { sku: '2912067006', attrs: { 'Цвет': 'Темно-винно-красный' } },
    ])).toEqual([]);
  });

  it('keeps code-like color variants distinct without treating them as Ozon dictionary colors', () => {
    expect(sanitizeVariantAttrsForPublish({
      'Цвет': 'AB-1',
      'Размер': '36 RU / S',
    })).toEqual({
      'Цвет': 'AB-1',
      'Размер': '36 RU / S',
    });

    expect(resolvePublishName({
      title: 'Худи',
      metadata: {},
    }, {
      'Цвет': 'AB-1',
      'Размер': '36 RU / S',
    })).toBe('Худи, 36 RU, S');

    expect(sanitizeVariantAttrSetsForOzonPublish([
      { 'Цвет': 'AB-1', 'Размер': '36 RU / S' },
      { 'Цвет': 'AB-6', 'Размер': '36 RU / S' },
    ])).toEqual([
      { 'Название цвета': 'AB-1', 'Размер': '36 RU / S' },
      { 'Название цвета': 'AB-6', 'Размер': '36 RU / S' },
    ]);

    expect(findVariantAttributeConflicts([
      { sku: '908024412', attrs: { 'Цвет': 'AB-1', 'Размер': '36 RU / S' } },
      { sku: '908024681', attrs: { 'Цвет': 'AB-6', 'Размер': '36 RU / S' } },
      { sku: '908023810', attrs: { 'Цвет': 'AB-1', 'Размер': '38 RU / M' } },
    ])).toEqual([]);
  });

  it('keeps short style names from strict color fields as safe Ozon color-name variants', () => {
    expect(sanitizeVariantAttrSetsForOzonPublish([
      { 'Цвет': 'Цилиндры', 'Количество в упаковке, шт': '24' },
      { 'Цвет': 'Звёздочки_серые', 'Количество в упаковке, шт': '24' },
      { 'Цвет': 'Бежевый-овал', 'Количество в упаковке, шт': '24' },
    ])).toEqual([
      { 'Название цвета': 'Тип 1', 'Количество в упаковке, шт': '24' },
      { 'Название цвета': 'Тип 2', 'Количество в упаковке, шт': '24' },
      { 'Название цвета': 'Тип 3', 'Количество в упаковке, шт': '24' },
    ]);

    expect(findVariantAttributeConflicts([
      { sku: '2100145720', attrs: { 'Цвет': 'Цилиндры', 'Количество в упаковке, шт': '24' } },
      { sku: '2100115253', attrs: { 'Цвет': 'Звёздочки_серые', 'Количество в упаковке, шт': '24' } },
      { sku: '2107687981', attrs: { 'Цвет': 'Бежевый-овал', 'Количество в упаковке, шт': '24' } },
    ])).toEqual([]);
  });

  it('does not append long repeated multi-color lists to Ozon publish titles', () => {
    const attrs = sanitizeVariantAttrSetsForOzonPublish([{
      'Цвет': 'белый, красный, светло-желтый, светло-синий, светло-розовый',
      'Название цвета': 'Ромашки_шпажки',
    }])[0];

    expect(resolvePublishName({
      title: 'Шпажки для канапе Морские раковины", 24 шт, 12 см',
      metadata: {},
    }, attrs)).toBe('Шпажки для канапе Морские раковины", 24 шт, 12 см, тип 1');
  });

  it('ranks shared confirmed Ozon category mappings and reports candidate gaps', () => {
    const sourceItem = {
      title: '女式棉质T恤',
      metadata: {
        sourcePlatform: '1688',
        categoryPath: ['服饰内衣', '女装', 'T恤'],
        categoryName: 'T恤',
        sourceStandardAttributes: {
          brand: { value: '', isBrandless: true },
          colors: ['черный'],
          sizes: ['M'],
          materials: ['хлопок'],
          gender: { value: 'female' },
          seasons: [],
          packageDimensionsMm: { length: 300, width: 200, height: 30 },
          packageWeightG: 120,
          categoryHints: ['服饰内衣', '女装', 'T恤'],
          missingForOzon: ['性别/季节'],
        },
      },
    };
    const signature = sourceCategorySignature(sourceItem);
    expect(signature).toBe('1688|服饰内衣>女装>t恤');

    const candidates = buildSourceOzonCategoryCandidates({
      item: sourceItem,
      categoryTree: [
        { description_category_id: 170001, category_name: 'Одежда', type_id: 91001, type_name: 'Футболки', children: [] },
        { description_category_id: 170002, category_name: 'Дом', type_id: 91002, type_name: 'Термокружки', children: [] },
      ],
      attributesByCategory: {
        '170001:91001': [
          { id: 85, name: 'Бренд', is_required: true, dictionary_id: 100 },
          { id: 10096, name: 'Цвет', is_required: true, dictionary_id: 200 },
          { id: 4295, name: 'Российский размер', is_required: true },
          { id: 9001, name: 'Материал', is_required: true },
          { id: 9002, name: 'Пол', is_required: true, dictionary_id: 300 },
          { id: 9003, name: 'Сезон', is_required: true, dictionary_id: 400 },
        ],
        '170002:91002': [
          { id: 85, name: 'Бренд', is_required: true, dictionary_id: 100 },
          { id: 7777, name: 'Объем', is_required: true },
        ],
      },
      confirmedMappings: [
        { signature, categoryId: 170001, typeId: 91001, categoryName: 'Одежда', typeName: 'Футболки', confirmations: 3 },
        { signature: '1688|日用百货>杯具>保温杯', categoryId: 170002, typeId: 91002, confirmations: 5 },
      ],
    });

    expect(candidates[0]).toMatchObject({
      categoryId: 170001,
      typeId: 91001,
      label: 'recommended',
      selected: true,
      source: 'shared_history',
      confirmationCount: 3,
    });
    expect(candidates[0]?.attributePlan.candidates.map((candidate: any) => candidate.standardKey)).toEqual(['brand', 'colors', 'sizes', 'materials', 'gender']);
    expect(candidates[0]?.attributePlan.missingRequired).toEqual([
      { attributeId: 9003, attributeName: 'Сезон', standardKey: 'seasons', reason: 'no_source_standard_value' },
    ]);
    expect(candidates[1]).toMatchObject({ categoryId: 170002, typeId: 91002, label: 'risky', selected: false });
  });

  it('extracts Ozon type leaves from parent category nodes and matches Chinese source terms', () => {
    const candidates = buildSourceOzonCategoryCandidates({
      item: {
        title: '港风抽绳牛仔裤男宽松直筒裤',
        sourcePlatform: '1688',
        metadata: {
          sourcePlatform: '1688',
          sourceStandardAttributes: {
            brand: { value: '', isBrandless: true },
            colors: ['черный'],
            sizes: ['M'],
            materials: ['хлопок'],
            gender: { value: 'male' },
            seasons: ['summer'],
            packageDimensionsMm: { length: 300, width: 250, height: 40 },
            packageWeightG: 350,
            categoryHints: [],
            missingForOzon: [],
          },
        },
      },
      categoryTree: [
        {
          description_category_id: 17028706,
          category_name: 'Одежда',
          children: [
            {
              description_category_id: 17028718,
              category_name: 'Мужская одежда',
              children: [
                { type_id: 95913, type_name: 'Джинсы', children: [] },
              ],
            },
          ],
        },
      ],
      attributesByCategory: {
        '17028718:95913': [
          { id: 85, name: 'Бренд', is_required: true, dictionary_id: 100 },
          { id: 10096, name: 'Цвет', is_required: true, dictionary_id: 200 },
          { id: 4295, name: 'Российский размер', is_required: true },
          { id: 9001, name: 'Материал', is_required: true },
          { id: 9002, name: 'Пол', is_required: true, dictionary_id: 300 },
          { id: 9003, name: 'Сезон', is_required: true, dictionary_id: 400 },
        ],
      },
    });

    expect(candidates[0]).toMatchObject({
      categoryId: 17028718,
      categoryName: 'Мужская одежда',
      typeId: 95913,
      typeName: 'Джинсы',
      selected: true,
    });
    expect(candidates[0]?.reasons).toContain('类目名称相似');
    expect(candidates[0]?.attributePlan.missingRequired).toEqual([]);
  });

  it('maps source standard attributes to Ozon category candidates and required gaps', () => {
    const plan = buildSourceStandardOzonAttributePlan({
      brand: { value: '', isBrandless: true },
      colors: ['черный'],
      sizes: ['M'],
      materials: ['хлопок'],
      gender: { value: 'female' },
      seasons: [],
      packageDimensionsMm: null,
      packageWeightG: null,
      categoryHints: [],
      missingForOzon: ['性别/季节'],
    }, [
      { id: 85, name: 'Бренд', is_required: true, dictionary_id: 100 },
      { id: 10096, name: 'Цвет', is_required: true, dictionary_id: 200 },
      { id: 4295, name: 'Российский размер', is_required: true },
      { id: 9001, name: 'Материал', is_required: true },
      { id: 9002, name: 'Пол', is_required: true, dictionary_id: 300 },
      { id: 9003, name: 'Сезон', is_required: true, dictionary_id: 400 },
      { id: 9999, name: 'Особенности', is_required: true },
    ], [
      { id: 9999, values: [{ value: 'manual' }] },
    ]);

    expect(plan.candidates).toEqual([
      { standardKey: 'brand', attributeId: 85, attributeName: 'Бренд', required: true, dictionaryId: 100, needsDictionaryResolution: true, values: ['Без бренда'] },
      { standardKey: 'colors', attributeId: 10096, attributeName: 'Цвет', required: true, dictionaryId: 200, needsDictionaryResolution: true, values: ['черный'] },
      { standardKey: 'sizes', attributeId: 4295, attributeName: 'Российский размер', required: true, dictionaryId: null, needsDictionaryResolution: false, values: ['M'] },
      { standardKey: 'materials', attributeId: 9001, attributeName: 'Материал', required: true, dictionaryId: null, needsDictionaryResolution: false, values: ['хлопок'] },
      { standardKey: 'gender', attributeId: 9002, attributeName: 'Пол', required: true, dictionaryId: 300, needsDictionaryResolution: true, values: ['Женский'] },
    ]);
    expect(plan.missingRequired).toEqual([
      { attributeId: 9003, attributeName: 'Сезон', standardKey: 'seasons', reason: 'no_source_standard_value' },
    ]);
  });

  it('prefers each collected item category over batch fallback category', () => {
    expect(resolveItemPublishCategory({
      metadata: { descriptionCategoryId: 17028706, typeId: 95913 },
    }, 17028922, 97111)).toEqual({
      categoryId: 17028706,
      typeId: 95913,
    });

    expect(resolveItemPublishCategory({
      metadata: {},
    }, 17028922, 97111)).toEqual({
      categoryId: 17028922,
      typeId: 97111,
    });
  });

  it('detects whether an item has its own complete publish category', () => {
    expect(hasOwnPublishCategory({
      metadata: { descriptionCategoryId: 17028706, typeId: 95913 },
    })).toBe(true);
    expect(hasOwnPublishCategory({
      metadata: { descriptionCategoryId: 17028706 },
    })).toBe(false);
    expect(hasOwnPublishCategory({
      metadata: {},
    })).toBe(false);
  });

  it('groups publish payload items by their own category and type', () => {
    const groups = groupPublishItemsByCategory([
      { offer_id: 'toy-brown', description_category_id: 17028706, type_id: 95913 },
      { offer_id: 'toy-pink', description_category_id: 17028706, type_id: 95913 },
      { offer_id: 'hair-band', description_category_id: 17028922, type_id: 97111 },
    ]);

    expect(groups.map((group) => ({
      categoryId: group.categoryId,
      typeId: group.typeId,
      offers: group.items.map((item: any) => item.offer_id),
    }))).toEqual([{
      categoryId: 17028706,
      typeId: 95913,
      offers: ['toy-brown', 'toy-pink'],
    }, {
      categoryId: 17028922,
      typeId: 97111,
      offers: ['hair-band'],
    }]);
  });

  it('prefers sku-based variant price overrides while keeping index fallback', () => {
    expect(getVariantOverridePrice({ '3378860669': '188.2', 0: 123 }, { sku: '3378860669' }, 0)).toBe(189);
    expect(getVariantOverridePrice({ 1: '77.1' }, { sku: 'missing' }, 1)).toBe(78);
    expect(getVariantOverridePrice({ missing: '0' }, { sku: 'missing' }, 0)).toBeNull();
  });

  it('uses manual variant prices as corrected base prices before markup', () => {
    expect(resolveVariantPublishPriceCny({
      itemOverrides: {},
      variant: { sku: '4073973986', price: '86.08' },
      index: 1,
      groupBasePriceCny: 13.05,
      markupPct: 0,
      markupAmount: 0,
      fxRate: 1,
    })).toBe(87);

    expect(resolveVariantPublishPriceCny({
      itemOverrides: { '4184643691': '30' },
      variant: { sku: '4184643691', price: '13.05' },
      index: 0,
      groupBasePriceCny: 13.05,
      markupPct: 100,
      markupAmount: 10,
      fxRate: 1,
    })).toBe(70);
  });

  it('fills missing Ozon variant cells and pack specs from collected variant links', () => {
    expect(enrichOzonVariantAttrsFromLink(
      { 'Цвет': 'желтый' },
      { link: '/product/qiwu-forma-dlya-lda-4-yach-1-sht-4038902924/?from_sku=2404317485' },
    )).toEqual({
      'Цвет': 'желтый',
      'Количество ячеек, шт': '4',
      'Количество в упаковке, шт': '1',
    });

    expect(enrichOzonVariantAttrsFromLink(
      { 'Цвет': 'желтый, красный', 'Количество в упаковке, шт': '2' },
      { link: '/product/qiwu-forma-dlya-lda-6-yach-2-sht-3978217968/?from_sku=2404317485' },
    )).toEqual({
      'Цвет': 'желтый, красный',
      'Количество ячеек, шт': '6',
      'Количество в упаковке, шт': '2',
    });
  });

  it('enriches stored Ozon variants before publish without changing sku count', () => {
    const variants = enrichOzonVariantSpecs([
      {
        sku: '4038902924',
        attrs: { 'Цвет': 'желтый' },
        link: '/product/qiwu-forma-dlya-lda-4-yach-1-sht-4038902924/?from_sku=2404317485',
      },
      {
        sku: '3939870178',
        attrs: { 'Количество ячеек, шт': '12' },
        link: '/product/qiwu-forma-dlya-lda-12-yach-1-sht-3939870178/?from_sku=2404317485',
      },
    ]);

    expect(variants).toHaveLength(2);
    expect(variants[0]!.attrs).toEqual({
      'Цвет': 'желтый',
      'Количество ячеек, шт': '4',
      'Количество в упаковке, шт': '1',
    });
    expect(variants[1]!.attrs).toEqual({
      'Количество ячеек, шт': '12',
      'Количество в упаковке, шт': '1',
    });
  });

  it('keeps variant cover images first when listing multi-variant items without applied watermarks', () => {
    const item = {
      images: ['https://cdn.example.com/parent-a.jpg', 'https://cdn.example.com/parent-b.jpg'],
      metadata: {
        watermarkedImages: ['https://cdn.example.com/custom-parent.jpg'],
      },
    };
    const baseImages = resolveBasePublishImages(item);

    expect(resolveVariantPublishImages(item, {
      images: ['https://cdn.example.com/variant-blue.jpg'],
    }, baseImages)).toEqual([
      'https://cdn.example.com/variant-blue.jpg',
      'https://cdn.example.com/custom-parent.jpg',
    ]);
  });

  it('keeps variant cover images first even after item-level watermarks are applied', () => {
    const item = {
      images: ['https://cdn.example.com/parent.jpg'],
      metadata: {
        watermarkApplied: true,
        watermarkedImages: ['/watermarked/item-1.jpg'],
      },
    };
    const baseImages = resolveBasePublishImages(item);

    expect(resolveVariantPublishImages(item, {
      images: ['https://cdn.example.com/variant.jpg'],
    }, baseImages)).toEqual([
      'https://cdn.example.com/variant.jpg',
      '/watermarked/item-1.jpg',
    ]);
  });

  it('uses variant-specific watermarked images as publish covers when available', () => {
    const item = {
      images: ['https://cdn.example.com/parent.jpg'],
      metadata: {
        watermarkApplied: true,
        watermarkedImages: ['/watermarked/parent.jpg'],
      },
    };
    const baseImages = resolveBasePublishImages(item);

    expect(resolveVariantPublishImages(item, {
      images: ['https://cdn.example.com/variant.jpg'],
      watermarkedImages: ['/watermarked/variant.jpg'],
    }, baseImages)).toEqual([
      '/watermarked/variant.jpg',
      '/watermarked/parent.jpg',
    ]);
  });

  it('stores watermarked image lists on the matching collected variants', () => {
    const variants = setVariantWatermarkedImages([
      { sku: 'blue', attrs: { Color: 'blue' }, images: ['https://cdn.example.com/blue.jpg'] },
      { sku: 'red', attrs: { Color: 'red' }, images: ['https://cdn.example.com/red.jpg'] },
      { sku: 'green', attrs: { Color: 'green' }, images: ['https://cdn.example.com/green.jpg'] },
    ], {
      blue: ['/watermarked/blue.jpg'],
      red: ['/watermarked/red.jpg', '/watermarked/red-detail.jpg'],
    });

    expect(variants).toEqual([
      {
        sku: 'blue',
        attrs: { Color: 'blue' },
        images: ['https://cdn.example.com/blue.jpg'],
        watermarkedImages: ['/watermarked/blue.jpg'],
        watermarkApplied: true,
      },
      {
        sku: 'red',
        attrs: { Color: 'red' },
        images: ['https://cdn.example.com/red.jpg'],
        watermarkedImages: ['/watermarked/red.jpg', '/watermarked/red-detail.jpg'],
        watermarkApplied: true,
      },
      { sku: 'green', attrs: { Color: 'green' }, images: ['https://cdn.example.com/green.jpg'] },
    ]);
  });

  it('keeps the robot cleaner color variant images distinct through publish selection', () => {
    const item = {
      images: ['https://ir.ozone.ru/s3/multimedia-1-i/10240533378.jpg'],
      metadata: {
        watermarkApplied: true,
        watermarkedImages: ['/watermarked/cmq9luvfn004h5obkwe0ogi5c_0_e81563ca.jpg'],
      },
    };
    const variants = [
      {
        sku: '3399297127',
        attrs: { 'Цвет': 'светло-розовый' },
        images: ['https://ir.ozone.ru/s3/multimedia-1-i/wc140/10240533378.jpg'],
      },
      {
        sku: '3440462580',
        attrs: { 'Цвет': 'черный матовый' },
        images: ['https://ir.ozone.ru/s3/multimedia-1-k/wc140/9357818888.jpg'],
      },
    ];
    const baseImages = resolveBasePublishImages(item);
    const selectedImages = variants.map((variant) => resolveVariantPublishImages(item, variant, baseImages));

    expect(selectedImages.map((images) => images[0])).toEqual([
      'https://ir.ozone.ru/s3/multimedia-1-i/10240533378.jpg',
      'https://ir.ozone.ru/s3/multimedia-1-k/9357818888.jpg',
    ]);
    expect(new Set(selectedImages.map((images) => images[0])).size).toBe(2);
    expect(selectedImages.every((images) => images[1] === '/watermarked/cmq9luvfn004h5obkwe0ogi5c_0_e81563ca.jpg')).toBe(true);
  });

  it('limits Ozon publish images to 30 while keeping the variant image first', () => {
    const baseImages = Array.from({ length: 30 }, (_, index) => `https://cdn.example.com/base-${index + 1}.jpg`);
    const images = resolveVariantPublishImages({
      images: baseImages,
      metadata: {},
    }, {
      images: ['https://cdn.example.com/variant-cover.jpg'],
    }, baseImages);

    expect(images).toHaveLength(30);
    expect(images[0]).toBe('https://cdn.example.com/variant-cover.jpg');
    expect(images).toContain('https://cdn.example.com/base-1.jpg');
    expect(images).not.toContain('https://cdn.example.com/base-30.jpg');
  });

  it('records fallback upload images by offer id while keeping the first image for job previews', () => {
    const offerImageLists: Record<string, string[]> = {};
    const offerImages: Record<string, string> = {};

    recordOfferPublishImages(offerImageLists, offerImages, 'offer-blue', [
      'https://cdn.example.com/variant-blue.jpg',
      'https://cdn.example.com/parent.jpg',
    ]);
    recordOfferPublishImages(offerImageLists, offerImages, 'offer-red', [
      'https://cdn.example.com/variant-red.jpg',
      'https://cdn.example.com/parent.jpg',
    ]);

    expect(offerImageLists).toEqual({
      'offer-blue': ['https://cdn.example.com/variant-blue.jpg', 'https://cdn.example.com/parent.jpg'],
      'offer-red': ['https://cdn.example.com/variant-red.jpg', 'https://cdn.example.com/parent.jpg'],
    });
    expect(offerImages).toEqual({
      'offer-blue': 'https://cdn.example.com/variant-blue.jpg',
      'offer-red': 'https://cdn.example.com/variant-red.jpg',
    });
  });

  it('plans clone picture repair from stored offer image lists when product ids are available', () => {
    const plan = planFallbackPictureUploads({
      source: 'collect-publish',
      mode: 'clone',
      offerImageLists: {
        '1781155551-6DH6': [
          'https://cdn.example.com/xreal-white-cover.jpg',
          'https://cdn.example.com/xreal-common.jpg',
        ],
      },
    }, [
      {
        offer_id: '1781155551-6DH6',
        product_id: 5100617465,
        status: 'imported',
      },
    ], []);

    expect(plan.operations).toEqual([{
      offerId: '1781155551-6DH6',
      productId: 5100617465,
      rawImages: [
        'https://cdn.example.com/xreal-white-cover.jpg',
        'https://cdn.example.com/xreal-common.jpg',
      ],
    }]);
    expect(plan.pendingCount).toBe(0);
  });

  it('limits stored fallback picture repair lists to 30 images', () => {
    const images = Array.from({ length: 31 }, (_, index) => `https://cdn.example.com/stored-${index + 1}.jpg`);
    const plan = planFallbackPictureUploads({
      offerImageLists: {
        'offer-31': images,
      },
    }, [
      {
        offer_id: 'offer-31',
        product_id: 123456,
        status: 'imported',
      },
    ], []);

    expect(plan.operations[0]?.rawImages).toHaveLength(30);
    expect(plan.operations[0]?.rawImages[0]).toBe('https://cdn.example.com/stored-1.jpg');
    expect(plan.operations[0]?.rawImages).not.toContain('https://cdn.example.com/stored-31.jpg');
  });

  it('records picture upload diagnostics without leaking the whole image list', () => {
    const diagnostics: any[] = [];

    recordPictureUploadDiagnostic(diagnostics, {
      offerId: 'offer-blue',
      productId: 123,
      status: 'uploaded',
      rawImages: ['/watermarked/blue.jpg', '/watermarked/blue-detail.jpg'],
      resolvedImages: ['https://assets.example.com/blue.jpg', 'https://assets.example.com/blue-detail.jpg'],
    });
    recordPictureUploadDiagnostic(diagnostics, {
      offerId: 'offer-red',
      productId: 124,
      status: 'failed',
      rawImages: ['/watermarked/red.jpg'],
      error: new Error('图片已上传但公网暂不可读，OZON 可能下载失败'),
    });

    expect(diagnostics).toEqual([
      {
        offerId: 'offer-blue',
        productId: 123,
        status: 'uploaded',
        imageCount: 2,
        resolvedCount: 2,
        firstImage: '/watermarked/blue.jpg',
      },
      {
        offerId: 'offer-red',
        productId: 124,
        status: 'failed',
        imageCount: 1,
        resolvedCount: 0,
        firstImage: '/watermarked/red.jpg',
        message: '图片已上传但公网暂不可读，OZON 可能下载失败',
      },
    ]);
  });

  it('plans delayed fallback picture uploads from stored variant trace when product ids appear later', () => {
    const plan = planFallbackPictureUploads({
      source: 'collect-publish-fallback',
      variantTrace: [
        {
          offerId: '4045686426-4PLI',
          sourceItemId: 'source-airpods-case',
          sourceVariantSku: '4045686426',
        },
      ],
      pictureUploads: null,
    }, [
      {
        offer_id: '4045686426-4PLI',
        product_id: 5069515076,
        status: 'imported',
      },
    ], [
      {
        id: 'source-airpods-case',
        images: ['https://ir.ozone.ru/s3/multimedia-1-8/wc140/9978274340.jpg'],
        variants: [
          {
            sku: '4045686426',
            images: ['https://ir.ozone.ru/s3/multimedia-1-e/wc140/9976738478.jpg'],
          },
        ],
      },
    ]);

    expect(plan.operations).toEqual([
      {
        offerId: '4045686426-4PLI',
        productId: 5069515076,
        rawImages: [
          'https://ir.ozone.ru/s3/multimedia-1-e/9976738478.jpg',
          'https://ir.ozone.ru/s3/multimedia-1-8/9978274340.jpg',
        ],
      },
    ]);
    expect(plan.pendingCount).toBe(0);
    expect(plan.skipped).toEqual([]);
  });

  it('detects fallback recreate conflicts before resubmitting the same source sku to Ozon', () => {
    const conflicts = findFallbackRecreateConflicts([
      {
        id: 'source-airpods-case',
        sku: '4045687993',
        status: 'listed',
        variants: [{ sku: '4045686426' }],
      },
      {
        id: 'source-earbud-case',
        sku: '3399297127',
        status: 'active',
        variants: [{ sku: '3440462580' }],
      },
    ], [
      {
        id: 'old-job',
        status: 'SUCCESS',
        payload: {
          taskId: 4797195807,
          mode: 'follow-by-sku',
          sourceSkus: ['3399297127'],
        },
      },
      {
        id: 'failed-job',
        status: 'FAILED',
        payload: {
          taskId: 4797718192,
          mode: 'follow-by-sku',
          sourceSkus: ['4045687993'],
        },
      },
    ]);

    expect(conflicts).toEqual([
      {
        itemId: 'source-airpods-case',
        sku: '4045687993',
        reason: 'listed',
      },
      {
        itemId: 'source-earbud-case',
        sku: '3399297127',
        reason: 'existing_job',
        jobId: 'old-job',
        taskId: 4797195807,
      },
    ]);
  });

  it('blocks duplicate fallback submits while the first submit is still creating products', () => {
    const conflicts = findFallbackRecreateConflicts([
      {
        id: 'source-fan',
        sku: '4403275408',
        status: 'listing_pending',
        variants: [{ sku: '4403257754' }],
      },
      {
        id: 'source-speaker',
        sku: '3399297127',
        status: 'collected',
        variants: [{ sku: '3440462580' }],
      },
    ], [
      {
        id: 'pending-job',
        status: 'RUNNING',
        payload: {
          source: 'collect-publish-fallback',
          mode: 'follow-by-sku',
          sourceItemIds: ['source-speaker'],
          sourceSkus: ['3399297127'],
        },
      },
    ]);

    expect(conflicts).toEqual([
      {
        itemId: 'source-fan',
        sku: '4403275408',
        reason: 'listed',
      },
      {
        itemId: 'source-speaker',
        sku: '3399297127',
        reason: 'existing_job',
        jobId: 'pending-job',
      },
    ]);
  });

  it('does not plan fallback picture uploads for offers that were already uploaded', () => {
    const plan = planFallbackPictureUploads({
      source: 'collect-publish-fallback',
      offerImageLists: {
        'offer-done': ['https://cdn.example.com/done.jpg'],
      },
      pictureUploads: [
        { offerId: 'offer-done', status: 'uploaded' },
      ],
    }, [
      {
        offer_id: 'offer-done',
        product_id: 1001,
        status: 'imported',
      },
    ], []);

    expect(plan.operations).toEqual([]);
    expect(plan.pendingCount).toBe(0);
  });

  it('skips fallback picture uploads for offers blocked by Ozon card validation errors', () => {
    const plan = planFallbackPictureUploads({
      source: 'collect-publish-fallback',
      offerImageLists: {
        'offer-blocked': ['https://cdn.example.com/blocked.jpg'],
      },
    }, [
      {
        offer_id: 'offer-blocked',
        product_id: 1002,
        status: 'imported',
        errors: [
          {
            level: 'error',
            state: 'declined',
            code: 'FB_ORIGINAL',
            attribute_name: 'Название',
            description: 'В карточке товара есть указание на то, что продаётся оригинал товара',
          },
        ],
      },
    ], []);

    expect(plan.operations).toEqual([]);
    expect(plan.pendingCount).toBe(0);
    expect(plan.skipped).toEqual([
      expect.objectContaining({
        offerId: 'offer-blocked',
        productId: 1002,
        message: expect.stringContaining('оригинал'),
      }),
    ]);
  });

  it('removes multiple collected variants by sku and reports missing skus', () => {
    const result = removeVariantsBySkus([
      { sku: 'blue', attrs: { Color: 'blue' } },
      { sku: 'red', attrs: { Color: 'red' } },
      { sku: 'green', attrs: { Color: 'green' } },
      { attrs: { Color: 'no sku' } },
    ], ['red', 'blue', 'missing', 'red']);

    expect(result.removed).toBe(2);
    expect(result.missingSkus).toEqual(['missing']);
    expect(result.variants).toEqual([
      { sku: 'green', attrs: { Color: 'green' } },
      { attrs: { Color: 'no sku' } },
    ]);
  });

  it('uses custom publish offer ids before randomization', () => {
    expect(resolvePublishOfferId({
      sourceSku: '3399297127',
      fallback: 'import-item-1',
      customOfferId: 'my-custom-offer',
      randomizeEnabled: true,
      randomOfferIdEnabled: true,
      userRandomOfferId: true,
      suffixFactory: () => 'rand01',
    })).toBe('my-custom-offer');
  });

  it('does not force offer ids into Ozon color-family attributes for variant grouping', () => {
    const attrs = syncOzonVariantGroupingAttributes([
      {
        id: 10097,
        complex_id: 0,
        values: [{ value: 'белый', dictionary_value_id: 61571 }],
      },
      {
        id: 4180,
        complex_id: 0,
        values: [{ value: 'Миостимулятор' }],
      },
    ], {
      offer_id: '3639452223-ZWJS',
      _sourceModelId: '3639452223',
      _sourceItemId: 'item-1',
    });

    expect(attrs).toContainEqual({
      id: 8292,
      complex_id: 0,
      values: [{ value: '3639452223', dictionary_value_id: 0 }],
    });
    expect(attrs).toContainEqual({
      id: 10097,
      complex_id: 0,
      values: [{ value: 'белый', dictionary_value_id: 61571 }],
    });
    expect(attrs).not.toContainEqual({
      id: 10097,
      complex_id: 0,
      values: [{ value: '3639452223-ZWJS', dictionary_value_id: 0 }],
    });
  });

  it('keeps offer ids unique when user disables random offer ids', () => {
    expect(resolvePublishOfferId({
      sourceSku: '3399297127',
      fallback: 'import-item-1',
      randomizeEnabled: true,
      randomOfferIdEnabled: true,
      userRandomOfferId: false,
      suffixFactory: () => 'safe',
    })).toBe('3399297127-safe');
  });
});
