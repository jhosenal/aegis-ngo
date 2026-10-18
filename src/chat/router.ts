export type LocalMatch = { routeId: string; args: Record<string, unknown> } | { routeId: null; reason: 'ambiguous' };

const AMBIGUOUS: LocalMatch = { routeId: null, reason: 'ambiguous' };

function quantity(value: string): number | null | undefined {
  if (value.toLowerCase() === 'unknown') return null;
  if (!/^\d+$/.test(value)) return undefined;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= 1_000_000_000 ? number : undefined;
}

export function parseLocalCommand(text: string): LocalMatch {
  const normalized = text.trim().replace(/\s+/g, ' ');
  const lower = normalized.toLowerCase();
  if (lower === 'help') return { routeId: 'I_aegis_help_show', args: {} };
  if (lower === 'list incidents') return { routeId: 'I_aegis_incident_list', args: {} };
  if (lower === 'verify audit') return { routeId: 'I_aegis_audit_verify', args: {} };

  const open = /^open ([^ ]+)$/i.exec(normalized);
  if (open?.[1]) return { routeId: 'I_aegis_card_open', args: { cardId: open[1] } };
  const explain = /^explain ([^ ]+)$/i.exec(normalized);
  if (explain?.[1]) return { routeId: 'I_aegis_card_explain', args: { cardId: explain[1] } };

  const assess = /^assess ([^ ]+) unit ([^ ]+) region ([^ ]+) demand ([^ ]+)(?: available ([^ ]+))?(?: reserve ([^ ]+))?$/i.exec(normalized);
  if (assess?.[1] && assess[2] && assess[3] && assess[4]) {
    const demandUnits = quantity(assess[4]);
    const availableUnits = assess[5] === undefined ? undefined : quantity(assess[5]);
    const reserveUnits = assess[6] === undefined ? undefined : quantity(assess[6]);
    if (demandUnits === undefined
      || (assess[5] !== undefined && availableUnits === undefined)
      || (assess[6] !== undefined && reserveUnits === undefined)) return AMBIGUOUS;
    return {
      routeId: 'I_aegis_resource_assess',
      args: {
        incidentCardId: assess[1], unitId: assess[2], regionId: assess[3], demandUnits,
        ...(assess[5] === undefined ? {} : { availableUnits }),
        ...(assess[6] === undefined ? {} : { reserveUnits }),
      },
    };
  }
  return AMBIGUOUS;
}
