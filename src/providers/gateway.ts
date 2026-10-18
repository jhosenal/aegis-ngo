import { GOOGLE_PRICED_MODELS, PRICED_MODELS } from './model-prices.js';
import { appendEvent } from '../audit/chainStore.js';
import { canonicalize, hashWithDomain } from '../engine/canonical.js';
import type { Clock } from '../engine/clock.js';
import type { IdGen } from '../engine/ids.js';
import { SYSTEM_TENANT_ID, ProviderError, type AttemptRecord, type DataClass, type GatewayOutcome, type ModelProvider, type ModelRequest, type ModelResponse, type ModelUsage, type RoleBinding, type RuntimeRole } from '../types/domain.js';
import type { AegisConfig } from '../config/config.js';
import { BudgetLedger } from './budget-ledger.js';
import { CircuitBreaker } from './circuit.js';
import { actualMicro, reservationMicro, type PriceSnapshot } from './pricing.js';

type Db = import('better-sqlite3').Database;

export interface GatewayDeps {
  db: Db;
  clock: Clock;
  ids: IdGen;
  config: AegisConfig;
  ledger: BudgetLedger;
  primary: ModelProvider;
  backup: ModelProvider | null;
  binding: (role: RuntimeRole) => RoleBinding;
  price: PriceSnapshot | null;
  sleep: (ms: number) => Promise<void>;
  rng: () => number;
  monotonicMs: () => number;
}

interface AttemptResult {
  outcome: string;
  kind: 'success' | 'retryable' | 'auth' | 'malformed' | 'refusal' | 'bad-request' | 'budget' | 'circuit' | 'aborted';
  response: ModelResponse | null;
  valid: boolean | null;
  costBasis: AttemptRecord['costBasis'];
}

interface ProviderChoice {
  provider: ModelProvider;
  model: string;
}

/** 'google' | 'reapi' (stub providers map to the provider they stand in for). */
export function fundingKey(providerId: string): string {
  return providerId.replace(/^stub-/, '');
}

export class ModelGateway {
  private readonly breakers = new Map<string, CircuitBreaker>();

  constructor(private readonly deps: GatewayDeps) {}

  async call(
    role: RuntimeRole,
    task: { taskId: string; tenantId?: string; system: string; user: string; responseSchemaId: string; dataClass: DataClass },
    validate: (text: string) => boolean,
    // signal: the caller's cancel (the person pressed Cancel or closed the page). It stops the network request at once, never retries and never tries the backup provider.
    // deadlineMs: a longer total time for ONE call that is known to be slow (a translation of a long text into Tamil takes 10 to 20 seconds); it never raises the limits for any other call.
    options: { primaryModel?: string | null; signal?: AbortSignal; deadlineMs?: number } = {},
  ): Promise<GatewayOutcome> {
    if (!this.deps.config.modelsEnabled) {
      return { status: 'DEGRADED', text: null, notice: 'MODELS_DISABLED', attempts: [] };
    }
    const cancelled = (attempts: AttemptRecord[]): GatewayOutcome => ({ status: 'CANCELLED', text: null, notice: 'CANCELLED', attempts });
    if (options.signal?.aborted) return cancelled([]);

    const seatBinding = this.deps.binding(role);
    // A mode may swap the model in the primary position for this one call; limits, budget and backup are unchanged.
    const binding = options.primaryModel ? { ...seatBinding, primaryModel: options.primaryModel } : seatBinding;
    const totalLimit = Math.min(this.deps.config.gateway.maxAttemptsTotal, binding.maxAttemptsTotal);
    const primaryLimit = Math.min(this.deps.config.gateway.maxPrimaryAttempts, totalLimit);
    const deadline = this.deps.monotonicMs() + (options.deadlineMs ?? Math.min(this.deps.config.gateway.totalDeadlineMs, binding.totalDeadlineMs));
    const inputHash = hashWithDomain('AEG-INPUT-v1', { system: task.system, user: task.user });
    const attempts: AttemptRecord[] = [];
    let totalAttempts = 0;
    let primaryAttempts = 0;
    let retryNumber = 0;
    let primaryFailed = false;
    let previousFailure: string | null = null;
    const primaryAllowed = this.providerAllowsDataClass(this.deps.primary, binding, task.dataClass);

    const primary: ProviderChoice = { provider: this.deps.primary, model: binding.primaryModel };
    while (primaryAllowed && primaryAttempts < primaryLimit && totalAttempts < totalLimit) {
      if (deadline - this.deps.monotonicMs() <= 0) break;
      primaryAttempts += 1;
      totalAttempts += 1;
      const result = await this.attempt(primary, role, task, binding, inputHash, deadline, validate, previousFailure, options.signal);
      attempts.push(result.record);
      if (result.outcome.outcome === 'CANCELLED') return cancelled(attempts);
      if (result.outcome.kind === 'success') {
        return { status: 'OK', text: result.outcome.response!.text, notice: null, attempts };
      }
      if (result.outcome.kind === 'aborted') break;
      primaryFailed = true;
      if (result.outcome.kind === 'refusal') return { status: 'REFUSED', text: null, notice: 'REFUSED', attempts };
      if (result.outcome.kind === 'bad-request') return { status: 'DEGRADED', text: null, notice: 'MODELS_UNAVAILABLE', attempts };
      if (result.outcome.kind === 'auth' || result.outcome.kind === 'malformed' || result.outcome.kind === 'budget' || result.outcome.kind === 'circuit') break;

      previousFailure = result.outcome.outcome;
      retryNumber += 1;
      if (primaryAttempts >= primaryLimit || totalAttempts >= totalLimit) break;
      const backoff = Math.floor(this.deps.config.gateway.backoffBaseMs * (2 ** (retryNumber - 1)) * (0.5 + this.deps.rng()));
      await this.deps.sleep(backoff);
      if (options.signal?.aborted) return cancelled(attempts);
    }

    const backupAllowed = !options.signal?.aborted && this.deps.backup !== null
      && binding.backupModel !== null
      && this.providerAllowsDataClass(this.deps.backup, binding, task.dataClass)
      && totalAttempts < totalLimit
      && deadline - this.deps.monotonicMs() > 0;
    if (backupAllowed) {
      totalAttempts += 1;
      const backup: ProviderChoice = { provider: this.deps.backup!, model: binding.backupModel! };
      const result = await this.attempt(backup, role, task, binding, inputHash, deadline, validate, previousFailure, options.signal);
      attempts.push(result.record);
      if (result.outcome.outcome === 'CANCELLED') return cancelled(attempts);
      if (result.outcome.kind === 'success') {
        return {
          status: 'OK',
          text: result.outcome.response!.text,
          notice: primaryFailed ? 'GOOGLE_UNAVAILABLE_BACKUP_USED' : null,
          attempts,
        };
      }
      if (result.outcome.kind === 'refusal') return { status: 'REFUSED', text: null, notice: 'REFUSED', attempts };
      if (result.outcome.kind === 'bad-request') return { status: 'DEGRADED', text: null, notice: 'MODELS_UNAVAILABLE', attempts };
    }

    const budgetDenied = attempts.some((attempt) => attempt.outcome === 'BUDGET_DENIED');
    return {
      status: 'DEGRADED',
      text: null,
      notice: budgetDenied ? 'BUDGET_EXHAUSTED' : 'MODELS_UNAVAILABLE',
      attempts,
    };
  }

  private async attempt(
    choice: ProviderChoice,
    role: RuntimeRole,
    task: { taskId: string; tenantId?: string; system: string; user: string; responseSchemaId: string; dataClass: DataClass },
    binding: RoleBinding,
    inputHash: string,
    deadline: number,
    validate: (text: string) => boolean,
    retryReason: string | null,
    callerSignal?: AbortSignal,
  ): Promise<{ outcome: AttemptResult; record: AttemptRecord }> {
    const { provider, model } = choice;
    const attemptId = this.deps.ids.next('ATT');
    const reservationId = this.deps.ids.next('RSV');
    const breaker = this.breakerFor(provider.id);
    const startedAt = this.deps.clock.now();
    if (!breaker.canAttempt()) {
      const outcome: AttemptResult = { outcome: 'CIRCUIT_OPEN', kind: 'circuit', response: null, valid: null, costBasis: 'none' };
      this.writeAttempt({ attemptId, taskId: task.taskId, role, provider, model, binding, inputHash, startedAt, outcome, retryReason, reservationId: null, tenantId: task.tenantId });
      return { outcome, record: { attemptId, provider: provider.id, outcome: outcome.outcome, retryReason, costBasis: outcome.costBasis } };
    }

    const base = this.usablePrice(binding);
    // Spend is priced per provider: reAPI models use their own published price; anything else is settled at the configured price as a CEILING and labelled 'estimated'.
    const { price, exact } = base ? this.priceFor(provider.id, model, base) : { price: null, exact: true };
    const maxMicro = price ? reservationMicro(task.system, task.user, binding.maxOutputTokens, price) : 0;
    const reservation = this.deps.ledger.reserve({
      reservationId,
      taskId: task.taskId,
      attemptId,
      dayKey: startedAt.slice(0, 10),
      maxMicro,
      priceSnapshotId: price?.id ?? null,
      now: startedAt,
      provider: fundingKey(provider.id),
    });
    if (!reservation.ok) {
      const outcome: AttemptResult = { outcome: 'BUDGET_DENIED', kind: 'budget', response: null, valid: null, costBasis: 'none' };
      this.writeAttempt({ attemptId, taskId: task.taskId, role, provider, model, binding, inputHash, startedAt, outcome, retryReason: reservation.reason, reservationId: null, tenantId: task.tenantId });
      return { outcome, record: { attemptId, provider: provider.id, outcome: outcome.outcome, retryReason: reservation.reason, costBasis: outcome.costBasis } };
    }

    const request: ModelRequest = {
      attemptId,
      roleId: role,
      model,
      system: task.system,
      user: task.user,
      responseSchemaId: task.responseSchemaId,
      maxOutputTokens: binding.maxOutputTokens,
      dataClass: task.dataClass,
    };
    this.writeStarted({ attemptId, taskId: task.taskId, role, provider, model, binding, inputHash, startedAt, reservationId: reservation.reservationId, tenantId: task.tenantId });

    let outcome: AttemptResult;
    const remainingMs = deadline - this.deps.monotonicMs();
    if (remainingMs <= 0) {
      outcome = { outcome: 'ABORTED', kind: 'aborted', response: null, valid: null, costBasis: 'none' };
      this.deps.ledger.release(reservation.reservationId, this.deps.clock.now());
      this.writeFinished({ attemptId, taskId: task.taskId, role, provider, model, binding, inputHash, startedAt, retryReason, reservationId: reservation.reservationId, tenantId: task.tenantId }, this.deps.clock.now(), outcome, null);
      return { outcome, record: { attemptId, provider: provider.id, outcome: outcome.outcome, retryReason, costBasis: outcome.costBasis } };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), remainingMs);
    // The caller's cancel stops this network request immediately (the provider adapters pass the signal to fetch).
    let callerAborted = false;
    const onCaller = (): void => { callerAborted = true; controller.abort(); };
    if (callerSignal) { if (callerSignal.aborted) onCaller(); else callerSignal.addEventListener('abort', onCaller, { once: true }); }
    try {
      const response = await raceAbort(provider.call(request, controller.signal), controller.signal);
      if (callerAborted) {
        // The answer arrived as the person cancelled: it was paid for, so it is settled, but it is not used.
        if (response.usage === null) this.deps.ledger.markLiability(reservation.reservationId, this.deps.clock.now());
        else this.deps.ledger.settle(reservation.reservationId, actualMicro(response.usage, price!), this.deps.clock.now());
        outcome = { outcome: 'CANCELLED', kind: 'aborted', response: null, valid: null, costBasis: response.usage === null ? 'unknown' : exact ? 'measured' : 'estimated' };
      } else if (controller.signal.aborted || deadline - this.deps.monotonicMs() <= 0) {
        outcome = { outcome: 'TIMEOUT', kind: 'retryable', response: null, valid: null, costBasis: 'unknown' };
        this.deps.ledger.markLiability(reservation.reservationId, this.deps.clock.now());
        breaker.recordFailure();
      } else {
        let valid = false;
        try {
          valid = validate(response.text);
        } catch {
          valid = false;
        }
        if (response.usage === null) {
          this.deps.ledger.markLiability(reservation.reservationId, this.deps.clock.now());
        } else {
          this.deps.ledger.settle(reservation.reservationId, actualMicro(response.usage, price!), this.deps.clock.now());
        }
        if (valid) {
          outcome = { outcome: 'OK', kind: 'success', response, valid: true, costBasis: response.usage === null ? 'unknown' : exact ? 'measured' : 'estimated' };
          breaker.recordSuccess();
        } else {
          outcome = { outcome: 'MALFORMED', kind: 'malformed', response, valid: false, costBasis: response.usage === null ? 'unknown' : exact ? 'measured' : 'estimated' };
          breaker.recordFailure();
        }
      }
    } catch (error: unknown) {
      if (callerAborted) {
        // Cancelled while the provider was working: it may already have billed, so the reservation stays as a liability (never silently dropped).
        // This says nothing about the provider's health, so the circuit breaker is not touched, and nothing is retried.
        this.deps.ledger.markLiability(reservation.reservationId, this.deps.clock.now());
        outcome = { outcome: 'CANCELLED', kind: 'aborted', response: null, valid: null, costBasis: 'unknown' };
      } else {
      const providerError = error instanceof ProviderError ? error : null;
      // Adapters sanitize credential-bearing messages before creating ProviderError.
      // Keep deployment failures diagnosable without logging prompts or credentials.
      if (providerError && !provider.isStub) console.error('Model attempt failed', { provider: provider.id, kind: providerError.kind, detail: providerError.message });
      const kind = controller.signal.aborted ? 'TIMEOUT' : providerError?.kind ?? 'TRANSIENT';
      const possiblyCharged = controller.signal.aborted || providerError === null || providerError.possiblyCharged;
      if (kind === 'TIMEOUT' || possiblyCharged) {
        this.deps.ledger.markLiability(reservation.reservationId, this.deps.clock.now());
      } else {
        this.deps.ledger.release(reservation.reservationId, this.deps.clock.now());
      }
      if (kind === 'AUTH') breaker.trip();
      else if (kind === 'BAD_REQUEST') { /* this request was rejected (for example by the provider's content filter): it says nothing about the provider's health, so it must not open the circuit for everyone */ }
      else breaker.recordFailure();
      const resultKind: AttemptResult['kind'] = kind === 'AUTH' ? 'auth'
        : kind === 'REFUSAL' ? 'refusal'
          : kind === 'BAD_REQUEST' ? 'bad-request'
            : kind === 'MALFORMED' ? 'malformed'
            : 'retryable';
      outcome = { outcome: kind, kind: resultKind, response: null, valid: null, costBasis: possiblyCharged ? 'unknown' : 'none' };
      }
    } finally {
      clearTimeout(timeout);
      callerSignal?.removeEventListener('abort', onCaller);
    }

    this.writeFinished({ attemptId, taskId: task.taskId, role, provider, model, binding, inputHash, startedAt, retryReason, reservationId: reservation.reservationId, tenantId: task.tenantId }, this.deps.clock.now(), outcome, outcome.response);
    return { outcome, record: { attemptId, provider: provider.id, outcome: outcome.outcome, retryReason, costBasis: outcome.costBasis } };
  }

  /** The price used to reserve and settle one attempt, and whether it is the provider's own published price (exact) or the configured ceiling. */
  private priceFor(providerId: string, model: string, base: PriceSnapshot): { price: PriceSnapshot; exact: boolean } {
    const key = fundingKey(providerId);
    if (key === 'reapi') {
      const own = PRICED_MODELS[model];
      if (own) return { price: { id: base.id, capturedAt: base.capturedAt, inputMicroPerMTok: Math.round(own.inputPerMTokUsd * 1_000_000), outputMicroPerMTok: Math.round(own.outputPerMTokUsd * 1_000_000), source: own.source }, exact: true };
      return { price: base, exact: false };
    }
    if (key === 'google') {
      const own = GOOGLE_PRICED_MODELS[model];
      if (own) return { price: { id: base.id, capturedAt: base.capturedAt, inputMicroPerMTok: Math.round(own.inputPerMTokUsd * 1_000_000), outputMicroPerMTok: Math.round(own.outputPerMTokUsd * 1_000_000), source: own.source }, exact: true };
    }
    return { price: base, exact: true };
  }

  private usablePrice(binding: RoleBinding): PriceSnapshot | null {
    const price = this.deps.price;
    if (!price || !binding.priceSnapshotId || price.id !== binding.priceSnapshotId) return null;
    if (this.deps.config.budget.priceSnapshotId && price.id !== this.deps.config.budget.priceSnapshotId) return null;
    return price;
  }

  private providerAllowsDataClass(provider: ModelProvider, binding: RoleBinding, dataClass: DataClass): boolean {
    if (!binding.allowedDataClasses.includes(dataClass)) return false;
    if (provider.id === 'reapi' || provider.id === 'stub-reapi') {
      return this.deps.config.reapi.allowedDataClasses.includes(dataClass);
    }
    if (provider.id === 'google') return this.deps.config.google.allowedDataClasses.includes(dataClass);
    return true;
  }

  private breakerFor(providerId: string): CircuitBreaker {
    let breaker = this.breakers.get(providerId);
    if (!breaker) {
      breaker = new CircuitBreaker(
        this.deps.config.gateway.circuitFailureThreshold,
        this.deps.config.gateway.circuitCooldownMs,
        this.deps.monotonicMs,
      );
      this.breakers.set(providerId, breaker);
    }
    return breaker;
  }

  private writeStarted(args: {
    attemptId: string; taskId: string; role: RuntimeRole; provider: ModelProvider; model: string;
    binding: RoleBinding; inputHash: string; startedAt: string; reservationId: string; tenantId?: string;
  }): void {
    const tx = this.deps.db.transaction(() => {
      this.deps.db.prepare(
        'INSERT INTO model_calls (attempt_id, task_id, role_id, provider, is_stub, requested_model, reported_model, binding_version, input_hash, started_at, ended_at, outcome, retry_reason, validation_result, usage_json, cost_basis, reservation_id) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, NULL, ?, ?, NULL, NULL, ?, ?)',
      ).run(args.attemptId, args.taskId, args.role, args.provider.id, args.provider.isStub ? 1 : 0, args.model,
        args.binding.bindingVersion, args.inputHash, args.startedAt, 'ABORTED', null, 'none', args.reservationId);
    });
    tx.immediate();
  }

  private writeAttempt(args: {
    attemptId: string; taskId: string; role: RuntimeRole; provider: ModelProvider; model: string;
    binding: RoleBinding; inputHash: string; startedAt: string; outcome: AttemptResult; retryReason: string | null;
    reservationId: string | null; tenantId?: string;
  }): void {
    const tx = this.deps.db.transaction(() => {
      this.deps.db.prepare(
        'INSERT INTO model_calls (attempt_id, task_id, role_id, provider, is_stub, requested_model, reported_model, binding_version, input_hash, started_at, ended_at, outcome, retry_reason, validation_result, usage_json, cost_basis, reservation_id) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)',
      ).run(args.attemptId, args.taskId, args.role, args.provider.id, args.provider.isStub ? 1 : 0, args.model,
        args.binding.bindingVersion, args.inputHash, args.startedAt, this.deps.clock.now(), args.outcome.outcome,
        args.retryReason, args.outcome.costBasis, args.reservationId);
      this.writeAudit(args, args.outcome.outcome, args.outcome.costBasis);
    });
    tx.immediate();
  }

  private writeFinished(args: {
    attemptId: string; taskId: string; role: RuntimeRole; provider: ModelProvider; model: string;
    binding: RoleBinding; inputHash: string; startedAt: string; retryReason: string | null;
    reservationId: string | null; tenantId?: string;
  }, endedAt: string, outcome: AttemptResult, response: ModelResponse | null): void {
    const tx = this.deps.db.transaction(() => {
      this.deps.db.prepare(
        'UPDATE model_calls SET reported_model = ?, ended_at = ?, outcome = ?, retry_reason = ?, validation_result = ?, usage_json = ?, cost_basis = ? WHERE attempt_id = ?',
      ).run(response?.reportedModel ?? null, endedAt, outcome.outcome, args.retryReason,
        outcome.valid === null ? null : outcome.valid ? 'valid' : 'invalid',
        response?.usage === null || response?.usage === undefined ? null : canonicalize(response.usage),
        outcome.costBasis, args.attemptId);
      this.writeAudit(args, outcome.outcome, outcome.costBasis);
    });
    tx.immediate();
  }

  private writeAudit(args: {
    attemptId: string; taskId: string; role: RuntimeRole; provider: ModelProvider; model: string;
    binding: RoleBinding; inputHash: string; startedAt: string; tenantId?: string;
  }, outcome: string, costBasis: AttemptRecord['costBasis']): void {
    appendEvent(this.deps.db, {
      productId: 'AEG',
      tenantId: args.tenantId ?? SYSTEM_TENANT_ID,
      eventType: 'model.attempted',
      actorIdentity: args.role,
      actorRole: args.role,
      occurredAt: this.deps.clock.now(),
      workflowId: null,
      workflowVersion: null,
      inputSnapshotHash: args.inputHash,
      resultHash: null,
      versions: { binding: args.binding.bindingVersion },
      payloadHash: hashWithDomain('AEG-PAYLOAD-v1', { attemptId: args.attemptId, provider: args.provider.id, outcome, costBasis }),
      correlationKey: args.taskId,
    }, this.deps.ids);
  }
}

function raceAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new ProviderError('TIMEOUT', 'Provider request timed out', true));
  return new Promise((resolve, reject) => {
    const onAbort = (): void => reject(new ProviderError('TIMEOUT', 'Provider request timed out', true));
    signal.addEventListener('abort', onAbort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}
