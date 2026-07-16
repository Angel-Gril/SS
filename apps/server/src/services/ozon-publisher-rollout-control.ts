import { createHash } from 'node:crypto';

import type {
  OzonPublisherOriginChannel,
  OzonPublisherWriterEntrypoint,
} from './ozon-publisher-entrypoint-rollout.js';
import {
  OZON_PUBLISHER_ROLLOUT_EVIDENCE_CONTRACTS,
  OZON_PUBLISHER_ROLLOUT_READINESS_CRITERIA,
} from './ozon-publisher-rollout-readiness.js';
import type { OzonPublisherRolloutControlSnapshot } from './ozon-publisher-rollout-readiness-service.js';

export const OZON_PUBLISHER_ROLLOUT_CONTROL_CONFIG_KEYS = [
  'feature_source_listing_workflow',
  'feature_source_ozon_publisher_v2',
  'source_workflow_rollout_policy',
] as const;
const CONTROL_CONFIG_KEY_SET = new Set<string>(OZON_PUBLISHER_ROLLOUT_CONTROL_CONFIG_KEYS);

export const OZON_PUBLISHER_ROLLOUT_EVIDENCE_POLICY = Object.freeze({
  contractVersion: 'ozon-publisher-rollout-evidence-policy/v1',
  readiness: OZON_PUBLISHER_ROLLOUT_READINESS_CRITERIA,
  contracts: OZON_PUBLISHER_ROLLOUT_EVIDENCE_CONTRACTS,
});

type ExactInput = {
  writerEntrypoint: OzonPublisherWriterEntrypoint;
  originChannel: OzonPublisherOriginChannel;
  rolloutRevision: string;
};

interface ConfigReader {
  systemConfig: {
    findMany(input: {
      where: { key: { in: string[] } };
      select: { key: true; value: true };
    }): Promise<readonly { key: string; value: string }[]>;
  };
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const row = value as Record<string, unknown>;
  return `{${Object.keys(row).sort().map((key) => (
    `${JSON.stringify(key)}:${stableStringify(row[key])}`
  )).join(',')}}`;
}

function hash(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function exactIdentifier(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`${field} is invalid`);
  const normalized = value.normalize('NFKC').trim();
  if (!normalized || normalized !== value || value.length > 200) {
    throw new Error(`${field} is invalid`);
  }
  return value;
}

export function ozonPublisherRolloutEvidencePolicyHash(): string {
  return hash(OZON_PUBLISHER_ROLLOUT_EVIDENCE_POLICY);
}

export async function loadPrismaOzonPublisherRolloutControlSnapshot(
  client: ConfigReader,
  input: ExactInput,
): Promise<OzonPublisherRolloutControlSnapshot> {
  const rolloutRevision = exactIdentifier(input.rolloutRevision, 'rolloutRevision');
  const rows = await client.systemConfig.findMany({
    where: { key: { in: [...OZON_PUBLISHER_ROLLOUT_CONTROL_CONFIG_KEYS] } },
    select: { key: true, value: true },
  });
  const values = new Map<string, string>();
  for (const row of rows) {
    if (!CONTROL_CONFIG_KEY_SET.has(row.key)
      || values.has(row.key)
      || typeof row.value !== 'string') {
      throw new Error('Ozon publisher rollout control snapshot is invalid');
    }
    values.set(row.key, row.value);
  }
  const config = OZON_PUBLISHER_ROLLOUT_CONTROL_CONFIG_KEYS.map((key) => ({
    key,
    value: values.get(key) ?? null,
  }));
  return {
    evidencePolicyHash: ozonPublisherRolloutEvidencePolicyHash(),
    controlConfigHash: hash({
      contractVersion: 'ozon-publisher-rollout-control-config/v1',
      writerEntrypoint: input.writerEntrypoint,
      originChannel: input.originChannel,
      rolloutRevision,
      config,
    }),
  };
}
