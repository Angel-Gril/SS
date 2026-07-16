'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ImageIcon, Loader2, RefreshCw, RotateCcw, Square, X } from 'lucide-react';
import { api, apiUrl } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/use-toast';
import {
  createLatestLoadCoordinator,
  isMediaMutationConflict,
  type AiImageApplyResult,
  type LatestLoadRequest,
  type RunMediaMutation,
} from './source-ai-media-state';

interface ContextInput {
  sourceMediaKey: string;
  role: string;
  sourceUrl: string;
  assetId: string | null;
  assetUrl: string | null;
  mimeType: string | null;
  width: number | null;
  height: number | null;
}

interface AiMediaWorkflow {
  id: string;
  operation: 'IMAGE_TO_IMAGE';
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCEL_REQUESTED' | 'CANCELLED';
  reviewStatus: 'NOT_READY' | 'PENDING' | 'APPROVED' | 'REJECTED';
  revision: number;
  currentAttempt: number;
  createdAt: string;
  completedAt: string | null;
  inputs: Array<{ assetId: string; url: string }>;
  jobs: Array<{
    id: string;
    status: string;
    prompt?: string;
    errorMessage?: string | null;
    providerJobId?: string | null;
    appliedMode?: 'append' | 'replace' | null;
    assets?: Array<{ id: string; url: string }>;
  }>;
}

interface ContextResponse {
  target: { type: 'collect'; id: string; label: string };
  inputs: ContextInput[];
}

const ACTIVE = new Set(['QUEUED', 'RUNNING', 'CANCEL_REQUESTED']);
const STATUS_LABEL: Record<AiMediaWorkflow['status'], string> = {
  QUEUED: '排队中', RUNNING: '处理中', SUCCEEDED: '待审核', FAILED: '失败',
  CANCEL_REQUESTED: '取消中', CANCELLED: '已取消',
};

function imageUrl(value: string) {
  return /^https?:\/\//iu.test(value) ? value : apiUrl(value);
}

function idempotencyKey(prefix: string) {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? `${prefix}-${crypto.randomUUID()}`
    : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function SourceAiMediaPanel({
  target,
  onApplied,
  mediaMutationBusy,
  runMediaMutation,
  onConflictRefresh,
}: {
  target: { type: 'collect'; id: string; label: string; updatedAt?: string };
  onApplied?: (result: AiImageApplyResult) => void;
  mediaMutationBusy: boolean;
  runMediaMutation: RunMediaMutation;
  onConflictRefresh: () => Promise<void>;
}) {
  const [context, setContext] = useState<ContextResponse | null>(null);
  const [workflows, setWorkflows] = useState<AiMediaWorkflow[]>([]);
  const [selectedKey, setSelectedKey] = useState('');
  const [prompt, setPrompt] = useState('保持商品主体、颜色、结构和包装数量不变，优化为干净明亮的电商展示背景，不添加文字或 Logo。');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [disabled, setDisabled] = useState(false);
  const [error, setError] = useState('');
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  const executeLoad = useCallback(async (request: LatestLoadRequest, isCurrent: () => boolean) => {
    try {
      const [contextResult, historyResult] = await Promise.all([
        api.get<ContextResponse>(`/api/ai-images/contexts/collect/${encodeURIComponent(request.targetId)}`),
        api.get<AiMediaWorkflow[]>(`/api/ai-images/workflows?contextType=collect&contextId=${encodeURIComponent(request.targetId)}&limit=20`),
      ]);
      if (!isCurrent()) return;
      if (contextResult.code === 1 && contextResult.data) {
        const nextContext = contextResult.data;
        setContext(nextContext);
        setSelectedKey((current) => nextContext.inputs.some((input) => input.sourceMediaKey === current)
          ? current
          : nextContext.inputs[0]?.sourceMediaKey || '');
        setDisabled(false);
        setError('');
      } else if (contextResult.msg?.includes('disabled') || contextResult.msg?.includes('未启用')) {
        setDisabled(true);
        setContext(null);
        setError('');
      } else {
        setError(contextResult.msg || '图片上下文加载失败');
      }
      if (historyResult.code === 1 && historyResult.data) setWorkflows(historyResult.data);
      else setError(historyResult.msg || '任务历史加载失败');
    } catch (caught) {
      if (isCurrent()) setError(caught instanceof Error ? caught.message : '网络错误，请重试');
    }
  }, []);

  const loadCoordinatorRef = useRef<ReturnType<typeof createLatestLoadCoordinator> | null>(null);
  if (!loadCoordinatorRef.current) {
    loadCoordinatorRef.current = createLatestLoadCoordinator({ execute: executeLoad, onLoadingChange: setLoading });
  }
  loadCoordinatorRef.current.setTarget(target.id);
  const load = useCallback((quiet = false) => loadCoordinatorRef.current!.load(quiet), []);

  useEffect(() => {
    setLoading(true);
    setContext(null);
    setWorkflows([]);
    setSelectedKey('');
    setError('');
    setDisabled(false);
    void load();
  }, [load, target.id]);
  useEffect(() => {
    if (!workflows.some((workflow) => ACTIVE.has(workflow.status))) return;
    const timer = window.setInterval(() => void load(true), 2_000);
    return () => window.clearInterval(timer);
  }, [load, workflows]);

  const selected = useMemo(
    () => context?.inputs.find((input) => input.sourceMediaKey === selectedKey) || null,
    [context, selectedKey],
  );

  async function submit() {
    if (!selected || !prompt.trim()) return;
    setSubmitting(true);
    try {
      let assetId = selected.assetId;
      if (!assetId) {
        const internalized = await api.post<{ id: string }>(
          `/api/ai-images/contexts/collect/${encodeURIComponent(target.id)}/internalize`,
          { sourceMediaKey: selected.sourceMediaKey },
        );
        assetId = internalized.code === 1 ? internalized.data?.id || null : null;
        if (!assetId) {
          toast({ title: '源图保存失败', description: internalized.msg, variant: 'destructive' });
          return;
        }
      }
      const result = await api.post<AiMediaWorkflow>('/api/ai-images/workflows', {
        operation: 'IMAGE_TO_IMAGE', sourceAssetId: assetId, prompt: prompt.trim(), count: 1,
        width: 1024, height: 1024, idempotencyKey: idempotencyKey('image-to-image'),
        context: { type: target.type, id: target.id },
      });
      if (result.code !== 1) {
        toast({ title: '改图任务提交失败', description: result.msg, variant: 'destructive' });
        return;
      }
      toast({ title: '改图任务已提交' });
      await load(true);
    } catch (caught) {
      toast({ title: '改图任务提交失败', description: caught instanceof Error ? caught.message : '网络错误', variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  }

  async function action<TResponse>(
    key: string,
    path: string,
    body: Record<string, unknown>,
    success: string,
    refreshTargetOnConflict = false,
  ): Promise<TResponse | null> {
    if (pendingAction) return null;
    setPendingAction(key);
    try {
      const result = await api.post<TResponse>(path, body);
      if (result.code !== 1) {
        if (refreshTargetOnConflict && isMediaMutationConflict(result)) {
          toast({ title: '商品图片已变化', description: '已刷新最新图片，请重新确认后再操作', variant: 'destructive' });
          await Promise.all([onConflictRefresh(), load(true)]);
          return null;
        }
        toast({ title: '操作失败', description: result.msg, variant: 'destructive' });
        return null;
      }
      toast({ title: success });
      await load(true);
      return result.data || null;
    } catch (caught) {
      toast({ title: '操作失败', description: caught instanceof Error ? caught.message : '网络错误', variant: 'destructive' });
      return null;
    } finally {
      setPendingAction(null);
    }
  }

  async function applyWorkflow(workflow: AiMediaWorkflow, job: AiMediaWorkflow['jobs'][number]) {
    if (!target.updatedAt) {
      toast({ title: '商品版本缺失', description: '请刷新商品后重试', variant: 'destructive' });
      await onConflictRefresh();
      return;
    }
    const execution = await runMediaMutation(() => action<AiImageApplyResult>(
      `apply:${workflow.id}`,
      `/api/ai-images/jobs/${job.id}/apply`,
      {
        mode: 'append', targetType: 'collect', targetId: target.id,
        expectedTargetUpdatedAt: target.updatedAt,
      },
      '候选图已追加到商品',
      true,
    ));
    if (!execution.started) {
      toast({ title: '图片正在保存', description: '请等待当前图片操作完成后重试' });
      return;
    }
    if (execution.value) onApplied?.(execution.value);
  }

  if (loading) return <div className="flex items-center gap-2 border-t pt-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />加载 AI 图片工作流</div>;

  return (
    <section className="space-y-4 border-t pt-4" aria-label="AI 改图">
      <div className="flex items-center justify-between gap-3">
        <div><h3 className="text-sm font-medium">AI 改图</h3><p className="mt-1 text-xs text-muted-foreground">从当前商品源图创建候选结果，审核前不会修改商品图片。</p></div>
        <Button type="button" size="icon" variant="ghost" onClick={() => void load()} title="刷新任务历史"><RefreshCw className="h-4 w-4" /></Button>
      </div>

      {error ? <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</div> : null}
      {disabled ? <p className="text-sm text-muted-foreground">新建 AI 改图任务当前关闭，已有任务仍可查看和处理。</p> : null}
      {!disabled && !context?.inputs.length ? <p className="text-sm text-muted-foreground">当前采集快照没有可用于 AI 改图的商品级图片。</p> : null}

      {!disabled && context?.inputs.length ? <>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {context.inputs.map((input) => (
          <button key={input.sourceMediaKey} type="button" onClick={() => setSelectedKey(input.sourceMediaKey)}
            className={`relative h-20 w-20 shrink-0 overflow-hidden rounded-md border-2 bg-muted ${selectedKey === input.sourceMediaKey ? 'border-primary' : 'border-transparent'}`}
            title="选择为改图源图" aria-pressed={selectedKey === input.sourceMediaKey} aria-label={`选择商品源图 ${input.sourceMediaKey}`}>
            <img src={imageUrl(input.assetUrl || input.sourceUrl)} alt="商品源图" className="h-full w-full object-cover" />
            {selectedKey === input.sourceMediaKey ? <span className="absolute right-1 top-1 rounded-full bg-primary p-0.5 text-primary-foreground"><Check className="h-3 w-3" /></span> : null}
          </button>
        ))}
      </div>

      <div>
        <Label htmlFor={`ai-media-prompt-${target.id}`}>改图要求</Label>
        <textarea id={`ai-media-prompt-${target.id}`} value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={3} maxLength={8000}
          className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
      </div>
      <Button type="button" size="sm" onClick={submit} disabled={submitting || !selected || !prompt.trim()}>
        {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
        {submitting ? '正在提交' : '创建改图候选'}
      </Button>
      </> : null}

      <div className="space-y-2">
        <h4 className="text-xs font-medium text-muted-foreground">任务历史</h4>
        {!workflows.length ? <p className="text-sm text-muted-foreground">暂无改图任务</p> : workflows.map((workflow) => {
          const job = workflow.jobs[workflow.jobs.length - 1];
          const output = job?.assets?.[0];
          const source = workflow.inputs[0];
          return <div key={workflow.id} className="grid gap-3 rounded-md border p-3 md:grid-cols-[148px_minmax(0,1fr)_auto] md:items-center">
            <div className="grid grid-cols-2 gap-1">
              {source ? <a href={imageUrl(source.url)} target="_blank" rel="noreferrer" className="relative h-[72px] w-[72px] overflow-hidden rounded border bg-muted" title="打开源图"><img src={imageUrl(source.url)} alt="改图源图" className="h-full w-full object-cover" /><span className="absolute bottom-0 left-0 bg-black/65 px-1 text-[10px] text-white">源图</span></a> : <div className="h-[72px] w-[72px] rounded border bg-muted" />}
              {output ? <a href={imageUrl(output.url)} target="_blank" rel="noreferrer" className="relative h-[72px] w-[72px] overflow-hidden rounded border bg-muted" title="打开候选原图"><img src={imageUrl(output.url)} alt="AI 改图候选" className="h-full w-full object-cover" /><span className="absolute bottom-0 left-0 bg-black/65 px-1 text-[10px] text-white">候选</span></a> : <div className="flex h-[72px] w-[72px] items-center justify-center rounded border bg-muted"><ImageIcon className="h-5 w-5 text-muted-foreground" /></div>}
            </div>
            <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Badge variant={workflow.status === 'FAILED' ? 'destructive' : 'secondary'}>{workflow.status === 'SUCCEEDED' && workflow.reviewStatus !== 'PENDING' ? '已完成' : STATUS_LABEL[workflow.status]}</Badge>{workflow.reviewStatus === 'APPROVED' ? <Badge>已通过</Badge> : workflow.reviewStatus === 'REJECTED' ? <Badge variant="outline">已拒绝</Badge> : null}{job?.appliedMode ? <Badge variant="outline">{job.appliedMode === 'replace' ? '已替换' : '已追加'}</Badge> : null}</div><p className="mt-1 text-xs text-muted-foreground">第 {workflow.currentAttempt} 次尝试 · {new Date(workflow.createdAt).toLocaleString()}</p>{job?.prompt ? <p className="mt-1 line-clamp-2 text-xs">{job.prompt}</p> : null}{job?.errorMessage ? <p className="mt-1 truncate text-xs text-destructive">{job.errorMessage}</p> : null}</div>
            <div className="flex flex-wrap gap-1.5">
              {ACTIVE.has(workflow.status) ? <Button size="sm" variant="outline" disabled={Boolean(pendingAction)} onClick={() => void action(`cancel:${workflow.id}`, `/api/ai-images/workflows/${workflow.id}/cancel`, { expectedRevision: workflow.revision }, '已请求取消')}><Square className="h-3.5 w-3.5" />取消</Button> : null}
              {workflow.status === 'FAILED' && !job?.providerJobId ? <Button size="sm" variant="outline" disabled={Boolean(pendingAction)} onClick={() => void action(`retry:${workflow.id}`, `/api/ai-images/workflows/${workflow.id}/retry`, { expectedRevision: workflow.revision, idempotencyKey: idempotencyKey('retry') }, '已重新排队')}><RotateCcw className="h-3.5 w-3.5" />重试</Button> : null}
              {workflow.status === 'SUCCEEDED' && workflow.reviewStatus === 'PENDING' && output ? <><Button size="sm" disabled={Boolean(pendingAction)} onClick={() => void action(`approve:${workflow.id}`, `/api/ai-images/workflows/${workflow.id}/review`, { expectedRevision: workflow.revision, outputAssetId: output.id, decision: 'APPROVE' }, '候选图已通过审核')}><Check className="h-3.5 w-3.5" />通过</Button><Button size="sm" variant="outline" disabled={Boolean(pendingAction)} onClick={() => void action(`reject:${workflow.id}`, `/api/ai-images/workflows/${workflow.id}/review`, { expectedRevision: workflow.revision, outputAssetId: output.id, decision: 'REJECT' }, '候选图已拒绝')}><X className="h-3.5 w-3.5" />拒绝</Button></> : null}
              {workflow.reviewStatus === 'APPROVED' && job && !job.appliedMode ? <Button size="sm" variant="outline" disabled={Boolean(pendingAction) || mediaMutationBusy || !target.updatedAt} onClick={() => void applyWorkflow(workflow, job)}><ImageIcon className="h-3.5 w-3.5" />追加</Button> : null}
            </div>
          </div>;
        })}
      </div>
    </section>
  );
}
