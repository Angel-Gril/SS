import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';
import { CarriageError, createOzonCarriageService, type CarriageScope } from '../services/ozon-carriage.js';

const scopeQuery = z.object({ shopId: z.string().min(1).max(100), warehouseId: z.string().min(1).max(100) });
const listQuery = scopeQuery.extend({ sortType: z.enum(['sort', 'non-sort']), from: z.string().datetime(), to: z.string().datetime(), cursor: z.string().max(1000).optional() }).strict();
const resourceId = z.string().regex(/^[1-9]\d{0,15}$/u);

export async function ozonCarriageRoutes(app: FastifyInstance) {
  const service = createOzonCarriageService(prisma);
  app.addHook('onSend', async (_request, reply, payload) => { reply.header('Cache-Control', 'private, no-store'); return payload; });
  app.addHook('preHandler', authenticate);
  app.addHook('preHandler', async (request, reply) => {
    const user = (request as any).user;
    if (user?.tokenUse !== 'account_session' || !user.userId || !['ADMIN', 'USER'].includes(user.role)) {
      return reply.status(403).send({ code: 0, msg: '组包仅允许店铺所属账号的网页登录会话' });
    }
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof z.ZodError) return reply.status(400).send({ code: 0, meta: { notDispatched: true }, msg: '组包参数或平台响应不符合合同，请核对后刷新' });
    if (error instanceof CarriageError) return reply.status(error.statusCode).send({ code: 0, meta: { notDispatched: true }, msg: error.message });
    // Raw provider bodies may contain customer details; do not serialize them into logs/UI.
    request.log.warn({ errorType: error instanceof Error ? error.name : 'unknown' }, 'Ozon carriage operation unavailable');
    return reply.status(502).send({ code: 0, msg: '暂时无法读取 Ozon 组包信息。若已提交，请从操作记录核对，不要重复创建。' });
  });
  function scope(request: any, input: unknown): CarriageScope {
    const parsed = scopeQuery.parse(input);
    return { ...parsed, ownerUserId: request.user.userId, actorUserId: request.user.actorUserId || request.user.userId };
  }
  app.get('/', async (request) => {
    const { shopId, warehouseId, ...query } = listQuery.parse(request.query);
    return { code: 1, msg: 'ok', data: await service.list(scope(request, { shopId, warehouseId }), query) };
  });
  app.get('/operations', async request => ({ code: 1, msg: 'ok', data: await service.operations(scope(request, request.query)) }));
  app.get('/:containerId', async request => {
    const containerId = resourceId.parse((request.params as any).containerId);
    return { code: 1, msg: 'ok', data: await service.get(scope(request, request.query), containerId) };
  });
  app.post('/commands', { bodyLimit: 64 * 1024 }, async request => {
    const body = z.object({ shopId: z.string(), warehouseId: z.string(), command: z.unknown() }).strict().parse(request.body);
    return { code: 1, msg: 'ok', data: await service.submit(scope(request, body), body.command) };
  });
  app.post('/operations/:id/recover', async request => {
    const operationId = z.string().min(1).max(100).parse((request.params as any).id);
    return { code: 1, msg: 'ok', data: await service.recover(scope(request, request.body), operationId) };
  });
  app.post('/operations/:id/close-unknown', async request => {
    const operationId = z.string().min(1).max(100).parse((request.params as any).id);
    const body = z.object({ shopId: z.string(), warehouseId: z.string(), acknowledged: z.literal(true), note: z.string().trim().min(10).max(1000) }).strict().parse(request.body);
    return { code: 1, msg: 'ok', data: await service.closeUnknown(scope(request, body), operationId, { acknowledged: body.acknowledged, note: body.note }) };
  });
  app.get('/:containerId/:kind', async (request, reply) => {
    const { containerId, kind } = z.object({ containerId: resourceId, kind: z.enum(['label', 'document']) }).parse(request.params);
    const file = await service.pdf(scope(request, request.query), containerId, kind);
    return reply.header('Cache-Control', 'private, no-store').header('X-Content-Type-Options', 'nosniff')
      .header('Content-Disposition', `inline; filename="container-${containerId}-${kind}.pdf"`).type(file.contentType).send(file.buffer);
  });
  app.get('/:containerId/:kind/preview', async request => {
    const { containerId, kind } = z.object({ containerId: resourceId, kind: z.enum(['label', 'document']) }).parse(request.params);
    const file = await service.pdf(scope(request, request.query), containerId, kind);
    return { code: 1, msg: 'ok', data: { base64: file.buffer.toString('base64') } };
  });
}
