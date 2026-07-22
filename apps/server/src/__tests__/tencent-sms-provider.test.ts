import { describe, expect, it, vi } from 'vitest';
import { TencentSmsProvider, type TencentSmsClient } from '../lib/sms/tencent.js';

const config = {
  secretId: 'secret-id',
  secretKey: 'secret-key',
  region: 'ap-guangzhou',
  sdkAppId: 'sdk-app-id',
  signName: '测试签名',
  templateId: 'template-id',
};

function client(response: Awaited<ReturnType<TencentSmsClient['SendSms']>>): TencentSmsClient {
  return { SendSms: vi.fn(async () => response) };
}

describe('TencentSmsProvider delivery outcomes', () => {
  it('marks an explicit provider rejection as rejected', async () => {
    const provider = new TencentSmsProvider(config, client({
      SendStatusSet: [{ Code: 'LimitExceeded', Message: '触发流控' }],
    }));

    await expect(provider.send('13800138000', '123456')).resolves.toMatchObject({
      ok: false,
      failureKind: 'rejected',
    });
  });

  it('marks an SDK exception as delivery unknown', async () => {
    const sendSms = vi.fn(async () => { throw new Error('network timeout'); });
    const provider = new TencentSmsProvider(config, { SendSms: sendSms });

    await expect(provider.send('13800138000', '123456')).resolves.toMatchObject({
      ok: false,
      failureKind: 'unknown',
    });
  });

  it('returns a successful business id for an accepted send', async () => {
    const provider = new TencentSmsProvider(config, client({
      SendStatusSet: [{ Code: 'Ok', Message: '成功', SerialNo: 'serial-1' }],
    }));

    await expect(provider.send('13800138000', '123456')).resolves.toEqual({
      ok: true,
      bizId: 'serial-1',
    });
  });
});
