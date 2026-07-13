'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Ruler,
  ShieldCheck,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/use-toast';
import { api, type ApiResponse } from '@/lib/api';
import {
  EMPTY_OFFICIAL_INPUT_UNIT_FORM,
  buildOfficialInputUnitContractRevokePayload,
  buildOfficialInputUnitContractVerifyPayload,
  isEffectiveOfficialInputUnitContract,
  officialInputUnitContractStateKey,
} from './official-input-unit-contract-state.mjs';

type JsonRecord = Record<string, unknown>;

interface OfficialInputUnitCandidate extends JsonRecord {
  id?: string;
  candidateId?: string;
  status?: string;
  reviewStatus?: string;
  candidateChecksum?: string;
  responseChecksum?: string;
  sourceChecksum?: string;
  contentChecksum?: string;
  capturedAt?: string;
  receivedAt?: string;
  createdAt?: string;
}

interface OfficialInputUnitContract extends JsonRecord {
  id: string;
  status: string;
  state?: string;
  scope?: JsonRecord;
  destination?: JsonRecord;
  currency?: string;
  weightUnit?: string;
  dimensionUnit?: string;
  priceInputUnit?: string;
  weightIncrementG?: number;
  dimensionIncrementMm?: number;
  currencyMinorIncrement?: number;
  sourceChecksum?: string;
  sourceRevision?: string;
  verifiedAt?: string;
  validUntil?: string;
  revokedAt?: string;
}

interface OfficialInputUnitContractWorkspace {
  assignment: {
    id: string;
    status?: string;
    scope?: JsonRecord;
    destination?: JsonRecord;
  } | null;
  current: OfficialInputUnitContract | null;
  history: OfficialInputUnitContract[];
  candidates: OfficialInputUnitCandidate[];
  policy: { defaultValidityDays: number };
}

export interface OfficialInputUnitContractGateState {
  contractId: string | null;
  valid: boolean;
}

interface OfficialInputUnitContractFormState {
  weightIncrementG: string;
  dimensionIncrementMm: string;
  currencyMinorIncrement: string;
  unitAttested: boolean;
  reviewNote: string;
}

interface OfficialInputUnitContractPanelProps {
  assignmentId: string;
  onContractStateChange: (state: OfficialInputUnitContractGateState) => void;
}

function responseCode(response: ApiResponse<unknown>): string {
  const error = (response as ApiResponse<unknown> & { error?: { code?: string } }).error;
  return String(error?.code || 'REQUEST_FAILED');
}

function rawString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function stringValue(value: unknown): string {
  return rawString(value) || '-';
}

function formatDate(value: unknown): string {
  if (typeof value !== 'string' || !value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false });
}

function shortChecksum(value: unknown): string {
  const checksum = stringValue(value);
  if (checksum === '-' || checksum.length <= 20) return checksum;
  return `${checksum.slice(0, 10)}…${checksum.slice(-7)}`;
}

function candidateId(candidate: OfficialInputUnitCandidate): string {
  return rawString(candidate.candidateId || candidate.id);
}

function candidateChecksum(candidate: OfficialInputUnitCandidate): string {
  return rawString(
    candidate.candidateChecksum ||
      candidate.responseChecksum ||
      candidate.sourceChecksum ||
      candidate.contentChecksum,
  );
}

function candidateDate(candidate: OfficialInputUnitCandidate): string {
  return formatDate(candidate.capturedAt || candidate.receivedAt || candidate.createdAt);
}

function contractScope(workspace: OfficialInputUnitContractWorkspace | null): JsonRecord {
  return workspace?.assignment?.scope || workspace?.current?.scope || {};
}

function contractDestination(workspace: OfficialInputUnitContractWorkspace | null): JsonRecord {
  return workspace?.assignment?.destination || workspace?.current?.destination || {};
}

export function OfficialInputUnitContractPanel({
  assignmentId,
  onContractStateChange,
}: OfficialInputUnitContractPanelProps) {
  const [workspace, setWorkspace] = useState<OfficialInputUnitContractWorkspace | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState('');
  const [form, setForm] = useState<OfficialInputUnitContractFormState>(() => ({
    ...EMPTY_OFFICIAL_INPUT_UNIT_FORM,
  }));
  const [revokeReason, setRevokeReason] = useState('');
  const [busy, setBusy] = useState<'load' | 'verify' | 'revoke' | null>(null);
  const requestEpoch = useRef(0);
  const lastReportedState = useRef('');

  const loadContracts = useCallback(async () => {
    const epoch = ++requestEpoch.current;
    const normalizedAssignmentId = assignmentId.trim();
    setWorkspace(null);
    setSelectedCandidateId('');
    setForm({ ...EMPTY_OFFICIAL_INPUT_UNIT_FORM });
    setRevokeReason('');
    if (!normalizedAssignmentId) {
      setBusy(null);
      return;
    }
    setBusy('load');
    try {
      const response = await api.get<OfficialInputUnitContractWorkspace>(
        `/api/admin/logistics-rules/official-input-unit-contracts?assignmentId=${encodeURIComponent(normalizedAssignmentId)}`,
      );
      if (epoch !== requestEpoch.current) return;
      if (response.code !== 1 || !response.data) {
        toast({
          title: '读取输入单位契约失败',
          description: `${response.msg || '请求失败'} (${responseCode(response)})`,
          variant: 'destructive',
        });
        return;
      }
      setWorkspace(response.data);
    } catch (error) {
      if (epoch !== requestEpoch.current) return;
      toast({
        title: '读取输入单位契约失败',
        description: error instanceof Error ? error.message : '网络请求失败',
        variant: 'destructive',
      });
    } finally {
      if (epoch === requestEpoch.current) setBusy(null);
    }
  }, [assignmentId]);

  useEffect(() => {
    void loadContracts();
    return () => {
      requestEpoch.current += 1;
    };
  }, [loadContracts]);

  const current = workspace?.current || null;
  const currentValid = isEffectiveOfficialInputUnitContract(current);
  const currentStateKey = workspace
    ? officialInputUnitContractStateKey(current)
    : 'loading:inactive';

  useEffect(() => {
    const reportKey = `${assignmentId.trim()}:${currentStateKey}`;
    if (lastReportedState.current === reportKey) return;
    lastReportedState.current = reportKey;
    onContractStateChange({
      contractId: workspace && current ? current.id : null,
      valid: Boolean(workspace && currentValid),
    });
  }, [assignmentId, current, currentStateKey, currentValid, onContractStateChange, workspace]);

  const selectedCandidate = useMemo(
    () =>
      workspace?.candidates.find((candidate) => candidateId(candidate) === selectedCandidateId) ||
      null,
    [selectedCandidateId, workspace?.candidates],
  );

  const verifyPayload = useMemo(
    () =>
      buildOfficialInputUnitContractVerifyPayload({
        assignmentId,
        candidateId: selectedCandidate ? candidateId(selectedCandidate) : '',
        expectedCandidateChecksum: selectedCandidate ? candidateChecksum(selectedCandidate) : '',
        weightIncrementG: form.weightIncrementG,
        dimensionIncrementMm: form.dimensionIncrementMm,
        currencyMinorIncrement: form.currencyMinorIncrement,
        unitAttested: form.unitAttested,
        reviewNote: form.reviewNote,
        expectedCurrentContractId: current?.id || null,
      }),
    [assignmentId, current?.id, form, selectedCandidate],
  );
  const revokePayload = buildOfficialInputUnitContractRevokePayload({
    reason: revokeReason,
    expectedCurrentContractId: current?.id || null,
  });

  async function verifyCandidate() {
    if (!verifyPayload) return;
    setBusy('verify');
    try {
      const response = await api.post<OfficialInputUnitContract>(
        '/api/admin/logistics-rules/official-input-unit-contracts/verify',
        verifyPayload,
      );
      if (response.code !== 1) {
        toast({
          title: '验证输入单位失败',
          description: `${response.msg || '请求失败'} (${responseCode(response)})`,
          variant: 'destructive',
        });
        return;
      }
      toast({ title: '输入单位契约已验证' });
      await loadContracts();
    } catch (error) {
      toast({
        title: '验证输入单位失败',
        description: error instanceof Error ? error.message : '网络请求失败',
        variant: 'destructive',
      });
    } finally {
      setBusy(null);
    }
  }

  async function revokeCurrent() {
    if (!current || !revokePayload) return;
    setBusy('revoke');
    try {
      const response = await api.post<OfficialInputUnitContract>(
        `/api/admin/logistics-rules/official-input-unit-contracts/${encodeURIComponent(current.id)}/revoke`,
        revokePayload,
      );
      if (response.code !== 1) {
        toast({
          title: '撤销输入单位契约失败',
          description: `${response.msg || '请求失败'} (${responseCode(response)})`,
          variant: 'destructive',
        });
        return;
      }
      toast({ title: '输入单位契约已撤销' });
      await loadContracts();
    } catch (error) {
      toast({
        title: '撤销输入单位契约失败',
        description: error instanceof Error ? error.message : '网络请求失败',
        variant: 'destructive',
      });
    } finally {
      setBusy(null);
    }
  }

  const scope = contractScope(workspace);
  const destination = contractDestination(workspace);
  const policyDays = workspace?.policy.defaultValidityDays ?? 7;

  return (
    <section aria-labelledby="official-input-unit-title" className="space-y-5 border-y py-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Ruler className="h-4 w-4" />
          <h2 id="official-input-unit-title" className="text-base font-semibold">
            Official 输入单位契约
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">默认有效 {policyDays} 天</Badge>
          <Badge variant={currentValid ? 'success' : 'secondary'}>
            {busy === 'load' ? '读取中' : currentValid ? '当前有效' : current ? '当前无效' : '尚未验证'}
          </Badge>
          <Button
            variant="outline"
            size="icon"
            title="刷新单位契约"
            onClick={() => void loadContracts()}
            disabled={!assignmentId.trim() || busy !== null}
          >
            <RefreshCw className={`h-4 w-4 ${busy === 'load' ? 'animate-spin' : ''}`} />
            <span className="sr-only">刷新单位契约</span>
          </Button>
        </div>
      </div>

      <dl className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
        <div>
          <dt className="text-xs text-muted-foreground">Assignment</dt>
          <dd className="mt-1 break-all font-mono text-xs">{assignmentId || '-'}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">ERP 店铺 / Ozon 公司</dt>
          <dd className="mt-1">{stringValue(scope.shopId)} / {stringValue(scope.companyId)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">仓库 / 始发城市</dt>
          <dd className="mt-1">{stringValue(scope.warehouseId)} / {stringValue(scope.originCityUid)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">目的国家 / 地点</dt>
          <dd className="mt-1">
            {stringValue(destination.countryUid)} / {stringValue(destination.locationUid)}
          </dd>
        </div>
      </dl>

      <div className="space-y-3 border-t pt-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">当前契约</h3>
          {currentValid ? (
            <span className="flex items-center gap-1.5 text-xs text-emerald-700">
              <CheckCircle2 className="h-4 w-4" />矩阵可用
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-xs text-amber-700">
              <AlertTriangle className="h-4 w-4" />矩阵已锁定
            </span>
          )}
        </div>
        {current ? (
          <dl className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">状态 / ID</dt>
              <dd className="mt-1">{current.state || current.status} · <span className="font-mono text-xs">{current.id}</span></dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">单位</dt>
              <dd className="mt-1">
                {current.currency || 'CNY'} · {current.weightUnit || 'g'} · {current.dimensionUnit || 'mm'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">已验证步进</dt>
              <dd className="mt-1">
                {current.weightIncrementG ?? '-'} g / {current.dimensionIncrementMm ?? '-'} mm / {current.currencyMinorIncrement ?? '-'} 分
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Checksum / 有效期</dt>
              <dd className="mt-1 font-mono text-xs">{shortChecksum(current.sourceChecksum)}</dd>
              <dd className="mt-1 text-xs text-muted-foreground">{formatDate(current.validUntil)}</dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">当前 assignment 没有有效的输入单位契约。</p>
        )}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="space-y-3">
          <h3 className="text-sm font-semibold">待验证候选</h3>
          <div className="divide-y border-y">
            {!workspace?.candidates.length && (
              <div className="px-3 py-7 text-center text-sm text-muted-foreground">暂无候选</div>
            )}
            {workspace?.candidates.map((candidate) => {
              const id = candidateId(candidate);
              const checksum = candidateChecksum(candidate);
              return (
                <label key={`${id}:${checksum}`} className="grid cursor-pointer gap-2 px-3 py-3 hover:bg-muted/50 sm:grid-cols-[1.5rem_minmax(0,1fr)_8rem] sm:items-center">
                  <input
                    type="radio"
                    name="official-input-unit-candidate"
                    value={id}
                    checked={selectedCandidateId === id}
                    onChange={() => setSelectedCandidateId(id)}
                    className="h-4 w-4 accent-primary"
                  />
                  <span className="min-w-0">
                    <span className="block truncate font-mono text-xs" title={id}>{id}</span>
                    <span className="mt-1 block truncate font-mono text-xs text-muted-foreground" title={checksum}>
                      {shortChecksum(checksum)}
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {candidate.status || candidate.reviewStatus || 'CANDIDATE'} · {candidateDate(candidate)}
                  </span>
                </label>
              );
            })}
          </div>
        </div>

        <div className="space-y-3 border-t pt-4 xl:border-l xl:border-t-0 xl:pl-5 xl:pt-0">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" />
            <h3 className="text-sm font-semibold">验证输入单位</h3>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {([
              ['weightIncrementG', '重量 (g)'],
              ['dimensionIncrementMm', '尺寸 (mm)'],
              ['currencyMinorIncrement', '价格 (分)'],
            ] as const).map(([field, label]) => (
              <div key={field} className="space-y-1.5">
                <Label htmlFor={`official-unit-${field}`} className="text-xs">{label}</Label>
                <Input
                  id={`official-unit-${field}`}
                  type="number"
                  min={field === 'currencyMinorIncrement' ? '1' : '0.000000001'}
                  step={field === 'currencyMinorIncrement' ? '1' : 'any'}
                  inputMode={field === 'currencyMinorIncrement' ? 'numeric' : 'decimal'}
                  value={form[field]}
                  onChange={(event) => setForm((currentForm) => ({ ...currentForm, [field]: event.target.value }))}
                  placeholder="留空"
                />
              </div>
            ))}
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.unitAttested}
              onChange={(event) => setForm((currentForm) => ({ ...currentForm, unitAttested: event.target.checked }))}
              className="mt-0.5 h-4 w-4 accent-primary"
            />
            <span>已确认 Official 输入为 CNY、g、mm，价格请求单位为 CNY_MAJOR</span>
          </label>
          <div className="space-y-1.5">
            <Label htmlFor="official-unit-review-note">审核说明</Label>
            <textarea
              id="official-unit-review-note"
              value={form.reviewNote}
              onChange={(event) => setForm((currentForm) => ({ ...currentForm, reviewNote: event.target.value }))}
              maxLength={1000}
              className="min-h-20 w-full resize-y rounded-md border bg-background px-3 py-2 text-sm"
              placeholder="记录对照的请求、响应和结论"
            />
          </div>
          <Button onClick={() => void verifyCandidate()} disabled={!verifyPayload || busy !== null} className="w-full">
            {busy === 'verify' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            验证并设为 current
          </Button>
        </div>
      </div>

      {current && (
        <div className="grid gap-3 border-t pt-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="official-unit-revoke-reason">撤销原因</Label>
            <Input
              id="official-unit-revoke-reason"
              value={revokeReason}
              onChange={(event) => setRevokeReason(event.target.value)}
              maxLength={1000}
              placeholder="至少 5 个字符"
            />
          </div>
          <Button
            variant="destructive"
            onClick={() => void revokeCurrent()}
            disabled={!revokePayload || busy !== null}
          >
            {busy === 'revoke' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}
            撤销 current
          </Button>
        </div>
      )}

      <details className="border-t pt-3">
        <summary className="cursor-pointer text-sm font-medium">历史契约（{workspace?.history.length || 0}）</summary>
        <div className="mt-3 divide-y border-y">
          {!workspace?.history.length && (
            <div className="px-3 py-5 text-center text-sm text-muted-foreground">暂无历史契约</div>
          )}
          {workspace?.history.map((contract) => (
            <div key={contract.id} className="grid gap-2 px-3 py-3 text-xs sm:grid-cols-[8rem_minmax(0,1fr)_10rem] sm:items-center">
              <Badge variant={isEffectiveOfficialInputUnitContract(contract) ? 'success' : 'secondary'}>{contract.state || contract.status}</Badge>
              <span className="min-w-0 truncate font-mono" title={contract.id}>
                {contract.id} · {shortChecksum(contract.sourceChecksum)}
              </span>
              <span className="text-muted-foreground">{formatDate(contract.validUntil)}</span>
            </div>
          ))}
        </div>
      </details>
    </section>
  );
}
