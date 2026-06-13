import { describe, expect, it } from 'vitest';
import { explainOzonError, explainOzonErrors } from 'shared/ozon-error-hints';

describe('ozon error hints', () => {
  it('recognizes Ozon daily product creation limit errors', () => {
    const hint = explainOzonError('Не получится загрузить товары: вы исчерпали суточный лимит на создание товаров. В 03:00 по московскому времени счётчик обнулится');

    expect(hint).toEqual({
      code: 'OZON_DAILY_PRODUCT_CREATE_LIMIT',
      label: 'Ozon 创建商品日额度已用完',
      message: 'Ozon 创建商品日额度已用完，请在北京时间 08:00 后重试。',
      severity: 'warning',
    });
  });

  it('recognizes common Ozon listing validation errors', () => {
    expect(explainOzonError('Не удалось скачать изображение по ссылке')).toMatchObject({
      code: 'OZON_IMAGE_DOWNLOAD_FAILED',
      label: '图片下载异常',
    });
    expect(explainOzonError('Разрешение изображения не соответствует требованиям')).toMatchObject({
      code: 'OZON_IMAGE_RESOLUTION_INVALID',
      label: '图片分辨率不符合要求',
    });
    expect(explainOzonError('Ошибка хранилища: не удалось загрузить изображение по ссылке')).toMatchObject({
      code: 'OZON_IMAGE_DOWNLOAD_FAILED',
      label: '图片下载异常',
    });
    expect(explainOzonError('Заполните обязательные характеристики товара')).toMatchObject({
      code: 'OZON_REQUIRED_ATTRIBUTE_MISSING',
      label: '必填属性缺失',
    });
    expect(explainOzonError('Проверьте значение. В личном кабинете выберите вариант из списка')).toMatchObject({
      code: 'OZON_ATTRIBUTE_DICTIONARY_VALUE',
      label: '属性值不在 Ozon 可选项里',
    });
    expect(explainOzonError('offer_id already exists')).toMatchObject({
      code: 'OZON_OFFER_ID_DUPLICATE',
      label: '货号重复',
    });
    expect(explainOzonError('The type_id does not match the description_category_id')).toMatchObject({
      code: 'OZON_CATEGORY_TYPE_MISMATCH',
      label: '类目/类型不匹配',
    });
    expect(explainOzonError('В названии бессмысленный текст или грамматические ошибки')).toMatchObject({
      code: 'OZON_TITLE_QUALITY_INVALID',
      label: '标题疑似无意义或语法错误',
    });
  });

  it('formats multiple raw errors with chinese hints and original messages', () => {
    expect(explainOzonErrors([
      { message: 'Не удалось скачать изображение по ссылке', field: 'images' },
      { message: 'unknown raw error' },
    ])).toEqual([
      '图片下载异常：Ozon 无法下载商品图片。请检查图片链接是否公网可访问、是否过期、是否被防盗链拦截，必要时重新上传图片后再上架。（字段: images）',
      'unknown raw error',
    ]);
  });
});
