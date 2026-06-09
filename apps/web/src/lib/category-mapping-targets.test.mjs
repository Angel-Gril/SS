import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildOzonCategoryTargetFormPatch,
  flattenOzonCategoryTargets,
  searchOzonCategoryTargets,
} from './category-mapping-targets.ts';

const categoryTree = [
  {
    description_category_id: 100,
    category_name: 'Электроника',
    children: [
      {
        description_category_id: 110,
        category_name: 'Аксессуары',
        children: [
          {
            description_category_id: 111,
            category_name: 'Чехлы',
            type_id: 501,
            type_name: 'Чехлы для смартфонов',
            children: [],
          },
          {
            description_category_id: 112,
            category_name: 'Зарядные устройства',
            type_id: 502,
            type_name: 'Зарядки',
            children: [],
          },
        ],
      },
    ],
  },
  {
    description_category_id: 200,
    category_name: 'Дом',
    disabled: true,
    type_id: 601,
    type_name: 'Неактивный тип',
    children: [],
  },
];

test('flattens Ozon category tree into selectable category/type targets', () => {
  const targets = flattenOzonCategoryTargets(categoryTree);

  assert.deepEqual(targets, [
    {
      categoryId: 111,
      typeId: 501,
      categoryName: 'Чехлы',
      typeName: 'Чехлы для смартфонов',
      categoryPath: 'Электроника > Аксессуары > Чехлы',
      label: 'Электроника > Аксессуары > Чехлы / Чехлы для смартфонов',
    },
    {
      categoryId: 112,
      typeId: 502,
      categoryName: 'Зарядные устройства',
      typeName: 'Зарядки',
      categoryPath: 'Электроника > Аксессуары > Зарядные устройства',
      label: 'Электроника > Аксессуары > Зарядные устройства / Зарядки',
    },
  ]);
});

test('searches Ozon category targets by Russian name and numeric IDs', () => {
  assert.deepEqual(
    searchOzonCategoryTargets(categoryTree, 'чехлы').map((target) => target.typeId),
    [501],
  );
  assert.deepEqual(
    searchOzonCategoryTargets(categoryTree, '112').map((target) => target.typeId),
    [502],
  );
  assert.deepEqual(
    searchOzonCategoryTargets(categoryTree, '501').map((target) => target.categoryId),
    [111],
  );
});

test('returns an empty list for malformed Ozon category tree input', () => {
  assert.deepEqual(flattenOzonCategoryTargets(null), []);
  assert.deepEqual(searchOzonCategoryTargets([{ category_name: 'missing ids' }], 'missing'), []);
});

test('builds form patch from selected Ozon category target', () => {
  assert.deepEqual(buildOzonCategoryTargetFormPatch({
    categoryId: 111,
    typeId: 501,
    categoryName: 'Чехлы',
    typeName: 'Чехлы для смартфонов',
    categoryPath: 'Электроника > Аксессуары > Чехлы',
    label: 'Электроника > Аксессуары > Чехлы / Чехлы для смартфонов',
  }), {
    targetCategoryId: '111',
    targetTypeId: '501',
    targetCategoryName: 'Чехлы',
    targetCategoryPath: 'Электроника > Аксессуары > Чехлы',
  });
});
