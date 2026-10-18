import { useEffect, useMemo } from 'react';
import type { CardRevision } from '../../src/types/domain.js';
import { apiRequest, ApiError } from './api/client.js';
import { AssessmentForm } from './components/AssessmentForm.js';
import { CardView } from './components/CardView.js';
import { ChatPanel, type ChatMessage } from './components/ChatPanel.js';
import { IncidentList } from './components/IncidentList.js';
import { JudgeTrialBanner } from './components/JudgeTrialBanner.js';
import { LoginBar } from './components/LoginBar.js';
import { SignInScreen } from './components/SignInScreen.js';
import { Workspace } from './components/Workspace.js';
import { SceneBackground } from './scene/SceneBackground.js';
import { useWorkspaceStore } from './state/store.js';
import type { CardViewData } from './state/store.js';

interface CardSummary { cardId: string; latestRevision: number }
interface CardDetailResponse { card: CardRevision; revisions: CardRevision[]; evidence: CardViewData['evidence'] }

export function App() {
  const [state, dispatch] = useWorkspaceStore();
  const token = state.session?.token ?? null;
  const selected = state.cards.find((item) => item.card.cardId === state.selectedCardId) ?? null;
  const incidentCards = state.cards.filter((item) => item.card.kind === 'incident');
  const sceneItems = useMemo(() => state.cards.map((item) => ({ card: item.card, evidence: item.evidence })), [state.cards]);

  async function loadCards(currentToken: string, preferredCardId?: string | null): Promise<void> {
    dispatch({ type: 'loading-cards', value: true });
    dispatch({ type: 'error-cards', value: null });
    try {
      const summary = await apiRequest<{ cards: CardSummary[] }>('/api/cards', { token: currentToken });
      const cards = await Promise.all(summary.cards.map(async (item): Promise<CardViewData> => {
        const detail = await apiRequest<CardDetailResponse>(`/api/cards/${encodeURIComponent(item.cardId)}?revision=${item.latestRevision}`, { token: currentToken });
        return { card: detail.card, revisions: detail.revisions, evidence: detail.evidence, latestRevision: item.latestRevision };
      }));
      dispatch({ type: 'cards', cards });
      dispatch({ type: 'select-card', cardId: preferredCardId && cards.some((item) => item.card.cardId === preferredCardId)
        ? preferredCardId
        : state.selectedCardId && cards.some((item) => item.card.cardId === state.selectedCardId)
        ? state.selectedCardId
        : cards.find((item) => item.card.kind === 'incident')?.card.cardId ?? null });
    } catch (reason: unknown) {
      dispatch({ type: 'error-cards', value: reason instanceof ApiError ? `${reason.code}: ${reason.message}` : 'Card list could not be loaded' });
    } finally {
      dispatch({ type: 'loading-cards', value: false });
    }
  }

  useEffect(() => {
    if (!token) return;
    void loadCards(token);
    void apiRequest<{ pins: Array<{ cardId: string }> }>('/api/pins', { token })
      .then((result) => dispatch({ type: 'pins', pins: result.pins.map((item) => item.cardId) }))
      .catch((reason: unknown) => dispatch({ type: 'error-cards', value: reason instanceof ApiError ? `${reason.code}: ${reason.message}` : 'Pinned cards could not be loaded' }));
  }, [token]);

  async function togglePin(cardId: string): Promise<void> {
    if (!token) return;
    try {
      const pinned = state.pins.includes(cardId);
      const result = await apiRequest<{ pins: Array<{ cardId: string }> }>(`/api/pins/${encodeURIComponent(cardId)}`, {
        method: pinned ? 'DELETE' : 'PUT', token,
      });
      dispatch({ type: 'pins', pins: result.pins.map((item) => item.cardId) });
    } catch (reason: unknown) {
      dispatch({ type: 'error-card', value: reason instanceof ApiError ? `${reason.code}: ${reason.message}` : 'Pin could not be updated' });
    }
  }

  function addChatMessage(message: ChatMessage): void {
    dispatch({ type: 'chat-message', id: message.id, blocks: message.blocks, notice: message.notice, role: message.role });
  }

  const messages = state.chatMessages as ChatMessage[];
  const selectedIncident = selected?.card.kind === 'incident' ? selected.card : null;

  return <div className="app-shell">
    <SceneBackground items={sceneItems} />
    <LoginBar session={state.session} status={state.status} dispatch={dispatch} />
    <JudgeTrialBanner session={state.session} />
    {!state.session ? <SignInScreen dispatch={dispatch} /> : <Workspace
      cards={state.cards}
      pins={state.pins}
      selectedCardId={state.selectedCardId}
      onSelectCard={(cardId) => dispatch({ type: 'select-card', cardId })}
      leftContent={<>
        <div className="panel-heading"><h1>Incident workspace</h1><span>{incidentCards.length} incidents</span></div>
        {state.loading.cards && <p data-testid="loading-incident-list">Loading incidents…</p>}
        {state.errors.cards && <p className="inline-error" data-testid="error-incident-list" role="alert">{state.errors.cards}</p>}
        <div className="workspace-columns">
          <IncidentList cards={incidentCards.map((item) => item.card)} selectedCardId={state.selectedCardId} onSelect={(cardId) => dispatch({ type: 'select-card', cardId })} />
          <div className="card-detail-column">
            {state.loading.card && <p data-testid="loading-card">Loading card…</p>}
            {state.errors.card && <p className="inline-error" data-testid="error-card" role="alert">{state.errors.card}</p>}
            {selected ? <CardView
              card={selected.card}
              revisions={selected.revisions}
              evidence={selected.evidence}
              latestRevision={selected.latestRevision}
              pinned={state.pins.includes(selected.card.cardId)}
              attached={state.attachments.some((item) => item.cardId === selected.card.cardId)}
              onPin={() => void togglePin(selected.card.cardId)}
              onAttach={(revision) => dispatch({ type: 'toggle-attachment', cardId: selected.card.cardId, revision })}
            /> : !state.loading.cards && !state.errors.cards && <p data-testid="empty-card">Select an incident to view its card.</p>}
            <AssessmentForm token={token} incident={selectedIncident} onComplete={(cardId) => { if (token) void loadCards(token, cardId); }} />
          </div>
        </div>
      </>}
      rightContent={<ChatPanel
        token={token}
        cards={state.cards.map((item) => item.card)}
        attachments={state.attachments}
        messages={messages}
        onRemoveAttachment={(cardId) => dispatch({ type: 'toggle-attachment', cardId, revision: 1 })}
        onAddMessage={addChatMessage}
        onClearAttachments={() => dispatch({ type: 'clear-attachments' })}
        onOpenCard={(cardId) => dispatch({ type: 'select-card', cardId })}
      />}
    />}
  </div>;
}
