import type { ApiResponse } from '@/lib/api';

export interface LatestLoadRequest {
  targetId: string;
  generation: number;
  quiet: boolean;
  interactive: boolean;
  signal: AbortSignal;
}

export function createLatestLoadCoordinator(options: {
  execute: (request: LatestLoadRequest, isCurrent: () => boolean) => Promise<void>;
  onLoadingChange: (loading: boolean) => void;
}) {
  let latestTargetId = '';
  let generation = 0;
  let active: Promise<void> | null = null;
  let activeRequest: LatestLoadRequest | null = null;
  let activeController: AbortController | null = null;
  let queued: Omit<LatestLoadRequest, 'signal'> | null = null;
  let showsLoading = false;

  return {
    setTarget(targetId: string) {
      latestTargetId = targetId;
    },
    async load(quiet = false, interactive = false) {
      if (!quiet) {
        if (!showsLoading) options.onLoadingChange(true);
        showsLoading = true;
      }
      const previousQueued = queued;
      const sameQueuedTarget = previousQueued?.targetId === latestTargetId;
      const sameActiveTarget = activeRequest?.targetId === latestTargetId;
      queued = {
        targetId: latestTargetId,
        generation: ++generation,
        quiet: sameQueuedTarget ? previousQueued.quiet && quiet : quiet,
        interactive: interactive
          || Boolean(sameQueuedTarget && previousQueued.interactive)
          || Boolean(sameActiveTarget && activeRequest?.interactive),
      };
      if (active) {
        if (activeRequest && activeRequest.targetId !== latestTargetId) activeController?.abort();
        return active;
      }

      const drain = (async () => {
        while (queued) {
          const controller = new AbortController();
          const request: LatestLoadRequest = { ...queued, signal: controller.signal };
          queued = null;
          activeRequest = request;
          activeController = controller;
          try {
            await options.execute(
              request,
              () => !request.signal.aborted && request.generation === generation && request.targetId === latestTargetId,
            );
          } catch (error) {
            if (!request.signal.aborted) throw error;
          } finally {
            if (activeRequest === request) activeRequest = null;
            if (activeController === controller) activeController = null;
          }
        }
      })();
      active = drain;
      try {
        await drain;
      } finally {
        if (active === drain) {
          active = null;
          if (showsLoading) {
            showsLoading = false;
            options.onLoadingChange(false);
          }
        }
      }
    },
    invalidate() {
      generation += 1;
      queued = null;
      activeRequest = null;
      activeController?.abort();
      showsLoading = false;
    },
  };
}

export async function readAiMediaPanelResults<TContext, THistory, TCapabilities>(
  requests: readonly [Promise<ApiResponse<TContext>>, Promise<ApiResponse<THistory>>, Promise<ApiResponse<TCapabilities>>],
): Promise<[ApiResponse<TContext>, ApiResponse<THistory>, ApiResponse<TCapabilities>]> {
  const results = await Promise.allSettled(requests);
  const response = <T>(result: PromiseSettledResult<ApiResponse<T>>): ApiResponse<T> => (
    result.status === 'fulfilled'
      ? result.value
      : { code: 0, msg: result.reason instanceof Error ? result.reason.message : '读取失败，请重试' }
  );
  return [response(results[0]), response(results[1]), response(results[2])];
}

export interface MediaMutationLock {
  tryAcquire(): boolean;
  release(): void;
  isLocked(): boolean;
}

export function createMediaMutationLock(): MediaMutationLock {
  let locked = false;
  return {
    tryAcquire() {
      if (locked) return false;
      locked = true;
      return true;
    },
    release() {
      locked = false;
    },
    isLocked() {
      return locked;
    },
  };
}

export interface MediaMutationExecution<T> {
  started: boolean;
  value?: T;
}

export async function executeLockedMediaMutation<T>(
  lock: MediaMutationLock,
  onBusyChange: (busy: boolean) => void,
  action: () => Promise<T>,
): Promise<MediaMutationExecution<T>> {
  if (!lock.tryAcquire()) return { started: false };
  onBusyChange(true);
  try {
    return { started: true, value: await action() };
  } finally {
    lock.release();
    onBusyChange(false);
  }
}

export type RunMediaMutation = <T>(action: () => Promise<T>) => Promise<MediaMutationExecution<T>>;

export interface RefreshedAiMediaTarget {
  id: string;
  updatedAt?: string;
  revision?: number;
  draftVersion?: number;
}

export type RefreshAiMediaTarget = () => Promise<RefreshedAiMediaTarget | null>;
export type SynchronizeAiMediaTarget = (expectedTargetUpdatedAt?: string) => Promise<boolean>;

export const AI_MEDIA_INTERACTIVE_DRAFT_DISCARD_MESSAGE = '当前 AI 图片编辑尚未保存，继续将放弃这些修改。';

export function confirmAiMediaInteractiveDraftDiscard<T extends boolean | Promise<boolean>>(
  dirty: boolean,
  requestConfirmation: (message: string) => T,
): true | T {
  return !dirty || requestConfirmation(AI_MEDIA_INTERACTIVE_DRAFT_DISCARD_MESSAGE);
}

export async function executeWithBusyState<T>(
  onBusyChange: (busy: boolean) => void,
  action: () => Promise<T>,
): Promise<T> {
  onBusyChange(true);
  try {
    return await action();
  } finally {
    onBusyChange(false);
  }
}

export function createLatestRequestGuard() {
  let generation = 0;
  return {
    begin() {
      const requestGeneration = ++generation;
      return () => requestGeneration === generation;
    },
  };
}

export interface SaveSourceImagesRequest {
  id: string;
  images: string[];
  sourceDetailImages: string[];
  expectedUpdatedAt: string;
}

export interface SaveSourceImagesResult {
  updatedAt: string;
  images: string[];
  metadata: Record<string, unknown>;
}

export interface AiImageApplyResult {
  jobId: string;
  mode: 'append' | 'replace';
  targetType: 'collect' | 'product';
  targetId: string;
  targetUpdatedAt: string;
  images: string[];
  editedImages: string[];
}

export function buildSaveSourceImagesRequest(input: {
  id: string;
  images: string[];
  sourceDetailImages: string[];
  expectedUpdatedAt?: string;
}): SaveSourceImagesRequest {
  if (!input.images.length) throw new Error('至少保留一张发布图片');
  if (!input.expectedUpdatedAt) throw new Error('商品版本缺失，请刷新后重试');
  return {
    id: input.id,
    images: input.images,
    sourceDetailImages: input.sourceDetailImages,
    expectedUpdatedAt: input.expectedUpdatedAt,
  };
}

export function isMediaMutationConflict(response: { code: unknown; msg?: string }) {
  const code = String(response.code || '').toUpperCase();
  const message = String(response.msg || '').toLowerCase();
  return code.includes('CONFLICT') || code.includes('STALE')
    || message.includes('conflict') || message.includes('stale')
    || message.includes('已更新') || message.includes('版本');
}
