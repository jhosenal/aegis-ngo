import { useCallback, useEffect, useReducer, useRef } from 'react';
import { apiRequest, SESSION_EXPIRED_EVENT } from '../api/client.js';
import type { CardRevision, ChatBlock, EvidenceView, ProviderNoticeCode } from '../../../src/types/domain.js';

export interface SessionView {
  token: string;
  user: { userId: string; displayName: string; role: string; tenantId: string; tenantName: string; plan?: string; isAdmin?: boolean };
}

export interface CardViewData {
  card: CardRevision;
  revisions: CardRevision[];
  evidence: EvidenceView[];
  latestRevision: number;
}

export interface ChatMessageView {
  id: string;
  blocks: ChatBlock[];
  notice: ProviderNoticeCode | null;
  role?: 'user' | 'assistant';
  attachments?:{cardId:string;revision:number}[];
}

export interface WorkspaceState {
  session: SessionView | null;
  cards: CardViewData[];
  pins: string[];
  selectedCardId: string | null;
  attachments: { cardId: string; revision: number }[];
  chatMessages: ChatMessageView[];
  status: { storage: string; models: string };
  loading: { cards: boolean; card: boolean };
  errors: { cards: string | null; card: string | null };
}

export type WorkspaceAction =
  | { type: 'session'; session: SessionView | null }
  | { type: 'status'; storage: string; models: string }
  | { type: 'cards'; cards: CardViewData[] }
  | { type: 'loading-cards'; value: boolean }
  | { type: 'loading-card'; value: boolean }
  | { type: 'error-cards'; value: string | null }
  | { type: 'error-card'; value: string | null }
  | { type: 'select-card'; cardId: string | null }
  | { type: 'pins'; pins: string[] }
  | { type: 'toggle-pin'; cardId: string }
  | { type: 'toggle-attachment'; cardId: string; revision: number }
  | { type: 'clear-attachments' }
  | { type: 'chat-message'; id: string; blocks: ChatBlock[]; notice: ProviderNoticeCode | null; role?: 'user' | 'assistant'; attachments?:{cardId:string;revision:number}[] };

export const initialState: WorkspaceState = {
  session: null,
  cards: [],
  pins: [],
  selectedCardId: null,
  attachments: [],
  chatMessages: [],
  status: { storage: 'Loading', models: 'Loading' },
  loading: { cards: false, card: false },
  errors: { cards: null, card: null },
};

export function reducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case 'session': return { ...state, session: action.session };
    case 'status': return { ...state, status: { storage: action.storage, models: action.models } };
    case 'cards': return { ...state, cards: action.cards };
    case 'loading-cards': return { ...state, loading: { ...state.loading, cards: action.value } };
    case 'loading-card': return { ...state, loading: { ...state.loading, card: action.value } };
    case 'error-cards': return { ...state, errors: { ...state.errors, cards: action.value } };
    case 'error-card': return { ...state, errors: { ...state.errors, card: action.value } };
    case 'select-card': return { ...state, selectedCardId: action.cardId };
    case 'pins': return { ...state, pins: action.pins };
    case 'toggle-pin':
      return { ...state, pins: state.pins.includes(action.cardId)
        ? state.pins.filter((cardId) => cardId !== action.cardId)
        : [...state.pins, action.cardId] };
    case 'toggle-attachment':
      return { ...state, attachments: state.attachments.some((item) => item.cardId === action.cardId)
        ? state.attachments.filter((item) => item.cardId !== action.cardId)
        : [...state.attachments, { cardId: action.cardId, revision: action.revision }] };
    case 'clear-attachments': return { ...state, attachments: [] };
    case 'chat-message': return { ...state, chatMessages: [...state.chatMessages, { id: action.id, blocks: action.blocks, notice: action.notice, role: action.role, attachments:action.attachments }] };
  }
}

export function useWorkspaceStore(): [WorkspaceState, (action: WorkspaceAction) => void] {
  const [state, dispatchState] = useReducer(reducer, initialState);
  const oauthHandoff = useRef(/^#(register|aegis_session)=/.test(window.location.hash));
  const storageKey = 'aegis.session';
  const sessionToken = useRef<string | null>(null);
  sessionToken.current = state.session?.token ?? null;
  const dispatch = useCallback((action: WorkspaceAction) => {
    if (action.type === 'session') {
      sessionToken.current = action.session?.token ?? null;
      try {
        if (action.session) sessionStorage.setItem(storageKey, action.session.token);
        else sessionStorage.removeItem(storageKey);
      } catch { /* Sign-in still works when tab storage is unavailable. */ }
    }
    dispatchState(action);
    if (action.type === 'session') window.dispatchEvent(new CustomEvent('aegis-session-change', {detail:action.session}));
  }, []);
  useEffect(() => {
    const sync = (event: Event) => {
      const session = (event as CustomEvent<SessionView|null>).detail;
      sessionToken.current = session?.token ?? null;
      dispatchState({type:'session',session});
    };
    const expire = (event: Event) => {
      const rejected = (event as CustomEvent<{token:string}>).detail.token;
      if (sessionToken.current === rejected) dispatch({type:'session',session:null});
      else if (sessionToken.current === null) {
        try { if (sessionStorage.getItem(storageKey) === rejected) sessionStorage.removeItem(storageKey); } catch { /* Storage may be unavailable. */ }
      }
    };
    window.addEventListener('aegis-session-change',sync);
    window.addEventListener(SESSION_EXPIRED_EVENT,expire);
    return () => {
      window.removeEventListener('aegis-session-change',sync);
      window.removeEventListener(SESSION_EXPIRED_EVENT,expire);
    };
  }, [dispatch]);
  useEffect(() => {
    // OAuth handoffs take precedence over a previous session in the same tab.
    if (oauthHandoff.current) return;
    let token: string | null = null;
    try { token = sessionStorage.getItem(storageKey); } catch { return; }
    if (!token || !/^[0-9a-f]{64}$/.test(token)) return;
    let active = true;
    void apiRequest<SessionView['user']>('/api/me', { token }).then(user => {
      if (active && sessionStorage.getItem(storageKey) === token) dispatch({ type: 'session', session: { token, user } });
    }).catch(() => {
      // An authenticated 401 is handled by the shared event; retain storage on transient network/server errors.
    });
    return () => { active = false; };
  }, [dispatch]);
  return [state, dispatch];
}
