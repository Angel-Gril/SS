'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FileJson,
  GitCompareArrows,
  History,
  Loader2,
  Power,
  Radar,
  RefreshCw,
  Rocket,
  RotateCcw,
  Server,
  ShieldCheck,
  Upload,
  XCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/use-toast';
import { api, getApiBase, type ApiResponse } from '@/lib/api';
import { RuleDiffView, type LogisticsRuleDiff } from '@/components/logistics-rules/rule-diff-view';
import {
  MethodBindingTable,
  type LogisticsReviewIssue,
} from '@/components/logistics-rules/method-binding-table';
import { OfficialFormulaResolutionTable } from '@/components/logistics-rules/official-formula-resolution-table';
import { LogisticsCaptureWorkspace } from '@/components/logistics-rules/logistics-capture-workspace';
import { ScopeBootstrapWorkbench } from '@/components/logistics-rules/scope-bootstrap-workbench';
import { ChannelReceiptReconciliation } from '@/components/logistics-rules/channel-receipt-reconciliation';
import {
  buildAdminLogisticsWorkspacePath,
  buildMethodBindingReviewPayload,
  buildMethodBindingSuggestionPayload,
  buildOfficialResolutionReviewPayload,
  buildOfficialResolutionSuggestionPayload,
  isChannelRetirementEligible,
  isChannelRetirementReady,
  isPublishContextCurrent,
  logisticsIssueTarget,
  reconcileReviewFailure,
} from '@/components/logistics-rules/workbench-state.mjs';

type WorkbenchTab = 'capture' | 'draft' | 'review' | 'history';
type BusyAction =
  | 'workspace'
  | 'import'
  | 'load'
  | 'diff'
  | 'preflight'
  | 'publish'
  | 'rollback'
  | 'retire'
  | 'review'
  | null;

interface ValidationReport extends Record<string, unknown> {
  source?: string;
  validatedAt?: string;
  requiredCount?: number;
  coveredCount?: number;
  blockers?: unknown[];
  warnings?: unknown[];
}

interface DraftRevision {
  id: string;
  revisionKey?: string;
  contentChecksum?: string;
  payload?: Record<string, unknown>;
  schemaVersion?: string;
  parserVersion?: string;
  capturedAt?: string;
  validationStatus?: string;
  validationReport?: ValidationReport;
  validatedAt?: string;
  validationValidUntil?: string;
  createdAt?: string;
}

interface PreflightResult {
  status: 'READY' | 'BLOCKED';
  revisionId: string;
  channelId: string;
  report: ValidationReport;
}

interface RetireResult {
  channelId: string;
  currentSequence: number;
  retiredAt: string;
  retiredAssignmentCount: number;
  revokedGrantCount: number;
  eventId: string;
}

interface ReleaseResult {
  id: string;
  sequence: number;
  releaseKind?: string;
  contentChecksum?: string;
  effectiveChecksum?: string;
}

interface OperationEntry {
  id: string;
  kind: 'PUBLISH' | 'ROLLBACK';
  releaseId: string;
  sequence: number;
  checksum?: string;
  reason?: string;
  createdAt: string;
}

interface WorkspaceChannel {
  id: string;
  channelType?: string;
  tenantId?: string;
  shopId?: string;
  warehouseId?: string;
  ozonCompanyId?: string;
  originLabel?: string;
  companyBindingId?: string;
  originBindingId?: string;
  currentSequence: number;
  currentReleaseId?: string | null;
  retiredAt?: string | null;
}

interface WorkspaceAssignment {
  id: string;
  channelId: string;
  destinationCountryCode?: string | null;
  destinationCountryUid?: string;
  destinationLocationUid: string;
  destinationLabel: string;
  retiredAt?: string | null;
}

interface WorkspaceRelease extends ReleaseResult {
  revisionId: string;
  releaseKind: 'PUBLISH' | 'ROLLBACK';
  publishedAt?: string;
  validationValidUntil?: string;
}

export interface WorkspaceMethodBinding extends Record<string, unknown> {
  id: string;
  deliveryMethodId: string;
  stableServiceKey: string;
  status: string;
  updatedAt: string;
  evidence?: Record<string, unknown>;
}

export interface WorkspaceOfficialResolution extends Record<string, unknown> {
  id: string;
  officialFingerprint: string;
  candidateSetChecksum: string;
  candidateServiceKeys: string[];
  selectedServiceKey?: string | null;
  status: string;
  updatedAt: string;
  evidence?: Record<string, unknown>;
}

interface AdminLogisticsWorkspace {
  channels: WorkspaceChannel[];
  channel: WorkspaceChannel | null;
  revision: DraftRevision | null;
  currentRelease: WorkspaceRelease | null;
  releaseHistory: WorkspaceRelease[];
  assignments: WorkspaceAssignment[];
  companyBindings: Array<Record<string, unknown>>;
  originBindings: Array<Record<string, unknown>>;
  deliveryMethods: Array<Record<string, unknown>>;
  methodBindings: WorkspaceMethodBinding[];
  officialResolutions: WorkspaceOfficialResolution[];
}

interface ReviewTarget {
  kind: 'method' | 'official';
  id: string;
  decision: 'CONFIRMED' | 'REJECTED';
  updatedAt: string;
  candidateServiceKeys?: string[];
}

const EMPTY_WORKSPACE: AdminLogisticsWorkspace = {
  channels: [],
  channel: null,
  revision: null,
  currentRelease: null,
  releaseHistory: [],
  assignments: [],
  companyBindings: [],
  originBindings: [],
  deliveryMethods: [],
  methodBindings: [],
  officialResolutions: [],
};

const tabs: Array<{ id: WorkbenchTab; label: string; icon: typeof FileJson }> = [
  { id: 'capture', label: '采集测试', icon: Radar },
  { id: 'draft', label: '草稿导入', icon: FileJson },
  { id: 'review', label: '当前与审核', icon: GitCompareArrows },
  { id: 'history', label: '发布历史', icon: History },
];

const MAX_IMPORT_BYTES = 4 * 1024 * 1024;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function records(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.map(record) : [];
}

function issues(value: unknown): LogisticsReviewIssue[] {
  return records(value).map((item) => ({ ...item, code: String(item.code || 'unknown_blocker') }));
}

function shortChecksum(value?: string | null): string {
  if (!value) return '-';
  return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;
}

function formatDate(value?: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false });
}

function responseErrorCode(response: ApiResponse<unknown>): string {
  return String(
    record((response as unknown as Record<string, unknown>).error).code || 'REQUEST_FAILED',
  );
}

const issueLabels: Record<string, string> = {
  official_branch_uncovered: 'Official 公式分支未覆盖',
  zero_formula_matches: 'Official 样本没有唯一 Seller 公式',
  multiple_formula_matches: 'Official 样本存在多个 Seller 公式候选',
  price_drift: 'Official 报价偏差超过 CNY 0.01',
  destination_evidence_required: '缺少可发布的目的地路线证据',
  invalid_destination_evidence: '目的地路线证据无效',
  destination_mismatch: '目的地证据与当前分配不一致',
  method_binding_required: '实际物流方式尚未确认绑定',
  selected_provider_unavailable: '已选服务的 provider 不可用',
  validation_expired: '验证时效已过期',
  unselected_provider_failed: '未选 provider 采集失败',
  STALE_EXPECTED_SEQUENCE: '当前发布序列已变化',
};

function statusBadge(status?: string, authoritative = false) {
  if (authoritative && status === 'READY') return <Badge variant="success">预检可发布</Badge>;
  if (status === 'BLOCKED' || status === 'FAILED')
    return <Badge variant="destructive">已阻断</Badge>;
  if (status === 'PASSED') return <Badge variant="outline">草稿校验通过</Badge>;
  return <Badge variant="secondary">待预检</Badge>;
}

export default function AdminLogisticsRulesPage() {
  const [activeTab, setActiveTab] = useState<WorkbenchTab>('draft');
  const [workspace, setWorkspace] = useState<AdminLogisticsWorkspace>(EMPTY_WORKSPACE);
  const [channelId, setChannelId] = useState('');
  const [assignmentId, setAssignmentId] = useState('');
  const [revisionId, setRevisionId] = useState('');
  const [expectedSequence, setExpectedSequence] = useState('0');
  const [rawJson, setRawJson] = useState('');
  const [fileName, setFileName] = useState('');
  const [draft, setDraft] = useState<DraftRevision | null>(null);
  const [diff, setDiff] = useState<LogisticsRuleDiff | null>(null);
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [announcement, setAnnouncement] = useState('等待导入或读取草稿');
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishReason, setPublishReason] = useState('');
  const [warningsAcknowledged, setWarningsAcknowledged] = useState(false);
  const [rollbackOpen, setRollbackOpen] = useState(false);
  const [targetReleaseId, setTargetReleaseId] = useState('');
  const [rollbackReason, setRollbackReason] = useState('');
  const [retireOpen, setRetireOpen] = useState(false);
  const [retireReason, setRetireReason] = useState('');
  const [retireAcknowledged, setRetireAcknowledged] = useState(false);
  const [operationHistory, setOperationHistory] = useState<OperationEntry[]>([]);
  const [reviewTarget, setReviewTarget] = useState<ReviewTarget | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [reviewSelectedServiceKey, setReviewSelectedServiceKey] = useState('');

  const [suggestionKey, setSuggestionKey] = useState('');
  const runtimeMode = process.env.NEXT_PUBLIC_RUNTIME_MODE === 'cloud' ? 'cloud' : 'local';
  const apiOrigin = getApiBase();
  const environmentLabel = runtimeMode === 'cloud' ? '云端部署' : '本地开发';
  const report = preflight?.report || draft?.validationReport || null;
  const blockers = issues(report?.blockers);
  const warnings = issues(report?.warnings);
  const scope = record(draft?.payload?.scope);
  const providerInventory = record(draft?.payload?.providerInventory);
  const sources = records(draft?.payload?.sources);
  const selectedServiceKeys = Array.isArray(draft?.payload?.selectedServiceKeys)
    ? draft.payload.selectedServiceKeys.map(String)
    : [];
  const defaults = Array.isArray(draft?.payload?.defaultServiceKeys)
    ? draft.payload.defaultServiceKeys.map(String)
    : [];
  const reviewPayload = useMemo(
    () => ({
      ...(draft?.payload || {}),
      methodBindings: workspace.methodBindings,
      officialResolutions: workspace.officialResolutions,
      deliveryMethods: workspace.deliveryMethods,
    }),
    [
      draft?.payload,
      workspace.deliveryMethods,
      workspace.methodBindings,
      workspace.officialResolutions,
    ],
  );
  const historyEntries = useMemo(() => {
    const serverEntries: OperationEntry[] = workspace.releaseHistory.map((release) => ({
      id: `server:${release.id}:${release.sequence}`,
      kind: release.releaseKind,
      releaseId: release.id,
      sequence: release.sequence,
      checksum: release.effectiveChecksum || release.contentChecksum,
      createdAt: release.publishedAt || '',
    }));
    const seen = new Set(serverEntries.map((entry) => `${entry.releaseId}:${entry.sequence}`));
    return [
      ...operationHistory.filter((entry) => !seen.has(`${entry.releaseId}:${entry.sequence}`)),
      ...serverEntries,
    ].sort((left, right) => right.sequence - left.sequence);
  }, [operationHistory, workspace.releaseHistory]);
  const activeCompanyBinding = workspace.companyBindings.find(
    (binding) => String(binding.id || '') === String(workspace.channel?.companyBindingId || ''),
  );
  const activeOriginBinding = workspace.originBindings.find(
    (binding) => String(binding.id || '') === String(workspace.channel?.originBindingId || ''),
  );
  const activeAssignment = workspace.assignments.find(
    (assignment) => String(assignment.id || '') === assignmentId,
  );
  const sequence = Number(expectedSequence);
  const validSequence = Number.isInteger(sequence) && sequence >= 0;
  const contextMatches = isPublishContextCurrent({
    revisionId,
    channelId,
    draft,
    diff,
    preflight,
  });
  const canPublish =
    contextMatches && preflight?.status === 'READY' && blockers.length === 0 && validSequence;
  const retirementEligible = isChannelRetirementEligible({
    selectedChannelId: channelId,
    channel: workspace.channel,
    currentReleaseId: workspace.currentRelease?.id || '',
  });
  const retirementReady = isChannelRetirementReady({
    eligible: retirementEligible,
    acknowledged: retireAcknowledged,
    reason: retireReason,
  });

  const importSummary = useMemo(() => {
    if (!rawJson.trim()) return null;
    try {
      const parsed = JSON.parse(rawJson) as unknown;
      const payload = record(parsed);
      return {
        validObject: !!parsed && typeof parsed === 'object' && !Array.isArray(parsed),
        schema: String(payload.schema || '-'),
        services: Array.isArray(payload.services) ? payload.services.length : 0,
        formulas: Array.isArray(payload.formulas) ? payload.formulas.length : 0,
        samples: Array.isArray(payload.officialSamples) ? payload.officialSamples.length : 0,
      };
    } catch {
      return { validObject: false, schema: '-', services: 0, formulas: 0, samples: 0 };
    }
  }, [rawJson]);

  useEffect(() => {
    let cancelled = false;
    void api
      .get<AdminLogisticsWorkspace>(buildAdminLogisticsWorkspacePath())
      .then((response) => {
        if (cancelled) return;
        if (response.code === 1 && response.data) {
          setWorkspace(response.data);
          setAnnouncement('工作区目录已加载，请选择物流规则 Channel');
        } else {
          setAnnouncement(`工作区目录加载失败：${response.msg || responseErrorCode(response)}`);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setAnnouncement(
            `工作区目录加载失败：${error instanceof Error ? error.message : '网络请求失败'}`,
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function setLive(message: string) {
    setAnnouncement(message);
  }

  function invalidateLoadedContext() {
    setDraft(null);
    setDiff(null);
    setPreflight(null);
    setPublishOpen(false);
    setPublishReason('');
  }

  async function safeRequest<T>(
    action: Exclude<BusyAction, null>,
    label: string,
    operation: () => Promise<ApiResponse<T>>,
  ): Promise<ApiResponse<T> | null> {
    setBusy(action);
    try {
      return await operation();
    } catch (error) {
      const message = error instanceof Error ? error.message : '网络请求失败';
      toast({ title: `${label}失败`, description: message, variant: 'destructive' });
      setLive(`${label}失败：${message}`);
      return null;
    } finally {
      setBusy(null);
    }
  }

  function requireContext(): boolean {
    if (!channelId.trim() || !revisionId.trim()) {
      toast({
        title: '工作上下文不完整',
        description: '请选择包含可审核 revision 的 Channel。',
        variant: 'destructive',
      });
      return false;
    }
    if (!validSequence) {
      toast({
        title: '发布序列无效',
        description: 'expected sequence 必须是非负整数。',
        variant: 'destructive',
      });
      return false;
    }
    return true;
  }

  async function requestDraft(revisionId: string) {
    return api.get<DraftRevision>(
      `/api/admin/logistics-rules/drafts/${encodeURIComponent(revisionId)}`,
    );
  }

  async function requestDiff(revisionId: string, channelId: string) {
    return api.get<LogisticsRuleDiff>(
      `/api/admin/logistics-rules/drafts/${encodeURIComponent(revisionId)}/diff?channelId=${encodeURIComponent(channelId)}`,
    );
  }

  async function requestWorkspace(channel = '', revision = '') {
    return api.get<AdminLogisticsWorkspace>(buildAdminLogisticsWorkspacePath(channel, revision));
  }

  function applyWorkspaceState(
    next: AdminLogisticsWorkspace,
    requestedChannel = '',
    requestedRevision = '',
  ) {
    setWorkspace(next);
    const resolvedChannelId = next.channel?.id || requestedChannel;
    const resolvedRevisionId = next.revision?.id || requestedRevision;
    setChannelId(resolvedChannelId);
    setRevisionId(resolvedRevisionId);
    setExpectedSequence(String(next.channel?.currentSequence ?? 0));
    setAssignmentId((current) =>
      next.assignments.some((assignment) => assignment.id === current && !assignment.retiredAt)
        ? current
        : next.assignments.find((assignment) => !assignment.retiredAt)?.id || '',
    );
    setTargetReleaseId((current) =>
      next.releaseHistory.some((release) => release.id === current)
        ? current
        : next.releaseHistory.find((release) => release.id !== next.currentRelease?.id)?.id || '',
    );
  }

  function acceptDiff(nextDiff: LogisticsRuleDiff) {
    setDiff(nextDiff);
    setExpectedSequence(String(nextDiff.currentSequence));
  }

  async function refreshCurrentReleaseState(fallbackSequence: number) {
    const response = await safeRequest('diff', '读取当前发布', () =>
      requestDiff(revisionId.trim(), channelId.trim()),
    );
    if (!response) {
      setDiff(null);
      setExpectedSequence(String(fallbackSequence));
      return;
    }
    if (response.code === 1 && response.data) {
      acceptDiff(response.data);
      return;
    }
    setDiff(null);
    setExpectedSequence(String(fallbackSequence));
    toast({
      title: '发布成功，但当前状态读取失败',
      description: response.msg || responseErrorCode(response),
      variant: 'destructive',
    });
    setLive('发布指针已变更，但当前 release 需要手动重新读取');
  }

  async function loadWorkspaceContext(
    nextChannelId = channelId.trim(),
    requestedRevisionId = revisionId.trim(),
    openReview = true,
  ) {
    const workspaceResponse = await safeRequest('workspace', '读取物流规则工作区', () =>
      requestWorkspace(nextChannelId, requestedRevisionId),
    );
    if (!workspaceResponse) return;
    if (workspaceResponse.code !== 1 || !workspaceResponse.data) {
      toast({
        title: '读取物流规则工作区失败',
        description: workspaceResponse.msg || responseErrorCode(workspaceResponse),
        variant: 'destructive',
      });
      return;
    }
    applyWorkspaceState(workspaceResponse.data, nextChannelId, requestedRevisionId);
    const resolvedRevisionId = workspaceResponse.data.revision?.id || requestedRevisionId;
    if (!nextChannelId || !resolvedRevisionId) {
      setDraft(null);
      setDiff(null);
      setPreflight(null);
      setLive(
        nextChannelId
          ? '该 Channel 尚无 revision，可先选择 Assignment 导入草稿'
          : '请选择物流规则 Channel',
      );
      return;
    }

    setBusy('load');
    setLive('正在读取草稿与当前发布差异');
    try {
      const [draftResponse, diffResponse] = await Promise.all([
        requestDraft(resolvedRevisionId),
        requestDiff(resolvedRevisionId, nextChannelId),
      ]);
      if (draftResponse.code !== 1 || !draftResponse.data)
        throw new Error(draftResponse.msg || responseErrorCode(draftResponse));
      if (diffResponse.code !== 1 || !diffResponse.data)
        throw new Error(diffResponse.msg || responseErrorCode(diffResponse));
      setDraft(draftResponse.data);
      acceptDiff(diffResponse.data);
      setPreflight(null);
      if (openReview) setActiveTab('review');
      setLive('工作区、草稿与当前发布差异已加载，请运行服务端预检');
    } catch (error) {
      const message = error instanceof Error ? error.message : '读取失败';
      toast({ title: '读取工作上下文失败', description: message, variant: 'destructive' });
      setLive(`读取失败：${message}`);
    } finally {
      setBusy(null);
    }
  }

  async function selectChannel(nextChannelId: string) {
    invalidateLoadedContext();
    setChannelId(nextChannelId);
    setAssignmentId('');
    setRevisionId('');
    if (!nextChannelId) {
      setWorkspace((current) => ({ ...EMPTY_WORKSPACE, channels: current.channels }));
      return;
    }
    await loadWorkspaceContext(nextChannelId, '', false);
  }

  async function loadContext() {
    if (!channelId.trim()) {
      toast({
        title: '请选择 Channel',
        description: '工作区会自动加载 Assignment、revision 和发布历史。',
        variant: 'destructive',
      });
      return;
    }
    await loadWorkspaceContext(channelId.trim(), revisionId.trim());
  }

  async function refreshDiff() {
    if (!requireContext()) return;
    setBusy('diff');
    setLive('正在刷新当前发布序列与差异');
    const response = await safeRequest('diff', '刷新差异', () =>
      requestDiff(revisionId.trim(), channelId.trim()),
    );
    if (!response) {
      setBusy(null);
      return;
    }
    if (response.code === 1 && response.data) {
      acceptDiff(response.data);
      setPreflight(null);
      setLive('差异已刷新，服务端预检需要重新运行');
    } else {
      toast({
        title: '刷新差异失败',
        description: response.msg || responseErrorCode(response),
        variant: 'destructive',
      });
      setLive('差异刷新失败');
    }
    setBusy(null);
  }

  async function onFileSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      toast({
        title: '文件过大',
        description: '规范化 JSON 不能超过 4 MB。',
        variant: 'destructive',
      });
      event.target.value = '';
      return;
    }
    const text = await file.text();
    setRawJson(text);
    setFileName(file.name);
    setLive(`已读取 ${file.name}，等待导入`);
  }

  async function importDraft() {
    if (!channelId.trim() || !assignmentId.trim()) {
      toast({
        title: '缺少作用域标识',
        description: '导入需要 channel ID 和 assignment ID。',
        variant: 'destructive',
      });
      return;
    }
    let payload: Record<string, unknown>;
    try {
      const parsed = JSON.parse(rawJson) as unknown;
      payload = record(parsed);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        throw new Error('顶层必须是 JSON 对象');
      if (payload.schema !== 'ozon-logistics-draft-import/v1') {
        throw new Error('schema 必须是 ozon-logistics-draft-import/v1');
      }
    } catch (error) {
      toast({
        title: 'JSON 无法导入',
        description: error instanceof Error ? error.message : '格式错误',
        variant: 'destructive',
      });
      return;
    }

    setBusy('import');
    setLive('正在提交规范化候选并由服务端派生校验事实');
    const response = await safeRequest('import', '草稿导入', () =>
      api.post<DraftRevision>('/api/admin/logistics-rules/drafts/import', {
        channelId: channelId.trim(),
        assignmentId: assignmentId.trim(),
        payload,
      }),
    );
    if (!response) {
      setBusy(null);
      return;
    }
    if (response.code !== 1 || !response.data) {
      toast({
        title: '草稿导入失败',
        description: `${response.msg || '请求失败'} (${responseErrorCode(response)})`,
        variant: 'destructive',
      });
      setLive('草稿导入失败，当前发布没有变化');
      setBusy(null);
      return;
    }

    const nextRevisionId = response.data.id;
    setDraft(response.data);
    setRevisionId(nextRevisionId);
    setDiff(null);
    setPreflight(null);
    await loadWorkspaceContext(channelId.trim(), nextRevisionId);
    setActiveTab('review');
    setLive('草稿已保存但尚未发布，请审查差异并运行服务端预检');
    toast({ title: '草稿已导入', description: `revision ${nextRevisionId}` });
    setBusy(null);
  }

  async function runPreflight(): Promise<PreflightResult | null> {
    if (!requireContext()) return null;
    setBusy('preflight');
    setLive('正在执行服务端预检');
    const response = await safeRequest('preflight', '服务端预检', () =>
      api.post<PreflightResult>(
        `/api/admin/logistics-rules/drafts/${encodeURIComponent(revisionId)}/preflight`,
        { channelId: channelId.trim(), expectedSequence: sequence },
      ),
    );
    setBusy(null);
    if (!response) return null;
    if (response.code !== 1 || !response.data) {
      const code = responseErrorCode(response);
      toast({
        title: '服务端预检失败',
        description: `${response.msg || '请求失败'} (${code})`,
        variant: 'destructive',
      });
      setLive(`预检失败：${code}`);
      if (code.includes('SEQUENCE') || code.includes('CONFLICT')) await refreshDiff();
      return null;
    }
    if (
      response.data.revisionId !== revisionId.trim() ||
      response.data.channelId !== channelId.trim()
    ) {
      toast({
        title: '预检响应作用域不匹配',
        description: '请重新读取当前工作上下文。',
        variant: 'destructive',
      });
      setPreflight(null);
      setLive('预检响应与当前 revision/channel 不一致');
      return null;
    }
    setPreflight(response.data);
    const nextBlockers = issues(response.data.report.blockers);
    setLive(
      response.data.status === 'READY'
        ? '服务端预检通过，可以确认发布'
        : `服务端预检阻断：${nextBlockers.length} 项`,
    );
    return response.data;
  }

  async function preparePublish() {
    const result = await runPreflight();
    if (!result) return;
    if (result.status !== 'READY' || issues(result.report.blockers).length > 0) {
      setActiveTab('review');
      window.setTimeout(() => document.getElementById('readiness-summary')?.focus(), 0);
      return;
    }
    setWarningsAcknowledged(issues(result.report.warnings).length === 0);
    setPublishOpen(true);
  }

  function addOperation(entry: OperationEntry) {
    setOperationHistory((current) => [entry, ...current]);
  }

  async function publishDraft() {
    if (
      !canPublish ||
      publishReason.trim().length < 5 ||
      (warnings.length > 0 && !warningsAcknowledged)
    )
      return;
    setBusy('publish');
    setLive('正在发布不可变物流规则版本');
    const response = await safeRequest('publish', '发布草稿', () =>
      api.post<ReleaseResult>(
        `/api/admin/logistics-rules/drafts/${encodeURIComponent(revisionId)}/publish`,
        { channelId: channelId.trim(), expectedSequence: sequence, reason: publishReason.trim() },
      ),
    );
    setBusy(null);
    if (!response) return;
    if (response.code !== 1 || !response.data) {
      const code = responseErrorCode(response);
      toast({
        title: '发布失败',
        description: `${response.msg || '请求失败'} (${code})`,
        variant: 'destructive',
      });
      setLive(`发布失败：${code}；当前发布保持不变`);
      setPublishOpen(false);
      if (code.includes('SEQUENCE') || code.includes('CONFLICT')) await refreshDiff();
      return;
    }
    const release = response.data;
    addOperation({
      id: `publish:${release.id}:${release.sequence}`,
      kind: 'PUBLISH',
      releaseId: release.id,
      sequence: release.sequence,
      checksum: release.effectiveChecksum || release.contentChecksum,
      createdAt: new Date().toISOString(),
      reason: publishReason.trim(),
    });
    await refreshCurrentReleaseState(release.sequence);
    await loadWorkspaceContext(channelId, revisionId, false);
    setTargetReleaseId(diff?.currentReleaseId || '');
    setPublishOpen(false);
    setPublishReason('');
    setPreflight(null);
    setActiveTab('history');
    setLive(`发布成功：sequence ${release.sequence}`);
    toast({
      title: '物流规则已发布',
      description: `release ${release.id} · sequence ${release.sequence}`,
    });
  }

  async function rollbackRelease() {
    if (
      !channelId.trim() ||
      !targetReleaseId.trim() ||
      !validSequence ||
      rollbackReason.trim().length < 5
    )
      return;
    setBusy('rollback');
    setLive('正在由服务端重新预检并创建更高序列的回滚发布');
    const response = await safeRequest('rollback', '回滚发布', () =>
      api.post<ReleaseResult>(
        `/api/admin/logistics-rules/channels/${encodeURIComponent(channelId)}/rollback`,
        {
          targetReleaseId: targetReleaseId.trim(),
          expectedSequence: sequence,
          reason: rollbackReason.trim(),
        },
      ),
    );
    setBusy(null);
    if (!response) return;
    if (response.code !== 1 || !response.data) {
      const code = responseErrorCode(response);
      toast({
        title: '回滚失败',
        description: `${response.msg || '请求失败'} (${code})`,
        variant: 'destructive',
      });
      setLive(`回滚失败：${code}；当前发布保持不变`);
      setRollbackOpen(false);
      if (code.includes('SEQUENCE') || code.includes('CONFLICT')) await refreshDiff();
      return;
    }
    const release = response.data;
    addOperation({
      id: `rollback:${release.id}:${release.sequence}`,
      kind: 'ROLLBACK',
      releaseId: release.id,
      sequence: release.sequence,
      checksum: release.effectiveChecksum || release.contentChecksum,
      reason: rollbackReason.trim(),
      createdAt: new Date().toISOString(),
    });
    await refreshCurrentReleaseState(release.sequence);
    await loadWorkspaceContext(channelId, revisionId, false);
    setRollbackOpen(false);
    setPreflight(null);
    setRollbackReason('');
    setLive(`回滚发布成功：sequence ${release.sequence}`);
    toast({ title: '回滚版本已发布', description: `新 sequence ${release.sequence}` });
  }

  async function retireChannel() {
    const activeChannel = workspace.channel;
    if (!activeChannel || !retirementReady) return;
    const retiringChannelId = channelId.trim();
    const response = await safeRequest('retire', '停用物流规则 Channel', () =>
      api.post<RetireResult>(
        `/api/admin/logistics-rules/channels/${encodeURIComponent(channelId)}/retire`,
        {
          expectedSequence: activeChannel.currentSequence,
          reason: retireReason.trim(),
        },
      ),
    );
    if (!response) return;
    if (response.code !== 1 || !response.data) {
      const code = responseErrorCode(response);
      toast({
        title: '停用 Channel 失败',
        description: `${response.msg || '请求失败'} (${code})`,
        variant: 'destructive',
      });
      setLive(`停用 Channel 失败：${code}；现有发布仍保持生效`);
      if (code.includes('SEQUENCE') || code.includes('CONFLICT')) {
        await loadWorkspaceContext(retiringChannelId, revisionId, false);
      }
      return;
    }

    const result = response.data;
    setRetireOpen(false);
    setRetireReason('');
    setRetireAcknowledged(false);
    invalidateLoadedContext();
    setChannelId('');
    setAssignmentId('');
    setRevisionId('');
    setExpectedSequence('0');
    setTargetReleaseId('');
    setOperationHistory([]);
    setWorkspace((current) => ({
      ...EMPTY_WORKSPACE,
      channels: current.channels.filter((channel) => channel.id !== retiringChannelId),
    }));
    setLive('Channel 已停用，正在刷新可用工作区目录');

    try {
      const directoryResponse = await requestWorkspace();
      if (directoryResponse.code === 1 && directoryResponse.data) {
        applyWorkspaceState(directoryResponse.data);
      } else {
        toast({
          title: 'Channel 已停用，但目录刷新失败',
          description: directoryResponse.msg || responseErrorCode(directoryResponse),
          variant: 'destructive',
        });
      }
    } catch (error) {
      toast({
        title: 'Channel 已停用，但目录刷新失败',
        description: error instanceof Error ? error.message : '网络请求失败',
        variant: 'destructive',
      });
    }
    setLive(`Channel 已停用：sequence ${result.currentSequence}`);
    toast({
      title: '物流规则 Channel 已停用',
      description: `已停用 ${result.retiredAssignmentCount} 个 Assignment，撤销 ${result.revokedGrantCount} 个设备授权`,
    });
  }

  async function suggestMethodBinding(
    stableServiceKey: string,
    deliveryMethodId: string,
    note: string,
  ) {
    if (!channelId || !revisionId) return;
    setSuggestionKey(stableServiceKey);
    const response = await safeRequest('review', '创建物流方式绑定建议', () =>
      api.post<WorkspaceMethodBinding>(
        '/api/admin/logistics-rules/method-bindings/suggestions',
        buildMethodBindingSuggestionPayload({
          channelId,
          revisionId,
          deliveryMethodId,
          stableServiceKey,
          note,
        }),
      ),
    );
    setSuggestionKey('');
    if (!response) return;
    if (response.code !== 1 || !response.data) {
      toast({
        title: '绑定建议创建失败',
        description: response.msg || responseErrorCode(response),
        variant: 'destructive',
      });
      return;
    }
    setPreflight(null);
    await loadWorkspaceContext(channelId, revisionId, false);
    openMethodReview(response.data, 'CONFIRMED');
    setLive('绑定建议已创建，请核对后确认；原预检已失效');
  }

  async function suggestOfficialResolution(requirementKey: string, note: string) {
    if (!channelId || !revisionId) return;
    setSuggestionKey(requirementKey);
    const response = await safeRequest('review', '生成 Official 解析建议', () =>
      api.post<WorkspaceOfficialResolution>(
        '/api/admin/logistics-rules/official-resolutions/suggestions',
        buildOfficialResolutionSuggestionPayload({
          channelId,
          revisionId,
          requirementKey,
          note,
        }),
      ),
    );
    setSuggestionKey('');
    if (!response) return;
    if (response.code !== 1 || !response.data) {
      toast({
        title: 'Official 解析建议生成失败',
        description: response.msg || responseErrorCode(response),
        variant: 'destructive',
      });
      return;
    }
    setPreflight(null);
    await loadWorkspaceContext(channelId, revisionId, false);
    openOfficialReview(response.data, 'CONFIRMED');
    setLive('服务端已生成 Official 候选，请选择唯一 Seller service 后确认');
  }

  function openMethodReview(binding: Record<string, unknown>, decision: 'CONFIRMED' | 'REJECTED') {
    setReviewTarget({
      kind: 'method',
      id: String(binding.id || ''),
      updatedAt: String(binding.updatedAt || ''),
      decision,
    });
    setReviewNote('');
    setReviewSelectedServiceKey('');
  }

  function openOfficialReview(
    resolution: Record<string, unknown>,
    decision: 'CONFIRMED' | 'REJECTED',
  ) {
    const candidates = Array.isArray(resolution.candidateServiceKeys)
      ? resolution.candidateServiceKeys.map(String)
      : [];
    const selected = String(resolution.selectedServiceKey || candidates[0] || '');
    setReviewTarget({
      kind: 'official',
      id: String(resolution.id || ''),
      updatedAt: String(resolution.updatedAt || ''),
      decision,
      candidateServiceKeys: candidates,
    });
    setReviewNote('');
    setReviewSelectedServiceKey(selected);
  }

  async function submitReview() {
    if (
      !reviewTarget ||
      !reviewTarget.updatedAt ||
      !channelId ||
      !revisionId ||
      reviewNote.trim().length < 3
    )
      return;
    const action = reviewTarget.decision === 'CONFIRMED' ? 'confirm' : 'reject';
    const path =
      reviewTarget.kind === 'method'
        ? `/api/admin/logistics-rules/method-bindings/${encodeURIComponent(reviewTarget.id)}/${action}`
        : `/api/admin/logistics-rules/official-resolutions/${encodeURIComponent(reviewTarget.id)}/${action}`;
    const payload =
      reviewTarget.kind === 'method'
        ? buildMethodBindingReviewPayload({
            channelId,
            revisionId,
            expectedUpdatedAt: reviewTarget.updatedAt,
            note: reviewNote,
          })
        : buildOfficialResolutionReviewPayload({
            channelId,
            revisionId,
            expectedUpdatedAt: reviewTarget.updatedAt,
            selectedServiceKey:
              reviewTarget.decision === 'CONFIRMED' ? reviewSelectedServiceKey : '',
            note: reviewNote,
          });
    const response = await safeRequest('review', '提交审核决定', () => api.post(path, payload));
    if (!response) return;
    if (response.code !== 1) {
      const errorCode = responseErrorCode(response);
      const recovery = reconcileReviewFailure({ errorCode, reviewTarget, preflight });
      toast({
        title: '审核提交失败',
        description: response.msg || errorCode,
        variant: 'destructive',
      });
      if (recovery.refreshWorkspace) {
        if (recovery.discardReviewContext) {
          setReviewTarget(null);
          setReviewNote('');
          setReviewSelectedServiceKey('');
        }
        if (recovery.invalidatePreflight) setPreflight(null);
        setLive('审核目标已变化，正在刷新工作区');
        await loadWorkspaceContext(channelId, revisionId, false);
      }
      return;
    }
    setReviewTarget(null);
    setReviewNote('');
    setPreflight(null);
    await loadWorkspaceContext(channelId, revisionId, false);
    setLive('审核决定已保存，原预检已失效，请重新运行服务端预检');
  }

  function navigateToIssue(issue: LogisticsReviewIssue) {
    setActiveTab('review');
    window.setTimeout(
      () =>
        document
          .getElementById(logisticsIssueTarget(issue.code))
          ?.scrollIntoView({ block: 'start' }),
      0,
    );
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const offset = event.key === 'ArrowRight' ? 1 : -1;
    const next = (index + offset + tabs.length) % tabs.length;
    setActiveTab(tabs[next]!.id);
    document.getElementById(`logistics-tab-${tabs[next]!.id}`)?.focus();
  }

  async function applyCompletedScope(result: { channelId: string; assignmentId: string }) {
    await loadWorkspaceContext(result.channelId, '', false);
    setAssignmentId(result.assignmentId);
    setLive('试点 Channel 与 Russia / Moscow Assignment 已载入');
  }

  return (
    <div className="mx-auto max-w-[1600px] space-y-5 pb-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Ozon 物流规则发布</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            审核每次最新采集形成的 shop-private 草稿，并向匹配的扩展设备分发不可变版本。
          </p>
        </div>
        <div className="flex items-center gap-3 border-l-2 border-primary/40 pl-3 text-xs">
          <Server className="h-4 w-4 text-primary" aria-hidden />
          <div>
            <div className="font-semibold">{environmentLabel}</div>
            <div className="max-w-72 break-all text-muted-foreground">{apiOrigin}</div>
          </div>
        </div>
      </header>

      <ScopeBootstrapWorkbench onCompleted={applyCompletedScope} />

      <section aria-label="物流规则工作上下文" className="border-y bg-muted/20 px-4 py-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(14rem,1.2fr)_minmax(14rem,1fr)_minmax(12rem,1fr)_8rem_auto] xl:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="logistics-channel-id">物流规则 Channel</Label>
            <select
              id="logistics-channel-id"
              value={channelId}
              onChange={(event) => {
                void selectChannel(event.target.value);
              }}
              className="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">选择店铺 / 仓库作用域</option>
              {workspace.channels.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  {channel.originLabel || channel.id} · {channel.ozonCompanyId || '未绑定 company'}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="logistics-assignment-id">发布目的地</Label>
            <select
              id="logistics-assignment-id"
              value={assignmentId}
              onChange={(event) => setAssignmentId(event.target.value)}
              disabled={!channelId || workspace.assignments.length === 0}
              className="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">选择 Assignment</option>
              {workspace.assignments
                .filter((assignment) => !assignment.retiredAt)
                .map((assignment) => (
                  <option key={assignment.id} value={assignment.id}>
                    {assignment.destinationLabel} ·{' '}
                    {assignment.destinationCountryCode || assignment.destinationLocationUid}
                  </option>
                ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="logistics-revision-id">当前审核 Revision</Label>
            <div
              id="logistics-revision-id"
              className="flex h-9 items-center rounded-md border bg-background px-3 font-mono text-xs"
            >
              <span className="min-w-0 truncate" title={revisionId || '尚无 revision'}>
                {revisionId || '尚无 revision'}
              </span>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="logistics-expected-sequence">Sequence</Label>
            <div
              id="logistics-expected-sequence"
              className="flex h-9 items-center rounded-md border bg-background px-3 font-mono text-sm"
            >
              {expectedSequence}
            </div>
          </div>
          <Button variant="outline" onClick={loadContext} disabled={!channelId || busy !== null}>
            {busy === 'load' || busy === 'workspace' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            刷新工作区
          </Button>
        </div>
        {workspace.channel && (
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 border-t pt-3 text-xs text-muted-foreground">
            <span>
              Company 绑定：
              <strong className="text-foreground">
                {String(activeCompanyBinding?.status || '未验证')}
              </strong>
            </span>
            <span>
              始发地绑定：
              <strong className="text-foreground">
                {String(activeOriginBinding?.status || '未验证')}
              </strong>
            </span>
            <span>
              实际物流方式：
              <strong className="text-foreground">{workspace.deliveryMethods.length}</strong>
            </span>
            <span>
              审核绑定 / Official 解析：
              <strong className="text-foreground">
                {workspace.methodBindings.length} / {workspace.officialResolutions.length}
              </strong>
            </span>
            {retirementEligible && (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                className="ml-auto"
                onClick={() => {
                  setRetireReason('');
                  setRetireAcknowledged(false);
                  setRetireOpen(true);
                }}
                disabled={busy !== null}
              >
                <Power className="h-4 w-4" />
                紧急停用 Channel
              </Button>
            )}
          </div>
        )}
      </section>

      <section
        id="readiness-summary"
        tabIndex={-1}
        aria-label="发布就绪摘要"
        className="grid border-y sm:grid-cols-2 xl:grid-cols-4"
      >
        <SummaryCell
          label="当前发布"
          value={diff?.currentReleaseId || '尚未读取'}
          detail={`sequence ${diff?.currentSequence ?? expectedSequence}`}
        />
        <SummaryCell
          label="候选草稿"
          value={draft?.id || '尚未导入'}
          detail={shortChecksum(draft?.contentChecksum)}
          mono
        />
        <SummaryCell
          label="服务范围"
          value={`${selectedServiceKeys.length} 已选 / ${defaults.length} 默认`}
          detail={`${String(scope.originCityUid || '-')} → ${String(scope.destinationLocationUid || '-')}`}
        />
        <div className="min-w-0 px-4 py-3 sm:border-l">
          <div className="text-xs text-muted-foreground">权威就绪状态</div>
          <div className="mt-1 flex items-center gap-2">
            {statusBadge(preflight?.status || draft?.validationStatus, !!preflight)}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {blockers.length} 阻断 · {warnings.length} 警告
          </div>
        </div>
      </section>

      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>

      <div role="tablist" aria-label="物流规则发布工作区" className="flex overflow-x-auto border-b">
        {tabs.map((tab, index) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              id={`logistics-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={`logistics-panel-${tab.id}`}
              tabIndex={active ? 0 : -1}
              onKeyDown={(event) => onTabKeyDown(event, index)}
              onClick={() => setActiveTab(tab.id)}
              className={`flex h-11 shrink-0 items-center gap-2 border-b-2 px-4 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
            >
              <Icon className="h-4 w-4" aria-hidden />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === 'capture' && (
        <div id="logistics-panel-capture" role="tabpanel" aria-labelledby="logistics-tab-capture">
          <LogisticsCaptureWorkspace
            initialScope={{
              tenantId: String(workspace.channel?.tenantId || ''),
              shopId: String(workspace.channel?.shopId || ''),
              companyId: String(
                activeCompanyBinding?.ozonCompanyId || workspace.channel?.ozonCompanyId || '',
              ),
              warehouseId: String(
                workspace.channel?.warehouseId || activeOriginBinding?.warehouseId || '',
              ),
              originCountryUid: String(activeOriginBinding?.originCountryUid || ''),
              originCityUid: String(activeOriginBinding?.originCityUid || ''),
            }}
            initialDestination={{
              countryUid: String(activeAssignment?.destinationCountryUid || ''),
              locationUid: String(activeAssignment?.destinationLocationUid || ''),
            }}
            channelId={channelId}
            assignmentId={assignmentId}
            onDraftCreated={(createdRevisionId) => {
              setRevisionId(createdRevisionId);
              setActiveTab('draft');
              void loadWorkspaceContext(channelId, createdRevisionId, false);
            }}
          />
        </div>
      )}

      {activeTab === 'draft' && (
        <div
          id="logistics-panel-draft"
          role="tabpanel"
          aria-labelledby="logistics-tab-draft"
          className="space-y-6"
        >
          <section
            aria-labelledby="import-title"
            className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]"
          >
            <div className="space-y-3">
              <div>
                <h2 id="import-title" className="text-base font-semibold">
                  导入规范化候选
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  只接受 ozon-logistics-draft-import/v1 JSON；HAR 和 Cookie 不进入 ERP。
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Label
                  htmlFor="logistics-json-file"
                  className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border bg-background px-3 text-sm font-medium hover:bg-muted focus-within:ring-2 focus-within:ring-ring"
                >
                  <Upload className="h-4 w-4" aria-hidden />
                  选择 JSON
                  <input
                    id="logistics-json-file"
                    type="file"
                    accept=".json,application/json"
                    className="sr-only"
                    onChange={onFileSelected}
                  />
                </Label>
                <span className="text-xs text-muted-foreground">
                  {fileName || '未选择文件'} · 最大 4 MB
                </span>
              </div>
              <Label htmlFor="logistics-json-editor">候选 JSON</Label>
              <textarea
                id="logistics-json-editor"
                value={rawJson}
                onChange={(event) => {
                  setRawJson(event.target.value);
                  setFileName('');
                }}
                spellCheck={false}
                className="min-h-72 w-full resize-y rounded-md border bg-background px-3 py-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="粘贴规范化候选 JSON"
              />
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  variant="ghost"
                  onClick={() => {
                    setRawJson('');
                    setFileName('');
                  }}
                  disabled={!rawJson || busy !== null}
                >
                  清空
                </Button>
                <Button onClick={importDraft} disabled={!rawJson.trim() || busy !== null}>
                  {busy === 'import' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <FileJson className="h-4 w-4" />
                  )}
                  保存为草稿
                </Button>
              </div>
            </div>

            <aside
              className="border-t pt-4 xl:border-l xl:border-t-0 xl:pl-5 xl:pt-0"
              aria-label="导入内容摘要"
            >
              <h2 className="text-sm font-semibold">导入前摘要</h2>
              <dl className="mt-3 space-y-3 text-sm">
                <Definition
                  label="JSON"
                  value={importSummary?.validObject ? '对象结构有效' : '等待有效对象'}
                />
                <Definition label="Schema" value={importSummary?.schema || '-'} mono />
                <Definition
                  label="服务 / 公式"
                  value={`${importSummary?.services || 0} / ${importSummary?.formulas || 0}`}
                />
                <Definition label="Official 样本" value={String(importSummary?.samples || 0)} />
              </dl>
              <div className="mt-5 border-y bg-amber-50/70 px-3 py-3 text-xs text-amber-900 dark:bg-amber-950/20 dark:text-amber-300">
                现有 267/63 只能作为回归样本。checksum、provider 完整性和 validation matrix
                由服务端依据本次最新采集重新派生。
              </div>
            </aside>
          </section>

          {draft && (
            <DraftEvidenceSummary
              draft={draft}
              sources={sources}
              providerInventory={providerInventory}
              scope={scope}
            />
          )}
        </div>
      )}

      {activeTab === 'review' && (
        <div
          id="logistics-panel-review"
          role="tabpanel"
          aria-labelledby="logistics-tab-review"
          className="space-y-7"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-y bg-muted/20 px-4 py-3">
            <div className="text-sm">
              <span className="font-medium">revision {draft?.id || '-'}</span>
              <span className="ml-3 text-muted-foreground">服务端结果是唯一发布依据</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={refreshDiff} disabled={!draft || busy !== null}>
                {busy === 'diff' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                刷新差异
              </Button>
              <Button
                variant="outline"
                onClick={() => void runPreflight()}
                disabled={!draft || busy !== null}
              >
                {busy === 'preflight' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ShieldCheck className="h-4 w-4" />
                )}
                服务端预检
              </Button>
              <Button
                onClick={preparePublish}
                disabled={!draft || busy !== null}
                title={!canPublish ? '发布前会重新运行服务端预检' : '发布草稿'}
              >
                <Rocket className="h-4 w-4" />
                发布草稿
              </Button>
            </div>
          </div>

          <div className="grid gap-7 xl:grid-cols-[minmax(0,1fr)_21rem]">
            <section aria-label="物流规则审核详情" className="min-w-0 space-y-8">
              <RuleDiffView diff={diff} />
              <MethodBindingTable
                payload={reviewPayload}
                blockers={blockers}
                preflightRan={!!preflight}
                reviewingId={busy === 'review' ? reviewTarget?.id : null}
                suggestingKey={busy === 'review' ? suggestionKey : null}
                onSuggest={suggestMethodBinding}
                onReview={openMethodReview}
              />
              <OfficialFormulaResolutionTable
                payload={reviewPayload}
                blockers={blockers}
                requiredCount={Number(report?.requiredCount || 0)}
                coveredCount={Number(report?.coveredCount || 0)}
                preflightRan={!!preflight}
                reviewingId={busy === 'review' ? reviewTarget?.id : null}
                suggestingKey={busy === 'review' ? suggestionKey : null}
                onSuggest={suggestOfficialResolution}
                onReview={openOfficialReview}
              />
              <ProviderInventorySummary inventory={providerInventory} />
            </section>
            <ReadinessAside
              blockers={blockers}
              warnings={warnings}
              report={report}
              onIssue={navigateToIssue}
            />
          </div>
        </div>
      )}

      {activeTab === 'history' && (
        <div
          id="logistics-panel-history"
          role="tabpanel"
          aria-labelledby="logistics-tab-history"
          className="grid gap-7 xl:grid-cols-[minmax(0,1fr)_24rem]"
        >
          <section aria-labelledby="history-title" className="space-y-3">
            <div>
              <h2 id="history-title" className="text-base font-semibold">
                本页发布记录
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                来自当前 Channel 的不可变发布历史；回滚仍会创建更高 sequence。
              </p>
            </div>
            {historyEntries.length === 0 ? (
              <div className="border-y bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
                本页尚未执行发布或回滚。
              </div>
            ) : (
              <div className="divide-y border-y">
                {historyEntries.map((entry) => (
                  <div
                    key={entry.id}
                    className="grid gap-2 px-3 py-3 md:grid-cols-[8rem_1fr_8rem_12rem] md:items-center"
                  >
                    <Badge
                      variant={entry.kind === 'ROLLBACK' ? 'warning' : 'success'}
                      className="w-fit"
                    >
                      {entry.kind}
                    </Badge>
                    <div className="min-w-0">
                      <div className="break-all font-mono text-xs">{entry.releaseId}</div>
                      {entry.reason && (
                        <div className="mt-1 text-xs text-muted-foreground">{entry.reason}</div>
                      )}
                    </div>
                    <div className="text-sm">sequence {entry.sequence}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatDate(entry.createdAt)}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {channelId && <ChannelReceiptReconciliation channelId={channelId} />}
          </section>

          <aside
            className="border-t pt-4 xl:border-l xl:border-t-0 xl:pl-5 xl:pt-0"
            aria-labelledby="rollback-title"
          >
            <h2 id="rollback-title" className="text-sm font-semibold">
              回滚发布
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              回滚会创建更高 sequence，并由服务端重新执行当前预检。
            </p>
            <div className="mt-4 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="rollback-release-id">目标历史版本</Label>
                <select
                  id="rollback-release-id"
                  value={targetReleaseId}
                  onChange={(event) => setTargetReleaseId(event.target.value)}
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">选择要回滚的 release</option>
                  {workspace.releaseHistory
                    .filter((release) => release.id !== workspace.currentRelease?.id)
                    .map((release) => (
                      <option key={release.id} value={release.id}>
                        sequence {release.sequence} · {release.id}
                      </option>
                    ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rollback-reason">回滚原因</Label>
                <textarea
                  id="rollback-reason"
                  value={rollbackReason}
                  onChange={(event) => setRollbackReason(event.target.value)}
                  maxLength={500}
                  className="min-h-24 w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  placeholder="至少 5 个字符"
                />
                <p className="text-[11px] text-muted-foreground">
                  原因将写入服务端不可变发布审计事件。
                </p>
              </div>
              <Button
                variant="destructive"
                className="w-full"
                onClick={() => setRollbackOpen(true)}
                disabled={
                  !targetReleaseId.trim() ||
                  rollbackReason.trim().length < 5 ||
                  !validSequence ||
                  busy !== null
                }
              >
                <RotateCcw className="h-4 w-4" />
                回滚发布
              </Button>
            </div>
          </aside>
        </div>
      )}

      <Dialog
        open={!!reviewTarget}
        onOpenChange={(open) => {
          if (!open && busy !== 'review') setReviewTarget(null);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {reviewTarget?.decision === 'CONFIRMED' ? '确认审核记录' : '拒绝审核记录'}
            </DialogTitle>
            <DialogDescription>
              决定将写入服务器审计记录，并使当前 revision 的旧预检失效。
            </DialogDescription>
          </DialogHeader>
          {reviewTarget?.kind === 'official' && reviewTarget.decision === 'CONFIRMED' && (
            <div className="space-y-1.5">
              <Label htmlFor="official-selected-service">唯一 Seller stable service</Label>
              <select
                id="official-selected-service"
                value={reviewSelectedServiceKey}
                onChange={(event) => setReviewSelectedServiceKey(event.target.value)}
                className="h-9 w-full rounded-md border bg-background px-3 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {(reviewTarget.candidateServiceKeys || []).map((key) => (
                  <option key={key} value={key}>
                    {key}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="logistics-review-note">审核说明</Label>
            <textarea
              id="logistics-review-note"
              value={reviewNote}
              onChange={(event) => setReviewNote(event.target.value)}
              maxLength={500}
              className="min-h-24 w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="至少 3 个字符，说明核对的 method、路线或 Official variant 证据"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setReviewTarget(null)}
              disabled={busy === 'review'}
            >
              取消
            </Button>
            <Button
              variant={reviewTarget?.decision === 'REJECTED' ? 'destructive' : 'default'}
              onClick={() => {
                void submitReview();
              }}
              disabled={
                !reviewTarget?.updatedAt ||
                busy === 'review' ||
                reviewNote.trim().length < 3 ||
                (reviewTarget?.kind === 'official' &&
                  reviewTarget.decision === 'CONFIRMED' &&
                  !reviewSelectedServiceKey)
              }
            >
              {busy === 'review' && <Loader2 className="h-4 w-4 animate-spin" />}
              提交决定
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>发布草稿</DialogTitle>
            <DialogDescription>
              服务端将再次派生预检并以 expected sequence {expectedSequence} 执行原子发布。
            </DialogDescription>
          </DialogHeader>
          <dl className="grid gap-3 border-y py-3 text-sm sm:grid-cols-2">
            <Definition label="Channel" value={channelId || '-'} mono />
            <Definition label="Revision" value={revisionId || '-'} mono />
            <Definition label="候选 checksum" value={shortChecksum(draft?.contentChecksum)} mono />
            <Definition label="默认服务" value={String(defaults.length)} />
          </dl>
          {warnings.length > 0 && (
            <label className="flex cursor-pointer items-start gap-3 border-y border-amber-300 bg-amber-50/70 px-3 py-3 text-sm dark:bg-amber-950/20">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-primary"
                checked={warningsAcknowledged}
                onChange={(event) => setWarningsAcknowledged(event.target.checked)}
              />
              <span>
                我已审核 {warnings.length} 项非阻断警告；相关 provider/服务不会被误选入发布集。
              </span>
            </label>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="publish-reason">发布原因</Label>
            <textarea
              id="publish-reason"
              value={publishReason}
              onChange={(event) => setPublishReason(event.target.value)}
              maxLength={500}
              className="min-h-20 w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="至少 5 个字符，例如：厦门仓 Russia/Moscow 试点已完成抽样校验"
            />
            <p className="text-[11px] text-muted-foreground">
              原因将随发布事件永久保存，便于追溯费率更新与回滚依据。
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPublishOpen(false)}
              disabled={busy === 'publish'}
            >
              取消
            </Button>
            <Button
              onClick={publishDraft}
              disabled={
                !canPublish ||
                publishReason.trim().length < 5 ||
                (warnings.length > 0 && !warningsAcknowledged) ||
                busy === 'publish'
              }
            >
              {busy === 'publish' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Rocket className="h-4 w-4" />
              )}
              确认发布
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={rollbackOpen} onOpenChange={setRollbackOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认回滚发布</DialogTitle>
            <DialogDescription>
              目标内容不会被编辑；成功后将创建大于当前 sequence {expectedSequence} 的新发布。
            </DialogDescription>
          </DialogHeader>
          <div className="border-y py-3 text-sm">
            <div className="break-all font-mono text-xs">{targetReleaseId}</div>
            <div className="mt-2 text-muted-foreground">原因：{rollbackReason}</div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRollbackOpen(false)}
              disabled={busy === 'rollback'}
            >
              取消
            </Button>
            <Button variant="destructive" onClick={rollbackRelease} disabled={busy === 'rollback'}>
              {busy === 'rollback' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RotateCcw className="h-4 w-4" />
              )}
              确认回滚
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={retireOpen}
        onOpenChange={(open) => {
          if (busy === 'retire') return;
          setRetireOpen(open);
          if (!open) {
            setRetireReason('');
            setRetireAcknowledged(false);
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>紧急停用 Channel</DialogTitle>
            <DialogDescription>
              这是当前店铺与仓库物流规则的不可逆停用操作，请先核对影响和 sequence。
            </DialogDescription>
          </DialogHeader>

          <dl className="grid gap-3 border-y py-3 text-sm sm:grid-cols-2">
            <Definition label="Channel" value={channelId || '-'} mono />
            <Definition
              label="当前 sequence"
              value={String(workspace.channel?.currentSequence ?? '-')}
            />
          </dl>

          <div className="border-y border-destructive/40 bg-destructive/5 px-3 py-3 text-sm">
            <div className="flex items-center gap-2 font-semibold text-destructive">
              <AlertTriangle className="h-4 w-4" />
              停用影响
            </div>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
              <li>停止新报价，并停用当前 Channel 下的 Assignment。</li>
              <li>设备下次联系返回 410，现有设备授权将被撤销。</li>
              <li>不能直接恢复；需要重新创建作用域、审核并发布。</li>
            </ul>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="retire-channel-reason">停用原因</Label>
            <textarea
              id="retire-channel-reason"
              value={retireReason}
              onChange={(event) => setRetireReason(event.target.value)}
              minLength={3}
              maxLength={500}
              className="min-h-24 w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="3 到 500 个字符，例如：试点作用域配置错误，立即停止分发"
            />
            <p className="text-right text-[11px] tabular-nums text-muted-foreground">
              {retireReason.trim().length}/500
            </p>
          </div>

          <label
            htmlFor="retire-channel-acknowledgement"
            className="flex cursor-pointer items-start gap-3 border-y px-3 py-3 text-sm"
          >
            <input
              id="retire-channel-acknowledgement"
              type="checkbox"
              checked={retireAcknowledged}
              onChange={(event) => setRetireAcknowledged(event.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0"
            />
            <span>我确认设备将停止获得该 Channel 的新报价，并理解此操作不能直接恢复。</span>
          </label>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setRetireOpen(false)}
              disabled={busy === 'retire'}
            >
              取消
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={retireChannel}
              disabled={!retirementReady || busy === 'retire'}
            >
              {busy === 'retire' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Power className="h-4 w-4" />
              )}
              确认永久停用
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SummaryCell({
  label,
  value,
  detail,
  mono = false,
}: {
  label: string;
  value: string;
  detail: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0 px-4 py-3 sm:border-l sm:first:border-l-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={`mt-1 truncate text-sm font-semibold ${mono ? 'font-mono' : ''}`}
        title={value}
      >
        {value}
      </div>
      <div
        className={`mt-1 truncate text-xs text-muted-foreground ${mono ? 'font-mono' : ''}`}
        title={detail}
      >
        {detail}
      </div>
    </div>
  );
}

function Definition({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`mt-0.5 break-all ${mono ? 'font-mono text-xs' : 'font-medium'}`}>{value}</dd>
    </div>
  );
}

function DraftEvidenceSummary({
  draft,
  sources,
  providerInventory,
  scope,
}: {
  draft: DraftRevision;
  sources: Array<Record<string, unknown>>;
  providerInventory: Record<string, unknown>;
  scope: Record<string, unknown>;
}) {
  return (
    <section aria-labelledby="draft-evidence-title" className="space-y-3 border-y py-4">
      <div className="flex flex-wrap items-center justify-between gap-3 px-1">
        <div>
          <h2 id="draft-evidence-title" className="text-sm font-semibold">
            服务端草稿证据
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            revision {draft.id} · {formatDate(draft.createdAt)}
          </p>
        </div>
        {statusBadge(draft.validationStatus)}
      </div>
      <dl className="grid gap-4 bg-muted/20 px-4 py-4 sm:grid-cols-2 xl:grid-cols-4">
        <Definition
          label="Scope"
          value={`${String(scope.tenantId || '-')} / ${String(scope.shopId || '-')}`}
          mono
        />
        <Definition
          label="Company / warehouse"
          value={`${String(scope.ozonCompanyId || '-')} / ${String(scope.erpWarehouseId || '-')}`}
          mono
        />
        <Definition
          label="Origin → destination"
          value={`${String(scope.originCityUid || '-')} → ${String(scope.destinationLocationUid || '-')}`}
          mono
        />
        <Definition
          label="Parser / schema"
          value={`${draft.parserVersion || '-'} / ${draft.schemaVersion || '-'}`}
        />
        <Definition label="Content checksum" value={draft.contentChecksum || '-'} mono />
        <Definition label="验证有效期" value={formatDate(draft.validationValidUntil)} />
        <Definition label="来源批次" value={String(sources.length)} />
        <Definition
          label="Provider"
          value={`${String(providerInventory.succeeded || 0)} 成功 / ${String(providerInventory.failed || 0)} 失败 / ${String(providerInventory.empty || 0)} 空`}
        />
      </dl>
    </section>
  );
}

function ProviderInventorySummary({ inventory }: { inventory: Record<string, unknown> }) {
  const providers = records(inventory.providers);
  const abnormalProviders = providers.filter(
    (provider) => String(provider.status || '') !== 'succeeded',
  );
  return (
    <section
      id="provider-inventory"
      aria-labelledby="provider-inventory-title"
      className="space-y-3"
    >
      <div>
        <h2 id="provider-inventory-title" className="text-sm font-semibold">
          Provider 完整性
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          discovered、attempted、succeeded、failed、empty 分开显示；done/total 不作为发布绿灯。
        </p>
      </div>
      <dl className="grid border-y bg-muted/20 sm:grid-cols-3 xl:grid-cols-6">
        {[
          ['发现', inventory.discovered],
          ['已尝试', inventory.attempted],
          ['成功', inventory.succeeded],
          ['失败', inventory.failed],
          ['空响应', inventory.empty],
          ['来源行', providers.length],
        ].map(([label, value], index) => (
          <div key={String(label)} className={`px-4 py-3 ${index ? 'sm:border-l' : ''}`}>
            <dt className="text-xs text-muted-foreground">{String(label)}</dt>
            <dd className="mt-1 text-xl font-semibold">{String(value ?? 0)}</dd>
          </div>
        ))}
      </dl>
      {abnormalProviders.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold">异常 Provider 明细</h3>
          <div className="divide-y border-y">
            {abnormalProviders.map((provider, index) => {
              const status = String(provider.status || 'pending');
              return (
                <div
                  key={`${String(provider.providerId || 'unknown')}:${index}`}
                  className="grid gap-2 px-3 py-2 text-xs sm:grid-cols-[8rem_1fr_7rem_6rem] sm:items-center"
                >
                  <span className="break-all font-mono">{String(provider.providerId || '-')}</span>
                  <span className="min-w-0 truncate" title={String(provider.name || '-')}>
                    {String(provider.name || '-')}
                  </span>
                  <span className="text-muted-foreground">{String(provider.source || '-')}</span>
                  <Badge
                    variant={
                      status === 'failed'
                        ? 'destructive'
                        : status === 'empty'
                          ? 'warning'
                          : 'secondary'
                    }
                    className="w-fit"
                  >
                    {status}
                  </Badge>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

function ReadinessAside({
  blockers,
  warnings,
  report,
  onIssue,
}: {
  blockers: LogisticsReviewIssue[];
  warnings: LogisticsReviewIssue[];
  report: ValidationReport | null;
  onIssue: (issue: LogisticsReviewIssue) => void;
}) {
  return (
    <aside
      className="self-start border-t pt-4 xl:sticky xl:top-4 xl:border-l xl:border-t-0 xl:pl-5 xl:pt-0"
      aria-labelledby="readiness-title"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 id="readiness-title" className="text-sm font-semibold">
          发布就绪
        </h2>
        {blockers.length === 0 && report ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden />
        ) : (
          <XCircle className="h-4 w-4 text-destructive" aria-hidden />
        )}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-3 border-y py-3 text-sm">
        <Definition label="阻断" value={String(blockers.length)} />
        <Definition label="警告" value={String(warnings.length)} />
        <Definition
          label="分支覆盖"
          value={`${Number(report?.coveredCount || 0)}/${Number(report?.requiredCount || 0)}`}
        />
        <Definition label="验证时间" value={formatDate(String(report?.validatedAt || ''))} />
      </dl>

      {!report && (
        <p className="mt-4 text-sm text-muted-foreground">运行服务端预检后显示权威阻断项。</p>
      )}
      {blockers.length > 0 && (
        <div className="mt-4 space-y-2">
          <h3 className="text-xs font-semibold text-destructive">必须解决</h3>
          {blockers.map((issue, index) => (
            <button
              key={`${issue.code}:${index}`}
              type="button"
              onClick={() => onIssue(issue)}
              className="flex w-full items-start gap-2 border-y border-destructive/20 px-2 py-2 text-left text-xs hover:bg-destructive/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden />
              <span className="min-w-0">
                <span className="block font-medium">{issueLabels[issue.code] || issue.code}</span>
                {issue.stableServiceKey && (
                  <span className="mt-1 block break-all font-mono text-[10px] text-muted-foreground">
                    {issue.stableServiceKey}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}

      {warnings.length > 0 && (
        <div className="mt-5 space-y-2">
          <h3 className="text-xs font-semibold text-amber-700 dark:text-amber-400">需要审核</h3>
          {warnings.map((issue, index) => (
            <button
              key={`${issue.code}:${index}`}
              type="button"
              onClick={() => onIssue(issue)}
              className="flex w-full items-start gap-2 border-y border-amber-300/60 px-2 py-2 text-left text-xs hover:bg-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-amber-950/20"
            >
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden />
              <span className="min-w-0">
                <span className="block font-medium">{issueLabels[issue.code] || issue.code}</span>
                {issue.providerId && (
                  <span className="mt-1 block break-all font-mono text-[10px] text-muted-foreground">
                    provider {issue.providerId}
                  </span>
                )}
                {issue.detail && (
                  <span className="mt-1 block text-muted-foreground">{issue.detail}</span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}

      <Button asChild variant="link" size="sm" className="mt-4 px-0">
        <Link href="/warehouses">查看 ERP 仓库与实际物流方式</Link>
      </Button>
    </aside>
  );
}
