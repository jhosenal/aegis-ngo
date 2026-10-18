import { ZodError } from 'zod';
import type { FastifyInstance } from 'fastify';
import { AegisError } from '../engine/errors.js';
import { ERROR_STATUS } from '../types/domain.js';
import { hasUiBuild } from './staticUi.js';
import { extname } from 'node:path';

interface ErrorLike extends Error {
  code?: string;
  statusCode?: number;
}

function isErrorLike(value: unknown): value is ErrorLike {
  return value instanceof Error;
}

export function registerErrorHandlers(app: FastifyInstance): void {
  app.setErrorHandler((error: ErrorLike, request, reply) => {
    if (error instanceof AegisError) {
      const statusCode = ERROR_STATUS[error.code] ?? 500;
      return reply.code(statusCode).send({
        error: { code: error.code, message: error.message, details: error.details ?? {} },
      });
    }
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: { code: 'E_VALIDATION', message: 'Request validation failed', details: { issues: error.issues } },
      });
    }
    if (isErrorLike(error) && error.statusCode === 400 && error.code?.startsWith('FST_ERR_CTP_')) {
      return reply.code(400).send({
        error: { code: 'E_JSON_PARSE', message: 'Request body must be valid JSON', details: {} },
      });
    }

    request.log.error({ err: error }, 'Unhandled API error');
    return reply.code(500).send({
      error: { code: 'E_INTERNAL', message: 'Internal server error', details: {} },
    });
  });

  app.setNotFoundHandler((request, reply) => {
    const pathname = request.url.split('?')[0] ?? '';
    const isPage = !pathname.startsWith('/assets/') && extname(pathname) === '';
    if (request.method === 'GET' && !request.url.startsWith('/api/') && isPage && hasUiBuild()) {
      return reply.type('text/html').sendFile('index.html');
    }
    return reply.code(404).send({
      error: { code: 'E_NOT_FOUND', message: 'Not found', details: {} },
    });
  });
}

export function isValidApiId(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 120 && /^[A-Za-z0-9._:-]+$/.test(value);
}
