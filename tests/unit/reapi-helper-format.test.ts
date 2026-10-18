import { expect, it } from 'vitest';
import { ReapiProvider } from '../../src/providers/reapi.js';

it('includes a JSON-mode hint in user content even when the system already requests JSON', async () => {
  let payload: { messages: { content: string }[]; response_format: { type: string } } | undefined;
  const provider = new ReapiProvider({ apiKey: 'synthetic-test-key', baseUrl: 'https://reapi.ai/api/v1', fetchImpl: async (_url, init) => {
    payload = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"message":"Hello","toolCall":null}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 10 } }), { status: 200 });
  } });
  await provider.call({ attemptId: 'ATT-TEST', roleId: 'helper', model: 'gpt-6-luna', system: 'Return json.', user: '{"request":"Hello"}', responseSchemaId: 'helper-turn-v1', maxOutputTokens: 1024, dataClass: 'tenant_private' }, new AbortController().signal);
  expect(payload?.response_format.type).toBe('json_object');
  expect(payload?.messages[1]?.content).toContain('(Respond with a single json object.)');
});
