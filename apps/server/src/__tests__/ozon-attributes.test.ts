import { describe, expect, it } from 'vitest';
import { convertOzonRawAttrs } from '../services/ozon-attributes.js';

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
});
