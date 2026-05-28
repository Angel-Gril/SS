import type { FastifyInstance } from 'fastify';
import { authenticate } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';
import { decrypt } from '../lib/crypto.js';
import { OzonClient } from '../services/ozon-client.js';

export async function chatRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.get('/list', async (request, reply) => {
    const { userId } = (request as any).user;
    const { shopId, offset, limit } = request.query as { shopId: string; offset?: string; limit?: string };
    if (!shopId) return reply.status(400).send({ code: 0, msg: '缺少 shopId' });

    const shop = await prisma.shop.findFirst({ where: { id: shopId, userId } });
    if (!shop || !shop.clientId || !shop.apiKeyEncrypted) {
      return reply.status(400).send({ code: 0, msg: '店铺配置不完整' });
    }

    const client = new OzonClient({ clientId: shop.clientId, apiKey: decrypt(shop.apiKeyEncrypted) });
    const result = await client.getChatList({ limit: Number(limit) || 30, offset: Number(offset) || 0 });
    return reply.send({ code: 1, msg: 'ok', data: result });
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
    const result = await client.getChatHistory(chatId, {
      from_message_id: from_message_id ? Number(from_message_id) : undefined,
      limit: Number(limit) || 50,
    });
    return reply.send({ code: 1, msg: 'ok', data: result });
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
