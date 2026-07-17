'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, History, Loader2, RotateCcw, Save } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/use-toast';
import { api } from '@/lib/api';

interface PromptRevision {
  id: string;
  templateKey: string;
  promptTemplate: string;
  negativePromptTemplate: string;
  note: string | null;
  status: 'DRAFT' | 'PUBLISHED';
  checksum: string;
  createdAt: string;
}

interface PromptRelease {
  id: string;
  revisionId: string;
  sequence: number;
  action: 'PUBLISH' | 'ROLLBACK';
  createdAt: string;
}

interface PromptTemplateItem {
  key: string;
  label: string;
  currentSequence: number;
  activeRevision: PromptRevision | null;
  activeRelease: PromptRelease | null;
  revisions: PromptRevision[];
  releases: PromptRelease[];
  variableSchema?: PromptVariableSchema;
}

interface PromptVariableDefinition {
  inputKey: string;
  placeholder?: string;
  token?: string;
  requiredForTest: boolean;
  label?: string;
}

interface PromptVariableSchema {
  prompt: PromptVariableDefinition[];
  negativePrompt: PromptVariableDefinition[];
  safetyPolicy?: string;
  outputMode?: 'media_candidate' | 'listing_copy_candidate';
}

interface PromptTemplateData {
  allowedVariables: string[];
  safetyPolicy: string;
  items: PromptTemplateItem[];
}

interface TestResult {
  testRunId: string;
  revisionId: string;
  checksum: string;
  resolvedPrompt: string;
  resolvedNegativePrompt: string;
}

interface DraftValues {
  promptTemplate: string;
  negativePromptTemplate: string;
  note: string;
}

const API_BASE = '/api/admin/ai-prompt-templates';
const LEGACY_VARIABLE_SCHEMA: PromptVariableSchema = {
  prompt: [{ inputKey: 'userPrompt', placeholder: 'user_prompt', requiredForTest: true, label: '验证用正向输入' }],
  negativePrompt: [{ inputKey: 'userNegativePrompt', placeholder: 'user_negative_prompt', requiredForTest: false, label: '验证用负向输入' }],
  outputMode: 'media_candidate',
};
const VARIABLE_LABELS: Record<string, string> = {
  userPrompt: '验证用正向输入',
  userNegativePrompt: '验证用负向输入',
  sourceFactsJson: '来源事实 JSON',
  confirmedAttributesJson: '已确认属性 JSON',
  ozonCategoryName: 'Ozon 类目名称',
  targetLanguage: '目标语言',
  userInstructions: '人工补充要求',
  forbiddenClaims: '禁止使用的声明',
};
const VARIABLE_DEFAULTS: Record<string, string> = {
  userPrompt: '白底棚拍，保持商品主体、颜色和结构一致',
  userNegativePrompt: '水印、错误文字、虚构认证、变形商品',
  sourceFactsJson: '{\n  "product": "不锈钢保温杯",\n  "capacityMl": 500\n}',
  confirmedAttributesJson: '{\n  "material": "不锈钢",\n  "capacity_ml": 500\n}',
  ozonCategoryName: '保温杯',
  targetLanguage: '俄语',
  userInstructions: '',
  forbiddenClaims: '医疗级、官方认证、绝对保温时长',
};

function variableSchemaFor(template?: PromptTemplateItem | null): PromptVariableSchema {
  return template?.variableSchema || LEGACY_VARIABLE_SCHEMA;
}

function initialSampleValues(schema: PromptVariableSchema) {
  return [...schema.prompt, ...schema.negativePrompt].reduce<Record<string, string>>((values, variable) => {
    values[variable.inputKey] = VARIABLE_DEFAULTS[variable.inputKey] || '';
    return values;
  }, {});
}

function variablePlaceholder(variable: PromptVariableDefinition) {
  return variable.placeholder || variable.token || variable.inputKey;
}

function sampleSchemaSignature(template?: PromptTemplateItem | null) {
  const schema = variableSchemaFor(template);
  return JSON.stringify({
    templateKey: template?.key || 'text-to-image.base',
    prompt: schema.prompt.map((variable) => ({
      inputKey: variable.inputKey,
      placeholder: variablePlaceholder(variable),
      requiredForTest: variable.requiredForTest,
    })),
    negativePrompt: schema.negativePrompt.map((variable) => ({
      inputKey: variable.inputKey,
      placeholder: variablePlaceholder(variable),
      requiredForTest: variable.requiredForTest,
    })),
  });
}

function outputModeCopy(outputMode?: PromptVariableSchema['outputMode']) {
  if (outputMode === 'listing_copy_candidate') {
    return {
      label: '商品文案候选',
      description: '模板只生成待审核的标题或描述候选，不会自动写入商品草稿或发布到 Ozon。',
    };
  }
  return {
    label: '媒体候选',
    description: '模板只生成待审核的媒体候选，不会自动应用到商品或发布到 Ozon。',
  };
}

function visibleCompiledPrompt(resolvedPrompt: string, safetyPolicy?: string) {
  if (!safetyPolicy) return resolvedPrompt;
  const prefix = `${safetyPolicy}\n\n`;
  return resolvedPrompt.startsWith(prefix) ? resolvedPrompt.slice(prefix.length) : resolvedPrompt;
}

export function AiPromptTemplateEditor() {
  const [data, setData] = useState<PromptTemplateData | null>(null);
  const [selectedKey, setSelectedKey] = useState('text-to-image.base');
  const [selectedRevisionId, setSelectedRevisionId] = useState<string | null>(null);
  const [promptTemplate, setPromptTemplate] = useState('');
  const [negativePromptTemplate, setNegativePromptTemplate] = useState('');
  const [note, setNote] = useState('');
  const [sampleValues, setSampleValues] = useState<Record<string, string>>(
    () => initialSampleValues(LEGACY_VARIABLE_SCHEMA),
  );
  const [preview, setPreview] = useState<TestResult | null>(null);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [busy, setBusy] = useState<string | null>('load');
  const [draftBaseline, setDraftBaseline] = useState<DraftValues | null>(null);
  const selectedRevisionIdRef = useRef<string | null>(null);
  const sampleSchemaSignatureRef = useRef(sampleSchemaSignature(null));

  const selectedTemplate = useMemo(
    () => data?.items.find((item) => item.key === selectedKey) || data?.items[0] || null,
    [data, selectedKey],
  );
  const selectedRevision = useMemo(
    () => selectedTemplate?.revisions.find((item) => item.id === selectedRevisionId) || null,
    [selectedRevisionId, selectedTemplate],
  );
  const selectedVariableSchema = useMemo(
    () => variableSchemaFor(selectedTemplate),
    [selectedTemplate],
  );
  const sampleGroups = useMemo(() => ([
    { key: 'prompt', label: '正文变量', variables: selectedVariableSchema.prompt },
    { key: 'negative', label: '约束变量', variables: selectedVariableSchema.negativePrompt },
  ]).filter((group) => group.variables.length > 0), [selectedVariableSchema]);
  const currentSafetyPolicy = selectedVariableSchema.safetyPolicy || data?.safetyPolicy || '';
  const modeCopy = outputModeCopy(selectedVariableSchema.outputMode);
  const isRevisionView = Boolean(selectedRevision);
  const isBusy = busy !== null;
  const hasUnsavedDraft = !isRevisionView && Boolean(draftBaseline) && (
    promptTemplate !== draftBaseline?.promptTemplate
    || negativePromptTemplate !== draftBaseline?.negativePromptTemplate
    || note !== draftBaseline?.note
  );
  const canPublish = selectedRevision?.status === 'DRAFT'
    && testResult?.revisionId === selectedRevision.id
    && testResult.checksum === selectedRevision.checksum;

  useEffect(() => {
    void loadTemplates();
  }, []);

  useEffect(() => {
    if (!hasUnsavedDraft) return undefined;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [hasUnsavedDraft]);

  async function loadTemplates(preferredRevisionId?: string | null) {
    setBusy('load');
    try {
      const response = await api.get<PromptTemplateData>(API_BASE);
      if (response.code !== 1 || !response.data) {
        throw new Error(response.msg || '提示词模板加载失败');
      }
      setData(response.data);
      const template = response.data.items.find((item) => item.key === selectedKey)
        || response.data.items[0];
      if (!template) return;
      setSelectedKey(template.key);
      if (sampleSchemaSignatureRef.current !== sampleSchemaSignature(template)) {
        resetSampleValues(template);
      }
      const preferred = preferredRevisionId
        ? template.revisions.find((item) => item.id === preferredRevisionId)
        : null;
      if (preferred) {
        selectRevision(preferred);
      } else {
        startNewRevision(template.activeRevision);
      }
    } catch (error) {
      toast({
        title: '提示词模板加载失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    } finally {
      setBusy(null);
    }
  }

  function resetSampleValues(template?: PromptTemplateItem | null) {
    const schema = variableSchemaFor(template);
    sampleSchemaSignatureRef.current = sampleSchemaSignature(template);
    setSampleValues(initialSampleValues(schema));
    setPreview(null);
    setTestResult(null);
  }

  function startNewRevision(source?: PromptRevision | null) {
    const next = {
      promptTemplate: source?.promptTemplate || 'Create an Ozon-ready product image.\n{{user_prompt}}',
      negativePromptTemplate:
        source?.negativePromptTemplate || 'Avoid visual defects and unsupported claims.\n{{user_negative_prompt}}',
      note: '',
    };
    selectedRevisionIdRef.current = null;
    setSelectedRevisionId(null);
    setPromptTemplate(next.promptTemplate);
    setNegativePromptTemplate(next.negativePromptTemplate);
    setNote(next.note);
    setDraftBaseline(next);
    setPreview(null);
    setTestResult(null);
  }

  function selectRevision(revision: PromptRevision) {
    selectedRevisionIdRef.current = revision.id;
    setSelectedRevisionId(revision.id);
    setPromptTemplate(revision.promptTemplate);
    setNegativePromptTemplate(revision.negativePromptTemplate);
    setNote(revision.note || '');
    setDraftBaseline(null);
    setPreview(null);
    setTestResult(null);
  }

  function confirmDiscardDraft(): boolean {
    return !hasUnsavedDraft || window.confirm('当前修订尚未保存，确认放弃这些修改？');
  }

  async function saveRevision() {
    if (!selectedTemplate) return;
    setBusy('save');
    try {
      const response = await api.post<PromptRevision>(
        API_BASE + '/' + encodeURIComponent(selectedTemplate.key) + '/revisions',
        { promptTemplate, negativePromptTemplate, note: note.trim() || undefined },
      );
      if (response.code !== 1 || !response.data) {
        throw new Error(response.msg || '修订保存失败');
      }
      toast({ title: '修订已保存', description: '请先预览并记录 PASS，再发布该模板版本。' });
      await loadTemplates(response.data.id);
    } catch (error) {
      toast({
        title: '修订保存失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    } finally {
      setBusy(null);
    }
  }

  async function previewRevision() {
    if (!selectedRevision) return;
    const revisionId = selectedRevision.id;
    setBusy('preview');
    try {
      const response = await api.post<TestResult>(
        API_BASE + '/revisions/' + revisionId + '/preview',
        { variables: sampleValues },
      );
      if (response.code !== 1 || !response.data) {
        throw new Error(response.msg || '预览失败');
      }
      if (selectedRevisionIdRef.current === revisionId) {
        setPreview(response.data);
        setTestResult(null);
      }
    } catch (error) {
      toast({
        title: '预览失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    } finally {
      setBusy(null);
    }
  }

  async function validateRevision() {
    if (!selectedRevision || selectedRevision.status !== 'DRAFT') return;
    const revisionId = selectedRevision.id;
    setBusy('test');
    try {
      const response = await api.post<TestResult>(
        API_BASE + '/revisions/' + revisionId + '/test',
        { sampleInput: sampleValues },
      );
      if (response.code !== 1 || !response.data) {
        throw new Error(response.msg || '模板验证失败');
      }
      if (selectedRevisionIdRef.current === revisionId) {
        setPreview(response.data);
        setTestResult(response.data);
        toast({ title: '模板验证通过', description: '该修订现在可以发布。' });
      }
    } catch (error) {
      toast({
        title: '模板验证失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    } finally {
      setBusy(null);
    }
  }

  async function publishRevision() {
    if (!selectedTemplate || !selectedRevision || !canPublish || !testResult) return;
    setBusy('publish');
    try {
      const response = await api.post(
        API_BASE + '/' + encodeURIComponent(selectedTemplate.key) + '/publish',
        {
          revisionId: selectedRevision.id,
          testRunId: testResult.testRunId,
          expectedSequence: selectedTemplate.currentSequence,
        },
      );
      if (response.code !== 1) throw new Error(response.msg || '发布失败');
      toast({
        title: '提示词版本已发布',
        description: `${modeCopy.label}仍需在业务工作流中审核，不会自动应用或发布。`,
      });
      await loadTemplates();
    } catch (error) {
      toast({
        title: '发布失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
      await loadTemplates(selectedRevision.id);
    } finally {
      setBusy(null);
    }
  }

  async function rollbackRevision(revision: PromptRevision) {
    if (!selectedTemplate) return;
    if (!window.confirm('确认回滚到所选历史版本？历史记录不会被覆盖。')) return;
    setBusy('rollback');
    try {
      const response = await api.post(
        API_BASE + '/' + encodeURIComponent(selectedTemplate.key) + '/rollback',
        {
          targetRevisionId: revision.id,
          expectedSequence: selectedTemplate.currentSequence,
        },
      );
      if (response.code !== 1) throw new Error(response.msg || '回滚失败');
      toast({
        title: '已追加回滚发布',
        description: '既有任务保留原冻结版本；候选内容不会自动应用或发布。',
      });
      await loadTemplates();
    } catch (error) {
      toast({
        title: '回滚失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
      await loadTemplates(revision.id);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="space-y-4 rounded-md border p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-medium">AI 提示词版本管理</h3>
            <Badge variant="outline">{modeCopy.label}</Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            管理员修改业务模板；固定安全约束只读，任务入队后冻结版本和最终提示词。
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {modeCopy.description}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!data && busy === null && (
            <Button size="sm" variant="outline" onClick={() => void loadTemplates()}>
              重试加载
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              if (confirmDiscardDraft()) {
                startNewRevision(selectedRevision || selectedTemplate?.activeRevision);
              }
            }}
            disabled={!selectedTemplate || isBusy}
          >
            新建修订
          </Button>
          <Button size="sm" onClick={saveRevision} disabled={isRevisionView || isBusy}>
            {busy === 'save' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            <span className="ml-1">保存修订</span>
          </Button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="space-y-3">
          <label className="block space-y-1 text-xs">
            <span className="font-medium">模板选择</span>
            <select
              value={selectedTemplate?.key || selectedKey}
              onChange={(event) => {
                if (!confirmDiscardDraft()) return;
                setSelectedKey(event.target.value);
                const next = data?.items.find((item) => item.key === event.target.value);
                resetSampleValues(next);
                startNewRevision(next?.activeRevision);
              }}
              disabled={isBusy}
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
            >
              {(data?.items || []).map((item) => (
                <option key={item.key} value={item.key}>{item.label} · {item.key}</option>
              ))}
            </select>
          </label>

          <label className="block space-y-1 text-xs">
            <span className="font-medium">模板正文</span>
            <textarea
              id="ai-prompt-template-body"
              value={promptTemplate}
              onChange={(event) => setPromptTemplate(event.target.value)}
              readOnly={isRevisionView}
              disabled={isBusy}
              className="min-h-36 w-full rounded-md border bg-background p-3 font-mono text-xs"
            />
          </label>

          <label className="block space-y-1 text-xs">
            <span className="font-medium">负面模板</span>
            <textarea
              id="ai-prompt-negative-template-body"
              value={negativePromptTemplate}
              onChange={(event) => setNegativePromptTemplate(event.target.value)}
              readOnly={isRevisionView}
              disabled={isBusy}
              className="min-h-24 w-full rounded-md border bg-background p-3 font-mono text-xs"
            />
          </label>

          <div className="space-y-3">
            {sampleGroups.map((group) => (
              <div key={group.key} className="min-w-0 space-y-2">
                <div className="text-xs font-medium text-muted-foreground">{group.label}</div>
                <div className="grid min-w-0 gap-3 lg:grid-cols-2">
                  {group.variables.map((variable) => (
                    <label key={variable.inputKey} className="block min-w-0 space-y-1 text-xs">
                      <span className="flex min-w-0 flex-wrap items-center gap-1.5 font-medium">
                        <span>{variable.label || VARIABLE_LABELS[variable.inputKey] || variable.inputKey}</span>
                        {variable.requiredForTest && <Badge variant="secondary">必填</Badge>}
                      </span>
                      <code className="block max-w-full break-all text-[11px] text-muted-foreground">
                        {'{{' + variablePlaceholder(variable) + '}}'}
                      </code>
                      <textarea
                        value={sampleValues[variable.inputKey] || ''}
                        onChange={(event) => setSampleValues((current) => ({
                          ...current,
                          [variable.inputKey]: event.target.value,
                        }))}
                        disabled={isBusy}
                        required={variable.requiredForTest}
                        aria-required={variable.requiredForTest}
                        aria-label={variable.label || VARIABLE_LABELS[variable.inputKey] || variable.inputKey}
                        className="min-h-20 w-full min-w-0 rounded-md border bg-background p-2 text-xs"
                      />
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {!isRevisionView && (
            <label className="block space-y-1 text-xs">
              <span className="font-medium">修订说明</span>
              <input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                disabled={isBusy}
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                placeholder="说明这次修改的目标"
              />
            </label>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={previewRevision}
              disabled={!selectedRevision || isBusy}
            >
              预览验证
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={validateRevision}
              disabled={selectedRevision?.status !== 'DRAFT' || isBusy}
            >
              <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
              记录 PASS
            </Button>
            <Button
              size="sm"
              onClick={publishRevision}
              disabled={!canPublish || isBusy}
            >
              发布
            </Button>
            {selectedRevision && (
              <Badge variant={selectedRevision.status === 'PUBLISHED' ? 'default' : 'secondary'}>
                {selectedRevision.status === 'PUBLISHED' ? '已发布 · 只读' : '草稿 · 只读'}
              </Badge>
            )}
          </div>

          {preview && (
            <div className="space-y-2 rounded-md border bg-muted/20 p-3 text-xs">
              <div className="font-medium">编译预览</div>
              <div className="text-[11px] font-medium text-muted-foreground">固定安全前缀</div>
              <pre className="whitespace-pre-wrap break-words rounded border bg-background p-2">
                {currentSafetyPolicy || '服务端未返回固定安全策略'}
              </pre>
              <div className="text-[11px] font-medium text-muted-foreground">业务模板编译内容</div>
              <pre className="whitespace-pre-wrap break-words">{
                visibleCompiledPrompt(
                  preview.resolvedPrompt,
                  currentSafetyPolicy,
                )
              }</pre>
              <pre className="whitespace-pre-wrap break-words text-muted-foreground">
                {preview.resolvedNegativePrompt}
              </pre>
            </div>
          )}

          <div className="min-w-0 space-y-2 rounded-md border bg-muted/20 p-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-medium">固定安全约束</span>
              <Badge variant="secondary">服务端注入 · 不可编辑</Badge>
            </div>
            <pre className="max-w-full whitespace-pre-wrap break-words rounded border bg-background p-2 text-xs">
              {currentSafetyPolicy || '服务端未返回固定安全策略'}
            </pre>
            <div className="text-xs text-muted-foreground">
              当前模板可用变量
            </div>
            <div className="flex min-w-0 flex-wrap gap-1.5">
              {[...selectedVariableSchema.prompt, ...selectedVariableSchema.negativePrompt].map((variable) => (
                <code key={variable.inputKey} className="max-w-full break-all rounded border bg-background px-1.5 py-0.5 text-[11px]">
                  {'{{' + variablePlaceholder(variable) + '}}'}
                </code>
              ))}
            </div>
          </div>
        </div>

        <aside className="space-y-2 rounded-md border bg-muted/10 p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <History className="h-4 w-4" />
            版本历史
          </div>
          {busy === 'load' && <Loader2 className="h-4 w-4 animate-spin" />}
          {(selectedTemplate?.revisions || []).map((revision) => {
            const release = selectedTemplate?.releases
              .filter((item) => item.revisionId === revision.id)
              .at(-1);
            const active = selectedTemplate?.activeRevision?.id === revision.id;
            return (
              <div key={revision.id} className="space-y-2 rounded-md border bg-background p-2">
                <button
                  type="button"
                  onClick={() => {
                    if (confirmDiscardDraft()) selectRevision(revision);
                  }}
                  disabled={isBusy}
                  aria-current={active ? 'true' : undefined}
                  className="w-full text-left disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-medium">
                      {active ? '当前版本' : revision.status === 'PUBLISHED' ? '已发布' : '草稿'}
                    </span>
                    <span>#{release?.sequence || '-'}</span>
                  </div>
                  <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                    {revision.checksum.slice(0, 12)}
                  </div>
                  {revision.note && <div className="mt-1 break-words text-xs">{revision.note}</div>}
                </button>
                {revision.status === 'PUBLISHED' && !active && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    onClick={() => rollbackRevision(revision)}
                    disabled={isBusy}
                  >
                    <RotateCcw className="mr-1 h-3.5 w-3.5" />
                    回滚
                  </Button>
                )}
              </div>
            );
          })}
        </aside>
      </div>
    </section>
  );
}
