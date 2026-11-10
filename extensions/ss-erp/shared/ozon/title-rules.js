// 俄文标题规则生成（Ozon 直连车道的命名逻辑）
//
// 为什么不用 AI：这家 BYOK provider 只挂了图像模型（gpt-image-2*），没有 chat
// 端点；ERP 的 COPY_GENERATE 又在超时的那条通道上。所以先做**确定性规则**，
// 结构照 Ozon 的通用写法和竞品（精铺/知了）的字段顺序：
//
//   <品类名> <性别/受众> <材质> <关键特征> <场景>
//   例：Платье женское из полиэстера без рукавов летнее
//
// 规则只做三件事：从源标题里认特征词、从已填属性里取性别/材质、清掉 1688 噪音。
// 认不出来的词直接丢，绝不把中文/促销词带进俄文标题。

const FEATURES = [
  // 袖型/领型属于互斥组：只保留一个，否则会拼出「无袖 + 吊带」这种自相矛盾
  [/吊带|背带/, 'на бретелях', 'sleeve'],
  [/露肩|一字肩|抹胸/, 'с открытыми плечами', 'sleeve'],
  [/无袖/, 'без рукавов', 'sleeve'],
  [/短袖/, 'с коротким рукавом', 'sleeve'],
  [/长袖/, 'с длинным рукавом', 'sleeve'],
  [/泡泡袖/, 'с рукавами-фонариками', 'sleeve'],
  [/翻领|衬衫领/, 'с воротником', 'neck'],
  [/连帽|卫衣/, 'с капюшоном', 'neck'],
  // 版型/长度（互斥）
  [/短款|短裙/, 'короткое', 'length'],
  [/中长款|中长/, 'миди', 'length'],
  [/长款|长裙/, 'длинное', 'length'],
  [/及膝/, 'до колен', 'length'],
  [/宽松/, 'свободный крой', 'fit'],
  [/修身|紧身/, 'приталенное', 'fit'],
  [/收腰|腰带/, 'с поясом', 'detail'],
  [/A字|a字/i, 'А-силуэт', 'detail'],
  [/开叉/, 'с разрезом', 'detail'],
  // 面料/工艺
  [/蕾丝/, 'кружевное', 'craft'],
  [/雪纺/, 'шифоновое', 'craft'],
  [/缎面|丝绸/, 'атласное', 'craft'],
  [/针织/, 'вязаное', 'craft'],
  [/牛仔/, 'джинсовое', 'craft'],
  [/印花|碎花/, 'с принтом', 'craft'],
  [/纯色/, 'однотонное', 'craft2'],
  [/刺绣/, 'с вышивкой', 'craft3'],
  [/亮片/, 'с пайетками', 'craft4'],
  // 场景：1688 标题里「秋季新款/春季新款」基本都是营销词，不当作季节；
  // 只认真正的夏/冬，且各自互斥。
  [/夏季|夏天/, 'летнее', 'season'],
  [/冬季|冬天/, 'зимнее', 'season'],
  [/通勤|职业|办公/, 'для офиса', 'scene'],
  [/度假|沙滩/, 'для отдыха', 'scene2'],
  [/派对|宴会|晚礼/, 'для вечеринки', 'scene3'],
  [/家居|睡/, 'домашнее', 'scene4'],
];

const GENDER = [
  [/(女士|女装|女款|女式|girl|women|female)/i, 'женск'],
  [/(男士|男装|男款|男式|boy|men|male)/i, 'мужск'],
  [/(儿童|童装|小孩|宝宝|幼儿)/, 'детск'],
  [/(婴儿|新生儿)/, 'для новорожденных'],
  [/(中性|情侣|男女同款|unisex)/i, 'унисекс'],
];

/** 俄文形容词要和名词性数一致：Платье(中) женское / Юбка(阴) женская / Светильник(阳) женский */
// 形容词型特征/性别词的三种性数形式（俄文拼写规则太细，直接枚举，不猜）
const FORMS = {
  женск: { m: 'женский', f: 'женская', n: 'женское' },
  мужск: { m: 'мужской', f: 'мужская', n: 'мужское' },
  детск: { m: 'детский', f: 'детская', n: 'детское' },
  'кружевное': { m: 'кружевный', f: 'кружевная', n: 'кружевное' },
  'шифоновое': { m: 'шифоновый', f: 'шифоновая', n: 'шифоновое' },
  'атласное': { m: 'атласный', f: 'атласная', n: 'атласное' },
  'вязаное': { m: 'вязаный', f: 'вязаная', n: 'вязаное' },
  'джинсовое': { m: 'джинсовый', f: 'джинсовая', n: 'джинсовое' },
  'однотонное': { m: 'однотонный', f: 'однотонная', n: 'однотонное' },
  'приталенное': { m: 'приталенный', f: 'приталенная', n: 'приталенное' },
  'короткое': { m: 'короткий', f: 'короткая', n: 'короткое' },
  'длинное': { m: 'длинный', f: 'длинная', n: 'длинное' },
  'летнее': { m: 'летний', f: 'летняя', n: 'летнее' },
  'зимнее': { m: 'зимний', f: 'зимняя', n: 'зимнее' },
  'домашнее': { m: 'домашний', f: 'домашняя', n: 'домашнее' },
};

function inflect(word, cls) {
  const forms = FORMS[word];
  return forms ? forms[cls] || forms.n : word;
}

/** 名词性数：m 阳性 / f 阴性 / n 中性 —— 形容词与材质都要跟着变 */
function genderClass(word) {
  const text = String(word || '').trim().toLowerCase();
  if (/(а|я)$/.test(text)) return 'f';
  if (/(о|е|ё)$/.test(text)) return 'n';
  return 'm';
}

function genderEnding(word) {
  const text = String(word || '').trim().toLowerCase();
  if (!text) return 'ое';
  if (/(а|я)$/.test(text)) return 'ая';
  if (/(о|е|ё)$/.test(text)) return 'ое';
  return 'ий';
}

function agreeGender(base, categoryWord) {
  if (!base) return '';
  if (base === 'для новорожденных' || base === 'унисекс') return base;
  return inflect(base, genderClass(categoryWord));
}

// 材质：给出三种性数的完整形式，避免「Юбка хлопковое」这种不一致
const MATERIAL = [
  [/(涤纶|聚酯|polyester)/i, { any: 'из полиэстера' }],
  [/(棉|cotton)/i, { m: 'хлопковый', f: 'хлопковая', n: 'хлопковое' }],
  [/(蕾丝|lace)/i, { m: 'кружевный', f: 'кружевная', n: 'кружевное' }],
  [/(雪纺|chiffon)/i, { m: 'шифоновый', f: 'шифоновая', n: 'шифоновое' }],
  [/(丝绸|缎|satin|silk)/i, { m: 'атласный', f: 'атласная', n: 'атласное' }],
  [/(针织|毛线|knit)/i, { m: 'вязаный', f: 'вязаная', n: 'вязаное' }],
  [/(羊毛|wool)/i, { m: 'шерстяной', f: 'шерстяная', n: 'шерстяное' }],
  [/(牛仔|denim)/i, { m: 'джинсовый', f: 'джинсовая', n: 'джинсовое' }],
  [/(氨纶|弹力|spandex|elastane)/i, { m: 'эластичный', f: 'эластичная', n: 'эластичное' }],
];

// 1688/淘宝标题里的噪音：促销、店铺、平台词、尺码说明
const NOISE = /(爆款|清仓|特价|包邮|尾货|代发|一件代发|批发|厂家直销|新品|热卖|网红|同款|直播|跨境|外贸|202\d|夏季新款|秋季新款|冬款|春款|码|均码|实拍|主图|视频|款号|货号|支持|定制|跨境专供)/g;

const MAX_TITLE = 500;

function pick(text, table) {
  const found = [];
  const seenGroups = new Set();
  for (const [re, value, group] of table) {
    if (!re.test(text) || found.includes(value)) continue;
    if (group) {
      if (seenGroups.has(group)) continue;   // 同组互斥，只保留最先命中的
      seenGroups.add(group);
    }
    found.push(value);
  }
  return found;
}

function cleanRu(text) {
  return String(text || '')
    .replace(/[×✕]/g, 'x')
    .replace(/[「」【】\[\]（）()]/g, ' ')
    .replace(/[，,、;；|/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 品类名词：优先用 ERP 给的俄文类目名（如 Платье），没有就从类目 ID 提示里取 */
function categoryWord(typeName, fallback) {
  const raw = cleanRu(typeName);
  if (raw && /[а-яё]/i.test(raw)) return raw.split(/\s+/)[0];
  return cleanRu(fallback) || '';
}

/**
 * @param {object} input
 *   typeName     ERP 类目俄文名（editor.category.typeName）
 *   sourceTitle  1688 原始标题
 *   gender       已填属性「Пол」的值（中文或俄文）
 *   material     已填属性「Материал」的值
 *   attributes   [{name, value}] 可选，用于补性别/材质
 * @returns { title, parts, dropped }
 */
export function buildRuTitle(input = {}) {
  const sourceTitle = String(input.sourceTitle || '');
  const attrText = (Array.isArray(input.attributes) ? input.attributes : [])
    .map((one) => `${one && one.name ? one.name : ''} ${one && one.value ? one.value : ''}`).join(' ');
  const haystack = [sourceTitle, attrText, input.gender, input.material].filter(Boolean).join(' ');

  const category = categoryWord(input.typeName, input.fallbackTypeName);
  const gender = (() => {
    const fromAttr = cleanRu(input.gender);
    const base = (() => {
      if (/женск/i.test(fromAttr)) return 'женск';
      if (/мужск/i.test(fromAttr)) return 'мужск';
      if (/детск/i.test(fromAttr)) return 'детск';
      if (/女士|女/.test(fromAttr)) return 'женск';
      if (/男士|男/.test(fromAttr)) return 'мужск';
      if (/儿童|童/.test(fromAttr)) return 'детск';
      return pick(haystack, GENDER)[0] || '';
    })();
    return agreeGender(base, category);
  })();
  const material = (() => {
    const cls = genderClass(category);
    const form = (entry) => (entry ? (entry.any || entry[cls] || entry.n || entry.m || entry.f || '') : '');
    const fromAttr = cleanRu(input.material);
    const attrHit = MATERIAL.find(([re]) => re.test(fromAttr));
    if (attrHit) return form(attrHit[1]);
    const anyHit = MATERIAL.find(([re]) => re.test(haystack));
    return form(anyHit && anyHit[1]);
  })();
  const features = pick(sourceTitle, FEATURES)
    .filter((value) => value !== category.toLowerCase())
    .slice(0, 5);

  const clsFinal = genderClass(category);
  const parts = [category, gender, material, ...features.map((one) => inflect(one, clsFinal))].filter(Boolean);
  // 去重且保持顺序
  const unique = [];
  for (const part of parts) {
    const key = part.toLowerCase();
    if (!unique.some((one) => one.toLowerCase() === key)) unique.push(part);
  }
  let title = cleanRu(unique.join(' '));
  if (title) title = title.charAt(0).toUpperCase() + title.slice(1);
  if (title.length > MAX_TITLE) title = title.slice(0, MAX_TITLE).replace(/\s+\S*$/, '');

  const dropped = [];
  const noise = sourceTitle.match(NOISE) || [];
  if (noise.length) dropped.push(...new Set(noise));
  const cjkLeft = title.match(/[\u4e00-\u9fa5]/g);
  if (cjkLeft) {
    // 规则里不该出现中文；真出现说明有词没被映射，直接清掉并记录
    dropped.push(...new Set(cjkLeft));
    title = cleanRu(title.replace(/[\u4e00-\u9fa5]+/g, ' '));
  }

  return { title, parts: unique, dropped, category, gender, material };
}
