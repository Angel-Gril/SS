import { describe, expect, it } from 'vitest';
import {
  calcPublishPrice,
  containsCjkText,
  getVariantOverridePrice,
  recordOfferPublishImages,
  resolveBasePublishImages,
  resolvePublishName,
  resolveVariantPublishImages,
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

  it('uses Russian publish title from metadata before display title', () => {
    const name = resolvePublishName({
      title: '中文商品名',
      metadata: { publishTitleRu: 'Чехол для iPad' },
    }, { Цвет: 'серый' });
    expect(name).toBe('Чехол для iPad серый');
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
    const sourceVariantCovers = variants.map((variant) => variant.images[0]);
    const selectedImages = variants.map((variant) => resolveVariantPublishImages(item, variant, baseImages));

    expect(new Set(sourceVariantCovers).size).toBe(2);
    expect(selectedImages.map((images) => images[0])).toEqual(sourceVariantCovers);
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
});
