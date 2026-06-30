export interface OzonCategoryLocalRule {
  productKind: string;
  descriptionCategoryId: number;
  typeId: number;
  pathRu: string[];
  pathZh: string[];
  typeNameRu: string;
  typeNameZh: string;
  keywords: string[];
  excludes: string[];
}

function cleanText(value: unknown): string {
  return String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
}

function normalizeToken(value: unknown): string {
  return cleanText(value).toLowerCase();
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const text = cleanText(value);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

export const OZON_CATEGORY_LOCAL_RULES: OzonCategoryLocalRule[] = [
  {
    productKind: 'cleaning_brush',
    descriptionCategoryId: 17028718,
    typeId: 970869623,
    pathRu: ['Дом и сад', 'Инвентарь для уборки'],
    pathZh: ['家居园艺', '清洁工具'],
    typeNameRu: 'Щетка для уборки',
    typeNameZh: '清洁刷',
    keywords: ['cleaning brush', 'household cleaning brush', '清洁刷', '清洁毛刷', '家用清洁刷'],
    excludes: ['toilet brush', 'interdental brush', 'pet grooming brush', '马桶刷', '牙缝刷', '宠物刷'],
  },
  {
    productKind: 'cotton_swab',
    descriptionCategoryId: 200001242,
    typeId: 93458,
    pathRu: ['Красота и гигиена', 'Ватно-бумажная продукция'],
    pathZh: ['美容卫生', '棉纸用品'],
    typeNameRu: 'Ватные палочки',
    typeNameZh: '棉签',
    keywords: ['cotton swab', 'cotton bud', '棉签', '棉棒', '化妆棉签'],
    excludes: ['pet cotton swab', '宠物棉签'],
  },
  {
    productKind: 'earplug',
    descriptionCategoryId: 52620370,
    typeId: 97330,
    pathRu: ['Аптека', 'Личная гигиена'],
    pathZh: ['药房/健康', '个人卫生'],
    typeNameRu: 'Беруши',
    typeNameZh: '耳塞',
    keywords: ['earplug', 'ear plug', '耳塞', '隔音耳塞'],
    excludes: ['earplug case', '耳塞盒'],
  },
  {
    productKind: 'embroidery_hoop',
    descriptionCategoryId: 17028962,
    typeId: 94513,
    pathRu: ['Хобби и творчество', 'Инструмент для рукоделия'],
    pathZh: ['兴趣手工', '手工工具'],
    typeNameRu: 'Пяльцы',
    typeNameZh: '绣绷',
    keywords: ['embroidery hoop', 'hoop frame', '绣绷', '绣圈', '刺绣绷'],
    excludes: ['earring hoop', '耳环圈'],
  },
  {
    productKind: 'emergency_eyewash',
    descriptionCategoryId: 200001548,
    typeId: 970621839,
    pathRu: ['Аптека', 'Массажеры, коврики, акупунктура'],
    pathZh: ['药房/健康', '按摩/理疗用品'],
    typeNameRu: 'Ванночка глазная',
    typeNameZh: '洗眼杯',
    keywords: ['eyewash', 'eye wash', 'eye bath', 'eye cup', '洗眼杯', '洗眼器', '眼杯'],
    excludes: ['eye drops', 'eye pencil', '眼药水', '眼线笔'],
  },
  {
    productKind: 'fabric_marker_pen',
    descriptionCategoryId: 17029026,
    typeId: 92282,
    pathRu: ['Канцелярские товары', 'Письменные принадлежности'],
    pathZh: ['文具', '书写用品'],
    typeNameRu: 'Мел портновский',
    typeNameZh: '裁缝粉笔',
    keywords: ['tailor chalk', 'fabric marker', 'sewing marker', '裁缝粉笔', '划粉', '布料记号笔'],
    excludes: ['school chalk', 'board chalk', '粉笔', '黑板粉笔'],
  },
  {
    productKind: 'hair_accessory',
    descriptionCategoryId: 29183107,
    typeId: 97574,
    pathRu: ['Галантерея и аксессуары', 'Аксессуары для волос'],
    pathZh: ['箱包配饰', '发饰'],
    typeNameRu: 'Ободок',
    typeNameZh: '发箍',
    keywords: ['hair hoop', 'hair headband', '发箍', '头箍'],
    excludes: ['sports headband', '运动头带'],
  },
  {
    productKind: 'hair_accessory',
    descriptionCategoryId: 29183107,
    typeId: 97575,
    pathRu: ['Галантерея и аксессуары', 'Аксессуары для волос'],
    pathZh: ['箱包配饰', '发饰'],
    typeNameRu: 'Повязка для волос',
    typeNameZh: '发带',
    keywords: ['hair band', 'hair wrap', 'headband', '发带', '头带'],
    excludes: ['sports headband', '运动头带'],
  },
  {
    productKind: 'hair_comb',
    descriptionCategoryId: 29183107,
    typeId: 97572,
    pathRu: ['Галантерея и аксессуары', 'Аксессуары для волос'],
    pathZh: ['箱包配饰', '发饰'],
    typeNameRu: 'Гребень',
    typeNameZh: '发梳',
    keywords: ['hair comb', 'styling comb', '梳子', '发梳'],
    excludes: ['pet comb', 'lice comb', '宠物梳', '虱子梳'],
  },
  {
    productKind: 'hair_comb',
    descriptionCategoryId: 17028985,
    typeId: 93999,
    pathRu: ['Красота и гигиена', 'Инструменты для макияжа, маникюра, бани и солярия'],
    pathZh: ['美容卫生', '美妆美甲沐浴日晒工具'],
    typeNameRu: 'Расческа',
    typeNameZh: '梳子',
    keywords: ['hair comb', 'styling comb', '梳子', '发梳'],
    excludes: ['pet comb', '宠物梳'],
  },
  {
    productKind: 'handbag',
    descriptionCategoryId: 17027904,
    typeId: 970575517,
    pathRu: ['Галантерея и аксессуары', 'Аксессуары'],
    pathZh: ['箱包配饰', '配饰'],
    typeNameRu: 'Сумка',
    typeNameZh: '包',
    keywords: ['handbag', 'purse', 'shoulder bag', 'tote bag', '包', '女包', '手提包', '单肩包', '托特包'],
    excludes: ['laptop bag', 'tool bag', 'thermal bag', '电脑包', '工具包', '保温包'],
  },
  {
    productKind: 'hat',
    descriptionCategoryId: 41777465,
    typeId: 93045,
    pathRu: ['Одежда', 'Аксессуары'],
    pathZh: ['服装', '配饰'],
    typeNameRu: 'Берет',
    typeNameZh: '贝雷帽',
    keywords: ['beret', '贝雷帽'],
    excludes: ['bath cap', 'thermal beauty cap', '浴帽', '电热帽'],
  },
  {
    productKind: 'hat',
    descriptionCategoryId: 41777465,
    typeId: 93093,
    pathRu: ['Одежда', 'Аксессуары'],
    pathZh: ['服装', '配饰'],
    typeNameRu: 'Кепка',
    typeNameZh: '棒球帽',
    keywords: ['cap', 'baseball cap', '棒球帽', '鸭舌帽'],
    excludes: ['vehicle cap', 'capsule', '瓶盖', '胶囊'],
  },
  {
    productKind: 'hat',
    descriptionCategoryId: 41777465,
    typeId: 93258,
    pathRu: ['Одежда', 'Аксессуары'],
    pathZh: ['服装', '配饰'],
    typeNameRu: 'Шапка',
    typeNameZh: '帽子',
    keywords: ['hat', 'beanie', 'winter hat', '帽子', '针织帽', '冷帽'],
    excludes: ['bath cap', 'thermal beauty cap', '浴帽', '电热帽'],
  },
  {
    productKind: 'makeup_bag',
    descriptionCategoryId: 17027904,
    typeId: 93337,
    pathRu: ['Галантерея и аксессуары', 'Аксессуары'],
    pathZh: ['箱包配饰', '配饰'],
    typeNameRu: 'Косметичка',
    typeNameZh: '化妆包',
    keywords: ['makeup bag', 'cosmetic bag', '化妆包', '洗漱包'],
    excludes: ['camera bag', 'pet carrier', 'vacuum bag', '相机包', '宠物包', '真空袋'],
  },
  {
    productKind: 'makeup_sponge',
    descriptionCategoryId: 78021424,
    typeId: 93989,
    pathRu: ['Красота и гигиена', 'Мочалки и спонжи'],
    pathZh: ['美容卫生', '浴擦/海绵'],
    typeNameRu: 'Спонж косметический',
    typeNameZh: '化妆海绵',
    keywords: ['makeup sponge', 'cosmetic sponge', 'beauty blender', '化妆海绵', '美妆蛋'],
    excludes: ['bath sponge', 'face brush', '浴擦', '洗脸刷'],
  },
  {
    productKind: 'plush_toy',
    descriptionCategoryId: 17028973,
    typeId: 92851,
    pathRu: ['Детские товары', 'Игрушки'],
    pathZh: ['儿童用品', '玩具'],
    typeNameRu: 'Мягкая игрушка',
    typeNameZh: '毛绒玩具',
    keywords: ['plush toy', 'stuffed toy', '毛绒玩具', '公仔', '玩偶'],
    excludes: ['baby stimulation toy', '婴儿启蒙玩具'],
  },
  {
    productKind: 'safety_pin',
    descriptionCategoryId: 17028962,
    typeId: 94500,
    pathRu: ['Хобби и творчество', 'Инструмент для рукоделия'],
    pathZh: ['兴趣手工', '手工工具'],
    typeNameRu: 'Булавка',
    typeNameZh: '别针',
    keywords: ['safety pin', 'sewing pin', 'craft pin', '别针', '安全别针'],
    excludes: ['vehicle pin', '汽车插销'],
  },
  {
    productKind: 'seam_ripper',
    descriptionCategoryId: 17028961,
    typeId: 97189,
    pathRu: ['Хобби и творчество', 'Аксессуары для творчества'],
    pathZh: ['兴趣手工', '手工配件'],
    typeNameRu: 'Распарыватель',
    typeNameZh: '拆线器',
    keywords: ['seam ripper', 'stitch ripper', '拆线器'],
    excludes: ['knife', 'letter opener', '刀', '开信刀'],
  },
  {
    productKind: 'shampoo_brush',
    descriptionCategoryId: 30960284,
    typeId: 970983727,
    pathRu: ['Красота и гигиена', 'Массаж'],
    pathZh: ['美容卫生', '按摩'],
    typeNameRu: 'Механический массажер для головы',
    typeNameZh: '头皮按摩器',
    keywords: ['shampoo brush', 'scalp massager', 'head massager', '洗头刷', '头皮按摩器'],
    excludes: ['hair shampoo liquid', 'pet shampoo', '洗发水', '宠物香波'],
  },
  {
    productKind: 'sleep_mask',
    descriptionCategoryId: 17027904,
    typeId: 94295,
    pathRu: ['Галантерея и аксессуары', 'Аксессуары'],
    pathZh: ['箱包配饰', '配饰'],
    typeNameRu: 'Маска для сна',
    typeNameZh: '睡眠眼罩',
    keywords: ['sleep mask', 'eye mask', '睡眠眼罩', '眼罩'],
    excludes: ['safety goggles', '护目镜'],
  },
  {
    productKind: 'soap_sheet',
    descriptionCategoryId: 17028983,
    typeId: 93482,
    pathRu: ['Красота и гигиена', 'Средства для гигиены тела'],
    pathZh: ['美容卫生', '身体清洁用品'],
    typeNameRu: 'Твердое мыло',
    typeNameZh: '固体皂',
    keywords: ['paper soap', 'soap sheet', 'soap leaves', 'solid soap', '纸香皂', '香皂片', '固体皂'],
    excludes: ['liquid soap', 'pet soap', 'soap making', '洗手液', '宠物皂', '手工皂原料'],
  },
  {
    productKind: 'storage_box',
    descriptionCategoryId: 17027937,
    typeId: 95482,
    pathRu: ['Дом и сад', 'Хранение вещей'],
    pathZh: ['家居园艺', '物品收纳'],
    typeNameRu: 'Коробка для хранения',
    typeNameZh: '收纳盒',
    keywords: ['storage box', 'organizer box', '收纳盒', '整理盒'],
    excludes: ['car organizer', 'tool organizer', 'cable organizer', '车载收纳', '工具收纳', '线缆收纳'],
  },
  {
    productKind: 'storage_box',
    descriptionCategoryId: 17027937,
    typeId: 970896147,
    pathRu: ['Дом и сад', 'Хранение вещей'],
    pathZh: ['家居园艺', '物品收纳'],
    typeNameRu: 'Органайзер для хранения вещей',
    typeNameZh: '收纳整理盒',
    keywords: ['storage organizer', 'organizer for things', '收纳盒', '整理盒', '收纳整理盒'],
    excludes: ['car organizer', 'tool organizer', 'cable organizer', '车载收纳', '工具收纳', '线缆收纳'],
  },
  {
    productKind: 'tailoring_ruler',
    descriptionCategoryId: 200001635,
    typeId: 93298,
    pathRu: ['Канцелярские товары', 'Чертежные принадлежности'],
    pathZh: ['文具', '绘图用品'],
    typeNameRu: 'Линейка',
    typeNameZh: '尺子',
    keywords: ['tailoring ruler', 'sewing ruler', 'tailor ruler', '裁缝尺', '打版尺', '尺子'],
    excludes: ['construction ruler', '工程尺'],
  },
  {
    productKind: 'threader',
    descriptionCategoryId: 17028961,
    typeId: 98201,
    pathRu: ['Хобби и творчество', 'Аксессуары для творчества'],
    pathZh: ['兴趣手工', '手工配件'],
    typeNameRu: 'Нитевдеватель',
    typeNameZh: '穿针器',
    keywords: ['needle threader', '穿针器', '引线器'],
    excludes: ['elastic bodkin', '松紧带穿带器'],
  },
  {
    productKind: 'toilet_seat_cover',
    descriptionCategoryId: 200001242,
    typeId: 970713340,
    pathRu: ['Красота и гигиена', 'Ватно-бумажная продукция'],
    pathZh: ['美容卫生', '棉纸用品'],
    typeNameRu: 'Покрытие на сиденье унитаза',
    typeNameZh: '马桶坐垫纸',
    keywords: ['toilet seat cover', 'toilet seat pad', '马桶坐垫纸', '一次性坐垫纸', '马桶垫'],
    excludes: ['toilet brush', '马桶刷'],
  },
  {
    productKind: 'wall_hook',
    descriptionCategoryId: 17027908,
    typeId: 93676,
    pathRu: ['Дом и сад', 'Вешалки для одежды'],
    pathZh: ['家居园艺', '衣架挂钩'],
    typeNameRu: 'Крючок для дома',
    typeNameZh: '家用挂钩',
    keywords: ['wall hook', 'home hook', 'adhesive hook', '挂钩', '粘钩', '免打孔挂钩', '家用挂钩'],
    excludes: ['fishing hook', 'tow hook', 'hookah', '鱼钩', '拖车钩', '水烟'],
  },
  {
    productKind: 'wall_hook',
    descriptionCategoryId: 53884411,
    typeId: 94527,
    pathRu: ['Мебель', 'Мебельная фурнитура и комплектующие'],
    pathZh: ['家具', '家具五金配件'],
    typeNameRu: 'Крючок мебельный',
    typeNameZh: '家具挂钩',
    keywords: ['furniture hook', 'wall hook', 'coat hook', '家具挂钩', '衣帽钩', '挂钩'],
    excludes: ['fishing hook', 'tow hook', 'hookah', '鱼钩', '拖车钩', '水烟'],
  },
];

const RULES_BY_TARGET = new Map(
  OZON_CATEGORY_LOCAL_RULES.map((rule) => [`${rule.descriptionCategoryId}:${rule.typeId}`, rule]),
);

const TRANSLATION_BY_TERM = new Map<string, string>();
for (const rule of OZON_CATEGORY_LOCAL_RULES) {
  rule.pathRu.forEach((term, index) => {
    const translated = rule.pathZh[index];
    if (translated) TRANSLATION_BY_TERM.set(normalizeToken(term), translated);
  });
  TRANSLATION_BY_TERM.set(normalizeToken(rule.typeNameRu), rule.typeNameZh);
}

function buildExpansionBuckets(kind: 'keywords' | 'excludes'): Map<string, Array<{ trigger: string; terms: string[] }>> {
  const buckets = new Map<string, Array<{ trigger: string; terms: string[] }>>();
  for (const rule of OZON_CATEGORY_LOCAL_RULES) {
    const positiveTerms = unique([
      ...rule.pathRu,
      ...rule.pathZh,
      rule.typeNameRu,
      rule.typeNameZh,
      ...rule.keywords,
    ]);
    const terms = kind === 'keywords' ? positiveTerms : unique(rule.excludes);
    const triggers = kind === 'keywords'
      ? unique([rule.typeNameRu, rule.typeNameZh, ...rule.keywords])
      : unique(rule.excludes);
    for (const triggerText of triggers) {
      const trigger = normalizeToken(triggerText);
      const first = Array.from(trigger)[0];
      if (!trigger || !first) continue;
      const rows = buckets.get(first) || [];
      rows.push({ trigger, terms });
      buckets.set(first, rows);
    }
  }
  return buckets;
}

const KEYWORD_BUCKETS = buildExpansionBuckets('keywords');
const EXCLUDE_BUCKETS = buildExpansionBuckets('excludes');

function expandFromBuckets(parts: string[], buckets: Map<string, Array<{ trigger: string; terms: string[] }>>): string[] {
  const text = normalizeToken(parts.join(' '));
  if (!text) return [];
  const chars = new Set(Array.from(text));
  const out: string[] = [];
  for (const char of chars) {
    const rows = buckets.get(char);
    if (!rows) continue;
    for (const row of rows) {
      if (text.includes(row.trigger)) out.push(...row.terms);
    }
  }
  return unique(out);
}

export function getOzonCategoryLocalTranslation(value: unknown): string {
  return TRANSLATION_BY_TERM.get(normalizeToken(value)) || '';
}

export function getOzonCategoryLocalKeywordExpansions(parts: string[]): string[] {
  return expandFromBuckets(parts, KEYWORD_BUCKETS);
}

export function getOzonCategoryLocalExcludeExpansions(parts: string[]): string[] {
  return expandFromBuckets(parts, EXCLUDE_BUCKETS);
}

export function getOzonCategoryLocalSearchTermsForTarget(
  descriptionCategoryId: number,
  typeId: number,
): { keywords: string[]; excludes: string[] } {
  const rule = RULES_BY_TARGET.get(`${descriptionCategoryId}:${typeId}`);
  if (!rule) return { keywords: [], excludes: [] };
  return {
    keywords: unique([
      ...rule.pathRu,
      ...rule.pathZh,
      rule.typeNameRu,
      rule.typeNameZh,
      ...rule.keywords,
    ]),
    excludes: unique(rule.excludes),
  };
}

export function getOzonCategoryLocalRuleStats(): { ozonConfirmedTargetCount: number; productKindCount: number } {
  return {
    ozonConfirmedTargetCount: OZON_CATEGORY_LOCAL_RULES.length,
    productKindCount: new Set(OZON_CATEGORY_LOCAL_RULES.map((rule) => rule.productKind)).size,
  };
}
