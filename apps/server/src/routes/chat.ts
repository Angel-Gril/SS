import type { FastifyInstance } from 'fastify';
import { authenticate } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';
import { decrypt } from '../lib/crypto.js';
import { OzonClient } from '../services/ozon-client.js';
import { projectOzonChatMessage } from '../services/ozon-chat.js';

export async function chatRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.get('/list', async (request, reply) => {
    const { userId } = (request as any).user;
    const { shopId, cursor, limit } = request.query as { shopId: string; cursor?: string; limit?: string };
    if (!shopId) return reply.status(400).send({ code: 0, msg: '缺少 shopId' });

    const shop = await prisma.shop.findFirst({ where: { id: shopId, userId } });
    if (!shop || !shop.clientId || !shop.apiKeyEncrypted) {
      return reply.status(400).send({ code: 0, msg: '店铺配置不完整' });
    }

    const client = new OzonClient({ clientId: shop.clientId, apiKey: decrypt(shop.apiKeyEncrypted) });
    const result: any = await client.getChatList({ limit: Number(limit) || 30, cursor });
    const chats = (Array.isArray(result.chats) ? result.chats : []).map((row: any) => ({
      ...(row.chat || row),
      chat_id: row.chat_id || row.chat?.chat_id,
      chat_type: row.chat_type || row.chat?.chat_type,
      first_unread_message_id: row.first_unread_message_id ?? row.chat?.first_unread_message_id,
      last_message_id: row.last_message_id ?? row.chat?.last_message_id,
      unread_count: row.unread_count ?? row.chat?.unread_count ?? 0,
    }));
    return reply.send({ code: 1, msg: 'ok', data: { ...result, chats } });
  });

  app.get('/history/:chatId', async (request, reply) => {
    const { userId } = (request as any).user;
    const { chatId } = request.params as { chatId: string };
    const { shopId, from_message_id, limit } = request.query as { shopId: string; from_message_id?: string; limit?: string };
    if (!shopId) return reply.status(400).send({ code: 0, msg: '缺少 shopId' });

    const shop = await prisma.shop.findFirst({ where: { id: shopId, userId } });
    if (!shop || !shop.clientId || !shop.apiKeyEncrypted) {
      return reply.status(400).send({ code: 0, msg: '店铺配置不完整' });
    }

    const client = new OzonClient({ clientId: shop.clientId, apiKey: decrypt(shop.apiKeyEncrypted) });
    const result: any = await client.getChatHistory(chatId, {
      from_message_id: from_message_id ? Number(from_message_id) : undefined,
      limit: Number(limit) || 50,
    });
    const messages = (Array.isArray(result.messages) ? result.messages : []).map(projectOzonChatMessage);
    return reply.send({ code: 1, msg: 'ok', data: { ...result, messages } });
  });

  app.post('/send', async (request, reply) => {
    const { userId } = (request as any).user;
    const body = request.body as { shopId: string; chatId: string; text: string };
    if (!body?.shopId || !body?.chatId || !body?.text?.trim()) {
      return reply.status(400).send({ code: 0, msg: '缺少 shopId/chatId/text' });
    }

    const shop = await prisma.shop.findFirst({ where: { id: body.shopId, userId } });
    if (!shop || !shop.clientId || !shop.apiKeyEncrypted) {
      return reply.status(400).send({ code: 0, msg: '店铺配置不完整' });
    }

    const client = new OzonClient({ clientId: shop.clientId, apiKey: decrypt(shop.apiKeyEncrypted) });
    const result = await client.sendChatMessage(body.chatId, body.text.trim());
    return reply.send({ code: 1, msg: '已发送', data: result });
  });

  app.post('/read', async (request, reply) => {
    const { userId } = (request as any).user;
    const body = request.body as { shopId: string; chatId: string; from_message_id: number };
    if (!body?.shopId || !body?.chatId) {
      return reply.status(400).send({ code: 0, msg: '缺少参数' });
    }

    const shop = await prisma.shop.findFirst({ where: { id: body.shopId, userId } });
    if (!shop || !shop.clientId || !shop.apiKeyEncrypted) {
      return reply.status(400).send({ code: 0, msg: '店铺配置不完整' });
    }

    const client = new OzonClient({ clientId: shop.clientId, apiKey: decrypt(shop.apiKeyEncrypted) });
    const result = await client.markChatRead(body.chatId, body.from_message_id);
    return reply.send({ code: 1, msg: 'ok', data: result });
  });
}
