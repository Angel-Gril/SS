import { describe, expect, it } from 'vitest';
import {
  appendOzonRichContentAttribute,
  buildOzonRichContentAttribute,
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
      version: 1,
      content: [
        { widgetName: 'raText', text: { content: 'Описание' } },
        { widgetName: 'raText', text: { content: 'Коллекционная фигурка' } },
        { widgetName: 'raImage', img: { src: 'https://erp.example.com/rich/source.jpg' } },
      ],
    });
    expect(attr?.values[0]?.dictionary_value_id).toBe(0);
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

  it('records collected videos as unsupported publish diagnostics instead of cloning them', () => {
    expect(planCollectedVideoPublish([
      { url: 'https://cdn.example.com/video.mp4', coverUrl: 'https://cdn.example.com/cover.jpg', title: 'Обзор' },
    ], 'offer-1')).toEqual({
      offerId: 'offer-1',
      status: 'skipped',
      reason: 'video_publish_not_supported',
      sourceVideos: [
        { url: 'https://cdn.example.com/video.mp4', coverUrl: 'https://cdn.example.com/cover.jpg', title: 'Обзор' },
      ],
    });
  });
});
