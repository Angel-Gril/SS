import type { OzonCategoryCatalogEntry } from './ozon-category-catalog.js';
import { getOzonCategoryLocalKeywordExpansions } from './ozon-category-local-rules.js';
import type { SourceProductProfile } from './source-product-profile.js';

function normalize(value: unknown): string {
  return String(value || '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
}

// Latin short words such as men/male/bra must not match women/female/bracket.
// Chinese product phrases and Russian inflection stems retain substring matching.
function includesTerm(text: string, term: string): boolean {
  let index = text.indexOf(term);
  while (index !== -1) {
    const start = !/[a-z0-9]/.test(term[0] || '') || index === 0 || !/[a-z0-9]/.test(text[index - 1] || '');
    const end = !/[a-z0-9]/.test(term.at(-1) || '') || !/[a-z0-9]/.test(text[index + term.length] || '');
    if (start && end) return true;
    index = text.indexOf(term, index + 1);
  }
  return false;
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
    [/男装|男士|男款|男式|男人|男性|男$|\bmen(?:'s)?\b|\bmale\b/i, ['мужская', 'мужской', 'мужские', 'men', 'male']],
    [/女装|女士|女款|女式|女人|女性|女$|\bwomen(?:'s)?\b|\bfemale\b/i, ['женская', 'женский', 'женские', 'women', 'female']],
    [/t恤|体恤|短袖|футболк|\bt-?shirts?\b/i, ['футболка', 'футболки', 't-shirt']],
    [/衬衫|(?<![\w-])shirts?\b/i, ['рубашка', 'рубашки', 'shirt']],
    [/外套|夹克|jacket/i, ['куртка', 'куртки', 'jacket']],
    [/短裤|shorts/i, ['шорты', 'shorts']],
    [/睡衣|睡裙|睡袍|家居服|吊带睡|nightgown|nightdress|sleepwear|pajamas?|pyjamas?/i, ['пижама', 'пижамы', 'ночная сорочка', 'сорочка', 'пеньюар', 'домашняя одежда', 'sleepwear', 'nightdress']],
    [/裙|skirt|dress/i, ['юбка', 'платье', 'skirt', 'dress']],
    [/文胸|胸罩|胸垫|无痕|聚拢|薄杯|厚杯|\bbra\b/i, ['бюстгальтер', 'бюстгальтеры', 'bra']],
    [/内衣|lingerie/i, ['белье', 'бельё', 'lingerie']],
    [/内裤|underwear/i, ['трусы', 'нижнее белье', 'белье', 'бельё', 'underwear']],
    [/吊带|背心|camisole|tank/i, ['майка', 'топ', 'белье', 'бельё']],
    [/遥控玩具|遥控|玩具车|remote control|rc toy/i, ['радиоуправляемые игрушки', 'игрушка радиоуправляемая', 'радиоуправляем', 'toy']],
    [/婴儿床铃|床铃|床挂|baby mobile/i, ['мобили и дуги в кроватку', 'мобиль', 'baby mobile']],
    [/玩具|toy/i, ['игрушки', 'игрушка', 'toy']],
    [/卫衣|свитшот|толстовк|\bsweatshirt\b/i, ['卫衣', 'свитшот', 'толстовка', 'sweatshirt']],
    [/连帽.*卫衣|худи|\bhoodie\b/i, ['连帽卫衣', 'худи', 'hoodie']],
    [/收纳(?:整理)?盒|整理盒|储物盒|storage box|organizer box/i, ['收纳盒', 'коробка для хранения', 'органайзер для хранения вещей', 'storage box']],
  ];
  for (const [pattern, words] of expansions) {
    if (pattern.test(term)) out.push(...words.map(normalize));
  }
  if (/长袖|打底衫|лонгслив|long[\s-]?sleeve/i.test(term) && /t恤|体恤|футболк|t-?shirt|打底衫|лонгслив/i.test(term)) {
    out.push('лонгслив', '长袖t恤', 'long-sleeve t-shirt');
  }
  return Array.from(new Set(out.filter(Boolean)));
}

export function categoryTextScore(sourceTerms: string[], candidate: { categoryName: string; typeName: string; typeNameZh?: string }, extraSearchText = ''): number {
  const terms = Array.from(new Set(sourceTerms.map(normalize).filter(Boolean)));
  const typeText = normalize([candidate.typeName, candidate.typeNameZh].filter(Boolean).join(' '));
  const haystack = normalize([candidate.categoryName, candidate.typeName, extraSearchText].filter(Boolean).join(' '));
  let typeScore = 0, retrievalScore = 0;
  for (const term of terms) {
    if (includesTerm(typeText, term)) typeScore += 16;
    else if (includesTerm(haystack, term)) retrievalScore += 2;
  }
  // Repeated profile projections and broad search aliases cannot overwhelm a
  // specific official product type. Catalog aliases remain retrieval evidence.
  let score = Math.min(typeScore, 48) + Math.min(retrievalScore, 12);
  const sourceText = terms.join(' ');
  const tshirtSource = /t恤|体恤|футболк|\bt-?shirt\b/.test(sourceText);
  const sweatshirtSource = /卫衣|свитшот|толстовк|\bsweatshirt\b|\bhoodie\b|худи/.test(sourceText);
  if (tshirtSource && /футболк|t恤|体恤|\bt-?shirt\b/.test(typeText)) score += 32;
  if ((tshirtSource || /лонгслив|打底衫/.test(sourceText)) && /лонгслив|长袖t恤|long[\s-]?sleeve|打底衫/.test(sourceText)
    && /лонгслив|长袖t恤|打底衫|long[\s-]?sleeve|футболк.*длинн.*рукав/.test(typeText)) score += 64;
  if (sweatshirtSource && /卫衣|свитшот|толстовк|\bsweatshirt\b|\bhoodie\b|худи/.test(typeText)) score += 32;
  if (/连帽.*卫衣|\bhoodie\b|худи/.test(sourceText) && /连帽.*卫衣|\bhoodie\b|худи/.test(typeText)) score += 48;
  if ((tshirtSource || sweatshirtSource) && !/足球|橄榄球|\bfootball\b|футбольн/.test(sourceText)
    && /足球|橄榄球|\bfootball\b|футбольн|футбол(?:а|у|ом|е)?(?:$|[\s,])/.test(typeText)) score -= 100;
  if (/收纳(?:整理)?盒|整理盒|储物盒|storage box|коробка для хранения/.test(sourceText)) {
    if (/收纳(?:整理)?盒|整理盒|储物盒|коробка для хранения|органайзер для хранения вещей|storage box/.test(typeText)) score += 48;
    if (/收纳盒|储物盒|storage box/.test(sourceText) && /收纳盒|储物盒|коробка для хранения|storage box/.test(typeText)) score += 16;
    if (!/车载|工具|线缆|汽车|провод|автомобил|инструмент/.test(sourceText)
      && /车载|工具|线缆|汽车|провод|автомобил|инструмент/.test(typeText)) score -= 64;
  }
  if (/牛仔裤|джинсы|jeans?/.test(sourceText)) {
    if (/джинсы|jeans?/.test(haystack)) score += 28;
    if (/брюки|штаны|pants|trousers/.test(haystack) && !/джинсы|jeans?/.test(haystack)) score -= 12;
  }
  if (/裤子|长裤|直筒裤|休闲裤|工装裤|阔腿裤|九分裤|哈伦裤|小脚裤|西裤|运动裤|卫裤|亚麻裤|棉麻裤|брюки|штаны|pants?|trousers?/.test(sourceText) && !/牛仔裤|джинсы|jeans?/.test(sourceText)) {
    if (/брюки|штаны|pants|trousers/.test(haystack)) score += 32;
    if (/джинсы|jeans?/.test(haystack)) score -= 18;
  }
  if (/\bmale\b|мужск|男装|男士|男款|男人|男性/.test(sourceText)) {
    if (/мужск|\bmen\b|\bmale\b/.test(haystack)) score += 16;
    if (/женск|\bwomen\b|\bfemale\b|малыш|детск|ребен|ребён|\bbaby\b|\bkids?\b/.test(haystack)) score -= 28;
  }
  if (/\bfemale\b|женск|女装|女士|女款|女人|女性/.test(sourceText)) {
    if (/женск|\bwomen\b|\bfemale\b/.test(haystack)) score += 16;
    if (/мужск|\bmen\b|\bmale\b|малыш|детск|ребен|ребён|\bbaby\b|\bkids?\b/.test(haystack)) score -= 28;
  }
  if (/文胸|胸罩|胸垫|\bbra\b|бюстгальтер/.test(sourceText)) {
    if (/бюстгальтер|лифчик|\bbra\b/.test(haystack)) score += 28;
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
  const terms = Array.from(new Set([profile.sourceTitle, profile.categoryName, ...profile.categoryPath,
    ...profile.categoryHints, ...profile.productIntentTerms, ...profile.productTypeHints,
    ...profile.genderSeasonHints].flatMap(sourceCategorySearchTerms).filter(Boolean)));
  const adultSource = /成人用品|情趣| секс|adult|интим|эротич|анальн|вагинальн|эрекц/i.test(terms.join(' '));
  return catalog.filter((entry) => entry.disabled !== true && entry.selectable !== false)
    .map((entry) => ({ entry, score: categoryTextScore(terms,
      { categoryName: entry.categoryNameRu, typeName: entry.typeNameRu, typeNameZh: entry.typeNameZh },
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
