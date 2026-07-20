import assert from 'node:assert/strict';
import fs from 'node:fs';

const panel = fs.readFileSync('apps/web/src/components/ai-media/source-ai-media-panel.tsx', 'utf8');
const workflow = fs.readFileSync('apps/web/src/lib/ai-media-workflow.ts', 'utf8');
const route = fs.readFileSync('apps/server/src/routes/ai-images.ts', 'utf8');

assert.match(panel, /IMAGE_TRANSLATE/u);
assert.match(panel, /图片翻译/u);
assert.match(panel, /sourceLanguage/u);
assert.match(panel, /targetLanguage/u);
assert.match(panel, /terminologies/u);
assert.match(panel, /buildImageTranslationWorkflowRequest/u);
assert.ok(panel.includes('/api/ai-images/capabilities'));
assert.match(panel, /resolveWorkflowSubmissionIntent/u);
assert.match(panel, /translationIntentRef/u);
assert.match(panel, /browserSessionStorage/u);
assert.match(panel, /loadWorkflowSubmissionIntent/u);
assert.match(panel, /saveWorkflowSubmissionIntent/u);
assert.match(panel, /clearWorkflowSubmissionIntent/u);
assert.match(panel, /if \(!capabilities \|\| !readiness\)/u);
assert.match(panel, /!canCreateCurrentOperation/u);
assert.match(panel, /load\(true, true, true\)/u);
assert.match(panel, /isAiMediaWorkflowInputCurrent/u);
assert.match(panel, /追加翻译图/u);
assert.match(panel, /mode: AiMediaApplicationMode = 'append'/u);
assert.doesNotMatch(panel, /IMAGE_TRANSLATE[\s\S]{0,1200}mode: 'replace'/u);
assert.match(panel, /grid-cols-1[\s\S]{0,160}sm:grid-cols-/u);

assert.match(workflow, /normalizeImageTranslationTerminologies/u);
assert.match(workflow, /buildImageTranslationWorkflowRequest/u);
assert.match(workflow, /context: \{ type: 'collect'/u);
assert.match(workflow, /resolveWorkflowSubmissionIntent/u);
assert.match(workflow, /AI_MEDIA_INTENT_TTL_MS/u);
assert.match(workflow, /loadWorkflowSubmissionIntent/u);
assert.match(workflow, /isAiMediaWorkflowInputCurrent/u);

assert.match(route, /app\.get\('\/capabilities'/u);
assert.match(route, /resolveAiImageTranslationReadiness/u);
assert.match(route, /STALE_MEDIA_WORKFLOW/u);
assert.match(route, /terminologies: translationTerminologies/u);
assert.match(route, /source image snapshot changed/u);

console.log('PASS Web source listing translation media workbench contract');
