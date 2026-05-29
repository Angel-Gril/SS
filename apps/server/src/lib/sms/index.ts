import type { SmsProvider } from './types.js';
import { ConsoleSmsProvider } from './console.js';
import { TencentSmsProvider } from './tencent.js';
import { AliyunSmsProvider } from './aliyun.js';

export type { SmsProvider, SmsResult } from './types.js';

let _provider: SmsProvider | null = null;

export function getSmsProvider(): SmsProvider {
  if (_provider) return _provider;

  const name = process.env.SMS_PROVIDER || (process.env.NODE_ENV === 'production' ? '' : 'console');

  switch (name) {
    case 'tencent':
      _provider = new TencentSmsProvider();
      break;
    case 'aliyun':
      _provider = new AliyunSmsProvider();
      break;
    case 'console':
      _provider = new ConsoleSmsProvider();
      break;
    default:
      throw new Error('[SMS] SMS_PROVIDER 未配置，生产环境必须配置真实短信 provider');
  }

  console.log(`[SMS] provider = ${name}`);
  return _provider;
}
