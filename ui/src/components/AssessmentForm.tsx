import { useState, type FormEvent } from 'react';
import type { CardRevision } from '../../../src/types/domain.js';
import { apiRequest, ApiError } from '../api/client.js';

interface AssessmentFormProps {
  token: string | null;
  incident: CardRevision | null;
  onComplete: (cardId: string | null) => void;
}

type AssessmentResponse = { run: { state: string }; card: CardRevision | null };

export function AssessmentForm({ token, incident, onComplete }: AssessmentFormProps) {
  const [demand, setDemand] = useState('');
  const [available, setAvailable] = useState('');
  const [reserve, setReserve] = useState('');
  const [unknown, setUnknown] = useState({ demand: false, available: false, reserve: false });
  const [unitId, setUnitId] = useState('UNIT.WATER_KIT');
  const [regionId, setRegionId] = useState('REGION.DEMO_A');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!token || !incident) { setError('Select an incident and sign in to run an assessment.'); return; }
    setError(null);
    setBusy(true);
    const body: {
      incidentCardId: string; incidentRevision: number; regionId: string; unitId: string;
      demandUnits?: number | null; availableUnits?: number | null; reserveUnits?: number | null;
    } = { incidentCardId: incident.cardId, incidentRevision: incident.revision, regionId, unitId };
    if (unknown.demand) body.demandUnits = null;
    else if (demand !== '') body.demandUnits = Number(demand);
    if (unknown.available) body.availableUnits = null;
    else if (available !== '') body.availableUnits = Number(available);
    if (unknown.reserve) body.reserveUnits = null;
    else if (reserve !== '') body.reserveUnits = Number(reserve);
    try {
      const result = await apiRequest<AssessmentResponse>('/api/workflows/resource-assessment', { method: 'POST', token, body });
      if (result.run.state === 'failed') throw new ApiError('E_INTERNAL', 'The assessment did not complete.');
      onComplete(result.card?.cardId ?? null);
    } catch (reason: unknown) {
      setError(reason instanceof ApiError ? `${reason.code}: ${reason.message}` : 'Assessment request failed');
    } finally {
      setBusy(false);
    }
  }

  return <form className="assessment-form" data-testid="assessment-form" onSubmit={(event) => void submit(event)}>
    <h3>Resource assessment</h3>
    <label>Unit<input value={unitId} onChange={(event) => setUnitId(event.currentTarget.value)} /></label>
    <label>Region<input value={regionId} onChange={(event) => setRegionId(event.currentTarget.value)} /></label>
    <div className="assessment-quantity">
      <label htmlFor="input-demand">Demand</label><input id="input-demand" data-testid="input-demand" type="number" min="0" step="1" value={demand} disabled={unknown.demand} onChange={(event) => setDemand(event.currentTarget.value)} />
      <label><input data-testid="unknown-demand" type="checkbox" checked={unknown.demand} onChange={(event) => setUnknown({ ...unknown, demand: event.currentTarget.checked })} /> Unknown</label>
    </div>
    <div className="assessment-quantity">
      <label htmlFor="input-available">Available</label><input id="input-available" data-testid="input-available" type="number" min="0" step="1" value={available} disabled={unknown.available} onChange={(event) => setAvailable(event.currentTarget.value)} />
      <label><input data-testid="unknown-available" type="checkbox" checked={unknown.available} onChange={(event) => setUnknown({ ...unknown, available: event.currentTarget.checked })} /> Unknown</label>
    </div>
    <div className="assessment-quantity">
      <label htmlFor="input-reserve">Reserve</label><input id="input-reserve" data-testid="input-reserve" type="number" min="0" step="1" value={reserve} disabled={unknown.reserve} onChange={(event) => setReserve(event.currentTarget.value)} />
      <label><input data-testid="unknown-reserve" type="checkbox" checked={unknown.reserve} onChange={(event) => setUnknown({ ...unknown, reserve: event.currentTarget.checked })} /> Unknown</label>
    </div>
    <button data-testid="run-assessment" type="submit" disabled={busy || !incident || !token}>{busy ? 'Running…' : 'Run assessment'}</button>
    {error && <p className="inline-error" role="alert" data-testid="error-assessment">{error}</p>}
  </form>;
}
