import sharp from 'sharp';
import { AiImageJobError } from './ai-image-job-error.js';
import type { AiImageProviderResult } from './ai-image-jobs.js';
import {
  downloadImage,
  isDefiniteProviderRejection,
  normalizedProviderIdentity,
  requestJson,
  validateOpenAiImageEditRequest,
  withProviderAcceptance,
  withProviderSubmissionRejected,
  withProviderSubmissionUncertain,
  type FetchLike,
  type OpenAiImageEditProvider,
  type OpenAiImageEditProviderOptions,
  type OpenAiImageEditRequest,
} from './ai-image-providers.js';
import {
  AI_IMAGE_WANX21_EDIT_MODEL,
  AI_IMAGE_WANX21_EDIT_PROFILE,
  aiImageWanx21EditFunction,
  aiImageWanx21EditSubmitEndpoint,
  aiImageWanx21EditTaskEndpointBase,
  normalizeAiImageWanx21EditResultUrl,
  normalizeAiImageWanx21EditApiBase,
} from './ai-image-wanx-edit-profile.js';

export interface DashScopeWanx21ImageEditProviderOptions
  extends OpenAiImageEditProviderOptions {
  pollIntervalMs?: number;
}

const PENDING_STATUSES = new Set(['PENDING', 'RUNNING']);
const FAILED_STATUSES = new Set(['FAILED', 'CANCELED', 'CANCELLED', 'UNKNOWN']);

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function invalidWanxInput(message: string) {
  return new AiImageJobError('INVALID_MEDIA_INPUT', message);
}

function dataUrl(mimeType: string, bytes: Buffer) {
  return `data:${mimeType};base64,${bytes.toString('base64')}`;
}

async function wanxInputDimensions(bytes: Buffer, label: string) {
  let metadata: Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>;
  try {
    metadata = await sharp(bytes, {
      limitInputPixels: 4096 * 4096,
    }).metadata();
  } catch {
    throw invalidWanxInput(`${label} is not a decodable image`);
  }
  if (
    !metadata.width
    || !metadata.height
    || metadata.width < 512
    || metadata.height < 512
    || metadata.width > 4096
    || metadata.height > 4096
  ) {
    throw invalidWanxInput(`${label} dimensions must be between 512 and 4096 pixels`);
  }
  return { width: metadata.width, height: metadata.height };
}

export async function convertOpenAiAlphaMaskToWanxMask(mask: Buffer) {
  let decoded: { data: Buffer; info: { width: number; height: number; channels: number } };
  try {
    decoded = await sharp(mask, { limitInputPixels: 4096 * 4096 })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw invalidWanxInput('Wanx inpaint mask must be a decodable PNG image');
  }
  const { width, height, channels } = decoded.info;
  if (width < 512 || height < 512 || width > 4096 || height > 4096 || channels !== 4) {
    throw invalidWanxInput('Wanx inpaint mask dimensions must be between 512 and 4096 pixels');
  }
  const output = Buffer.alloc(width * height * 3);
  let hasEditRegion = false;
  let hasPreserveRegion = false;
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const alpha = decoded.data[pixel * channels + 3]!;
    const value = alpha < 128 ? 255 : 0;
    hasEditRegion ||= value === 255;
    hasPreserveRegion ||= value === 0;
    output[pixel * 3] = value;
    output[pixel * 3 + 1] = value;
    output[pixel * 3 + 2] = value;
  }
  if (!hasEditRegion || !hasPreserveRegion) {
    throw invalidWanxInput('Wanx inpaint mask must contain both edit and preserve regions');
  }
  return sharp(output, { raw: { width, height, channels: 3 } })
    .png({ compressionLevel: 9, palette: false })
    .toBuffer();
}

async function validateWanxRequest(request: OpenAiImageEditRequest, configuredModel: string) {
  await validateOpenAiImageEditRequest(request);
  const model = request.model || configuredModel;
  if (model !== AI_IMAGE_WANX21_EDIT_MODEL || configuredModel !== AI_IMAGE_WANX21_EDIT_MODEL) {
    throw new AiImageJobError(
      'UNSUPPORTED_PROVIDER_MODEL',
      'DashScope Wanx image editing requires wanx2.1-imageedit',
    );
  }
  if (request.images.length !== 1) {
    throw invalidWanxInput('Wanx image editing requires exactly one source image');
  }
  if (
    request.width !== AI_IMAGE_WANX21_EDIT_PROFILE.width
    || request.height !== AI_IMAGE_WANX21_EDIT_PROFILE.height
  ) {
    throw invalidWanxInput('Wanx QA image editing requires the 1024x1024 profile');
  }
  if (
    !request.prompt.trim()
    || Array.from(request.prompt).length > AI_IMAGE_WANX21_EDIT_PROFILE.maximumPromptCharacters
    || request.negativePrompt
  ) {
    throw invalidWanxInput('Wanx image-edit prompt does not match the reviewed request contract');
  }
  const source = request.images[0]!;
  if (source.buffer.byteLength > AI_IMAGE_WANX21_EDIT_PROFILE.maximumInputBytes) {
    throw invalidWanxInput('Wanx source image exceeds 10 MiB');
  }
  const sourceDimensions = await wanxInputDimensions(source.buffer, 'Wanx source image');
  let maskBytes: Buffer | null = null;
  if (request.operation === 'INPAINT') {
    if (!request.mask || request.mask.buffer.byteLength > AI_IMAGE_WANX21_EDIT_PROFILE.maximumInputBytes) {
      throw invalidWanxInput('Wanx inpaint requires one PNG mask no larger than 10 MiB');
    }
    const maskDimensions = await wanxInputDimensions(request.mask.buffer, 'Wanx inpaint mask');
    if (
      sourceDimensions.width !== maskDimensions.width
      || sourceDimensions.height !== maskDimensions.height
    ) {
      throw invalidWanxInput('Wanx source and mask dimensions must match');
    }
    maskBytes = await convertOpenAiAlphaMaskToWanxMask(request.mask.buffer);
  }
  return { model, source, maskBytes };
}

function assertSuccessfulWanxTask(body: any, taskId: string) {
  const responseTaskId = normalizedProviderIdentity(body?.output?.task_id);
  if (responseTaskId !== taskId) {
    throw new AiImageJobError('INVALID_PROVIDER_RESULT', 'Wanx returned a mismatched task identity');
  }
  const results = Array.isArray(body?.output?.results) ? body.output.results : [];
  const metrics = body?.output?.task_metrics;
  const imageCount = body?.usage?.image_count;
  if (
    results.length !== 1
    || typeof results[0]?.url !== 'string'
    || !results[0].url.trim()
    || !metrics
    || metrics.TOTAL !== 1
    || metrics.SUCCEEDED !== 1
    || metrics.FAILED !== 0
    || imageCount !== 1
  ) {
    throw new AiImageJobError(
      'INVALID_PROVIDER_RESULT',
      'Wanx task success did not prove one successful metered image',
    );
  }
  return results[0].url.trim() as string;
}

function normalizedCost(costPerImageCents: number | undefined) {
  return Math.max(0, Math.round(Number(costPerImageCents || 0)));
}

export function createDashScopeWanx21ImageEditProvider(
  options: DashScopeWanx21ImageEditProviderOptions,
): OpenAiImageEditProvider {
  if (!String(options.apiKey || '').trim()) {
    throw new AiImageJobError('INVALID_PROVIDER_CONFIG', 'DashScope API key is required');
  }
  const apiBase = normalizeAiImageWanx21EditApiBase(options.baseUrl);
  if (options.model !== AI_IMAGE_WANX21_EDIT_MODEL) {
    throw new AiImageJobError(
      'UNSUPPORTED_PROVIDER_MODEL',
      'DashScope Wanx image editing requires wanx2.1-imageedit',
    );
  }
  const fetcher: FetchLike = options.fetch || globalThis.fetch;
  const timeoutMs = Math.max(1, options.timeoutMs || 180_000);
  const pollIntervalMs = Math.max(0, options.pollIntervalMs ?? 1_500);
  const submitEndpoint = aiImageWanx21EditSubmitEndpoint(apiBase);
  const taskEndpointBase = aiImageWanx21EditTaskEndpointBase(apiBase);

  return {
    name: 'dashscope-wanx21-image-edit',
    async edit(request): Promise<AiImageProviderResult> {
      const validated = await validateWanxRequest(request, options.model);
      const deadline = Date.now() + timeoutMs;
      await options.beforeProviderDispatch?.();
      let submitted: any;
      try {
        submitted = await requestJson(
          'DashScope Wanx image edit',
          fetcher,
          options.apiKey,
          submitEndpoint,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${options.apiKey}`,
              'Content-Type': 'application/json',
              'X-DashScope-Async': 'enable',
            },
            body: JSON.stringify({
              model: validated.model,
              input: {
                function: aiImageWanx21EditFunction(request.operation),
                prompt: request.prompt,
                base_image_url: dataUrl(validated.source.mimeType, validated.source.buffer),
                ...(validated.maskBytes
                  ? { mask_image_url: dataUrl('image/png', validated.maskBytes) }
                  : {}),
              },
              parameters: { n: 1 },
            }),
          },
          Math.max(1, deadline - Date.now()),
        );
      } catch (error) {
        if (isDefiniteProviderRejection(error)) throw withProviderSubmissionRejected(error);
        throw withProviderSubmissionUncertain(error);
      }

      let taskId: string | null;
      try {
        taskId = normalizedProviderIdentity(submitted?.output?.task_id);
      } catch (error) {
        throw withProviderSubmissionUncertain(error);
      }
      if (!taskId) {
        throw withProviderSubmissionUncertain(
          new AiImageJobError('INVALID_PROVIDER_RESULT', 'Wanx did not return a task identity'),
        );
      }
      const providerAcceptedAt = new Date();
      try {
        await options.onProviderJobCreated?.(taskId, providerAcceptedAt);
      } catch {
        throw withProviderAcceptance(
          new AiImageJobError(
            'PROVIDER_ACCEPTED_PERSISTENCE_FAILED',
            'Wanx accepted the task but its recovery identity could not be persisted',
          ),
          taskId,
          providerAcceptedAt,
        );
      }

      try {
        const submittedStatus = String(submitted?.output?.task_status || '').trim().toUpperCase();
        if (!PENDING_STATUSES.has(submittedStatus)) {
          throw new AiImageJobError(
            'INVALID_PROVIDER_RESULT',
            'Wanx submit did not return a reviewed pending task status',
          );
        }
        let completed = submitted;
        let polls = 0;
        while (String(completed?.output?.task_status || '').trim().toUpperCase() !== 'SUCCEEDED') {
          const status = String(completed?.output?.task_status || '').trim().toUpperCase();
          if (FAILED_STATUSES.has(status)) {
            throw new AiImageJobError('PROVIDER_TASK_FAILED', `Wanx task failed (${status})`);
          }
          if (status && !PENDING_STATUSES.has(status)) {
            throw new AiImageJobError('INVALID_PROVIDER_RESULT', 'Wanx returned an unknown task status');
          }
          if (
            polls >= AI_IMAGE_WANX21_EDIT_PROFILE.maximumPollRequests
            || Date.now() >= deadline
          ) {
            throw new AiImageJobError('PROVIDER_TIMEOUT', 'Wanx image-edit task timed out');
          }
          await delay(pollIntervalMs);
          if (Date.now() >= deadline) {
            throw new AiImageJobError('PROVIDER_TIMEOUT', 'Wanx image-edit task timed out');
          }
          polls += 1;
          completed = await requestJson(
            'DashScope Wanx image edit',
            fetcher,
            options.apiKey,
            `${taskEndpointBase}/${encodeURIComponent(taskId)}`,
            {
              method: 'GET',
              headers: { Authorization: `Bearer ${options.apiKey}` },
            },
            Math.max(1, deadline - Date.now()),
          );
        }

        const resultUrl = assertSuccessfulWanxTask(completed, taskId);
        const image = await downloadImage(
          fetcher,
          normalizeAiImageWanx21EditResultUrl(resultUrl),
          Math.max(1, deadline - Date.now()),
        );
        return {
          images: [{ ...image, filename: `wanx-edit-${taskId}.png` }],
          providerJobId: taskId,
          actualCostCents: normalizedCost(options.costPerImageCents),
        };
      } catch (error) {
        throw withProviderAcceptance(error, taskId, providerAcceptedAt);
      }
    },
  };
}
