// GOLDEN (frozen). Shared error type: stable machine-readable code + human message.
export class AegisError extends Error {
  constructor(public readonly code: string, message?: string, public readonly details?: Record<string, unknown>) {
    super(message ?? code);
    this.name = 'AegisError';
  }
}
