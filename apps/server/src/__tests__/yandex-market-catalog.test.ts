import { describe, it, expect, vi } from 'vitest';
import { prepareYandexDrafts } from '../services/yandex-market-catalog.js';
import { validateYandexParameters, yandexParameter } from '../services/yandex-market-contract.js';

const product = { id: 'p1', categoryId: '876', sku: '1234567890123', title: 'Товар', description: '', images: ['https://cdn.example/a.jpg'], attributes: { brand: 'SS', barcode: '4601234567890' } };
const tree = { id: 0, name: 'root', children: [{ id: 12, name: 'Категория', children: [{ id: 123, name: 'Товары' }] }] };
const parameter = { id: 1, name: 'Материал', type: 'ENUM' as const, required: true, multivalue: false, allowCustomValues: false, values: [{ id: 2, value: 'Керамика' }] };
function client() { return { getCategoryTree: vi.fn().mockResolvedValue(tree), getCategoryParameters: vi.fn().mockResolvedValue({ categoryId: 123, parameters: [parameter] }) }; }

describe('Yandex catalogue draft preparation', () => {
  it('keeps an untouched Ozon product blocked and does not call category APIs until selected', async () => {
    const c = client(); const result = await prepareYandexDrafts([product], [], c, '77');
    expect(result.drafts[0]!.ready).toBe(false);
    expect(result.drafts[0]!.offer.marketCategoryId).toBeNull();
    expect(c.getCategoryTree).not.toHaveBeenCalled();
  });
  it('validates the selected leaf category, required dictionary and explicit Russian copy', async () => {
    const c = client(); const target = { sourceProductId: 'p1', marketCategoryId: 123, description: 'Керамический товар', parameterValues: [{ parameterId: 1, valueId: 2, value: 'Керамика' }] };
    const result = await prepareYandexDrafts([product], [target], c, '77');
    expect(result.drafts[0]).toMatchObject({ ready: true, offer: { marketCategoryId: 123, description: 'Керамический товар', parameterValues: target.parameterValues } });
    expect(result.draftHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(c.getCategoryParameters).toHaveBeenCalledWith(123, '77');
    expect((await prepareYandexDrafts([{ ...product, title: 'Другой товар' }], [target], c, '77')).draftHash).not.toBe(result.draftHash);
    expect(product.description).toBe('');
  });
  it('rejects parent/unknown categories, missing required values and target edits for other products', async () => {
    const c = client();
    for (const marketCategoryId of [12, 876]) {
      expect((await prepareYandexDrafts([product], [{ sourceProductId: 'p1', marketCategoryId }], c, '77')).drafts[0]!.missingFields).toContain('yandex_leaf_category');
    }
    expect((await prepareYandexDrafts([product], [{ sourceProductId: 'p1', marketCategoryId: 123 }], c, '77')).drafts[0]!.missingFields).toContain('parameter:1:required');
    await expect(prepareYandexDrafts([product], [{ sourceProductId: 'foreign', marketCategoryId: 123 }], c, '77')).rejects.toThrow();
  });
  it('validates dictionary, unit, cardinality and primitive constraints at the owner', () => {
    expect(validateYandexParameters([parameter], [{ parameterId: 1, valueId: 2, value: 'Wrong' }])).toContain('parameter:1:dictionary');
    expect(validateYandexParameters([parameter], [{ parameterId: 1, value: 'Керамика' }])).toContain('parameter:1:dictionary_required');
    expect(validateYandexParameters([parameter], [{ parameterId: 1, valueId: 2, value: 'Керамика', unitId: 99 }])).toContain('parameter:1:unit');
    expect(validateYandexParameters([parameter], [{ parameterId: 1, valueId: 2, value: 'Керамика' }, { parameterId: 1, valueId: 2, value: 'Керамика' }])).toContain('parameter:1:single_value');
  });

  const restricted = {
    ...parameter, allowCustomValues: true,
    values: [...parameter.values, { id: 3, value: 'Стекло' }],
    valueRestrictions: [{ limitingParameterId: 10, limitedValues: [{ limitingOptionValueId: 11, optionValueIds: [2] }] }],
  };
  const controller = { ...parameter, id: 10, required: false, values: [{ id: 11, value: 'Набор' }, { id: 12, value: 'Одиночный' }] };

  it('preserves official cross-parameter restrictions when parsing category responses', () => {
    expect(yandexParameter.parse(restricted)).toHaveProperty('valueRestrictions', restricted.valueRestrictions);
  });

  it('rejects forbidden dependent options and custom values only when the restricting option is selected', () => {
    const controlling = { parameterId: 10, valueId: 11, value: 'Набор' };
    expect(validateYandexParameters([controller, restricted], [controlling, { parameterId: 1, valueId: 3, value: 'Стекло' }])).toContain('parameter:1:restriction:10');
    expect(validateYandexParameters([controller, restricted], [controlling, { parameterId: 1, value: 'Другой материал' }])).toContain('parameter:1:restriction:10');
    expect(validateYandexParameters([controller, restricted], [controlling, { parameterId: 1, valueId: 2, value: 'Керамика' }])).toEqual([]);
    expect(validateYandexParameters([controller, restricted], [{ parameterId: 10, valueId: 12, value: 'Одиночный' }, { parameterId: 1, valueId: 3, value: 'Стекло' }])).toEqual([]);
  });

  it('blocks draft readiness when a valid dictionary value violates another parameter', async () => {
    const c = client(); c.getCategoryParameters.mockResolvedValue({ categoryId: 123, parameters: [controller, restricted] });
    const result = await prepareYandexDrafts([product], [{ sourceProductId: 'p1', marketCategoryId: 123, description: 'Керамический товар', parameterValues: [
      { parameterId: 10, valueId: 11, value: 'Набор' }, { parameterId: 1, valueId: 3, value: 'Стекло' },
    ] }], c, '77');
    expect(result.drafts[0]).toMatchObject({ ready: false, missingFields: ['parameter:1:restriction:10'] });
  });
});
