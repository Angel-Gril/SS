import { useState } from 'react';
import { AlertTriangle, CheckCircle2, CircleDashed, Link2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { buildMethodBindingRows } from './workbench-state.mjs';

export interface LogisticsReviewIssue {
  code: string;
  stableServiceKey?: string;
  providerId?: string;
  detail?: string;
  [key: string]: unknown;
}

export type LogisticsReviewDecision = 'CONFIRMED' | 'REJECTED';

interface MethodBindingTableProps {
  payload: Record<string, unknown> | null;
  blockers: LogisticsReviewIssue[];
  preflightRan: boolean;
  reviewingId?: string | null;
  suggestingKey?: string | null;
  onSuggest?: (stableServiceKey: string, deliveryMethodId: string, note: string) => void;
  onReview?: (binding: Record<string, unknown>, decision: LogisticsReviewDecision) => void;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function records(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.map(record) : [];
}

const bindingCodes = new Set([
  'method_binding_required',
  'destination_evidence_required',
  'selected_provider_unavailable',
]);

export function MethodBindingTable({
  payload,
  blockers,
  preflightRan,
  reviewingId,
  suggestingKey,
  onSuggest,
  onReview,
}: MethodBindingTableProps) {
  const [selectedMethodByService, setSelectedMethodByService] = useState<Record<string, string>>({});
  const [noteByService, setNoteByService] = useState<Record<string, string>>({});
  const services = records(payload?.services);
  const formulas = records(payload?.formulas);
  const destinationEvidence = records(payload?.destinationEvidence);
  const methodBindings = records(payload?.methodBindings);
  const deliveryMethods = records(payload?.deliveryMethods);
  const selected = new Set(
    Array.isArray(payload?.selectedServiceKeys) ? payload.selectedServiceKeys.map(String) : [],
  );
  const defaults = new Set(
    Array.isArray(payload?.defaultServiceKeys) ? payload.defaultServiceKeys.map(String) : [],
  );
  const formulaByService = new Map(
    formulas.map((formula) => [String(formula.stableServiceKey || ''), formula]),
  );
  const evidenceByService = new Map(
    destinationEvidence.map((evidence) => [String(evidence.stableServiceKey || ''), evidence]),
  );
  const rows = buildMethodBindingRows({
    services,
    methodBindings,
    selectedServiceKeys: [...selected],
  }) as Array<{
    rowId: string;
    stableServiceKey: string;
    service: Record<string, unknown>;
    binding: Record<string, unknown> | null;
  }>;

  return (
    <section id="method-bindings" aria-labelledby="method-bindings-title" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="method-bindings-title" className="text-sm font-semibold">
            实际物流方式绑定
          </h2>
          <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
            本页只展示服务端预检结论。实际 ShopDeliveryMethod
            绑定和路线证据必须由服务端记录确认，不能由导入 JSON 自证。
          </p>
        </div>
        <Badge variant="outline">
          候选 {rows.length} · 已选 {selected.size} · 默认 {defaults.size}
        </Badge>
      </div>

      {rows.length === 0 ? (
        <div className="border-y bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
          当前草稿没有可显示的稳定服务。
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-28">选择</TableHead>
              <TableHead>服务 / provider</TableHead>
              <TableHead>目的地证据</TableHead>
              <TableHead className="min-w-52">实际绑定明细</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const service = row.service;
              const serviceKey = row.stableServiceKey;
              const formula = formulaByService.get(serviceKey) || {};
              const calculationRule = record(formula.calculationRule);
              const evidence = evidenceByService.get(serviceKey);
              const binding = row.binding;
              const rowBlockers = blockers.filter(
                (issue) => issue.stableServiceKey === serviceKey && bindingCodes.has(issue.code),
              );
              const isSelected = selected.has(serviceKey);
              const needsBinding = rowBlockers.some((issue) => issue.code === 'method_binding_required');
              return (
                <TableRow key={row.rowId}>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      <Badge variant={isSelected ? 'default' : 'secondary'}>
                        {isSelected ? '已选' : '候选'}
                      </Badge>
                      {defaults.has(serviceKey) && <Badge variant="outline">默认</Badge>}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">
                      {String(service.normalizedDescription || '未命名服务')}
                    </div>
                    <div className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
                      {serviceKey}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      provider {String(calculationRule.providerId || service.providerId || '-')}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs">
                    {evidence ? (
                      <div className="space-y-1">
                        <div>{String(evidence.evidenceType || '-')}</div>
                        <div className="break-all text-muted-foreground">
                          {String(evidence.destinationCountryUid || '-')} /{' '}
                          {String(evidence.destinationLocationUid || '-')}
                        </div>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">无可发布证据</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {binding ? (
                      <div className="space-y-1 text-xs">
                        <div className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
                          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                          绑定明细已返回
                        </div>
                        <div className="break-all font-mono">
                          ShopDeliveryMethod ID{' '}
                          {String(binding.deliveryMethodId || binding.shopDeliveryMethodId || '-')}
                        </div>
                        <div className="text-muted-foreground">
                          {String(binding.status || binding.state || '-')} ·{' '}
                          {String(binding.confirmedById || binding.reviewedBy || '-')} ·{' '}
                          {String(binding.confirmedAt || binding.reviewedAt || '-')}
                        </div>
                        {onReview && (
                          <div className="flex flex-wrap gap-1.5 pt-1">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={reviewingId === String(binding.id || '')}
                              onClick={() => onReview(binding, 'CONFIRMED')}
                            >
                              确认
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              disabled={reviewingId === String(binding.id || '')}
                              onClick={() => onReview(binding, 'REJECTED')}
                            >
                              拒绝
                            </Button>
                          </div>
                        )}
                      </div>
                    ) : !isSelected ? (
                      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                        <CircleDashed className="h-3.5 w-3.5" aria-hidden />
                        未进入发布集
                      </span>
                    ) : !preflightRan ? (
                      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                        <CircleDashed className="h-3.5 w-3.5" aria-hidden />
                        等待服务端预检
                      </span>
                    ) : needsBinding && onSuggest ? (
                      <div className="space-y-2">
                        <div className="space-y-1 text-xs text-destructive">
                          {rowBlockers.map((issue, index) => (
                            <div key={`${issue.code}:${index}`} className="flex items-start gap-1.5">
                              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                              <span>{issue.code}</span>
                            </div>
                          ))}
                        </div>
                        {deliveryMethods.length > 0 ? (
                          <>
                            <select
                              aria-label={`为 ${serviceKey} 选择实际物流方式`}
                              value={selectedMethodByService[serviceKey] || ''}
                              onChange={(event) =>
                                setSelectedMethodByService((current) => ({
                                  ...current,
                                  [serviceKey]: event.target.value,
                                }))
                              }
                              className="h-9 w-full rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              <option value="">选择 ShopDeliveryMethod</option>
                              {deliveryMethods
                                .filter((method) => String(method.id || ''))
                                .map((method) => (
                                  <option key={String(method.id)} value={String(method.id)}>
                                    {String(method.name || method.platformMethodId || method.id)}
                                    {method.providerName ? ` · ${String(method.providerName)}` : ''}
                                    {method.status ? ` · ${String(method.status)}` : ''}
                                  </option>
                                ))}
                            </select>
                            <label className="block space-y-1 text-xs text-muted-foreground">
                              绑定审核说明
                              <textarea
                                value={noteByService[serviceKey] || ''}
                                onChange={(event) =>
                                  setNoteByService((current) => ({
                                    ...current,
                                    [serviceKey]: event.target.value,
                                  }))
                                }
                                maxLength={500}
                                rows={2}
                                className="w-full resize-y rounded-md border bg-background px-2 py-1.5 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                placeholder="说明实际 method、provider 或路线核对结果"
                              />
                            </label>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={
                                !selectedMethodByService[serviceKey] ||
                                (noteByService[serviceKey] || '').trim().length < 3 ||
                                suggestingKey === serviceKey
                              }
                              onClick={() =>
                                onSuggest(
                                  serviceKey,
                                  selectedMethodByService[serviceKey]!,
                                  noteByService[serviceKey]!.trim(),
                                )
                              }
                            >
                              <Link2 className="h-3.5 w-3.5" aria-hidden />
                              创建绑定建议
                            </Button>
                          </>
                        ) : (
                          <p className="text-xs text-destructive">
                            当前仓库没有可选 ShopDeliveryMethod，请先同步店铺物流方式。
                          </p>
                        )}
                      </div>
                    ) : rowBlockers.length ? (
                      <div className="space-y-1 text-xs text-destructive">
                        {rowBlockers.map((issue, index) => (
                          <div key={`${issue.code}:${index}`} className="flex items-start gap-1.5">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                            <span>{issue.code}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                        <CircleDashed className="h-3.5 w-3.5" aria-hidden />
                        接口未返回绑定明细
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
