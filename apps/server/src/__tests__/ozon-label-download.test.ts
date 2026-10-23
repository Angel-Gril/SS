import { describe, expect, it } from 'vitest';
import { OzonClient } from '../services/ozon-client.js';
describe('Ozon label download boundary', () => {
  it.each(['https://user:secret@cdn.ozon.ru/label.pdf', 'https://cdn.ozon.ru:444/label.pdf'])('refuses invalid file URL before network: %s', async url => {
    const client = new OzonClient({ clientId: 'fixture', apiKey: 'fixture' });
    await expect(client.fetchUrl(url)).rejects.toThrow(/URL|port|unauthenticated/i);
  });
});
