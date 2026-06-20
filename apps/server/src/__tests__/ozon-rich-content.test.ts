import { describe, expect, it } from 'vitest';
import {
  appendOzonRichContentAttribute,
  buildOzonRichContentAttribute,
  buildOzonVideoMediaAttributesFromSourceVideos,
  OZON_VIDEO_PUBLISH_UNSUPPORTED_REASON,
  parseCollectedRichContent,
  planCollectedVideoPublish,
} from '../services/ozon-rich-content.js';

describe('Ozon rich content publishing', () => {
  it('extracts text and image blocks from collected Ozon rich JSON', () => {
    const parsed = parseCollectedRichContent(JSON.stringify({
      content: [{
        blocks: [
          { text: { content: 'Описание со второй страницы' } },
          { img: { src: 'https://cdn.example.com/rich-image.jpg' } },
          { title: { textRs: [{ content: 'Материал рафия' }] } },
        ],
      }],
    }));

    expect(parsed.blocks).toEqual([
      { type: 'text', text: 'Описание со второй страницы' },
      { type: 'image', url: 'https://cdn.example.com/rich-image.jpg' },
      { type: 'text', text: 'Материал рафия' },
    ]);
  });

  it('builds a generated 22336 attribute after rewriting rich images', async () => {
    const attr = await buildOzonRichContentAttribute(JSON.stringify({
      blocks: [
        { title: 'Описание', content: [{ text: 'Коллекционная фигурка' }] },
        { imageUrl: 'https://cdn.example.com/source.jpg' },
      ],
    }), {
      imageMapper: async (url) => `https://erp.example.com/rich/${url.split('/').pop()}`,
    });

    expect(attr?.id).toBe(22336);
    expect(attr?.complex_id).toBe(0);
    expect(attr?.values).toHaveLength(1);

    const richJson = JSON.parse(attr!.values[0]!.value);
    expect(richJson).toMatchObject({
      version: 0.3,
      content: [{
        widgetName: 'raShowcase',
        type: 'billboard',
        blocks: [{
          img: {
            src: 'https://erp.example.com/rich/source.jpg',
            srcMobile: 'https://erp.example.com/rich/source.jpg',
          },
          text: {
            content: ['Описание', 'Коллекционная фигурка'],
          },
        }],
      }],
    });
    expect(attr?.values[0]?.dictionary_value_id).toBe(0);
  });

  it('builds a generated 11254 rich content attribute when the category exposes the legacy rich field', async () => {
    const attr = await buildOzonRichContentAttribute(JSON.stringify({
      blocks: [
        { imageUrl: 'https://cdn.example.com/source.jpg' },
        { text: 'Описание с изображением' },
      ],
    }), {
      attributeId: 11254,
      imageMapper: async (url) => `https://erp.example.com/rich/${url.split('/').pop()}`,
    });

    expect(attr?.id).toBe(11254);
    const richJson = JSON.parse(attr!.values[0]!.value);
    expect(richJson).toMatchObject({
      version: 0.3,
      content: [{
        widgetName: 'raShowcase',
        type: 'billboard',
        blocks: [{
          img: {
            src: 'https://erp.example.com/rich/source.jpg',
            srcMobile: 'https://erp.example.com/rich/source.jpg',
          },
          text: {
            content: ['Описание с изображением'],
          },
        }],
      }],
    });
  });

  it('preserves collected Ozon rich content templates while rewriting nested images', async () => {
    const attr = await buildOzonRichContentAttribute(JSON.stringify({
      version: 0.3,
      content: [{
        widgetName: 'raShowcase',
        type: 'billboard',
        blocks: [{
          img: {
            src: 'https://ir.ozone.ru/source-desktop.jpg',
            srcMobile: 'https://ir.ozone.ru/source-mobile.jpg',
            position: 'width_full',
            positionMobile: 'width_full',
          },
          imgLink: '',
          text: {
            align: 'left',
            color: 'color1',
            content: ['Описание:', 'Оригинальный текст', 'Материал: полиэстер'],
            size: 'size2',
          },
        }],
      }],
    }), {
      attributeId: 11254,
      imageMapper: async (url) => `https://erp.example.com/rich/${url.split('/').pop()}`,
    });

    const richJson = JSON.parse(attr!.values[0]!.value);
    expect(richJson.version).toBe(0.3);
    expect(richJson.content[0]).toMatchObject({
      widgetName: 'raShowcase',
      type: 'billboard',
      blocks: [{
        img: {
          src: 'https://erp.example.com/rich/source-desktop.jpg',
          srcMobile: 'https://erp.example.com/rich/source-mobile.jpg',
          position: 'width_full',
          positionMobile: 'width_full',
        },
        imgLink: '',
        text: {
          align: 'left',
          color: 'color1',
          content: ['Описание:', 'текст', 'Материал: полиэстер'],
          size: 'size2',
        },
      }],
    });
  });

  it('returns null when collected rich JSON has no supported content', async () => {
    await expect(buildOzonRichContentAttribute(JSON.stringify({ content: [] }))).resolves.toBeNull();
    expect(parseCollectedRichContent('{bad json')).toEqual({ blocks: [] });
  });

  it('replaces existing rich content attributes with the generated safe one', () => {
    const generated = {
      id: 22336,
      complex_id: 0,
      values: [{ value: '{"content":[]}', dictionary_value_id: 0 }],
    };

    expect(appendOzonRichContentAttribute([
      { id: 4180, complex_id: 0, values: [{ value: 'Название' }] },
      { id: 22336, complex_id: 0, values: [{ value: '{"old":true}' }] },
    ], generated)).toEqual([
      { id: 4180, complex_id: 0, values: [{ value: 'Название' }] },
      generated,
    ]);
  });

  it('replaces both modern and legacy rich content attributes with one generated attribute', () => {
    const generated = {
      id: 11254,
      complex_id: 0,
      values: [{ value: '{"content":[{"widgetName":"raText"}]}', dictionary_value_id: 0 }],
    };

    expect(appendOzonRichContentAttribute([
      { id: 22336, complex_id: 0, values: [{ value: '{"old":true}' }] },
      { id: 11254, complex_id: 0, values: [{ value: '{"oldLegacy":true}' }] },
      { id: 4180, complex_id: 0, values: [{ value: 'Название' }] },
    ], generated)).toEqual([
      { id: 4180, complex_id: 0, values: [{ value: 'Название' }] },
      generated,
    ]);
  });

  it('keeps collected videos in diagnostics without creating unsupported Seller API requests', () => {
    const plan = planCollectedVideoPublish([
      { url: 'https://cdn.example.com/video.mp4', coverUrl: 'https://cdn.example.com/cover.jpg', title: 'Обзор' },
    ], 'offer-1');

    expect(plan).toEqual({
      offerId: 'offer-1',
      status: 'manual_required',
      reason: OZON_VIDEO_PUBLISH_UNSUPPORTED_REASON,
      message: expect.stringContaining('VK Video'),
      sourceVideos: [
        { url: 'https://cdn.example.com/video.mp4', coverUrl: 'https://cdn.example.com/cover.jpg', title: 'Обзор' },
      ],
    });
  });

  it('builds Ozon video media attributes from collected Ozon CDN videos', () => {
    const attrs = buildOzonVideoMediaAttributesFromSourceVideos([
      {
        url: 'https://cdnvideo.v.ozone.ru/vod/video-64/01KF0S7TY54CCQ9SZCCMQAM1RS/asset_0_h264.mp4?type=pdp',
        coverUrl: 'https://ir.ozone.ru/s3/video-64/01KF0S7TY54CCQ9SZCCMQAM1RS/cover/cover.jpg',
      },
      {
        url: 'https://cdnvideo.v.ozone.ru/vod/video-63/01KF0PT40YRX4EXA18X4JW8ZYE/asset_3_h264.mp4?type=pdp',
        coverUrl: 'https://ir.ozone.ru/s3/video-63/01KF0PT40YRX4EXA18X4JW8ZYE/cover/cover.jpg',
      },
    ]);

    expect(attrs).toEqual([
      { id: 21842, complex_id: 100002, values: [{ value: 'https://ir.ozone.ru/s3/video-64/01KF0S7TY54CCQ9SZCCMQAM1RS/cover/cover.jpg' }] },
      { id: 21843, complex_id: 100002, values: [{ value: 'https://cdnvideo.v.ozone.ru/vod/video-64/01KF0S7TY54CCQ9SZCCMQAM1RS/asset_0_h264.mp4' }] },
      { id: 21844, complex_id: 100002, values: [{ value: '01KF0S7TY54CCQ9SZCCMQAM1RS' }] },
      { id: 21845, complex_id: 100002, values: [{ value: 'https://cdnvideo.v.ozone.ru/vod/video-64/01KF0S7TY54CCQ9SZCCMQAM1RS/asset_0_h264.mp4' }] },
      { id: 21846, complex_id: 100002, values: [{ value: 'https://cdnvideo.v.ozone.ru/vod/video-64/01KF0S7TY54CCQ9SZCCMQAM1RS/master.m3u8' }] },
      { id: 22964, complex_id: 100002, values: [{ value: 'true' }] },
      { id: 23256, complex_id: 100002, values: [{ value: '0.75' }] },
      { id: 21837, complex_id: 100001, values: [{ value: 'asset_3_h264.mp4' }] },
      { id: 21838, complex_id: 100001, values: [{ value: 'https://ir.ozone.ru/s3/video-63/01KF0PT40YRX4EXA18X4JW8ZYE/cover/cover.jpg' }] },
      { id: 21839, complex_id: 100001, values: [{ value: 'https://cdnvideo.v.ozone.ru/vod/video-63/01KF0PT40YRX4EXA18X4JW8ZYE/master.m3u8' }] },
      { id: 21840, complex_id: 100001, values: [{ value: '01KF0PT40YRX4EXA18X4JW8ZYE' }] },
      { id: 21841, complex_id: 100001, values: [{ value: 'https://cdnvideo.v.ozone.ru/vod/video-63/01KF0PT40YRX4EXA18X4JW8ZYE/asset_3_h264.mp4' }] },
      { id: 23255, complex_id: 100001, values: [{ value: '1.78' }] },
    ]);
  });

  it('does not build Ozon video media attributes from generic external videos', () => {
    expect(buildOzonVideoMediaAttributesFromSourceVideos([
      { url: 'https://cdn.example.com/video.mp4', coverUrl: 'https://cdn.example.com/cover.jpg' },
    ])).toEqual([]);
  });
});
