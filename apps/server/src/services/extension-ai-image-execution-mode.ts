export const EXTENSION_AI_IMAGE_EXECUTION_MODE_CONSTRAINT =
  'extension_ai_image_execution_mode_exclusive' as const;

function containsConstraint(value: unknown, depth = 0): boolean {
  if (depth > 4 || value == null) return false;
  if (typeof value === 'string') {
    return value.includes(EXTENSION_AI_IMAGE_EXECUTION_MODE_CONSTRAINT);
  }
  if (typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return ['constraint', 'code', 'message', 'meta', 'cause'].some((key) => (
    containsConstraint(candidate[key], depth + 1)
  ));
}

export function isExtensionAiImageExecutionModeConflict(error: unknown): boolean {
  return containsConstraint(error);
}
