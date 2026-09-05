import { describe, expect, it, vi } from 'vitest';

const uploadBuffer = vi.fn();
vi.mock('../services/image-storage.js', () => ({
  getStorageBackend: vi.fn(async () => ({ uploadBuffer })),
}));
vi.mock('../services/ozon-image-resolver.js', () => ({
  normalizeOzonPublishImageUrl: (value: string) => value,
  waitForOzonImageReady: vi.fn(async () => undefined),
}));
import {
  appendOzonRichContentAttribute,
  buildOzonSizeChartAttribute,
  buildOzonRichContentAttribute,
  buildOzonVideoMediaAttributesFromSourceVideos,
  OZON_VIDEO_PUBLISH_UNSUPPORTED_REASON,
  parseCollectedRichContent,
  planCollectedVideoPublish,
  renderSizeChartSvg,
  resolveOzonSizeChartAttributeDef,
  transferRichContentImage,
} from '../services/ozon-rich-content.js';

describe('Ozon rich content publishing', () => {
  it('rejects a redirect to a private address before uploading rich content bytes', async () => {
    uploadBuffer.mockReset();
    const fetchImpl = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: 'http://127.0.0.1:3001/internal' },
    }));

    await expect(transferRichContentImage(
      'https://img.example.com/start.jpg',
      'shop-1',
      'user-1',
      { fetchImpl, lookup: async () => [{ address: '1.1.1.1', family: 4 }] },
    )).rejects.toThrow(/public|private|redirect/i);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(uploadBuffer).not.toHaveBeenCalled();
  });

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

  it('builds native size chart tables while preserving rich text and images', async () => {
    const uploadedCharts: any[] = [];
    const attr = await buildOzonRichContentAttribute(JSON.stringify({
      blocks: [
        { type: 'text', text: 'Описание товара.' },
        {
          type: 'size_chart',
          title: 'Таблица размеров',
          columns: ['尺码', '俄罗斯尺码', '国际尺码'],
          rows: [
            { size: 'M', ruSize: '44', intSize: 'M' },
            { size: 'L', ruSize: '46', intSize: 'L' },
          ],
        },
        { imageUrl: 'https://cdn.example.com/detail.jpg' },
      ],
    }), {
      imageMapper: async (url) => `https://erp.example.com/rich/${url.split('/').pop()}`,
      sizeChartImageMapper: async (chart) => {
        uploadedCharts.push(chart);
        return 'https://erp.example.com/rich/size-chart.jpg';
      },
    });

    expect(uploadedCharts).toHaveLength(0);
    const richJson = JSON.parse(attr!.values[0]!.value);
    expect(richJson.content[0]).toMatchObject({
      widgetName: 'tcTable',
      table: {
        body: [
          { data: [['RU', 'Российский размер'], '44', '46'] },
          { data: [['INT', 'Международный размер'], 'M', 'L'] },
        ],
      },
    });
    expect(richJson.content[2]).toMatchObject({
      widgetName: 'raShowcase',
      blocks: [{
        img: {
          src: 'https://erp.example.com/rich/detail.jpg',
          srcMobile: 'https://erp.example.com/rich/detail.jpg',
        },
        text: {
          content: ['Описание товара.'],
        },
      }],
    });
    expect(JSON.stringify(richJson)).not.toContain('https://erp.example.com/rich/size-chart.jpg');
  });

  it('builds native Ozon tcTable JSON from generated size chart blocks', async () => {
    const uploadedCharts: any[] = [];
    const attr = await buildOzonRichContentAttribute(JSON.stringify({
      blocks: [
        { type: 'text', text: 'Описание товара.' },
        {
          type: 'size_chart',
          title: 'Таблица размеров женской одежды',
          columns: ['尺码', '俄罗斯尺码', '国际尺码', '胸围(cm)', '腰围(cm)'],
          rows: [
            { size: 'M', ruSize: '44', intSize: 'M', '胸围(cm)': '88-92', '腰围(cm)': '70-74' },
            { size: 'L', ruSize: '46', intSize: 'L', '胸围(cm)': '93-97', '腰围(cm)': '75-78' },
          ],
        },
      ],
    }), {
      sizeChartImageMapper: async (chart) => {
        uploadedCharts.push(chart);
        return 'https://erp.example.com/rich/size-chart.jpg';
      },
    });

    expect(uploadedCharts).toHaveLength(0);
    const richJson = JSON.parse(attr!.values[0]!.value);
    expect(richJson.version).toBe(0.1);
    expect(richJson.content[0]).toMatchObject({
      widgetName: 'tcTable',
      table: {
        title: 'Таблица размеров женской одежды',
        body: [
          { data: [['RU', 'Российский размер'], '44', '46'] },
          { data: [['INT', 'Международный размер'], 'M', 'L'] },
          { data: [['Ог, см', 'Обхват груди'], '88-92', '93-97'] },
          { data: [['От, см', 'Обхват талии'], '70-74', '75-78'] },
        ],
      },
    });
    expect(richJson.content[1]).toMatchObject({
      widgetName: 'tcInstruction',
      instruction: { view: 'women_clothing' },
    });
  });

  it('builds a dedicated Ozon size chart JSON attribute when the category exposes it', () => {
    const attrDef = resolveOzonSizeChartAttributeDef([
      { id: 13164, name: 'Таблица размеров JSON' },
      { id: 22336, name: 'Rich-контент JSON' },
    ]);
    expect(attrDef?.id).toBe(13164);

    const attr = buildOzonSizeChartAttribute(JSON.stringify({
      blocks: [{
        type: 'size_chart',
        title: 'Таблица размеров мужской одежды',
        columns: ['尺码', '俄罗斯尺码', '国际尺码', '胸围(cm)', '腰围(cm)', '臀围(cm)', '领围(cm)'],
        rows: [
          { size: 'M', ruSize: '48', intSize: 'M', '胸围(cm)': '96-99', '腰围(cm)': '85-87', '臀围(cm)': '102-105', '领围(cm)': '40' },
          { size: 'L', ruSize: '50', intSize: 'L', '胸围(cm)': '100-103', '腰围(cm)': '88-90', '臀围(cm)': '106-108', '领围(cm)': '41' },
        ],
      }],
    }), { attributeId: Number(attrDef!.id) });

    expect(attr?.id).toBe(13164);
    const value = JSON.parse(attr!.values[0]!.value);
    expect(value).toMatchObject({
      version: 0.1,
      content: [{
        widgetName: 'tcTable',
        table: {
          title: 'Таблица размеров мужской одежды',
          body: [
            { data: [['RU', 'Российский размер'], '48', '50'] },
            { data: [['INT', 'Международный размер'], 'M', 'L'] },
            { data: [['Ог, см', 'Обхват груди'], '96-99', '100-103'] },
            { data: [['От, см', 'Обхват талии'], '85-87', '88-90'] },
            { data: [['Об, см', 'Обхват бедер'], '102-105', '106-108'] },
            { data: [['Ош', 'Обхват шеи, см'], '40', '41'] },
          ],
        },
      }, {
        widgetName: 'tcInstruction',
        instruction: { view: 'women_clothing' },
      }],
    });
  });

  it('renders dynamic size chart columns from built-in template rows', () => {
    const svg = renderSizeChartSvg({
      type: 'size_chart',
      title: 'Таблица размеров детских шапок',
      columns: ['尺码', '俄罗斯尺码', '头围(cm)', '身高(cm)', '年龄'],
      rows: [
        { size: '48', ruSize: '48', '头围(cm)': '48', '身高(cm)': '80-86', '年龄': '1.5年' },
      ],
    });

    expect(svg).toContain('头围(cm)');
    expect(svg).toContain('80-86');
    expect(svg).toContain('1.5年');
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
      message: expect.stringContaining('暂不能通过 Seller API 自动上传'),
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

  it('builds editable Ozon video URL attributes from Seller temporary video uploads', () => {
    const attrs = buildOzonVideoMediaAttributesFromSourceVideos([
      { url: 'https://cdn1.ozone.ru/s3/sc-temporary/ce/8b/ce8bf080c9ce8fb34994cc73c2f561a2.mp4?token=demo' },
    ]);

    expect(attrs).toEqual([
      {
        id: 21841,
        complex_id: 100001,
        values: [{ value: 'https://cdn1.ozone.ru/s3/sc-temporary/ce/8b/ce8bf080c9ce8fb34994cc73c2f561a2.mp4' }],
      },
    ]);
  });
});
