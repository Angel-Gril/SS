import { describe, expect, it } from 'vitest';
import * as shared from 'shared';

describe('legal deployment profiles', () => {
  const getLegalProfile = (shared as Record<string, unknown>).getLegalProfile as
    | ((profile: string) => Record<string, string>)
    | undefined;

  it('uses the domestic company identity while keeping the public display name short', () => {
    const profile = getLegalProfile?.('cloud-cn');

    expect(profile).toMatchObject({
      id: 'cloud-cn',
      platformName: '松鼠跨境 ERP',
      operatorDisplayName: '厦门常青藤上云',
      operatorLegalName: '常青藤上云（厦门）网络科技有限公司',
      websiteUrl: 'https://ss-erp.cn',
      termsVersion: '2026-07-10-cn',
      privacyVersion: '2026-07-10-cn',
    });
  });

  it('keeps local, domestic cloud, global cloud, and self-hosted documents versioned separately', () => {
    const profiles = ['local', 'cloud-cn', 'cloud-global', 'self-hosted']
      .map((profile) => getLegalProfile?.(profile));

    expect(profiles.map((profile) => profile?.id)).toEqual([
      'local',
      'cloud-cn',
      'cloud-global',
      'self-hosted',
    ]);
    expect(new Set(profiles.map((profile) => profile?.termsVersion)).size).toBe(4);
    expect(profiles[0]?.websiteUrl).toBe('http://localhost:3000');
    expect(profiles[2]?.websiteUrl).toBe('https://ss-erp.com');
  });
});
