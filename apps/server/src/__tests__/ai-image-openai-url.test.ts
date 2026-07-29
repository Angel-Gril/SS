import { describe, expect, it } from 'vitest';
import { AiImageJobError } from '../services/ai-image-jobs.js';
import {
  isOfficialOpenAiImagesApiBase,
  normalizeOpenAiImagesApiBase,
} from '../services/ai-image-openai-url.js';

describe('OpenAI-compatible image API URL normalization', () => {
  it.each([
    ['https://relay.example', 'https://relay.example/v1'],
    ['https://relay.example/', 'https://relay.example/v1'],
    ['https://relay.example/v1', 'https://relay.example/v1'],
    ['https://relay.example/tenant', 'https://relay.example/tenant/v1'],
    ['https://relay.example/tenant/v1/', 'https://relay.example/tenant/v1'],
    ['https://relay.example:8443/tenant', 'https://relay.example:8443/tenant/v1'],
  ])('normalizes %s without network I/O', (input, expected) => {
    expect(normalizeOpenAiImagesApiBase(input)).toBe(expected);
  });

  it('classifies only the canonical official OpenAI Images API base as official', () => {
    expect(isOfficialOpenAiImagesApiBase('')).toBe(true);
    expect(isOfficialOpenAiImagesApiBase('https://api.openai.com')).toBe(true);
    expect(isOfficialOpenAiImagesApiBase('https://api.openai.com/v1/')).toBe(true);
    expect(isOfficialOpenAiImagesApiBase('https://relay.example/v1')).toBe(false);
    expect(isOfficialOpenAiImagesApiBase('http://api.openai.com/v1')).toBe(false);
  });

  it.each([
    'https://user:secret@relay.example',
    'https://@relay.example/v1',
    'https://relay.example/v1?tenant=one',
    'https://relay.example/v1?',
    'https://relay.example/v1#images',
    'https://relay.example/v1#',
    'https://relay.example/v1/images/generations',
    'https://relay.example/v1/images/edits',
    'https://relay.example/v1/images/tasks/task-1',
    'https://relay.example/v1/%69mages/generations',
    'https://relay.example/v1/images%2fgenerations',
    'https://relay.example/v1/%2e%2e/images/edits',
    'https://relay.example/v1\\images\\edits',
    'https://relay.example/openai//v1',
    'https://relay.example/openai/./v1',
    'https://relay.example/openai/../v1',
    'https://relay.example/%76%31',
    'https://relay.example./v1',
    'https://relay/v1',
    'https://relay..example/v1',
    'https://-relay.example/v1',
    'https://127.0.0.1/v1',
    'https://127.1/v1',
    'https://2130706433/v1',
    'https://0x7f000001/v1',
    'https://203.0.113.10/v1',
    'https://[2606:4700:4700::1111]/v1',
    'http://relay.example/v1',
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
