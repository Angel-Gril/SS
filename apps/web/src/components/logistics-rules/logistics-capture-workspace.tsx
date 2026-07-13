'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  ClipboardCheck,
  FileJson,
  Eye,
  FlaskConical,
  Loader2,
  Snowflake,
  RefreshCw,
  Send,
  XCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/use-toast';
import { api, type ApiResponse } from '@/lib/api';
import {
  OfficialInputUnitContractPanel,
  type OfficialInputUnitContractGateState,
} from './official-input-unit-contract-panel';

const SELLER_ENDPOINTS = [
  'seller/template/by-location',
  'seller/provider-inventory',
] as const;

type CaptureTaskStatus = 'ISSUED' | 'CLAIMED' | 'REVIEWABLE' | 'CANCELLED';

interface CaptureScope {
  tenantId: string;
  shopId: string;
  companyId: string;
  warehouseId: string;
  originCountryUid: string;
  originCityUid: string;
}

interface CaptureDestination {
  countryUid: string;
  locationUid: string;
}

interface OfficialFingerprint {
  originCountryUid: string;
  originCityUid: string;
  destinationCountryUid: string;
  destinationLocationUid: string;
  currency: string;
  declaredPriceMinor: string;
  weightGrams: string;
  dimensionsMm: {
    length: string;
    width: string;
    height: string;
  };
  batteryMode: 'UNSPECIFIED' | 'NONE' | 'CONTAINS_BATTERY';
}

interface CaptureTask {
  id: string;
  version: string;
  kind: 'SELLER' | 'OFFICIAL';
  scope: CaptureScope;
  destination: CaptureDestination | null;
  officialFingerprint: OfficialFingerprint | null;
  expectedEndpoints: string[];
  fingerprintChecksum: string;
  status: CaptureTaskStatus;
  candidate: {
    candidateId: string;
    state: string;
    reviewStatus: string;
    responseChecksum: string;
    reviewedAt: string | null;
  } | null;
  progress: {
    phase: string;
    completed: boolean;
    percent: number;
  };
  issuedAt: string;
  expiresAt: string;
  claimedAt: string | null;
  uploadedAt: string | null;
  reviewableAt: string | null;
}

interface ReviewCandidate {
  candidateId: string;
  taskId: string;
  taskKind: 'SELLER' | 'OFFICIAL';
  tenantId: string;
  shopId: string;
  companyId: string;
  warehouseId: string;
  originCountryUid: string;
  originCityUid: string;
  destination: CaptureDestination | null;
  state: string;
  reviewStatus: 'PENDING_REVIEW' | 'VERIFIED' | 'REJECTED';
  responseChecksum: string;
  previousResponseChecksum: string | null;
  receivedAt: string;
  sourceResponseChecksum?: string | null;
  capturedAt?: string | null;
  quarantineReasons?: string[];
  normalizedPayload?: Record<string, unknown> | null;
  diagnostics?: Record<string, unknown>;
  reviewReason?: string | null;
}
interface SellerServiceOption {
  stableServiceKey: string;
  normalizedDescription: string;
  providerId: string;
  deliveryVariant: string;
}

interface CaptureMatrixPreview {
  sellerCandidateId: string;
  assignmentId: string;
  channelId: string;
  selectedServiceKeys: string[];
  matrix: {
    blockers: unknown[];
    requirements?: unknown[];
  };
  requiredFingerprints: Array<{
    fingerprintKey: string;
    fingerprint: Record<string, unknown>;
  }>;
  pointEvidence: {
    status: string;
    originBindingId: string;
    sellerPoint: { latitude: number; longitude: number };
    warehousePoint: { latitude: number; longitude: number };
    distanceKm: number;
    toleranceKm: number;
  };
  minExtensionVersion: string;
}

interface FrozenCandidateSet {
  id: string;
  contentChecksum: string;
  selectedServiceKeys: string[];
  defaultServiceKeys: string[];
  officialCandidates?: Array<{ candidateId: string; fingerprintKey: string }>;
}

interface CaptureDraftResult {
  id: string;
  candidateSetId: string;
}

interface LogisticsCaptureWorkspaceProps {
  initialScope?: Partial<CaptureScope>;
  initialDestination?: Partial<CaptureDestination>;
  channelId: string;
  assignmentId: string;
  onDraftCreated?: (revisionId: string) => void;
}

const EMPTY_SCOPE: CaptureScope = {
  tenantId: '',
  shopId: '',
  companyId: '',
  warehouseId: '',
  originCountryUid: '',
  originCityUid: '',
};

const EMPTY_DESTINATION: CaptureDestination = {
  countryUid: '',
  locationUid: '',
};

const TASK_STATUS_LABELS: Record<CaptureTaskStatus | 'EXPIRED', string> = {
  ISSUED: '已签发',
  CLAIMED: '采集中',
  REVIEWABLE: '待审核',
  CANCELLED: '已取消',
  EXPIRED: '已过期',
};

function responseCode(response: ApiResponse<unknown>): string {
  const error = (response as ApiResponse<unknown> & { error?: { code?: string } }).error;
  return String(error?.code || 'REQUEST_FAILED');
}

function formatDate(value?: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false });
}

function short(value?: string | null): string {
  if (!value) return '-';
  return value.length > 22 ? `${value.slice(0, 12)}…${value.slice(-7)}` : value;
}

function effectiveStatus(task: CaptureTask): CaptureTaskStatus | 'EXPIRED' {
  if (
    (task.status === 'ISSUED' || task.status === 'CLAIMED') &&
    new Date(task.expiresAt).getTime() <= Date.now()
  )
    return 'EXPIRED';
  return task.status;
}

function statusBadge(task: CaptureTask) {
  const status = effectiveStatus(task);
  const variant =
    status === 'REVIEWABLE'
      ? 'success'
      : status === 'CANCELLED' || status === 'EXPIRED'
        ? 'secondary'
        : 'outline';
  return <Badge variant={variant}>{TASK_STATUS_LABELS[status]}</Badge>;
}

function sellerServiceOptions(candidate: ReviewCandidate | null): SellerServiceOption[] {
  if (!candidate || candidate.taskKind !== 'SELLER' || candidate.reviewStatus !== 'VERIFIED') {
    return [];
  }
  const services = candidate.normalizedPayload?.services;
  if (!Array.isArray(services)) return [];
  const byKey = new Map<string, SellerServiceOption>();
  for (const value of services) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const service = value as Record<string, unknown>;
    const stableServiceKey = String(service.stableServiceKey || '').trim();
    if (!stableServiceKey || byKey.has(stableServiceKey)) continue;
    byKey.set(stableServiceKey, {
      stableServiceKey,
      normalizedDescription: String(service.normalizedDescription || stableServiceKey),
      providerId: String(service.providerId ?? '-'),
      deliveryVariant: String(service.deliveryVariant || '-'),
    });
  }
  return [...byKey.values()].sort((left, right) =>
    left.stableServiceKey.localeCompare(right.stableServiceKey),
  );
}

function matrixBlockerLabel(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '未知矩阵阻断';
  const item = value as Record<string, unknown>;
  return String(item.message || item.code || JSON.stringify(item));
}

function ScopeField({
  id,
  label,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

export function LogisticsCaptureWorkspace({
  initialScope,
  initialDestination,
  channelId,
  assignmentId,
  onDraftCreated,
}: LogisticsCaptureWorkspaceProps) {
  const [scope, setScope] = useState<CaptureScope>({ ...EMPTY_SCOPE, ...initialScope });
  const [destination, setDestination] = useState<CaptureDestination>({
    ...EMPTY_DESTINATION,
    ...initialDestination,
  });
  const [fingerprint, setFingerprint] = useState({
    currency: 'CNY',
    declaredPriceMinor: '10000',
    weightGrams: '1000',
    length: '300',
    width: '200',
    height: '100',
    batteryMode: 'NONE' as OfficialFingerprint['batteryMode'],
  });
  const [tasks, setTasks] = useState<CaptureTask[]>([]);
  const [taskFilter, setTaskFilter] = useState<CaptureTaskStatus | ''>('');
  const [selectedTask, setSelectedTask] = useState<CaptureTask | null>(null);
  const [candidates, setCandidates] = useState<ReviewCandidate[]>([]);
  const [selectedCandidate, setSelectedCandidate] = useState<ReviewCandidate | null>(null);
  const [reviewReason, setReviewReason] = useState('');
  const [selectedSellerCandidateId, setSelectedSellerCandidateId] = useState('');
  const [sellerCandidate, setSellerCandidate] = useState<ReviewCandidate | null>(null);
  const [serviceSearch, setServiceSearch] = useState('');
  const [selectedServiceKeys, setSelectedServiceKeys] = useState<string[]>([]);
  const [defaultServiceKeys, setDefaultServiceKeys] = useState<string[]>([]);
  const [matrixPreview, setMatrixPreview] = useState<CaptureMatrixPreview | null>(null);
  const [frozenCandidateSet, setFrozenCandidateSet] = useState<FrozenCandidateSet | null>(null);
  const [createdDraft, setCreatedDraft] = useState<CaptureDraftResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [officialInputUnitContractState, setOfficialInputUnitContractState] =
    useState<OfficialInputUnitContractGateState>({ contractId: null, valid: false });

  useEffect(() => {
    setScope({ ...EMPTY_SCOPE, ...initialScope });
  }, [
    initialScope?.tenantId,
    initialScope?.shopId,
    initialScope?.companyId,
    initialScope?.warehouseId,
    initialScope?.originCountryUid,
    initialScope?.originCityUid,
  ]);

  useEffect(() => {
    setDestination({ ...EMPTY_DESTINATION, ...initialDestination });
  }, [initialDestination?.countryUid, initialDestination?.locationUid]);

  const scopeReady = useMemo(
    () => Object.values(scope).every((value) => value.trim().length > 0),
    [scope],
  );
  const officialReady =
    scopeReady &&
    destination.countryUid.trim().length > 0 &&
    destination.locationUid.trim().length > 0 &&
    /^[A-Z]{3}$/.test(fingerprint.currency) &&
    /^\d+$/.test(fingerprint.declaredPriceMinor) &&
    /^[1-9]\d*$/.test(fingerprint.weightGrams) &&
    [fingerprint.length, fingerprint.width, fingerprint.height].every((value) =>
      /^[1-9]\d*$/.test(value),
    );

  const verifiedSellerTasks = useMemo(
    () =>
      tasks.filter(
        (task) =>
          task.kind === 'SELLER' &&
          task.candidate?.reviewStatus === 'VERIFIED' &&
          !!task.candidate.candidateId,
      ),
    [tasks],
  );
  const sellerServices = useMemo(() => sellerServiceOptions(sellerCandidate), [sellerCandidate]);
  const visibleSellerServices = useMemo(() => {
    const query = serviceSearch.trim().toLowerCase();
    if (!query) return sellerServices;
    return sellerServices.filter((service) =>
      [
        service.stableServiceKey,
        service.normalizedDescription,
        service.providerId,
        service.deliveryVariant,
      ].some((value) => value.toLowerCase().includes(query)),
    );
  }, [sellerServices, serviceSearch]);
  const baseProduct = useMemo(
    () => ({
      declaredPriceMinor: fingerprint.declaredPriceMinor.trim(),
      weightGrams: fingerprint.weightGrams.trim(),
      dimensionsMm: {
        length: fingerprint.length.trim(),
        width: fingerprint.width.trim(),
        height: fingerprint.height.trim(),
      },
      batteryMode: fingerprint.batteryMode,
    }),
    [
      fingerprint.batteryMode,
      fingerprint.declaredPriceMinor,
      fingerprint.height,
      fingerprint.length,
      fingerprint.weightGrams,
      fingerprint.width,
    ],
  );
  const baseProductReady =
    /^\d+$/.test(baseProduct.declaredPriceMinor) &&
    /^[1-9]\d*$/.test(baseProduct.weightGrams) &&
    Object.values(baseProduct.dimensionsMm).every((value) => /^[1-9]\d*$/.test(value));
  const matrixBlockers = matrixPreview?.matrix.blockers || [];
  const matrixReady =
    !!sellerCandidate &&
    sellerServices.length > 0 &&
    officialInputUnitContractState.valid &&
    selectedServiceKeys.length > 0 &&
    !!assignmentId.trim() &&
    baseProductReady;

  useEffect(() => {
    setMatrixPreview(null);
    setFrozenCandidateSet(null);
    setCreatedDraft(null);
  }, [
    assignmentId,
    baseProduct,
    defaultServiceKeys,
    selectedSellerCandidateId,
    selectedServiceKeys,
  ]);
  const handleOfficialInputUnitContractStateChange = useCallback(
    (state: OfficialInputUnitContractGateState) => {
      setOfficialInputUnitContractState(state);
      setMatrixPreview(null);
      setFrozenCandidateSet(null);
      setCreatedDraft(null);
    },
    [],
  );

  async function perform<T>(
    action: string,
    label: string,
    request: () => Promise<ApiResponse<T>>,
  ): Promise<T | null> {
    setBusy(action);
    try {
      const response = await request();
      if (response.code !== 1 || response.data === undefined) {
        toast({
          title: `${label}失败`,
          description: `${response.msg || '请求失败'} (${responseCode(response)})`,
          variant: 'destructive',
        });
        return null;
      }
      return response.data;
    } catch (error) {
      toast({
        title: `${label}失败`,
        description: error instanceof Error ? error.message : '网络请求失败',
        variant: 'destructive',
      });
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function loadTasks() {
    if (!scope.tenantId.trim() || !scope.shopId.trim()) return;
    const query = new URLSearchParams({
      tenantId: scope.tenantId.trim(),
      shopId: scope.shopId.trim(),
      limit: '100',
    });
    if (taskFilter) query.set('status', taskFilter);
    const data = await perform('tasks', '刷新采集任务', () =>
      api.get<{ tasks: CaptureTask[] }>(
        `/api/admin/logistics-rules/capture-tasks?${query.toString()}`,
      ),
    );
    if (data) setTasks(data.tasks);
  }

  async function loadCandidates() {
    if (!scope.tenantId.trim() || !scope.shopId.trim()) return;
    const query = new URLSearchParams({
      tenantId: scope.tenantId.trim(),
      shopId: scope.shopId.trim(),
      limit: '100',
    });
    const data = await perform('candidates', '刷新待审核候选', () =>
      api.get<{ candidates: ReviewCandidate[] }>(
        `/api/admin/logistics-rules/capture-tasks/reviewable?${query.toString()}`,
      ),
    );
    if (data) setCandidates(data.candidates);
  }

  async function issueSellerTask() {
    if (!scopeReady) return;
    const task = await perform('seller', '签发 Seller 采集任务', () =>
      api.post<CaptureTask>('/api/admin/logistics-rules/capture-tasks/seller', {
        scope,
        expectedEndpoints: [...SELLER_ENDPOINTS],
      }),
    );
    if (!task) return;
    toast({ title: 'Seller 采集任务已签发', description: task.id });
    await loadTasks();
  }

  async function issueOfficialTask() {
    if (!officialReady) return;
    const officialFingerprint: OfficialFingerprint = {
      originCountryUid: scope.originCountryUid.trim(),
      originCityUid: scope.originCityUid.trim(),
      destinationCountryUid: destination.countryUid.trim(),
      destinationLocationUid: destination.locationUid.trim(),
      currency: fingerprint.currency.trim(),
      declaredPriceMinor: fingerprint.declaredPriceMinor.trim(),
      weightGrams: fingerprint.weightGrams.trim(),
      dimensionsMm: {
        length: fingerprint.length.trim(),
        width: fingerprint.width.trim(),
        height: fingerprint.height.trim(),
      },
      batteryMode: fingerprint.batteryMode,
    };
    const task = await perform('official', '签发 Official 报价采集任务', () =>
      api.post<CaptureTask>('/api/admin/logistics-rules/capture-tasks/official', {
        scope,
        destination,
        fingerprint: officialFingerprint,
      }),
    );
    if (!task) return;
    toast({ title: 'Official 采集任务已签发', description: task.id });
    await loadTasks();
  }

  async function loadTaskDetail(taskId: string) {
    const task = await perform('task-detail', '读取任务详情', () =>
      api.get<CaptureTask>(
        `/api/admin/logistics-rules/capture-tasks/${encodeURIComponent(taskId)}`,
      ),
    );
    if (task) setSelectedTask(task);
  }

  async function cancelTask(taskId: string) {
    const task = await perform('cancel', '取消采集任务', () =>
      api.post<CaptureTask>(
        `/api/admin/logistics-rules/capture-tasks/${encodeURIComponent(taskId)}/cancel`,
        {},
      ),
    );
    if (!task) return;
    setSelectedTask(task);
    await loadTasks();
  }

  async function loadCandidateDetail(candidateId: string) {
    const candidate = await perform('candidate-detail', '读取候选详情', () =>
      api.get<ReviewCandidate>(
        `/api/admin/logistics-rules/capture-tasks/reviewable/${encodeURIComponent(candidateId)}`,
      ),
    );
    if (candidate) {
      setSelectedCandidate(candidate);
      setReviewReason('');
    }
  }

  async function reviewCandidate(decision: 'verify' | 'reject') {
    if (!selectedCandidate || reviewReason.trim().length < 3) return;
    const reviewPath =
      decision === 'verify'
        ? `/api/admin/logistics-rules/capture-tasks/reviewable/${encodeURIComponent(selectedCandidate.candidateId)}/verify`
        : `/api/admin/logistics-rules/capture-tasks/reviewable/${encodeURIComponent(selectedCandidate.candidateId)}/reject`;
    const candidate = await perform('review', decision === 'verify' ? '确认候选' : '拒绝候选', () =>
      api.post<ReviewCandidate>(reviewPath, { reason: reviewReason.trim() }),
    );
    if (!candidate) return;
    setSelectedCandidate(candidate);
    if (decision === 'verify' && candidate.taskKind === 'SELLER') {
      setSelectedSellerCandidateId(candidate.candidateId);
      setSellerCandidate(candidate);
      setSelectedServiceKeys([]);
      setDefaultServiceKeys([]);
    }
    setReviewReason('');
    await Promise.all([loadCandidates(), loadTasks()]);
  }
  async function selectVerifiedSellerCandidate(candidateId: string) {
    setSelectedSellerCandidateId(candidateId);
    setSellerCandidate(null);
    setSelectedServiceKeys([]);
    setDefaultServiceKeys([]);
    setServiceSearch('');
    if (!candidateId) return;
    const candidate = await perform('seller-detail', '读取已审核 Seller 候选', () =>
      api.get<ReviewCandidate>(
        `/api/admin/logistics-rules/capture-tasks/reviewable/${encodeURIComponent(candidateId)}`,
      ),
    );
    if (
      !candidate ||
      candidate.taskKind !== 'SELLER' ||
      candidate.reviewStatus !== 'VERIFIED' ||
      sellerServiceOptions(candidate).length === 0
    ) {
      if (candidate) {
        toast({
          title: 'Seller 候选不可用于矩阵',
          description: '候选必须已审核通过，并包含服务端归一化 services。',
          variant: 'destructive',
        });
      }
      return;
    }
    setSellerCandidate(candidate);
  }

  function toggleSelectedService(stableServiceKey: string, checked: boolean) {
    setSelectedServiceKeys((current) =>
      checked
        ? [...new Set([...current, stableServiceKey])].sort()
        : current.filter((key) => key !== stableServiceKey),
    );
    if (!checked) {
      setDefaultServiceKeys((current) => current.filter((key) => key !== stableServiceKey));
    }
  }

  function toggleDefaultService(stableServiceKey: string, checked: boolean) {
    if (!selectedServiceKeys.includes(stableServiceKey)) return;
    setDefaultServiceKeys((current) =>
      checked
        ? [...new Set([...current, stableServiceKey])].sort()
        : current.filter((key) => key !== stableServiceKey),
    );
  }

  async function previewCaptureMatrix() {
    if (!matrixReady) return;
    const sellerCandidateId = selectedSellerCandidateId;
    const preview = await perform('matrix-preview', '生成验证矩阵', () =>
      api.post<CaptureMatrixPreview>('/api/admin/logistics-rules/capture-tasks/matrix-preview', {
        sellerCandidateId,
        assignmentId,
        selectedServiceKeys,
        baseProduct,
      }),
    );
    if (!preview) return;
    setMatrixPreview(preview);
    setFrozenCandidateSet(null);
    setCreatedDraft(null);
  }

  async function freezeCaptureCandidateSet() {
    if (
      !matrixReady ||
      !matrixPreview ||
      matrixPreview.matrix.blockers.length > 0 ||
      defaultServiceKeys.length === 0
    ) {
      return;
    }
    const sellerCandidateId = selectedSellerCandidateId;
    const result = await perform('candidate-set', '冻结 CandidateSet', () =>
      api.post<{ candidateSet: FrozenCandidateSet; duplicate: boolean }>(
        '/api/admin/logistics-rules/capture-tasks/candidate-sets',
        {
          sellerCandidateId,
          assignmentId,
          selectedServiceKeys,
          baseProduct,
          defaultServiceKeys,
        },
      ),
    );
    if (!result) return;
    setFrozenCandidateSet(result.candidateSet);
    setCreatedDraft(null);
    toast({
      title: result.duplicate ? '已复用相同 CandidateSet' : 'CandidateSet 已冻结',
      description: result.candidateSet.id,
    });
  }

  async function createCaptureDraft() {
    if (!frozenCandidateSet) return;
    const draft = await perform('capture-draft', '创建物流规则草稿', () =>
      api.post<CaptureDraftResult>('/api/admin/logistics-rules/capture-tasks/drafts', {
        candidateSetId: frozenCandidateSet.id,
      }),
    );
    if (!draft) return;
    setCreatedDraft(draft);
    toast({ title: '物流规则草稿已创建', description: draft.id });
    if (onDraftCreated) onDraftCreated(draft.id);
  }

  return (
    <div className="space-y-8">
      <section aria-labelledby="capture-scope-title" className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="capture-scope-title" className="text-base font-semibold">
              采集作用域
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              当前 channel {channelId || '-'} · assignment {assignmentId || '-'}
            </p>
          </div>
          <Badge variant={scopeReady ? 'success' : 'secondary'}>
            {scopeReady ? '作用域完整' : '待补全'}
          </Badge>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <ScopeField
            id="capture-tenant"
            label="ERP 租户"
            value={scope.tenantId}
            onChange={(value) => setScope((current) => ({ ...current, tenantId: value }))}
          />
          <ScopeField
            id="capture-shop"
            label="ERP 店铺"
            value={scope.shopId}
            onChange={(value) => setScope((current) => ({ ...current, shopId: value }))}
          />
          <ScopeField
            id="capture-company"
            label="Ozon company_id"
            value={scope.companyId}
            onChange={(value) => setScope((current) => ({ ...current, companyId: value }))}
          />
          <ScopeField
            id="capture-warehouse"
            label="ERP 仓库"
            value={scope.warehouseId}
            onChange={(value) => setScope((current) => ({ ...current, warehouseId: value }))}
          />
          <ScopeField
            id="capture-origin-country"
            label="始发国家 UID"
            value={scope.originCountryUid}
            onChange={(value) => setScope((current) => ({ ...current, originCountryUid: value }))}
          />
          <ScopeField
            id="capture-origin-city"
            label="始发城市 UID"
            value={scope.originCityUid}
            onChange={(value) => setScope((current) => ({ ...current, originCityUid: value }))}
          />
        </div>
      </section>

      <section aria-labelledby="capture-issue-title" className="space-y-4 border-y py-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="capture-issue-title" className="text-base font-semibold">
            签发采集测试
          </h2>
          <Button
            variant="outline"
            onClick={() => {
              void Promise.all([loadTasks(), loadCandidates()]);
            }}
            disabled={!scope.tenantId || !scope.shopId || busy !== null}
          >
            <RefreshCw className="h-4 w-4" />
            刷新任务与候选
          </Button>
        </div>
        <div className="grid gap-6 xl:grid-cols-2">
          <div className="space-y-3 border-t pt-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">Seller 公式与物流模板</h3>
              <Badge variant="outline">{SELLER_ENDPOINTS.length} 个端点</Badge>
            </div>
            <div className="grid gap-1 font-mono text-[11px] text-muted-foreground">
              {SELLER_ENDPOINTS.map((endpoint) => (
                <span key={endpoint}>{endpoint}</span>
              ))}
            </div>
            <Button
              onClick={() => {
                void issueSellerTask();
              }}
              disabled={!scopeReady || busy !== null}
            >
              {busy === 'seller' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              签发 Seller 任务
            </Button>
          </div>

          <div className="space-y-3 border-t pt-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">Official 报价校验样本</h3>
              <Badge variant={officialReady ? 'outline' : 'secondary'}>完整指纹</Badge>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <ScopeField
                id="capture-destination-country"
                label="目的国家 UID"
                value={destination.countryUid}
                onChange={(value) =>
                  setDestination((current) => ({ ...current, countryUid: value }))
                }
              />
              <ScopeField
                id="capture-destination-location"
                label="目的城市 UID"
                value={destination.locationUid}
                onChange={(value) =>
                  setDestination((current) => ({ ...current, locationUid: value }))
                }
              />
              <ScopeField
                id="capture-price"
                label="申报价（最小币种单位）"
                value={fingerprint.declaredPriceMinor}
                onChange={(value) =>
                  setFingerprint((current) => ({ ...current, declaredPriceMinor: value }))
                }
              />
              <ScopeField
                id="capture-weight"
                label="重量（克）"
                value={fingerprint.weightGrams}
                onChange={(value) =>
                  setFingerprint((current) => ({ ...current, weightGrams: value }))
                }
              />
              <ScopeField
                id="capture-length"
                label="长（毫米）"
                value={fingerprint.length}
                onChange={(value) => setFingerprint((current) => ({ ...current, length: value }))}
              />
              <ScopeField
                id="capture-width"
                label="宽（毫米）"
                value={fingerprint.width}
                onChange={(value) => setFingerprint((current) => ({ ...current, width: value }))}
              />
              <ScopeField
                id="capture-height"
                label="高（毫米）"
                value={fingerprint.height}
                onChange={(value) => setFingerprint((current) => ({ ...current, height: value }))}
              />
              <div className="space-y-1.5">
                <Label htmlFor="capture-currency">币种 / 电池</Label>
                <div className="grid grid-cols-[5rem_1fr] gap-2">
                  <Input
                    id="capture-currency"
                    value={fingerprint.currency}
                    maxLength={3}
                    onChange={(event) =>
                      setFingerprint((current) => ({
                        ...current,
                        currency: event.target.value.toUpperCase(),
                      }))
                    }
                  />
                  <select
                    value={fingerprint.batteryMode}
                    onChange={(event) =>
                      setFingerprint((current) => ({
                        ...current,
                        batteryMode: event.target.value as OfficialFingerprint['batteryMode'],
                      }))
                    }
                    className="h-9 rounded-md border bg-background px-2 text-sm"
                  >
                    <option value="NONE">无电池</option>
                    <option value="CONTAINS_BATTERY">含电池</option>
                    <option value="UNSPECIFIED">未指定</option>
                  </select>
                </div>
              </div>
            </div>
            <Button
              onClick={() => {
                void issueOfficialTask();
              }}
              disabled={!officialReady || busy !== null}
            >
              {busy === 'official' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FlaskConical className="h-4 w-4" />
              )}
              签发 Official 任务
            </Button>
          </div>
        </div>
      </section>

      <section aria-labelledby="capture-task-list-title" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="capture-task-list-title" className="text-base font-semibold">
            采集任务
          </h2>
          <div className="flex items-center gap-2">
            <select
              value={taskFilter}
              onChange={(event) => setTaskFilter(event.target.value as CaptureTaskStatus | '')}
              className="h-9 rounded-md border bg-background px-3 text-sm"
            >
              <option value="">全部状态</option>
              <option value="ISSUED">已签发</option>
              <option value="CLAIMED">采集中</option>
              <option value="REVIEWABLE">待审核</option>
              <option value="CANCELLED">已取消</option>
            </select>
            <Button
              variant="outline"
              size="icon"
              title="刷新任务"
              onClick={() => {
                void loadTasks();
              }}
              disabled={busy !== null}
            >
              <RefreshCw className="h-4 w-4" />
              <span className="sr-only">刷新任务</span>
            </Button>
          </div>
        </div>
        <div className="divide-y border-y">
          {tasks.length === 0 && (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">暂无任务</div>
          )}
          {tasks.map((task) => (
            <div
              key={task.id}
              className="grid gap-3 px-3 py-3 lg:grid-cols-[7rem_minmax(0,1fr)_8rem_7rem] lg:items-center"
            >
              <div className="flex items-center gap-2">
                {statusBadge(task)}
                <Badge variant="outline">{task.kind}</Badge>
              </div>
              <div className="min-w-0">
                <div className="truncate font-mono text-xs" title={task.id}>
                  {task.id}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {task.scope.companyId} · {task.scope.warehouseId} · {task.progress.percent}%
                </div>
              </div>
              <div className="text-xs text-muted-foreground">{formatDate(task.issuedAt)}</div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  void loadTaskDetail(task.id);
                }}
              >
                <Eye className="h-4 w-4" />
                详情
              </Button>
            </div>
          ))}
        </div>
      </section>

      {selectedTask && (
        <section aria-labelledby="capture-task-detail-title" className="space-y-3 border-y py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 id="capture-task-detail-title" className="text-sm font-semibold">
                任务详情
              </h2>
              <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                {selectedTask.id}
              </p>
            </div>
            <div className="flex gap-2">
              {statusBadge(selectedTask)}
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void cancelTask(selectedTask.id);
                }}
                disabled={busy !== null || !['ISSUED', 'CLAIMED'].includes(selectedTask.status)}
              >
                <XCircle className="h-4 w-4" />
                取消任务
              </Button>
            </div>
          </div>
          <dl className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">指纹 checksum</dt>
              <dd className="mt-1 font-mono text-xs">{short(selectedTask.fingerprintChecksum)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">候选</dt>
              <dd className="mt-1 font-mono text-xs">
                {selectedTask.candidate?.candidateId || '-'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">领取</dt>
              <dd className="mt-1">{formatDate(selectedTask.claimedAt)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">回传</dt>
              <dd className="mt-1">{formatDate(selectedTask.uploadedAt)}</dd>
            </div>
          </dl>
        </section>
      )}

      <section aria-labelledby="capture-review-title" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="capture-review-title" className="text-base font-semibold">
            候选审核
          </h2>
          <Button
            variant="outline"
            onClick={() => {
              void loadCandidates();
            }}
            disabled={busy !== null}
          >
            <RefreshCw className="h-4 w-4" />
            刷新候选
          </Button>
        </div>
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
          <div className="divide-y border-y">
            {candidates.length === 0 && (
              <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                暂无待审核候选
              </div>
            )}
            {candidates.map((candidate) => (
              <button
                key={candidate.candidateId}
                type="button"
                onClick={() => {
                  void loadCandidateDetail(candidate.candidateId);
                }}
                className="grid w-full gap-2 px-3 py-3 text-left hover:bg-muted/50 sm:grid-cols-[6rem_minmax(0,1fr)_8rem] sm:items-center"
              >
                <Badge variant={candidate.taskKind === 'SELLER' ? 'outline' : 'secondary'}>
                  {candidate.taskKind}
                </Badge>
                <span className="min-w-0">
                  <span className="block truncate font-mono text-xs">{candidate.candidateId}</span>
                  <span className="mt-1 block truncate text-xs text-muted-foreground">
                    {short(candidate.responseChecksum)}
                  </span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatDate(candidate.receivedAt)}
                </span>
              </button>
            ))}
          </div>
          <aside className="space-y-3 border-t pt-4 xl:border-l xl:border-t-0 xl:pl-5 xl:pt-0">
            <h3 className="text-sm font-semibold">审核证据</h3>
            {!selectedCandidate && (
              <p className="text-sm text-muted-foreground">选择候选查看服务端归一化结果。</p>
            )}
            {selectedCandidate && (
              <>
                <dl className="space-y-3 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">Candidate</dt>
                    <dd className="break-all font-mono text-xs">{selectedCandidate.candidateId}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Response checksum</dt>
                    <dd className="break-all font-mono text-xs">
                      {selectedCandidate.responseChecksum}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">上个 checksum</dt>
                    <dd className="break-all font-mono text-xs">
                      {selectedCandidate.previousResponseChecksum || '-'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">隔离原因</dt>
                    <dd>{selectedCandidate.quarantineReasons?.join('、') || '无'}</dd>
                  </div>
                </dl>
                <details className="border-y py-2">
                  <summary className="cursor-pointer text-xs font-medium">归一化诊断</summary>
                  <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all text-[11px]">
                    {JSON.stringify(
                      {
                        diagnostics: selectedCandidate.diagnostics,
                        normalizedPayload: selectedCandidate.normalizedPayload,
                      },
                      null,
                      2,
                    )}
                  </pre>
                </details>
                <div className="space-y-1.5">
                  <Label htmlFor="capture-review-reason">审核原因</Label>
                  <textarea
                    id="capture-review-reason"
                    value={reviewReason}
                    onChange={(event) => setReviewReason(event.target.value)}
                    maxLength={1000}
                    className="min-h-20 w-full resize-y rounded-md border bg-background px-3 py-2 text-sm"
                    placeholder="至少 3 个字符"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant="destructive"
                    onClick={() => {
                      void reviewCandidate('reject');
                    }}
                    disabled={
                      reviewReason.trim().length < 3 ||
                      busy !== null ||
                      selectedCandidate.reviewStatus !== 'PENDING_REVIEW'
                    }
                  >
                    <XCircle className="h-4 w-4" />
                    拒绝
                  </Button>
                  <Button
                    onClick={() => {
                      void reviewCandidate('verify');
                    }}
                    disabled={
                      reviewReason.trim().length < 3 ||
                      busy !== null ||
                      selectedCandidate.reviewStatus !== 'PENDING_REVIEW'
                    }
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    确认
                  </Button>
                </div>
              </>
            )}
          </aside>
        </div>
      </section>

      <OfficialInputUnitContractPanel
        assignmentId={assignmentId}
        onContractStateChange={handleOfficialInputUnitContractStateChange}
      />

      <section aria-labelledby="capture-freeze-title" className="space-y-5 border-y py-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4" />
            <h2 id="capture-freeze-title" className="text-base font-semibold">
              矩阵覆盖与发布草稿
            </h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant={officialInputUnitContractState.valid ? 'success' : 'secondary'}>
              单位契约 {officialInputUnitContractState.contractId ? short(officialInputUnitContractState.contractId) : '未就绪'}
            </Badge>
            <Badge variant={sellerCandidate ? 'success' : 'secondary'}>Seller 服务</Badge>
            <Badge variant={matrixPreview ? 'success' : 'secondary'}>矩阵预览</Badge>
            <Badge variant={frozenCandidateSet ? 'success' : 'secondary'}>CandidateSet</Badge>
          </div>
        </div>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="space-y-1.5">
            <Label htmlFor="capture-seller-candidate">审核通过的 Seller 候选</Label>
            <select
              id="capture-seller-candidate"
              value={selectedSellerCandidateId}
              onChange={(event) => {
                void selectVerifiedSellerCandidate(event.target.value);
              }}
              className="h-9 w-full rounded-md border bg-background px-3 font-mono text-xs"
            >
              <option value="">选择 Seller candidate</option>
              {verifiedSellerTasks.map((task) => {
                const candidate = task.candidate;
                if (!candidate) return null;
                return (
                  <option key={candidate.candidateId} value={candidate.candidateId}>
                    {candidate.candidateId} · {short(candidate.responseChecksum)}
                  </option>
                );
              })}
            </select>
            <p className="text-xs text-muted-foreground">
              已读取 {sellerServices.length} 个服务 · assignment {assignmentId || '-'}
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-3 border-l pl-4 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">申报价 / 重量</dt>
              <dd className="mt-1 font-mono text-xs">
                {baseProduct.declaredPriceMinor} CNY minor · {baseProduct.weightGrams} g
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">尺寸 / 电池</dt>
              <dd className="mt-1 font-mono text-xs">
                {baseProduct.dimensionsMm.length}×{baseProduct.dimensionsMm.width}×
                {baseProduct.dimensionsMm.height} mm · {baseProduct.batteryMode}
              </dd>
            </div>
          </dl>
        </div>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Input
              value={serviceSearch}
              onChange={(event) => setServiceSearch(event.target.value)}
              placeholder="筛选 stable service、provider 或物流描述"
              className="max-w-md"
              aria-label="筛选 Seller 服务"
            />
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{selectedServiceKeys.length} 已选</span>
              <span>{defaultServiceKeys.length} 默认</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setSelectedServiceKeys(sellerServices.map((service) => service.stableServiceKey))
                }
                disabled={sellerServices.length === 0}
              >
                全选
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDefaultServiceKeys([...selectedServiceKeys])}
                disabled={selectedServiceKeys.length === 0}
              >
                默认=已选
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSelectedServiceKeys([]);
                  setDefaultServiceKeys([]);
                }}
                disabled={selectedServiceKeys.length === 0}
              >
                清空
              </Button>
            </div>
          </div>

          <div className="max-h-96 overflow-auto border-y">
            <div className="sticky top-0 grid grid-cols-[2.5rem_2.5rem_minmax(0,1fr)_7rem] gap-2 border-b bg-background px-3 py-2 text-[11px] font-medium text-muted-foreground">
              <span>选用</span>
              <span>默认</span>
              <span>Seller 服务</span>
              <span>Provider</span>
            </div>
            {!sellerCandidate && (
              <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                选择审核通过的 Seller 候选
              </div>
            )}
            {sellerCandidate && visibleSellerServices.length === 0 && (
              <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                没有匹配的 Seller 服务
              </div>
            )}
            {visibleSellerServices.map((service) => {
              const selected = selectedServiceKeys.includes(service.stableServiceKey);
              return (
                <div
                  key={service.stableServiceKey}
                  className="grid grid-cols-[2.5rem_2.5rem_minmax(0,1fr)_7rem] items-center gap-2 border-b px-3 py-2 last:border-b-0"
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={(event) =>
                      toggleSelectedService(service.stableServiceKey, event.target.checked)
                    }
                    aria-label={`选用 ${service.stableServiceKey}`}
                    className="h-4 w-4 accent-primary"
                  />
                  <input
                    type="checkbox"
                    checked={defaultServiceKeys.includes(service.stableServiceKey)}
                    disabled={!selected}
                    onChange={(event) =>
                      toggleDefaultService(service.stableServiceKey, event.target.checked)
                    }
                    aria-label={`默认 ${service.stableServiceKey}`}
                    className="h-4 w-4 accent-primary"
                  />
                  <div className="min-w-0">
                    <div className="truncate font-mono text-xs" title={service.stableServiceKey}>
                      {service.stableServiceKey}
                    </div>
                    <div className="mt-1 truncate text-xs text-muted-foreground">
                      {service.normalizedDescription} · {service.deliveryVariant}
                    </div>
                  </div>
                  <span className="truncate font-mono text-xs text-muted-foreground">
                    {service.providerId}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => void previewCaptureMatrix()}
            disabled={!matrixReady || busy !== null}
          >
            {busy === 'matrix-preview' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FlaskConical className="h-4 w-4" />
            )}
            生成矩阵预览
          </Button>
          <Button
            variant="outline"
            onClick={() => void freezeCaptureCandidateSet()}
            disabled={
              !matrixPreview ||
              matrixBlockers.length > 0 ||
              defaultServiceKeys.length === 0 ||
              busy !== null
            }
          >
            {busy === 'candidate-set' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Snowflake className="h-4 w-4" />
            )}
            冻结 CandidateSet
          </Button>
          <Button
            onClick={() => void createCaptureDraft()}
            disabled={!frozenCandidateSet || busy !== null}
          >
            {busy === 'capture-draft' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileJson className="h-4 w-4" />
            )}
            创建草稿
          </Button>
        </div>

        {matrixPreview && (
          <div className="space-y-4 border-y py-4">
            <dl className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
              <div>
                <dt className="text-xs text-muted-foreground">Required fingerprints</dt>
                <dd className="mt-1 font-semibold">{matrixPreview.requiredFingerprints.length}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Matrix blockers</dt>
                <dd className="mt-1 font-semibold">{matrixPreview.matrix.blockers.length}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Point evidence</dt>
                <dd className="mt-1">
                  {matrixPreview.pointEvidence.status} · {matrixPreview.pointEvidence.distanceKm} km
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">最低扩展版本</dt>
                <dd className="mt-1 font-mono text-xs">{matrixPreview.minExtensionVersion}</dd>
              </div>
            </dl>
            {matrixPreview.matrix.blockers.length > 0 && (
              <div className="border-y border-destructive/40 py-2">
                <div className="text-xs font-semibold text-destructive">阻断项</div>
                <ul className="mt-2 space-y-1 text-xs">
                  {matrixPreview.matrix.blockers.map((blocker, index) => (
                    <li key={`${index}:${matrixBlockerLabel(blocker)}`}>
                      {matrixBlockerLabel(blocker)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="grid gap-5 xl:grid-cols-[20rem_minmax(0,1fr)]">
              <dl className="space-y-2 text-xs">
                <div>
                  <dt className="text-muted-foreground">Seller point</dt>
                  <dd className="font-mono">
                    {matrixPreview.pointEvidence.sellerPoint.latitude},{' '}
                    {matrixPreview.pointEvidence.sellerPoint.longitude}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Warehouse point / tolerance</dt>
                  <dd className="font-mono">
                    {matrixPreview.pointEvidence.warehousePoint.latitude},{' '}
                    {matrixPreview.pointEvidence.warehousePoint.longitude} ·{' '}
                    {matrixPreview.pointEvidence.toleranceKm} km
                  </dd>
                </div>
              </dl>
              <div className="max-h-72 divide-y overflow-auto border-y">
                {matrixPreview.requiredFingerprints.map((requirement) => (
                  <div key={requirement.fingerprintKey} className="px-3 py-2">
                    <div className="break-all font-mono text-[11px]">
                      {requirement.fingerprintKey}
                    </div>
                    <div className="mt-1 break-all font-mono text-[10px] text-muted-foreground">
                      {JSON.stringify(requirement.fingerprint)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {frozenCandidateSet && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-y py-3 text-sm">
            <div className="min-w-0">
              <div className="font-semibold">CandidateSet 已冻结</div>
              <div className="mt-1 break-all font-mono text-xs">{frozenCandidateSet.id}</div>
              <div className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
                {frozenCandidateSet.contentChecksum}
              </div>
            </div>
            <Badge variant="success">
              {frozenCandidateSet.officialCandidates?.length || 0} Official
            </Badge>
          </div>
        )}

        {createdDraft && (
          <div className="flex items-center gap-2 text-sm text-emerald-700">
            <CheckCircle2 className="h-4 w-4" />
            草稿 {createdDraft.id} · CandidateSet {createdDraft.candidateSetId}
          </div>
        )}
      </section>
    </div>
  );
}
