'use client';

import { AlertCircle, Loader2, Save } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

interface AdminConfigRow {
  key: string;
  value: string;
  label: string | null;
  description: string | null;
}

type ByokOperation = 'TEXT_TO_IMAGE' | 'IMAGE_TO_IMAGE' | 'FULL_EDIT' | 'INPAINT';
type ByokRolloutMode = 'off' | 'pilot' | 'global';

interface ByokAdminPolicyDraft {
  contractVersion: 'extension-byok-admin-policy/v1';
  revision: number;
  mode: ByokRolloutMode;
  ownerUserIds: string[];
  shopIds: string[];
  deviceSessionIds: string[];
  allowedOrigins: string[];
  allowedOperations: ByokOperation[];
  maxConcurrency: number;
}

const BYOK_ADMIN_KEYS = [
  'feature_extension_hosted_ai',
  'feature_extension_byok_ai',
  'feature_extension_byok_ingest',
  'feature_extension_byok_publish',
  'extension_byok_admin_policy',
];

const BYOK_OPERATIONS: Array<{ value: ByokOperation; label: string }> = [
  { value: 'TEXT_TO_IMAGE', label: '文生图' },
  { value: 'IMAGE_TO_IMAGE', label: '参考图生图' },
  { value: 'FULL_EDIT', label: '全图编辑' },
  { value: 'INPAINT', label: '局部重绘' },
];

const DEFAULT_BYOK_ADMIN_POLICY: ByokAdminPolicyDraft = {
  contractVersion: 'extension-byok-admin-policy/v1',
  revision: 0,
  mode: 'off',
  ownerUserIds: [],
  shopIds: [],
  deviceSessionIds: [],
  allowedOrigins: [],
  allowedOperations: [],
  maxConcurrency: 1,
};

function parseStringList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) return null;
  return value as string[];
}

function parseByokAdminPolicy(value: string): ByokAdminPolicyDraft | null {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const expectedKeys = [
      'allowedOperations',
      'allowedOrigins',
      'contractVersion',
      'deviceSessionIds',
      'maxConcurrency',
      'mode',
      'ownerUserIds',
      'revision',
      'shopIds',
    ];
    const ownerUserIds = parseStringList(parsed.ownerUserIds);
    const shopIds = parseStringList(parsed.shopIds);
    const deviceSessionIds = parseStringList(parsed.deviceSessionIds);
    const allowedOrigins = parseStringList(parsed.allowedOrigins);
    const allowedOperations = parseStringList(parsed.allowedOperations);
    if (Object.keys(parsed).sort().join(',') !== expectedKeys.sort().join(',')
      || parsed.contractVersion !== DEFAULT_BYOK_ADMIN_POLICY.contractVersion
      || !Number.isSafeInteger(parsed.revision)
      || Number(parsed.revision) < 0
      || !['off', 'pilot', 'global'].includes(String(parsed.mode || ''))
      || !Number.isInteger(parsed.maxConcurrency)
      || Number(parsed.maxConcurrency) < 1
      || Number(parsed.maxConcurrency) > 4
      || !ownerUserIds
      || !shopIds
      || !deviceSessionIds
      || !allowedOrigins
      || !allowedOperations
      || allowedOperations.some((operation) => !BYOK_OPERATIONS.some((item) => item.value === operation))) {
      return null;
    }
    return {
      contractVersion: DEFAULT_BYOK_ADMIN_POLICY.contractVersion,
      revision: Number(parsed.revision),
      mode: parsed.mode as ByokRolloutMode,
      ownerUserIds,
      shopIds,
      deviceSessionIds,
      allowedOrigins,
      allowedOperations: allowedOperations as ByokOperation[],
      maxConcurrency: Number(parsed.maxConcurrency),
    };
  } catch {
    return null;
  }
}

function lines(value: string): string[] {
  return [...new Set(value.split(/[\r\n,]+/u).map((item) => item.trim()).filter(Boolean))];
}

function AdminToggle({
  config,
  value,
  onChange,
}: {
  config?: AdminConfigRow;
  value: string;
  onChange(next: string): void;
}) {
  if (!config) return null;
  const enabled = value === 'true';
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border px-3 py-3">
      <div className="min-w-0">
        <Label className="text-sm font-medium">{config.label || config.key}</Label>
        {config.description && (
          <p className="mt-1 text-xs text-muted-foreground">{config.description}</p>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={config.label || config.key}
        onClick={() => onChange(enabled ? 'false' : 'true')}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
          enabled ? 'bg-primary' : 'bg-muted'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
            enabled ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
    </div>
  );
}

export function ExtensionAiAdminControls({
  configs,
  editing,
  setValue,
  savingKey,
  saveConfigs,
}: {
  configs: Record<string, AdminConfigRow | undefined>;
  editing: Record<string, string>;
  setValue(key: string, value: string): void;
  savingKey: string | null;
  saveConfigs(keys: string[], label: string, overrides?: Record<string, string>): Promise<void>;
}) {
  const rawPolicy = editing.extension_byok_admin_policy || '';
  const policy = parseByokAdminPolicy(rawPolicy);
  const isSaving = savingKey === 'group:扩展 AI 管理控制';

  function updatePolicy(patch: Partial<ByokAdminPolicyDraft>) {
    if (!policy) return;
    setValue('extension_byok_admin_policy', JSON.stringify({ ...policy, ...patch }));
  }

  function resetPolicy() {
    setValue('extension_byok_admin_policy', JSON.stringify(DEFAULT_BYOK_ADMIN_POLICY));
  }

  function saveAll() {
    if (!policy) return Promise.resolve();
    return saveConfigs(BYOK_ADMIN_KEYS, '扩展 AI 管理控制', {
      extension_byok_admin_policy: JSON.stringify({
        ...policy,
        revision: policy.revision + 1,
      }),
    });
  }

  return (
    <details className="rounded-md border p-4">
      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium">BYOK 管理控制</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              托管 AI、BYOK 生图、BYOK 结果接收和 BYOK 上架发布分别授权；全部默认关闭。
            </p>
          </div>
          <Badge variant="secondary">安全基础设施 · 暗态</Badge>
        </div>
      </summary>

      <div className="mt-4 space-y-4 border-t pt-4">
        <div className="grid gap-3 md:grid-cols-2">
          <AdminToggle
            config={configs.feature_extension_hosted_ai}
            value={editing.feature_extension_hosted_ai || 'false'}
            onChange={(value) => setValue('feature_extension_hosted_ai', value)}
          />
          <AdminToggle
            config={configs.feature_extension_byok_ai}
            value={editing.feature_extension_byok_ai || 'false'}
            onChange={(value) => setValue('feature_extension_byok_ai', value)}
          />
          <AdminToggle
            config={configs.feature_extension_byok_ingest}
            value={editing.feature_extension_byok_ingest || 'false'}
            onChange={(value) => setValue('feature_extension_byok_ingest', value)}
          />
          <AdminToggle
            config={configs.feature_extension_byok_publish}
            value={editing.feature_extension_byok_publish || 'false'}
            onChange={(value) => setValue('feature_extension_byok_publish', value)}
          />
        </div>

        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs leading-5 text-amber-950">
          <p>
            选中的图片、参考图、遮罩和 Prompt 会从扩展后台直接发送到管理员允许且用户授权的外部 Provider。
            API Key 不会发送到 ERP，也不会进入页面 DOM、日志或本地/同步存储。
          </p>
          <p className="mt-2">
            外部 Provider 费用由用户与 Provider 结算，不包含在 ERP 托管 AI 价格或额度中；
            重试和批量任务可能产生额外费用。BYOK 结果仍需进入 ERP 草稿审核并通过现有发布流程上架。
          </p>
          <p className="mt-2">
            只有用户接受的结果才会进入 ERP；ERP 保存标准化图片及非秘密的哈希、草稿和发布绑定，
            不保存 Provider 原始响应或 API Key。
          </p>
        </div>

        {!policy ? (
          <div className="flex flex-col gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2 text-xs text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>当前 BYOK 策略无法解析；运行时将关闭全部 BYOK 能力。</span>
            </div>
            <Button type="button" size="sm" variant="outline" onClick={resetPolicy}>
              恢复安全默认值
            </Button>
          </div>
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="extension-byok-rollout-mode">发布范围</Label>
                <select
                  id="extension-byok-rollout-mode"
                  value={policy.mode}
                  onChange={(event) => updatePolicy({ mode: event.target.value as ByokRolloutMode })}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="off">关闭</option>
                  <option value="pilot">精确试点</option>
                  <option value="global">全部租户</option>
                </select>
                <p className="text-xs text-muted-foreground">策略修订：{policy.revision}；保存时自动递增。</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="extension-byok-max-concurrency">最大并发</Label>
                <select
                  id="extension-byok-max-concurrency"
                  value={String(policy.maxConcurrency)}
                  onChange={(event) => updatePolicy({ maxConcurrency: Number(event.target.value) })}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {[1, 2, 3, 4].map((value) => (
                    <option key={value} value={value}>{value}</option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">首期限制 1–4；单图试点建议保持 1。</p>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="extension-byok-allowed-origins">允许的 Provider 来源</Label>
              <textarea
                id="extension-byok-allowed-origins"
                rows={4}
                spellCheck={false}
                className="flex min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm"
                value={policy.allowedOrigins.join('\n')}
                onChange={(event) => updatePolicy({ allowedOrigins: lines(event.target.value) })}
                placeholder="https://provider.example"
              />
              <p className="text-xs text-muted-foreground">
                每行一个精确公开 HTTPS origin；不允许路径、查询、通配符、localhost、私网或 metadata 地址。
              </p>
            </div>

            <div className="space-y-2">
              <Label>允许的操作</Label>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {BYOK_OPERATIONS.map((operation) => {
                  const selected = policy.allowedOperations.includes(operation.value);
                  return (
                    <button
                      key={operation.value}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => updatePolicy({
                        allowedOperations: selected
                          ? policy.allowedOperations.filter((item) => item !== operation.value)
                          : [...policy.allowedOperations, operation.value],
                      })}
                      className={`rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                        selected ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'
                      }`}
                    >
                      <span className="block font-medium">{operation.label}</span>
                      <code className="text-[10px] text-muted-foreground">{operation.value}</code>
                    </button>
                  );
                })}
              </div>
            </div>

            {policy.mode === 'pilot' && (
              <div className="grid gap-3 md:grid-cols-3">
                {([
                  ['ownerUserIds', 'Owner 用户 ID'],
                  ['shopIds', '店铺 ID'],
                  ['deviceSessionIds', '设备会话 ID'],
                ] as const).map(([key, label]) => (
                  <div key={key} className="space-y-1.5">
                    <Label htmlFor={`extension-byok-${key}`}>{label}</Label>
                    <textarea
                      id={`extension-byok-${key}`}
                      rows={4}
                      spellCheck={false}
                      className="flex min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm"
                      value={policy[key].join('\n')}
                      onChange={(event) => updatePolicy({ [key]: lines(event.target.value) })}
                    />
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-end">
              <Button type="button" size="sm" onClick={saveAll} disabled={savingKey !== null}>
                {isSaving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                <span className="ml-1">保存扩展 AI 控制</span>
              </Button>
            </div>
          </>
        )}
      </div>
    </details>
  );
}
