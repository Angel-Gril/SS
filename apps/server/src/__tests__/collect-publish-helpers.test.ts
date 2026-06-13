import { describe, expect, it } from 'vitest';
import {
  calcPublishPrice,
  containsCjkText,
  getVariantOverridePrice,
  groupPublishItemsByCategory,
  hasOwnPublishCategory,
  hasSuspiciousPublishName,
  recordPictureUploadDiagnostic,
  recordOfferPublishImages,
  removeVariantsBySkus,
  resolveBasePublishImages,
  resolveItemPublishCategory,
  resolvePublishOfferId,
  resolvePublishName,
  resolveVariantPublishImages,
  setVariantWatermarkedImages,
  syncOzonTitleAttribute,
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

  it('turns repeated keyword spam titles into short publish names with variant color', () => {
    const name = resolvePublishName({
      title: 'Автовизитка, автовизитка в машину, номер телефона в автомобиль,Ретро-парковочная плата для автомобиля',
      metadata: {},
    }, { Цвет: 'коричнево-красный' });

    expect(name).toBe('Автовизитка для автомобиля коричнево-красный цвет');
    expect(hasSuspiciousPublishName(name)).toBe(false);
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
