import { describe, expect, it } from 'vitest';
import { parseLocalCommand } from '../../src/chat/router.js';

describe('TSK-012 local chat parser', () => {
  it('AEG-TST-003 maps fixed commands and keeps ids case-sensitive', () => {
    expect(parseLocalCommand(' HELP ')).toEqual({ routeId: 'I_aegis_help_show', args: {} });
    expect(parseLocalCommand('LIST   INCIDENTS')).toEqual({ routeId: 'I_aegis_incident_list', args: {} });
    expect(parseLocalCommand('OPEN Inc-Mixed-01')).toEqual({ routeId: 'I_aegis_card_open', args: { cardId: 'Inc-Mixed-01' } });
    expect(parseLocalCommand('verify audit')).toEqual({ routeId: 'I_aegis_audit_verify', args: {} });
  });

  it.each([
    ['assess INC-A unit UNIT.X region REGION.Y demand 12', 12, undefined, undefined],
    ['ASSESS INC-A UNIT UNIT.X REGION REGION.Y DEMAND UNKNOWN AVAILABLE 0 RESERVE UNKNOWN', null, 0, null],
  ])('AEG-TST-003 parses assessment quantities: %s', (text, demand, available, reserve) => {
    const result = parseLocalCommand(text);
    expect(result.routeId).toBe('I_aegis_resource_assess');
    if (result.routeId !== null) {
      expect(result.args.demandUnits).toBe(demand);
      expect(result.args.availableUnits).toBe(available);
      expect(result.args.reserveUnits).toBe(reserve);
    }
  });

  it.each([
    'unknown command', 'help me', 'help  extra',
    'assess INC-A unit UNIT.X region REGION.Y demand 1.5',
    'assess INC-A unit UNIT.X region REGION.Y demand -1',
    'assess INC-A unit UNIT.X region REGION.Y demand 1000000001',
    'assess INC-A unit UNIT.X region REGION.Y demand 1 reserve 2 available 3',
  ])('AEG-TST-003 treats unsupported or invalid input as ambiguous: %s', (text) => {
    expect(parseLocalCommand(text)).toEqual({ routeId: null, reason: 'ambiguous' });
  });
});
