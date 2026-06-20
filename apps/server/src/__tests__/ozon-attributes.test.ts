import { describe, expect, it } from 'vitest';
import { convertOzonRawAttrs, isOzonVideoMediaAttributeId } from '../services/ozon-attributes.js';

describe('Ozon attribute conversion', () => {
  it('drops cloned video cover and rich media attributes before publishing', () => {
    const attrs = convertOzonRawAttrs([
      {
        attribute_id: '4180',
        complex_id: '0',
        values: [{ value: 'Название товара', dictionary_value_id: '0' }],
      },
      {
        attribute_id: '987654',
        attribute_name: 'Видеообложка: ссылка',
        complex_id: '0',
        values: [{ value: 'https://cdn.example.com/source-video-cover.mp4', dictionary_value_id: '0' }],
      },
      {
        attribute_id: '22336',
        name: 'Rich-контент',
        complex_id: '0',
        values: [{ value: '{"content":[]}', dictionary_value_id: '0' }],
      },
    ], true);

    expect(attrs).toEqual([
      {
        id: 4180,
        complex_id: 0,
        values: [{ value: 'Название товара' }],
      },
    ]);
  });

  it('keeps official Ozon video media attributes for normal product import', () => {
    const attrs = convertOzonRawAttrs([
      {
        attribute_id: '4180',
        complex_id: '0',
        values: [{ value: 'Название товара', dictionary_value_id: '0' }],
      },
      {
        attribute_id: '21842',
        complex_id: '0',
        values: [{ value: 'https://ir.ozone.ru/s3/video-64/demo/cover/cover.jpg', dictionary_value_id: '0' }],
      },
      {
        attribute_id: '21846',
        complex_id: '0',
        values: [{ value: 'https://cdnvideo.v.ozone.ru/vod/video-64/demo/master.m3u8', dictionary_value_id: '0' }],
      },
    ], true);

    expect(attrs).toEqual([
      {
        id: 4180,
        complex_id: 0,
        values: [{ value: 'Название товара' }],
      },
      {
        id: 21842,
        complex_id: 0,
        values: [{ value: 'https://ir.ozone.ru/s3/video-64/demo/cover/cover.jpg' }],
      },
      {
        id: 21846,
        complex_id: 0,
        values: [{ value: 'https://cdnvideo.v.ozone.ru/vod/video-64/demo/master.m3u8' }],
      },
    ]);
  });

  it('keeps the full official Ozon video media attribute group', () => {
    const attrs = convertOzonRawAttrs([
      {
        attribute_id: '21837',
        complex_id: '100001',
        values: [{ value: 'demo.mp4', dictionary_value_id: '0' }],
      },
      {
        attribute_id: '21838',
        complex_id: '100001',
        values: [{ value: 'https://ir.ozone.ru/s3/video-63/demo/cover/cover.jpg', dictionary_value_id: '0' }],
      },
      {
        attribute_id: '21839',
        complex_id: '100001',
        values: [{ value: 'https://cdnvideo.v.ozone.ru/vod/video-63/demo/master.m3u8', dictionary_value_id: '0' }],
      },
      {
        attribute_id: '21840',
        complex_id: '100001',
        values: [{ value: '01KF0PT40YRX4EXA18X4JW8ZYE', dictionary_value_id: '0' }],
      },
      {
        attribute_id: '21841',
        complex_id: '100001',
        values: [{ value: 'https://cdnvideo.v.ozone.ru/vod/video-63/demo/asset_3_h264.mp4', dictionary_value_id: '0' }],
      },
      {
        attribute_id: '22964',
        complex_id: '100001',
        values: [{ value: 'true', dictionary_value_id: '0' }],
      },
      {
        attribute_id: '23255',
        complex_id: '100001',
        values: [{ value: '1.78', dictionary_value_id: '0' }],
      },
    ], true);

    expect(attrs.map((attr) => attr.id)).toEqual([
      21837,
      21838,
      21839,
      21840,
      21841,
      22964,
      23255,
    ]);
  });

  it('drops unknown cloned attributes whose values are Ozon video media links', () => {
    const attrs = convertOzonRawAttrs([
      {
        attribute_id: '4180',
        complex_id: '0',
        values: [{ value: 'Название товара', dictionary_value_id: '0' }],
      },
      {
        attribute_id: '999001',
        complex_id: '0',
        values: [{ value: 'https://cdnvideo.v.ozone.ru/vod/video-63/demo/asset_0_h264.mp4', dictionary_value_id: '0' }],
      },
      {
        attribute_id: '999002',
        complex_id: '0',
        values: [{ value: 'https://ir.ozone.ru/s3/video-63/demo/cover/cover.jpg', dictionary_value_id: '0' }],
      },
    ], true);

    expect(attrs).toEqual([
      {
        id: 4180,
        complex_id: 0,
        values: [{ value: 'Название товара' }],
      },
    ]);
  });

  it('identifies official Ozon video media attribute ids', () => {
    expect(isOzonVideoMediaAttributeId(21837)).toBe(true);
    expect(isOzonVideoMediaAttributeId(21845)).toBe(true);
    expect(isOzonVideoMediaAttributeId(22964)).toBe(true);
    expect(isOzonVideoMediaAttributeId(23255)).toBe(true);
    expect(isOzonVideoMediaAttributeId(23256)).toBe(true);
    expect(isOzonVideoMediaAttributeId('21846')).toBe(true);
    expect(isOzonVideoMediaAttributeId(999001)).toBe(false);
  });
});
