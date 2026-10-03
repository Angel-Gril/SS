import { describe, expect, it } from 'vitest';
import type { OzonCategoryCatalogEntry } from '../services/ozon-category-catalog.js';
import { buildSourceProductProfile } from '../services/source-product-profile.js';
import { categoryTextScore, rankSourceOzonCategoryCatalog, sourceCategorySearchTerms } from '../services/source-ozon-category-recommendation.js';

// Local catalog projections reproduce the public product titles and the observed
// misleading aliases. They contain no production owner, device or shop data.
function entry(typeId: number, typeNameRu: string, typeNameZh: string, options: Partial<OzonCategoryCatalogEntry> = {}): OzonCategoryCatalogEntry {
  const categoryNameRu = options.categoryNameRu ?? 'Одежда';
  const categoryNameZh = options.categoryNameZh ?? '服装';
  return {
    descriptionCategoryId: 1000, typeId, categoryPathRu: [categoryNameRu], categoryPathZh: [categoryNameZh],
    categoryLevels: [], categoryNameRu, categoryNameZh, typeNameRu, typeNameZh,
    displayPathRu: `${categoryNameRu} / ${typeNameRu}`, displayPathZh: `${categoryNameZh} / ${typeNameZh}`,
    translationStatus: 'complete', untranslatedTerms: [], keywords: [categoryNameZh, typeNameZh],
    searchText: `${categoryNameRu} ${typeNameRu} ${categoryNameZh} ${typeNameZh}`, ...options,
  };
}

function profile(title: string, categoryName: string) {
  return buildSourceProductProfile({ id: 'local-profile', title, sourcePlatform: '1688',
    metadata: { categoryName, categoryPath: [categoryName], sourceStandardAttributes: { categoryHints: [categoryName] } } });
}

describe('shared source Ozon category recommendation', () => {
  it('prioritizes the observed long-sleeve T-shirt type over generic T-shirts and football aliases', () => {
    const source = profile('2024秋冬新款内搭短款学生上衣修身洋气磨毛T恤长袖德绒打底衫女', '女式T恤');
    const football = entry(971079131, 'Футбольная форма', '足球制服', {
      keywords: ['T恤', 'футболка', 'tshirt', '服装', '女式T恤'],
      searchText: 'одежда футбольная форма футболка T恤 tshirt 服装 女式T恤',
    });
    const candidates = rankSourceOzonCategoryCatalog(source, [
      entry(93244, 'Футболка', 'T恤'), football, entry(93148, 'Лонгслив', '长袖T恤'),
      { ...football, descriptionCategoryId: 1001 }, entry(97933, 'Форма для американского футбола', '美式橄榄球制服', { keywords: ['T恤', '服装', '女式T恤'] }),
    ]);
    expect(candidates[0]?.entry.typeId).toBe(93148);
    expect(candidates.filter(candidate => [971079131, 97933].includes(candidate.entry.typeId))).toEqual([]);
    expect(candidates[0]).not.toHaveProperty('probability');
    expect(candidates[0]).not.toHaveProperty('selected');
  });

  it('prefers a hooded sweatshirt over a broad apparel branch and T-shirt retrieval aliases', () => {
    const source = profile('女式连帽卫衣秋冬宽松长袖学生休闲上衣', '女式卫衣');
    const candidates = rankSourceOzonCategoryCatalog(source, [
      entry(1, 'Форма для американского футбола', '美式橄榄球制服', { keywords: ['女式卫衣', '卫衣', '服装'] }),
      entry(2, 'Футболка', 'T恤', { keywords: ['上衣', '长袖', '女式卫衣'] }),
      entry(3, 'Худи', '连帽卫衣'), entry(4, 'Свитшот', '卫衣'),
    ]);
    expect(candidates[0]?.entry.typeId).toBe(3);
    expect(candidates.map(candidate => candidate.entry.typeId)).not.toContain(1);
  });

  it('prefers a storage box over categories that only share storage branch keywords', () => {
    const source = profile('透明收纳盒塑料桌面整理盒带盖家用储物盒', '收纳盒');
    const home = { categoryNameRu: 'Дом и сад', categoryNameZh: '家居园艺' };
    const candidates = rankSourceOzonCategoryCatalog(source, [
      entry(1, 'Органайзер для проводов', '线缆收纳器', { ...home, keywords: ['收纳盒', '整理盒', 'storage box', 'organizer box', '物品收纳'] }),
      entry(2, 'Коробка для хранения', '收纳盒', home),
      entry(3, 'Органайзер для хранения вещей', '收纳整理盒', home),
    ]);
    expect(candidates[0]?.entry.typeId).toBe(2);
  });

  it('does not multiply a keyword score because the same evidence was projected into several profile fields', () => {
    const source = profile('女式长袖T恤', '女式T恤');
    const candidate = { categoryName: 'Женская одежда', typeName: 'Футболка' };
    const terms = ['female', 'женская', 'футболка', 't-shirt'];
    expect(categoryTextScore([...terms, ...terms, ' FEMALE '], candidate)).toBe(categoryTextScore(terms, candidate));
    const catalog = [entry(1, 'Футболка', 'T恤'), entry(2, 'Лонгслив', '长袖T恤')];
    const ordinary = rankSourceOzonCategoryCatalog(source, catalog);
    const duplicate = rankSourceOzonCategoryCatalog({ ...source, categoryHints: Array(20).fill('女式T恤'), categoryPath: Array(20).fill('女式T恤') }, catalog);
    expect(duplicate.map(value => value.entry.typeId)).toEqual(ordinary.map(value => value.entry.typeId));
  });

  it('matches complete Latin product and gender terms instead of substrings within unrelated words', () => {
    const terms = sourceCategorySearchTerms('women female T-shirt');
    expect(categoryTextScore(terms, { categoryName: 'women female clothing', typeName: 'T-shirt' }))
      .toBeGreaterThan(categoryTextScore(terms, { categoryName: 'men male clothing', typeName: 'T-shirt' }));
    expect(sourceCategorySearchTerms('women female T-shirt')).not.toContain('мужская');
    const braTerms = sourceCategorySearchTerms('bracket tool');
    expect(braTerms).not.toContain('бюстгальтер');
  });

  it('does not infer an inner shirt from the shirt substring inside T-shirt', () => {
    const terms = sourceCategorySearchTerms('women long-sleeve T-shirt');
    expect(terms).not.toContain('рубашка');
    expect(categoryTextScore(terms, { categoryName: 'women clothing', typeName: 'long-sleeve T-shirt' }))
      .toBeGreaterThan(categoryTextScore(terms, { categoryName: 'women clothing', typeName: 'shirt' }));
  });

  it('keeps adult, disabled and nonselectable catalog entries outside normal apparel recommendations', () => {
    const source = profile('女士无痕聚拢文胸内衣', '文胸');
    const candidates = rankSourceOzonCategoryCatalog(source, [
      entry(1, 'Бюстгальтер', '文胸'), entry(2, 'Бюстгальтер', '文胸', { disabled: true }),
      entry(3, 'Бюстгальтер', '文胸', { selectable: false }),
      entry(4, 'Эротическое белье', '情趣内衣', { categoryNameRu: 'Товары для взрослых' }),
    ]);
    expect(candidates.map(candidate => candidate.entry.typeId)).toEqual([1]);
  });
});
