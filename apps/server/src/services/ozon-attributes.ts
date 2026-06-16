const SKIP_ATTRS = new Set(['22057', '11254', '23171', '22336']);
const UNSAFE_CLONED_ATTR_NAME_RE = /(видео|video|обложк|cover|rich|медиа|media|мультимеди|видеофон|background|banner|баннер|视频|封面|富文本|富媒体)/i;

export interface OzonImportAttribute {
  id: number;
  complex_id: number;
  values: { value: string; dictionary_value_id?: number }[];
}

/**
 * 将 OZON Seller API 返回的 ozonAttributes 转成 import API 入参格式。
 * - SKIP 掉若干 OZON 不允许写入的字段
 * - followBrand=false 时去掉品牌（attr 85），由后端注入"无品牌"
 * - dictionary_value_id 为 0/缺失时不写入 ID，保留 value 文本
 */
export function convertOzonRawAttrs(
  rawAttrs: any[] | null | undefined,
  followBrand: boolean,
): OzonImportAttribute[] {
  if (!Array.isArray(rawAttrs)) return [];
  return rawAttrs
    .filter((x: any) => !shouldSkipOzonPublishAttr(x))
    .filter((x: any) => followBrand || String(x.attribute_id) !== '85')
    .map((x: any) => ({
      id: Number(x.attribute_id),
      complex_id: Number(x.complex_id) || 0,
      values: Array.isArray(x.values) ? x.values.map((v: any) => {
        const val: any = { value: v.value || '' };
        if (v.dictionary_value_id && String(v.dictionary_value_id) !== '0') {
          val.dictionary_value_id = Number(v.dictionary_value_id);
        }
        return val;
      }) : [],
    }))
    .filter((x: any) => x.values.length > 0);
}

export function shouldSkipOzonPublishAttr(attr: any): boolean {
  const id = attr?.attribute_id ?? attr?.id;
  if (SKIP_ATTRS.has(String(id))) return true;

  const names = [
    attr?.attribute_name,
    attr?.name,
    attr?.attributeName,
  ].map((value) => String(value || '').trim()).filter(Boolean);

  return names.some((name) => UNSAFE_CLONED_ATTR_NAME_RE.test(name));
}
