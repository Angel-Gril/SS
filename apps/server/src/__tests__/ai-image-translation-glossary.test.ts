import { describe, expect, it } from 'vitest';
import {
  aiImageTranslationGlossaryStringSchema,
  parseAiImageTranslationGlossary,
  resolveTrustedAiImageTranslationCategory,
  resolveAiImageTranslationGlossary,
} from '../services/ai-image-translation-glossary.js';

describe('AI image translation glossary', () => {
  it('normalizes administrator JSON and resolves narrower profiles before explicit terms', () => {
    const config = parseAiImageTranslationGlossary(JSON.stringify({
      version: 1,
      profiles: [
        {
          sourceLanguage: ' ZH ', targetLanguage: ' RU ',
          terms: [
            { src: ' Material ', tgt: ' материал ' },
            { src: 'Color', tgt: 'глобальный цвет' },
            { src: 'Capacity', tgt: 'общий объем' },
            { src: 'ＭＬ', tgt: ' мл ' },
          ],
        },
        {
          sourceLanguage: 'zh', targetLanguage: 'ru', categoryId: 10,
          terms: [{ src: 'COLOR', tgt: 'цвет категории' }],
        },
        {
          sourceLanguage: 'zh', targetLanguage: 'ru', categoryId: 10, typeId: 20,
          terms: [{ src: 'capacity', tgt: 'точный объем' }],
        },
      ],
    }));

    expect(config.profiles[0]).toMatchObject({ sourceLanguage: 'zh', targetLanguage: 'ru' });
    expect(config.profiles[0]?.terms).toContainEqual({ src: 'ML', tgt: 'мл' });

    expect(resolveAiImageTranslationGlossary({
      config,
      sourceLanguage: 'ZH',
      targetLanguage: 'RU',
      categoryId: 10,
      typeId: 20,
      explicitTerms: [{ src: ' material ', tgt: 'состав' }],
    })).toEqual({
      terms: [
        { src: 'capacity', tgt: 'точный объем' },
        { src: 'COLOR', tgt: 'цвет категории' },
        { src: 'material', tgt: 'состав' },
        { src: 'ML', tgt: 'мл' },
      ],
      matchedProfileKeys: [
        'zh->ru:global',
        'zh->ru:category:10',
        'zh->ru:category:10:type:20',
      ],
      configVersion: 1,
      configSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
  });

  it('rejects conflicting case-insensitive source mappings inside one profile', () => {
    expect(() => parseAiImageTranslationGlossary(JSON.stringify({
      version: 1,
      profiles: [{
        sourceLanguage: 'en',
        targetLanguage: 'ru',
        terms: [
          { src: 'Mug', tgt: 'кружка' },
          { src: 'mug', tgt: 'чашка' },
        ],
      }],
    }))).toThrow(/conflicting source mapping/iu);
  });

  it('rejects duplicate profile keys after language normalization', () => {
    expect(() => parseAiImageTranslationGlossary(JSON.stringify({
      version: 1,
      profiles: [
        {
          sourceLanguage: ' EN ', targetLanguage: 'RU', categoryId: 7,
          terms: [{ src: 'mug', tgt: 'кружка' }],
        },
        {
          sourceLanguage: 'en', targetLanguage: ' ru ', categoryId: 7,
          terms: [{ src: 'capacity', tgt: 'объём' }],
        },
      ],
    }))).toThrow(/duplicate profile key/iu);
  });

  it('treats missing and blank administrator config as an empty version-one glossary', () => {
    const expected = { version: 1, profiles: [] };

    expect(parseAiImageTranslationGlossary(undefined)).toEqual(expected);
    expect(parseAiImageTranslationGlossary(null)).toEqual(expected);
    expect(parseAiImageTranslationGlossary('   ')).toEqual(expected);
  });

  it('produces the same config digest regardless of JSON whitespace and profile ordering', () => {
    const first = JSON.stringify({
      version: 1,
      profiles: [
        {
          sourceLanguage: 'en', targetLanguage: 'ru', categoryId: 2,
          terms: [{ src: 'Capacity', tgt: 'Объём' }],
        },
        {
          sourceLanguage: 'en', targetLanguage: 'ru',
          terms: [{ src: 'Mug', tgt: 'Кружка' }],
        },
      ],
    });
    const reordered = `{
      "profiles": [
        { "terms": [{ "tgt": "Кружка", "src": "Mug" }], "targetLanguage": "ru", "sourceLanguage": "en" },
        { "categoryId": 2, "terms": [{ "tgt": "Объём", "src": "Capacity" }], "targetLanguage": "ru", "sourceLanguage": "en" }
      ],
      "version": 1
    }`;

    const firstDigest = resolveAiImageTranslationGlossary({
      config: first, sourceLanguage: 'en', targetLanguage: 'ru',
    }).configSha256;
    const reorderedDigest = resolveAiImageTranslationGlossary({
      config: reordered, sourceLanguage: 'en', targetLanguage: 'ru',
    }).configSha256;

    expect(reorderedDigest).toBe(firstDigest);
  });

  it('rejects conflicting case-insensitive mappings in explicit terms', () => {
    expect(() => resolveAiImageTranslationGlossary({
      config: '',
      sourceLanguage: 'en',
      targetLanguage: 'ru',
      explicitTerms: [
        { src: 'Mug', tgt: 'кружка' },
        { src: 'mug', tgt: 'чашка' },
      ],
    })).toThrow(/conflicting source mapping/iu);
  });

  it('rejects a type profile without its category scope', () => {
    expect(() => parseAiImageTranslationGlossary({
      version: 1,
      profiles: [{
        sourceLanguage: 'en', targetLanguage: 'ru', typeId: 2,
        terms: [{ src: 'mug', tgt: 'кружка' }],
      }],
    })).toThrow(/typeId requires categoryId/iu);
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid category identifier %s',
    (categoryId) => {
      expect(() => parseAiImageTranslationGlossary({
        version: 1,
        profiles: [{
          sourceLanguage: 'en', targetLanguage: 'ru', categoryId,
          terms: [],
        }],
      })).toThrow();
    },
  );

  it('rejects more than 50 terms in one profile', () => {
    const terms = Array.from({ length: 51 }, (_, index) => ({
      src: `source-${index}`,
      tgt: `target-${index}`,
    }));

    expect(() => parseAiImageTranslationGlossary({
      version: 1,
      profiles: [{ sourceLanguage: 'en', targetLanguage: 'ru', terms }],
    })).toThrow();
  });

  it('rejects rather than truncating a merged glossary above 50 terms', () => {
    const globalTerms = Array.from({ length: 50 }, (_, index) => ({
      src: `source-${index}`,
      tgt: `target-${index}`,
    }));
    const config = parseAiImageTranslationGlossary({
      version: 1,
      profiles: [
        { sourceLanguage: 'en', targetLanguage: 'ru', terms: globalTerms },
        {
          sourceLanguage: 'en', targetLanguage: 'ru', categoryId: 3,
          terms: [{ src: 'extra-source', tgt: 'extra-target' }],
        },
      ],
    });

    expect(() => resolveAiImageTranslationGlossary({
      config,
      sourceLanguage: 'en',
      targetLanguage: 'ru',
      categoryId: 3,
    })).toThrow(/exceeds 50 terms/iu);
  });

  it('exposes a string schema that accepts defaults and valid JSON but rejects invalid JSON', () => {
    expect(aiImageTranslationGlossaryStringSchema.safeParse('  ').success).toBe(true);
    expect(aiImageTranslationGlossaryStringSchema.safeParse(
      '{"version":1,"profiles":[]}',
    ).success).toBe(true);
    expect(aiImageTranslationGlossaryStringSchema.safeParse(
      '{"version":1,"profiles":[{"sourceLanguage":"en"}]}',
    ).success).toBe(false);
  });

  it('rejects identical or malformed language pairs, oversized terms, and unbounded JSON', () => {
    expect(() => parseAiImageTranslationGlossary({
      version: 1,
      profiles: [{
        sourceLanguage: 'en', targetLanguage: 'en',
        terms: [{ src: 'valid', tgt: 'значение' }],
      }],
    })).toThrow();

    expect(() => parseAiImageTranslationGlossary({
      version: 1,
      profiles: [{
        sourceLanguage: 'en-US-extra', targetLanguage: 'ru',
        terms: [],
      }],
    })).toThrow();

    expect(() => parseAiImageTranslationGlossary({
      version: 1,
      profiles: [{
        sourceLanguage: 'en', targetLanguage: 'ru',
        terms: [{ src: 'x'.repeat(121), tgt: 'значение' }],
      }],
    })).toThrow();

    expect(() => aiImageTranslationGlossaryStringSchema.parse(' '.repeat(100_001)))
      .toThrow();
  });

  it('rejects more than 500 independently scoped profiles', () => {
    const profiles = Array.from({ length: 501 }, (_, index) => ({
      sourceLanguage: 'zh',
      targetLanguage: 'ru',
      categoryId: index + 1,
      terms: [],
    }));

    expect(() => parseAiImageTranslationGlossary({ version: 1, profiles })).toThrow();
  });

  it('uses only a current, positive listing category as trusted glossary scope', () => {
    const category = { categoryId: 10, typeId: 20 };

    expect(resolveTrustedAiImageTranslationCategory({
      category,
      freshness: { category: { state: 'CURRENT' } },
    })).toEqual(category);
    expect(resolveTrustedAiImageTranslationCategory({
      category,
      freshness: { category: { state: 'STALE' } },
    })).toBeNull();
    expect(resolveTrustedAiImageTranslationCategory({
      category: { categoryId: 0, typeId: 20 },
      freshness: { category: { state: 'CURRENT' } },
    })).toBeNull();
    expect(resolveTrustedAiImageTranslationCategory({
      category: null,
      freshness: { category: { state: 'CURRENT' } },
    })).toBeNull();
  });
});
