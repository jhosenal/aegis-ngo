import type { DataClass, RuntimeRole } from '../types/domain.js';
import { isPricedModel } from '../providers/model-prices.js';

export interface AegisConfig {
  env: 'local' | 'cloud' | 'test';
  host: string;
  port: number;
  productId: 'AEG';
  storageMode: 'sqlite-local' | 'sqlite-ephemeral-demo';
  dbPath: string;
  authMode: 'demo';
  /** Google sign-in for named admin accounts (S0037). Off unless the client id, secret, public base URL and an allowlist are all set. */
  googleLogin: { enabled: boolean; clientId: string; clientSecret: string; baseUrl: string; adminEmails: string[]; proEmails: string[] };
  providerMode: 'stub' | 'live';
  /** Which provider is tried first. The other one is the backup. */
  primaryProvider: 'google' | 'reapi';
  modelsEnabled: boolean;
  /** Public Assist module (AEG-PLN-003). Off by default. Draft medical content can never be switched on when AEGIS_ENV is cloud. */
  assist: { enabled: boolean; draftMedical: boolean; preview: boolean };
  google: { apiKey: string; model: string; allowedDataClasses: DataClass[]; minIntervalMs: number; dailyRequestCap: number; /** Gemini model ids the chat selector may offer (AEGIS_GOOGLE_CHAT_MODELS). A model stays pending until it is listed, for example until its quota exists. */ chatModels: string[] };
  reapi: { apiKey: string; baseUrl: string; model: string; allowedDataClasses: DataClass[]; tokenParam: 'max_completion_tokens' | 'max_tokens' };
  /** Chat model modes (Auto, Normal, Pro, Expert). Pro, Expert and Auto's escalation are off until the owner switches them on. */
  modes: {
    models: { normal: string; pro: string; expert: string };
    escalationEnabled: boolean;
    premiumEnabled: boolean;
    registeredUsers: string[];
  };
  /** Optional per-role model overrides (AEGIS_ROLE_<ROLE>_PRIMARY_MODEL and AEGIS_ROLE_<ROLE>_BACKUP_MODEL). */
  roleModels: Partial<Record<RuntimeRole, { primaryModel?: string; backupModel?: string }>>;
  price: { inputMicroPerMTok: number; outputMicroPerMTok: number; capturedAt: string; source: string };
  budget: {
    priceSnapshotId: string;
    /** Per-funding allowances (S0038 finding 3): reAPI spend is allowed only up to AEGIS_BUDGET_REAPI_MICRO (default 0 = refused). */
    googleMicro: number;
    reapiMicro: number;
    accountMicro: number;
    dayMicro: number;
    taskMicro: number;
  };
  gateway: {
    totalDeadlineMs: number;
    maxAttemptsTotal: number;
    maxPrimaryAttempts: number;
    backoffBaseMs: number;
    circuitFailureThreshold: number;
    circuitCooldownMs: number;
  };
  feed: { allowlist: string[]; pollMinutes: number };
}

export class ConfigError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(`Invalid configuration:\n${problems.map((problem) => `- ${problem}`).join('\n')}`);
    this.name = 'ConfigError';
    this.problems = [...problems];
  }
}

export function loadConfig(env: Record<string, string | undefined>): AegisConfig {
  const problems: string[] = [];
  const readString = (name: string, fallback: string): string => env[name] ?? fallback;
  const readInteger = (name: string, fallback: number, minimum: number): number => {
    const raw = env[name];
    if (raw === undefined) return fallback;
    if (!/^-?\d+$/.test(raw)) {
      problems.push(`${name} must be an integer`);
      return fallback;
    }
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < minimum) {
      problems.push(`${name} must be an integer greater than or equal to ${minimum}`);
      return fallback;
    }
    return value;
  };
  const readBoolean = (name: string, fallback: boolean): boolean => {
    const raw = env[name];
    if (raw === undefined) return fallback;
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    problems.push(`${name} must be true or false`);
    return fallback;
  };

  const rawEnv = readString('AEGIS_ENV', 'local');
  const appEnv = rawEnv === 'local' || rawEnv === 'cloud' || rawEnv === 'test' ? rawEnv : 'local';
  if (rawEnv !== appEnv) problems.push('AEGIS_ENV must be local, cloud or test');

  const rawHost = readString('AEGIS_HOST', '127.0.0.1');
  const host = appEnv === 'cloud' ? '0.0.0.0' : rawHost;
  if (appEnv !== 'cloud' && !isLoopbackHost(host)) {
    problems.push('AEGIS_HOST must be a loopback address unless AEGIS_ENV is cloud');
  }

  if (appEnv === 'cloud' && env.PORT === undefined) problems.push('PORT is required when AEGIS_ENV is cloud');
  const port = readInteger('PORT', 8787, 1024);
  if (port > 65535) problems.push('PORT must be between 1024 and 65535');

  const productId = readString('AEGIS_PRODUCT_ID', 'AEG');
  if (productId !== 'AEG') problems.push('AEGIS_PRODUCT_ID must equal AEG');

  const rawStorageMode = readString('AEGIS_STORAGE_MODE', 'sqlite-local');
  const storageMode = rawStorageMode === 'sqlite-local' || rawStorageMode === 'sqlite-ephemeral-demo'
    ? rawStorageMode
    : 'sqlite-local';
  if (rawStorageMode !== storageMode) problems.push('AEGIS_STORAGE_MODE must be sqlite-local or sqlite-ephemeral-demo');
  if (appEnv === 'cloud' && storageMode !== 'sqlite-ephemeral-demo') {
    problems.push('AEGIS_STORAGE_MODE must be sqlite-ephemeral-demo when AEGIS_ENV is cloud');
  }

  const dbPath = readString('AEGIS_DB_PATH', './data/aegis.db');
  if (appEnv !== 'test' && dbPath === ':memory:') problems.push('AEGIS_DB_PATH :memory: is allowed only when AEGIS_ENV is test');

  const authMode = readString('AEGIS_AUTH_MODE', 'demo');
  if (authMode !== 'demo') problems.push('AEGIS_AUTH_MODE must be demo');

  const rawProviderMode = readString('AEGIS_PROVIDER_MODE', 'stub');
  const providerMode = rawProviderMode === 'stub' || rawProviderMode === 'live' ? rawProviderMode : 'stub';
  if (rawProviderMode !== providerMode) problems.push('AEGIS_PROVIDER_MODE must be stub or live');

  const modelsEnabled = readBoolean('AEGIS_MODELS_ENABLED', false);
  const assistEnabled = readBoolean('AEGIS_ASSIST_ENABLED', false);
  const assistDraftMedical = readBoolean('AEGIS_ASSIST_DRAFT_MEDICAL', false);
  const assistPreview = readBoolean('AEGIS_ASSIST_PREVIEW', false);
  if (assistPreview && !assistEnabled) problems.push('AEGIS_ASSIST_PREVIEW requires AEGIS_ASSIST_ENABLED=true');
  if (assistDraftMedical && appEnv === 'cloud') problems.push('AEGIS_ASSIST_DRAFT_MEDICAL must be false when AEGIS_ENV is cloud');
  if (assistDraftMedical && !assistEnabled) problems.push('AEGIS_ASSIST_DRAFT_MEDICAL requires AEGIS_ASSIST_ENABLED=true');
  const rawPrimary = readString('AEGIS_PRIMARY_PROVIDER', 'google');
  const primaryProvider = rawPrimary === 'reapi' ? 'reapi' : 'google';
  if (rawPrimary !== primaryProvider) problems.push('AEGIS_PRIMARY_PROVIDER must be google or reapi');
  const googleApiKey = readString('AEGIS_GOOGLE_API_KEY', '');
  const googleModel = readString('AEGIS_GOOGLE_MODEL', '');
  const reapiApiKey = readString('AEGIS_REAPI_API_KEY', '');
  const reapiBaseUrl = readString('AEGIS_REAPI_BASE_URL', '');
  const reapiModel = readString('AEGIS_REAPI_MODEL', '');
  const rawAllowedDataClasses = readString('AEGIS_REAPI_ALLOWED_DATA_CLASSES', 'public');
  const allowedDataClasses = rawAllowedDataClasses.split(',').map((value) => value.trim()).filter(Boolean);
  const validDataClasses = allowedDataClasses.every((value): value is DataClass => value === 'public' || value === 'tenant_private');
  if (!validDataClasses) problems.push('AEGIS_REAPI_ALLOWED_DATA_CLASSES may contain only public and tenant_private');

  const rawGoogleClasses = readString('AEGIS_GOOGLE_ALLOWED_DATA_CLASSES', 'public,tenant_private');
  const googleClasses = rawGoogleClasses.split(',').map((value) => value.trim()).filter(Boolean);
  if (!googleClasses.every((value) => value === 'public' || value === 'tenant_private')) {
    problems.push('AEGIS_GOOGLE_ALLOWED_DATA_CLASSES may contain only public and tenant_private');
  }
  const googleMinIntervalMs = readInteger('AEGIS_GOOGLE_MIN_INTERVAL_MS', 12000, 0);
  const googleDailyCap = readInteger('AEGIS_GOOGLE_DAILY_REQUEST_CAP', 200, 0);
  const rawTokenParam = readString('AEGIS_REAPI_TOKEN_PARAM', 'max_completion_tokens');
  const reapiTokenParam = rawTokenParam === 'max_tokens' ? 'max_tokens' : 'max_completion_tokens';
  if (rawTokenParam !== reapiTokenParam) problems.push('AEGIS_REAPI_TOKEN_PARAM must be max_completion_tokens or max_tokens');
  const priceInputMicro = readInteger('AEGIS_PRICE_INPUT_MICRO_PER_MTOK', 0, 0);
  const priceOutputMicro = readInteger('AEGIS_PRICE_OUTPUT_MICRO_PER_MTOK', 0, 0);
  const priceCapturedAt = readString('AEGIS_PRICE_CAPTURED_AT', '');
  const priceSource = readString('AEGIS_PRICE_SOURCE', '');
  const roleModels: AegisConfig['roleModels'] = {};
  for (const role of ['manager', 'coordinator', 'specialist', 'reviewer', 'advisor', 'helper'] as const) {
    const primaryModel = readString(`AEGIS_ROLE_${role.toUpperCase()}_PRIMARY_MODEL`, '');
    const backupModel = readString(`AEGIS_ROLE_${role.toUpperCase()}_BACKUP_MODEL`, '');
    if (primaryModel || backupModel) {
      roleModels[role] = { ...(primaryModel ? { primaryModel } : {}), ...(backupModel ? { backupModel } : {}) };
    }
  }
  const modeModels = {
    normal: readString('AEGIS_MODEL_NORMAL', 'gpt-6-luna'),
    pro: readString('AEGIS_MODEL_PRO', 'gpt-6-sol'),
    expert: readString('AEGIS_MODEL_EXPERT', 'claude-opus-5-5'),
  };
  for (const [tier, model] of Object.entries(modeModels)) {
    if (!isPricedModel(model)) problems.push(`AEGIS_MODEL_${tier.toUpperCase()} names ${model}, which has no published price in src/providers/model-prices.ts`);
  }
  const escalationEnabled = readBoolean('AEGIS_ESCALATION_ENABLED', false);
  const premiumEnabled = readBoolean('AEGIS_PREMIUM_MODES_ENABLED', false);
  const registeredUsers = readString('AEGIS_REGISTERED_USERS', '').split(',').map((value) => value.trim()).filter(Boolean);
  const priceSnapshotId = readString('AEGIS_PRICE_SNAPSHOT_ID', '');
  const budgetAccountMicro = readInteger('AEGIS_BUDGET_ACCOUNT_MICRO', 0, 0);
  const budgetDayMicro = readInteger('AEGIS_BUDGET_DAY_MICRO', 0, 0);
  const budgetTaskMicro = readInteger('AEGIS_BUDGET_TASK_MICRO', 0, 0);
  const budgetGoogleMicro = readInteger('AEGIS_BUDGET_GOOGLE_MICRO', budgetAccountMicro, 0);
  const budgetReapiMicro = readInteger('AEGIS_BUDGET_REAPI_MICRO', 0, 0);

  const totalDeadlineMs = readInteger('AEGIS_TOTAL_DEADLINE_MS', 15000, 1);
  const maxAttemptsTotal = readInteger('AEGIS_MAX_ATTEMPTS_TOTAL', 3, 1);
  const maxPrimaryAttempts = readInteger('AEGIS_MAX_PRIMARY_ATTEMPTS', 2, 1);
  const backoffBaseMs = readInteger('AEGIS_BACKOFF_BASE_MS', 200, 0);
  const circuitFailureThreshold = readInteger('AEGIS_CIRCUIT_FAILURE_THRESHOLD', 3, 1);
  const circuitCooldownMs = readInteger('AEGIS_CIRCUIT_COOLDOWN_MS', 30000, 0);
  if (maxPrimaryAttempts > maxAttemptsTotal) {
    problems.push('AEGIS_MAX_PRIMARY_ATTEMPTS must be less than or equal to AEGIS_MAX_ATTEMPTS_TOTAL');
  }

  const feedAllowlist = readString('AEGIS_FEED_ALLOWLIST', '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const feedPollMinutes = readInteger('AEGIS_FEED_POLL_MINUTES', 15, 1);

  if (providerMode === 'live') {
    if (primaryProvider === 'google') {
      if (!googleApiKey) problems.push('AEGIS_GOOGLE_API_KEY is required when AEGIS_PROVIDER_MODE is live');
      if (!googleModel) problems.push('AEGIS_GOOGLE_MODEL is required when AEGIS_PROVIDER_MODE is live');
    } else if (!reapiApiKey || !reapiBaseUrl) {
      problems.push('AEGIS_REAPI_API_KEY and AEGIS_REAPI_BASE_URL are required when AEGIS_PRIMARY_PROVIDER is reapi and AEGIS_PROVIDER_MODE is live');
    }
    if (!priceSnapshotId) problems.push('AEGIS_PRICE_SNAPSHOT_ID is required when AEGIS_PROVIDER_MODE is live');
    if (priceInputMicro === 0 || priceOutputMicro === 0) problems.push('AEGIS_PRICE_INPUT_MICRO_PER_MTOK and AEGIS_PRICE_OUTPUT_MICRO_PER_MTOK must be greater than 0 in live mode (use the paid-equivalent price as a safety cap on the free tier)');
    if (!priceCapturedAt) problems.push('AEGIS_PRICE_CAPTURED_AT is required when AEGIS_PROVIDER_MODE is live');
    if (budgetAccountMicro === 0) problems.push('AEGIS_BUDGET_ACCOUNT_MICRO must be greater than 0 in live mode');
    if (budgetDayMicro === 0) problems.push('AEGIS_BUDGET_DAY_MICRO must be greater than 0 in live mode');
    if (budgetTaskMicro === 0) problems.push('AEGIS_BUDGET_TASK_MICRO must be greater than 0 in live mode');
    if (budgetReapiMicro > budgetAccountMicro || budgetGoogleMicro > budgetAccountMicro) problems.push('Per-provider allowances may not exceed AEGIS_BUDGET_ACCOUNT_MICRO');
    // The hosted database is temporary, so the runtime ledger restarts empty. In the cloud the real limit must be enforced by the providers themselves (S0038 finding 2).
    if (appEnv === 'cloud') {
      const capGoogle = readInteger('AEGIS_PROVIDER_CAP_GOOGLE_MICRO', 0, 0);
      const capReapi = readInteger('AEGIS_PROVIDER_CAP_REAPI_MICRO', 0, 0);
      if (readString('AEGIS_SPEND_AUTHORITY', '') !== 'provider-caps') problems.push('AEGIS_SPEND_AUTHORITY must be provider-caps when AEGIS_ENV is cloud and AEGIS_PROVIDER_MODE is live (the temporary runtime ledger cannot enforce a cap across restarts)');
      if (capGoogle === 0 || capGoogle > budgetGoogleMicro) problems.push('AEGIS_PROVIDER_CAP_GOOGLE_MICRO must be greater than 0 and not above AEGIS_BUDGET_GOOGLE_MICRO: the cap set at Google for the exact key');
      if (budgetReapiMicro > 0 && (capReapi === 0 || capReapi > budgetReapiMicro)) problems.push('AEGIS_PROVIDER_CAP_REAPI_MICRO must be greater than 0 and not above AEGIS_BUDGET_REAPI_MICRO: the spend limit set at reAPI for the exact key');
    }
  }

  const glClientId = readString('AEGIS_GOOGLE_LOGIN_CLIENT_ID', '');
  const glClientSecret = readString('AEGIS_GOOGLE_LOGIN_CLIENT_SECRET', '');
  const glBaseUrl = readString('AEGIS_PUBLIC_BASE_URL', '').replace(/\/+$/, '');
  const readEmails = (name: string): string[] => {
    const out: string[] = [];
    for (const value of readString(name, '').split(',').map((entry) => entry.trim().toLowerCase()).filter(Boolean)) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) problems.push(`${name} must be email addresses separated by commas`);
      else out.push(value);
    }
    return out;
  };
  const glAdmins = readEmails('AEGIS_GOOGLE_LOGIN_ADMINS');
  const glPro = readEmails('AEGIS_GOOGLE_LOGIN_PRO');
  const glAny = glClientId !== '' || glClientSecret !== '' || glBaseUrl !== '';
  if (glAny) {
    if (!glClientId || !glClientSecret) problems.push('AEGIS_GOOGLE_LOGIN_CLIENT_ID and AEGIS_GOOGLE_LOGIN_CLIENT_SECRET are both required for Google sign-in');
    if (!/^https?:\/\/[^/\s]+$/.test(glBaseUrl)) problems.push('AEGIS_PUBLIC_BASE_URL must be an origin such as https://host (no path) for Google sign-in');
    else if (appEnv === 'cloud' && !glBaseUrl.startsWith('https://')) problems.push('AEGIS_PUBLIC_BASE_URL must be https when AEGIS_ENV is cloud');
  }

  if (problems.length > 0) throw new ConfigError(problems);

  return {
    env: appEnv,
    host,
    port,
    productId: 'AEG',
    storageMode,
    dbPath,
    authMode: 'demo',
    googleLogin: { enabled: glAny, clientId: glClientId, clientSecret: glClientSecret, baseUrl: glBaseUrl, adminEmails: glAdmins, proEmails: glPro },
    providerMode,
    primaryProvider,
    modelsEnabled,
    assist: { enabled: assistEnabled, draftMedical: assistDraftMedical, preview: assistPreview },
    google: { apiKey: googleApiKey, model: googleModel, allowedDataClasses: googleClasses as DataClass[], minIntervalMs: googleMinIntervalMs, dailyRequestCap: googleDailyCap, chatModels: readString('AEGIS_GOOGLE_CHAT_MODELS', 'gemini-3.5-flash-lite,gemini-3.8-flash').split(',').map((x) => x.trim()).filter(Boolean) },
    reapi: {
      apiKey: reapiApiKey,
      baseUrl: reapiBaseUrl,
      model: reapiModel,
      allowedDataClasses: allowedDataClasses as DataClass[],
      tokenParam: reapiTokenParam,
    },
    modes: { models: modeModels, escalationEnabled, premiumEnabled, registeredUsers },
    roleModels,
    price: { inputMicroPerMTok: priceInputMicro, outputMicroPerMTok: priceOutputMicro, capturedAt: priceCapturedAt, source: priceSource },
    budget: {
      priceSnapshotId,
      googleMicro: budgetGoogleMicro,
      reapiMicro: budgetReapiMicro,
      accountMicro: budgetAccountMicro,
      dayMicro: budgetDayMicro,
      taskMicro: budgetTaskMicro,
    },
    gateway: {
      totalDeadlineMs,
      maxAttemptsTotal,
      maxPrimaryAttempts,
      backoffBaseMs,
      circuitFailureThreshold,
      circuitCooldownMs,
    },
    feed: { allowlist: feedAllowlist, pollMinutes: feedPollMinutes },
  };
}

function isLoopbackHost(host: string): boolean {
  return host === 'localhost' || host === '::1' || /^127(?:\.\d{1,3}){3}$/.test(host);
}
