import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { chatRoutes } from '../routes/chat.js';
const mocks = vi.hoisted(() => ({ history: vi.fn(), list: vi.fn() }));
vi.mock('../lib/auth.js', () => ({ authenticate: async (request: any) => { request.user = { userId: 'owner' }; } }));
vi.mock('../lib/crypto.js', () => ({ decrypt: () => 'fixture-key' }));
vi.mock('../lib/prisma.js', () => ({ prisma: { shop: { findFirst: async () => ({ clientId: 'fixture', apiKeyEncrypted: 'fixture' }) } } }));
vi.mock('../services/ozon-client.js', () => ({ OzonClient: class { getChatHistory = mocks.history; getChatList = mocks.list; } }));
describe('Ozon V3 chat consumers', () => {
  it('joins official Markdown string parts and maps system users for the existing page', async () => {
    mocks.history.mockResolvedValue({ has_next: true, messages: [
      { message_id: 2, data: ['first', 'second'], user: { type: 'Seller' }, is_read: false },
      { message_id: 1, data: ['notice'], user: { type: 'Crm' }, is_read: true },
    ] });
    const app = Fastify(); await app.register(chatRoutes); await app.ready();
    try {
      const response = await app.inject('/history/chat-1?shopId=shop-1');
      expect(response.json()).toMatchObject({ code: 1, data: { has_next: true, messages: [
        { sender: 'Seller', data: { text: 'first\nsecond' } }, { sender: 'System', data: { text: 'notice' } },
      ] } });
    } finally { await app.close(); }
  });
});
