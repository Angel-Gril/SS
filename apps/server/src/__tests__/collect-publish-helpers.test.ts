import { describe, expect, it } from 'vitest';
import {
  calcPublishPrice,
  containsCjkText,
  enrichOzonVariantAttrsFromLink,
  enrichOzonVariantSpecs,
  getVariantOverridePrice,
  findFallbackRecreateConflicts,
  groupPublishItemsByCategory,
  hasOwnPublishCategory,
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
  resolveVariantPublishImages,
  setVariantWatermarkedImages,
  syncOzonCoreTextAttributes,
  syncOzonTitleAttribute,
  sanitizePublishDescription,
} from '../routes/collect.js';

describe('collect publish helpers', () => {
  it('calculates publish price with percentage markup and fixed amount', () => {
    expect(calcPublishPrice(50.16, 200, 10)).toBe(161);
    expect(calcPublishPrice(100, 0, 9.5)).toBe(110);
  });

  it('detects Chinese text in publish names', () => {
    expect(containsCjkText('Чехол для iPad')).toBe(false);
    expect(containsCjkText('保护套 для iPad')).toBe(true);
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

  it('turns repeated keyword spam titles into short publish names with variant color', () => {
    const name = resolvePublishName({
      title: 'Автовизитка, автовизитка в машину, номер телефона в автомобиль,Ретро-парковочная плата для автомобиля',
      metadata: {},
    }, { Цвет: 'коричнево-красный' });

    expect(name).toBe('Автовизитка для автомобиля коричнево-красный цвет');
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
