import { describe, expect, it } from 'vitest';
import { AiImageJobError } from '../services/ai-image-jobs.js';
import { normalizeOpenAiImagesApiBase } from '../services/ai-image-openai-url.js';

describe('OpenAI-compatible image API URL normalization', () => {
  it.each([
    ['https://relay.example', 'https://relay.example/v1'],
    ['https://relay.example/', 'https://relay.example/v1'],
    ['https://relay.example/v1', 'https://relay.example/v1'],
    ['https://relay.example/tenant', 'https://relay.example/tenant/v1'],
  ])('normalizes %s without network I/O', (input, expected) => {
    expect(normalizeOpenAiImagesApiBase(input)).toBe(expected);
  });

  it.each([
    'https://user:secret@relay.example',
    'https://relay.example/v1?tenant=one',
    'https://relay.example/v1#images',
    'https://relay.example/v1/images/generations',
    'https://relay.example/v1/images/edits',
    'not a URL',
  ])('rejects a non-base or secret-bearing URL: %s', (input) => {
    try {
      normalizeOpenAiImagesApiBase(input);
      throw new Error('expected URL normalization to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(AiImageJobError);
      expect(error).toMatchObject({ code: 'INVALID_PROVIDER_URL' });
    }
  });
});
