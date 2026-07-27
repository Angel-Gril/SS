import { describe, expect, it } from 'vitest';
import {
  EXTENSION_AI_IMAGE_EXECUTION_MODE_CONSTRAINT,
  isExtensionAiImageExecutionModeConflict,
} from '../services/extension-ai-image-execution-mode.js';

describe('extension AI image execution mode errors', () => {
  it.each([
    { constraint: EXTENSION_AI_IMAGE_EXECUTION_MODE_CONSTRAINT },
    { meta: { constraint: EXTENSION_AI_IMAGE_EXECUTION_MODE_CONSTRAINT } },
    { meta: { code: '23514', message: `violates ${EXTENSION_AI_IMAGE_EXECUTION_MODE_CONSTRAINT}` } },
    { cause: { message: EXTENSION_AI_IMAGE_EXECUTION_MODE_CONSTRAINT } },
  ])('recognizes the database mode fence without depending on one driver shape', (error) => {
    expect(isExtensionAiImageExecutionModeConflict(error)).toBe(true);
  });

  it.each([
    null,
    new Error('unrelated database failure'),
    { code: '23514', meta: { constraint: 'other_constraint' } },
  ])('does not misclassify unrelated failures', (error) => {
    expect(isExtensionAiImageExecutionModeConflict(error)).toBe(false);
  });
});
