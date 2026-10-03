import type { OzonCategoryCatalogEntry } from './ozon-category-catalog.js';
import { getOzonCategoryLocalKeywordExpansions } from './ozon-category-local-rules.js';
import type { SourceProductProfile } from './source-product-profile.js';

function normalize(value: unknown): string {
  return String(value || '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
}

// Shared by the Web category candidates and the device editor. These terms are
// retrieval hints, never a selected category or an approval probability.
export function sourceCategorySearchTerms(value: unknown): string[] {
  const term = normalize(value);
  if (!term) return [];
  const out = [term, ...getOzonCategoryLocalKeywordExpansions([term]).map(normalize)];
  const expansions: Array<[RegExp, string[]]> = [
    [/牛仔裤|牛仔|jeans?/i, ['джинсы', 'denim', 'jeans']],
    [/裤子|长裤|直筒裤|休闲裤|工装裤|阔腿裤|九分裤|哈伦裤|小脚裤|西裤|运动裤|卫裤|亚麻裤|棉麻裤|pants?|trousers?/i, ['брюки', 'штаны', 'pants', 'trousers']],
    [/男装|男士|男款|男人|男性|\bmen'?s?\b|male/i, ['мужская', 'мужской', 'мужские', 'men', 'male']],
    [/女装|女士|女款|女人|女性|\bwomen'?s?\b|female/i, ['женская', 'женский', 'женские', 'women', 'female']],
    [/t恤|体恤|短袖|футбол/i, ['футболка', 'футболки', 't-shirt']],
    [/衬衫|shirt/i, ['рубашка', 'рубашки', 'shirt']],
    [/外套|夹克|jacket/i, ['куртка', 'куртки', 'jacket']],
    [/短裤|shorts/i, ['шорты', 'shorts']],
    [/睡衣|睡裙|睡袍|家居服|吊带睡|nightgown|nightdress|sleepwear|pajamas?|pyjamas?/i, ['пижама', 'пижамы', 'ночная сорочка', 'сорочка', 'пеньюар', 'домашняя одежда', 'sleepwear', 'nightdress']],
    [/裙|skirt|dress/i, ['юбка', 'платье', 'skirt', 'dress']],
    [/文胸|胸罩|胸垫|无痕|聚拢|薄杯|厚杯|bra/i, ['бюстгальтер', 'бюстгальтеры', 'bra']],
    [/内衣|lingerie/i, ['белье', 'бельё', 'lingerie']],
    [/内裤|underwear/i, ['трусы', 'нижнее белье', 'белье', 'бельё', 'underwear']],
    [/吊带|背心|camisole|tank/i, ['майка', 'топ', 'белье', 'бельё']],
    [/遥控玩具|遥控|玩具车|remote control|rc toy/i, ['радиоуправляемые игрушки', 'игрушка радиоуправляемая', 'радиоуправляем', 'toy']],
    [/婴儿床铃|床铃|床挂|baby mobile/i, ['мобили и дуги в кроватку', 'мобиль', 'baby mobile']],
    [/玩具|toy/i, ['игрушки', 'игрушка', 'toy']],
  ];
  for (const [pattern, words] of expansions) {
    if (pattern.test(term)) out.push(...words.map(normalize));
  }
  return Array.from(new Set(out.filter(Boolean)));
}

export function categoryTextScore(sourceTerms: string[], candidate: { categoryName: string; typeName: string }, extraSearchText = ''): number {
  const haystack = normalize([candidate.categoryName, candidate.typeName, extraSearchText].filter(Boolean).join(' '));
  let score = 0;
  for (const term of sourceTerms) {
    if (!term) continue;
    if (haystack.includes(term) || term.includes(haystack)) score += 8;
  }
  const sourceText = sourceTerms.join(' ');
  if (/牛仔裤|джинсы|jeans?/.test(sourceText)) {
    if (/джинсы|jeans?/.test(haystack)) score += 28;
    if (/брюки|штаны|pants|trousers/.test(haystack) && !/джинсы|jeans?/.test(haystack)) score -= 12;
  }
  if (/裤子|长裤|直筒裤|休闲裤|工装裤|阔腿裤|九分裤|哈伦裤|小脚裤|西裤|运动裤|卫裤|亚麻裤|棉麻裤|брюки|штаны|pants?|trousers?/.test(sourceText) && !/牛仔裤|джинсы|jeans?/.test(sourceText)) {
    if (/брюки|штаны|pants|trousers/.test(haystack)) score += 32;
    if (/джинсы|jeans?/.test(haystack)) score -= 18;
  }
  if (/\bmale\b|мужск|男装|男士|男款|男人|男性/.test(sourceText)) {
    if (/мужск|men|male/.test(haystack)) score += 16;
    if (/женск|women|female|малыш|детск|ребен|ребён|baby|kids?/.test(haystack)) score -= 28;
  }
  if (/\bfemale\b|женск|女装|女士|女款|女人|女性/.test(sourceText)) {
    if (/женск|women|female/.test(haystack)) score += 16;
    if (/мужск|men|male|малыш|детск|ребен|ребён|baby|kids?/.test(haystack)) score -= 28;
  }
  if (/文胸|胸罩|胸垫|bra|бюстгальтер/.test(sourceText)) {
    if (/бюстгальтер|лифчик|bra/.test(haystack)) score += 28;
  }
  if (/内裤|underwear|трус|нижнее белье|бель[её]/.test(sourceText)) {
    const beddingCandidate = /постельн|пододеял|простын|наволоч|одеял|матрас|бельевая|бельёвая|веревк|верёвк/.test(haystack);
    if (/трус|нижнее белье|женск\S* бель[её]|underwear/.test(haystack)) score += 34;
    if (beddingCandidate) score -= 200;
  }
  if (/睡衣|睡裙|睡袍|家居服|sleepwear|nightdress|nightgown|pajamas?|pyjamas?|пижам|ночн|сорочк|пеньюар/.test(sourceText)) {
    if (/пижам|ночн|сорочк|пеньюар|домашн|халат|sleepwear|nightdress|nightgown/.test(haystack)) score += 42;
    if (/бюстгальтер|лифчик|bra|аксессуар для бюстгальтера/.test(haystack)) score -= 28;
    if (/красот|гигиен|салон|стрижк|парикмахер|оборудование для салонов|beauty|haircut|barber/.test(haystack)) score -= 180;
  }
  if (/遥控玩具|радиоуправляем|remote control|rc toy/.test(sourceText)) {
    if (/радиоуправляем|игрушк/.test(haystack)) score += 34;
  }
  if (/婴儿床铃|床铃|床挂|мобил|baby mobile/.test(sourceText)) {
    if (/мобил|кроватк|дуг/.test(haystack)) score += 34;
  }
  if (/玩具|toy|игруш/.test(sourceText)) {
    if (/игруш|toy/.test(haystack)) score += 18;
  }
  if (/спецодежд|медицинск|малыш|детск|ребен|ребён|тактическ|прессотерапии/.test(haystack)) score -= 18;
  return score;
}

export function rankSourceOzonCategoryCatalog(profile: SourceProductProfile, catalog: OzonCategoryCatalogEntry[]) {
  const terms = [profile.sourceTitle, profile.categoryName, ...profile.categoryPath,
    ...profile.categoryHints, ...profile.productIntentTerms, ...profile.productTypeHints,
    ...profile.genderSeasonHints].flatMap(sourceCategorySearchTerms).filter(Boolean);
  const adultSource = /成人用品|情趣| секс|adult|интим|эротич|анальн|вагинальн|эрекц/i.test(terms.join(' '));
  return catalog.filter((entry) => entry.disabled !== true && entry.selectable !== false)
    .map((entry) => ({ entry, score: categoryTextScore(terms,
      { categoryName: entry.categoryNameRu, typeName: entry.typeNameRu },
      [entry.displayPathZh, entry.searchText, ...entry.keywords].join(' ')) }))
    .filter(({ entry, score }) => score > 0 && (adultSource || !/товары для взрослых|секс|интим|эротич|анальн|вагинальн|эрекц|adult|成人用品|情趣/i
      .test(`${entry.categoryNameRu} ${entry.typeNameRu}`)))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(({ entry, score }) => ({ entry,
      match: (score + 30 >= 80 ? 'recommended' : score + 30 >= 45 ? 'optional' : 'risky') as 'recommended' | 'optional' | 'risky',
      reasons: ['类目名称相似', '源商品画像'],
    }));
}
