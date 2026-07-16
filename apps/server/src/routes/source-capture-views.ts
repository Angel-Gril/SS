import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../lib/auth.js';
import {
  SOURCE_CAPTURE_VIEW_MEDIA_OFFSET_MAX,
  SOURCE_CAPTURE_VIEW_PAGE_LIMIT_MAX,
  SOURCE_CAPTURE_VIEW_SKU_OFFSET_MAX,
  SourceCaptureViewError,
  type SourceCaptureViewService,
} from '../services/source-capture-view.js';

export interface SourceCaptureViewRoutesOptions {
  service: Pick<SourceCaptureViewService, 'getView'>;
  authenticate?: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
}

const id = z.string().trim().min(1).max(200);

function boundedInteger(defaultValue: number, minimum: number, maximum: number) {
  return z.preprocess(
    (value) => value === undefined ? String(defaultValue) : value,
    z.string().regex(/^(?:0|[1-9]\d*)$/).transform(Number),
  ).refine(
    (value) => value >= minimum && value <= maximum,
    `must be between ${minimum} and ${maximum}`,
  );
}

const paramsSchema = z.object({ snapshotId: id }).strict();
const querySchema = z.object({
  supplyGoodsId: id,
  skuOffset: boundedInteger(0, 0, SOURCE_CAPTURE_VIEW_SKU_OFFSET_MAX),
  skuLimit: boundedInteger(50, 1, SOURCE_CAPTURE_VIEW_PAGE_LIMIT_MAX),
  mediaOffset: boundedInteger(0, 0, SOURCE_CAPTURE_VIEW_MEDIA_OFFSET_MAX),
  mediaLimit: boundedInteger(50, 1, SOURCE_CAPTURE_VIEW_PAGE_LIMIT_MAX),
}).strict();

function invalidRequest(reply: FastifyReply, message: string) {
  return reply.status(400).send({ code: 0, errorCode: 'invalid_request', msg: message });
}

export async function sourceCaptureViewRoutes(
  app: FastifyInstance,
  options: SourceCaptureViewRoutesOptions,
) {
  app.addHook('preHandler', options.authenticate || authenticate);

  app.get('/:snapshotId', async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    const query = querySchema.safeParse(request.query);
    if (!params.success || !query.success) {
      const issue = !params.success
        ? params.error.issues[0]
        : !query.success
          ? query.error.issues[0]
          : undefined;
      return invalidRequest(reply, issue?.message || '参数错误');
    }
    const ownerUserId = String((request as any).user?.userId || '').normalize('NFKC').trim();
    if (!ownerUserId) {
      return reply.status(401).send({
        code: 0,
        errorCode: 'unauthorized',
        msg: '未登录',
      });
    }

    try {
      const view = await options.service.getView({
        snapshotId: params.data.snapshotId,
        supplyGoodsId: query.data.supplyGoodsId,
        ownerUserId,
        skuOffset: query.data.skuOffset,
        skuLimit: query.data.skuLimit,
        mediaOffset: query.data.mediaOffset,
        mediaLimit: query.data.mediaLimit,
      });
      reply.header('Cache-Control', 'no-store');
      return reply.send({ code: 1, msg: 'ok', data: view });
    } catch (error) {
      if (error instanceof SourceCaptureViewError) {
        return reply.status(error.statusCode).send({
          code: 0,
          errorCode: error.code,
          msg: error.code === 'SOURCE_CAPTURE_VIEW_NOT_FOUND'
            ? '来源商品采集快照不存在'
            : '来源商品采集快照无效，请重新采集',
        });
      }
      request.log.error({ err: error }, 'source capture view failed');
      return reply.status(500).send({
        code: 0,
        errorCode: 'source_capture_view_failed',
        msg: '读取来源商品采集快照失败',
      });
    }
  });
}
