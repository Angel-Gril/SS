import type { SmsProvider } from './types.js';
import { ConsoleSmsProvider } from './console.js';
import { TencentSmsProvider } from './tencent.js';
import { AliyunSmsProvider } from './aliyun.js';
import { getSmsRuntimeConfig } from '../auth-challenge-config.js';
import type { AliyunSmsRuntimeConfig, SmsRuntimeConfig, TencentSmsRuntimeConfig } from '../auth-challenge-config.js';
import { getRuntimeMode } from '../../adapters/runtime-config.js';

export type { SmsCodePurpose, SmsProvider, SmsResult } from './types.js';

let _provider: { signature: string; provider: SmsProvider } | null = null;

function createProvider(
  name: string,
  tencentConfig?: TencentSmsRuntimeConfig,
  aliyunConfig?: AliyunSmsRuntimeConfig,
): SmsProvider {
  switch (name) {
    case 'tencent':
      return new TencentSmsProvider(tencentConfig);
    case 'aliyun':
      return new AliyunSmsProvider(aliyunConfig);
    case 'console':
      return new ConsoleSmsProvider();
    default:
      throw new Error('[SMS] SMS_PROVIDER 未配置，生产环境必须配置真实短信 provider');
  }
}

export async function getSmsProvider(runtimeConfig?: SmsRuntimeConfig): Promise<SmsProvider> {
  const config = runtimeConfig || await getSmsRuntimeConfig();
  if (config.provider === 'console' && getRuntimeMode() === 'cloud') {
    throw new Error('[SMS] cloud 运行模式禁止使用 console provider');
  }
  const signature = JSON.stringify({
    provider: config.provider,
    tencent: config.tencent,
    aliyun: config.aliyun,
  });

  if (_provider?.signature === signature) return _provider.provider;

  const provider = createProvider(config.provider, config.tencent, config.aliyun);
  _provider = { signature, provider };
  console.log(`[SMS] provider = ${config.provider || 'unset'} (${config.source})`);
  return provider;
}

export function resetSmsProviderCache() {
  _provider = null;
}
