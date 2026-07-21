export const AI_IMAGE_ACTIVE_QUOTA_JOB_STATUSES = [
  'PENDING',
  'QUEUED',
  'RUNNING',
  'RETRYING',
] as const;

export const AI_IMAGE_BILLED_JOB_STATUSES = [
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
] as const;

export const AI_IMAGE_UNRESOLVED_PROVIDER_RECONCILIATION_STATUSES = [
  'PENDING',
  'RUNNING',
  'RETRY_WAIT',
  'MANUAL_REVIEW',
] as const;

export const AI_IMAGE_UNRESOLVED_COST_STATUSES = [
  'SUBMISSION_UNCERTAIN',
  'RECONCILIATION_REQUIRED',
] as const;

export function aiImageReservedQuotaWhere() {
  return {
    OR: [
      { status: { in: [...AI_IMAGE_ACTIVE_QUOTA_JOB_STATUSES] } },
      {
        status: { in: ['FAILED', 'CANCELLED'] },
        billedUnits: 0,
        OR: [
          {
            providerReconciliationStatus: {
              in: [...AI_IMAGE_UNRESOLVED_PROVIDER_RECONCILIATION_STATUSES],
            },
          },
          {
            costReservation: {
              is: { status: { in: [...AI_IMAGE_UNRESOLVED_COST_STATUSES] } },
            },
          },
        ],
      },
    ],
  };
}
