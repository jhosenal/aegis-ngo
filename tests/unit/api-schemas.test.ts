import { describe, it, expect } from 'vitest';
import { RunAssessmentBody, ChatBody, SessionBody } from '../../src/types/api-schemas.js';

const base = { incidentCardId: 'CARD-1', incidentRevision: 1, regionId: 'REGION.DEMO_A', unitId: 'UNIT.WATER_KIT' };
describe('API request schemas (contract)', () => {
  it('omitted vs explicit null are different (null = unknown, omitted = load from tenant record)', () => {
    const omitted = RunAssessmentBody.parse({ ...base, demandUnits: 120 });
    expect('availableUnits' in omitted).toBe(false);
    const unknown = RunAssessmentBody.parse({ ...base, demandUnits: 120, availableUnits: null });
    expect(unknown.availableUnits).toBeNull();
  });
  it('rejects unknown keys such as ownerId / tenantId / role', () => {
    for (const k of ['ownerId', 'tenantId', 'role', 'userId']) expect(RunAssessmentBody.safeParse({ ...base, [k]: 'X' }).success).toBe(false);
    expect(ChatBody.safeParse({ text: 'hi', tenantId: 'TENANT-B' }).success).toBe(false);
    expect(SessionBody.safeParse({ userId: 'USER-A-COORD', role: 'coordinator' }).success).toBe(false);
  });
  it('rejects negatives, decimals, huge numbers, bad asOf', () => {
    for (const bad of [-1, 1.5, 1e12]) expect(RunAssessmentBody.safeParse({ ...base, demandUnits: bad }).success).toBe(false);
    expect(RunAssessmentBody.safeParse({ ...base, asOf: 'yesterday' }).success).toBe(false);
  });
  it('limits attachments to 5 and text length', () => {
    const a = (n: number) => Array.from({ length: n }, (_, i) => ({ cardId: 'C' + i, revision: 1 }));
    expect(ChatBody.safeParse({ text: 'x', attachments: a(5) }).success).toBe(true);
    expect(ChatBody.safeParse({ text: 'x', attachments: a(6) }).success).toBe(false);
    expect(ChatBody.safeParse({ text: 'x'.repeat(2001) }).success).toBe(false);
  });
});
