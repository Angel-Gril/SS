export interface LatestLoadRequest {
  targetId: string;
  generation: number;
  quiet: boolean;
  interactive: boolean;
}

export function createLatestLoadCoordinator(options: {
  execute: (request: LatestLoadRequest, isCurrent: () => boolean) => Promise<void>;
  onLoadingChange: (loading: boolean) => void;
}) {
  let latestTargetId = '';
  let generation = 0;
  let active: Promise<void> | null = null;
  let activeRequest: LatestLoadRequest | null = null;
  let queued: LatestLoadRequest | null = null;
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
      if (active) return active;

      const drain = (async () => {
        while (queued) {
          const request = queued;
          queued = null;
          activeRequest = request;
          try {
            await options.execute(
              request,
              () => request.generation === generation && request.targetId === latestTargetId,
            );
          } finally {
            if (activeRequest === request) activeRequest = null;
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
      showsLoading = false;
    },
  };
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
}

export type RefreshAiMediaTarget = () => Promise<RefreshedAiMediaTarget | null>;
export type SynchronizeAiMediaTarget = (expectedTargetUpdatedAt?: string) => Promise<boolean>;

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
