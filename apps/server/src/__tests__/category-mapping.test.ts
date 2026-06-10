import { describe, expect, it } from 'vitest';
import {
  normalizeCategoryMappingInput,
  selectBestCategoryMapping,
} from '../lib/category-mapping.js';

describe('category mapping helpers', () => {
  it('prefers user-owned mappings over global mappings for the same source category', () => {
    const globalMapping = {
      id: 'global-1',
      userId: null,
      sourcePlatform: '1688',
      sourceCategoryId: null,
      sourceCategoryName: '手机壳',
      targetCategoryId: 17028711,
      targetTypeId: 95841,
    };
    const userMapping = {
      ...globalMapping,
      id: 'user-1',
      userId: 'user-1',
      targetCategoryId: 17029999,
    };

    expect(selectBestCategoryMapping([globalMapping, userMapping], {
      userId: 'user-1',
      sourcePlatform: '1688',
      sourceCategoryName: ' 手机壳 ',
    })).toEqual(userMapping);
  });

  it('matches by source category id before falling back to category name', () => {
    const byName = {
      id: 'name-match',
      userId: 'user-1',
      sourcePlatform: '1688',
      sourceCategoryId: null,
      sourceCategoryName: '耳机',
      targetCategoryId: 111,
      targetTypeId: 222,
    };
    const byId = {
      ...byName,
      id: 'id-match',
      sourceCategoryId: '1031919',
      sourceCategoryName: '其他',
      targetCategoryId: 333,
    };

    expect(selectBestCategoryMapping([byName, byId], {
      userId: 'user-1',
      sourcePlatform: '1688',
      sourceCategoryId: '1031919',
      sourceCategoryName: '耳机',
    }))?.toEqual(byId);
  });

  it('matches by source category path before falling back to leaf category name', () => {
    const byName = {
      id: 'name-match',
      userId: 'user-1',
      sourcePlatform: '1688',
      sourceCategoryId: null,
      sourceCategoryName: '手机壳',
      sourceCategoryPath: null,
      targetCategoryId: 111,
      targetTypeId: 222,
    };
    const byPath = {
      ...byName,
      id: 'path-match',
      sourceCategoryName: null,
      sourceCategoryPath: '数码配件 > 手机配件 > 手机壳',
      targetCategoryId: 333,
      targetTypeId: 444,
    };

    expect(selectBestCategoryMapping([byName, byPath], {
      userId: 'user-1',
      sourcePlatform: '1688',
      sourceCategoryName: '手机壳',
      sourceCategoryPath: ' 数码配件 > 手机配件 > 手机壳 ',
    }))?.toEqual(byPath);
  });

  it('keeps user-owned mapping ahead of a global path mapping', () => {
    const globalPath = {
      id: 'global-path',
      userId: null,
      sourcePlatform: '1688',
      sourceCategoryId: null,
      sourceCategoryName: null,
      sourceCategoryPath: '数码配件 > 手机配件 > 手机壳',
      targetCategoryId: 111,
      targetTypeId: 222,
    };
    const userName = {
      ...globalPath,
      id: 'user-name',
      userId: 'user-1',
      sourceCategoryName: '手机壳',
      sourceCategoryPath: null,
      targetCategoryId: 333,
      targetTypeId: 444,
    };

    expect(selectBestCategoryMapping([globalPath, userName], {
      userId: 'user-1',
      sourcePlatform: '1688',
      sourceCategoryName: '手机壳',
      sourceCategoryPath: '数码配件 > 手机配件 > 手机壳',
    }))?.toEqual(userName);
  });

  it('normalizes allowed mapping input and rejects missing source and target fields', () => {
    const parsed = normalizeCategoryMappingInput({
      sourcePlatform: '1688',
      sourceCategoryName: ' 女装 > 连衣裙 ',
      targetCategoryId: '17030001',
      targetTypeId: '95844',
      defaultWeightG: '350',
    });

    expect(parsed.success && parsed.data).toMatchObject({
      sourcePlatform: '1688',
      sourceCategoryName: '女装 > 连衣裙',
      targetCategoryId: 17030001,
      targetTypeId: 95844,
      defaultWeightG: 350,
    });

    expect(normalizeCategoryMappingInput({
      sourcePlatform: '1688',
      targetCategoryId: 1,
      targetTypeId: 2,
    }).success).toBe(false);

    expect(normalizeCategoryMappingInput({
      sourcePlatform: '1688',
      sourceCategoryName: '手机壳',
      targetCategoryId: 0,
      targetTypeId: 2,
    }).success).toBe(false);
  });
});
