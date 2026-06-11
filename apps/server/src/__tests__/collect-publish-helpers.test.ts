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

  it('uses item-level watermarked images for variants after watermarks are actually applied', () => {
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
    }, baseImages)).toEqual(['/watermarked/item-1.jpg']);
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
