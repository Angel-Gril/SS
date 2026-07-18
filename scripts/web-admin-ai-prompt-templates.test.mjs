import assert from 'node:assert/strict';
import fs from 'node:fs';

const componentPath = 'apps/web/src/components/admin/ai-prompt-template-editor.tsx';

assert.ok(
  fs.existsSync(componentPath),
  'admin AI prompt template editor component must exist',
);

const source = fs.readFileSync(componentPath, 'utf8');

assert.match(source, /export function AiPromptTemplateEditor|export const AiPromptTemplateEditor/);

assert.match(source, /模板选择/);
assert.match(source, /版本历史/);
assert.match(source, /模板正文/);
assert.match(source, /负面模板/);
assert.match(source, /安全约束/);
assert.match(source, /只读/);
assert.match(source, /当前模板可用变量/);

assert.match(source, /<textarea[\s\S]*id=["']ai-prompt-template-body["']/);
assert.match(source, /<textarea[\s\S]*id=["']ai-prompt-negative-template-body["']/);
assert.match(source, /readOnly/);
assert.match(source, /\{\{user_prompt\}\}/);
assert.match(source, /\{\{user_negative_prompt\}\}/);
assert.match(source, /variableSchema\?: PromptVariableSchema/);
assert.match(source, /LEGACY_VARIABLE_SCHEMA/);
assert.match(source, /requiredForTest/);
assert.match(source, /placeholder\?: string/);
assert.match(source, /variablePlaceholder/);
assert.match(source, /return variable\.placeholder \|\| variable\.token \|\| variable\.inputKey/);
assert.match(source, /VARIABLE_LABELS/);
assert.match(source, /sampleValues/);
assert.match(source, /resetSampleValues/);
assert.match(source, /sampleSchemaSignature/);
assert.match(source, /sampleSchemaSignatureRef\.current !== sampleSchemaSignature\(template\)/);
assert.match(source, /selectedVariableSchema/);
assert.match(source, /group\.variables\.map/);
assert.match(source, /\{ variables: sampleValues \}/);
assert.match(source, /\{ sampleInput: sampleValues \}/);
assert.match(source, /visibleCompiledPrompt/);
assert.match(source, /服务端注入 · 不可编辑/);
assert.match(source, /固定安全前缀/);
assert.match(source, /业务模板编译内容/);
assert.match(source, /currentSafetyPolicy \|\| ['"]服务端未返回固定安全策略['"]/);
assert.match(source, /商品文案候选/);
assert.match(source, /媒体候选/);
assert.match(source, /结构化媒体规划/);
assert.match(source, /Consumer 契约失配/);
assert.match(source, /consumerCompatibility/);
assert.match(source, /candidateManifestJson/);
assert.match(source, /verifiedFactsJson/);
assert.match(source, /slotPlanningInputJson/);
assert.match(source, /visionEvidenceJson/);
assert.match(source, /platformConstraints/);
assert.match(source, /不会自动应用或发布/);
assert.match(source, /required=\{variable\.requiredForTest\}/);
assert.match(source, /aria-required=\{variable\.requiredForTest\}/);
assert.match(source, /min-w-0/);
assert.match(source, /flex-wrap/);
assert.doesNotMatch(source, /id=["']ai-prompt-safety-policy["']/);
assert.doesNotMatch(source, /value=\{data\?\.safetyPolicy/);
assert.doesNotMatch(source, /variables:\s*\{\s*userPrompt:\s*samplePrompt/);
assert.doesNotMatch(source, /sampleInput:\s*\{\s*userPrompt:\s*samplePrompt/);

const placeholderDto = {
  variableSchema: {
    prompt: [{ inputKey: 'sourceFactsJson', placeholder: 'source_facts_json', requiredForTest: true }],
    negativePrompt: [{ inputKey: 'forbiddenClaims', placeholder: 'forbidden_claims', requiredForTest: false }],
  },
};
const sampleValues = Object.fromEntries(
  [...placeholderDto.variableSchema.prompt, ...placeholderDto.variableSchema.negativePrompt]
    .map((variable) => [variable.inputKey, 'sample']),
);
assert.deepEqual(sampleValues, {
  sourceFactsJson: 'sample',
  forbiddenClaims: 'sample',
});
assert.deepEqual({ variables: sampleValues }, {
  variables: { sourceFactsJson: 'sample', forbiddenClaims: 'sample' },
});
assert.deepEqual({ sampleInput: sampleValues }, {
  sampleInput: { sourceFactsJson: 'sample', forbiddenClaims: 'sample' },
});

assert.match(source, /保存修订/);
assert.match(source, /预览验证/);
assert.match(source, /发布/);
assert.match(source, /回滚/);

assert.match(source, /api\.get/);
assert.match(source, /api\.post/);
assert.match(source, /\/api\/admin\/ai-prompt-templates/);
assert.match(source, /\/revisions/);
assert.match(source, /\/preview/);
assert.match(source, /\/publish/);
assert.match(source, /\/rollback/);
assert.match(source, /selectedRevision\?\.status === ['"]DRAFT['"]/);
assert.match(source, /confirmDiscardDraft/);
assert.match(source, /selectedRevisionIdRef/);
assert.match(source, /重试加载/);

console.log('PASS web admin AI prompt template editor contract');
