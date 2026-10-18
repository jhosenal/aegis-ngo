import type { AegisConfig } from '../config/config.js';
import { AegisError } from '../engine/errors.js';
import type { Principal } from '../types/domain.js';
import { canUseOperationalTools } from './access.js';

/**
 * Model modes the user can pick in chat.
 *   normal: the cheap model only (gpt-6-luna).
 *   auto:   starts on the cheap model and, for registered users when escalation is switched on, moves up to Pro and then Expert
 *           only when code decides the cheaper answer failed (invalid JSON, a route outside the allowlist, a failed safety check).
 *   pro / expert: go straight to that tier. Registered users only, and switched off until the owner enables them.
 * The browser sends only the mode name. The server picks the model.
 */
/** The three Gemini model ids the chat selector offers. The browser sends the id; the server decides whether this user may use it. */
export const GOOGLE_CHAT_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-4-argon'] as const;
export type GoogleChatModel = typeof GOOGLE_CHAT_MODELS[number];
export const CHAT_MODES = ['auto', 'normal', 'pro', 'expert', ...GOOGLE_CHAT_MODELS] as const;
export type ChatMode = typeof CHAT_MODES[number];
export type TierLabel = 'Normal' | 'Pro' | 'Expert' | 'Flash-Lite' | 'Flash' | 'Argon';
export interface Tier { label: TierLabel; model: string | null }
export interface ModeInfo { id: ChatMode; label: string; available: boolean; note: string }

const LABELS: Record<ChatMode, string> = { auto: 'Auto', normal: 'Normal', pro: 'Pro', expert: 'Expert', 'gemini-3.5-flash-lite': 'Gemini 3.5 Flash-Lite', 'gemini-3.8-flash': 'Gemini 3.8 Flash', 'gemini-4-argon': 'Gemini 4 Argon' };
const TIER_OF: Record<GoogleChatModel, TierLabel> = { 'gemini-3.5-flash-lite': 'Flash-Lite', 'gemini-3.8-flash': 'Flash', 'gemini-4-argon': 'Argon' };
const isGoogleModel = (mode: string): mode is GoogleChatModel => (GOOGLE_CHAT_MODELS as readonly string[]).includes(mode);

/** The Gemini models can be used only when Google is the primary provider, live, with a key (the owner's switch). */
export function googleChatReady(config: AegisConfig): boolean {
  return config.providerMode === 'live' && config.primaryProvider === 'google' && Boolean(config.google.apiKey);
}
/** Policy (owner, 2026-10-17): Flash is for everyone; Flash-Lite and Argon are for Pro accounts and administrators only. */
export function googleModelAllowed(model: GoogleChatModel, principal: Principal, config: AegisConfig): boolean {
  if (!googleChatReady(config) || !config.google.chatModels.includes(model)) return false;
  if (model === 'gemini-3.8-flash') return true;
  return canUseOperationalTools(principal);
}

export function isRegistered(principal: Principal, _config: AegisConfig): boolean {
  return canUseOperationalTools(principal);
}

/** Pro and Expert (and Auto's escalation to them) need the owner's switch AND a registered user. */
export function premiumAllowed(principal: Principal, config: AegisConfig): boolean {
  return config.modes.premiumEnabled && isRegistered(principal, config);
}

export function modesFor(principal: Principal, config: AegisConfig): ModeInfo[] {
  const premium = premiumAllowed(principal, config);
  const premiumNote = !config.modes.premiumEnabled
    ? 'Planned for registered users. Not available yet.'
    : 'For registered users only.';
  const escalates = premium && config.modes.escalationEnabled;
  return [
    { id: 'auto', label: LABELS.auto, available: true, note: escalates ? 'Starts on the standard model and steps up only if the answer fails checks.' : 'Standard model. Stepping up to Pro and Expert is planned for registered users.' },
    { id: 'normal', label: LABELS.normal, available: true, note: 'Standard model.' },
    { id: 'pro', label: LABELS.pro, available: premium, note: premium ? 'Stronger model.' : premiumNote },
    { id: 'expert', label: LABELS.expert, available: premium, note: premium ? 'Strongest model, highest cost.' : premiumNote },
    ...GOOGLE_CHAT_MODELS.map((id): ModeInfo => {
      const ready = googleChatReady(config);
      const allowed = googleModelAllowed(id, principal, config);
      return { id, label: LABELS[id], available: allowed, note: !ready || !config.google.chatModels.includes(id) ? 'Google model activation pending.' : allowed ? 'Available.' : 'Requires a Pro or Admin account.' };
    }),
  ];
}

/**
 * The ordered tiers to try for this request. With a Google primary the models are the seat's own, so no override is sent (model null).
 * Throws E_MODE_UNAVAILABLE when the mode is not allowed for this user.
 */
export function planFor(mode: ChatMode, principal: Principal, config: AegisConfig): Tier[] {
  const reapiFirst = config.primaryProvider === 'reapi';
  const model = (name: string): string | null => (reapiFirst ? name : null);
  if (isGoogleModel(mode)) {
    if (!googleModelAllowed(mode, principal, config)) throw new AegisError('E_MODE_UNAVAILABLE', `${LABELS[mode]} is not available for this account`);
    return [{ label: TIER_OF[mode], model: mode }];
  }
  const normal: Tier = { label: 'Normal', model: model(config.modes.models.normal) };
  const pro: Tier = { label: 'Pro', model: model(config.modes.models.pro) };
  const expert: Tier = { label: 'Expert', model: model(config.modes.models.expert) };
  const premium = premiumAllowed(principal, config);
  switch (mode) {
    case 'normal': return [normal];
    case 'auto': return premium && config.modes.escalationEnabled && reapiFirst ? [normal, pro, expert] : [normal];
    case 'pro':
    case 'expert':
      if (!premium || !reapiFirst) throw new AegisError('E_MODE_UNAVAILABLE', `${LABELS[mode]} mode is not available`);
      return [mode === 'pro' ? pro : expert];
  }
}
