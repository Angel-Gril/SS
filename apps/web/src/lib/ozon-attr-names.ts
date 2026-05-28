// OZON 变体维度名（俄语 → 中文）
const VARIANT_DIM_RU_TO_ZH: Record<string, string> = {
  'Цвет': '颜色',
  'Цвет товара': '颜色',
  'Размер': '尺码',
  'Размер одежды': '服装尺码',
  'Размер обуви': '鞋码',
  'Объём': '容量',
  'Вес': '重量',
  'Тип': '类型',
  'Материал': '材质',
  'Модель': '型号',
};

// 常见颜色/通用值翻译（不全，只覆盖出现频率高的）
const VARIANT_VALUE_RU_TO_ZH: Record<string, string> = {
  // 颜色
  'черный': '黑色',
  'чёрный': '黑色',
  'белый': '白色',
  'красный': '红色',
  'синий': '蓝色',
  'зелёный': '绿色',
  'зеленый': '绿色',
  'жёлтый': '黄色',
  'желтый': '黄色',
  'розовый': '粉色',
  'серый': '灰色',
  'коричневый': '棕色',
  'фиолетовый': '紫色',
  'оранжевый': '橙色',
  'голубой': '浅蓝',
  'бежевый': '米色',
  'золотой': '金色',
  'серебряный': '银色',
  'случайная расцветка': '随机花色',
  'мульти': '多色',
  'разноцветный': '多色',
  'прозрачный': '透明',
  // 通用
  'универсальный': '通用',
  'один размер': '均码',
};

export function translateVariantDim(name: string): string {
  if (!name) return name;
  return VARIANT_DIM_RU_TO_ZH[name] || name;
}

export function translateVariantValue(value: string): string {
  if (!value) return value;
  const lower = value.toLowerCase().trim();
  if (VARIANT_VALUE_RU_TO_ZH[lower]) return VARIANT_VALUE_RU_TO_ZH[lower];
  return value;
}

// 把 attrs 对象 { Цвет: 'черный', Размер: '42' } 翻译成 "颜色: 黑色 / 尺码: 42"
export function formatVariantAttrs(attrs: Record<string, string> | null | undefined): string {
  if (!attrs || typeof attrs !== 'object') return '';
  return Object.entries(attrs)
    .map(([k, v]) => `${translateVariantDim(k)}: ${translateVariantValue(String(v))}`)
    .join(' / ');
}

// OZON attribute id → 中文名 字典
// 用于编辑页和列表页统一显示属性名称
//
// 扩展原则：补充时优先核对 OZON 官方 description-category/attribute 接口（language=ZH_HANS）
// 未在字典中的 ID 会 fallback 到 attr.name（多为俄语），不会显示裸数字
export const OZON_ATTR_NAMES: Record<number, string> = {
  // 通用基础信息
  85: '品牌',
  9048: '型号名称',
  9024: '货号',
  4180: '名称',
  4191: '注释',
  4389: '原产国',
  9163: '商品描述',
  22336: '富文本描述',
  11254: '关键词',
  4382: '保质期',
  4497: '含包装重量(克)',

  // 类型/分类
  8229: '类型',
  4383: '适用年龄',
  4384: '性别',

  // 颜色相关
  4080: '颜色',
  10096: '颜色名称',
  10097: '颜色族',

  // 材质/工艺
  4385: '材质',
  4975: '基础材质',
  9388: '主要材质',

  // 尺寸/规格
  4295: '尺寸',
  4381: '包装内数量',
  8782: '套装内数量',
  4496: '深度',
  4495: '宽度',
  4498: '高度',

  // 玩具/儿童
  4444: '建议年龄',
  4445: '玩具类型',
  4446: '电池类型',
  9870: '是否需要电池',
};

export function getOzonAttrName(attr: { id?: number; attribute_id?: number; name?: string; attribute_name?: string }): string {
  const id = attr.id ?? attr.attribute_id;
  if (id != null && OZON_ATTR_NAMES[id]) return OZON_ATTR_NAMES[id];
  return attr.name || attr.attribute_name || (id != null ? `属性 ${id}` : '-');
}
