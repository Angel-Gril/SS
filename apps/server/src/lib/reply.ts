import type { FastifyReply } from 'fastify';

export function ok(reply: FastifyReply, data?: unknown, msg = 'ok') {
  return reply.send({ code: 1, msg, data });
}

export function fail(reply: FastifyReply, msg: string, status = 200) {
  return reply.status(status).send({ code: 0, msg });
}

export function badRequest(reply: FastifyReply, msg = '参数错误') {
  return reply.status(400).send({ code: 0, msg });
}

export function unauthorized(reply: FastifyReply, msg = '未登录') {
  return reply.status(401).send({ code: 0, msg });
}

export function forbidden(reply: FastifyReply, msg = '无权限') {
  return reply.status(403).send({ code: 0, msg });
}

export function notFound(reply: FastifyReply, msg = '资源不存在') {
  return reply.status(404).send({ code: 0, msg });
}
