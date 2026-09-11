import { createHash } from 'node:crypto';
import { z } from 'zod';
import { parseAiPromptPublishedSource } from './ai-prompt-template-source.js';
import { AiImageWanxTrialError } from './ai-image-wanx-trial-preparation.js';
import {
  readAiImageSandboxPrivateBillingEvidence, writeAiImageSandboxPrivateEvidenceBundle,
} from './ai-image-sandbox-billing-settlement.js';

const MAX_RESPONSE_BYTES = 256 * 1024;
const digest = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const jsonBytes = (value: unknown) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
const shaSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const keySchema = z.enum(['full-image-edit.base', 'inpaint.base']);
const timeSchema = z.string().datetime().refine((value) => {
  const time = new Date(value);
  return Number.isFinite(time.getTime()) && time.toISOString() === value;
});
const capturesSchema = z.object({
  schemaVersion: z.literal(1), kind: z.literal('WANX_EDIT_TEMPLATE_SOURCE_CAPTURES_V1'),
  roundId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{7,63}$/u),
  adapterRevision: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u),
  captures: z.array(z.object({
    templateKey: keySchema, capturedAt: timeSchema,
    collectorRef: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u),
    request: z.object({ method: z.literal('GET'), url: z.string().min(1).max(2_048) }).strict(),
    response: z.object({
      httpStatus: z.literal(200),
      contentType: z.string().regex(/^application\/json(?:\s*;\s*charset=utf-8)?$/iu).max(80),
      bodySha256: shaSchema,
      bodyBase64: z.string().min(1).max(Math.ceil(MAX_RESPONSE_BYTES / 3) * 4),
    }).strict(),
  }).strict()).length(2),
}).strict();
const envelopeSchema = z.object({ code: z.literal(1), msg: z.literal('ok'), data: z.unknown() }).strict();

function invalid(): never {
  throw new AiImageWanxTrialError('WANX_TEMPLATE_SOURCE_CAPTURE_INVALID', 'The template source capture is invalid or does not match its selected origin');
}

function canonicalOrigin(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.origin !== value || value.length > 1_024) invalid();
    return url.origin;
  } catch { invalid(); }
}

// Raw HTTP JSON is not the private wrapper's canonical JSON. Check decoded keys
// with one bounded linear scan; JSON.parse remains the syntax authority.
function responseJson(bytes: Buffer): unknown {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (!Buffer.from(text, 'utf8').equals(bytes)) invalid();
    const stack: Array<Set<string> | null> = [];
    for (let cursor = 0; cursor < text.length;) {
      const token = text[cursor];
      if (token === '"') {
        const start = cursor++;
        let closed = false;
        while (cursor < text.length) {
          if (text[cursor] === '\\') { cursor += 2; continue; }
          if (text[cursor++] === '"') { closed = true; break; }
        }
        if (!closed) invalid();
        let next = cursor;
        while (/[\x20\t\r\n]/u.test(text[next] || 'x')) next++;
        if (text[next] === ':') {
          if (cursor - start > 256) invalid();
          const keys = stack.at(-1);
          const key = JSON.parse(text.slice(start, cursor)) as string;
          if (!keys || keys.has(key)) invalid();
          keys.add(key);
        }
        continue;
      }
      if (token === '{' || token === '[') {
        stack.push(token === '{' ? new Set<string>() : null);
        if (stack.length > 12) invalid();
      } else if (token === '}' || token === ']') {
        if (!stack.length || (token === ']') !== (stack.pop() === null)) invalid();
      }
      cursor++;
    }
    if (stack.length) invalid();
    return JSON.parse(text, (_key: string, value: unknown, context?: { source?: string }) => {
      // This source response has only integer codes, versions and sequences.
      // Reject numeric tokens that JSON would round into an accepted identity.
      if (typeof value === 'number' && (!Number.isSafeInteger(value)
        || typeof context?.source !== 'string' || !/^(?:0|[1-9][0-9]*)$/u.test(context.source))) invalid();
      return value;
    }) as unknown;
  } catch { invalid(); }
}

interface ImportExpected {
  roundId: string;
  adapterRevision: string;
  erpOrigin: string;
}

export function buildAiImageWanxTemplateSourceImport(input: {
  request: unknown;
  expected: ImportExpected;
  now?: Date;
}) {
  const origin = canonicalOrigin(input.expected.erpOrigin);
  const parsed = capturesSchema.safeParse(input.request);
  const now = input.now || new Date();
  if (!parsed.success || !Number.isFinite(now.getTime())) invalid();
  const request = parsed.data;
  if (request.roundId !== input.expected.roundId || request.adapterRevision !== input.expected.adapterRevision
    || new Set(request.captures.map((item) => item.templateKey)).size !== 2) invalid();
  const directoryName = `wanx-sources-${request.roundId}`;
  const files: Array<{ name: string; bytes: Buffer }> = [];
  const sources = request.captures.map((capture) => {
    const url = `${origin}/api/admin/ai-prompt-templates/${capture.templateKey}/source`;
    if (capture.request.url !== url || Date.parse(capture.capturedAt) > now.getTime() + 5 * 60_000) invalid();
    const bytes = Buffer.from(capture.response.bodyBase64, 'base64');
    if (!bytes.length || bytes.length > MAX_RESPONSE_BYTES
      || bytes.toString('base64') !== capture.response.bodyBase64
      || digest(bytes) !== capture.response.bodySha256) invalid();
    const envelope = envelopeSchema.safeParse(responseJson(bytes));
    if (!envelope.success) invalid();
    const source = parseAiPromptPublishedSource(envelope.data.data);
    if (source.templateKey !== capture.templateKey
      || Date.parse(source.activeRelease.createdAt) > Date.parse(capture.capturedAt)) invalid();
    const prefix = capture.templateKey === 'full-image-edit.base' ? 'full-edit' : 'inpaint';
    // Preserve the response and its data's serialization separately; neither
    // a digest nor a collector-supplied timestamp authenticates the capture.
    const sourceBytes = jsonBytes(envelope.data.data);
    files.push({ name: `${prefix}-response.json`, bytes }, { name: `${prefix}-template.json`, bytes: sourceBytes });
    return {
      operation: capture.templateKey === 'full-image-edit.base' ? 'FULL_EDIT' as const : 'INPAINT' as const,
      templateKey: capture.templateKey, capturedAt: capture.capturedAt,
      responseBodySha256: digest(bytes),
      templateSource: { path: `${directoryName}/${prefix}-template.json`, sha256: digest(sourceBytes) },
      templateChecksum: source.revision.checksum,
      requestUrlSha256: digest(url), collectorRefSha256: digest(capture.collectorRef),
    };
  }).sort((left, right) => left.operation.localeCompare(right.operation));
  return { directoryName, files, sources, erpOriginSha256: digest(origin) };
}

export async function importAiImageWanxTemplateSources(input: {
  repositoryRoot: string;
  evidenceRoot: string;
  requestPath: string;
  requestSha256: string;
  expected: ImportExpected;
  assertRevision: () => Promise<void>;
}) {
  const original = await readAiImageSandboxPrivateBillingEvidence({ ...input, path: input.requestPath, sha256: input.requestSha256 });
  const imported = buildAiImageWanxTemplateSourceImport({ request: original.record, expected: input.expected });
  const manifest = {
    schemaVersion: 1, kind: 'WANX_EDIT_TEMPLATE_SOURCE_IMPORT_V1', state: 'IMPORTED_NOT_AUTHENTICATED',
    adapterRevision: input.expected.adapterRevision, roundId: input.expected.roundId,
    capturesSha256: original.sha256, erpOriginSha256: imported.erpOriginSha256, sources: imported.sources,
    sourceVerification: 'OFFLINE_CONSISTENCY_ONLY', sourceAuthentication: 'REQUIRES_CAPTURE_REVIEW',
    canSubmit: false, actualCost: null,
  };
  const manifestBytes = jsonBytes(manifest);
  await input.assertRevision();
  await writeAiImageSandboxPrivateEvidenceBundle({
    repositoryRoot: input.repositoryRoot, evidenceRoot: input.evidenceRoot,
    directoryName: imported.directoryName,
    files: [...imported.files, { name: 'captures.json', bytes: original.bytes }, { name: 'manifest.json', bytes: manifestBytes }],
  });
  await input.assertRevision();
  return {
    ...manifest, manifestSha256: digest(manifestBytes), captureCount: imported.sources.length,
  };
}
