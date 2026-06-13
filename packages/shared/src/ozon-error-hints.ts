export type OzonErrorHintSeverity = 'info' | 'warning' | 'error';

export interface OzonErrorHint {
  code: string;
  label: string;
  message: string;
  severity: OzonErrorHintSeverity;
}

interface ErrorRule {
  code: string;
  label: string;
  message: string;
  severity: OzonErrorHintSeverity;
  patterns: RegExp[];
}

const OZON_ERROR_RULES: ErrorRule[] = [
  {
    code: 'OZON_DAILY_PRODUCT_CREATE_LIMIT',
    label: 'Ozon 创建商品日额度已用完',
    message: 'Ozon 创建商品日额度已用完，请在北京时间 08:00 后重试。',
    severity: 'warning',
    patterns: [
      /исчерпал[а-я\s]*суточн[а-я\s]*лимит[а-я\s]*создани[а-я\s]*товар/i,
      /daily\s+limit.*(create|creation).*product/i,
      /(create|creation).*product.*daily\s+limit/i,
    ],
  },
  {
    code: 'OZON_IMAGE_DOWNLOAD_FAILED',
    label: '图片下载异常',
    message: 'Ozon 无法下载商品图片。请检查图片链接是否公网可访问、是否过期、是否被防盗链拦截，必要时重新上传图片后再上架。',
    severity: 'error',
    patterns: [
      /(не\s+удалось|не\s+получится|не\s+смогли|ошибк[а-я]*).*(скач|загруз).*(изображ|картин|фото)/i,
      /(скач|загруз).*(изображ|картин|фото).*(ошибк|не\s+удалось|не\s+смогли)/i,
      /(image|picture).*(download|fetch|load).*(fail|error|unable)/i,
      /(failed|unable).*(download|fetch|load).*(image|picture)/i,
    ],
  },
  {
    code: 'OZON_IMAGE_RESOLUTION_INVALID',
    label: '图片分辨率不符合要求',
    message: '图片像素分辨率不符合 Ozon 要求。请换用源商品原图或重新采集/打水印后再上架，避免使用缩略图。',
    severity: 'error',
    patterns: [
      /(изображ|картин).*(разрешени|размер).*не\s+соответств/i,
      /разрешени[а-я\s]*(изображ|картин)/i,
      /(image|picture).*(resolution|pixel|dimension).*(invalid|too\s+small|not\s+meet|not\s+match)/i,
      /(resolution|pixel).*(image|picture).*(invalid|too\s+small|not\s+meet|not\s+match)/i,
    ],
  },
  {
    code: 'OZON_REQUIRED_ATTRIBUTE_MISSING',
    label: '必填属性缺失',
    message: 'Ozon 要求的必填属性没有填完整。请补齐类目必填属性后重新上架。',
    severity: 'error',
    patterns: [
      /заполните\s+обязательн/i,
      /обязательн[а-я\s]*(характеристик|атрибут|пол[ея])/i,
      /(required|mandatory).*(attribute|field|characteristic)/i,
    ],
  },
  {
    code: 'OZON_ATTRIBUTE_DICTIONARY_VALUE',
    label: '属性值不在 Ozon 可选项里',
    message: '某个类目属性必须从 Ozon 字典里选择，当前值不是可选项。请重新继承/补全属性，或在 Ozon 后台查看该字段允许值。',
    severity: 'error',
    patterns: [
      /проверьте\s+значени/i,
      /выберите\s+вариант\s+из\s+списк/i,
      /(dictionary|dict).*value/i,
      /(choose|select).*from.*list/i,
    ],
  },
  {
    code: 'OZON_OFFER_ID_DUPLICATE',
    label: '货号重复',
    message: 'Ozon 已存在相同 offer_id/货号。请开启随机货号或手动修改货号后重新上架。',
    severity: 'error',
    patterns: [
      /offer[_\s-]?id.*(already\s+exists|duplicate|exists)/i,
      /(already\s+exists|duplicate).*offer[_\s-]?id/i,
      /(артикул|offer[_\s-]?id).*(уже\s+существ|дубликат)/i,
    ],
  },
  {
    code: 'OZON_CATEGORY_TYPE_MISMATCH',
    label: '类目/类型不匹配',
    message: 'description_category_id 和 type_id 不匹配。请重新从源商品继承分类/类型，或选择同一类目下的正确 type_id。',
    severity: 'error',
    patterns: [
      /type[_\s-]?id.*description[_\s-]?category[_\s-]?id/i,
      /description[_\s-]?category[_\s-]?id.*type[_\s-]?id/i,
      /category.*type.*(mismatch|not\s+match|does\s+not\s+match)/i,
      /(категор[а-я]*).*(тип|type)/i,
    ],
  },
  {
    code: 'OZON_TITLE_QUALITY_INVALID',
    label: '标题疑似无意义或语法错误',
    message: 'Ozon 认为商品标题存在堆词、无意义文本或语法问题。请在采集改款里精简标题，保留商品名、品牌/型号和关键规格。',
    severity: 'error',
    patterns: [
      /(названи[а-я]*).*(бессмыслен|грамматическ|ошиб)/i,
      /(title|name).*(meaningless|grammar|grammatical|spam)/i,
      /(meaningless|grammar|grammatical|spam).*(title|name)/i,
    ],
  },
  {
    code: 'OZON_PRICE_INVALID',
    label: '价格不符合要求',
    message: 'Ozon 拒绝了当前价格。请检查价格是否为正数、是否低于平台最小价或不符合促销/币种规则。',
    severity: 'error',
    patterns: [
      /\bprice\b/i,
      /цен[ауы]/i,
    ],
  },
  {
    code: 'OZON_DIMENSIONS_INVALID',
    label: '重量/尺寸不符合要求',
    message: 'Ozon 拒绝了重量或尺寸。请检查重量、长宽高是否完整、为正数，并符合该类目限制。',
    severity: 'error',
    patterns: [
      /\b(weight|dimension|height|width|depth|length)\b/i,
      /(вес|габарит|размер|длин[аы]|ширин[аы]|высот[аы])/i,
    ],
  },
  {
    code: 'OZON_BARCODE_INVALID',
    label: '条码不符合要求',
    message: 'Ozon 拒绝了条码。请检查条码是否重复、格式是否正确，或按类目要求重新生成/填写。',
    severity: 'error',
    patterns: [
      /\bbarcode\b/i,
      /штрих[\s-]?код/i,
    ],
  },
  {
    code: 'OZON_PERMISSION_DENIED',
    label: '店铺权限/API 权限不足',
    message: 'Ozon 拒绝了当前 API 操作。请检查店铺 API Key、Client ID、商品创建权限或该店铺是否允许此操作。',
    severity: 'error',
    patterns: [
      /(access\s+denied|forbidden|not\s+allowed|permission)/i,
      /(нет\s+прав|доступ\s+запрещ)/i,
    ],
  },
];

function rawErrorMessage(error: unknown): string {
  if (typeof error === 'string') return error.trim();
  if (!error || typeof error !== 'object') return '';
  const record = error as Record<string, unknown>;
  return String(record.message ?? record.description ?? record.error ?? record.code ?? '').trim();
}

function rawErrorField(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  const record = error as Record<string, unknown>;
  return String(record.field ?? '').trim();
}

export function explainOzonError(error: unknown): OzonErrorHint | null {
  const message = rawErrorMessage(error);
  if (!message) return null;
  for (const rule of OZON_ERROR_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(message))) {
      return {
        code: rule.code,
        label: rule.label,
        message: rule.message,
        severity: rule.severity,
      };
    }
  }
  return null;
}

export function formatOzonErrorMessage(error: unknown): string {
  const original = rawErrorMessage(error);
  const hint = explainOzonError(error);
  const field = rawErrorField(error);
  if (!hint) return original || 'Ozon 未返回具体错误';
  return `${hint.label}：${hint.message}${field ? `（字段: ${field}）` : ''}`;
}

export function explainOzonErrors(errors: unknown): string[] {
  const list = Array.isArray(errors) ? errors : [errors];
  return list
    .map((error) => formatOzonErrorMessage(error))
    .filter((message) => message.trim().length > 0);
}
