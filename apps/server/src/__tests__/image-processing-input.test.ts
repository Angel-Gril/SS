import { describe, expect, it } from 'vitest';
import {
  IMAGE_PROCESSING_MAX_BATCH_SIZE,
  parseBatchResizeInput,
  parseCollectWatermarkInput,
  parseWatermarkConfig,
  parseWatermarkBatchInput,
} from '../services/image-processing-input.js';

describe('image processing input bounds', () => {
  it('accepts a bounded resize request and normalizes duplicate URLs', () => {
    expect(parseBatchResizeInput({
      urls: ['https://img.example/a.jpg', 'https://img.example/a.jpg'],
      width: 1200,
      quality: 90,
      uploadToCdn: true,
    })).toEqual({
      urls: ['https://img.example/a.jpg'],
      width: 1200,
      height: undefined,
      quality: 90,
      uploadToCdn: true,
    });
  });

  it('rejects excessive batches, dimensions, quality and non-http URLs', () => {
    const tooMany = Array.from(
      { length: IMAGE_PROCESSING_MAX_BATCH_SIZE + 1 },
      (_, index) => `https://img.example/${index}.jpg`,
    );

    expect(() => parseBatchResizeInput({ urls: tooMany, width: 100 })).toThrow();
    expect(() => parseBatchResizeInput({ urls: ['https://img.example/a.jpg'], width: 5000 })).toThrow();
    expect(() => parseBatchResizeInput({ urls: ['https://img.example/a.jpg'], width: 100, quality: 0 })).toThrow();
    expect(() => parseBatchResizeInput({ urls: ['file:///etc/passwd'], width: 100 })).toThrow();
  });

  it('bounds watermark batches and configuration fields', () => {
    expect(() => parseWatermarkBatchInput({
      sourceUrls: Array.from(
        { length: IMAGE_PROCESSING_MAX_BATCH_SIZE + 1 },
        (_, index) => `https://img.example/${index}.jpg`,
      ),
      itemId: 'item-1',
      config: { type: 'text', text: 'shop', position: 'center', opacity: 50 },
    })).toThrow();
    expect(() => parseWatermarkBatchInput({
      sourceUrls: ['https://img.example/a.jpg'],
      itemId: 'item-1',
      config: { type: 'text', text: 'x'.repeat(501), position: 'center', opacity: 50 },
    })).toThrow();
  });

  it('normalizes the legacy flat collect watermark request through the same config owner', () => {
    expect(parseCollectWatermarkInput({
      ids: ['item-1', 'item-1', 'item-2'],
      type: 'text',
      text: 'shop',
      position: 'bottom-right',
      opacity: 50,
    })).toMatchObject({
      ids: ['item-1', 'item-2'],
      config: { type: 'text', text: 'shop', position: 'bottom-right', opacity: 50 },
    });
    expect(parseCollectWatermarkInput({ ids: ['item-1'], type: 'text' }).config.text).toBe('SS ERP');
    expect(() => parseWatermarkConfig({
      type: 'text',
      position: 'center',
      opacity: 50,
      unexpectedOwnerField: true,
    })).toThrow();
  });
});
