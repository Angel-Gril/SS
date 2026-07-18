export const AI_MEDIA_PLANNING_IDENTIFIER_MAX_LENGTH = 500;
export const AI_MEDIA_PLANNING_SLOT_KEY_MAX_LENGTH = 1024;
export const AI_MEDIA_PLANNING_MODEL_OUTPUT_MAX_BYTES = 256 * 1024;

export function isAiMediaPlanningJsonWithinBudget(value: unknown): boolean {
  try {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    return typeof serialized === 'string'
      && Buffer.byteLength(serialized, 'utf8') <= AI_MEDIA_PLANNING_MODEL_OUTPUT_MAX_BYTES;
  } catch {
    return false;
  }
}
