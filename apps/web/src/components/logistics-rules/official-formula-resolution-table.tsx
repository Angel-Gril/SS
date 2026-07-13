import { useState } from 'react';
import { AlertTriangle, CheckCircle2, CircleDashed, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { LogisticsReviewDecision, LogisticsReviewIssue } from './method-binding-table';
import { buildOfficialResolutionRows } from './workbench-state.mjs';

interface OfficialFormulaResolutionTableProps {
  payload: Record<string, unknown> | null;
  blockers: LogisticsReviewIssue[];
  requiredCount: number;
  coveredCount: number;
  preflightRan: boolean;
  reviewingId?: string | null;
  suggestingKey?: string | null;
  onSuggest?: (requirementKey: string, note: string) => void;
  onReview?: (resolution: Record<string, unknown>, decision: LogisticsReviewDecision) => void;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function records(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.map(record) : [];
}

function fingerprintLabel(value: unknown): string {
  const fingerprint = record(value);
  const origin = record(fingerprint.origin);
  const destination = record(fingerprint.destination);
  const packageValue = record(fingerprint.package);
  const weight = record(packageValue.weight);
  const dimensions = record(packageValue.dimensions);
  return [
    `${String(origin.cityUid || '-')} → ${String(destination.locationUid || '-')}`,
    `${String(weight.value || '-')} ${String(weight.unit || '')}`,
    `${String(dimensions.length || '-')}×${String(dimensions.width || '-')}×${String(dimensions.height || '-')} ${String(dimensions.unit || '')}`,
    `${String(fingerprint.currency || '-')} ${Number(fingerprint.declaredPriceMinor || 0) / 100}`,
  ].join(' · ');
}

const officialBlockerCodes = new Set([
  'official_branch_uncovered',
  'zero_formula_matches',
  'multiple_formula_matches',
  'price_drift',
  'validation_expired',
]);

export function OfficialFormulaResolutionTable({
  payload,
  blockers,
  requiredCount,
  coveredCount,
  preflightRan,
  reviewingId,
  onReview,
  suggestingKey,
  onSuggest,
}: OfficialFormulaResolutionTableProps) {
  const samples = records(payload?.officialSamples)
    .sort((left, right) => String(left.fingerprintKey || '').localeCompare(String(right.fingerprintKey || '')));
  const [noteByRequirement, setNoteByRequirement] = useState<Record<string, string>>({});
  const officialBlockers = blockers.filter((issue) => officialBlockerCodes.has(issue.code));
  const requirements = records(record(payload?.validationMatrix).requirements);
  const rows = buildOfficialResolutionRows({
    requirements,
    samples,
    resolutions: records(payload?.officialResolutions),
    blockers: officialBlockers,
  }) as Array<{
    rowId: string;
    requirementKey: string;
    fingerprintKey: string;
    requirement: Record<string, unknown>;
    sample: Record<string, unknown> | null;
    resolution: Record<string, unknown> | null;
    issues: LogisticsReviewIssue[];
  }>;

  return (
    <section id="official-resolutions" aria-labelledby="official-resolutions-title" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="official-resolutions-title" className="text-sm font-semibold">Official 公式解析与样本</h2>
          <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
            Official 报价只验证完全相同的 origin、destination、币种、声明价、重量和尺寸 fingerprint；发布容差为 CNY 0.01。
          </p>
        </div>
        <div className="flex gap-2">
          <Badge variant="outline">样本 {samples.length}</Badge>
          <Badge variant={preflightRan && requiredCount > 0 && coveredCount === requiredCount ? 'success' : 'warning'}>
            分支 {coveredCount}/{requiredCount}
          </Badge>
        </div>
      </div>

      {officialBlockers.length > 0 && (
        <div className="border-y border-destructive/30 bg-destructive/5 px-4 py-3 text-xs text-destructive">
          {officialBlockers.map((issue, index) => (
            <div key={`${issue.code}:${index}`} className="flex items-start gap-2 py-1">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="break-all">{issue.code}{issue.stableServiceKey ? ` · ${issue.stableServiceKey}` : ''}</span>
            </div>
          ))}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="border-y bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
          草稿中没有 Official 校验 requirement。
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Requirement / fingerprint</TableHead>
              <TableHead>Seller 服务分支</TableHead>
              <TableHead className="w-36">Official 样本</TableHead>
              <TableHead className="min-w-52">解析状态</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const requirement = row.requirement;
              const sample = row.sample;
              const resolution = row.resolution;
              const related = row.issues;
              const needsResolution = related.some((issue) =>
                ['official_branch_uncovered', 'zero_formula_matches', 'multiple_formula_matches']
                  .includes(issue.code),
              );
              return (
                <TableRow key={row.rowId}>
                  <TableCell>
                    <div className="text-xs">
                      {fingerprintLabel(requirement.fingerprint || sample?.fingerprint)}
                    </div>
                    <div className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
                      {row.fingerprintKey || '-'}
                    </div>
                    <div className="mt-1 break-all font-mono text-[10px] text-muted-foreground">
                      {row.requirementKey}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs">
                    <div className="break-all font-mono">
                      {String(requirement.stableServiceKey || '-')}
                    </div>
                    <div className="mt-1 text-muted-foreground">
                      {String(requirement.branchKind || '-')} ·{' '}
                      {String(requirement.branchPosition ?? '-')} ·{' '}
                      {String(requirement.expectedDeliveryVariant || requirement.expectedOutcome || '-')}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs">
                    <div>{sample && Array.isArray(sample.tariffs) ? `${sample.tariffs.length} 条报价` : '无匹配样本'}</div>
                    <div className="mt-1 text-muted-foreground">
                      {String(sample?.capturedAt || '-')}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="space-y-2">
                      {resolution ? (
                        <div className="text-xs">
                          <div className="font-medium">{String(resolution.status || 'SUGGESTED')}</div>
                          <div className="mt-1 text-muted-foreground">
                            候选 {Array.isArray(resolution.candidateServiceKeys) ? resolution.candidateServiceKeys.length : 0}
                          </div>
                          <div className="mt-1 break-all font-mono text-[10px] text-muted-foreground">
                            {String(resolution.candidateSetChecksum || '-')}
                          </div>
                        </div>
                      ) : !preflightRan ? (
                        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                          <CircleDashed className="h-3.5 w-3.5" aria-hidden />等待预检
                        </span>
                      ) : needsResolution && onSuggest ? (
                        <div className="space-y-2">
                          <div className="space-y-1 text-xs text-destructive">
                            {related.map((issue, relatedIndex) => (
                              <div
                                key={`${issue.code}:${relatedIndex}`}
                                className="flex items-start gap-1.5"
                              >
                                <AlertTriangle
                                  className="mt-0.5 h-3.5 w-3.5 shrink-0"
                                  aria-hidden
                                />
                                <span>{issue.code}</span>
                              </div>
                            ))}
                          </div>
                          <label className="block space-y-1 text-xs text-muted-foreground">
                            解析审核说明
                            <textarea
                              value={noteByRequirement[row.requirementKey] || ''}
                              onChange={(event) =>
                                setNoteByRequirement((current) => ({
                                  ...current,
                                  [row.requirementKey]: event.target.value,
                                }))
                              }
                              maxLength={500}
                              rows={2}
                              className="w-full resize-y rounded-md border bg-background px-2 py-1.5 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              placeholder="说明该 Official requirement 需要解析的原因"
                            />
                          </label>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={
                              (noteByRequirement[row.requirementKey] || '').trim().length < 3 ||
                              suggestingKey === row.requirementKey
                            }
                            onClick={() =>
                              onSuggest(
                                row.requirementKey,
                                noteByRequirement[row.requirementKey]!.trim(),
                              )
                            }
                          >
                            <Sparkles className="h-3.5 w-3.5" aria-hidden />
                            生成解析建议
                          </Button>
                        </div>
                      ) : related.length ? (
                        <span className="inline-flex items-center gap-1.5 text-xs text-destructive">
                          <AlertTriangle className="h-3.5 w-3.5" aria-hidden />需要解析
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
                          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />未发现样本阻断
                        </span>
                      )}
                      {resolution && onReview && (
                        <div className="flex flex-wrap gap-1.5">
                          <Button type="button" size="sm" variant="outline" disabled={reviewingId === String(resolution.id || '')} onClick={() => onReview(resolution, 'CONFIRMED')}>确认</Button>
                          <Button type="button" size="sm" variant="ghost" disabled={reviewingId === String(resolution.id || '')} onClick={() => onReview(resolution, 'REJECTED')}>拒绝</Button>
                        </div>
                      )}
                    </div>
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
