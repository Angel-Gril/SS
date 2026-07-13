import type { LogisticsScopeBootstrapRepository } from './logistics-scope-bootstrap.js';
import { createOriginActivationPersistence } from './logistics-scope-bootstrap-prisma-activate.js';
import { createScopeBootstrapPersistence } from './logistics-scope-bootstrap-prisma-bootstrap.js';
import type { LogisticsScopeSqlClient } from './logistics-scope-bootstrap-prisma-common.js';
import { createDeviceProbePersistence } from './logistics-scope-bootstrap-prisma-device.js';
import { createCompanyProbeReviewPersistence } from './logistics-scope-bootstrap-prisma-review.js';
import { createScopeWorkspaceOperations } from './logistics-scope-bootstrap-prisma-workspace.js';

export function createPrismaLogisticsScopeBootstrapRepository(options: {
  client: LogisticsScopeSqlClient;
}) {
  return {
    ...createScopeWorkspaceOperations(options.client),
    ...createScopeBootstrapPersistence(options.client),
    ...createDeviceProbePersistence(options.client),
    ...createCompanyProbeReviewPersistence(options.client),
    ...createOriginActivationPersistence(options.client),
  } as LogisticsScopeBootstrapRepository & {
    getCompanyProbe(input: { probeId: string }): Promise<unknown>;
  };
}
