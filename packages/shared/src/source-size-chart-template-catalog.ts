import { buildOzonSizeChartRows } from './ozon-size-chart-template-catalog';

export type BuiltInSizeChartTemplateKey =
  | 'bra'
  | 'jeans'
  | 'shoes_children'
  | 'shoes_men'
  | 'shoes_women'
  | 'shoe_fullness'
  | 'socks'
  | 'socks_adult'
  | 'adult_tights'
  | 'adult_hats'
  | 'rings'
  | 'bracelets'
  | 'necklaces'
  | 'helmets_hats'
  | 'sports_gloves'
  | 'gloves_women'
  | 'gloves_men'
  | 'football_shields'
  | 'knee_pads'
  | 'skates_women'
  | 'skates_men'
  | 'game_masks'
  | 'diving_boots'
  | 'wetsuits'
  | 'cycling_clothing'
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
  | 'children_shoes'
  | 'men_shoes'
  | 'women_shoes'
  | 'shoe_fullness'
  | 'socks'
  | 'adult_socks'
  | 'adult_tights'
  | 'adult_hats'
  | 'rings'
  | 'bracelets'
  | 'necklaces'
  | 'helmets_hats'
  | 'sports_gloves'
  | 'women_gloves'
  | 'men_gloves'
  | 'football_shields'
  | 'knee_pads'
  | 'women_skates'
  | 'men_skates'
  | 'game_masks'
  | 'diving_boots'
  | 'wetsuits'
  | 'cycling_clothing'
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

export interface BuiltInSizeChartBuildResult {
  columns: string[];
  rows: BuiltInSizeChartRow[];
  tableTitle?: string;
  source?: 'ozon_template' | 'built_in';
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
    key: 'adult_hats',
    label: '成人帽子尺码模板',
    profile: 'adult_hats',
    confidence: 'strong',
    patterns: [/成人帽|棒球帽|遮阳帽|渔夫帽|шапк|головн[а-я\s-]*убор/i],
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
    key: 'shoes_children',
    label: '童鞋尺码模板',
    profile: 'children_shoes',
    confidence: 'strong',
    patterns: [/童鞋|儿童鞋|宝宝鞋|婴儿鞋|детск[а-я\s-]*обув/i],
  },
  {
    key: 'socks_adult',
    label: '成人袜子尺码模板',
    profile: 'adult_socks',
    confidence: 'strong',
    patterns: [/成人袜|男袜|女袜|носки\s*взрос/i],
  },
  {
    key: 'adult_tights',
    label: '成人连裤袜尺码模板',
    profile: 'adult_tights',
    confidence: 'strong',
    patterns: [/成人连裤袜|连裤袜成人|连裤袜|колгот/i],
  },
  {
    key: 'socks',
    label: '袜子/丝袜富内容模板',
    profile: 'socks',
    confidence: 'strong',
    patterns: [/袜|袜子|丝袜|短袜|长袜|socks?|носк|колгот/i],
  },
  {
    key: 'shoe_fullness',
    label: '鞋子丰满度尺码模板',
    profile: 'shoe_fullness',
    confidence: 'strong',
    patterns: [/鞋子的丰满度|鞋宽|脚宽|полнот[аы]\s*обув/i],
  },
  {
    key: 'shoes_men',
    label: '男鞋富内容模板',
    profile: 'men_shoes',
    confidence: 'strong',
    patterns: [/男鞋|男士鞋|男款鞋|мужск[а-я\s-]*обув|обув[а-я\s-]*муж/i],
  },
  {
    key: 'skates_women',
    label: '女子溜冰鞋尺码模板',
    profile: 'women_skates',
    confidence: 'strong',
    patterns: [/女子溜冰鞋|女士溜冰鞋|女款溜冰鞋/i],
  },
  {
    key: 'skates_men',
    label: '男子溜冰鞋尺码模板',
    profile: 'men_skates',
    confidence: 'strong',
    patterns: [/男子溜冰鞋|男士溜冰鞋|男款溜冰鞋/i],
  },
  {
    key: 'diving_boots',
    label: '潜水靴尺码模板',
    profile: 'diving_boots',
    confidence: 'strong',
    patterns: [/潜水靴|潜水鞋|涉水鞋|diving\s*boots?/i],
  },
  {
    key: 'shoes_women',
    label: '女鞋富内容模板',
    profile: 'women_shoes',
    confidence: 'strong',
    patterns: [/女鞋|单鞋|凉鞋|拖鞋|靴|鞋|shoe|обув/i],
  },
  {
    key: 'wetsuits',
    label: '潜水服尺码模板',
    profile: 'wetsuits',
    confidence: 'strong',
    patterns: [/潜水服|wetsuits?/i],
  },
  {
    key: 'cycling_clothing',
    label: '自行车服装尺码模板',
    profile: 'cycling_clothing',
    confidence: 'strong',
    patterns: [/自行车服|骑行服|cycling/i],
  },
  {
    key: 'rings',
    label: '戒指尺码模板',
    profile: 'rings',
    confidence: 'strong',
    patterns: [/戒指|指环|ring/i],
  },
  {
    key: 'bracelets',
    label: '手镯尺码模板',
    profile: 'bracelets',
    confidence: 'strong',
    patterns: [/手镯|手链|bracelet/i],
  },
  {
    key: 'necklaces',
    label: '项链尺码模板',
    profile: 'necklaces',
    confidence: 'strong',
    patterns: [/项链|necklace/i],
  },
  {
    key: 'helmets_hats',
    label: '安全帽/帽子尺码模板',
    profile: 'helmets_hats',
    confidence: 'strong',
    patterns: [/安全帽|头盔|helmet/i],
  },
  {
    key: 'sports_gloves',
    label: '运动手套尺码模板',
    profile: 'sports_gloves',
    confidence: 'strong',
    patterns: [/运动手套|健身手套|sports?\s*gloves?/i],
  },
  {
    key: 'gloves_women',
    label: '女士手套尺码模板',
    profile: 'women_gloves',
    confidence: 'strong',
    patterns: [/女士手套|女款手套/i],
  },
  {
    key: 'gloves_men',
    label: '男士手套尺码模板',
    profile: 'men_gloves',
    confidence: 'strong',
    patterns: [/男士手套|男款手套/i],
  },
  {
    key: 'football_shields',
    label: '足球护板尺码模板',
    profile: 'football_shields',
    confidence: 'strong',
    patterns: [/足球板|足球护板|护腿板|shin\s*guard/i],
  },
  {
    key: 'knee_pads',
    label: '护膝尺码模板',
    profile: 'knee_pads',
    confidence: 'strong',
    patterns: [/护膝|knee\s*pads?/i],
  },
  {
    key: 'game_masks',
    label: '游戏面罩尺码模板',
    profile: 'game_masks',
    confidence: 'strong',
    patterns: [/游戏面罩|面罩|mask/i],
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

const ADULT_HATS: Record<string, { headCircumferenceCm: string }> = {
  XXS: { headCircumferenceCm: '52-53' },
  XS: { headCircumferenceCm: '54-55' },
  S: { headCircumferenceCm: '56-57' },
  M: { headCircumferenceCm: '58-59' },
  L: { headCircumferenceCm: '60-61' },
  XL: { headCircumferenceCm: '62-63' },
  XXL: { headCircumferenceCm: '64-65' },
};

const CHILDREN_SHOES: Record<string, { footLengthCm: string; insoleLengthCm: string; euSize: string }> = {
  '16': { footLengthCm: '9.5', insoleLengthCm: '10', euSize: '16.5' },
  '16.5': { footLengthCm: '10', insoleLengthCm: '10.5', euSize: '17' },
  '17': { footLengthCm: '10.5', insoleLengthCm: '11', euSize: '18' },
  '18': { footLengthCm: '11', insoleLengthCm: '11.5', euSize: '19' },
  '19': { footLengthCm: '11.5', insoleLengthCm: '12', euSize: '19.5' },
  '19.5': { footLengthCm: '12', insoleLengthCm: '12.5', euSize: '20' },
  '20': { footLengthCm: '12.5', insoleLengthCm: '13', euSize: '21' },
  '21': { footLengthCm: '13', insoleLengthCm: '13.5', euSize: '22' },
  '22': { footLengthCm: '13.5', insoleLengthCm: '14', euSize: '22.5' },
  '23': { footLengthCm: '14.5', insoleLengthCm: '15', euSize: '24' },
  '24': { footLengthCm: '15', insoleLengthCm: '15.5', euSize: '25' },
  '25': { footLengthCm: '15.5', insoleLengthCm: '16', euSize: '25.5' },
  '26': { footLengthCm: '16.5', insoleLengthCm: '17', euSize: '27' },
  '27': { footLengthCm: '17', insoleLengthCm: '17.5', euSize: '28' },
  '28': { footLengthCm: '17.5', insoleLengthCm: '18', euSize: '28.5' },
  '29': { footLengthCm: '18.5', insoleLengthCm: '19', euSize: '30' },
  '30': { footLengthCm: '19', insoleLengthCm: '19.5', euSize: '31' },
  '31': { footLengthCm: '19.5', insoleLengthCm: '20', euSize: '31.5' },
  '32': { footLengthCm: '20.5', insoleLengthCm: '21', euSize: '33' },
  '33': { footLengthCm: '21', insoleLengthCm: '21.5', euSize: '34' },
  '34': { footLengthCm: '21.5', insoleLengthCm: '22', euSize: '34.5' },
  '35': { footLengthCm: '22.5', insoleLengthCm: '23', euSize: '36' },
  '36': { footLengthCm: '23', insoleLengthCm: '23.5', euSize: '37' },
  '37': { footLengthCm: '23.5', insoleLengthCm: '24', euSize: '38' },
};

const ADULT_SOCKS: Record<string, { footLengthCm: string; shoeSize: string; intSize: string }> = {
  '21': { footLengthCm: '20.4-21.8', shoeSize: '35-36', intSize: 'S' },
  '23': { footLengthCm: '21.8-23.8', shoeSize: '37-38', intSize: 'S' },
  '25': { footLengthCm: '23.8-25.9', shoeSize: '39-40', intSize: 'M' },
  '27': { footLengthCm: '25.9-28.0', shoeSize: '41-42', intSize: 'L' },
  '29': { footLengthCm: '28.0-30.5', shoeSize: '43-44', intSize: 'XL' },
  '31': { footLengthCm: '30.5-32.5', shoeSize: '45-46', intSize: 'XXL' },
  '33': { footLengthCm: '32.5-35.0', shoeSize: '47-48', intSize: 'XXL' },
};

const RINGS: Record<string, { circumferenceMm: string }> = {
  '15': { circumferenceMm: '48' },
  '15.5': { circumferenceMm: '49' },
  '16': { circumferenceMm: '50' },
  '16.5': { circumferenceMm: '52' },
  '17': { circumferenceMm: '53' },
  '17.5': { circumferenceMm: '55' },
  '18': { circumferenceMm: '57' },
  '18.5': { circumferenceMm: '59' },
  '19': { circumferenceMm: '60' },
  '20': { circumferenceMm: '63' },
  '21': { circumferenceMm: '65' },
  '22': { circumferenceMm: '69' },
};

const BRACELETS: Record<string, { wristCircumferenceCm: string }> = {
  '16': { wristCircumferenceCm: '14-15.5' },
  '17': { wristCircumferenceCm: '15.5-16' },
  '18': { wristCircumferenceCm: '16-17' },
  '19': { wristCircumferenceCm: '17-18' },
  '20': { wristCircumferenceCm: '18-19' },
  '21': { wristCircumferenceCm: '19-20' },
  '22': { wristCircumferenceCm: '20-21' },
};

const NECKLACES: Record<string, { inches: string }> = {
  '35': { inches: '14' },
  '40': { inches: '16' },
  '45': { inches: '18' },
  '50': { inches: '20' },
  '55': { inches: '22' },
  '60': { inches: '24' },
  '65': { inches: '26' },
};

const KNEE_PADS: Record<string, { aboveKneeCm: string }> = {
  M: { aboveKneeCm: '35-40' },
  L: { aboveKneeCm: '40-45' },
  XL: { aboveKneeCm: '45-50' },
  XXL: { aboveKneeCm: '50-55' },
};

const DIVING_BOOTS: Record<string, { usSize: string; euSize: string; footLengthCm: string }> = {
  XXS: { usSize: '4', euSize: '36', footLengthCm: '22' },
  XS: { usSize: '5', euSize: '37', footLengthCm: '23' },
  S: { usSize: '6', euSize: '38', footLengthCm: '24' },
  'S/M': { usSize: '7', euSize: '39', footLengthCm: '25' },
  M: { usSize: '8', euSize: '41', footLengthCm: '26' },
  L: { usSize: '9', euSize: '42', footLengthCm: '27' },
  XL: { usSize: '10', euSize: '43', footLengthCm: '28' },
  XXL: { usSize: '11', euSize: '44', footLengthCm: '29' },
  XXXL: { usSize: '12', euSize: '46', footLengthCm: '30' },
  '4XL': { usSize: '13', euSize: '47', footLengthCm: '31' },
};

const WETSUITS: Record<string, { euSize: string; chestCm: string; waistCm: string; hipCm: string; heightCm: string }> = {
  XS: { euSize: '36', chestCm: '84', waistCm: '72', hipCm: '84', heightCm: '166-170' },
  S: { euSize: '38', chestCm: '92', waistCm: '78', hipCm: '90', heightCm: '171-175' },
  M: { euSize: '40', chestCm: '100', waistCm: '84', hipCm: '96', heightCm: '176-180' },
  L: { euSize: '42/44', chestCm: '108', waistCm: '90', hipCm: '102', heightCm: '181-185' },
  XL: { euSize: '46/48', chestCm: '116', waistCm: '96', hipCm: '108', heightCm: '186-190' },
  XXL: { euSize: '50/52', chestCm: '124', waistCm: '102', hipCm: '114', heightCm: '191-195' },
  XXXL: { euSize: '54', chestCm: '132', waistCm: '108', hipCm: '120', heightCm: '196-201' },
};

const HELMETS_HATS: Record<string, { headCircumferenceCm: string }> = {
  XS: { headCircumferenceCm: '54-55' },
  S: { headCircumferenceCm: '55-56' },
  M: { headCircumferenceCm: '57-58' },
  L: { headCircumferenceCm: '58-59' },
  XL: { headCircumferenceCm: '60-61' },
  XXL: { headCircumferenceCm: '62-63' },
};

const SPORTS_GLOVES: Record<string, { palmWidthCm: string }> = {
  XS: { palmWidthCm: '6.5' },
  S: { palmWidthCm: '7.5' },
  M: { palmWidthCm: '8.5' },
  L: { palmWidthCm: '9.5' },
  XL: { palmWidthCm: '10.5' },
  XXL: { palmWidthCm: '11.5' },
};

const WOMEN_GLOVES: Record<string, { palmCircumferenceCm: string; intSize: string }> = {
  '6': { palmCircumferenceCm: '15.2', intSize: 'XXS' },
  '6.5': { palmCircumferenceCm: '16.5', intSize: 'XS' },
  '7': { palmCircumferenceCm: '17.8', intSize: 'S' },
  '7.5': { palmCircumferenceCm: '19', intSize: 'M' },
  '8': { palmCircumferenceCm: '20.3', intSize: 'L' },
  '8.5': { palmCircumferenceCm: '21.6', intSize: 'XL' },
  '9': { palmCircumferenceCm: '22.9', intSize: 'XXL' },
  '9.5': { palmCircumferenceCm: '24', intSize: 'XXXL' },
  '10': { palmCircumferenceCm: '25.4', intSize: '4XL' },
  '11': { palmCircumferenceCm: '27', intSize: '5XL' },
};

const MEN_GLOVES: Record<string, { palmCircumferenceCm: string; intSize: string }> = {
  '7': { palmCircumferenceCm: '17.8', intSize: 'XXS' },
  '7.5': { palmCircumferenceCm: '19', intSize: 'XS' },
  '8': { palmCircumferenceCm: '20.3', intSize: 'S' },
  '8.5': { palmCircumferenceCm: '21.6', intSize: 'M' },
  '9': { palmCircumferenceCm: '22.9', intSize: 'L' },
  '9.5': { palmCircumferenceCm: '24', intSize: 'XL' },
  '10': { palmCircumferenceCm: '25.4', intSize: 'XXL' },
  '10.5-11': { palmCircumferenceCm: '27', intSize: 'XXXL' },
};

const FOOTBALL_SHIELDS: Record<string, { heightCm: string }> = {
  XS: { heightCm: '140-150' },
  S: { heightCm: '150-160' },
  M: { heightCm: '160-175' },
  L: { heightCm: '175-190' },
  XL: { heightCm: '190+' },
};

const GAME_MASKS: Record<string, { faceLengthCm: string }> = {
  XS: { faceLengthCm: '8.5-10' },
  'S/M': { faceLengthCm: '10-12' },
  'L/XL': { faceLengthCm: '12+' },
};

const WOMEN_SKATES: Record<string, { euSize: string; footLengthCm: string }> = {
  '35': { euSize: '36', footLengthCm: '22.5' },
  '36': { euSize: '37', footLengthCm: '23.5' },
  '37': { euSize: '38', footLengthCm: '24' },
  '38': { euSize: '39', footLengthCm: '24.5' },
  '39': { euSize: '40', footLengthCm: '25.5' },
  '40': { euSize: '41', footLengthCm: '26' },
  '41': { euSize: '42', footLengthCm: '26.5' },
  '42': { euSize: '43', footLengthCm: '27.5' },
  '43': { euSize: '44', footLengthCm: '28' },
};

const MEN_SKATES: Record<string, { euSize: string; footLengthCm: string }> = {
  '38': { euSize: '39', footLengthCm: '24.5' },
  '39': { euSize: '40', footLengthCm: '25.5' },
  '40': { euSize: '41', footLengthCm: '26' },
  '41': { euSize: '42', footLengthCm: '26.5' },
  '42': { euSize: '43', footLengthCm: '27.5' },
  '43': { euSize: '44', footLengthCm: '28' },
  '44': { euSize: '45', footLengthCm: '28.5' },
  '45': { euSize: '46', footLengthCm: '29.5' },
  '46': { euSize: '47', footLengthCm: '30' },
};

const CYCLING_CLOTHING: Record<string, { frameInches: string; legLengthCm: string; heightCm: string }> = {
  XS: { frameInches: '13-14', legLengthCm: '57-63', heightCm: '140-150' },
  S: { frameInches: '14-15', legLengthCm: '63-69', heightCm: '150-160' },
  'S/M': { frameInches: '15-17', legLengthCm: '69-74', heightCm: '160-170' },
  'M/L': { frameInches: '17-19', legLengthCm: '74-79', heightCm: '170-180' },
  L: { frameInches: '19-21', legLengthCm: '79-84', heightCm: '180-188' },
  XL: { frameInches: '21-23', legLengthCm: '84-89', heightCm: '188-195' },
  XXL: { frameInches: '23+', legLengthCm: '90+', heightCm: '195+' },
};

const ADULT_TIGHTS: Record<string, { intSize: string; note: string }> = {
  '1': { intSize: 'XS', note: '按身高/体重二维表选择' },
  '1(XS)': { intSize: 'XS', note: '按身高/体重二维表选择' },
  '2': { intSize: 'S', note: '按身高/体重二维表选择' },
  '2(S)': { intSize: 'S', note: '按身高/体重二维表选择' },
  '3': { intSize: 'M', note: '按身高/体重二维表选择' },
  '3(M)': { intSize: 'M', note: '按身高/体重二维表选择' },
  '4': { intSize: 'L', note: '按身高/体重二维表选择' },
  '4(L)': { intSize: 'L', note: '按身高/体重二维表选择' },
  '5': { intSize: 'XL', note: '按身高/体重二维表选择' },
  '5(XL)': { intSize: 'XL', note: '按身高/体重二维表选择' },
};

const SHOE_FULLNESS: Record<string, { f: string; g: string; h: string; j: string; k: string }> = {
  '33': { f: '20.9', g: '21.4', h: '21.9', j: '22.4', k: '22.9' },
  '34': { f: '21.3', g: '21.8', h: '22.3', j: '22.8', k: '23.3' },
  '35': { f: '21.7', g: '22.2', h: '22.7', j: '23.2', k: '23.7' },
  '36': { f: '22.1', g: '22.6', h: '23.1', j: '23.6', k: '24.1' },
  '37': { f: '22.5', g: '23', h: '23.5', j: '24', k: '24.5' },
  '38': { f: '22.9', g: '23.4', h: '23.9', j: '24.4', k: '24.9' },
  '39': { f: '23.3', g: '23.8', h: '24.3', j: '24.8', k: '25.3' },
  '40': { f: '23.7', g: '24.2', h: '24.7', j: '25.2', k: '25.7' },
  '41': { f: '24.1', g: '24.6', h: '25.1', j: '25.6', k: '26.1' },
  '42': { f: '24.5', g: '25', h: '25.5', j: '26', k: '26.5' },
  '43': { f: '24.9', g: '25.4', h: '25.9', j: '26.4', k: '26.9' },
  '44': { f: '25.3', g: '25.8', h: '26.3', j: '26.8', k: '27.3' },
  '45': { f: '25.7', g: '26.2', h: '26.7', j: '27.2', k: '27.7' },
  '46': { f: '26.1', g: '26.6', h: '27.1', j: '27.6', k: '28.1' },
  '47': { f: '26.5', g: '27', h: '27.5', j: '28', k: '28.5' },
  '48': { f: '26.9', g: '27.4', h: '27.9', j: '28.4', k: '28.9' },
};

const SIMPLE_INT_TABLES: Partial<Record<BuiltInSizeChartMappingProfile, Record<string, BuiltInSizeChartRow>>> = {
  adult_hats: Object.fromEntries(Object.entries(ADULT_HATS).map(([size, row]) => [size, { size, intSize: size, '头围(cm)': row.headCircumferenceCm }])),
  rings: Object.fromEntries(Object.entries(RINGS).map(([size, row]) => [size, { size, '周长(mm)': row.circumferenceMm }])),
  bracelets: Object.fromEntries(Object.entries(BRACELETS).map(([size, row]) => [size, { size, '手腕周长(cm)': row.wristCircumferenceCm }])),
  necklaces: Object.fromEntries(Object.entries(NECKLACES).map(([size, row]) => [size, { size, '长度(cm)': size, '长度(inch)': row.inches }])),
  knee_pads: Object.fromEntries(Object.entries(KNEE_PADS).map(([size, row]) => [size, { size, intSize: size, '膝上围(cm)': row.aboveKneeCm }])),
  diving_boots: Object.fromEntries(Object.entries(DIVING_BOOTS).map(([size, row]) => [size, { size, intSize: size, ruSize: row.euSize, 'US': row.usSize, footLengthCm: row.footLengthCm }])),
  wetsuits: Object.fromEntries(Object.entries(WETSUITS).map(([size, row]) => [size, { size, intSize: size, 'EU': row.euSize, '胸围(cm)': row.chestCm, '腰围(cm)': row.waistCm, '臀围(cm)': row.hipCm, '身高(cm)': row.heightCm }])),
  helmets_hats: Object.fromEntries(Object.entries(HELMETS_HATS).map(([size, row]) => [size, { size, intSize: size, '头围(cm)': row.headCircumferenceCm }])),
  sports_gloves: Object.fromEntries(Object.entries(SPORTS_GLOVES).map(([size, row]) => [size, { size, intSize: size, '掌宽(cm)': row.palmWidthCm }])),
  women_gloves: Object.fromEntries(Object.entries(WOMEN_GLOVES).map(([size, row]) => [size, { size, ruSize: size, intSize: row.intSize, '手掌周长(cm)': row.palmCircumferenceCm }])),
  men_gloves: Object.fromEntries(Object.entries(MEN_GLOVES).map(([size, row]) => [size, { size, ruSize: size, intSize: row.intSize, '手掌周长(cm)': row.palmCircumferenceCm }])),
  football_shields: Object.fromEntries(Object.entries(FOOTBALL_SHIELDS).map(([size, row]) => [size, { size, intSize: size, '身高(cm)': row.heightCm }])),
  game_masks: Object.fromEntries(Object.entries(GAME_MASKS).map(([size, row]) => [size, { size, intSize: size, '面部长(cm)': row.faceLengthCm }])),
  women_skates: Object.fromEntries(Object.entries(WOMEN_SKATES).map(([size, row]) => [size, { size, ruSize: size, 'EU': row.euSize, footLengthCm: row.footLengthCm }])),
  men_skates: Object.fromEntries(Object.entries(MEN_SKATES).map(([size, row]) => [size, { size, ruSize: size, 'EU': row.euSize, footLengthCm: row.footLengthCm }])),
  cycling_clothing: Object.fromEntries(Object.entries(CYCLING_CLOTHING).map(([size, row]) => [size, { size, intSize: size, '车架(inch)': row.frameInches, '腿长(cm)': row.legLengthCm, '身高(cm)': row.heightCm }])),
  adult_tights: Object.fromEntries(Object.entries(ADULT_TIGHTS).map(([size, row]) => [size, { size, intSize: row.intSize, note: row.note }])),
  shoe_fullness: Object.fromEntries(Object.entries(SHOE_FULLNESS).map(([size, row]) => [size, { size, '6(F)(cm)': row.f, '7(G)(cm)': row.g, '8(H)(cm)': row.h, '9(J)(cm)': row.j, '10(K)(cm)': row.k }])),
};

const SIMPLE_LOOKUP_COLUMNS: Partial<Record<BuiltInSizeChartMappingProfile, string[]>> = {
  helmets_hats: ['尺码', '国际尺码', '头围(cm)'],
  sports_gloves: ['尺码', '国际尺码', '掌宽(cm)'],
  women_gloves: ['尺码', '俄罗斯尺码', '国际尺码', '手掌周长(cm)'],
  men_gloves: ['尺码', '俄罗斯尺码', '国际尺码', '手掌周长(cm)'],
  football_shields: ['尺码', '国际尺码', '身高(cm)'],
  game_masks: ['尺码', '国际尺码', '面部长(cm)'],
  women_skates: ['尺码', '俄罗斯尺码', 'EU', '脚长(cm)'],
  men_skates: ['尺码', '俄罗斯尺码', 'EU', '脚长(cm)'],
  cycling_clothing: ['尺码', '国际尺码', '车架(inch)', '腿长(cm)', '身高(cm)'],
  adult_tights: ['尺码', '国际尺码', '说明'],
  shoe_fullness: ['尺码', '6(F)(cm)', '7(G)(cm)', '8(H)(cm)', '9(J)(cm)', '10(K)(cm)'],
};

function sizeKey(value: string): string {
  return value.replace(/^(\d)\s*XL$/i, '$1XL').toUpperCase();
}

function buildRowsFromLookup(
  sizes: string[],
  profile: BuiltInSizeChartMappingProfile,
  columns: string[],
): { columns: string[]; rows: BuiltInSizeChartRow[] } {
  const lookup = SIMPLE_INT_TABLES[profile];
  if (!lookup) return { columns, rows: [] };
  const rows = sizes
    .map((size) => lookup[sizeKey(size)] || lookup[size.toUpperCase()] || lookup[size])
    .filter((row): row is BuiltInSizeChartRow => !!row);
  return { columns, rows };
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
): BuiltInSizeChartBuildResult {
  const ozonTemplate = buildOzonSizeChartRows(sizes, profile);
  if (ozonTemplate.rows.length) {
    return {
      columns: ozonTemplate.columns,
      rows: ozonTemplate.rows,
      tableTitle: ozonTemplate.title,
      source: 'ozon_template',
    };
  }

  const rows: BuiltInSizeChartRow[] = [];
  if (profile === 'adult_hats') {
    return buildRowsFromLookup(sizes, profile, ['尺码', '国际尺码', '头围(cm)']);
  }

  if (profile === 'rings') {
    return buildRowsFromLookup(sizes, profile, ['尺码', '周长(mm)']);
  }

  if (profile === 'bracelets') {
    return buildRowsFromLookup(sizes, profile, ['尺码', '手腕周长(cm)']);
  }

  if (profile === 'necklaces') {
    return buildRowsFromLookup(sizes, profile, ['尺码', '长度(cm)', '长度(inch)']);
  }

  if (profile === 'knee_pads') {
    return buildRowsFromLookup(sizes, profile, ['尺码', '国际尺码', '膝上围(cm)']);
  }

  if (profile === 'diving_boots') {
    return buildRowsFromLookup(sizes, profile, ['尺码', '国际尺码', '俄罗斯尺码', 'US', '脚长(cm)']);
  }

  if (profile === 'wetsuits') {
    return buildRowsFromLookup(sizes, profile, ['尺码', '国际尺码', 'EU', '胸围(cm)', '腰围(cm)', '臀围(cm)']);
  }

  const simpleColumns = SIMPLE_LOOKUP_COLUMNS[profile];
  if (simpleColumns) {
    return buildRowsFromLookup(sizes, profile, simpleColumns);
  }

  if (profile === 'children_shoes') {
    for (const size of sizes) {
      const numeric = size.replace(',', '.').match(/\d{2}(?:\.\d)?/)?.[0] || '';
      const mapped = CHILDREN_SHOES[numeric];
      if (!mapped) continue;
      rows.push({ size: numeric, ruSize: numeric, footLengthCm: mapped.footLengthCm, '鞋垫长度(cm)': mapped.insoleLengthCm, 'EU': mapped.euSize });
    }
    return { columns: ['尺码', '俄罗斯尺码', '脚长(cm)', '鞋垫长度(cm)', 'EU'], rows };
  }

  if (profile === 'adult_socks') {
    for (const size of sizes) {
      const numeric = size.match(/\d{2}/)?.[0] || '';
      const mapped = ADULT_SOCKS[numeric];
      if (!mapped) continue;
      rows.push({ size: numeric, ruSize: numeric, intSize: mapped.intSize, footLengthCm: mapped.footLengthCm, '鞋码范围': mapped.shoeSize });
    }
    return { columns: ['尺码', '俄罗斯尺码', '国际尺码', '脚长(cm)', '鞋码范围'], rows };
  }

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
