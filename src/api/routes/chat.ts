import type { FastifyInstance } from 'fastify';
import { ChatBody } from '../../types/api-schemas.js';
import { handleChat } from '../../chat/chatService.js';
import { resolveAttachments } from '../../services/cardService.js';
import { planFor } from '../../roles/modes.js';
import { principalFrom } from '../auth.js';
import type { AppDeps } from '../server.js';
import { createChatTrace } from '../../chat/debug.js';
import { AegisError } from '../../engine/errors.js';

export function registerChatRoute(app: FastifyInstance, deps: AppDeps): void {
  app.post('/api/chat', async (request, reply) => {
    const principal = principalFrom(request);
    const trace = createChatTrace(deps, principal, 'chat');
    reply.header('x-aegis-chat-trace', trace.id);
    trace.log('request', { requestId: request.id });
    try {
      const body = ChatBody.parse(request.body);
      trace.log('context', { mode: body.mode, inputChars: body.text.length, attachmentCount: body.attachments.length });
      planFor(body.mode, principal, deps.config);   // a mode the user may not use is a 403 before anything is stored
      resolveAttachments(deps.db, principal, body.attachments);
      const result = await handleChat(deps, principal, body);
      trace.log('completed', { messageId: result.messageId, source: result.route.source, routeId: result.route.routeId, notice: result.providerNotice, blockTypes: result.blocks.map((block) => block.type) });
      return result;
    } catch (error) {
      trace.log('error', { errorCode: error instanceof AegisError ? error.code : error instanceof Error && error.name === 'ZodError' ? 'E_VALIDATION' : 'E_INTERNAL' });
      throw error;
    }
  });
}
