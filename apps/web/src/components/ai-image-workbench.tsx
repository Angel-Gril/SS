'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ImagePlus, Loader2, Sparkles, Square, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useSystemDialog } from '@/components/system-dialog-provider';
import { toast } from '@/components/ui/use-toast';
import { api, apiUrl } from '@/lib/api';

type AiImageJobStatus = 'PENDING' | 'QUEUED' | 'RUNNING' | 'RETRYING' | 'SUCCEEDED' | 'FAILED' | 'CANCEL_REQUESTED' | 'CANCELLED';

interface AiImageJob {
  id: string;
  status: AiImageJobStatus;
  provider: string;
  model: string;
  prompt: string;
  negativePrompt: string | null;
  requestedImageCount: number;
  width: number;
  height: number;
  attemptCount: number;
  maxAttempts: number;
  billedUnits: number;
  actualCostCents: number | null;
  costStatus: string | null;
  pricing: { currency: 'CNY' | 'USD'; unitCostCents: number; maximumCostCents: number } | null;
  errorCode: string | null;
  errorMessage: string | null;
  appliedMode?: 'append' | 'replace' | null;
  assets?: Array<{ id: string; url: string }>;
}
interface AiImageQuote {
  provider: string;
  model: string;
  currency: 'CNY' | 'USD';
  unitCostCents: number;
  maximumCostCents: number;
  requestedImageCount: number;
  width: number;
  height: number;
  quoteFingerprint: string;
}
interface AiImageSubmission {
  prompt: string;
  negativePrompt: string | null;
  count: number;
  width: number;
  height: number;
  idempotencyKey: string;
  quoteFingerprint: string;
}
interface AiImageApplyResult {
  jobId: string;
  mode: 'append' | 'replace';
  targetType: string;
  targetId: string;
  appliedAt: string;
}


const TERMINAL = new Set<AiImageJobStatus>(['SUCCEEDED', 'FAILED', 'CANCELLED']);
const STATUS_LABEL: Record<AiImageJobStatus, string> = {
  PENDING: '等待创建', QUEUED: '排队中', RUNNING: '生成中', RETRYING: '正在重试',
  SUCCEEDED: '生成完成', FAILED: '生成失败', CANCEL_REQUESTED: '正在取消', CANCELLED: '已取消',
};
const SIZE_OPTIONS = [
  { value: '1024x1024', label: '1:1 · 1024 × 1024' },
  { value: '1024x1536', label: '2:3 · 1024 × 1536' },
  { value: '1536x1024', label: '3:2 · 1536 × 1024' },
];

function createIdempotencyKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `ai-image-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function resolveAssetUrl(value: string) {
  return /^https?:\/\//i.test(value) ? value : apiUrl(value);
}

function formatCost(cents: number, currency: 'CNY' | 'USD') {
  return `${currency} ${(cents / 100).toFixed(2)}`;
}

export function AiImageWorkbench() {
  const systemDialog = useSystemDialog();
  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [count, setCount] = useState('1');
  const [size, setSize] = useState('1024x1024');
  const [job, setJob] = useState<AiImageJob | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const submissionRef = useRef<AiImageSubmission | null>(null);
  const [submissionUnknown, setSubmissionUnknown] = useState(false);
  const [reconfirmQuote, setReconfirmQuote] = useState(false);
  const [quote, setQuote] = useState<AiImageQuote | null>(null);
  const [quoteError, setQuoteError] = useState('');
  const [quoteRevision, setQuoteRevision] = useState(0);
  const [cancelling, setCancelling] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyMode, setApplyMode] = useState<'append' | 'replace'>('append');
  const [targetType, setTargetType] = useState('collect');
  const [targetId, setTargetId] = useState('');

  const [width = 1024, height = 1024] = size.split('x').map(Number);
  const currentQuote = quote?.requestedImageCount === Number(count) && quote.width === width && quote.height === height ? quote : null;

  useEffect(() => {
    let cancelled = false;
    setQuote(null);
    setQuoteError('');
    async function loadQuote() {
      try {
        const res = await api.get<AiImageQuote>(`/api/ai-images/quote?count=${count}&width=${width}&height=${height}`);
        if (cancelled) return;
        if (res.code === 1 && res.data) setQuote(res.data);
        else setQuoteError(res.msg || '暂时无法获取报价');
      } catch {
        if (!cancelled) setQuoteError('网络异常，请重新获取报价');
      }
    }
    void loadQuote();
    return () => { cancelled = true; };
  }, [count, width, height, quoteRevision]);

  useEffect(() => {
    if (!job || TERMINAL.has(job.status)) return;
    let cancelled = false;
    let timer: number | undefined;
    const polledJobId = job.id;

    async function pollJob() {
      try {
        const res = await api.get<AiImageJob>(`/api/ai-images/jobs/${polledJobId}`);
        if (cancelled) return;
        if (res.code === 1 && res.data) {
          const nextJob = res.data;
          setJob((current) => {
            if (!current || current.id !== polledJobId || TERMINAL.has(current.status)) return current;
            return nextJob;
          });
          if (TERMINAL.has(nextJob.status)) return;
        }
      } catch { /* Keep reading the same task after a temporary connection failure. */ }
      if (!cancelled) timer = window.setTimeout(pollJob, 2000);
    }

    timer = window.setTimeout(pollJob, 2000);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [job?.id, job?.status]);

  async function submitJob() {
    if (submittingRef.current || (job && !TERMINAL.has(job.status))) return;
    if (!prompt.trim()) {
      toast({ title: '请输入生成提示词', variant: 'destructive' });
      return;
    }
    if (!submissionRef.current && !currentQuote) return;
    submittingRef.current = true;
    setSubmitting(true);
    const submission = submissionRef.current ? {
      ...submissionRef.current,
      // A changed quote may be confirmed, but an uncertain request always keeps
      // its original key so a late first response cannot create a second task.
      ...(reconfirmQuote && currentQuote ? { quoteFingerprint: currentQuote.quoteFingerprint } : {}),
    } : {
      prompt: prompt.trim(), negativePrompt: negativePrompt.trim() || null,
      count: Number(count), width, height, idempotencyKey: createIdempotencyKey(),
      quoteFingerprint: currentQuote!.quoteFingerprint,
    };
    submissionRef.current = submission;
    try {
      const res = await api.post<AiImageJob>('/api/ai-images/jobs', submission);
      if (res.code === 1 && res.data) {
        submissionRef.current = null;
        setSubmissionUnknown(false);
        setReconfirmQuote(false);
        setJob(res.data);
        setApplyMode('append');
        toast({ title: '生图任务已提交', description: '页面会自动刷新任务状态。' });
      } else {
        const rejected = ['QUOTE_CHANGED', 'INVALID_REQUEST', 'PROVIDER_DISABLED', 'PROVIDER_NOT_READY',
          'AI_MEDIA_WORKFLOW_DISABLED', 'QUOTA_EXCEEDED', 'BUDGET_EXCEEDED', 'IDEMPOTENCY_KEY_CONFLICT',
          'QUEUE_UNAVAILABLE', 'UNSUPPORTED_OPERATION', 'UNSUPPORTED_PROVIDER_MODEL', 'PROMPT_TEMPLATE_UNAVAILABLE',
          'PROMPT_PROFILE_LIMIT_EXCEEDED', 'INVALID_PROMPT_PROFILE_INPUT'].includes(String(res.code));
        if (rejected && !submissionUnknown) submissionRef.current = null;
        setSubmissionUnknown(submissionUnknown || !rejected);
        if (res.code === 'QUOTE_CHANGED') {
          if (submissionUnknown) setReconfirmQuote(true);
          setQuote(null);
          setQuoteRevision((revision) => revision + 1);
        }
        toast({ title: rejected && !submissionUnknown ? '任务未提交' : '暂未收到提交结果', description: res.msg, variant: 'destructive' });
      }
    } catch {
      setSubmissionUnknown(true);
      toast({ title: '暂未收到提交结果', description: '连接恢复后可获取原任务结果。', variant: 'destructive' });
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  async function cancelJob() {
    if (!job) return;
    setCancelling(true);
    const res = await api.post<AiImageJob>(`/api/ai-images/jobs/${job.id}/cancel`);
    setCancelling(false);
    if (res.code === 1 && res.data) {
      setJob(res.data);
      toast({ title: '已请求取消任务' });
    } else toast({ title: '取消失败', description: res.msg, variant: 'destructive' });
  }

  async function applyImages() {
    if (!job || job.status !== 'SUCCEEDED') return;
    if (!targetId.trim()) {
      toast({ title: '请输入目标记录 ID', variant: 'destructive' });
      return;
    }
    const replace = applyMode === 'replace';
    const targetDescription = `${targetType === 'collect' ? '采集商品' : '商品档案'} ${targetId.trim()}`;
    const confirmed = await systemDialog.confirm({
      title: replace ? '确认替换现有图片' : '确认追加候选图片',
      message: replace
        ? `替换会覆盖 ${targetDescription} 的现有图片。此操作不会自动执行，确认后才会应用本次生成结果。`
        : `生成结果将追加到 ${targetDescription}，不会删除或覆盖现有图片。`,
      confirmText: replace ? '确认替换' : '确认追加',
      tone: replace ? 'destructive' : 'default',
    });
    if (!confirmed) return;
    setApplying(true);
    const res = await api.post<AiImageApplyResult>(`/api/ai-images/jobs/${job.id}/apply`, {
      mode: applyMode, targetType, targetId: targetId.trim(),
    });
    setApplying(false);
    if (res.code === 1 && res.data) {
      setJob((current) => {
        if (!current || current.id !== res.data!.jobId) return current;
        return {
          ...current,
          appliedMode: res.data!.mode,
        };
      });
      toast({ title: applyMode === 'append' ? '图片已追加' : '图片已替换' });
    } else toast({ title: '应用失败', description: res.msg, variant: 'destructive' });
  }

  const canCancel = !!job && !TERMINAL.has(job.status) && job.status !== 'CANCEL_REQUESTED';

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm">
        <div className="flex items-start gap-3">
          <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div><p className="font-medium">AI 生图/改图 MVP</p><p className="mt-1 text-muted-foreground">生成结果先作为候选图片保存。默认使用“追加”，绝不自动覆盖商品原图。</p></div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)]">
        <Card>
          <CardHeader className="pb-3"><div><h2 className="font-medium">生成参数</h2><p className="mt-1 text-xs text-muted-foreground">当前版本不包含画布与局部笔刷编辑。</p></div></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="ai-prompt">生成提示词</Label>
              <textarea id="ai-prompt" rows={6} maxLength={8000} value={prompt} disabled={submitting || submissionUnknown} onChange={(e) => setPrompt(e.target.value)} placeholder="例如：保持商品主体和颜色不变，生成干净明亮的电商影棚背景，无文字、无 Logo" className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
              <p className="mt-1 text-right text-xs text-muted-foreground">{prompt.length}/8000</p>
            </div>
            <div>
              <Label htmlFor="ai-negative">负面提示词（可选）</Label>
              <textarea id="ai-negative" rows={3} maxLength={4000} value={negativePrompt} disabled={submitting || submissionUnknown} onChange={(e) => setNegativePrompt(e.target.value)} placeholder="例如：模糊、畸变、文字、水印、额外商品" className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><Label htmlFor="ai-count">生成数量</Label><select id="ai-count" value={count} disabled={submitting || submissionUnknown} onChange={(e) => setCount(e.target.value)} className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm">{[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n} 张</option>)}</select></div>
              <div><Label htmlFor="ai-size">图片尺寸</Label><select id="ai-size" value={size} disabled={submitting || submissionUnknown} onChange={(e) => setSize(e.target.value)} className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm">{SIZE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
            </div>
            <div aria-live="polite" className="rounded-md bg-muted/50 p-3 text-sm">
              {currentQuote ? <><div className="flex flex-wrap items-baseline justify-between gap-2"><span className="text-muted-foreground">单价 {formatCost(currentQuote.unitCostCents, currentQuote.currency)} / 张</span><span className="font-medium">本次最高费用 {formatCost(currentQuote.maximumCostCents, currentQuote.currency)}</span></div><p className="mt-1 text-xs text-muted-foreground">按成功图片计费；点击提交即确认本次最高费用。</p></> : quoteError ? <div className="flex flex-wrap items-center justify-between gap-2"><span>{quoteError}</span><Button variant="outline" size="sm" onClick={() => setQuoteRevision((revision) => revision + 1)}>重新获取报价</Button></div> : <span className="text-muted-foreground">正在获取报价…</span>}
            </div>
            {submissionUnknown ? <p role="status" className="text-sm text-muted-foreground">{reconfirmQuote && currentQuote ? '报价已更新。确认后继续原任务，已接受的任务仍按原价执行。' : '暂未收到提交结果，请获取原任务结果后继续。'}</p> : null}
            <Button onClick={submitJob} disabled={submitting || (!currentQuote && !submissionUnknown) || (!!job && !TERMINAL.has(job.status))}>{submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}{submitting ? '正在提交' : submissionUnknown ? reconfirmQuote && currentQuote ? '确认新报价并继续原任务' : '获取原任务结果' : '提交生图任务'}</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><div className="flex items-center justify-between gap-3"><div><h2 className="font-medium">当前任务</h2><p className="mt-1 text-xs text-muted-foreground">提交后每 2 秒自动轮询。</p></div>{job ? <Badge variant={job.status === 'FAILED' ? 'destructive' : job.status === 'SUCCEEDED' ? 'default' : 'secondary'}>{STATUS_LABEL[job.status]}</Badge> : null}</div></CardHeader>
          <CardContent>
            {!job ? <div className="flex min-h-44 flex-col items-center justify-center text-center text-muted-foreground"><ImagePlus className="mb-2 h-8 w-8 opacity-40" /><p className="text-sm">尚未提交任务</p></div> : (
              <div className="space-y-4 text-sm">
                <div className="grid grid-cols-2 gap-3 rounded-md bg-muted/50 p-3"><div><span className="text-muted-foreground">尺寸</span><p className="font-medium">{job.width} × {job.height}</p></div><div><span className="text-muted-foreground">数量</span><p className="font-medium">{job.requestedImageCount} 张</p></div><div><span className="text-muted-foreground">模型</span><p className="truncate font-medium">{job.model}</p></div><div><span className="text-muted-foreground">尝试次数</span><p className="font-medium">{job.attemptCount}/{job.maxAttempts}</p></div></div>
                {job.pricing ? <div className="space-y-1 rounded-md bg-muted/50 p-3"><p className="text-muted-foreground">确认最高费用 {formatCost(job.pricing.maximumCostCents, job.pricing.currency)}</p>{job.actualCostCents != null && (job.costStatus === 'SETTLED' || job.costStatus === 'RELEASED' || (job.provider === 'fake' && TERMINAL.has(job.status))) ? <p className="font-medium">已记费用 {formatCost(job.actualCostCents, job.pricing.currency)} · {job.billedUnits} 张成功</p> : <p className="text-muted-foreground">费用将在生成结果确认后记录</p>}</div> : <p className="text-xs text-muted-foreground">此任务暂无可用的价格记录</p>}
                {!TERMINAL.has(job.status) ? <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin text-primary" />正在处理，请保持页面打开</div> : null}
                {job.status === 'SUCCEEDED' ? <div className="flex items-center gap-2 text-emerald-600"><CheckCircle2 className="h-4 w-4" />已保存 {job.billedUnits || job.assets?.length || 0} 张候选图</div> : null}
                {job.status === 'FAILED' ? <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-destructive"><div className="flex items-center gap-2 font-medium"><XCircle className="h-4 w-4" />任务失败</div><p className="mt-1 text-xs">{job.errorMessage || job.errorCode || '服务暂时不可用'}</p></div> : null}
                {canCancel ? <Button variant="outline" onClick={cancelJob} disabled={cancelling}>{cancelling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-3.5 w-3.5" />}取消任务</Button> : null}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {job?.status === 'SUCCEEDED' ? <Card>
        <CardHeader className="pb-3"><div><h2 className="font-medium">候选图片</h2><p className="mt-1 text-xs text-muted-foreground">审核生成结果后，再决定追加或替换。</p></div></CardHeader>
        <CardContent className="space-y-5">
          {job.assets?.length ? <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">{job.assets.map((asset, index) => <a key={asset.id || asset.url} href={resolveAssetUrl(asset.url)} target="_blank" rel="noreferrer" className="group relative aspect-square overflow-hidden rounded-lg border bg-muted focus-visible:ring-2 focus-visible:ring-ring"><img src={resolveAssetUrl(asset.url)} alt={`AI 候选图片 ${index + 1}`} className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]" /><span className="absolute bottom-2 left-2 rounded bg-black/65 px-2 py-1 text-xs text-white">候选 {index + 1}</span></a>)}</div> : <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">任务已完成，但接口尚未返回候选图片地址。</div>}
          <div className="border-t pt-4">
            <div className="grid gap-3 md:grid-cols-[180px_minmax(0,1fr)]"><div><Label htmlFor="ai-target-type">目标类型</Label><select id="ai-target-type" value={targetType} onChange={(e) => setTargetType(e.target.value)} className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="collect">采集商品</option><option value="product">商品档案</option></select></div><div><Label htmlFor="ai-target-id">目标记录 ID</Label><Input id="ai-target-id" value={targetId} onChange={(e) => setTargetId(e.target.value)} placeholder="输入要应用图片的商品记录 ID" /></div></div>
            <fieldset className="mt-4"><legend className="text-sm font-medium">应用方式</legend><div className="mt-2 grid gap-3 md:grid-cols-2">
              <label className={`cursor-pointer rounded-lg border p-3 ${applyMode === 'append' ? 'border-primary bg-primary/5' : ''}`}><input className="sr-only" type="radio" name="apply-mode" checked={applyMode === 'append'} onChange={() => setApplyMode('append')} /><span className="flex items-center gap-2 font-medium"><ImagePlus className="h-4 w-4 text-primary" />追加到现有图片</span><span className="mt-1 block text-xs text-muted-foreground">安全默认项，不删除已有图片。</span></label>
              <label className={`cursor-pointer rounded-lg border p-3 ${applyMode === 'replace' ? 'border-destructive bg-destructive/5' : ''}`}><input className="sr-only" type="radio" name="apply-mode" checked={applyMode === 'replace'} onChange={() => setApplyMode('replace')} /><span className="flex items-center gap-2 font-medium"><AlertTriangle className="h-4 w-4 text-destructive" />替换现有图片</span><span className="mt-1 block text-xs text-muted-foreground">替换会覆盖目标商品现有图片，提交前会再次确认。</span></label>
            </div></fieldset>
            <div className="mt-4 flex flex-wrap items-center gap-3"><Button variant={applyMode === 'replace' ? 'destructive' : 'default'} onClick={applyImages} disabled={applying || !!job.appliedMode}>{applying && <Loader2 className="h-4 w-4 animate-spin" />}{job.appliedMode ? '本次结果已应用' : applyMode === 'append' ? '审核并追加' : '审核并替换'}</Button><p className="text-xs text-muted-foreground">任何模式都需要二次确认，系统不会自动应用生成结果。</p></div>
          </div>
        </CardContent>
      </Card> : null}
    </div>
  );
}
