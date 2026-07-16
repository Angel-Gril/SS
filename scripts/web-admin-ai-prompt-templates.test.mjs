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
assert.match(source, /可用变量/);

assert.match(source, /<textarea[\s\S]*id=["']ai-prompt-template-body["']/);
assert.match(source, /<textarea[\s\S]*id=["']ai-prompt-negative-template-body["']/);
assert.match(source, /readOnly/);
assert.match(source, /\{\{user_prompt\}\}/);
assert.match(source, /\{\{user_negative_prompt\}\}/);

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
