export type ObjectStorageProvider = 'aliyun-oss' | 'cloudflare-r2' | 's3-compatible';
export type ObjectStorageProbe =
  | 'headBucket'
  | 'putObject'
  | 'getObject'
  | 'deleteObject'
  | 'publicRead'
  | 'cors';

export interface ObjectStoragePresetInput {
  region?: string;
  bucket?: string;
}
export interface ObjectStorageProviderPreset {
  provider: ObjectStorageProvider;
  region: string;
  endpoint: string;
  publicDomain: string;
}

export const ALIYUN_OSS_REGIONS = [
  { value: 'cn-guangzhou', label: '华南3（广州）' },
  { value: 'cn-shenzhen', label: '华南1（深圳）' },
  { value: 'cn-hangzhou', label: '华东1（杭州）' },
  { value: 'cn-shanghai', label: '华东2（上海）' },
  { value: 'cn-beijing', label: '华北2（北京）' },
  { value: 'cn-zhangjiakou', label: '华北3（张家口）' },
  { value: 'cn-hongkong', label: '中国香港' },
  { value: 'ap-southeast-1', label: '新加坡' },
] as const;

export function getObjectStorageProviderPreset(
  provider: ObjectStorageProvider,
  input: ObjectStoragePresetInput = {},
): ObjectStorageProviderPreset {
  const bucket = (input.bucket || '').trim();
  if (provider === 'aliyun-oss') {
    const region = (input.region || 'cn-guangzhou').trim();
    const host = `oss-${region}.aliyuncs.com`;
    return {
      provider,
      region,
      endpoint: `https://${host}`,
      publicDomain: bucket ? `https://${bucket}.${host}` : '',
    };
  }
  if (provider === 'cloudflare-r2')
    return { provider, region: 'auto', endpoint: '', publicDomain: '' };
  return { provider, region: (input.region || 'auto').trim(), endpoint: '', publicDomain: '' };
}

export function inferObjectStorageProvider(endpoint: string): ObjectStorageProvider {
  const value = String(endpoint || '').toLowerCase();
  if (value.includes('.aliyuncs.com') || value.includes('oss-')) return 'aliyun-oss';
  if (value.includes('.r2.cloudflarestorage.com')) return 'cloudflare-r2';
  return 's3-compatible';
}

export function classifyObjectStorageProbeFailure(
  provider: ObjectStorageProvider,
  probe: ObjectStorageProbe,
): 'warn' | 'fail' {
  return probe === 'headBucket' ? 'warn' : 'fail';
}

export function resolveObjectStoragePublicUrl(input: {
  publicDomain?: string;
  proxyUrl: string;
  objectKey: string;
}): string {
  const domain = String(input.publicDomain || '')
    .trim()
    .replace(/\/+$/, '');
  return domain ? `${domain}/${input.objectKey.replace(/^\/+/, '')}` : input.proxyUrl;
}

export function getAliyunOssRamPolicy(bucket: string) {
  const name = String(bucket || '').trim();
  return {
    Version: '1',
    Statement: [
      {
        Effect: 'Allow',
        Action: [
          'oss:GetBucketInfo',
          'oss:ListObjects',
          'oss:GetObject',
          'oss:PutObject',
          'oss:DeleteObject',
          'oss:InitiateMultipartUpload',
          'oss:UploadPart',
          'oss:CompleteMultipartUpload',
          'oss:AbortMultipartUpload',
          'oss:ListParts',
        ],
        Resource: [`acs:oss:*:*:${name}`, `acs:oss:*:*:${name}/*`],
      },
    ],
  };
}
