import { describe, expect, it } from 'vitest';
import {
  classifyObjectStorageProbeFailure,
  getAliyunOssRamPolicy,
  getObjectStorageProviderPreset,
  inferObjectStorageProvider,
  resolveObjectStoragePublicUrl,
} from 'shared/object-storage';

describe('object storage provider helpers', () => {
  it('builds Aliyun OSS endpoint and public bucket domain from region and bucket', () => {
    expect(
      getObjectStorageProviderPreset('aliyun-oss', {
        region: 'cn-guangzhou',
        bucket: 'ozon-cdn',
      }),
    ).toEqual({
      provider: 'aliyun-oss',
      region: 'cn-guangzhou',
      endpoint: 'https://oss-cn-guangzhou.aliyuncs.com',
      publicDomain: 'https://ozon-cdn.oss-cn-guangzhou.aliyuncs.com',
    });
  });

  it('uses auto as the Cloudflare R2 region without inventing an endpoint', () => {
    expect(
      getObjectStorageProviderPreset('cloudflare-r2', {
        region: '',
        bucket: 'assets',
      }),
    ).toEqual({
      provider: 'cloudflare-r2',
      region: 'auto',
      endpoint: '',
      publicDomain: '',
    });
  });

  it('infers known providers from their endpoints', () => {
    expect(inferObjectStorageProvider('https://oss-cn-guangzhou.aliyuncs.com')).toBe('aliyun-oss');
    expect(inferObjectStorageProvider('https://account.r2.cloudflarestorage.com')).toBe(
      'cloudflare-r2',
    );
    expect(inferObjectStorageProvider('https://s3.example.com')).toBe('s3-compatible');
  });

  it('treats non-critical HeadBucket compatibility failures as warnings', () => {
    expect(classifyObjectStorageProbeFailure('aliyun-oss', 'headBucket')).toBe('warn');
    expect(classifyObjectStorageProbeFailure('aliyun-oss', 'putObject')).toBe('fail');
    expect(classifyObjectStorageProbeFailure('cloudflare-r2', 'headBucket')).toBe('warn');
  });

  it('uses a configured public domain for anonymous object checks', () => {
    expect(
      resolveObjectStoragePublicUrl({
        publicDomain: 'https://ozon-cdn.oss-cn-guangzhou.aliyuncs.com/',
        proxyUrl: 'https://ss-erp.cn/api/cdn/system/test.png',
        objectKey: 'system/test.png',
      }),
    ).toBe('https://ozon-cdn.oss-cn-guangzhou.aliyuncs.com/system/test.png');
    expect(
      resolveObjectStoragePublicUrl({
        publicDomain: '',
        proxyUrl: 'https://ss-erp.cn/api/cdn/system/test.png',
        objectKey: 'system/test.png',
      }),
    ).toBe('https://ss-erp.cn/api/cdn/system/test.png');
  });
  it('generates a bucket-scoped Aliyun RAM policy', () => {
    const policy = getAliyunOssRamPolicy('ozon-cdn');
    expect(policy.Statement[0]?.Resource).toEqual([
      'acs:oss:*:*:ozon-cdn',
      'acs:oss:*:*:ozon-cdn/*',
    ]);
    expect(policy.Statement[0]?.Action).toContain('oss:PutObject');
    expect(JSON.stringify(policy)).not.toContain('*:*:*:*');
  });
});
