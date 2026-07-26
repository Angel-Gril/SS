import type {
  OzonPublishAttemptRecord,
  OzonPublishAttemptRepository,
} from './ozon-publish-attempts.js';
import type { OzonListingPublisher } from './ozon-listing-publisher.js';

export interface ExtensionOzonPublishExecutionInput {
  draftId: string;
  ownerUserId: string;
  actorUserId: string;
  expectedRevision: number;
  idempotencyKey: string;
  publishIntentId: string;
  requestingDeviceSessionId: string;
}

export type ExtensionOzonPublishExecutionResult = Pick<
  OzonPublishAttemptRecord,
  'state' | 'lastErrorCode'
>;

export function createExtensionOzonPublishExecutor(options: {
  publisher: Pick<OzonListingPublisher, 'publish'>;
  attempts: Pick<OzonPublishAttemptRepository, 'getByPublishIntent'>;
}) {
  return async (
    input: ExtensionOzonPublishExecutionInput,
  ): Promise<ExtensionOzonPublishExecutionResult> => {
    try {
      return await options.publisher.publish({
        draftId: input.draftId,
        ownerUserId: input.ownerUserId,
        actorUserId: input.actorUserId,
        expectedRevision: input.expectedRevision,
        idempotencyKey: input.idempotencyKey,
        requestingDeviceSessionId: input.requestingDeviceSessionId,
      });
    } catch (error) {
      try {
        const persisted = await options.attempts.getByPublishIntent({
          publishIntentId: input.publishIntentId,
          ownerUserId: input.ownerUserId,
        });
        if (persisted) return persisted;
      } catch {
        return {
          state: 'UNKNOWN',
          lastErrorCode: 'OZON_PUBLISH_STATE_UNAVAILABLE',
        };
      }
      throw error;
    }
  };
}

export type ExtensionOzonPublishExecutor = ReturnType<
  typeof createExtensionOzonPublishExecutor
>;
