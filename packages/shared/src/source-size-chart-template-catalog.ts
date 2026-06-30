export type BuiltInSizeChartTemplateKey =
  | 'bra'
  | 'jeans'
  | 'shoes_men'
  | 'shoes_women'
  | 'socks'
  | 'children_hats'
  | 'children_socks'
  | 'children_gloves'
  | 'children_tights'
  | 'apparel_mens'
  | 'apparel_children'
  | 'apparel_underwear'
  | 'apparel_sleepwear'
  | 'apparel_general';

export type BuiltInSizeChartMappingProfile =
  | 'women_apparel'
  | 'men_apparel'
  | 'children_apparel'
  | 'underwear'
  | 'bra'
  | 'jeans'
  | 'men_shoes'
  | 'women_shoes'
  | 'socks'
  | 'children_hats'
  | 'children_socks'
  | 'children_gloves'
  | 'children_tights';

export interface BuiltInSizeChartTemplate {
  key: BuiltInSizeChartTemplateKey;
  label: string;
  profile: BuiltInSizeChartMappingProfile;
  confidence: 'strong' | 'weak';
  patterns: RegExp[];
}

export interface BuiltInSizeChartRow {
  size: string;
  ruSize?: string;
  intSize?: string;
  footLengthCm?: string;
  note?: string;
  [key: string]: string | undefined;
}

export const BUILT_IN_SIZE_CHART_TEMPLATES: BuiltInSizeChartTemplate[] = [
  {
    key: 'bra',
    label: '文胸富内容模板',
    profile: 'bra',
    confidence: 'strong',
    patterns: [/文胸|胸罩|bra|бюстгальтер/i],
  },
  {
    key: 'jeans',
    label: '牛仔裤尺码模板',
    profile: 'jeans',
    confidence: 'strong',
    patterns: [/牛仔裤|jeans?|джинс/i],
  },
  {
    key: 'children_hats',
    label: '儿童帽子尺码模板',
    profile: 'children_hats',
    confidence: 'strong',
    patterns: [/儿童帽|宝宝帽|婴儿帽|童帽|детск[а-я\s-]*шап/i],
  },
  {
    key: 'children_socks',
    label: '儿童袜子尺码模板',
    profile: 'children_socks',
    confidence: 'strong',
    patterns: [/儿童袜|宝宝袜|婴儿袜|童袜|детск[а-я\s-]*носк/i],
  },
  {
    key: 'children_gloves',
    label: '儿童手套尺码模板',
    profile: 'children_gloves',
    confidence: 'strong',
    patterns: [/儿童手套|宝宝手套|童手套|детск[а-я\s-]*(?:перчат|вареж)/i],
  },
  {
    key: 'children_tights',
    label: '儿童紧身衣/连裤袜尺码模板',
    profile: 'children_tights',
    confidence: 'strong',
    patterns: [/儿童紧身衣|儿童连裤袜|宝宝连裤袜|童裤袜|детск[а-я\s-]*колгот/i],
  },
  {
    key: 'socks',
    label: '袜子/丝袜富内容模板',
    profile: 'socks',
    confidence: 'strong',
    patterns: [/袜|袜子|丝袜|短袜|长袜|socks?|носк|колгот/i],
  },
  {
    key: 'shoes_men',
    label: '男鞋富内容模板',
    profile: 'men_shoes',
    confidence: 'strong',
    patterns: [/男鞋|男士鞋|男款鞋|мужск[а-я\s-]*обув|обув[а-я\s-]*муж/i],
  },
  {
    key: 'shoes_women',
    label: '女鞋富内容模板',
    profile: 'women_shoes',
    confidence: 'strong',
    patterns: [/女鞋|单鞋|凉鞋|拖鞋|靴|鞋|shoe|обув/i],
  },
  {
    key: 'apparel_underwear',
    label: '内衣富内容模板',
    profile: 'underwear',
    confidence: 'strong',
    patterns: [/内衣|内裤|трус/i],
  },
  {
    key: 'apparel_children',
    label: '童装富内容模板',
    profile: 'children_apparel',
    confidence: 'strong',
    patterns: [/童装|儿童|宝宝|婴儿|男童|女童|детск|реб[её]н/i],
  },
  {
    key: 'apparel_mens',
    label: '男装富内容模板',
    profile: 'men_apparel',
    confidence: 'strong',
    patterns: [/男装|男士|男款|мужск/i],
  },
  {
    key: 'apparel_sleepwear',
    label: '睡衣/睡裙富内容模板',
    profile: 'women_apparel',
    confidence: 'strong',
    patterns: [/睡裙|睡衣|家居服|ночная\s*сорочка|пижам/i],
  },
  {
    key: 'apparel_general',
    label: '服装通用富内容模板',
    profile: 'women_apparel',
    confidence: 'weak',
    patterns: [/服装|女装|男装|童装|连衣裙|上衣|裤|юбк|плать|одежд/i],
  },
];

const WOMEN_APPAREL_RU: Record<string, string> = {
  XS: '40',
  S: '42',
  M: '44',
  L: '46',
  XL: '48',
  XXL: '50',
  '2XL': '50',
  XXXL: '52',
  '3XL': '52',
};

const MEN_APPAREL_RU: Record<string, string> = {
  XS: '42',
  S: '44',
  M: '46',
  L: '48',
  XL: '50',
  XXL: '52',
  '2XL': '52',
  XXXL: '54',
  '3XL': '54',
  XXXXL: '56',
  '4XL': '56',
  XXXXXL: '58',
  '5XL': '58',
};

const UNDERWEAR_RU: Record<string, string> = {
  XS: '40',
  S: '42',
  M: '44',
  L: '46',
  XL: '48',
  XXL: '50',
  '2XL': '50',
  XXXL: '52',
  '3XL': '52',
};

const CHILDREN_HEIGHT_RU = new Set([
  '70', '74', '80', '86', '90', '92', '98', '100', '104', '110', '116', '120', '122',
  '128', '130', '134', '140', '146', '150', '152', '158', '160', '164',
]);

const WOMEN_SHOE_FOOT_LENGTH: Record<string, string> = {
  '34': '22',
  '35': '22.5',
  '36': '23',
  '37': '23.5',
  '38': '24',
  '39': '24.5',
  '40': '25',
  '41': '25.5',
  '42': '26',
};

const MEN_SHOE_FOOT_LENGTH: Record<string, string> = {
  '39': '24.5',
  '40': '25',
  '41': '25.5',
  '42': '26',
  '43': '26.5',
  '44': '27',
  '45': '27.5',
  '46': '28',
  '47': '28.5',
};

const JEANS_WAIST_RU: Record<string, { ruSize: string; waistCm: string }> = {
  W23: { ruSize: '38', waistCm: '58-59' },
  W24: { ruSize: '38', waistCm: '60-62' },
  W25: { ruSize: '40', waistCm: '63-64' },
  W26: { ruSize: '42', waistCm: '65-67' },
  W27: { ruSize: '42-44', waistCm: '68-69' },
  W28: { ruSize: '44', waistCm: '70-72' },
  W29: { ruSize: '44-46', waistCm: '73-74' },
  W30: { ruSize: '46', waistCm: '75-78' },
  W31: { ruSize: '48', waistCm: '79-82' },
  W32: { ruSize: '50', waistCm: '83-86' },
};

const CHILDREN_HATS: Record<string, { heightCm: string; age: string }> = {
  '35': { heightCm: '50-54', age: '新生' },
  '40': { heightCm: '56-62', age: '3个月' },
  '44': { heightCm: '62-68', age: '6个月' },
  '46': { heightCm: '68-74', age: '9个月' },
  '47': { heightCm: '74-80', age: '12个月' },
  '48': { heightCm: '80-86', age: '1.5年' },
  '49': { heightCm: '86-92', age: '2年' },
};

const CHILDREN_SOCKS: Record<string, { footLengthCm: string; ruSize: string }> = {
  '16-17': { footLengthCm: '9-9.7', ruSize: '10' },
  '18-19': { footLengthCm: '10.4-11.6', ruSize: '12' },
  '20-23': { footLengthCm: '12.2-14.2', ruSize: '14' },
  '24-25': { footLengthCm: '14.2-16.2', ruSize: '16' },
  '26-27': { footLengthCm: '16.9-18.3', ruSize: '18' },
  '28-32': { footLengthCm: '19-20.4', ruSize: '20' },
  '33-35': { footLengthCm: '20.4-22.5', ruSize: '22' },
};

const CHILDREN_GLOVES: Record<string, { age: string; heightCm: string; palmCircumferenceCm: string; intSize: string }> = {
  '0': { age: '6-12个月', heightCm: '74-80', palmCircumferenceCm: '11', intSize: 'XXS' },
  '1': { age: '1-2年', heightCm: '86-92', palmCircumferenceCm: '12', intSize: 'XS' },
  '2': { age: '2-3年', heightCm: '98-104', palmCircumferenceCm: '13', intSize: 'XS' },
  '3': { age: '4-6年', heightCm: '110-116', palmCircumferenceCm: '14', intSize: 'S' },
  '4': { age: '7-8岁', heightCm: '122-128', palmCircumferenceCm: '15', intSize: 'S' },
  '5': { age: '9-10岁', heightCm: '134-140', palmCircumferenceCm: '16', intSize: 'M' },
};

const CHILDREN_TIGHTS: Record<string, { age: string; heightCm: string; trackLengthCm: string }> = {
  '01S': { age: '6个月', heightCm: '68', trackLengthCm: '12' },
  '02S': { age: '9个月', heightCm: '74', trackLengthCm: '12-14' },
  '03S': { age: '12个月', heightCm: '80', trackLengthCm: '14' },
  '04S': { age: '18个月', heightCm: '86', trackLengthCm: '14-16' },
};

function sizeKey(value: string): string {
  return value.replace(/^(\d)\s*XL$/i, '$1XL').toUpperCase();
}

export function matchBuiltInSizeChartTemplate(context: string): BuiltInSizeChartTemplate | null {
  return BUILT_IN_SIZE_CHART_TEMPLATES.find((template) => template.patterns.some((pattern) => pattern.test(context))) || null;
}

export function getBuiltInSizeChartTemplateByKey(key: BuiltInSizeChartTemplateKey): BuiltInSizeChartTemplate | null {
  return BUILT_IN_SIZE_CHART_TEMPLATES.find((template) => template.key === key) || null;
}

export function buildBuiltInSizeChartRows(
  sizes: string[],
  profile: BuiltInSizeChartMappingProfile,
): { columns: string[]; rows: BuiltInSizeChartRow[] } {
  const rows: BuiltInSizeChartRow[] = [];
  if (profile === 'women_shoes' || profile === 'men_shoes') {
    const footLengthTable = profile === 'men_shoes' ? MEN_SHOE_FOOT_LENGTH : WOMEN_SHOE_FOOT_LENGTH;
    for (const size of sizes) {
      const numeric = size.replace(',', '.').match(/\d{2}(?:\.\d)?/)?.[0] || '';
      if (!numeric) continue;
      rows.push({ size: numeric, ruSize: numeric, footLengthCm: footLengthTable[numeric] || '' });
    }
    return { columns: ['尺码', '俄罗斯尺码', '脚长(cm)'], rows };
  }

  if (profile === 'jeans') {
    for (const size of sizes) {
      const normalized = size.toUpperCase();
      const waist = normalized.match(/W\s*(\d{2})/)?.[1];
      const length = normalized.match(/L\s*(\d{2})/)?.[1];
      if (!waist) continue;
      const key = `W${waist}`;
      const mapped = JEANS_WAIST_RU[key];
      if (!mapped) continue;
      rows.push({
        size: length ? `${key}/L${length}` : key,
        ruSize: mapped.ruSize,
        '腰围(cm)': mapped.waistCm,
        '牛仔裤尺码': key,
        note: length ? `长度 L${length}` : '',
      });
    }
    return { columns: ['尺码', '俄罗斯尺码', '腰围(cm)', '牛仔裤尺码', '说明'], rows };
  }

  if (profile === 'children_hats') {
    for (const size of sizes) {
      const numeric = size.match(/\d{2}/)?.[0] || '';
      const mapped = CHILDREN_HATS[numeric];
      if (!mapped) continue;
      rows.push({ size: numeric, ruSize: numeric, '头围(cm)': numeric, '身高(cm)': mapped.heightCm, '年龄': mapped.age });
    }
    return { columns: ['尺码', '俄罗斯尺码', '头围(cm)', '身高(cm)', '年龄'], rows };
  }

  if (profile === 'children_socks') {
    for (const size of sizes) {
      const range = size.match(/^(\d{2})-(\d{2})$/);
      if (!range?.[1] || !range?.[2]) continue;
      const value = `${range[1]}-${range[2]}`;
      const mapped = CHILDREN_SOCKS[value];
      if (!mapped) continue;
      rows.push({ size: value, ruSize: mapped.ruSize, '脚长(cm)': mapped.footLengthCm, '鞋码范围': value });
    }
    return { columns: ['尺码', '俄罗斯尺码', '脚长(cm)', '鞋码范围'], rows };
  }

  if (profile === 'children_gloves') {
    for (const size of sizes) {
      const numeric = size.match(/\d/)?.[0] || '';
      const mapped = CHILDREN_GLOVES[numeric];
      if (!mapped) continue;
      rows.push({
        size: numeric,
        ruSize: numeric,
        intSize: mapped.intSize,
        '年龄': mapped.age,
        '身高(cm)': mapped.heightCm,
        '手掌周长(cm)': mapped.palmCircumferenceCm,
        '国际尺码': mapped.intSize,
      });
    }
    return { columns: ['尺码', '俄罗斯尺码', '国际尺码', '年龄', '身高(cm)', '手掌周长(cm)'], rows };
  }

  if (profile === 'children_tights') {
    for (const size of sizes) {
      const key = size.toUpperCase();
      const mapped = CHILDREN_TIGHTS[key];
      if (!mapped) continue;
      rows.push({
        size: key,
        ruSize: key,
        '年龄': mapped.age,
        '身高(cm)': mapped.heightCm,
        '轨道长度(cm)': mapped.trackLengthCm,
      });
    }
    return { columns: ['尺码', '俄罗斯尺码', '年龄', '身高(cm)', '轨道长度(cm)'], rows };
  }

  if (profile === 'children_apparel') {
    for (const size of sizes) {
      const height = size.match(/\d{2,3}/)?.[0] || '';
      if (!height || !CHILDREN_HEIGHT_RU.has(height)) continue;
      rows.push({ size: height, ruSize: height, note: '童装身高尺码' });
    }
    return { columns: ['尺码', '俄罗斯尺码', '说明'], rows };
  }

  if (profile === 'socks') {
    for (const size of sizes) {
      const range = size.match(/^(\d{2})-(\d{2})$/);
      if (!range?.[1] || !range?.[2]) continue;
      const value = `${range[1]}-${range[2]}`;
      rows.push({ size: value, ruSize: value, note: '按鞋码范围选择' });
    }
    return { columns: ['尺码', '俄罗斯尺码', '说明'], rows };
  }

  if (profile === 'bra') {
    for (const size of sizes) {
      if (!/^\d{2,3}[A-ZА-Я]{1,3}$/i.test(size)) continue;
      rows.push({ size, ruSize: size, note: '保留文胸围度/杯型体系' });
    }
    return { columns: ['尺码', '俄罗斯尺码', '说明'], rows };
  }

  const table = profile === 'underwear'
    ? UNDERWEAR_RU
    : profile === 'men_apparel'
      ? MEN_APPAREL_RU
      : WOMEN_APPAREL_RU;
  for (const size of sizes) {
    const key = sizeKey(size);
    const ruSize = table[key];
    if (!ruSize) continue;
    rows.push({ size: key, ruSize, intSize: key });
  }
  return { columns: ['尺码', '俄罗斯尺码', '国际尺码'], rows };
}
