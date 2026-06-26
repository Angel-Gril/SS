import { describe, expect, it } from 'vitest';
import { buildSourceProductProfile } from '../services/source-product-profile.js';

describe('source product profile', () => {
  it('normalizes 1688 bra facts, packaging, and text evidence for downstream reuse', () => {
    const profile = buildSourceProductProfile({
      id: 'item-1',
      title: '闪钻细肩带美背内衣无痕无钢圈小胸聚拢显大露背文胸',
      sourcePlatform: '1688',
      sourceProductId: '1008770048152',
      metadata: {
        sourceTitleRaw: '闪钻细肩带美背内衣无痕无钢圈小胸聚拢显大露背文胸',
        categoryPath: ['服饰内衣', '女士内衣', '文胸'],
        categoryName: '文胸',
        sourceAttributes: [
          { name: '主面料成分', value: '聚酯纤维（涤纶）' },
          { name: '颜色', value: '粉色、肤色、黑色' },
          { name: '尺码', value: 'S,M,L,XL' },
          { name: '适用性别', value: '女' },
        ],
        sourceStandardAttributes: {
          colors: ['粉色', '肤色', '黑色'],
          sizes: ['S', 'M', 'L', 'XL'],
          materials: ['聚酯纤维（涤纶）'],
          gender: { value: 'female', raw: '女' },
          seasons: ['all-season'],
          categoryHints: ['女士内衣', '文胸'],
          packageWeightG: 120,
          packageDimensionsMm: { length: 300, width: 200, height: 40 },
          missingForOzon: [],
        },
        sourcePackagingRows: [
          { color: '粉色', size: 'S', weightG: 120, lengthMm: 300, widthMm: 200, heightMm: 40 },
        ],
        sourceDescriptionRaw: '<div>无钢圈设计，细肩带，美背交叉。<img src="https://img.example.com/detail.jpg"/>适合日常穿搭。</div>',
        sourceRichContentDraft: {
          blocks: [
            { type: 'image', url: 'https://img.example.com/detail.jpg' },
            { type: 'text', text: '<p>可拆卸胸垫，轻薄透气，不勒肩。</p>' },
          ],
        },
        sourceDetailImages: ['https://img.example.com/1.jpg', 'https://img.example.com/2.jpg'],
        extractionDiagnostics: { packagingCount: 1, descriptionFound: true },
      },
    });

    expect(profile.sourceTitle).toBe('闪钻细肩带美背内衣无痕无钢圈小胸聚拢显大露背文胸');
    expect(profile.categoryPath).toEqual(['服饰内衣', '女士内衣', '文胸']);
    expect(profile.productIntentTerms).toEqual(expect.arrayContaining(['bra', 'underwear']));
    expect(profile.productIntentTerms).not.toContain('sleepwear');
    expect(profile.colors).toEqual(['粉色', '肤色', '黑色']);
    expect(profile.sizes).toEqual(['S', 'M', 'L', 'XL']);
    expect(profile.materials).toEqual(['聚酯纤维(涤纶)']);
    expect(profile.genderSeasonHints).toEqual(expect.arrayContaining(['female', 'all-season']));
    expect(profile.packaging).toMatchObject({
      rowCount: 1,
      hasWeight: true,
      hasDimensions: true,
      status: 'complete',
      missing: [],
    });
    expect(profile.textEvidence.description).toContain('无钢圈设计');
    expect(profile.textEvidence.richContentSummary).toContain('可拆卸胸垫');
    expect(JSON.stringify(profile.textEvidence)).not.toContain('<img');
    expect(JSON.stringify(profile.textEvidence)).not.toContain('https://img.example.com');
    expect(profile.textEvidence.detailImageCount).toBe(2);
    expect(profile.quality.confidence).toBe('high');
    expect(profile.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('classifies sleepwear without adding bra intent from generic chest or strap wording', () => {
    const profile = buildSourceProductProfile({
      id: 'item-2',
      title: '跨境2026新款立体花边睡衣连衣裙女装批发网纱蕾丝吊带睡裙',
      sourcePlatform: '1688',
      metadata: {
        categoryPath: ['服饰内衣', '女装', '睡衣'],
        categoryName: '睡裙',
        sourceStandardAttributes: {
          colors: ['酒红色'],
          sizes: ['S', 'M'],
          materials: ['聚酯纤维'],
          categoryHints: ['睡衣', '睡裙', '吊带睡裙'],
          packageWeightG: 150,
          packageDimensionsMm: null,
          missingForOzon: ['包装尺寸'],
        },
        sourcePackagingRows: [{ color: '酒红色', size: 'S', weightG: 150 }],
      },
    });

    expect(profile.productIntentTerms).toEqual(expect.arrayContaining(['sleepwear', 'nightdress', 'apparel']));
    expect(profile.productIntentTerms).not.toContain('bra');
    expect(profile.packaging).toMatchObject({
      rowCount: 1,
      hasWeight: true,
      hasDimensions: false,
      status: 'weight_only',
    });
    expect(profile.packaging.missing).toContain('package_dimensions');
  });

  it('reports absent packaging as collection evidence instead of silent zero data', () => {
    const profile = buildSourceProductProfile({
      id: 'item-3',
      title: '女士无痕内衣',
      sourcePlatform: '1688',
      metadata: {
        categoryPath: ['服饰内衣', '女士内衣'],
        sourceStandardAttributes: {
          colors: ['黑色'],
          sizes: ['M'],
          materials: ['锦纶'],
          categoryHints: ['内衣'],
          packageWeightG: null,
          packageDimensionsMm: null,
          missingForOzon: ['重量', '包装尺寸'],
        },
        extractionDiagnostics: { packagingCount: 0, descriptionFound: false, extensionVersion: '1.0.112' },
      },
    });

    expect(profile.packaging).toMatchObject({
      rowCount: 0,
      hasWeight: false,
      hasDimensions: false,
      status: 'missing',
    });
    expect(profile.packaging.missing).toEqual(expect.arrayContaining(['package_weight', 'package_dimensions']));
    expect(profile.quality.missing).toEqual(expect.arrayContaining(['package_weight', 'package_dimensions', 'source_description']));
    expect(profile.quality.confidence).toBe('medium');
    expect(profile.quality.warnings.join(' ')).toContain('No source packaging rows');
  });
});
