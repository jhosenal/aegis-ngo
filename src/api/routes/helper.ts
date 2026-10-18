import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../server.js';
import { principalFrom } from '../auth.js';
import { HelperBody, handleHelper } from '../../chat/helper.js';
import { createChatTrace } from '../../chat/debug.js';
import { AegisError } from '../../engine/errors.js';
import { hashWithDomain } from '../../engine/canonical.js';

export function registerHelperRoute(app: FastifyInstance, deps: AppDeps): void {
  // This endpoint shares the existing auth, tenant, model, budget and audit controls.
  app.post('/api/helper', async (request, reply) => {
    const principal = principalFrom(request);
    const trace = createChatTrace(deps, principal, 'helper');
    reply.header('x-aegis-chat-trace', trace.id);
    trace.log('request', { requestId: request.id });
    // Cancel: when the browser aborts the request (the Cancel button) or the page is closed, the connection ends before the answer was written.
    // That aborts the model request in flight and every later step. (The REQUEST's own 'close' event also fires once the body is read, so the RESPONSE is watched.)
    const cancel = new AbortController();
    const onClose = (): void => { if (!reply.raw.writableFinished) cancel.abort(); };
    reply.raw.once('close', onClose);
    try {
      const body = HelperBody.parse(request.body);
      trace.log('context', { mode: body.mode, conversationId: body.conversationId, inputChars: body.text.length, attachmentCount: body.attachments.length, inputHash: hashWithDomain('AEG-INPUT-v1', { text: body.text }) });
      return await handleHelper(deps, principal, body, trace, cancel.signal);
    } catch (error) {
      trace.log('error', { errorCode: error instanceof AegisError ? error.code : error instanceof Error && error.name === 'ZodError' ? 'E_VALIDATION' : 'E_INTERNAL' });
      throw error;
    } finally {
      reply.raw.off('close', onClose);
    }
  });
}
