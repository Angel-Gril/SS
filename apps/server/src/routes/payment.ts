import type { FastifyInstance } from 'fastify';
import { handleEpayNotify } from '../services/recharge.js';

function getRawParams(request: any): Record<string, any> {
  if (request.method === 'GET') return request.query || {};
  return request.body || {};
}

export async function paymentRoutes(app: FastifyInstance) {
  async function notify(request: any, reply: any) {
    const { providerId } = request.params as { providerId: string };
    const result = await handleEpayNotify({
      providerId,
      rawParams: getRawParams(request),
      ip: request.ip,
      userAgent: request.headers?.['user-agent'],
    });
    return reply.type('text/plain').send(result.response);
  }

  app.get('/notify/epay/:providerId', notify);
  app.post('/notify/epay/:providerId', notify);

  app.get('/return/epay', async (request, reply) => {
    const query = request.query as { out_trade_no?: string; param?: string };
    const suffix = query.param ? `?recharge=${encodeURIComponent(query.param)}` : '';
    return reply.redirect(`/finance${suffix}`);
  });
}
