import { ProviderError, type ModelProvider, type ModelRequest, type ModelResponse, type ModelUsage, type ProviderErrorKind } from '../types/domain.js';

export type StubStep =
  | { type: 'ok'; text: string; usage?: ModelUsage | null; reportedModel?: string }
  | { type: 'error'; kind: ProviderErrorKind; possiblyCharged?: boolean }
  | { type: 'delay'; ms: number };

export class StubProvider implements ModelProvider {
  readonly isStub = true;
  readonly calls: ModelRequest[] = [];
  private cursor = 0;

  constructor(readonly id: 'stub-google' | 'stub-reapi', private readonly script: StubStep[]) {}

  async call(request: ModelRequest, signal: AbortSignal): Promise<ModelResponse> {
    this.calls.push(request);
    if (signal.aborted) throw new ProviderError('TIMEOUT', 'Stub request was aborted before it started');
    const step = this.script[this.cursor];
    this.cursor += 1;
    if (!step) throw new ProviderError('TRANSIENT', 'Stub script is exhausted');
    if (step.type === 'error') throw new ProviderError(step.kind, step.kind, step.possiblyCharged ?? false);
    if (step.type === 'delay') {
      if (!Number.isFinite(step.ms) || step.ms < 0) throw new RangeError('Stub delay must be non-negative');
      await waitForDelay(step.ms, signal);
      throw new ProviderError('TIMEOUT', 'Stub delay elapsed without a response', true);
    }
    return {
      text: step.text,
      reportedModel: step.reportedModel ?? null,
      usage: step.usage === undefined ? null : step.usage,
    };
  }
}

function waitForDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new ProviderError('TIMEOUT', 'Stub request was aborted', true));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      reject(new ProviderError('TIMEOUT', 'Stub request was aborted', true));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
